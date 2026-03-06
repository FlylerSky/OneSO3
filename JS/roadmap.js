// JS/roadmap.js — Relife Tiến trình
// - Countdown đến lần update tiếp theo
// - Timeline 6 cập nhật trong năm
// - Phần rò rỉ (admin-only đăng)

import { initFirebase } from '../firebase-config.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  collection, query, orderBy, onSnapshot, addDoc, deleteDoc,
  doc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();
const auth = getAuth();

// ============================================================
// VERSIONING SYSTEM — Relife 4+
// ============================================================
// Relife bắt đầu lịch cập nhật cố định từ Relife 4, phát hành 2/2/2026
// Tên phiên bản: "Relife N"  — N tăng dần mỗi chu kỳ
// Mã phiên bản:  rN.X.MMYY
//   N    = số hiệu phiên bản (4, 5, 6, ...)
//   X    = số bản vá trong chu kỳ (deploy lên server test)
//   MMYY = tháng + 2 chữ số cuối năm, KHÔNG pad zero cho tháng đơn lẻ
//          VD: tháng 4/2026 → "426", tháng 12/2026 → "1226"

// Phiên bản khởi đầu cố định
const RELIFE_ORIGIN = {
  n:    4,
  code: 'r4.2.226',
  date: new Date(2026, 1, 2), // 2/2/2026
};

// Thông tin phiên bản hiện tại (Relife 4 vừa phát hành 2/2/2026)
const CURRENT_VERSION = {
  name: 'Relife 4',
  code: 'r4.2.226',
  releaseDate: new Date(2026, 1, 2),
};

const UPDATE_MONTHS = [2, 4, 6, 8, 10, 12];

function getUpdateDates(year) {
  return UPDATE_MONTHS.map(m => new Date(year, m - 1, 2, 0, 0, 0, 0));
}

function getMaintenanceStart(updateDate) {
  return new Date(updateDate.getTime() - 2 * 24 * 3600 * 1000);
}

/** Đếm số chu kỳ từ mốc gốc đến một ngày update (bao gồm mốc gốc = 0) */
function cycleIndexOf(updateDate) {
  const year = updateDate.getFullYear();
  // Tập hợp tất cả ngày update từ 2026 đến năm đó
  let allDates = [];
  for (let y = RELIFE_ORIGIN.date.getFullYear(); y <= year + 1; y++) {
    allDates.push(...getUpdateDates(y));
  }
  allDates = allDates.filter(d => d >= RELIFE_ORIGIN.date);
  allDates.sort((a, b) => a - b);
  return allDates.findIndex(d =>
    d.getFullYear() === updateDate.getFullYear() &&
    d.getMonth()    === updateDate.getMonth()    &&
    d.getDate()     === updateDate.getDate()
  );
}

/** Số hiệu phiên bản N = RELIFE_ORIGIN.n + index */
function getReliefeN(updateDate) {
  const idx = cycleIndexOf(updateDate);
  return RELIFE_ORIGIN.n + idx;
}

/** Tên phiên bản: "Relife N" */
function getRelifeName(updateDate) {
  if (updateDate < RELIFE_ORIGIN.date) return 'Trước Relife 4';
  return `Relife ${getReliefeN(updateDate)}`;
}

/**
 * Mã MMYY: tháng không pad zero, năm 2 chữ số không pad zero
 * tháng 4/2026 → "426"
 * tháng 12/2026 → "1226"
 * tháng 2/2026  → "226"
 */
function buildMMYY(date) {
  const m  = date.getMonth() + 1; // 1–12
  const yy = date.getFullYear() % 100; // 26, 27...
  return `${m}${yy}`;
}

/**
 * Mã phiên bản đầy đủ: rN.X.MMYY
 * Với phiên bản tương lai, X = "?" (chưa biết số bản vá)
 * Với Relife 4 (mốc gốc) dùng code đã biết
 */
function getVersionCode(updateDate, patchNum) {
  if (updateDate < RELIFE_ORIGIN.date) return '';
  // Nếu đúng là ngày Relife 4 → trả về code chính xác đã biết
  if (sameDay(updateDate, RELIFE_ORIGIN.date)) return RELIFE_ORIGIN.code;
  const n = getReliefeN(updateDate);
  const x = (patchNum !== undefined && patchNum !== null) ? patchNum : '?';
  return `r${n}.${x}.${buildMMYY(updateDate)}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

// ============================================================
// CYCLE INFO
// ============================================================
function getCurrentCycleInfo(now) {
  const year = now.getFullYear();
  let allDates = [
    ...getUpdateDates(year - 1),
    ...getUpdateDates(year),
    ...getUpdateDates(year + 1),
  ].filter(d => d >= RELIFE_ORIGIN.date);

  allDates.sort((a, b) => a - b);

  let nextUpdateIdx = allDates.findIndex(d => d > now);
  if (nextUpdateIdx === -1) nextUpdateIdx = allDates.length - 1;

  const nextUpdate = allDates[nextUpdateIdx];
  const prevUpdate = allDates[nextUpdateIdx - 1] || RELIFE_ORIGIN.date;
  const maintStart = getMaintenanceStart(nextUpdate);

  let status = 'developing';
  if (now >= maintStart && now < nextUpdate) status = 'maintenance';
  else if (now >= nextUpdate) status = 'released';

  const cycleLength = nextUpdate - prevUpdate;
  const elapsed = now - prevUpdate;
  const percent = Math.max(0, Math.min(100, (elapsed / cycleLength) * 100));

  return { nextUpdate, prevUpdate, maintStart, status, percent };
}

// ============================================================
// COUNTDOWN
// ============================================================
function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }

function updateCountdown() {
  const now = new Date();
  const { nextUpdate, prevUpdate, maintStart, status, percent } = getCurrentCycleInfo(now);

  const target = (status === 'developing') ? maintStart : nextUpdate;
  const ms = target - now;

  const tickEl = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.textContent;
    el.textContent = pad(val);
    if (prev !== pad(val)) { el.classList.add('tick'); setTimeout(() => el.classList.remove('tick'), 250); }
  };

  if (ms > 0) {
    const totalSec = ms / 1000;
    tickEl('cdDays',    Math.floor(totalSec / 86400));
    tickEl('cdHours',   Math.floor((totalSec % 86400) / 3600));
    tickEl('cdMinutes', Math.floor((totalSec % 3600) / 60));
    tickEl('cdSeconds', Math.floor(totalSec % 60));
  } else {
    ['cdDays','cdHours','cdMinutes','cdSeconds'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '00';
    });
  }

  // Tên và mã phiên bản tiếp theo
  const nextName = getRelifeName(nextUpdate);
  const nextCode = getVersionCode(nextUpdate);
  document.getElementById('heroVersion').textContent = nextName;

  const heroCodeEl = document.getElementById('heroVersionCode');
  if (heroCodeEl) heroCodeEl.textContent = nextCode;

  // Subtitle + label
  const nextDateStr = nextUpdate.toLocaleDateString('vi-VN', { day:'numeric', month:'long', year:'numeric' });
  const heroLabelEl   = document.getElementById('heroLabel');
  const heroSubtitleEl = document.getElementById('heroSubtitle');

  if (status === 'developing') {
    if (heroLabelEl) heroLabelEl.textContent = 'Server tạm đóng sau';
    if (heroSubtitleEl) heroSubtitleEl.textContent =
      `Đang phát triển · Server bảo trì từ ${getMaintenanceStart(nextUpdate).toLocaleDateString('vi-VN', {day:'numeric', month:'long'})}`;
  } else if (status === 'maintenance') {
    if (heroLabelEl) heroLabelEl.textContent = 'Ra mắt phiên bản mới sau';
    if (heroSubtitleEl) heroSubtitleEl.textContent = `Server đang tạm đóng · Ra mắt ngày ${nextDateStr}`;
  } else {
    if (heroLabelEl) heroLabelEl.textContent = 'Phiên bản mới đã ra mắt';
    if (heroSubtitleEl) heroSubtitleEl.textContent = `Phiên bản mới đã ra mắt ngày ${nextDateStr}`;
  }

  // Progress bar
  const fill = document.getElementById('progressFill');
  const dot  = document.getElementById('progressDot');
  const pct  = document.getElementById('progressPercent');
  if (fill) fill.style.width = percent.toFixed(1) + '%';
  if (dot)  dot.style.left   = percent.toFixed(1) + '%';
  if (pct)  pct.textContent  = percent.toFixed(0) + '% chu kỳ phát triển';

  const fmtShort = d => d.toLocaleDateString('vi-VN', {day:'numeric', month:'short'});
  const startEl  = document.getElementById('progressStart');
  const endEl    = document.getElementById('progressEnd');
  const centerEl = document.getElementById('progressCenter');
  if (startEl) startEl.textContent = fmtShort(prevUpdate);
  if (endEl)   endEl.textContent   = fmtShort(nextUpdate);
  if (centerEl) centerEl.textContent = `Bảo trì: ${fmtShort(maintStart)}`;

  // Status badge
  const badge      = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  if (badge && statusText) {
    badge.className = 'status-badge ' + status;
    const map = {
      developing:  '🚀 Đang phát triển phiên bản mới',
      maintenance: '🔧 Server đang tạm đóng để bảo trì',
      released:    '✅ Phiên bản mới đã phát hành',
    };
    statusText.textContent = map[status] || '';
  }
}

// ============================================================
// TIMELINE
// ============================================================
function buildTimeline() {
  const now = new Date();
  const year = now.getFullYear();
  document.getElementById('currentYear').textContent = year;

  const updates = getUpdateDates(year);
  const grid = document.getElementById('timelineGrid');
  if (!grid) return;
  grid.innerHTML = '';

  updates.forEach((date, i) => {
    const maintStart = getMaintenanceStart(date);
    const isMaint   = (now >= maintStart && now < date);
    const prevDate  = i > 0 ? updates[i-1] : new Date(year - 1, 11, 2);
    const isCurrent = !isMaint && (now >= prevDate && now < date);
    const isDone    = now >= date;

    // Bỏ qua các ngày trước Relife 4 (tháng 2/2026 là mốc đầu)
    const isBeforeRelife4 = date < RELIFE_ORIGIN.date;

    const name = isBeforeRelife4 ? '—' : getRelifeName(date);
    const code = isBeforeRelife4 ? 'Chưa áp dụng' : getVersionCode(date);
    const dateStr = date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' });

    let cardClass   = 'timeline-card';
    let iconClass   = 'timeline-icon future-icon';
    let iconHtml    = '<i class="bi bi-clock"></i>';
    let statusClass = 'timeline-status st-future';
    let statusHtml  = '<i class="bi bi-clock"></i> Sắp tới';
    let extraHtml   = '';

    if (isBeforeRelife4) {
      // Không hiển thị (trước lịch cố định) — bỏ qua
      return;
    } else if (isDone && !isCurrent && !isMaint) {
      cardClass  += ' done';
      iconClass   = 'timeline-icon done-icon';
      iconHtml    = '<i class="bi bi-check-circle-fill"></i>';
      statusClass = 'timeline-status st-done';
      statusHtml  = '<i class="bi bi-check-circle-fill"></i> Đã phát hành';
      const daysAgo = Math.floor((now - date) / 86400000);
      extraHtml = `<div class="timeline-daysago">${daysAgo === 0 ? 'Hôm nay' : daysAgo + ' ngày trước'}</div>`;
    } else if (isMaint) {
      cardClass  += ' maintenance-mode';
      iconClass   = 'timeline-icon maint-icon';
      iconHtml    = '<i class="bi bi-tools"></i>';
      statusClass = 'timeline-status st-maint';
      statusHtml  = '<i class="bi bi-tools"></i> Đang bảo trì';
    } else if (isCurrent) {
      cardClass  += ' current';
      iconClass   = 'timeline-icon current-icon';
      iconHtml    = '<i class="bi bi-code-slash"></i>';
      statusClass = 'timeline-status st-current';
      statusHtml  = '<i class="bi bi-code-slash"></i> Đang phát triển';
    } else {
      const daysLeft = Math.ceil((date - now) / 86400000);
      extraHtml = `<div class="timeline-daysago">Còn ${daysLeft} ngày</div>`;
    }

    const card = document.createElement('div');
    card.className = cardClass;
    card.style.animationDelay = `${i * 0.08}s`;
    card.innerHTML = `
      <div class="timeline-card-top">
        <div class="${iconClass}">${iconHtml}</div>
        <div class="timeline-card-info">
          <div class="timeline-version">${name}</div>
          <div class="timeline-version-code">${code}</div>
          <div class="timeline-date"><i class="bi bi-calendar3 me-1"></i>${dateStr}</div>
        </div>
      </div>
      <div class="${statusClass}">${statusHtml}</div>
      ${extraHtml}
    `;
    grid.appendChild(card);
  });
}

// ============================================================
// CURRENT VERSION INFO PANEL
// ============================================================
function buildCurrentVersionPanel() {
  const panel = document.getElementById('currentVersionPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="cv-label">Phiên bản hiện tại</div>
    <div class="cv-name">${CURRENT_VERSION.name}</div>
    <div class="cv-code">${CURRENT_VERSION.code}</div>
    <div class="cv-date">
      <i class="bi bi-calendar-check me-1"></i>
      Phát hành ${CURRENT_VERSION.releaseDate.toLocaleDateString('vi-VN', {day:'numeric', month:'long', year:'numeric'})}
    </div>
    <div class="cv-note">
      <i class="bi bi-info-circle me-1"></i>
      Kể từ Relife 4, lịch cập nhật được cố định 2 tháng/lần vào ngày 2 của tháng chẵn.
      Các phiên bản trước đây (Relife 1–3) được cập nhật ngẫu nhiên.
    </div>
  `;
}

// ============================================================
// LEAKS
// ============================================================
let leakQuill   = null;
let currentUser = null;
let isAdmin     = false;
let leakModal   = null;

const esc = s => String(s || '').replace(/[&<>"']/g, m =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[m])
);

const fmtDate = ts => {
  try {
    if (!ts?.toDate) return '';
    return ts.toDate().toLocaleDateString('vi-VN', { day:'numeric', month:'long', year:'numeric' });
  } catch { return ''; }
};

const levelMap = {
  hint:    { label: '🔮 Gợi ý nhỏ',      css: 'hint' },
  partial: { label: '⚡ Rò rỉ một phần', css: 'partial' },
  major:   { label: '🔥 Tiết lộ lớn',    css: 'major' },
};

function loadLeaks() {
  const list = document.getElementById('leaksList');
  if (!list) return;

  const q = query(collection(db, 'roadmap_leaks'), orderBy('createdAt', 'desc'));
  onSnapshot(q, snap => {
    if (snap.empty) {
      list.innerHTML = `
        <div class="leaks-empty">
          <i class="bi bi-lock" style="font-size:2.5rem;opacity:0.3;"></i>
          <div style="margin-top:12px;color:var(--text-secondary);">Chưa có rò rỉ nào được đăng</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;">Admin sẽ tiết lộ sớm thôi!</div>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    snap.docs.forEach((docSnap, idx) => {
      const d  = docSnap.data();
      const lv = levelMap[d.level] || levelMap.hint;

      const card = document.createElement('div');
      card.className = `leak-card level-${lv.css}`;
      card.style.animationDelay = `${idx * 0.07}s`;

      card.innerHTML = `
        <div class="leak-header">
          <div class="leak-title">${esc(d.title || 'Rò rỉ')}</div>
          <div class="leak-level-badge ${lv.css}">${lv.label}</div>
        </div>
        <div class="leak-meta">
          <span><i class="bi bi-calendar3 me-1"></i>${fmtDate(d.createdAt)}</span>
          ${d.version ? `<span><i class="bi bi-tag me-1"></i>${esc(d.version)}</span>` : ''}
        </div>
        <div class="leak-content">${d.content || ''}</div>
        ${isAdmin ? `
          <div class="leak-admin-actions">
            <button class="btn-leak-delete" data-id="${docSnap.id}">
              <i class="bi bi-trash me-1"></i>Xóa
            </button>
          </div>
        ` : ''}
      `;

      if (isAdmin) {
        card.querySelector('.btn-leak-delete')?.addEventListener('click', () => {
          if (confirm('Xóa rò rỉ này?')) {
            deleteDoc(doc(db, 'roadmap_leaks', docSnap.id));
          }
        });
      }

      list.appendChild(card);
    });
  }, err => {
    console.error('Leaks load error:', err);
    list.innerHTML = `<div class="leaks-empty" style="color:var(--liquid-danger);">Lỗi tải dữ liệu: ${esc(err.message)}</div>`;
  });
}

window.openLeakEditor = function () {
  if (!leakModal) leakModal = new bootstrap.Modal(document.getElementById('leakEditorModal'));
  if (!leakQuill) {
    leakQuill = new Quill('#leakEditor', {
      theme: 'snow',
      modules: { toolbar: [['bold','italic','underline'],[{list:'ordered'},{list:'bullet'}],['link','code-block'],['clean']] },
      placeholder: 'Mô tả rò rỉ...'
    });
  }
  leakModal.show();
};

window.submitLeak = async function () {
  if (!currentUser || !isAdmin) { alert('Bạn không có quyền đăng rò rỉ!'); return; }

  const title   = document.getElementById('leakTitle')?.value?.trim();
  const level   = document.getElementById('leakLevel')?.value;
  const version = document.getElementById('leakVersion')?.value?.trim();
  const content = leakQuill?.root?.innerHTML || '';

  if (!title) { alert('Vui lòng nhập tiêu đề!'); return; }
  if (leakQuill?.getText()?.trim().length < 5) { alert('Nội dung quá ngắn!'); return; }

  const btn = document.getElementById('btnSubmitLeak');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang đăng...'; }

  try {
    await addDoc(collection(db, 'roadmap_leaks'), {
      title, level, version, content,
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    document.getElementById('leakTitle').value  = '';
    document.getElementById('leakVersion').value = '';
    if (leakQuill) leakQuill.root.innerHTML = '';
    leakModal?.hide();
  } catch (e) {
    alert('Lỗi khi đăng: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send me-1"></i>Đăng rò rỉ'; }
  }
};

// ============================================================
// AUTH
// ============================================================
async function checkAdmin(uid) {
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    return userDoc.exists() && userDoc.data()?.type === 'admin';
  } catch { return false; }
}

function updateMenuAuth(user) {
  const area     = document.getElementById('menuAuthArea');
  const userInfo = document.getElementById('menuUserInfo');
  if (!area) return;

  if (user) {
    area.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8f9fa;border-radius:12px;">
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||user.email||'U')}&background=007AFF&color=fff&size=40"
             style="width:40px;height:40px;border-radius:50%;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.displayName||user.email||'Người dùng')}</div>
          ${isAdmin ? '<div style="font-size:0.7rem;color:#FF9500;font-weight:700;">⭐ ADMIN</div>' : ''}
        </div>
        <button onclick="doLogout()" style="background:none;border:none;color:#dc3545;font-size:0.8rem;cursor:pointer;">Đăng xuất</button>
      </div>
    `;
    if (userInfo) userInfo.textContent = user.uid;
  } else {
    area.innerHTML = `
      <button onclick="openLoginModal()" style="width:100%;padding:10px;background:linear-gradient(135deg,#0d6efd,#5856D6);color:white;border:none;border-radius:12px;font-weight:700;cursor:pointer;">
        <i class="bi bi-person me-2"></i>Đăng nhập
      </button>
    `;
    if (userInfo) userInfo.textContent = '';
  }
}

window.openLoginModal = function () {
  const m = new bootstrap.Modal(document.getElementById('loginModal'));
  m.show();
};

window.doLogin = async function () {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const pass  = document.getElementById('loginPassword')?.value;
  const errEl = document.getElementById('loginError');
  if (errEl) errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
  } catch {
    if (errEl) errEl.textContent = 'Email hoặc mật khẩu không đúng.';
  }
};

window.doLogout = function () { signOut(auth); };

// ============================================================
// INIT
// ============================================================
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin = user ? await checkAdmin(user.uid) : false;
  updateMenuAuth(user);
  const btnAddLeak = document.getElementById('btnAddLeak');
  if (btnAddLeak) btnAddLeak.style.display = isAdmin ? 'inline-flex' : 'none';
  loadLeaks();
});

updateCountdown();
setInterval(updateCountdown, 1000);
buildTimeline();
buildCurrentVersionPanel();