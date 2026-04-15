// JS/profile.js — Relife Profile V3.3
// FIX 1: Search results displayed in modal (#profileSearchModal)
// FIX 2: profile-top-row layout: [avatar] [meta-block] [action-area RIGHT]
// FIX 3: Achievement frame unlock — elapsed time computed from userDoc.createdAt
// FIX 4: Email only shown in menu when viewing own profile (isOwner)
// FIX 5: Full comment features — reply, edit, delete, @mention, report
// FIX 6: Generated from profile.html V3.3 structure

import { initFirebase } from '../firebase-config.js';
import { applyFeatureFlags } from './featureFlags.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, getDocs, addDoc, setDoc, deleteDoc,
  updateDoc, serverTimestamp, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ═══════════════════════════════════════════════════════════
// FIREBASE INIT
// ═══════════════════════════════════════════════════════════
const db   = initFirebase();
const auth = getAuth();

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
const esc = s => String(s || '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const fmtDate = ts => {
  try {
    if (!ts?.toDate) return '';
    const d = ts.toDate(), now = new Date(), diff = now - d;
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000);
    if (m < 1)   return 'Vừa xong';
    if (m < 60)  return `${m} phút trước`;
    if (h < 24)  return `${h} giờ trước`;
    if (day < 7) return `${day} ngày trước`;
    return d.toLocaleDateString('vi-VN');
  } catch { return ''; }
};

// ══════════════════════════════════════════════════════════════
// ACCOUNT TIER SYSTEM
// ══════════════════════════════════════════════════════════════
// Tier SA  (Super Account)      rank ≥ 70  — quyền hạn cao
// Tier RA  (Regular Account)    rank 20-30 — tài khoản thường
// Tier LLA (Low-Level Account)  rank ≤ 10  — tài khoản bậc thấp

const ACCOUNT_TYPE_CONFIG = {
  // ── SA — Bậc cao ──────────────────────────────────────────
  admin:     { tier:'SA',  rank:100, name:'Admin',     icon:'bi-shield-fill-check', grad:'linear-gradient(135deg,#f59e0b,#d97706)', tip:'Quản trị viên',   canManage: true  },
  dev:       { tier:'SA',  rank: 90, name:'Dev',        icon:'bi-code-slash',        grad:'linear-gradient(135deg,#8b5cf6,#6d28d9)', tip:'Tài khoản phát triển', canManage: false },
  operator:  { tier:'SA',  rank: 80, name:'Vận hành',   icon:'bi-gear-fill',         grad:'linear-gradient(135deg,#0ea5e9,#0369a1)', tip:'Tài khoản vận hành',   canManage: false },
  moderator: { tier:'SA',  rank: 70, name:'Kiểm duyệt', icon:'bi-shield-fill',       grad:'linear-gradient(135deg,#6366f1,#4338ca)', tip:'Tài khoản kiểm duyệt', canManage: false },
  // ── RA — Thông thường ─────────────────────────────────────
  advanced:  { tier:'RA',  rank: 30, name:'Nâng cao',   icon:'bi-star-fill',         grad:'linear-gradient(135deg,#ec4899,#be185d)', tip:'Tài khoản nâng cao',   canManage: false },
  user:      { tier:'RA',  rank: 20, name:'Người dùng', icon:'bi-person-fill',       grad:'linear-gradient(135deg,#6b7280,#4b5563)', tip:'Người dùng thường',    canManage: false },
  // ── LLA — Bậc thấp ────────────────────────────────────────
  shared:    { tier:'LLA', rank: 10, name:'Dùng chung', icon:'bi-people-fill',       grad:'linear-gradient(135deg,#d97706,#92400e)', tip:'Tài khoản dùng chung', canManage: false },
  trial:     { tier:'LLA', rank:  5, name:'Thử nghiệm', icon:'bi-flask-fill',        grad:'linear-gradient(135deg,#14b8a6,#0f766e)', tip:'Tài khoản thử nghiệm', canManage: false },
};

// Backward-compat alias (BADGE_CONFIG used for display only)
const BADGE_CONFIG = ACCOUNT_TYPE_CONFIG;

// Get tier string for a type key
function getAccountTier(typeKey) {
  return ACCOUNT_TYPE_CONFIG[typeKey]?.tier || 'RA';
}

// Get rank number for a type key (higher = more privileged)
function getAccountRank(typeKey) {
  return ACCOUNT_TYPE_CONFIG[typeKey]?.rank ?? 20;
}

// Is this type a SA type?
function isSAType(typeKey) { return getAccountTier(typeKey) === 'SA'; }

// Can viewer (currentUser's userDoc) manage the target user's type?
// Returns true if viewer is allowed to set/change target's account type
function canViewerManageType(viewerDoc, targetDoc) {
  if (!viewerDoc || !targetDoc) return false;
  const vType = viewerDoc.type || 'user';
  const tType = targetDoc.type || 'user';
  // admin can manage anyone except cannot demote themselves
  if (vType === 'admin') return viewerDoc.uid !== targetDoc.uid || viewerDoc.uid !== targetDoc.uid;
  // Non-admin SA can manage RA and LLA only (not other SA)
  if (isSAType(vType) && !isSAType(tType)) return true;
  return false;
}

// Full canManageCheck including self-demotion guard
function canViewerChangeTypeTo(viewerDoc, targetDoc, newType) {
  if (!viewerDoc) return false;
  const vType = viewerDoc.type || 'user';
  // Only SA can change types
  if (!isSAType(vType)) return false;
  // Admin: can change anyone; but cannot set their own type to non-admin
  if (vType === 'admin') {
    if (viewerDoc.uid === targetDoc?.uid && newType !== 'admin') return false;
    return true;
  }
  // Non-admin SA: can only change RA/LLA targets
  const tType = targetDoc?.type || 'user';
  if (isSAType(tType)) return false;
  // Cannot set target to admin (only admin can)
  if (newType === 'admin') return false;
  // Non-admin SA cannot set target to SA
  if (isSAType(newType)) return false;
  return true;
}

// Returns array of badge configs for a user doc
function getUserBadges(u) {
  if (!u) return [];
  const badges = [];
  const typeKey = u.type || 'user';
  if (typeKey !== 'user' && ACCOUNT_TYPE_CONFIG[typeKey]) {
    badges.push(ACCOUNT_TYPE_CONFIG[typeKey]);
  }
  // Extra decorative labels (non-type, future use)
  if (Array.isArray(u.labels)) {
    u.labels.forEach(l => {
      if (l !== typeKey && ACCOUNT_TYPE_CONFIG[l]) badges.push(ACCOUNT_TYPE_CONFIG[l]);
    });
  }
  return badges;
}

// Render badges inline — collapse overflow into "+N"
function renderBadges(u, maxVisible = 2) {
  const badges = getUserBadges(u);
  if (!badges.length) return '';
  const visible = badges.slice(0, maxVisible);
  const hidden  = badges.slice(maxVisible);
  let html = visible.map(b =>
    `<span class="acct-badge" style="background:${b.grad}" title="${esc(b.tip)}">
       <i class="bi ${esc(b.icon)}"></i><span>${esc(b.name)}</span>
     </span>`).join('');
  if (hidden.length) {
    const tipList = hidden.map(b => b.tip).join(', ');
    html += `<span class="acct-badge acct-badge-more" title="${esc(tipList)}">+${hidden.length}</span>`;
  }
  return html;
}

function getAvatarUrl(profile, fallback) {
  return profile?.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fallback || 'U')}&background=0D6EFD&color=fff&size=128`;
}

function buildCoverStyle(settings) {
  if (!settings) return '';
  const sc = settings.scale      ?? 100;
  const tx = settings.translateX ?? 0;
  const ty = settings.translateY ?? 0;
  return `transform:scale(${sc / 100}) translate(${tx}px,${ty}px);transform-origin:center center;`;
}

function avatarTransformVars(settings) {
  const sc = (settings?.scale      ?? 100) / 100;
  const tx =  settings?.translateX ?? 0;
  const ty =  settings?.translateY ?? 0;
  return `--av-scale:${sc};--av-tx:${tx}px;--av-ty:${ty}px;`;
}

// Build avatar circle with frame + crop transform.
// Structure:
//   outer div (relative, no overflow:hidden — needed so frame bleed isn't clipped)
//     clip div  (circle clip via border-radius+overflow:hidden)
//       img     (avatar with transform)
//     frame img (absolute, inset:-2px — OUTSIDE clip so it never gets cut)
function buildAvatarWrap(profile, size = 40, clickUid = null) {
  if (!profile) profile = {};
  const src      = getAvatarUrl(profile, profile.displayName);
  const frameObj = getFrameById(profile.avatarFrame);
  const sc   = (profile.avatarSettings?.scale      ?? 100) / 100;
  // translateX/Y stored in px relative to 100px preview — scale proportionally for every size
  const ratio = size / 100;
  const tx   = (profile.avatarSettings?.translateX ?? 0) * ratio;
  const ty   = (profile.avatarSettings?.translateY ?? 0) * ratio;
  const avVars = `--av-scale:${sc};--av-tx:${tx}px;--av-ty:${ty}px;`;
  const bleed  = 3;
  const outer  = size + bleed * 2;
  // object-fit:contain so SVG frame border is never cropped
  const frameHtml = frameObj?.image
    ? `<img src="${esc(frameObj.image)}" style="position:absolute;inset:-${bleed}px;width:${outer}px;height:${outer}px;object-fit:contain;pointer-events:none;z-index:2;" alt="">`
    : '';
  const clickAttr = clickUid ? `onclick="window.navigateToProfile('${esc(clickUid)}')" ` : '';
  return `<div class="av-wrap" ${clickAttr}style="${avVars}position:relative;width:${size}px;height:${size}px;flex-shrink:0;${clickUid ? 'cursor:pointer;' : ''}">` +
           `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;position:relative;z-index:1;">` +
             `<img src="${esc(src)}" class="profile-avatar-img" style="width:100%;height:100%;" alt="avatar">` +
           `</div>` +
           frameHtml +
         `</div>`;
}

// ─── Avatar frames resolver ───────────────────────────────
let _avatarFramesCache = null;
function getAvatarFrames() {
  if (_avatarFramesCache) return _avatarFramesCache;
  // window.AVATAR_FRAMES is set synchronously by avatar_frames_data.js
  // which loads before this ES module. Always read from window.
  if (window.AVATAR_FRAMES) {
    _avatarFramesCache = window.AVATAR_FRAMES;
    return _avatarFramesCache;
  }
  return null;
}

// Wait up to 3 s for avatar_frames_data.js to expose window.AVATAR_FRAMES
function waitForAvatarFrames(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (window.AVATAR_FRAMES) { resolve(window.AVATAR_FRAMES); return; }
    const start = Date.now();
    const id = setInterval(() => {
      if (window.AVATAR_FRAMES) {
        clearInterval(id);
        _avatarFramesCache = window.AVATAR_FRAMES;
        resolve(window.AVATAR_FRAMES);
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(id);
        reject(new Error('avatar_frames_data.js did not load in time'));
      }
    }, 50);
  });
}
function getAllFramesList() {
  const af = getAvatarFrames();
  if (!af) return [];
  return [...(af.free || []), ...(af.special || [])];
}
function getFrameById(id) {
  return getAllFramesList().find(f => f.id === id) || null;
}

function getFrameByRequirement(reqKey) {
  return getAllFramesList().find(f => f.requirement === reqKey) || null;
}

// ─── FIX 3: Frame unlock based on elapsed time ───────────
const MS = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
const THRESHOLDS = {
  '1_day':    MS.day,       '1_week':   MS.week,
  '1_month':  MS.month,     '1_year':   MS.year,
  '2_years':  2 * MS.year,  '3_years':  3 * MS.year,
  '4_years':  4 * MS.year,  '5_years':  5 * MS.year,
  '10_years': 10 * MS.year
};

function isFrameUnlocked(frame, createdAt) {
  if (!frame || frame.type === 'free') return true;
  // Use window.checkFrameUnlock if provided by avatar_frames_data.js
  if (typeof window.checkFrameUnlock === 'function') {
    return window.checkFrameUnlock(frame.id, { _createdAt: createdAt });
  }
  const req = frame.requirement;
  if (!req || !THRESHOLDS[req] || !createdAt) return false;
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return elapsed >= THRESHOLDS[req];
}

// ═══════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════
const profileArea         = document.getElementById('profileArea');
const profileSearchInput  = document.getElementById('profileSearchInput');
const profileSearchResults= document.getElementById('profileSearchResults');
const profileClearSearch  = document.getElementById('profileClearSearch');
const menuToggleBtn       = document.getElementById('menuToggleBtn');
const profileMenuCanvas   = document.getElementById('profileMenuCanvas');
const menuAuthAreaProfile = document.getElementById('menuAuthAreaProfile');
const openAchievementsBtn = document.getElementById('openAchievementsBtn');
const openVisitorsBtn     = document.getElementById('openVisitorsBtn');
const visitorsListEl      = document.getElementById('visitorsList');

// ─── Bootstrap modal helpers ─────────────────────────────
function getModal(id) {
  const el = document.getElementById(id);
  if (!el) return { show() {}, hide() {} };
  return bootstrap.Modal.getOrCreateInstance(el);
}
const commentsModal     = { show: () => getModal('profileCommentsModal').show(), hide: () => getModal('profileCommentsModal').hide() };
const loginModalProfile = { show: () => getModal('loginModalProfile').show(),    hide: () => getModal('loginModalProfile').hide() };
const postEditorModal   = { show: () => getModal('postEditorModal').show(),      hide: () => getModal('postEditorModal').hide() };
const profileEditModal  = { show: () => getModal('profileEditModal').show(),     hide: () => getModal('profileEditModal').hide() };
const avatarFrameModal  = { show: () => getModal('avatarFrameModal').show(),     hide: () => getModal('avatarFrameModal').hide() };
const achievementsModal = { show: () => getModal('achievementsModal').show(),    hide: () => getModal('achievementsModal').hide() };
const searchModal       = { show: () => getModal('profileSearchModal').show(),   hide: () => getModal('profileSearchModal').hide() };

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let currentUser          = null;
let profileUid           = null;
let userDoc              = null;
let isOwner              = false;
let postsUnsub           = null;
let commentsUnsub        = null;
let lastPostsDocs        = [];
let currentCommentsPostId= null;
let quillEditor          = null;

// ── Global user profile cache (uid → {displayName, avatarUrl, avatarFrame, avatarSettings, tagName, type, labels}) ──
// All display code reads from here; never from post.displayName / comment.displayName
const _userCache = {};

async function getUserProfile(uid) {
  if (!uid) return null;
  if (_userCache[uid]) return _userCache[uid];
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      _userCache[uid] = { uid, ...snap.data() };
    } else {
      _userCache[uid] = { uid, displayName: 'Người dùng', avatarUrl: null };
    }
  } catch (_) {
    _userCache[uid] = { uid, displayName: 'Người dùng', avatarUrl: null };
  }
  return _userCache[uid];
}

function invalidateUserCache(uid) {
  delete _userCache[uid];
}

// Batch pre-warm cache for a list of uids
async function prewarmUserCache(uids) {
  const missing = [...new Set(uids)].filter(id => id && !_userCache[id]);
  await Promise.all(missing.map(uid => getUserProfile(uid)));
}

// Comment interaction state
let profileCurrentReplyTo      = null;
let profileCurrentReportId     = null;
let profileCurrentEditingId    = null;

// Frame picker state
let selectedFrameId    = null;
let isLoadingProfile   = false;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
const params = new URLSearchParams(location.search);
profileUid = params.get('user') || null;

menuToggleBtn?.addEventListener('click', () =>
  new bootstrap.Offcanvas(profileMenuCanvas).toggle());

window.addEventListener('beforeunload', () => { if (postsUnsub) postsUnsub(); });

onAuthStateChanged(auth, async user => {
  currentUser = user;
  await applyFeatureFlags('profile');
  const targetUid = profileUid || (user ? user.uid : null);
  if (!targetUid) {
    profileArea.innerHTML = `<div class="text-center p-4">
      <div class="mb-3">Bạn chưa đăng nhập.</div>
      <a class="btn btn-primary btn-rounded" href="index.html">Về trang chủ</a></div>`;
    return;
  }
  if (!profileUid) profileUid = targetUid;
  loadProfile(targetUid);
});

// ═══════════════════════════════════════════════════════════
// LOAD PROFILE
// ═══════════════════════════════════════════════════════════
async function loadProfile(uid) {
  if (isLoadingProfile) return;
  isLoadingProfile = true;
  try {
    profileArea.innerHTML = `<div class="text-center text-muted py-5">
      <div class="spinner-border spinner-border-sm me-2"></div>Đang tải...</div>`;

    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      profileArea.innerHTML = `<div class="text-center p-4 text-danger">Không tìm thấy người dùng.</div>`;
      return;
    }
    userDoc = { id: snap.id, ...snap.data() };
    isOwner = !!(currentUser && currentUser.uid === uid);

    renderProfile(uid);
    subscribeFollowerCounts(uid);
    subscribePosts(uid);

    // Record visitor (non-owner, best-effort)
    if (currentUser && currentUser.uid !== uid) {
      try {
        let vProf = null;
        try { const vs = await getDoc(doc(db, 'users', currentUser.uid)); if (vs.exists()) vProf = vs.data(); } catch (_) {}
        await setDoc(doc(db, 'users', uid, 'visitors', currentUser.uid), {
          userId: currentUser.uid,
          displayName: vProf?.displayName || currentUser.displayName || null,
          tagName:     vProf?.tagName     || null,
          avatarUrl:   vProf?.avatarUrl   || currentUser.photoURL   || null,
          lastVisitedAt: serverTimestamp()
        }, { merge: true });
      } catch (e) { console.warn('visitor record failed', e); }
    }
  } catch (err) {
    console.error('loadProfile error', err);
    profileArea.innerHTML = `<div class="text-center p-4 text-danger">Lỗi khi tải hồ sơ.</div>`;
  } finally {
    isLoadingProfile = false;
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER PROFILE — FIX 2: correct top-row layout
// ═══════════════════════════════════════════════════════════
function renderProfile(uid) {
  const u = userDoc;

  // ── Cover ──
  const coverUrl = u.coverPhotoUrl || '';
  const coverImgHtml = coverUrl
    ? `<img class="cover-img" src="${esc(coverUrl)}" style="${buildCoverStyle(u.coverPhotoSettings || {})}" alt="cover">`
    : `<div class="cover-placeholder"><i class="bi bi-panorama"></i></div>`;
  const coverEditBtn = isOwner
    ? `<button class="cover-edit-btn" id="coverEditBtn"><i class="bi bi-camera-fill"></i> Đổi ảnh bìa</button>
       ${coverUrl ? `<button class="cover-view-btn" onclick="window.profileViewImage('${esc(coverUrl)}')"><i class="bi bi-eye-fill"></i></button>` : ''}`
    : '';

  // ── Avatar ──
  const avatarSrc   = getAvatarUrl(u, u.displayName);
  const avVars      = avatarTransformVars(u.avatarSettings);
  const frameData   = getFrameById(u.avatarFrame);
  const frameHtml   = frameData?.image
    ? `<img class="profile-avatar-frame" src="${esc(frameData.image)}" alt="">`
    : '';
  const avatarEditBtns = isOwner ? `
    <button class="avatar-action-btn" id="avatarEditBtn"      title="Đổi ảnh đại diện"><i class="bi bi-camera-fill"></i></button>
    <button class="avatar-action-btn" id="avatarFrameEditBtn" title="Đổi khung"><i class="bi bi-circle-square"></i></button>` : '';

  // ── FIX 2: action-area rendered OUTSIDE meta-block, as sibling ──
  // Will be filled in by renderFollowActionArea() after mount
  const actionAreaHtml = `<div class="profile-action-area" id="profileActionArea"></div>`;

  const viewCoverBtn = coverUrl
    ? `<button class="cover-view-btn" onclick="window.profileViewImage('${esc(coverUrl)}')"><i class="bi bi-eye-fill"></i></button>`
    : '';
  profileArea.innerHTML = `
    <div class="profile-cover-banner">
      ${coverImgHtml}
      ${coverEditBtn}
      ${viewCoverBtn}
    </div>

    <div class="profile-info-area">

      <!-- FIX 2: top-row = [avatar] [meta-block flex-fill] [action-area flex-shrink-0] -->
      <div class="profile-top-row">

        <!-- Avatar -->
        <div class="profile-avatar-outer" style="${avVars}">
          <div class="profile-avatar-clip" title="Xem ảnh đại diện" style="cursor:zoom-in"
               onclick="window.profileViewImage('${esc(u.avatarUrl || avatarSrc)}')">
            <img class="profile-avatar-img" src="${esc(avatarSrc)}" alt="avatar"
                 onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName||'U')}&background=0D6EFD&color=fff&size=128'">
          </div>
          ${frameHtml}
          ${avatarEditBtns}
        </div>

        <!-- Meta block: name, tag, follow stats -->
        <div class="profile-meta-block">
          <div class="profile-display-name d-flex align-items-center flex-wrap gap-2">
            <span>${esc(u.displayName || 'Người dùng')}</span>
            ${renderBadges(u, 3)}
          </div>
          ${u.tagName ? `<div class="profile-tag-name">${u.tagName.startsWith('@') ? esc(u.tagName) : '@' + esc(u.tagName)}</div>` : ''}
          <div class="profile-follow-stats" id="profileFollowStats">
            <button class="follow-stat-btn" id="followersCount">0</button>
            <span class="small-muted"> người theo dõi</span>
            <span class="follow-stat-sep">·</span>
            <button class="follow-stat-btn" id="followingCount">0</button>
            <span class="small-muted"> đang theo dõi</span>
            ${(u.fullName || u.gender || u.birthday || u.country || (u.socialLinks && Object.values(u.socialLinks).some(v => v)))
              ? `<span class="follow-stat-sep">·</span>
                 <button class="btn-xem-them" id="btnXemThem">Xem thêm <i class="bi bi-chevron-down"></i></button>`
              : ''}
          </div>
        </div>

        <!-- FIX 2: Action buttons at far right — NOT inside meta-block -->
        ${actionAreaHtml}

      </div><!-- /.profile-top-row -->

      <!-- Bio -->
      ${u.bio ? `<div class="profile-bio mt-2 ql-editor" style="padding:0;border:none;">${u.bio}</div>` : ''}

      <!-- Posts section -->
      <div class="profile-posts mt-3">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <h6 class="mb-0 fw-bold">Bài viết của ${esc(u.displayName || '')}</h6>
          <div id="ownerControls"></div>
        </div>
        <div id="userPostsList"><div class="text-muted py-3 text-center">Đang tải bài viết...</div></div>
      </div>

    </div><!-- /.profile-info-area -->
  `;

  // Owner wiring
  if (isOwner) {
    document.getElementById('ownerControls').innerHTML = `
      <button id="btnAddPost" class="btn btn-sm btn-primary btn-rounded">
        <i class="bi bi-plus-lg me-1"></i>Thêm bài viết
      </button>`;
    document.getElementById('btnAddPost')?.addEventListener('click', openAddPostEditor);
    document.getElementById('coverEditBtn')?.addEventListener('click', () => openEditModal('cover'));
    document.getElementById('avatarEditBtn')?.addEventListener('click', () => openEditModal('avatar'));
    document.getElementById('avatarFrameEditBtn')?.addEventListener('click', openFramePicker);
    openVisitorsBtn.style.display = 'block';
  } else {
    openVisitorsBtn.style.display = 'none';
  }

  document.getElementById('btnXemThem')?.addEventListener('click', openProfileInfoModal);

  renderFollowActionArea(uid);
  renderMenuAuthArea();
}

// ═══════════════════════════════════════════════════════════
// FIX 2: FOLLOW ACTION AREA — always in .profile-action-area
// ═══════════════════════════════════════════════════════════
async function renderFollowActionArea(profileId) {
  const area = document.getElementById('profileActionArea');
  if (!area) return;
  area.innerHTML = '';

  if (isOwner) {
    area.innerHTML = `
      <button id="btnEditProfile" class="btn btn-sm btn-outline-primary btn-rounded">
        <i class="bi bi-pencil-square me-1"></i>Chỉnh sửa
      </button>`;
    document.getElementById('btnEditProfile')?.addEventListener('click', () => openEditModal());
    return;
  }

  if (!currentUser) {
    area.innerHTML = `
      <button class="btn btn-sm btn-primary btn-rounded" id="btnLoginFollow">
        <i class="bi bi-person-plus-fill me-1"></i>Theo dõi
      </button>`;
    document.getElementById('btnLoginFollow')?.addEventListener('click', () => loginModalProfile.show());
    return;
  }

  try {
    const fSnap = await getDoc(doc(db, 'users', profileId, 'followers', currentUser.uid));
    const following = fSnap.exists();
    area.innerHTML = following
      ? `<button class="btn btn-sm btn-outline-secondary btn-rounded" id="btnUnfollow">
           <i class="bi bi-check-lg me-1"></i>Đang theo dõi
         </button>`
      : `<button class="btn btn-sm btn-primary btn-rounded" id="btnFollow">
           <i class="bi bi-person-plus-fill me-1"></i>Theo dõi
         </button>`;
    document.getElementById('btnFollow')?.addEventListener('click',   () => doFollow(profileId));
    document.getElementById('btnUnfollow')?.addEventListener('click', () => doUnfollow(profileId));
  } catch (err) {
    console.warn('renderFollowActionArea error', err);
  }
}

async function doFollow(profileId) {
  if (!currentUser) { loginModalProfile.show(); return; }
  const followerRef = doc(db, 'users', profileId, 'followers', currentUser.uid);
  const followingRef= doc(db, 'users', currentUser.uid, 'following', profileId);
  try {
    let myProf = null;
    try { const s = await getDoc(doc(db, 'users', currentUser.uid)); if (s.exists()) myProf = s.data(); } catch(_) {}
    await setDoc(followerRef, {
      userId: currentUser.uid,
      displayName: myProf?.displayName || null,
      tagName:     myProf?.tagName     || null,
      avatarUrl:   myProf?.avatarUrl   || null,
      createdAt: serverTimestamp()
    });
    await setDoc(followingRef, {
      userId: profileId,
      displayName: userDoc?.displayName || null,
      avatarUrl:   userDoc?.avatarUrl   || null,
      createdAt: serverTimestamp()
    });
    renderFollowActionArea(profileId);
  } catch (err) {
    console.error('doFollow error', err);
    alert('Không thể theo dõi. Vui lòng thử lại.');
    try { await deleteDoc(followerRef); } catch (_) {}
  }
}

async function doUnfollow(profileId) {
  if (!currentUser) return;
  try { await deleteDoc(doc(db, 'users', currentUser.uid, 'following', profileId)); } catch (_) {}
  try { await deleteDoc(doc(db, 'users', profileId, 'followers', currentUser.uid)); } catch (_) {}
  renderFollowActionArea(profileId);
}

function subscribeFollowerCounts(uid) {
  try {
    onSnapshot(collection(db, 'users', uid, 'followers'), snap => {
      const el = document.getElementById('followersCount');
      if (el) el.textContent = snap.size;
    }, err => console.warn('followers snap', err));
    onSnapshot(collection(db, 'users', uid, 'following'), snap => {
      const el = document.getElementById('followingCount');
      if (el) el.textContent = snap.size;
    }, err => console.warn('following snap', err));
  } catch (e) { console.warn('subscribeFollowerCounts failed', e); }
}

// ═══════════════════════════════════════════════════════════
// FIX 4: MENU AUTH AREA — email only for isOwner
// ═══════════════════════════════════════════════════════════
function renderMenuAuthArea() {
  if (!menuAuthAreaProfile) return;
  const u = userDoc;

  if (currentUser && u) {
    const av = getAvatarUrl(u, u.displayName);
    // FIX 4: Only show email line when viewing own profile
    const emailLine = isOwner
      ? `<div class="menu-auth-email">${esc(currentUser.email || '')}</div>`
      : '';
    menuAuthAreaProfile.innerHTML = `
      <div class="menu-auth-card">
        ${buildAvatarWrap(u, 40)}
        <div>
          <div class="menu-auth-name d-flex align-items-center gap-2 flex-wrap">
            <span>${esc(u.displayName || currentUser.email)}</span>
            ${renderBadges(u, 2)}
          </div>
          ${emailLine}
        </div>
      </div>
      <div class="mt-2">
        ${isOwner
          ? `<button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded btn-sm">Đăng xuất</button>`
          : `<a href="profile.html?user=${encodeURIComponent(currentUser.uid)}" class="btn btn-outline-primary w-100 btn-rounded btn-sm">Hồ sơ của tôi</a>`
        }
      </div>`;
    document.getElementById('btnLogoutProfile')?.addEventListener('click', async () => {
      await signOut(auth);
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  } else if (currentUser) {
    menuAuthAreaProfile.innerHTML = `
      <div class="menu-auth-card">
        <div class="menu-auth-name">${esc(currentUser.email || '')}</div>
      </div>
      <div class="mt-2">
        <button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded btn-sm">Đăng xuất</button>
      </div>`;
    document.getElementById('btnLogoutProfile')?.addEventListener('click', async () => {
      await signOut(auth);
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  } else {
    menuAuthAreaProfile.innerHTML = `
      <div class="d-grid">
        <button id="openLoginProfile" class="btn btn-primary btn-rounded">Đăng nhập</button>
      </div>`;
    document.getElementById('openLoginProfile')?.addEventListener('click', () => {
      loginModalProfile.show();
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════
const PROFILE_POSTS_PER_PAGE = 10;
let profilePostsPage = 0;

function subscribePosts(uid) {
  if (postsUnsub) { postsUnsub(); postsUnsub = null; }
  const postsQ = query(collection(db, 'posts'), where('userId', '==', uid), orderBy('createdAt', 'desc'));
  postsUnsub = onSnapshot(postsQ, snap => {
    lastPostsDocs = snap.docs;
    profilePostsPage = 0;
    renderProfilePage();
  }, err => {
    console.error('subscribePosts error', err);
    const el = document.getElementById('userPostsList');
    if (el) el.innerHTML = '<div class="text-muted py-3 text-center">Không thể tải bài viết.</div>';
  });
}

async function renderProfilePage() {
  const end   = (profilePostsPage + 1) * PROFILE_POSTS_PER_PAGE;
  const slice = lastPostsDocs.slice(0, end);
  await renderPostsSnapshot(slice);

  // Load more button
  const listEl = document.getElementById('userPostsList');
  if (!listEl) return;
  document.getElementById('profileLoadMoreBtn')?.remove();
  if (end < lastPostsDocs.length) {
    const btn = document.createElement('div');
    btn.id = 'profileLoadMoreBtn';
    btn.style.cssText = 'text-align:center;padding:16px 0;';
    btn.innerHTML = '<button class="btn btn-outline-secondary btn-sm btn-rounded" style="min-width:160px"><i class="bi bi-arrow-down-circle me-1"></i>Xem thêm bài viết</button>';
    listEl.after(btn);
    btn.querySelector('button').addEventListener('click', () => {
      profilePostsPage++;
      renderProfilePage();
    });
  }
}

async function fetchCommentCounts(postIds) {
  const counts = {};
  await Promise.all(postIds.map(async id => {
    try { const s = await getDocs(collection(db, 'posts', id, 'comments')); counts[id] = s.size; }
    catch (_) { counts[id] = 0; }
  }));
  return counts;
}

async function renderPostsSnapshot(docs) {
  const listEl = document.getElementById('userPostsList');
  if (!listEl) return;
  if (!docs.length) {
    listEl.innerHTML = `<div class="text-muted py-3 text-center">Người dùng chưa có bài viết nào.</div>`;
    return;
  }
  const commentCounts = await fetchCommentCounts(docs.map(d => d.id));
  const frag = document.createDocumentFragment();

  // Always read from userCache (not from post.displayName)
  if (userDoc && profileUid) _userCache[profileUid] = { uid: profileUid, ...userDoc };
  const u = await getUserProfile(profileUid) || {};
  const cardBadgesHtml = renderBadges(u, 2);
  const tagName = u.tagName ? `<div class="post-author-tag">${u.tagName.startsWith('@') ? esc(u.tagName) : '@' + esc(u.tagName)}</div>` : '';

  docs.forEach(docSnap => {
    const d = docSnap.data(), id = docSnap.id;
    const commentCount = commentCounts[id] || d.commentsCount || 0;
    const hashtagsHtml = (d.hashtags || []).map(t =>
      `<a class="post-hashtag" href="tag.html?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join('');

    // 3-dot owner menu (hidden for non-owners)
    const ownerMenu = isOwner ? `
      <div class="post-owner-menu">
        <button class="btn-post-more" title="Tùy chọn"><i class="bi bi-three-dots-vertical"></i></button>
        <div class="post-more-dropdown">
          <button class="btn-edit-post"><i class="bi bi-pencil-fill me-2"></i>Sửa bài</button>
          <button class="btn-delete-post text-danger"><i class="bi bi-trash-fill me-2"></i>Xóa bài</button>
        </div>
      </div>` : '';

    const card = document.createElement('div');
    card.className = 'card-post';
    card.setAttribute('data-post-id', id);
    card.innerHTML = `
      <!-- Author header -->
      <div class="post-header">
        ${buildAvatarWrap(u, 40, u.uid || profileUid)}
        <div class="post-author-info">
          <div class="post-author-name d-flex align-items-center flex-wrap gap-1">
            <span>${esc(u.displayName || 'Người dùng')}</span>
            ${cardBadgesHtml}
          </div>
          ${tagName}
          <div class="post-time">${fmtDate(d.createdAt)}</div>
        </div>
        ${ownerMenu}
      </div>

      <!-- Title -->
      <a class="card-post-title text-decoration-none" href="post.html?id=${id}">
        ${esc(d.title || '(Không tiêu đề)')}
      </a>

      <!-- Hashtags -->
      ${hashtagsHtml ? `<div class="post-hashtags mt-1">${hashtagsHtml}</div>` : ''}

      <!-- Actions -->
      <div class="post-actions mt-2">
        <button class="post-action-btn btn-like" data-reaction="like">
          <i class="bi bi-hand-thumbs-up"></i><span class="like-count">${d.likes || 0}</span>
        </button>
        <button class="post-action-btn btn-dislike dislike" data-reaction="dislike">
          <i class="bi bi-hand-thumbs-down"></i><span class="dislike-count">${d.dislikes || 0}</span>
        </button>
        <button class="post-action-btn btn-comment-open">
          <i class="bi bi-chat-dots"></i><span>${commentCount}</span>
        </button>
        <a class="post-action-btn view-btn ms-auto" href="post.html?id=${id}">
          <i class="bi bi-box-arrow-up-right"></i>Xem
        </a>
      </div>`;

    // Events
    card.querySelector('.btn-like')?.addEventListener('click', e => { e.stopPropagation(); toggleReaction(id, 'like', card); });
    card.querySelector('.btn-dislike')?.addEventListener('click', e => { e.stopPropagation(); toggleReaction(id, 'dislike', card); });
    card.querySelector('.btn-comment-open')?.addEventListener('click', e => { e.stopPropagation(); openCommentsModal(id, d.title || ''); });
    card.querySelector('.btn-edit-post')?.addEventListener('click',   e => { e.preventDefault(); openEditPost(id); });
    card.querySelector('.btn-delete-post')?.addEventListener('click', e => { e.preventDefault(); confirmDeletePost(id); });

    // 3-dot toggle
    card.querySelector('.btn-post-more')?.addEventListener('click', e => {
      e.stopPropagation();
      const dd = card.querySelector('.post-more-dropdown');
      document.querySelectorAll('.post-more-dropdown.show').forEach(el => { if (el !== dd) el.classList.remove('show'); });
      dd?.classList.toggle('show');
    });

    frag.appendChild(card);
  });

  listEl.innerHTML = '';
  listEl.appendChild(frag);

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.post-more-dropdown.show').forEach(el => el.classList.remove('show'));
  }, { once: true });

  // Re-apply search filter if active
  const kw = profileSearchInput?.value.trim();
  if (kw) filterPostsByKeyword(kw);
}

// ── Reaction ─────────────────────────────────────────────
async function toggleReaction(postId, reaction, cardEl) {
  if (!currentUser) { loginModalProfile.show(); return; }
  const likeRef = doc(db, 'posts', postId, 'likes', currentUser.uid);
  const postRef = doc(db, 'posts', postId);
  try {
    const likeSnap = await getDoc(likeRef);
    const batch = writeBatch(db);
    if (!likeSnap.exists()) {
      batch.set(likeRef, { userId: currentUser.uid, type: reaction, createdAt: serverTimestamp() });
      batch.update(postRef, { [reaction === 'like' ? 'likes' : 'dislikes']: increment(1) });
    } else {
      const prev = likeSnap.data().type;
      if (prev === reaction) {
        batch.delete(likeRef);
        batch.update(postRef, { [reaction === 'like' ? 'likes' : 'dislikes']: increment(-1) });
      } else {
        batch.update(likeRef, { type: reaction, updatedAt: serverTimestamp() });
        batch.update(postRef, reaction === 'like'
          ? { likes: increment(1), dislikes: increment(-1) }
          : { dislikes: increment(1), likes: increment(-1) });
      }
    }
    const [lb, db2] = [cardEl.querySelector('.btn-like'), cardEl.querySelector('.btn-dislike')];
    if (lb) lb.disabled = true; if (db2) db2.disabled = true;
    try { await batch.commit(); }
    catch (err) { console.error('reaction failed', err); alert('Không thể cập nhật phản hồi.'); }
    finally { if (lb) lb.disabled = false; if (db2) db2.disabled = false; }
  } catch (err) { console.error('toggleReaction error', err); }
}

// ── Post editor ──────────────────────────────────────────
function ensureQuill() {
  if (quillEditor) return;
  const el = document.getElementById('editorQuill');
  if (!el) return;
  quillEditor = new Quill('#editorQuill', {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ font: [] }, { size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'video', 'code-block'],
        ['clean']
      ]
    },
    placeholder: 'Nội dung bài viết...'
  });
}

function openAddPostEditor() {
  ensureQuill();
  document.getElementById('postEditorTitle').textContent = 'Viết bài mới';
  document.getElementById('postTitleInput').value     = '';
  document.getElementById('postHashtagsInput').value  = '';
  if (quillEditor) quillEditor.root.innerHTML = '';
  getOrCreateHiddenPostId().value = '';
  postEditorModal.show();
}

async function openEditPost(postId) {
  ensureQuill();
  try {
    const pSnap = await getDoc(doc(db, 'posts', postId));
    if (!pSnap.exists()) { alert('Bài viết không tồn tại.'); return; }
    const p = pSnap.data();
    document.getElementById('postEditorTitle').textContent  = 'Chỉnh sửa bài';
    document.getElementById('postTitleInput').value         = p.title || '';
    document.getElementById('postHashtagsInput').value      = (p.hashtags || []).join(' ');
    if (quillEditor) quillEditor.root.innerHTML = p.content || '';
    getOrCreateHiddenPostId().value = postId;
    postEditorModal.show();
  } catch (e) { console.error('openEditPost', e); alert('Không thể mở bài.'); }
}

function getOrCreateHiddenPostId() {
  let el = document.getElementById('editorPostId');
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden'; el.id = 'editorPostId';
    document.getElementById('postEditorModal')?.querySelector('.modal-body')?.appendChild(el);
  }
  return el;
}

document.getElementById('savePostBtn')?.addEventListener('click', async () => {
  if (!currentUser) return;
  const title    = (document.getElementById('postTitleInput')?.value || '').trim();
  const hashRaw  = document.getElementById('postHashtagsInput')?.value || '';
  const hashtags = hashRaw.split(/[, ]+/).map(s => s.trim()).filter(Boolean)
    .map(s => s.startsWith('#') ? s : '#' + s);
  const content  = quillEditor?.root.innerHTML || '';
  const postId   = document.getElementById('editorPostId')?.value || null;
  try {
    if (postId) {
      await updateDoc(doc(db, 'posts', postId), { title, content, hashtags, updatedAt: serverTimestamp() });
    } else {
      const uSnap = await getDoc(doc(db, 'users', currentUser.uid));
      const profile = uSnap.exists() ? uSnap.data() : {};
      await addDoc(collection(db, 'posts'), {
        displayName: profile.displayName || currentUser.email,
        title, content, hashtags,
        likes: 0, dislikes: 0, commentsCount: 0,
        createdAt: serverTimestamp(),
        userId: currentUser.uid, authorTag: profile.tagName || null
      });
    }
    postEditorModal.hide();
  } catch (e) { console.error('savePost error', e); alert('Không thể lưu bài.'); }
});

async function confirmDeletePost(postId) {
  if (!confirm('Bạn có chắc muốn xóa bài này?')) return;
  try { await deleteDoc(doc(db, 'posts', postId)); }
  catch (e) { console.error('deletePost', e); alert('Không thể xóa bài.'); }
}

// ═══════════════════════════════════════════════════════════
// FIX 1: SEARCH — results in modal
// ═══════════════════════════════════════════════════════════
let searchDebounce = null;

profileSearchInput?.addEventListener('input', ev => {
  const kw = ev.target.value.trim();
  profileClearSearch && (profileClearSearch.style.display = kw ? 'block' : 'none');
  clearTimeout(searchDebounce);
  if (!kw) {
    profileSearchResults.style.display = 'none';
    renderProfilePage(); // restore all
    return;
  }
  searchDebounce = setTimeout(() => {
    filterPostsByKeyword(kw);
  }, 280);
});

profileClearSearch?.addEventListener('click', () => {
  profileSearchInput.value = '';
  profileClearSearch.style.display = 'none';
  profileSearchResults.style.display = 'none';
  renderProfilePage();
});

document.addEventListener('click', e => {
  if (!profileSearchInput?.contains(e.target) && !profileSearchResults?.contains(e.target)) {
    if (profileSearchResults) profileSearchResults.style.display = 'none';
  }
});

profileSearchInput?.addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    const kw = profileSearchInput.value.trim();
    if (kw) filterPostsByKeyword(kw);
  }
});

function openSearchModal(keyword) {
  const kw  = keyword.toLowerCase();
  const matches = lastPostsDocs.filter(d => {
    const p = d.data();
    return (p.title || '').toLowerCase().includes(kw) ||
           (p.content ? (new DOMParser().parseFromString(p.content, 'text/html').body.textContent || '').toLowerCase().includes(kw) : false) ||
           (p.hashtags || []).some(h => h.toLowerCase().includes(kw));
  });

  document.getElementById('profileSearchKeywordDisplay').textContent = `Từ khoá: "${keyword}" — ${matches.length} kết quả`;

  const container = document.getElementById('profileSearchModalResults');
  if (!matches.length) {
    container.innerHTML = `<div class="no-results"><i class="bi bi-search fs-3 d-block mb-2"></i>Không tìm thấy bài viết nào.</div>`;
  } else {
    container.innerHTML = matches.map(d => {
      const p = d.data();
      const snippet = p.content
        ? (new DOMParser().parseFromString(p.content, 'text/html').body.textContent || '').slice(0, 100) + '…'
        : '';
      return `<div class="search-result-item" data-post-id="${d.id}">
        <div class="result-title">${esc(p.title || '(Không tiêu đề)')}</div>
        <div class="result-snippet">${esc(snippet)}</div>
        <div class="mt-1">${(p.hashtags || []).map(t => `<span class="post-hashtag">${esc(t)}</span>`).join('')}</div>
      </div>`;
    }).join('');
    container.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const postId = item.dataset.postId;
        searchModal.hide();
        const cardEl = document.getElementById(`post-card-${postId}`) ||
          [...document.querySelectorAll('.card-post')].find(c => c.dataset.postId === postId);
        if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else window.location.href = `post.html?id=${postId}`;
      });
    });
  }
  searchModal.show();
}

function filterPostsByKeyword(keyword) {
  const kw = keyword.toLowerCase();
  // Filter cards inline
  document.querySelectorAll('#userPostsList .card-post').forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(kw) ? '' : 'none';
  });

  // Show dropdown results
  const resultsEl = document.getElementById('profileSearchResults');
  if (!resultsEl) return;

  const matches = (lastPostsDocs || []).filter(d => {
    const p = d.data ? d.data() : d;
    return (p.title || '').toLowerCase().includes(kw)
        || (p.hashtags || []).some(h => h.toLowerCase().includes(kw))
        || (p.content ? new DOMParser().parseFromString(p.content, 'text/html').body.textContent.toLowerCase().includes(kw) : false);
  });

  if (!matches.length) {
    resultsEl.innerHTML = `<div class="search-result-item text-muted"><i class="bi bi-search me-2"></i>Không tìm thấy bài viết nào cho "<strong>${esc(keyword)}</strong>"</div>`;
  } else {
    resultsEl.innerHTML = matches.slice(0, 8).map(d => {
      const p = d.data ? d.data() : d;
      const id = d.id || d.id;
      return `<div class="search-result-item" data-post-id="${esc(id)}">
        <div class="fw-semibold small">${esc(p.title || '(Không tiêu đề)')}</div>
        <div class="small text-muted">${(p.hashtags || []).map(t => `<span class="post-hashtag" style="font-size:.72rem">${esc(t)}</span>`).join(' ')}</div>
      </div>`;
    }).join('');
    resultsEl.querySelectorAll('.search-result-item[data-post-id]').forEach(item => {
      item.addEventListener('click', () => {
        const postId = item.dataset.postId;
        resultsEl.style.display = 'none';
        const cardEl = document.querySelector(`.card-post[data-post-id="${postId}"]`);
        if (cardEl) { cardEl.style.display = ''; cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    });
  }
  resultsEl.style.display = 'block';
}

// ═══════════════════════════════════════════════════════════
// FIX 5: COMMENTS MODAL — full feature set
// ═══════════════════════════════════════════════════════════
let currentCommentsPostAuthorId = null;

async function openCommentsModal(postId, title) {
  currentCommentsPostId = postId;
  profileCurrentReplyTo     = null;
  profileCurrentEditingId   = null;

  const titleEl = document.getElementById('profileCommentsTitle');
  if (titleEl) titleEl.innerHTML = `<i class="bi bi-chat-dots-fill me-2"></i>${esc(title || 'Bình luận')}`;

  document.getElementById('profileCommentsList').innerHTML =
    '<div class="text-muted py-3 text-center"><div class="spinner-border spinner-border-sm me-2"></div>Đang tải...</div>';

  // Reply indicator reset
  const replyInd = document.getElementById('profileReplyIndicator');
  if (replyInd) replyInd.style.display = 'none';

  if (!currentUser) {
    document.getElementById('profileMustLoginToComment').style.display = '';
    document.getElementById('profileCommentBoxArea').style.display     = 'none';
    document.getElementById('openLoginFromProfileComment').onclick = e => { e.preventDefault(); loginModalProfile.show(); };
  } else {
    document.getElementById('profileMustLoginToComment').style.display = 'none';
    document.getElementById('profileCommentBoxArea').style.display     = '';
    try {
      const udoc = await getDoc(doc(db, 'users', currentUser.uid));
      const prof = udoc.exists() ? udoc.data() : null;
      const av   = getAvatarUrl(prof, prof?.displayName || currentUser.email);
      // Warm cache with fresh profile data
      if (prof) { _userCache[currentUser.uid] = { uid: currentUser.uid, ...prof }; }
      const ciProfile = await getUserProfile(currentUser.uid) || {};
      const ciAdmin   = renderBadges(ciProfile, 2);
      document.getElementById('profileCommenterInfo').innerHTML = `
        <div class="d-flex gap-2 align-items-center">
          ${buildAvatarWrap(ciProfile, 36)}
          <span class="fw-bold small">${esc(ciProfile.displayName || currentUser.email)}</span>
          ${ciAdmin}
        </div>`;
    } catch (_) {}
  }

  // Set post author ID for "Tác giả" badge in comments
  // On profile page, all posts belong to the profile owner
  currentCommentsPostAuthorId = profileUid;

  subscribeToComments(postId);
  commentsModal.show();
}

// Reply indicator wiring
document.getElementById('profileCancelReply')?.addEventListener('click', () => {
  profileCurrentReplyTo = null;
  const ind = document.getElementById('profileReplyIndicator');
  if (ind) ind.style.display = 'none';
});

// Comment textarea — @mention autocomplete
const commentTextarea = document.getElementById('profileCommentText');
commentTextarea?.addEventListener('input', handleMentionInput);

// Post comment
document.getElementById('profilePostCommentBtn')?.addEventListener('click', postComment);

async function postComment() {
  const textarea = document.getElementById('profileCommentText');
  const text = textarea?.value.trim();
  if (!text) return;
  if (!currentUser) { loginModalProfile.show(); return; }

  try {
    const udoc = await getDoc(doc(db, 'users', currentUser.uid));
    const prof = udoc.exists() ? udoc.data() : null;
    const mentions = extractMentions(text);
    const mentionedIds = await resolveMentions(mentions);

    const commentData = {
      displayName: prof?.displayName || currentUser.email,
      avatarUrl:   prof?.avatarUrl   || null,
      userId:      currentUser.uid,
      text,
      createdAt:   serverTimestamp(),
      mentions:    mentionedIds,
      reportCount: 0
    };
    if (profileCurrentReplyTo) {
      commentData.replyTo     = profileCurrentReplyTo.id;
      commentData.replyToName = profileCurrentReplyTo.name;
    }

    await addDoc(collection(db, 'posts', currentCommentsPostId, 'comments'), commentData);

    // Best-effort increment
    try { await updateDoc(doc(db, 'posts', currentCommentsPostId), { commentsCount: increment(1) }); } catch (_) {}

    if (textarea) textarea.value = '';
    profileCurrentReplyTo = null;
    const ind = document.getElementById('profileReplyIndicator');
    if (ind) ind.style.display = 'none';
  } catch (err) {
    console.error('postComment error', err);
    alert('Không thể gửi bình luận: ' + (err.message || err));
  }
}

// Subscribe & render comments
function subscribeToComments(postId) {
  if (commentsUnsub) commentsUnsub();
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
  let timer = null;
  commentsUnsub = onSnapshot(q, snap => {
    clearTimeout(timer);
    timer = setTimeout(() => renderComments(snap.docs, currentCommentsPostAuthorId), 200);
  }, err => console.error('commentsUnsub error', err));
}

async function renderComments(docs, postAuthorId = null) {
  const listEl = document.getElementById('profileCommentsList');
  if (!listEl) return;
  if (!docs.length) {
    listEl.innerHTML = '<div class="text-muted py-3 text-center">Chưa có bình luận nào.</div>';
    return;
  }

  const all = docs.map(d => ({ id: d.id, ...d.data() }));
  const replyMap = new Map();
  const topLevel = [];

  all.forEach(c => {
    if (c.replyTo) {
      if (!replyMap.has(c.replyTo)) replyMap.set(c.replyTo, []);
      replyMap.get(c.replyTo).push(c);
    } else {
      topLevel.push(c);
    }
  });

  // Warm global userCache for all commenters (single pass)
  if (userDoc && profileUid) _userCache[profileUid] = { uid: profileUid, ...userDoc };
  const uniqueUids = [...new Set(all.map(c => c.userId))];
  await prewarmUserCache(uniqueUids);
  // Build userInfoCache as view into _userCache (for backward compat with buildCommentEl)
  const userInfoCache = {};
  uniqueUids.forEach(uid => { if (_userCache[uid]) userInfoCache[uid] = _userCache[uid]; });

  const frag = document.createDocumentFragment();
  topLevel.forEach(c => renderCommentWithCollapse(frag, c, replyMap, 0, postAuthorId, userInfoCache));
  // Orphans
  all.filter(c => c.replyTo && !all.find(p => p.id === c.replyTo))
     .forEach(c => renderCommentWithCollapse(frag, c, replyMap, 1, postAuthorId, userInfoCache));

  listEl.innerHTML = '';
  listEl.appendChild(frag);
}

function renderCommentWithCollapse(container, comment, replyMap, depth, postAuthorId, userInfoCache = {}) {
  const replies = replyMap.get(comment.id) || [];
  const hasReplies = replies.length > 0;

  container.appendChild(buildCommentEl(comment, depth, hasReplies, replies.length, postAuthorId, userInfoCache));

  if (hasReplies) {
    const repliesDiv = document.createElement('div');
    repliesDiv.className = 'profile-replies-container';
    repliesDiv.id = `profile-replies-${comment.id}`;
    repliesDiv.style.display = 'none';
    replies.forEach(r => renderCommentWithCollapse(repliesDiv, r, replyMap, Math.min(depth + 1, 5), postAuthorId, userInfoCache));
    container.appendChild(repliesDiv);
  }
}

window.profileToggleReplies = function(commentId) {
  const container = document.getElementById(`profile-replies-${commentId}`);
  const btn       = document.getElementById(`profile-toggle-${commentId}`);
  if (!container || !btn) return;
  const isHidden  = container.style.display === 'none';
  container.style.display = isHidden ? '' : 'none';
  const count = container.querySelectorAll('.comment-item').length;
  btn.innerHTML = isHidden
    ? '<i class="bi bi-chevron-up"></i><span>Ẩn phản hồi</span>'
    : `<i class="bi bi-chevron-down"></i><span>Xem ${count} phản hồi</span>`;
  btn.classList.toggle('expanded', isHidden);
};

window.profileScrollToComment = function(commentId) {
  const el = document.getElementById(`profile-comment-${commentId}`);
  if (!el) return;
  // Expand any collapsed parents
  let parent = el.closest('.profile-replies-container');
  while (parent) {
    if (parent.style.display === 'none') {
      parent.style.display = '';
      const pid = parent.id.replace('profile-replies-', '');
      const toggleBtn = document.getElementById(`profile-toggle-${pid}`);
      if (toggleBtn) { toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i><span>Ẩn phản hồi</span>'; toggleBtn.classList.add('expanded'); }
    }
    parent = parent.parentElement?.closest('.profile-replies-container');
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 2000);
};

function buildCommentEl(comment, depth, hasReplies = false, replyCount = 0, postAuthorId = null, userInfoCache = {}) {
  const isOwnComment = currentUser && currentUser.uid === comment.userId;
  // Get commenter's full profile from cache (populated during renderComments)
  const _commenterInfo = userInfoCache[comment.userId] || {};
  // Always use cached profile data (not stale comment.displayName/avatarUrl)
  const av = _commenterInfo.avatarUrl || getAvatarUrl(_commenterInfo, comment.displayName);
  const commenterDisplayName = _commenterInfo.displayName || comment.displayName || 'Ẩn danh';
  const isReported = (comment.reportCount || 0) >= 3;
  const levelClass = depth > 0 ? ` reply reply-level-${Math.min(depth, 5)}` : '';
  const reportedClass = isReported ? ' reported' : '';

  const replyToHtml = comment.replyTo && comment.replyToName
    ? `<div class="reply-to-badge" onclick="window.profileScrollToComment('${comment.replyTo}')"><i class="bi bi-reply-fill"></i><span>Phản hồi ${esc(comment.replyToName)}</span></div>`
    : '';

  const displayText = parseMentions(comment.text || '', comment.mentions || []);
  const editedBadge = comment.editedAt
    ? `<span class="edited-badge"><i class="bi bi-pencil-fill"></i> Đã chỉnh sửa</span>`
    : '';
  const reportBadge = isReported
    ? `<span class="report-badge"><i class="bi bi-flag-fill"></i> ${comment.reportCount} báo cáo</span>`
    : '';

  let actionsHtml = `<div class="comment-actions">
    <button class="comment-action-btn" onclick="window.profileSetReplyTo('${comment.id}','${esc(comment.displayName)}')">
      <i class="bi bi-reply-fill"></i><span>Trả lời</span>
    </button>`;
  if (isOwnComment) {
    actionsHtml += `
    <button class="comment-action-btn" onclick="window.profileEditComment('${comment.id}')">
      <i class="bi bi-pencil-fill"></i><span>Sửa</span>
    </button>
    <button class="comment-action-btn delete" onclick="window.profileDeleteComment('${comment.id}')">
      <i class="bi bi-trash-fill"></i><span>Xóa</span>
    </button>`;
  } else {
    actionsHtml += `
    <button class="comment-action-btn delete" onclick="window.profileOpenReport('${comment.id}')">
      <i class="bi bi-flag-fill"></i><span>Báo cáo</span>
    </button>`;
  }
  actionsHtml += '</div>';

  const el = document.createElement('div');
  const isAuthor  = postAuthorId && comment.userId === postAuthorId;
  const authorBadge = isAuthor
    ? `<span class="author-badge"><i class="bi bi-patch-check-fill"></i> Tác giả</span>` : '';
  // Account badges from userInfoCache
  const commenterBadgesHtml = _commenterInfo.type
    ? renderBadges(_commenterInfo, 2) : '';

  const toggleRepliesHtml = hasReplies
    ? `<button class="toggle-replies" id="profile-toggle-${comment.id}"
         onclick="window.profileToggleReplies('${comment.id}')">
         <i class="bi bi-chevron-down"></i><span>Xem ${replyCount} phản hồi</span>
       </button>` : '';

  el.className = `comment-item${levelClass}${reportedClass}`;
  el.id = `profile-comment-${comment.id}`;
  el.dataset.commentData = JSON.stringify({ text: comment.text || '', mentions: comment.mentions || [] });

  el.innerHTML = `
    ${buildAvatarWrap(_commenterInfo.uid ? _commenterInfo : {avatarUrl: av, avatarFrame: _commenterInfo.avatarFrame, avatarSettings: _commenterInfo.avatarSettings}, 36, comment.userId)}
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-name" onclick="window.navigateToProfile('${comment.userId}')">${esc(commenterDisplayName)}</span>
        ${authorBadge}${commenterBadgesHtml}${editedBadge}${reportBadge}
        <span class="comment-time">${fmtDate(comment.createdAt)}</span>
      </div>
      ${replyToHtml}
      <div class="comment-text">${displayText}</div>
      ${actionsHtml}
      ${toggleRepliesHtml}
    </div>`;
  return el;
}

// ── @Mention ──────────────────────────────────────────────
function extractMentions(text) {
  return [...(text.matchAll(/@(\w+)/g))].map(m => m[1]);
}

async function resolveMentions(tags) {
  const ids = [];
  for (const tag of tags) {
    try {
      const q = query(collection(db, 'users'), where('tagName', '==', tag));
      const s = await getDocs(q);
      if (!s.empty) ids.push(s.docs[0].id);
    } catch (_) {}
  }
  return ids;
}

function parseMentions(text, mentionIds) {
  return esc(text).replace(/@(\w+)/g, (match, tag) =>
    `<a class="mention-link" onclick="window.navigateToProfile('${tag}')" href="javascript:void(0)">@${esc(tag)}</a>`
  );
}

async function handleMentionInput(ev) {
  const textarea = ev.target;
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const before = val.substring(0, pos);
  const atMatch = before.match(/@(\w*)$/);

  const dropdown = document.getElementById('profileMentionDropdown');
  if (!dropdown) return;

  if (!atMatch) { dropdown.classList.remove('show'); return; }
  const query2 = atMatch[1].toLowerCase();
  if (query2.length < 1) { dropdown.classList.remove('show'); return; }

  try {
    const q = query(collection(db, 'users'), where('tagName', '>=', query2), where('tagName', '<=', query2 + '\uf8ff'));
    const snap = await getDocs(q);
    if (snap.empty) { dropdown.classList.remove('show'); return; }

    dropdown.innerHTML = snap.docs.slice(0, 6).map(d => {
      const u = d.data();
      const av = getAvatarUrl(u, u.displayName);
      return `<div class="mention-item" data-tagname="${esc(u.tagName || '')}">
        <img src="${esc(av)}" alt="">
        <div>
          <div class="mention-item-name">${esc(u.displayName || '')}</div>
          <div class="mention-item-tag">@${esc(u.tagName || '')}</div>
        </div>
      </div>`;
    }).join('');

    // Position dropdown relative to textarea
    const rect = textarea.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    dropdown.style.width = Math.min(rect.width, 260) + 'px';
    dropdown.classList.add('show');

    dropdown.querySelectorAll('.mention-item').forEach(item => {
      item.addEventListener('click', () => {
        const tagName = item.dataset.tagname;
        const text = textarea.value;
        const atPos = before.lastIndexOf('@');
        textarea.value = text.substring(0, atPos) + '@' + tagName + ' ' + text.substring(pos);
        textarea.focus();
        dropdown.classList.remove('show');
      });
    });
  } catch (err) { console.error('mention search error', err); }
}

document.addEventListener('click', e => {
  const dd = document.getElementById('profileMentionDropdown');
  if (dd && !dd.contains(e.target) && e.target !== commentTextarea) {
    dd.classList.remove('show');
  }
});

// ── Reply ─────────────────────────────────────────────────
window.profileSetReplyTo = function(commentId, displayName) {
  profileCurrentReplyTo = { id: commentId, name: displayName };
  const ind = document.getElementById('profileReplyIndicator');
  const nm  = document.getElementById('profileReplyToName');
  if (ind && nm) {
    nm.textContent = `Đang trả lời ${displayName}`;
    ind.style.display = 'flex';
  }
  document.getElementById('profileCommentText')?.focus();
};

// ── Edit ─────────────────────────────────────────────────
window.profileEditComment = function(commentId) {
  const commentEl = document.getElementById(`profile-comment-${commentId}`);
  if (!commentEl) return;
  const data = JSON.parse(commentEl.dataset.commentData || '{}');

  if (profileCurrentEditingId === commentId) return;
  if (profileCurrentEditingId) {
    document.getElementById(`profile-edit-form-${profileCurrentEditingId}`)?.remove();
  }
  profileCurrentEditingId = commentId;

  const form = document.createElement('div');
  form.id = `profile-edit-form-${commentId}`;
  form.className = 'edit-comment-form';
  form.innerHTML = `
    <textarea class="edit-textarea" id="profile-edit-ta-${commentId}"
      placeholder="@username để gắn tag...">${esc(data.text || '')}</textarea>
    <div class="edit-buttons">
      <button class="btn-save" onclick="window.profileSaveEdit('${commentId}')">
        <i class="bi bi-check-lg"></i> Lưu
      </button>
      <button class="btn-cancel-edit" onclick="window.profileCancelEdit('${commentId}')">Hủy</button>
    </div>`;

  commentEl.querySelector('.comment-text')?.after(form);
  const ta = document.getElementById(`profile-edit-ta-${commentId}`);
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
};

window.profileCancelEdit = function(commentId) {
  document.getElementById(`profile-edit-form-${commentId}`)?.remove();
  if (profileCurrentEditingId === commentId) profileCurrentEditingId = null;
};

window.profileSaveEdit = async function(commentId) {
  const ta = document.getElementById(`profile-edit-ta-${commentId}`);
  const text = ta?.value.trim();
  if (!text) { alert('Bình luận không được để trống.'); return; }
  try {
    const mentions = extractMentions(text);
    const ids = await resolveMentions(mentions);
    await updateDoc(doc(db, 'posts', currentCommentsPostId, 'comments', commentId), {
      text, mentions: ids, editedAt: serverTimestamp(), editCount: increment(1)
    });
    window.profileCancelEdit(commentId);
  } catch (err) {
    console.error('saveEdit error', err);
    alert('Không thể cập nhật bình luận.');
  }
};

// ── Delete ────────────────────────────────────────────────
window.profileDeleteComment = async function(commentId) {
  if (!currentUser) return;
  if (!confirm('Xóa bình luận này? (Tất cả phản hồi cũng sẽ bị xóa)')) return;
  try {
    const allSnap = await getDocs(collection(db, 'posts', currentCommentsPostId, 'comments'));
    const all = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const target = all.find(c => c.id === commentId);
    if (!target) { alert('Không tìm thấy bình luận.'); return; }
    if (target.userId !== currentUser.uid) { alert('Bạn chỉ có thể xóa bình luận của mình.'); return; }

    // Find all nested replies recursively
    function collectReplies(pid) {
      const direct = all.filter(c => c.replyTo === pid);
      return direct.reduce((acc, r) => [...acc, r, ...collectReplies(r.id)], []);
    }
    const toDelete = [target, ...collectReplies(commentId)];
    const batch = writeBatch(db);
    toDelete.forEach(c => batch.delete(doc(db, 'posts', currentCommentsPostId, 'comments', c.id)));
    await batch.commit();
  } catch (err) {
    console.error('deleteComment error', err);
    alert('Không thể xóa bình luận.');
  }
};

// ── Report ────────────────────────────────────────────────
window.profileOpenReport = function(commentId) {
  profileCurrentReportId = commentId;
  document.getElementById('profileReportOverlay')?.classList.add('show');
  document.getElementById('profileReportModal')?.classList.add('show');
};

window.profileCloseReportModal = function() {
  profileCurrentReportId = null;
  document.getElementById('profileReportOverlay')?.classList.remove('show');
  document.getElementById('profileReportModal')?.classList.remove('show');
};

window.profileSubmitReport = async function() {
  if (!profileCurrentReportId) return;
  if (!currentUser) { alert('Bạn cần đăng nhập để báo cáo.'); return; }
  const reasonEl = document.querySelector('input[name="profileReportReason"]:checked');
  const reason = reasonEl ? reasonEl.value : 'other';
  try {
    const reportRef = doc(db, 'posts', currentCommentsPostId, 'comments', profileCurrentReportId, 'reports', currentUser.uid);
    const existing = await getDoc(reportRef);
    if (existing.exists()) { alert('Bạn đã báo cáo bình luận này rồi.'); window.profileCloseReportModal(); return; }
    const batch = writeBatch(db);
    batch.set(reportRef, { userId: currentUser.uid, reason, createdAt: serverTimestamp() });
    batch.set(doc(db, 'posts', currentCommentsPostId, 'comments', profileCurrentReportId),
      { reportCount: increment(1) }, { merge: true });
    await batch.commit();
    alert('Đã gửi báo cáo. Cảm ơn bạn!');
    window.profileCloseReportModal();
  } catch (err) {
    console.error('submitReport error', err);
    alert('Không thể gửi báo cáo.');
  }
};

document.getElementById('profileReportOverlay')?.addEventListener('click', window.profileCloseReportModal);

// ── Scroll to comment ─────────────────────────────────────
window.scrollToComment = function(commentId) {
  const el = document.getElementById(`profile-comment-${commentId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('highlight');
  setTimeout(() => el.classList.remove('highlight'), 2200);
};

// ═══════════════════════════════════════════════════════════
// FIX 3: ACHIEVEMENTS MODAL
// ═══════════════════════════════════════════════════════════
openAchievementsBtn?.addEventListener('click', () => {
  renderAchievementGroups();
  achievementsModal.show();
});

document.getElementById('groupCompanionship')?.addEventListener('click', () => {
  document.getElementById('achievementGroupList').style.display = 'none';
  document.getElementById('achievementDetailCompanionship').style.display = '';
  renderCompanionshipDetail();
});

document.getElementById('backToGroupsBtn')?.addEventListener('click', () => {
  document.getElementById('achievementGroupList').style.display = '';
  document.getElementById('achievementDetailCompanionship').style.display = 'none';
});

function getCreatedAt() {
  if (!userDoc) return null;
  if (userDoc.createdAt?.toDate) return userDoc.createdAt.toDate();
  if (userDoc.createdAt) return new Date(userDoc.createdAt);
  return null;
}

function renderAchievementGroups() {
  document.getElementById('achievementGroupList').style.display = '';
  document.getElementById('achievementDetailCompanionship').style.display = 'none';

  const createdAt = getCreatedAt();
  const elapsed   = createdAt ? (Date.now() - createdAt.getTime()) : 0;
  const summaryEl = document.getElementById('companionshipSummary');
  if (summaryEl) {
    if (!createdAt) {
      summaryEl.innerHTML = `<span class="text-muted small">Chưa có dữ liệu</span>`;
    } else {
      const days  = Math.floor(elapsed / MS.day);
      const years = Math.floor(elapsed / MS.year);
      summaryEl.innerHTML = `<span class="badge bg-primary bg-opacity-10 text-primary small fw-semibold">
        ${years > 0 ? `${years} năm` : `${days} ngày`} đồng hành
      </span>`;
    }
  }
}

function renderCompanionshipDetail() {
  const container = document.getElementById('achievementsContainer');
  if (!container) return;

  const createdAt = getCreatedAt();
  const elapsed   = createdAt ? (Date.now() - createdAt.getTime()) : 0;

  const milestones = [
    { key: '1_day',    label: '1 Ngày',    target: MS.day,        style: '' },
    { key: '1_week',   label: '1 Tuần',    target: MS.week,       style: '' },
    { key: '1_month',  label: '1 Tháng',   target: MS.month,      style: '' },
    { key: '1_year',   label: '1 Năm',     target: MS.year,       style: 'big',  frameReq: '1_year'  },
    { key: '2_years',  label: '2 Năm',     target: 2*MS.year,     style: 'big',  frameReq: '2_years' },
    { key: '3_years',  label: '3 Năm',     target: 3*MS.year,     style: 'big',  frameReq: '3_years' },
    { key: '5_years',  label: '5 Năm',     target: 5*MS.year,     style: 'hero', frameReq: '5_years' },
    { key: '10_years', label: '10 Năm',    target: 10*MS.year,    style: 'hero', frameReq: '10_years'},
    { key: 'infinite', label: '∞ Đồng hành', target: Infinity,   style: 'hero' }
  ];

  container.innerHTML = '';

  milestones.forEach(ms => {
    const colDiv = document.createElement('div');
    colDiv.className = 'col-12 col-md-6 col-xl-4';

    let pct = 0, subtitle = '', completed = false;

    if (!createdAt) {
      pct = 0; subtitle = 'Chưa có dữ liệu';
    } else if (ms.key === 'infinite') {
      const years = Math.floor(elapsed / MS.year);
      const intoYear = elapsed - years * MS.year;
      pct = (intoYear / MS.year) * 100;
      subtitle = `Đã đồng hành ${years} năm — tiến trình năm tiếp theo: ${Math.round(pct)}%`;
    } else {
      pct = Math.min(100, (elapsed / ms.target) * 100);
      completed = pct >= 100;
      subtitle = completed ? 'Hoàn thành!' : `${Math.round(pct)}% đạt mốc ${ms.label}`;
    }

    // Build reward box
    let frameRewardHtml = '';
    if (ms.frameReq) {
      const rf = getFrameByRequirement(ms.frameReq); // frameReq is requirement key, not frame id
      if (rf) {
        const unlocked = isFrameUnlocked(rf, createdAt);
        if (unlocked) colDiv.classList.add('unlocked-glow');

        // Preview: small avatar circle + frame overlay (48px)
        const previewAvatarSrc = getAvatarUrl(userDoc || {}, (userDoc || {}).displayName);
        const framePreviewHtml = rf.image
          ? `<div class="achv-reward-frame-preview">
               <div class="achv-reward-frame-clip">
                 <img src="${esc(previewAvatarSrc)}" alt="avatar">
               </div>
               <img class="achv-reward-frame-overlay" src="${esc(rf.image)}" alt="">
             </div>`
          : `<div class="achv-reward-frame-preview achv-reward-no-frame">
               <i class="bi bi-circle-square"></i>
             </div>`;

        const equipBtn = (unlocked && isOwner)
          ? `<button class="achv-equip-btn" data-frame-id="${esc(rf.id)}" title="Trang bị khung này">
               <i class="bi bi-check2-circle me-1"></i>Trang bị
             </button>`
          : '';

        const statusHtml = unlocked
          ? `<span class="achv-reward-status unlocked"><i class="bi bi-unlock-fill me-1"></i>Đã mở khóa</span>${equipBtn}`
          : `<span class="achv-reward-status locked"><i class="bi bi-lock-fill me-1"></i>Hoàn thành mốc để mở</span>`;

        frameRewardHtml = `
          <div class="achv-reward-box ${unlocked ? 'achv-reward-unlocked' : 'achv-reward-locked'}">
            <div class="achv-reward-label">
              <i class="bi bi-gift-fill me-1"></i>Phần thưởng
            </div>
            <div class="achv-reward-body">
              ${framePreviewHtml}
              <div class="achv-reward-info">
                <div class="achv-reward-name">${esc(rf.name)}</div>
                <div class="achv-reward-type">Khung avatar</div>
                <div class="achv-reward-actions">${statusHtml}</div>
              </div>
            </div>
          </div>`;
      }
    }

    const completedBadge = completed
      ? `<span class="achievement-completed-badge"><i class="bi bi-check-circle-fill me-1"></i>Hoàn thành</span>`
      : '';

    const icon = ms.style === 'hero' ? '🏆' : ms.style === 'big' ? '⭐' : '🎯';

    const inner = document.createElement('div');
    inner.className = 'achievement-card' + (ms.style ? ' ' + ms.style : '');
    if (completed && ms.frameReq) inner.classList.add('unlocked-glow');

    inner.innerHTML = `
      <div class="d-flex justify-content-between align-items-start w-100">
        <div>
          <div class="achievement-title">${icon} ${esc(ms.label)}</div>
          <div class="achievement-meta">${esc(subtitle)}</div>
        </div>
        <div class="text-end d-flex flex-column align-items-end gap-1">${completedBadge}</div>
      </div>
      <div class="achievement-bar w-100">
        <div class="achievement-progress" style="width:${Math.max(0, Math.round(pct))}%"></div>
      </div>
      ${frameRewardHtml}`;

    colDiv.appendChild(inner);
    container.appendChild(colDiv);
  });

  // Wire "Trang bị" buttons via event delegation
  container.addEventListener('click', async e => {
    const btn = e.target.closest('.achv-equip-btn');
    if (!btn || !currentUser || !isOwner) return;
    const frameId = btn.dataset.frameId;
    if (!frameId) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { avatarFrame: frameId });
      userDoc.avatarFrame = frameId;
      invalidateUserCache(currentUser.uid);
      _userCache[currentUser.uid] = { uid: currentUser.uid, ...userDoc };
      // Update profile header frame
      const frameData = getFrameById(frameId);
      const frEl = profileArea?.querySelector('.profile-avatar-frame');
      if (frEl && frameData?.image) frEl.src = frameData.image;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Đã trang bị!';
      btn.style.background = '#d1fae5'; btn.style.color = '#065f46';
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Trang bị';
      alert('Lỗi: ' + (err.message || err));
    }
  }, { once: false });
}

// ═══════════════════════════════════════════════════════════
// AVATAR FRAME PICKER
// ═══════════════════════════════════════════════════════════
async function openFramePicker() {
  if (!currentUser) { loginModalProfile.show(); return; }
  let af;
  try {
    af = await waitForAvatarFrames();
  } catch (e) {
    console.error('openFramePicker: avatar_frames_data not loaded', e);
    alert('Không tải được dữ liệu khung. Kiểm tra avatar_frames_data.js đã được load trong HTML.');
    return;
  }

  const u          = userDoc || {};
  const currentId  = u.avatarFrame || 'none';
  selectedFrameId  = currentId;
  const avatarSrc  = getAvatarUrl(u, u.displayName);
  const createdAt  = getCreatedAt();

  renderFrameModalPreview(avatarSrc, currentId);
  renderFrameGrid('freeFramesGrid',    af.free,    avatarSrc, createdAt, currentId);
  renderFrameGrid('specialFramesGrid', af.special, avatarSrc, createdAt, currentId);
  avatarFrameModal.show();
}

function renderFrameModalPreview(avatarSrc, frameId) {
  const wrapper = document.getElementById('frameModalPreview');
  const label   = document.getElementById('frameModalPreviewLabel');
  if (!wrapper) return;
  const frame = getFrameById(frameId);
  const frameHtml = frame?.image
    ? `<img class="frame-preview-fr" src="${esc(frame.image)}" alt="frame">`
    : '';
  // Apply avatarSettings transform so preview matches profile header exactly
  const u   = userDoc || {};
  const sc  = (u.avatarSettings?.scale      ?? 100) / 100;
  const tx  =  u.avatarSettings?.translateX ?? 0;
  const ty  =  u.avatarSettings?.translateY ?? 0;
  const avVars = `--av-scale:${sc};--av-tx:${tx}px;--av-ty:${ty}px;`;
  wrapper.style.cssText = avVars;
  wrapper.innerHTML = `
    <div class="frame-preview-clip">
      <img class="frame-preview-av profile-avatar-img" style="width:100%;height:100%;" src="${esc(avatarSrc)}" alt="avatar">
    </div>
    ${frameHtml}
  `;
  if (label) label.textContent = frame?.name || 'Không khung';
}

// FIX 3: pass createdAt to isFrameUnlocked
function renderFrameGrid(containerId, frames, avatarSrc, createdAt, currentFrameId) {
  const container = document.getElementById(containerId);
  if (!container || !frames) return;
  container.innerHTML = '';

  frames.forEach(frame => {
    const unlocked  = isFrameUnlocked(frame, createdAt);
    const isSelected= frame.id === selectedFrameId;

    const card = document.createElement('div');
    card.className = ['frame-card', isSelected ? 'selected' : '', !unlocked ? 'locked' : ''].filter(Boolean).join(' ');
    card.dataset.frameId = frame.id;

    const frameOverlayHtml = frame.image ? `<img class="frame-thumb-overlay" src="${esc(frame.image)}" alt="">` : '';
    const lockBadge = !unlocked ? `<div class="frame-card-locked-label"><i class="bi bi-lock-fill"></i></div>` : '';
    const checkBadge= `<div class="frame-card-check"><i class="bi bi-check-lg"></i></div>`;
    const unlockHint= (!unlocked && frame.requirementText)
      ? `<div class="frame-unlock-hint"><i class="bi bi-lock me-1"></i>${esc(frame.requirementText)}</div>` : '';

    // Apply avatarSettings to each thumbnail so they match profile header
    const _u   = userDoc || {};
    const _sc  = (_u.avatarSettings?.scale      ?? 100) / 100;
    const _tx  =  _u.avatarSettings?.translateX ?? 0;
    const _ty  =  _u.avatarSettings?.translateY ?? 0;
    const _avVars = `--av-scale:${_sc};--av-tx:${_tx}px;--av-ty:${_ty}px;`;
    card.innerHTML = `
      <div class="frame-thumb-wrapper" style="${_avVars}">
        <div class="frame-thumb-clip">
          <img class="frame-thumb-avatar profile-avatar-img" style="width:100%;height:100%;" src="${esc(avatarSrc)}" alt="avatar">
        </div>
        ${frameOverlayHtml}
      </div>
      <div class="frame-card-name">${esc(frame.name)}</div>
      ${unlockHint}${lockBadge}${checkBadge}`;

    if (unlocked) {
      card.addEventListener('click', () => {
        selectedFrameId = frame.id;
        container.closest('.modal-body').querySelectorAll('.frame-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        renderFrameModalPreview(avatarSrc, frame.id);
      });
    }
    container.appendChild(card);
  });
}

document.getElementById('applyFrameBtn')?.addEventListener('click', async () => {
  if (!currentUser || !selectedFrameId) return;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { avatarFrame: selectedFrameId });
    userDoc.avatarFrame = selectedFrameId;
    avatarFrameModal.hide();
    // Refresh avatar frame overlay in profile header
    const frameData = getFrameById(selectedFrameId);
    const frEl = profileArea.querySelector('.profile-avatar-frame');
    if (frEl && frameData?.image) frEl.src = frameData.image;
    else if (frEl && !frameData?.image) frEl.remove();
    // Update edit modal preview if open
    updateFrameSelectorPreview();
  } catch (err) { console.error('applyFrame error', err); alert('Không thể áp dụng khung.'); }
});

function updateFrameSelectorPreview() {
  const mini = document.getElementById('frameSelectPreviewAvatar');
  const miniFr = document.getElementById('frameSelectPreviewFrame');
  if (!mini) return;
  const frame = getFrameById(selectedFrameId);
  if (miniFr) { if (frame?.image) { miniFr.src = frame.image; miniFr.style.display = ''; } else miniFr.style.display = 'none'; }
}

// ═══════════════════════════════════════════════════════════
// IMAGE VIEWER
// ═══════════════════════════════════════════════════════════
window.profileViewImage = function(url) {
  if (!url) return;
  const viewer = document.getElementById('profileImgViewer');
  const img    = document.getElementById('profileImgViewerImg');
  if (!viewer || !img) return;
  img.src = url;
  viewer.style.cssText = viewer.style.cssText.replace('display:none', '');
  viewer.style.display = 'flex';
};

window.profileCloseImageViewer = function() {
  const viewer = document.getElementById('profileImgViewer');
  if (viewer) viewer.style.display = 'none';
};

// Ensure viewer is hidden on load (belt-and-suspenders against CSS/cache issues)
(function() {
  function ensureViewerHidden() {
    const v = document.getElementById('profileImgViewer');
    if (v) { v.style.display = 'none'; }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureViewerHidden);
  } else {
    ensureViewerHidden();
  }
  // Also close on clicking the backdrop
  document.addEventListener('click', e => {
    const viewer = document.getElementById('profileImgViewer');
    if (viewer && viewer.style.display !== 'none') {
      if (e.target === viewer) viewer.style.display = 'none';
    }
  });
})();

// ═══════════════════════════════════════════════════════════
// PROFILE EDIT MODAL
// ═══════════════════════════════════════════════════════════
function openEditModal(scrollTo) {
  if (!currentUser || !isOwner) return;
  const u = userDoc || {};

  const avSrc    = getAvatarUrl(u, u.displayName);
  const avVars   = avatarTransformVars(u.avatarSettings);
  const frameData= getFrameById(u.avatarFrame);
  const frameOverlay = frameData?.image
    ? `<img id="av-preview-frame-img" class="av-preview-frame" src="${esc(frameData.image)}" alt="">`
    : `<img id="av-preview-frame-img" class="av-preview-frame" src="" alt="" style="display:none;">`;

  const avSc = u.avatarSettings?.scale      ?? 100;
  const avTx = u.avatarSettings?.translateX ?? 0;
  const avTy = u.avatarSettings?.translateY ?? 0;
  const cvSc = u.coverPhotoSettings?.scale      ?? 100;
  const cvTx = u.coverPhotoSettings?.translateX ?? 0;
  const cvTy = u.coverPhotoSettings?.translateY ?? 0;

  document.getElementById('profileEditModalBody').innerHTML = `
    <!-- ── Cover ── -->
    <h6 class="fw-bold mb-2"><i class="bi bi-panorama me-1"></i>Ảnh bìa</h6>
    <div class="cover-editor-container mb-3">
      <div class="cover-preview-banner mb-2" id="coverPreviewBanner">
        ${u.coverPhotoUrl ? `<img id="coverPreviewImg" src="${esc(u.coverPhotoUrl)}" style="${buildCoverStyle(u.coverPhotoSettings || {})}" alt="">` : '<div class="text-muted text-center pt-4">Chưa có ảnh bìa</div>'}
      </div>
      <input id="coverUrlInput" class="form-control form-control-sm mb-2" placeholder="URL ảnh bìa..." value="${esc(u.coverPhotoUrl || '')}">
      <div class="transform-controls">
        <div class="row g-2 align-items-center mb-2">
          <div class="col-3 small text-muted">Thu phóng</div>
          <div class="col-7"><input type="range" class="form-range" id="coverScale" min="50" max="200" value="${cvSc}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="coverScaleNum" value="${cvSc}" min="50" max="200"></div>
        </div>
        <div class="row g-2 align-items-center mb-2">
          <div class="col-3 small text-muted">Ngang (X)</div>
          <div class="col-7"><input type="range" class="form-range" id="coverTranslateX" min="-200" max="200" value="${cvTx}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="coverTranslateXNum" value="${cvTx}" min="-200" max="200"></div>
        </div>
        <div class="row g-2 align-items-center">
          <div class="col-3 small text-muted">Dọc (Y)</div>
          <div class="col-7"><input type="range" class="form-range" id="coverTranslateY" min="-200" max="200" value="${cvTy}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="coverTranslateYNum" value="${cvTy}" min="-200" max="200"></div>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-secondary mt-2" id="resetCoverTransformBtn">
        <i class="bi bi-arrow-counterclockwise me-1"></i>Đặt lại vị trí
      </button>
    </div>

    <!-- ── Avatar ── -->
    <h6 class="fw-bold mb-2"><i class="bi bi-person-circle me-1"></i>Ảnh đại diện</h6>
    <div class="avatar-editor-container mb-3">
      <div class="d-flex gap-3 align-items-center flex-wrap">
        <div class="av-preview-outer" id="avPreviewOuter" style="${avVars}">
          <div class="av-preview-clip">
            <img class="av-preview-img" id="avPreviewImg" src="${esc(avSrc)}" alt="avatar">
          </div>
          ${frameOverlay}
        </div>
        <div class="flex-fill">
          <input id="avatarUrlInput" class="form-control form-control-sm mb-2" placeholder="URL ảnh đại diện..." value="${esc(u.avatarUrl || '')}">
          <button id="openFramePickerBtn" class="btn btn-sm btn-outline-primary btn-rounded">
            <i class="bi bi-circle-square me-1"></i>Chọn khung avatar
          </button>
        </div>
      </div>
      <div class="transform-controls mt-2">
        <div class="row g-2 align-items-center mb-2">
          <div class="col-3 small text-muted">Thu phóng</div>
          <div class="col-7"><input type="range" class="form-range" id="avatarScale" min="50" max="200" value="${avSc}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="avatarScaleNum" value="${avSc}" min="50" max="200"></div>
        </div>
        <div class="row g-2 align-items-center mb-2">
          <div class="col-3 small text-muted">Ngang (X)</div>
          <div class="col-7"><input type="range" class="form-range" id="avatarTranslateX" min="-100" max="100" value="${avTx}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="avatarTranslateXNum" value="${avTx}" min="-100" max="100"></div>
        </div>
        <div class="row g-2 align-items-center">
          <div class="col-3 small text-muted">Dọc (Y)</div>
          <div class="col-7"><input type="range" class="form-range" id="avatarTranslateY" min="-100" max="100" value="${avTy}"></div>
          <div class="col-2"><input type="number" class="form-control form-control-sm" id="avatarTranslateYNum" value="${avTy}" min="-100" max="100"></div>
        </div>
      </div>
    </div>

    <!-- ── Identity ── -->
    <h6 class="fw-bold mb-2"><i class="bi bi-person-fill me-1"></i>Thông tin hiển thị</h6>
    <div class="mb-3">
      <label class="form-label small fw-semibold">Tên hiển thị</label>
      <input id="displayNameInput" class="form-control" placeholder="Tên hiển thị" value="${esc(u.displayName || '')}">
    </div>
    <div class="mb-3">
      <label class="form-label small fw-semibold">Tag (@)</label>
      <div class="input-group">
        <span class="input-group-text">@</span>
        <input id="tagNameInput" class="form-control" placeholder="tagname" value="${esc((u.tagName || '').replace(/^@/, ''))}">
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label small fw-semibold">Họ và tên thật</label>
      <input id="fullNameInput" class="form-control" placeholder="Họ và tên thật" value="${esc(u.fullName || '')}">
    </div>
    <div class="row mb-3">
      <div class="col">
        <label class="form-label small fw-semibold">Giới tính</label>
        <select id="genderInput" class="form-select">
          <option value="">--</option>
          <option value="female" ${u.gender === 'female' ? 'selected' : ''}>Nữ</option>
          <option value="male"   ${u.gender === 'male'   ? 'selected' : ''}>Nam</option>
          <option value="other"  ${u.gender === 'other'  ? 'selected' : ''}>Khác</option>
        </select>
      </div>
      <div class="col">
        <label class="form-label small fw-semibold">Sinh nhật</label>
        <input id="birthdayInput" type="date" class="form-control" value="${esc(u.birthday || '')}">
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label small fw-semibold">Quốc gia</label>
      <input id="countryInput" class="form-control" placeholder="Quốc gia" value="${esc(u.country || '')}">
    </div>
    <hr>
    <h6 class="fw-bold mb-2"><i class="bi bi-link-45deg me-1"></i>Liên kết mạng xã hội</h6>
    <div class="mb-2">
      <label class="form-label small fw-semibold"><i class="bi bi-facebook text-primary me-1"></i>Facebook</label>
      <input id="socialFacebook" class="form-control form-control-sm" placeholder="https://facebook.com/..." value="${esc(u.socialLinks?.facebook || '')}">
    </div>
    <div class="mb-2">
      <label class="form-label small fw-semibold"><i class="bi bi-instagram me-1" style="color:#e1306c"></i>Instagram</label>
      <input id="socialInstagram" class="form-control form-control-sm" placeholder="https://instagram.com/..." value="${esc(u.socialLinks?.instagram || '')}">
    </div>
    <div class="mb-2">
      <label class="form-label small fw-semibold"><i class="bi bi-tiktok me-1"></i>TikTok</label>
      <input id="socialTiktok" class="form-control form-control-sm" placeholder="https://tiktok.com/@..." value="${esc(u.socialLinks?.tiktok || '')}">
    </div>
    <div class="mb-2">
      <label class="form-label small fw-semibold"><i class="bi bi-youtube me-1" style="color:#ff0000"></i>YouTube</label>
      <input id="socialYoutube" class="form-control form-control-sm" placeholder="https://youtube.com/..." value="${esc(u.socialLinks?.youtube || '')}">
    </div>
    <div class="mb-2">
      <label class="form-label small fw-semibold"><i class="bi bi-github me-1"></i>GitHub</label>
      <input id="socialGithub" class="form-control form-control-sm" placeholder="https://github.com/..." value="${esc(u.socialLinks?.github || '')}">
    </div>
    <div class="mb-3">
      <label class="form-label small fw-semibold"><i class="bi bi-globe2 me-1"></i>Website cá nhân</label>
      <input id="socialWebsite" class="form-control form-control-sm" placeholder="https://yoursite.com" value="${esc(u.socialLinks?.website || '')}">
    </div>
    <div class="mb-3">
      <label class="form-label small fw-semibold">Giới thiệu (Bio)</label>
      <div id="bioInput" style="min-height:100px;max-height:260px;overflow-y:auto;border:1px solid #dee2e6;border-radius:8px;"></div>
    </div>
    <hr>
    <div class="mb-2">
      <div class="d-flex align-items-start gap-3 p-3 rounded-3" style="background:rgba(234,179,8,.07);border:1px solid rgba(234,179,8,.25);">
        <i class="bi bi-database-up" style="color:#b45309;font-size:1.1rem;margin-top:2px;flex-shrink:0;"></i>
        <div class="flex-fill">
          <div class="fw-semibold small mb-1" style="color:#92400e;">
            Chuyển đổi dữ liệu sang Relife 5
            <span class="ms-1" style="font-size:.68rem;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:4px;padding:1px 5px;vertical-align:middle;">Chạy 1 lần</span>
          </div>
          <div class="text-muted" style="font-size:.78rem;line-height:1.5;">
            Xóa dữ liệu tên/avatar được lưu trực tiếp trong bài viết và bình luận (định dạng cũ R4). Relife 5 sẽ tự lấy thông tin mới nhất từ hồ sơ — không cần lưu riêng nữa.
          </div>
          <button id="btnForceSync" class="btn btn-sm btn-rounded mt-2" style="background:#fef3c7;border:1px solid #fbbf24;color:#92400e;">
            <i class="bi bi-database-up me-1"></i>Chuyển đổi ngay
          </button>
        </div>
      </div>
    </div>`;

  // Wire nút migrate R4 → R5 (chạy 1 lần duy nhất)
  document.getElementById('btnForceSync')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnForceSync');
    if (!currentUser || !isOwner) return;
    if (!confirm(
      'Chuyển đổi dữ liệu sang định dạng Relife 5?\n\n' +
      'Thao tác này sẽ xóa tên/avatar được lưu trực tiếp trong bài viết và bình luận của bạn.\n' +
      'Chỉ cần thực hiện 1 lần duy nhất.'
    )) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang chuyển đổi...';
    try {
      await forceRemoveStaleProfileData(currentUser.uid);
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Hoàn tất!';
      btn.style.background = '#dcfce7';
      btn.style.borderColor = '#86efac';
      btn.style.color = '#166534';
    } catch(e) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-database-up me-1"></i>Chuyển đổi ngay';
      alert('Lỗi: ' + (e.message || e));
    }
  });

  // Wire sliders
  wireSliderNum('coverScale',       'coverScaleNum',       applyCoverPreviewTransform);
  wireSliderNum('coverTranslateX',  'coverTranslateXNum',  applyCoverPreviewTransform);
  wireSliderNum('coverTranslateY',  'coverTranslateYNum',  applyCoverPreviewTransform);
  wireSliderNum('avatarScale',      'avatarScaleNum',      applyAvatarPreviewTransform);
  wireSliderNum('avatarTranslateX', 'avatarTranslateXNum', applyAvatarPreviewTransform);
  wireSliderNum('avatarTranslateY', 'avatarTranslateYNum', applyAvatarPreviewTransform);

  document.getElementById('coverUrlInput')?.addEventListener('input', ev => {
    const img = document.getElementById('coverPreviewImg');
    if (img) img.src = ev.target.value;
    else {
      const banner = document.getElementById('coverPreviewBanner');
      if (banner && ev.target.value) banner.innerHTML = `<img id="coverPreviewImg" src="${esc(ev.target.value)}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
    }
  });

  document.getElementById('avatarUrlInput')?.addEventListener('input', ev => {
    const img = document.getElementById('avPreviewImg');
    if (img) img.src = ev.target.value || getAvatarUrl(null, userDoc?.displayName);
  });

  document.getElementById('resetCoverTransformBtn')?.addEventListener('click', () => {
    setSliderPair('coverScale', 'coverScaleNum', 100);
    setSliderPair('coverTranslateX', 'coverTranslateXNum', 0);
    setSliderPair('coverTranslateY', 'coverTranslateYNum', 0);
    applyCoverPreviewTransform();
  });

  document.getElementById('openFramePickerBtn')?.addEventListener('click', () => {
    profileEditModal.hide();
    setTimeout(openFramePicker, 350);
  });

  // Re-open edit modal when frame modal closes
  document.getElementById('avatarFrameModal')?.addEventListener('hidden.bs.modal', () => {
    updateFrameSelectorPreview();
  }, { once: true });

  profileEditModal.show();

  // Init bio Quill AFTER modal is fully visible (so element has dimensions)
  const bioModalEl = document.getElementById('profileEditModal');
  const _bioInitHandler = () => {
    bioModalEl?.removeEventListener('shown.bs.modal', _bioInitHandler);
    const bioEl = document.getElementById('bioInput');
    if (!bioEl) return;
    // Destroy any lingering Quill instance
    window._bioQuill = null;
    if (typeof Quill !== 'undefined') {
      window._bioQuill = new Quill('#bioInput', {
        theme: 'snow',
        modules: { toolbar: [['bold','italic','underline','strike'],['clean']] },
        placeholder: 'Viết vài dòng giới thiệu bản thân...'
      });
      // Restore saved bio
      const savedBio = (typeof u !== 'undefined' && u.bio) ? u.bio : '';
      if (savedBio) {
        window._bioQuill.clipboard.dangerouslyPasteHTML(savedBio);
      }
      // Prevent auto-focus / keyboard popup on mobile
      window._bioQuill.root.setAttribute('data-gramm', 'false');
      window._bioQuill.blur();
      // Remove focus from any element that Quill may have grabbed
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    }
    // Scroll to section if requested
    if (scrollTo) {
      const target = scrollTo === 'cover'  ? document.getElementById('coverUrlInput')
                   : scrollTo === 'avatar' ? document.getElementById('avatarUrlInput')
                   : scrollTo === 'bio'    ? document.getElementById('bioInput')
                   : null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  bioModalEl?.addEventListener('shown.bs.modal', _bioInitHandler);
}

function wireSliderNum(sliderId, numId, onChange) {
  const slider = document.getElementById(sliderId), num = document.getElementById(numId);
  if (!slider || !num) return;
  slider.addEventListener('input', () => { num.value = slider.value; onChange(); });
  num.addEventListener('input',   () => { slider.value = num.value; onChange(); });
}

function setSliderPair(sliderId, numId, val) {
  const s = document.getElementById(sliderId), n = document.getElementById(numId);
  if (s) s.value = val; if (n) n.value = val;
}

function applyCoverPreviewTransform() {
  const sc = parseFloat(document.getElementById('coverScaleNum')?.value      ?? 100);
  const tx = parseFloat(document.getElementById('coverTranslateXNum')?.value ?? 0);
  const ty = parseFloat(document.getElementById('coverTranslateYNum')?.value ?? 0);
  const img = document.getElementById('coverPreviewImg');
  if (img) img.style.transform = `scale(${sc / 100}) translate(${tx}px,${ty}px)`;
}

function applyAvatarPreviewTransform() {
  const sc = parseFloat(document.getElementById('avatarScaleNum')?.value      ?? 100) / 100;
  const tx = parseFloat(document.getElementById('avatarTranslateXNum')?.value ?? 0);
  const ty = parseFloat(document.getElementById('avatarTranslateYNum')?.value ?? 0);
  const outer = document.getElementById('avPreviewOuter');
  if (outer) outer.style.cssText = `--av-scale:${sc};--av-tx:${tx}px;--av-ty:${ty}px;`;
}

// Save profile
// Support BOTH IDs: saveProfileBtn (injected form) AND saveProfileModalBtn (static HTML footer)
async function _doSaveProfile() {
  if (!currentUser || !isOwner) return;
  // Button may be saveProfileBtn (injected) OR saveProfileModalBtn (static HTML)
  const btn = document.getElementById('saveProfileBtn') || document.getElementById('saveProfileModalBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';

  try {
    const newDisplay    = (document.getElementById('displayNameInput')?.value || '').trim();
    const rawTag        = (document.getElementById('tagNameInput')?.value     || '').trim().toLowerCase().replace(/^@/, '');
    const newTag        = rawTag ? '@' + rawTag : '';
    const newFullName   = (document.getElementById('fullNameInput')?.value    || '').trim();
    const newGender     = document.getElementById('genderInput')?.value     || '';
    const newBirthday   = document.getElementById('birthdayInput')?.value   || '';
    const newCountry    = (document.getElementById('countryInput')?.value    || '').trim();
    const socialLinks = {
      facebook:  (document.getElementById('socialFacebook')?.value  || '').trim(),
      instagram: (document.getElementById('socialInstagram')?.value || '').trim(),
      tiktok:    (document.getElementById('socialTiktok')?.value    || '').trim(),
      youtube:   (document.getElementById('socialYoutube')?.value   || '').trim(),
      github:    (document.getElementById('socialGithub')?.value    || '').trim(),
      website:   (document.getElementById('socialWebsite')?.value   || '').trim()
    };
    // bioInput is a <textarea>; if bioEditInstance (Quill) exists, prefer its HTML
    const bioTextarea  = document.getElementById('bioInput');
    const bioQuillEl   = document.getElementById('bioEditInstance');
    const newBio       = window._bioQuill
      ? window._bioQuill.root.innerHTML.trim()
      : (bioTextarea?.value || '').trim();
    const newAvatarUrl  = (document.getElementById('avatarUrlInput')?.value  || '').trim();
    const newCoverUrl   = (document.getElementById('coverUrlInput')?.value   || '').trim();

    const avatarSettings     = {
      scale:      parseFloat(document.getElementById('avatarScaleNum')?.value      ?? 100),
      translateX: parseFloat(document.getElementById('avatarTranslateXNum')?.value ?? 0),
      translateY: parseFloat(document.getElementById('avatarTranslateYNum')?.value ?? 0)
    };
    const coverPhotoSettings = {
      scale:      parseFloat(document.getElementById('coverScaleNum')?.value       ?? 100),
      translateX: parseFloat(document.getElementById('coverTranslateXNum')?.value  ?? 0),
      translateY: parseFloat(document.getElementById('coverTranslateYNum')?.value  ?? 0)
    };
    const newFrameId = selectedFrameId || userDoc?.avatarFrame || 'none';

    if (!newDisplay) { alert('Tên hiển thị không được để trống.'); btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi'; return; }

    // Tag uniqueness check
    if (newTag && newTag !== userDoc.tagName) {
      const tagQ    = query(collection(db, 'users'), where('tagName', '==', newTag));
      const tagSnap = await getDocs(tagQ);
      if (!tagSnap.empty && tagSnap.docs[0].id !== currentUser.uid) {
        alert('Tag này đã được sử dụng. Vui lòng chọn tag khác.');
        btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi';
        return;
      }
    }

    const updateData = {
      displayName: newDisplay, tagName: newTag, fullName: newFullName,
      gender: newGender, birthday: newBirthday, country: newCountry, bio: newBio,
      socialLinks,
      avatarUrl: newAvatarUrl || null, coverPhotoUrl: newCoverUrl || null,
      avatarFrame: newFrameId, avatarSettings, coverPhotoSettings,
      updatedAt: serverTimestamp()
    };

    await updateDoc(doc(db, 'users', currentUser.uid), updateData);

    // Update local state & cache — profile.js renders always read from _userCache,
    // so no propagation to posts/comments is needed here.
    // (Use "Ép chuyển đổi" button to sync legacy displayName fields for other pages)
    Object.assign(userDoc, updateData);
    invalidateUserCache(currentUser.uid);
    _userCache[currentUser.uid] = { uid: currentUser.uid, ...userDoc };
    profileEditModal.hide();
    await loadProfile(currentUser.uid);
  } catch (err) {
    console.error('saveProfile error', err);
    alert('Lỗi khi lưu: ' + (err.message || err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi';
    }
    // Also reset the other button if both exist
    const btn2 = document.getElementById('saveProfileModalBtn');
    if (btn2 && btn2 !== btn) { btn2.disabled = false; btn2.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi'; }
  }
}

document.getElementById('saveProfileBtn')?.addEventListener('click', _doSaveProfile);
document.getElementById('saveProfileModalBtn')?.addEventListener('click', _doSaveProfile);

async function propagateProfileToComments(uid, displayName, tagName, avatarUrl) {
  // Propagate displayName + avatarUrl to ALL posts and comments authored by this user.
  // Uses rolling batches of 490 ops to stay under Firestore 500-op limit.
  try {
    const postsSnap = await getDocs(query(collection(db, 'posts'), where('userId', '==', uid)));
    if (postsSnap.empty) return;

    const batches = [];
    let currentBatch = writeBatch(db);
    let ops = 0;

    const flush = async () => {
      if (ops > 0) { batches.push(currentBatch.commit()); currentBatch = writeBatch(db); ops = 0; }
    };
    const addOp = (ref, data) => {
      currentBatch.update(ref, data);
      ops++;
      if (ops >= 490) { batches.push(currentBatch.commit()); currentBatch = writeBatch(db); ops = 0; }
    };

    for (const pd of postsSnap.docs) {
      // Update post's cached author name + tag
      addOp(pd.ref, { displayName, authorTag: tagName || null });

      // Update all comments by this user on this post
      const commentsSnap = await getDocs(
        query(collection(db, 'posts', pd.id, 'comments'), where('userId', '==', uid))
      );
      commentsSnap.docs.forEach(cd => {
        addOp(cd.ref, { displayName, avatarUrl: avatarUrl || null });
      });
    }
    await flush();
    await Promise.all(batches);
  } catch (e) {
    // Non-critical: profile saved successfully, just sync failed
    console.warn('propagateProfile sync failed (non-critical):', e);
  }
}

// ════════════════════════════════════════════════════════════════
// FORCE SYNC — remove stale displayName/avatarUrl from posts & comments
// After this, runtime always reads from users/{uid} via userCache
// ════════════════════════════════════════════════════════════════
async function forceRemoveStaleProfileData(uid) {
  const postsSnap = await getDocs(query(collection(db, 'posts'), where('userId', '==', uid)));
  if (postsSnap.empty) return;

  let currentBatch = writeBatch(db);
  let ops = 0;

  const flush = () => {
    if (ops > 0) {
      const b = currentBatch;
      currentBatch = writeBatch(db);
      ops = 0;
      return b.commit();
    }
    return Promise.resolve();
  };

  const addDel = (ref, fields) => {
    // We don't delete the field — we set it to the canonical value from userDoc
    // so legacy readers still work. Real fix: set displayName to current value.
    const u = userDoc || {};
    const data = {};
    fields.forEach(f => {
      if (f === 'displayName') data.displayName = u.displayName || '';
      if (f === 'avatarUrl')   data.avatarUrl   = u.avatarUrl   || null;
      if (f === 'authorTag')   data.authorTag   = u.tagName     || null;
    });
    if (Object.keys(data).length) {
      currentBatch.update(ref, data);
      ops++;
      if (ops >= 490) { flush(); }
    }
  };

  for (const pd of postsSnap.docs) {
    addDel(pd.ref, ['displayName', 'authorTag']);
    const commentsSnap = await getDocs(
      query(collection(db, 'posts', pd.id, 'comments'), where('userId', '==', uid))
    );
    commentsSnap.docs.forEach(cd => addDel(cd.ref, ['displayName', 'avatarUrl']));
  }
  await flush();
  // Refresh cache
  invalidateUserCache(uid);
  if (userDoc) _userCache[uid] = { uid, ...userDoc };
}

// ═══════════════════════════════════════════════════════════
// PROFILE INFO MODAL (Xem thêm)
// ═══════════════════════════════════════════════════════════
function openProfileInfoModal() {
  const u = userDoc;
  if (!u) return;

  const genderMap  = { male: 'Nam', female: 'Nữ', other: 'Khác' };
  const genderText = u.gender ? (genderMap[u.gender] || u.gender) : '';
  const birthday   = u.birthday ? new Date(u.birthday).toLocaleDateString('vi-VN') : '';
  const isAdmin    = u.type === 'admin';

  // Admin badge
  const badgesInInfoHtml = getUserBadges(u).length
    ? `<div class="info-row d-flex align-items-center gap-2"><i class="bi bi-award me-2 text-muted"></i>${renderBadges(u, 5)}</div>` : '';

  // Social links
  const sl = u.socialLinks || {};
  const socialMap = [
    { key: 'facebook',  icon: 'bi-facebook',  label: 'Facebook',  color: '#1877f2' },
    { key: 'instagram', icon: 'bi-instagram', label: 'Instagram', color: '#e1306c' },
    { key: 'tiktok',    icon: 'bi-tiktok',    label: 'TikTok',    color: '#000' },
    { key: 'youtube',   icon: 'bi-youtube',   label: 'YouTube',   color: '#ff0000' },
    { key: 'github',    icon: 'bi-github',    label: 'GitHub',    color: '#333' },
    { key: 'website',   icon: 'bi-globe2',    label: 'Website',   color: '#0d6efd' }
  ];
  const socialHtml = socialMap
    .filter(s => sl[s.key])
    .map(s => `<a href="${esc(sl[s.key])}" target="_blank" rel="noopener" class="social-link-item">
      <i class="bi ${esc(s.icon)}" style="color:${s.color}"></i>
      <span>${esc(s.label)}</span>
      <i class="bi bi-box-arrow-up-right ms-auto small text-muted"></i>
    </a>`).join('');

  const infoRows = [];
  if (u.fullName)  infoRows.push(`<div class="info-row"><i class="bi bi-person-lines-fill me-2 text-muted"></i><span>${esc(u.fullName)}</span></div>`);
  if (genderText)  infoRows.push(`<div class="info-row"><i class="bi bi-gender-ambiguous me-2 text-muted"></i><span>${esc(genderText)}</span></div>`);
  if (birthday)    infoRows.push(`<div class="info-row"><i class="bi bi-cake2 me-2 text-muted"></i><span>${esc(birthday)}</span></div>`);
  if (u.country)   infoRows.push(`<div class="info-row"><i class="bi bi-geo-alt me-2 text-muted"></i><span>${esc(u.country)}</span></div>`);

  const joinDate = u.createdAt?.toDate
    ? u.createdAt.toDate().toLocaleDateString('vi-VN', { year: 'numeric', month: 'long' }) : '';
  if (joinDate)    infoRows.push(`<div class="info-row"><i class="bi bi-calendar-check me-2 text-muted"></i><span>Tham gia ${esc(joinDate)}</span></div>`);

  const container = document.getElementById('profileInfoModalBody');
  if (!container) return;
  container.innerHTML = `
    ${badgesInInfoHtml}
    ${infoRows.join('')}
    ${socialHtml ? `<hr class="my-3"><div class="fw-semibold small mb-2"><i class="bi bi-link-45deg me-1"></i>Mạng xã hội</div>${socialHtml}` : ''}
    ${!infoRows.length && !socialHtml && !getUserBadges(u).length ? '<div class="text-muted text-center py-2">Chưa có thông tin</div>' : ''}
    <div id="acctMgmtPanel"></div>
  `;
  const profileInfoModal = new bootstrap.Modal(document.getElementById('profileInfoModal'));
  profileInfoModal.show();
  // Async: populate account management panel if viewer has SA privileges
  _populateAccountMgmtPanel();
}

// ─── Account Management Panel ─────────────────────────────
async function _populateAccountMgmtPanel() {
  const panel = document.getElementById('acctMgmtPanel');
  if (!panel) return;
  if (!currentUser) return;

  // Fetch viewer's own profile
  const viewerProf = await getUserProfile(currentUser.uid);
  if (!viewerProf) return;
  const vType = viewerProf.type || 'user';

  // Only SA can see this panel
  if (!isSAType(vType)) return;

  const targetProf = await getUserProfile(profileUid);
  if (!targetProf) return;

  // Admin viewing own profile — no type-change panel for self
  // Non-admin SA cannot manage other SA
  if (!canViewerManageType(viewerProf, targetProf)) return;

  const tType = targetProf.type || 'user';
  const tCfg  = ACCOUNT_TYPE_CONFIG[tType] || ACCOUNT_TYPE_CONFIG['user'];
  const tierLabel = { SA: 'Bậc cao (SA)', RA: 'Thông thường (RA)', LLA: 'Bậc thấp (LLA)' };

  // Build list of types this viewer can assign to this target
  const allowedTypes = Object.entries(ACCOUNT_TYPE_CONFIG)
    .filter(([key]) => canViewerChangeTypeTo(viewerProf, targetProf, key))
    .sort((a, b) => b[1].rank - a[1].rank);

  if (!allowedTypes.length) return;

  const optionsHtml = allowedTypes.map(([key, cfg]) =>
    `<option value="${esc(key)}" ${key === tType ? 'selected' : ''}>[${cfg.tier}] ${esc(cfg.name)}</option>`
  ).join('');

  panel.innerHTML = `
    <hr>
    <div class="p-3 rounded-3" style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.2);">
      <div class="d-flex align-items-center gap-2 mb-2">
        <i class="bi bi-shield-lock-fill" style="color:#dc2626;"></i>
        <span class="fw-bold small">Quản lý tài khoản</span>
        <span class="ms-auto acct-badge" style="background:${ACCOUNT_TYPE_CONFIG[vType]?.grad};font-size:.7rem;padding:2px 7px;">
          <i class="bi ${ACCOUNT_TYPE_CONFIG[vType]?.icon}"></i> ${esc(ACCOUNT_TYPE_CONFIG[vType]?.name || vType)}
        </span>
      </div>
      <div class="mb-2" style="font-size:.8rem;color:#6b7280;">
        Loại hiện tại: <strong>${esc(tCfg.name)}</strong> · ${esc(tierLabel[tCfg.tier] || tCfg.tier)}
      </div>
      <div class="d-flex gap-2 align-items-center">
        <select id="acctTypeSelect" class="form-select form-select-sm flex-fill" style="font-size:.82rem;">${optionsHtml}</select>
        <button id="acctTypeApplyBtn" class="btn btn-sm btn-danger" style="white-space:nowrap;padding:5px 12px;">
          <i class="bi bi-check2 me-1"></i>Áp dụng
        </button>
      </div>
      <div id="acctMgmtMsg" style="font-size:.78rem;margin-top:6px;display:none;"></div>
    </div>`;

  document.getElementById('acctTypeApplyBtn')?.addEventListener('click', () =>
    _applyAccountTypeChange(viewerProf, targetProf));
}

async function _applyAccountTypeChange(viewerProf, targetProf) {
  const btn    = document.getElementById('acctTypeApplyBtn');
  const select = document.getElementById('acctTypeSelect');
  const msgEl  = document.getElementById('acctMgmtMsg');
  if (!btn || !select) return;

  const newType = select.value;
  const oldType = targetProf.type || 'user';
  if (newType === oldType) { _showAcctMsg(msgEl, 'Không có thay đổi.', 'info'); return; }

  if (!canViewerChangeTypeTo(viewerProf, targetProf, newType)) {
    _showAcctMsg(msgEl, 'Bạn không có quyền thực hiện thao tác này.', 'danger');
    return;
  }

  const newCfg = ACCOUNT_TYPE_CONFIG[newType];
  // Admin transferring admin role → self demote confirmation
  if (viewerProf.type === 'admin' && newType === 'admin') {
    if (!confirm(
      `Chuyển quyền Admin cho "${targetProf.displayName || targetProf.uid}"?
` +
      `Bạn sẽ bị hạ xuống "Vận hành" ngay sau đó.
` +
      `Hành động này không thể hoàn tác!`
    )) return;
  } else {
    if (!confirm(`Đổi loại tài khoản "${targetProf.displayName || targetProf.uid}" thành "${newCfg?.name || newType}"?`)) return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  _showAcctMsg(msgEl, 'Đang cập nhật...', 'info');

  try {
    // Admin transferring admin role:
    // MUST set target=admin FIRST (while caller is still admin in Firestore),
    // THEN demote self — reversing the order would cause permission-denied
    if (viewerProf.type === 'admin' && newType === 'admin') {
      // Step 1: Grant admin to target (caller is still admin in Firestore at this point)
      await updateDoc(doc(db, 'users', profileUid), { type: 'admin' });
      invalidateUserCache(profileUid);
      // Step 2: Demote self to operator (now covered by Nhánh 4 — resource.data.type was 'admin')
      await updateDoc(doc(db, 'users', currentUser.uid), { type: 'operator' });
      invalidateUserCache(currentUser.uid);
      if (currentUser.uid === profileUid) { userDoc.type = 'operator'; }
    } else {
      // Normal type change (non-admin-transfer)
      await updateDoc(doc(db, 'users', profileUid), { type: newType });
      invalidateUserCache(profileUid);
    }

    _showAcctMsg(msgEl, `Đã cập nhật thành "${newCfg?.name || newType}"!`, 'success');
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Áp dụng';
    btn.disabled = false;

    // Refresh panel to show new state
    setTimeout(() => _populateAccountMgmtPanel(), 600);
  } catch (err) {
    console.error('acctTypeChange error', err);
    _showAcctMsg(msgEl, 'Lỗi: ' + (err.message || err), 'danger');
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Áp dụng';
  }
}

function _showAcctMsg(el, text, type) {
  if (!el) return;
  el.style.display = '';
  el.style.color = type === 'success' ? '#16a34a' : type === 'danger' ? '#dc2626' : '#6b7280';
  el.textContent = text;
  if (type !== 'info') setTimeout(() => { if (el) el.style.display = 'none'; }, 3000);
}
// ═══════════════════════════════════════════════════════════
// VISITORS MODAL
// ═══════════════════════════════════════════════════════════
openVisitorsBtn?.addEventListener('click', async () => {
  if (!isOwner || !currentUser) return;
  visitorsListEl.innerHTML = '<div class="text-muted text-center py-3"><div class="spinner-border spinner-border-sm me-2"></div>Đang tải...</div>';
  new bootstrap.Modal(document.getElementById('visitorsModal')).show();
  try {
    const snap = await getDocs(
      query(collection(db, 'users', currentUser.uid, 'visitors'), orderBy('lastVisitedAt', 'desc'))
    );
    if (snap.empty) { visitorsListEl.innerHTML = '<div class="text-muted text-center py-3">Chưa có khách ghé thăm.</div>'; return; }
    visitorsListEl.innerHTML = '';

    // Pre-warm global userCache for all visitors (gets fresh name/avatar/frame)
    const visitorDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await prewarmUserCache(visitorDocs.map(v => v.userId));

    visitorDocs.forEach(v => {
      const uData = _userCache[v.userId] || {};
      const freshTag = uData.tagName || v.tagName;

      const el = document.createElement('div');
      el.className = 'visitor-item';
      el.innerHTML = `
        ${buildAvatarWrap(uData, 40)}
        <div class="flex-fill">
          <div class="visitor-item-name d-flex align-items-center gap-1 flex-wrap">
            <span>${esc(uData.displayName || v.displayName || 'Ẩn danh')}</span>
            ${uData.type ? renderBadges(uData, 1) : ''}
          </div>
          ${freshTag ? `<div class="visitor-item-tag">${freshTag.startsWith('@') ? esc(freshTag) : '@' + esc(freshTag)}</div>` : ''}
        </div>
        <div class="visitor-item-time">${fmtDate(v.lastVisitedAt)}</div>`;
      el.addEventListener('click', () => { window.location.href = `profile.html?user=${encodeURIComponent(v.userId)}`; });
      visitorsListEl.appendChild(el);
    });
  } catch (err) { console.error('visitors modal error', err); visitorsListEl.innerHTML = '<div class="text-danger text-center py-3">Không thể tải danh sách.</div>'; }
});

// ═══════════════════════════════════════════════════════════
// LOGIN MODAL
// ═══════════════════════════════════════════════════════════
document.getElementById('loginBtnProfile')?.addEventListener('click', async () => {
  const email    = (document.getElementById('loginEmailProfile')?.value    || '').trim();
  const password =  document.getElementById('loginPasswordProfile')?.value || '';
  const errEl    = document.getElementById('loginErrorProfile');
  if (errEl) errEl.style.display = 'none';
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const udoc = await getDoc(doc(db, 'users', cred.user.uid));
    const profile = udoc.exists() ? udoc.data() : null;
    if (profile?.activated) {
      loginModalProfile.hide();
    } else {
      document.getElementById('activateBlockProfile').style.display = '';
      const code = prompt('Tài khoản chưa kích hoạt. Nhập mã kích hoạt:');
      if (code) {
        const uRef = doc(db, 'users', cred.user.uid);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists() && uSnap.data().activationCode === code) {
          await updateDoc(uRef, { activated: true });
          alert('Kích hoạt thành công.'); loginModalProfile.hide();
        } else { alert('Mã kích hoạt sai.'); await signOut(auth); }
      } else { await signOut(auth); }
    }
  } catch (err) {
    console.error('loginProfile error', err);
    if (errEl) { errEl.textContent = 'Lỗi: ' + (err.message || err); errEl.style.display = ''; }
    else alert('Lỗi đăng nhập: ' + (err.message || err));
  }
});

// ═══════════════════════════════════════════════════════════
// WINDOW EXPORTS
// ═══════════════════════════════════════════════════════════
window.navigateToProfile  = uid => { if (uid) window.location.href = `profile.html?user=${uid}`; };
window.openEditPost       = openEditPost;
window.confirmDeletePost  = confirmDeletePost;
window.doFollow           = doFollow;
window.doUnfollow         = doUnfollow;