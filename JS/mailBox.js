// JS/mailBox.js — Relife MailBox v2.0
// ─────────────────────────────────────────────────────────────────────────────
// Toàn bộ thao tác ghi (send, delete, mark-read) đều đi qua Vercel API.
// Thao tác đọc real-time vẫn dùng Firestore onSnapshot trực tiếp.
//
// API endpoints (Vercel Functions):
//   POST   /api/mail/send               — gửi thư (server hoặc DM)
//   POST   /api/mail/mark-read          — đánh dấu đã đọc
//   DELETE /api/mail/delete             — xóa thư
//   GET    /api/mail/search-recipients  — tìm người nhận
// ─────────────────────────────────────────────────────────────────────────────

import { initFirebase } from '../firebase-config.js';
import { applyFeatureFlags } from './featureFlags.js';
import {
  getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, getDocs, limit
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════
const db   = initFirebase();
const auth = getAuth();

const API_BASE = window.location.origin; // Vercel production URL

// ── Tier config ───────────────────────────────────────────────────
const ACCOUNT_TYPE_CONFIG = {
  admin:     { tier:'SA',  rank:100, name:'Admin',     icon:'bi-shield-fill-check' },
  dev:       { tier:'SA',  rank: 90, name:'Dev',        icon:'bi-code-slash'        },
  operator:  { tier:'SA',  rank: 80, name:'Vận hành',   icon:'bi-gear-fill'         },
  moderator: { tier:'SA',  rank: 70, name:'Kiểm duyệt', icon:'bi-shield-fill'       },
  advanced:  { tier:'RA',  rank: 30, name:'Nâng cao',   icon:'bi-star-fill'         },
  user:      { tier:'RA',  rank: 20, name:'Người dùng', icon:'bi-person-fill'       },
  shared:    { tier:'LLA', rank: 10, name:'Dùng chung', icon:'bi-people-fill'       },
  trial:     { tier:'LLA', rank:  5, name:'Thử nghiệm', icon:'bi-flask-fill'        },
};

function getAccountTier(typeKey) { return ACCOUNT_TYPE_CONFIG[typeKey]?.tier || 'RA'; }
function isSAType(typeKey)       { return getAccountTier(typeKey) === 'SA'; }

// ── State ─────────────────────────────────────────────────────────
let currentUser           = null;
let currentUserDoc        = null;
let currentTab            = 'server';
let currentSubTab         = 'inbox';
let composeType           = 'server';
let selectedRecipients    = [];          // Multi-recipient list (thay selectedRecipientData)
let currentReadMail       = null;
let unsubServerMails      = null;
let unsubInboxMails       = null;
let unsubSentMails        = null;
let recipientDebounce     = null;

// ── DOM ───────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const pageLoadingOverlay  = $('pageLoadingOverlay');
const mainContent         = $('mainContent');
const loginPrompt         = $('loginPrompt');
const userRoleLabel       = $('userRoleLabel');
const unreadBadge         = $('unreadBadge');
const unreadCount         = $('unreadCount');
const tabServerBtn        = $('tabServer');
const tabMineBtn          = $('tabMine');
const panelServer         = $('panelServer');
const panelMine           = $('panelMine');
const badgeServer         = $('badgeServer');
const badgeMine           = $('badgeMine');
const saComposeArea       = $('saComposeArea');
const userComposeArea     = $('userComposeArea');
const composeBtn          = $('composeBtn');
const composeServerBtn    = $('composeServerBtn');
const composeDMBtn        = $('composeDMBtn');
const subInboxBtn         = $('subInbox');
const subSentBtn          = $('subSent');
const inboxList           = $('inboxList');
const sentList            = $('sentList');
const inboxEmpty          = $('inboxEmpty');
const sentEmpty           = $('sentEmpty');
const serverMailList      = $('serverMailList');
const serverEmpty         = $('serverEmpty');
const mailTypeSelector    = $('mailTypeSelector');
const recipientArea       = $('recipientArea');
const recipientInput      = $('recipientInput');
const recipientResults    = $('recipientResults');
const selectedRecipientEl = $('selectedRecipient');
const mailSubjectEl       = $('mailSubject');
const mailBodyEl          = $('mailBody');
const subjectCount        = $('subjectCount');
const bodyCount           = $('bodyCount');
const priorityArea        = $('priorityArea');
const sendMailBtn         = $('sendMailBtn');
const composeError        = $('composeError');
const composeModalTitle   = $('composeModalTitle');
const btnTypeServer       = $('btnTypeServer');
const btnTypeDM           = $('btnTypeDM');
const readMailIcon        = $('readMailIcon');
const readMailSubjectEl   = $('readMailSubject');
const readMailMeta        = $('readMailMeta');
const readMailContent     = $('readMailContent');
const replyBtn            = $('replyBtn');
const deleteMailBtn       = $('deleteMailBtn');
const mailToastEl         = $('mailToast');
const mailToastMsg        = $('mailToastMsg');

const composeModal  = new bootstrap.Modal(document.getElementById('composeModal'));
const readMailModal = new bootstrap.Modal(document.getElementById('readMailModal'));

// ════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════
const esc = s => String(s || '').replace(/[&<>"']/g, m =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

function fmtDate(val) {
  try {
    const d   = val?.toDate ? val.toDate() : (val ? new Date(val) : null);
    if (!d || isNaN(d)) return '';
    const now = new Date(), diff = now - d;
    const m   = Math.floor(diff / 60000);
    const h   = Math.floor(diff / 3600000);
    const day = Math.floor(diff / 86400000);
    if (m < 1)   return 'Vừa xong';
    if (m < 60)  return `${m} phút trước`;
    if (h < 24)  return `${h} giờ trước`;
    if (day < 7) return `${day} ngày trước`;
    return d.toLocaleDateString('vi-VN');
  } catch { return ''; }
}

function fmtDateFull(val) {
  try {
    const d = val?.toDate ? val.toDate() : (val ? new Date(val) : null);
    if (!d || isNaN(d)) return '';
    return d.toLocaleString('vi-VN', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return ''; }
}

function showToast(msg, isError = false) {
  mailToastMsg.textContent = msg;
  mailToastEl.className = 'mail-toast' + (isError ? ' error' : '');
  void mailToastEl.offsetWidth;
  mailToastEl.classList.add('show');
  setTimeout(() => mailToastEl.classList.remove('show'), 3200);
}

function renderSkeletons(container, count = 3) {
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="mail-skeleton">
      <div class="skeleton-icon"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line medium"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>`).join('');
}

function getPriorityConfig(p) {
  const map = {
    urgent:    { cls:'urgent',    icon:'bi-exclamation-triangle-fill', badgeHtml:'<span class="mail-priority-badge urgent"><i class="bi bi-exclamation-triangle-fill"></i>Khẩn cấp</span>' },
    important: { cls:'important', icon:'bi-exclamation-circle-fill',   badgeHtml:'<span class="mail-priority-badge important"><i class="bi bi-exclamation-circle"></i>Quan trọng</span>' },
    normal:    { cls:'',          icon:'bi-envelope-fill',             badgeHtml:'' },
  };
  return map[p] || map.normal;
}

function getTierBadgeHtml(tier) {
  if (tier === 'SA')  return '<span class="tier-badge sa"><i class="bi bi-shield-fill-check"></i>SA</span>';
  if (tier === 'RA')  return '<span class="tier-badge ra"><i class="bi bi-person-fill"></i>RA</span>';
  return '<span class="tier-badge" style="background:rgba(20,184,166,.1);color:#0f766e;border:1px solid rgba(20,184,166,.25);font-size:.7rem;padding:2px 8px;border-radius:999px;font-weight:700;">LLA</span>';
}

// ── Read tracking (localStorage) ──────────────────────────────────
function getReadSet(type) {
  try {
    const raw = localStorage.getItem(`relife_read_${type}_${currentUser?.uid||'x'}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function saveReadSet(type, set) {
  try {
    const arr = [...set];
    if (arr.length > 300) arr.splice(0, arr.length - 300);
    localStorage.setItem(`relife_read_${type}_${currentUser?.uid||'x'}`, JSON.stringify(arr));
  } catch {}
}

// ════════════════════════════════════════════════════════════════════
// API CLIENT
// ════════════════════════════════════════════════════════════════════
async function getIdToken() {
  if (!currentUser) throw new Error('Chưa đăng nhập');
  return currentUser.getIdToken(false);
}

async function apiCall(method, path, body = null) {
  const token = await getIdToken();
  const opts  = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));

  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ════════════════════════════════════════════════════════════════════
// AUTH & BOOT
// ════════════════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  await applyFeatureFlags('mailbox');

  if (!user) {
    pageLoadingOverlay.style.display = 'none';
    mainContent.style.display  = 'block';
    loginPrompt.style.display  = 'flex';
    return;
  }

  currentUser = user;
  try {
    const snap     = await getDoc(doc(db, 'users', user.uid));
    currentUserDoc = snap.exists() ? snap.data() : {};
  } catch { currentUserDoc = {}; }

  const typeKey = currentUserDoc.type || 'user';
  const isSA    = isSAType(typeKey);
  const cfg     = ACCOUNT_TYPE_CONFIG[typeKey] || ACCOUNT_TYPE_CONFIG.user;
  const tier    = getAccountTier(typeKey);

  userRoleLabel.innerHTML = `
    Đăng nhập: <strong>${esc(currentUserDoc.displayName || user.email)}</strong>
    &nbsp;·&nbsp;
    <span class="tier-badge ${tier.toLowerCase()}" style="display:inline-flex;gap:4px;align-items:center;">
      <i class="bi ${cfg.icon}"></i>${esc(cfg.name)}
    </span>`;

  if (isSA) {
    composeBtn.classList.remove('d-none');
    saComposeArea.classList.remove('d-none');
  } else {
    userComposeArea.classList.remove('d-none');
    btnTypeServer.style.display = 'none';
    composeType = 'dm';
    btnTypeDM.classList.add('active');
    btnTypeServer.classList.remove('active');
  }

  renderMenuAuth();
  pageLoadingOverlay.style.display = 'none';
  mainContent.style.display = 'block';
  loginPrompt.style.display = 'none';

  subscribeServerMails();
  subscribeInboxMails();
  subscribeSentMails();
});

// ════════════════════════════════════════════════════════════════════
// TABS
// ════════════════════════════════════════════════════════════════════
tabServerBtn.addEventListener('click', () => switchTab('server'));
tabMineBtn.addEventListener('click',   () => switchTab('mine'));

function switchTab(tab) {
  currentTab = tab;
  tabServerBtn.classList.toggle('active', tab === 'server');
  tabMineBtn.classList.toggle('active',   tab === 'mine');
  panelServer.style.display = tab === 'server' ? 'block' : 'none';
  panelMine.style.display   = tab === 'mine'   ? 'block' : 'none';
}

subInboxBtn.addEventListener('click', () => switchSubTab('inbox'));
subSentBtn.addEventListener('click',  () => switchSubTab('sent'));

function switchSubTab(sub) {
  currentSubTab = sub;
  subInboxBtn.classList.toggle('active', sub === 'inbox');
  subSentBtn.classList.toggle('active',  sub === 'sent');
  inboxList.style.display = sub === 'inbox' ? 'flex' : 'none';
  sentList.style.display  = sub === 'sent'  ? 'flex' : 'none';
}

// ════════════════════════════════════════════════════════════════════
// REALTIME: THƯ SERVER
// ════════════════════════════════════════════════════════════════════
function subscribeServerMails() {
  if (unsubServerMails) unsubServerMails();
  renderSkeletons(serverMailList);

  // Không dùng orderBy để tránh failed-precondition — sort client-side
  unsubServerMails = onSnapshot(
    query(collection(db, 'mailbox_server'), limit(60)),
    snap => {
      const mails = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      badgeServer.textContent = mails.length;
      renderServerMails(mails);
    },
    err => { console.error('[MB] server mails:', err); serverEmpty.style.display = 'flex'; }
  );
}

function renderServerMails(mails) {
  serverMailList.innerHTML = '';
  if (!mails.length) { serverEmpty.style.display = 'flex'; return; }
  serverEmpty.style.display = 'none';
  const readSet = getReadSet('server');
  mails.forEach(mail => {
    const el = makeMailItem(mail, !readSet.has(mail.id), getPriorityConfig(mail.priority), 'server');
    el.addEventListener('click', () => openReadModal(mail, 'server'));
    serverMailList.appendChild(el);
  });
}

// ════════════════════════════════════════════════════════════════════
// REALTIME: INBOX
// NOTE: Không dùng orderBy trong query để tránh yêu cầu Composite Index
//       (failed-precondition). Sort được thực hiện ở client sau khi nhận data.
//       Để dùng orderBy server-side, tạo index tại:
//       Firebase Console → Firestore → Indexes → Composite
//       Collection: mailbox_dm | recipientUid ASC, createdAt DESC
// ════════════════════════════════════════════════════════════════════
function subscribeInboxMails() {
  if (!currentUser) return;
  if (unsubInboxMails) unsubInboxMails();
  renderSkeletons(inboxList);

  unsubInboxMails = onSnapshot(
    query(
      collection(db, 'mailbox_dm'),
      where('recipientUid', '==', currentUser.uid),
      limit(60)
      // orderBy('createdAt','desc') — bỏ để tránh failed-precondition khi chưa có index
    ),
    snap => {
      // Sort client-side: mới nhất lên trên
      const mails = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      const readSet = getReadSet('dm');
      const unread  = mails.filter(m => !readSet.has(m.id)).length;
      unreadBadge.style.display = unread > 0 ? 'inline-flex' : 'none';
      if (unread > 0) unreadCount.textContent = unread;
      badgeMine.textContent = unread || mails.length;
      renderInboxMails(mails);
    },
    err => {
      console.error('[MB] inbox:', err);
      if (err.code === 'failed-precondition') {
        console.warn(
          '[MB] Thiếu Composite Index cho mailbox_dm.\n' +
          'Tạo tại: Firebase Console → Firestore → Indexes → Composite\n' +
          'Collection: mailbox_dm | Fields: recipientUid (ASC), createdAt (DESC)'
        );
      }
      inboxEmpty.style.display = 'flex';
    }
  );
}

function renderInboxMails(mails) {
  inboxList.innerHTML = '';
  if (!mails.length) { inboxEmpty.style.display = 'flex'; return; }
  inboxEmpty.style.display = 'none';
  const readSet = getReadSet('dm');
  mails.forEach(mail => {
    const el = makeMailItem(mail, !readSet.has(mail.id), getPriorityConfig(mail.priority), 'dm-inbox');
    el.addEventListener('click', () => openReadModal(mail, 'dm'));
    inboxList.appendChild(el);
  });
}

// ════════════════════════════════════════════════════════════════════
// REALTIME: SENT
// Không dùng orderBy (tránh failed-precondition) — merge() sort client-side
// ════════════════════════════════════════════════════════════════════
function subscribeSentMails() {
  if (!currentUser) return;
  if (unsubSentMails) unsubSentMails();

  let serverSent = [], dmSent = [];
  const merge = () => {
    renderSentMails([...serverSent, ...dmSent].sort((a, b) =>
      (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
    ));
  };

  if (isSAType(currentUserDoc?.type || 'user')) {
    onSnapshot(
      query(collection(db, 'mailbox_server'), where('senderUid', '==', currentUser.uid), limit(30)),
      snap => { serverSent = snap.docs.map(d => ({ id: d.id, _type:'server', ...d.data() })); merge(); },
      err => { console.error('[MB] sent server:', err); }
    );
  }

  unsubSentMails = onSnapshot(
    query(collection(db, 'mailbox_dm'), where('senderUid', '==', currentUser.uid), limit(50)),
    snap => { dmSent = snap.docs.map(d => ({ id: d.id, _type:'dm', ...d.data() })); merge(); },
    err => { console.error('[MB] sent dm:', err); }
  );
}

function renderSentMails(mails) {
  sentList.innerHTML = '';
  if (!mails.length) { sentEmpty.style.display = 'flex'; return; }
  sentEmpty.style.display = 'none';
  mails.forEach(mail => {
    const isServer = mail._type === 'server';
    const el = document.createElement('div');
    el.className = 'mail-item';
    el.innerHTML = `
      <div class="mail-item-icon sent"><i class="bi ${isServer ? 'bi-globe2' : 'bi-send-fill'}"></i></div>
      <div class="mail-item-content">
        <div class="mail-item-header">
          <span class="mail-item-subject">${esc(mail.subject || '(Không tiêu đề)')}</span>
          ${isServer ? '<span class="tier-badge sa" style="font-size:.68rem;padding:1px 7px;">Toàn server</span>' : ''}
        </div>
        <div class="mail-item-sender">
          ${isServer
            ? '<i class="bi bi-megaphone me-1"></i>Gửi toàn bộ người dùng'
            : `<i class="bi bi-arrow-right me-1"></i>Đến: <strong>${esc(mail.recipientName || 'Ẩn danh')}</strong>`}
        </div>
        <div class="mail-item-preview">${esc((mail.body || '').substring(0, 90))}</div>
        <div class="mail-item-footer">
          <span class="mail-item-time"><i class="bi bi-clock me-1"></i>${fmtDate(mail.createdAt)}</span>
        </div>
      </div>`;
    el.addEventListener('click', () => openReadModal(mail, mail._type, true));
    sentList.appendChild(el);
  });
}

// ── Mail item factory ─────────────────────────────────────────────
function makeMailItem(mail, isUnread, pri, variant) {
  const el   = document.createElement('div');
  el.className = ['mail-item', isUnread ? 'unread' : '', pri.cls ? `priority-${pri.cls}` : ''].filter(Boolean).join(' ');
  const senderTier = variant === 'server' ? 'SA' : getAccountTier(mail.senderType || 'user');
  const iconV = pri.cls || (variant.startsWith('dm') ? 'dm' : 'server');
  const iconMap = { urgent:'bi-megaphone-fill', important:'bi-exclamation-circle-fill', server:'bi-globe2', dm:'bi-envelope-fill' };
  el.innerHTML = `
    <div class="mail-item-icon ${iconV}"><i class="bi ${iconMap[iconV] || 'bi-envelope-fill'}"></i></div>
    <div class="mail-item-content">
      <div class="mail-item-header">
        ${isUnread ? '<span class="mail-unread-dot"></span>' : ''}
        <span class="mail-item-subject">${esc(mail.subject || '(Không tiêu đề)')}</span>
        ${pri.badgeHtml}
      </div>
      <div class="mail-item-sender">
        <i class="bi bi-person me-1"></i>${esc(mail.senderName || 'Hệ thống')}
        &nbsp;${getTierBadgeHtml(senderTier)}
      </div>
      <div class="mail-item-preview">${esc((mail.body || '').substring(0, 90))}</div>
      <div class="mail-item-footer">
        <span class="mail-item-time"><i class="bi bi-clock me-1"></i>${fmtDate(mail.createdAt)}</span>
      </div>
    </div>`;
  return el;
}

// ════════════════════════════════════════════════════════════════════
// READ MODAL
// ════════════════════════════════════════════════════════════════════
function openReadModal(mail, type, isSent = false) {
  currentReadMail = { ...mail, _type: type, _isSent: isSent };
  const pri        = getPriorityConfig(mail.priority);
  const senderTier = type === 'server' ? 'SA' : getAccountTier(mail.senderType || 'user');
  const isSA       = isSAType(currentUserDoc?.type || 'user');

  readMailIcon.className = 'mail-modal-icon' + (pri.cls === 'urgent' ? ' urgent-icon' : pri.cls === 'important' ? ' important-icon' : '');
  readMailIcon.innerHTML = `<i class="bi ${pri.cls === 'urgent' ? 'bi-megaphone-fill' : 'bi-envelope-open-fill'}"></i>`;
  readMailSubjectEl.textContent = mail.subject || '(Không có tiêu đề)';

  const fromLabel = isSent
    ? `<i class="bi bi-arrow-right me-1"></i>Đến: <strong>${esc(mail.recipientName || 'Ẩn danh')}</strong>`
    : `<i class="bi bi-person me-1"></i>Từ: <strong>${esc(mail.senderName || 'Hệ thống')}</strong> ${getTierBadgeHtml(senderTier)}`;
  readMailMeta.innerHTML = `${fromLabel} &nbsp;·&nbsp; ${fmtDateFull(mail.createdAt)} ${pri.badgeHtml}`;
  readMailContent.textContent = mail.body || '';

  replyBtn.style.display    = (!isSent && type === 'dm') ? 'inline-flex' : 'none';
  const canDelete = isSA || isSent || (type === 'dm' && mail.recipientUid === currentUser?.uid);
  deleteMailBtn.style.display = canDelete ? 'inline-flex' : 'none';

  readMailModal.show();

  // Mark read (DM inbox only)
  if (!isSent && type === 'dm') markAsReadAPI(mail.id);
}

deleteMailBtn.addEventListener('click', async () => {
  if (!currentReadMail) return;
  deleteMailBtn.disabled = true;
  deleteMailBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>';
  try {
    await apiCall('DELETE', '/api/mail/delete', {
      mailId:     currentReadMail.id,
      collection: currentReadMail._type,
    });
    readMailModal.hide();
    showToast('Đã xóa thư ✓');
  } catch (e) {
    showToast(e.message || 'Lỗi khi xóa thư', true);
  } finally {
    deleteMailBtn.disabled = false;
    deleteMailBtn.innerHTML = '<i class="bi bi-trash3 me-1"></i>Xóa';
  }
});

replyBtn.addEventListener('click', () => {
  if (!currentReadMail) return;
  const mail = currentReadMail;
  readMailModal.hide();

  selectedRecipients = [{
    uid:       mail.senderUid,
    name:      mail.senderName     || 'Ẩn danh',
    tag:       mail.senderTag      || '',
    type:      mail.senderType     || 'user',
    avatarUrl: mail.senderAvatarUrl|| null,
  }];

  mailSubjectEl.value = mail.subject?.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject || ''}`;
  subjectCount.textContent = `${mailSubjectEl.value.length}/120`;
  mailBodyEl.value = '';
  bodyCount.textContent = '0/2000';
  composeError.classList.add('d-none');
  recipientInput.value = '';
  recipientResults.innerHTML = '';
  renderSelectedRecipients();
  setComposeType('dm');
  composeModalTitle.textContent = 'Trả lời thư';
  priorityArea.style.display = isSAType(currentUserDoc?.type || 'user') ? 'block' : 'none';
  composeModal.show();
});

async function markAsReadAPI(mailId) {
  const set = getReadSet('dm');
  set.add(mailId);
  saveReadSet('dm', set);
  try { await apiCall('POST', '/api/mail/mark-read', { mailId }); }
  catch (e) { console.warn('[MB] mark-read:', e.message); }
}

// ════════════════════════════════════════════════════════════════════
// COMPOSE
// ════════════════════════════════════════════════════════════════════
function openCompose(defaultType = 'server') {
  selectedRecipients = [];
  mailSubjectEl.value = '';
  mailBodyEl.value    = '';
  subjectCount.textContent = '0/120';
  bodyCount.textContent    = '0/2000';
  recipientResults.innerHTML = '';
  recipientInput.value = '';
  renderSelectedRecipients();
  composeError.classList.add('d-none');
  mailTypeSelector.style.display = isSAType(currentUserDoc?.type || 'user') ? 'grid' : 'none';
  setComposeType(defaultType);
  composeModalTitle.textContent = defaultType === 'server' ? 'Soạn thư toàn server' : 'Soạn thư riêng';
  composeModal.show();
}

function setComposeType(type) {
  composeType = type;
  btnTypeServer.classList.toggle('active', type === 'server');
  btnTypeDM.classList.toggle('active',     type === 'dm');
  recipientArea.style.display = type === 'dm' ? 'block' : 'none';
  priorityArea.style.display  = 'block';
}

composeBtn.addEventListener('click',       () => openCompose('server'));
composeServerBtn.addEventListener('click', () => openCompose('server'));
composeDMBtn.addEventListener('click',     () => openCompose('dm'));
btnTypeServer.addEventListener('click', () => { setComposeType('server'); composeModalTitle.textContent = 'Soạn thư toàn server'; });
btnTypeDM.addEventListener('click',     () => { setComposeType('dm');     composeModalTitle.textContent = 'Soạn thư riêng'; });

mailSubjectEl.addEventListener('input', () => subjectCount.textContent = `${mailSubjectEl.value.length}/120`);
mailBodyEl.addEventListener('input',    () => bodyCount.textContent    = `${mailBodyEl.value.length}/2000`);

// ── Recipient search ──────────────────────────────────────────────
recipientInput.addEventListener('input', () => {
  clearTimeout(recipientDebounce);
  const q = recipientInput.value.trim();
  if (q.length < 1) { recipientResults.innerHTML = ''; return; }
  recipientDebounce = setTimeout(() => searchRecipientsAPI(q), 420);
});

async function searchRecipientsAPI(q) {
  recipientResults.innerHTML = `
    <div class="list-loading">
      <div class="loading-spinner" style="width:18px;height:18px;border-width:2px;flex-shrink:0;"></div>
      <span>Đang tìm...</span>
    </div>`;
  try {
    const data = await apiCall('GET', `/api/mail/search-recipients?q=${encodeURIComponent(q)}`);
    renderRecipientResults(data.users || []);
  } catch (e) {
    const msg = e.message || 'Lỗi không xác định';
    // Nếu lỗi 401/network → fallback tìm trực tiếp Firestore
    if (msg.includes('401') || msg.includes('token') || msg.includes('fetch')) {
      await searchRecipientsFallback(q);
    } else {
      recipientResults.innerHTML = `
        <div class="recipient-error-msg">
          <i class="bi bi-exclamation-circle me-1"></i>${esc(msg)}
        </div>`;
    }
  }
}

function renderRecipientResults(users) {
  if (!users.length) {
    const isSA = isSAType(currentUserDoc?.type || 'user');
    recipientResults.innerHTML = `
      <div class="recipient-empty-msg">
        <i class="bi bi-person-x me-1"></i>
        ${isSA ? 'Không tìm thấy người dùng nào' : 'Không tìm thấy Tài khoản Bậc cao (SA)'}
      </div>`;
    return;
  }
  // Lọc ra những người đã được chọn rồi
  const alreadySelected = new Set(selectedRecipients.map(r => r.uid));

  recipientResults.innerHTML = users.map(u => {
    const avatar  = u.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=0D6EFD&color=fff&size=64`;
    // Fix @@tag: tagName đã là plain text, không có @, ta tự thêm 1 lần
    const tagDisplay = u.tagName ? `@${esc(u.tagName)}` : '';
    const isAdded = alreadySelected.has(u.uid);
    return `
      <div class="recipient-result-item ${isAdded ? 'already-added' : ''}"
        data-uid="${esc(u.uid)}" data-name="${esc(u.displayName)}"
        data-tag="${esc(u.tagName||'')}" data-type="${esc(u.type)}" data-avatar="${esc(avatar)}">
        <img src="${esc(avatar)}" class="recipient-result-avatar" alt="">
        <div style="flex:1;min-width:0;">
          <div class="recipient-result-name">${esc(u.displayName || 'Ẩn danh')}</div>
          <div class="recipient-result-tag">
            ${tagDisplay}
            &nbsp;${getTierBadgeHtml(u.tier || getAccountTier(u.type))}
          </div>
        </div>
        ${isAdded
          ? '<span class="recipient-added-check"><i class="bi bi-check-circle-fill"></i></span>'
          : '<span class="recipient-add-icon"><i class="bi bi-plus-circle"></i></span>'
        }
      </div>`;
  }).join('');

  recipientResults.querySelectorAll('.recipient-result-item:not(.already-added)').forEach(el => {
    el.addEventListener('click', () => {
      const newRecipient = {
        uid:       el.dataset.uid,
        name:      el.dataset.name,
        tag:       el.dataset.tag,
        type:      el.dataset.type,
        avatarUrl: el.dataset.avatar,
      };

      // Giới hạn: RA/LLA chỉ 1 người nhận; SA tối đa 10
      const isSA    = isSAType(currentUserDoc?.type || 'user');
      const maxRecip = isSA ? 10 : 1;

      if (selectedRecipients.length >= maxRecip) {
        if (!isSA) {
          // RA/LLA: thay thế luôn người nhận cũ
          selectedRecipients = [newRecipient];
        } else {
          setComposeError(`Tối đa ${maxRecip} người nhận.`);
          return;
        }
      } else {
        selectedRecipients.push(newRecipient);
      }

      recipientInput.value = '';
      recipientResults.innerHTML = '';
      renderSelectedRecipients();
    });
  });
}

// ── Fallback: tìm trực tiếp Firestore khi API không khả dụng ─────
async function searchRecipientsFallback(q) {
  try {
    const qLower  = q.toLowerCase().replace(/^@/, '');
    const isSA    = isSAType(currentUserDoc?.type || 'user');

    const queries = [
      getDocs(query(collection(db, 'users'), where('tagName', '>=', qLower), where('tagName', '<=', qLower + '\uf8ff'), limit(10))).catch(() => ({ docs: [] })),
      getDocs(query(collection(db, 'users'), where('displayName', '>=', q), where('displayName', '<=', q + '\uf8ff'), limit(10))).catch(() => ({ docs: [] })),
    ];

    // RA/LLA: fetch SA users trực tiếp
    if (!isSA) {
      SA_TYPES_CLIENT.forEach(t =>
        queries.push(getDocs(query(collection(db, 'users'), where('type', '==', t), limit(20))).catch(() => ({ docs: [] })))
      );
    }

    const snaps = await Promise.all(queries);
    const seen  = new Set();
    const users = [];

    snaps.forEach(snap => {
      snap.docs.forEach(d => {
        if (seen.has(d.id) || d.id === currentUser?.uid) return;
        const data = d.data();
        const tier = getAccountTier(data.type || 'user');
        if (!isSA && tier !== 'SA') return;

        const nameMatch = (data.displayName || '').toLowerCase().includes(qLower);
        const tagMatch  = (data.tagName     || '').toLowerCase().includes(qLower);
        if (!nameMatch && !tagMatch && isSA) return;

        seen.add(d.id);
        users.push({
          uid:         d.id,
          displayName: data.displayName || '',
          tagName:     data.tagName     || '',
          avatarUrl:   data.avatarUrl   || null,
          type:        data.type        || 'user',
          tier,
        });
      });
    });

    users.sort((a, b) => {
      if (a.tier === 'SA' && b.tier !== 'SA') return -1;
      if (a.tier !== 'SA' && b.tier === 'SA') return  1;
      return (a.displayName || '').localeCompare(b.displayName || '', 'vi');
    });

    renderRecipientResults(users.slice(0, 10));
  } catch (e) {
    recipientResults.innerHTML = `<div class="recipient-error-msg"><i class="bi bi-exclamation-circle me-1"></i>Không thể tìm kiếm</div>`;
  }
}

const SA_TYPES_CLIENT = ['admin', 'dev', 'operator', 'moderator'];

// ── Render danh sách người nhận đã chọn (multi) ───────────────────
function renderSelectedRecipients() {
  const container = $('selectedRecipientsList');
  const hint      = $('recipientCountHint');
  if (!container) return;

  // Update hint
  const isSA    = isSAType(currentUserDoc?.type || 'user');
  const maxRecip = isSA ? 10 : 1;
  if (hint) {
    hint.textContent = selectedRecipients.length > 0
      ? `(${selectedRecipients.length}/${maxRecip})`
      : isSA ? `(tối đa ${maxRecip} người)` : '';
  }

  if (!selectedRecipients.length) {
    container.innerHTML = '';
    container.classList.add('d-none');
    return;
  }

  container.classList.remove('d-none');
  container.innerHTML = selectedRecipients.map((u, idx) => {
    const tagDisplay = u.tag ? `@${esc(u.tag)}` : '';
    const tier = getAccountTier(u.type || 'user');
    return `
      <div class="selected-recipient-chip" data-idx="${idx}">
        <img src="${esc(u.avatarUrl||`https://ui-avatars.com/api/?name=${encodeURIComponent(u.name||'U')}&background=0D6EFD&color=fff&size=64`)}"
          alt="" class="chip-avatar">
        <div class="chip-info">
          <span class="chip-name">${esc(u.name || 'Ẩn danh')}</span>
          ${tagDisplay ? `<span class="chip-tag">${tagDisplay}</span>` : ''}
          ${getTierBadgeHtml(tier)}
        </div>
        <button class="chip-remove" data-idx="${idx}" title="Xóa người nhận">
          <i class="bi bi-x"></i>
        </button>
      </div>`;
  }).join('');

  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      selectedRecipients.splice(idx, 1);
      renderSelectedRecipients();
    });
  });
}

// ── Gửi thư ───────────────────────────────────────────────────────
sendMailBtn.addEventListener('click', sendMailViaAPI);

async function sendMailViaAPI() {
  composeError.classList.add('d-none');

  const subject  = mailSubjectEl.value.trim();
  const body     = mailBodyEl.value.trim();
  const priority = document.querySelector('input[name="priority"]:checked')?.value || 'normal';

  if (!subject) { setComposeError('Vui lòng nhập tiêu đề thư.'); return; }
  if (!body)    { setComposeError('Vui lòng nhập nội dung thư.'); return; }
  if (composeType === 'dm' && selectedRecipients.length === 0) {
    setComposeError('Vui lòng chọn ít nhất một người nhận.');
    return;
  }

  sendMailBtn.disabled = true;
  sendMailBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang gửi...';

  try {
    if (composeType === 'server') {
      // Gửi 1 thư toàn server
      const result = await apiCall('POST', '/api/mail/send', { type: 'server', subject, body, priority });
      composeModal.hide();
      showToast(result.message || 'Đã gửi thư toàn server ✓');
      switchTab('server');
    } else {
      // Gửi DM đến từng người nhận (tuần tự)
      const total   = selectedRecipients.length;
      let   success = 0;
      const errors  = [];

      for (const recip of selectedRecipients) {
        try {
          await apiCall('POST', '/api/mail/send', {
            type: 'dm', subject, body, priority,
            recipientUid: recip.uid,
          });
          success++;
        } catch (e) {
          errors.push(`${recip.name}: ${e.message}`);
        }
        // Update nút progress
        sendMailBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${success}/${total}`;
      }

      composeModal.hide();
      if (errors.length === 0) {
        showToast(total > 1 ? `Đã gửi thư đến ${total} người ✓` : 'Đã gửi thư riêng thành công ✓');
      } else if (success > 0) {
        showToast(`Gửi ${success}/${total} thành công, ${errors.length} thất bại`, true);
      } else {
        showToast('Gửi thư thất bại: ' + errors[0], true);
      }
      switchTab('mine');
      switchSubTab('sent');
    }
  } catch (e) {
    setComposeError(e.message || 'Lỗi khi gửi thư. Vui lòng thử lại.');
  } finally {
    sendMailBtn.disabled = false;
    sendMailBtn.innerHTML = '<i class="bi bi-send-fill me-1"></i>Gửi thư';
  }
}

function setComposeError(msg) {
  composeError.textContent = msg;
  composeError.classList.remove('d-none');
}

// ── Menu auth ─────────────────────────────────────────────────────
function renderMenuAuth() {
  const el = $('menuAuthArea');
  if (!el || !currentUser) return;
  const name   = currentUserDoc?.displayName || currentUser.email;
  const avatar = currentUserDoc?.avatarUrl   ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D6EFD&color=fff&size=64`;
  el.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2">
      <img src="${esc(avatar)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" alt="">
      <div>
        <div class="fw-semibold small">${esc(name)}</div>
        <div class="text-muted" style="font-size:.75rem;">${esc(currentUser.email||'')}</div>
      </div>
    </div>`;
}

console.log('[MailBox] v2.0 — Vercel API mode ✓');