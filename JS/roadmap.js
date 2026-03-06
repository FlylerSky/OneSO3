// JS/roadmap.js — Relife Tiến trình
// Toàn bộ config (phiên bản gốc, phiên bản hiện tại, lịch cập nhật)
// được đọc từ Firestore doc: config/roadmap
// Không có giá trị hardcode nào trong source.

import { initFirebase } from '../firebase-config.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  collection, doc, getDoc, setDoc, onSnapshot,
  query, orderBy, addDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db   = initFirebase();
const auth = getAuth();

// ============================================================
// STATE — sẽ được điền sau khi load config từ Firestore
// ============================================================
let CFG = null; // object config từ Firestore
/*
  Cấu trúc Firestore doc: config/roadmap
  {
    originN:          4,          // Số hiệu phiên bản của mốc khởi đầu lịch cố định
    originTimestamp:  Timestamp,  // Ngày phát hành của mốc đó (VD: 2/2/2026)
    originCode:       "r4.2.226", // Mã phiên bản chính xác của mốc đó
    currentName:      "Relife 4", // Tên phiên bản hiện tại
    currentCode:      "r4.2.226", // Mã phiên bản hiện tại
    currentTimestamp: Timestamp,  // Ngày phát hành phiên bản hiện tại
    currentPatchNum:  2,          // Số bản vá phiên bản hiện tại (X)
    updateMonths:     [2,4,6,8,10,12], // Các tháng có cập nhật
    updateDay:        2,          // Ngày trong tháng có cập nhật
    maintenanceDaysBefore: 2,     // Số ngày trước khi server đóng
  }
*/

// ============================================================
// HELPERS — VERSIONING (dùng CFG, không hardcode)
// ============================================================
const UPDATE_MONTHS_DEFAULT = [2, 4, 6, 8, 10, 12];
const UPDATE_DAY_DEFAULT    = 2;
const MAINT_DAYS_DEFAULT    = 2;

function getUpdateMonths()     { return CFG?.updateMonths         || UPDATE_MONTHS_DEFAULT; }
function getUpdateDay()        { return CFG?.updateDay            || UPDATE_DAY_DEFAULT; }
function getMaintenanceDays()  { return CFG?.maintenanceDaysBefore || MAINT_DAYS_DEFAULT; }
function getOriginDate()       { return CFG?.originTimestamp?.toDate?.() || null; }
function getOriginN()          { return CFG?.originN ?? null; }

function getUpdateDates(year) {
  return getUpdateMonths().map(m => new Date(year, m - 1, getUpdateDay(), 0, 0, 0, 0));
}

function getMaintenanceStart(updateDate) {
  return new Date(updateDate.getTime() - getMaintenanceDays() * 24 * 3600 * 1000);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

/**
 * Tính số hiệu phiên bản N cho một ngày update.
 * Dựa thuần vào originN và originMonth/originYear từ CFG — không so sánh Date objects.
 * Công thức: N = originN + số chu kỳ từ origin đến updateDate
 * Mỗi chu kỳ = 2 tháng (hoặc khoảng cách giữa các updateMonths)
 */
function calcN(updateDate) {
  const originN = getOriginN();
  if (originN === null) return '?';

  // Lấy originMonth và originYear từ CFG.originTimestamp
  const originTs = CFG?.originTimestamp?.toDate?.();
  if (!originTs) return '?';
  const originYear  = originTs.getFullYear();
  const originMonth = originTs.getMonth() + 1; // 1-indexed

  const months = [...getUpdateMonths()].sort((a, b) => a - b);

  // Tìm index của originMonth trong mảng updateMonths
  const originIdx = months.indexOf(originMonth);
  if (originIdx === -1) return '?';

  // Tìm index của updateDate month trong mảng updateMonths  
  const updateMonth = updateDate.getMonth() + 1;
  const updateYear  = updateDate.getFullYear();
  const updateIdx   = months.indexOf(updateMonth);
  if (updateIdx === -1) return '?';

  // Tổng số chu kỳ = (năm diff * số update/năm) + (index diff)
  const cyclesPerYear = months.length;
  const yearDiff  = updateYear - originYear;
  const indexDiff = updateIdx - originIdx;
  const totalCycles = yearDiff * cyclesPerYear + indexDiff;

  return originN + totalCycles;
}

/** Mã MMYY: tháng không pad zero, năm 2 chữ số */
function buildMMYY(date) {
  const m  = date.getMonth() + 1;
  const yy = date.getFullYear() % 100;
  return `${m}${yy}`;
}

/** Tên phiên bản: "Relife N" */
function getRelifeName(updateDate) {
  const n = calcN(updateDate);
  if (n === null || n === '?') return '—';
  return `Relife ${n}`;
}

/**
 * Mã phiên bản: rN.X.MMYY
 * - Nếu N == originN → dùng originCode từ config (phiên bản gốc đã biết chính xác)
 * - Phiên bản tương lai → X = "?"
 */
function getVersionCode(updateDate) {
  const n = calcN(updateDate);
  if (n === null || n === '?') return '';
  // Nếu là phiên bản gốc (N == originN) → dùng code lưu trong config
  if (n === getOriginN() && CFG?.originCode) return CFG.originCode;
  return `r${n}.?.${buildMMYY(updateDate)}`;
}

// ============================================================
// CYCLE INFO
// ============================================================
function getAllUpdateDatesFromOrigin() {
  const origin = getOriginDate();
  if (!origin) return [];
  const now  = new Date();
  const year = now.getFullYear();
  let dates = [
    ...getUpdateDates(year - 1),
    ...getUpdateDates(year),
    ...getUpdateDates(year + 1),
  ].filter(d => d >= origin);
  dates.sort((a, b) => a - b);
  return dates;
}

function getCurrentCycleInfo() {
  const now   = new Date();
  const dates = getAllUpdateDatesFromOrigin();
  if (!dates.length) return null;

  let nextIdx = dates.findIndex(d => d > now);
  if (nextIdx === -1) nextIdx = dates.length - 1;

  const nextUpdate = dates[nextIdx];
  const prevUpdate = dates[nextIdx - 1] || getOriginDate();
  const maintStart = getMaintenanceStart(nextUpdate);

  let status = 'developing';
  if (now >= maintStart && now < nextUpdate) status = 'maintenance';
  else if (now >= nextUpdate) status = 'released';

  const cycleLength = nextUpdate - prevUpdate;
  const elapsed     = now - prevUpdate;
  const percent     = Math.max(0, Math.min(100, (elapsed / cycleLength) * 100));

  return { nextUpdate, prevUpdate, maintStart, status, percent };
}

// ============================================================
// COUNTDOWN
// ============================================================
function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }
let countdownTimer = null;

function updateCountdown() {
  if (!CFG) return;
  const info = getCurrentCycleInfo();
  if (!info) return;
  const { nextUpdate, prevUpdate, maintStart, status, percent } = info;
  const now = new Date();

  // Target đếm ngược
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
    const s = ms / 1000;
    tickEl('cdDays',    Math.floor(s / 86400));
    tickEl('cdHours',   Math.floor((s % 86400) / 3600));
    tickEl('cdMinutes', Math.floor((s % 3600) / 60));
    tickEl('cdSeconds', Math.floor(s % 60));
  } else {
    ['cdDays','cdHours','cdMinutes','cdSeconds'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '00';
    });
  }

  // Tên + mã phiên bản tiếp theo
  setText('heroVersion',     getRelifeName(nextUpdate));
  setText('heroVersionCode', getVersionCode(nextUpdate));

  // Label & subtitle — rõ ràng theo từng trạng thái
  const nextName    = getRelifeName(nextUpdate);
  const nextDateStr = nextUpdate.toLocaleDateString('vi-VN', { day:'numeric', month:'long', year:'numeric' });
  const maintStr    = getMaintenanceStart(nextUpdate).toLocaleDateString('vi-VN', { day:'numeric', month:'long' });

  if (status === 'developing') {
    // Đang trong chu kỳ phát triển → đếm ngược đến khi server đóng
    setText('heroLabel',    `Đang phát triển ${nextName} — server đóng sau`);
    setText('heroSubtitle', `Server tạm đóng ngày ${maintStr} · Ra mắt ngày ${nextDateStr}`);
  } else if (status === 'maintenance') {
    // Server đang đóng → đếm ngược đến ngày ra mắt
    setText('heroLabel',    `${nextName} ra mắt sau`);
    setText('heroSubtitle', `Server đang tạm đóng để chuẩn bị · Ra mắt ngày ${nextDateStr}`);
  } else {
    setText('heroLabel',    `${nextName} đã ra mắt`);
    setText('heroSubtitle', `Phát hành ngày ${nextDateStr}`);
  }

  // Progress bar
  setStyle('progressFill',  'width', percent.toFixed(1) + '%');
  setStyle('progressDot',   'left',  percent.toFixed(1) + '%');
  setText ('progressPercent', percent.toFixed(0) + '% chu kỳ phát triển');

  const fmtShort = d => d.toLocaleDateString('vi-VN', { day:'numeric', month:'short' });
  setText('progressStart',  fmtShort(prevUpdate));
  setText('progressEnd',    fmtShort(nextUpdate));
  setText('progressCenter', `Bảo trì: ${fmtShort(maintStart)}`);

  // Status badge
  const badge = document.getElementById('statusBadge');
  const stTxt = document.getElementById('statusText');
  if (badge) badge.className = 'status-badge ' + status;
  if (stTxt) stTxt.textContent = {
    developing:  '🚀 Đang phát triển phiên bản mới',
    maintenance: '🔧 Server đang tạm đóng để bảo trì',
    released:    '✅ Phiên bản mới đã phát hành',
  }[status] || '';
}

function setText(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}
function setStyle(id, prop, val) {
  const el = document.getElementById(id); if (el) el.style[prop] = val;
}

// ============================================================
// TIMELINE — hiển thị đầy đủ phiên bản của năm hiện tại
// Nếu tất cả phiên bản trong năm đã phát hành → tự động hiển thị sang năm sau
// ============================================================
function buildTimeline() {
  if (!CFG) return;
  const now  = new Date();
  const grid = document.getElementById('timelineGrid');
  if (!grid) return;
  grid.innerHTML = '';

  // Xác định năm cần hiển thị:
  // - Nếu update cuối cùng của năm hiện tại đã qua → hiển thị năm sau
  // - Còn không → hiển thị năm hiện tại
  const thisYear    = now.getFullYear();
  const lastOfYear  = getUpdateDates(thisYear).at(-1);
  const displayYear = (lastOfYear && now > lastOfYear) ? thisYear + 1 : thisYear;

  setText('currentYear', displayYear);

  // Lấy tất cả update của năm hiển thị — không filter bỏ gì cả
  const updates = getUpdateDates(displayYear);

  // prevDate cho card đầu tiên = update cuối của năm trước
  const lastOfPrevYear = getUpdateDates(displayYear - 1).at(-1);

  updates.forEach((date, i) => {
    const maintStart = getMaintenanceStart(date);
    const prevDate   = i > 0 ? updates[i - 1] : lastOfPrevYear;
    const isDone     = now >= date;
    const isMaint    = !isDone && now >= maintStart;
    const isCurrent  = !isDone && !isMaint && now >= prevDate;

    const name    = getRelifeName(date);
    const code    = getVersionCode(date);
    const dateStr = date.toLocaleDateString('vi-VN', { day:'numeric', month:'long' });

    let cardClass   = 'timeline-card';
    let iconClass   = 'timeline-icon future-icon';
    let iconHtml    = '<i class="bi bi-clock"></i>';
    let statusClass = 'timeline-status st-future';
    let statusHtml  = '<i class="bi bi-clock"></i> Sắp tới';
    let extraHtml   = '';

    if (isDone) {
      cardClass   += ' done';
      iconClass    = 'timeline-icon done-icon';
      iconHtml     = '<i class="bi bi-check-circle-fill"></i>';
      statusClass  = 'timeline-status st-done';
      statusHtml   = '<i class="bi bi-check-circle-fill"></i> Đã phát hành';
      const ago    = Math.floor((now - date) / 86400000);
      extraHtml    = `<div class="timeline-daysago">${ago === 0 ? 'Hôm nay' : ago + ' ngày trước'}</div>`;
    } else if (isMaint) {
      cardClass   += ' maintenance-mode';
      iconClass    = 'timeline-icon maint-icon';
      iconHtml     = '<i class="bi bi-tools"></i>';
      statusClass  = 'timeline-status st-maint';
      statusHtml   = '<i class="bi bi-tools"></i> Đang bảo trì';
    } else if (isCurrent) {
      cardClass   += ' current';
      iconClass    = 'timeline-icon current-icon';
      iconHtml     = '<i class="bi bi-code-slash"></i>';
      statusClass  = 'timeline-status st-current';
      statusHtml   = '<i class="bi bi-code-slash"></i> Đang phát triển';
    } else {
      const left   = Math.ceil((date - now) / 86400000);
      extraHtml    = `<div class="timeline-daysago">Còn ${left} ngày</div>`;
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
// CURRENT VERSION PANEL — từ CFG
// ============================================================
function buildCurrentVersionPanel() {
  if (!CFG) return;
  const panel = document.getElementById('currentVersionPanel');
  if (!panel) return;

  const releaseTs   = CFG.currentTimestamp?.toDate?.();
  const releaseDateStr = releaseTs
    ? releaseTs.toLocaleDateString('vi-VN', { day:'numeric', month:'long', year:'numeric' })
    : '—';

  panel.innerHTML = `
    <div class="cv-label">Phiên bản hiện tại</div>
    <div class="cv-name">${esc(CFG.currentName || '—')}</div>
    <div class="cv-code">${esc(CFG.currentCode || '—')}</div>
    <div class="cv-date">
      <i class="bi bi-calendar-check me-1"></i>
      Phát hành ${releaseDateStr}
    </div>
    <div class="cv-note">
      <i class="bi bi-info-circle me-1"></i>
      Kể từ ${esc(CFG.currentName?.split(' ')[0] || 'Relife')} ${getOriginN()},
      lịch cập nhật được cố định ${getUpdateMonths().length} lần/năm vào ngày
      ${getUpdateDay()} của tháng ${getUpdateMonths().join(', ')}.
      Các phiên bản trước đây được cập nhật ngẫu nhiên.
    </div>
  `;
}

// ============================================================
// ADMIN — EDIT CONFIG MODAL
// ============================================================
function buildAdminConfigBtn() {
  const section = document.getElementById('adminConfigSection');
  if (!section) return;
  if (!isAdmin) { section.style.display = 'none'; return; }
  section.style.display = 'block';
}

window.openConfigEditor = async function () {
  if (!isAdmin) return;
  // Điền dữ liệu hiện tại vào form
  const c = CFG || {};
  setVal('cfgOriginN',       c.originN           ?? '');
  setVal('cfgOriginCode',    c.originCode         ?? '');
  setVal('cfgOriginDate',    tsToInputDate(c.originTimestamp));
  setVal('cfgCurrentName',   c.currentName        ?? '');
  setVal('cfgCurrentCode',   c.currentCode        ?? '');
  setVal('cfgCurrentDate',   tsToInputDate(c.currentTimestamp));
  setVal('cfgCurrentPatch',  c.currentPatchNum    ?? '');
  setVal('cfgUpdateMonths',  (c.updateMonths       || UPDATE_MONTHS_DEFAULT).join(', '));
  setVal('cfgUpdateDay',     c.updateDay           ?? UPDATE_DAY_DEFAULT);
  setVal('cfgMaintDays',     c.maintenanceDaysBefore ?? MAINT_DAYS_DEFAULT);

  const m = new bootstrap.Modal(document.getElementById('configEditorModal'));
  m.show();
};

window.saveConfig = async function () {
  if (!isAdmin) return;
  const btn = document.getElementById('btnSaveConfig');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang lưu...'; }

  try {
    const originDate  = new Date(document.getElementById('cfgOriginDate')?.value);
    const currentDate = new Date(document.getElementById('cfgCurrentDate')?.value);
    const months = document.getElementById('cfgUpdateMonths')?.value
      .split(/[,\s]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 12);

    const data = {
      originN:                parseInt(document.getElementById('cfgOriginN')?.value)       || null,
      originCode:             document.getElementById('cfgOriginCode')?.value?.trim()       || null,
      originTimestamp:        isNaN(originDate)  ? null : originDate,
      currentName:            document.getElementById('cfgCurrentName')?.value?.trim()      || null,
      currentCode:            document.getElementById('cfgCurrentCode')?.value?.trim()      || null,
      currentTimestamp:       isNaN(currentDate) ? null : currentDate,
      currentPatchNum:        parseInt(document.getElementById('cfgCurrentPatch')?.value)  || null,
      updateMonths:           months.length ? months : UPDATE_MONTHS_DEFAULT,
      updateDay:              parseInt(document.getElementById('cfgUpdateDay')?.value)      || UPDATE_DAY_DEFAULT,
      maintenanceDaysBefore:  parseInt(document.getElementById('cfgMaintDays')?.value)      || MAINT_DAYS_DEFAULT,
      updatedAt:              serverTimestamp(),
    };

    await setDoc(doc(db, 'config', 'roadmap'), data, { merge: true });
    bootstrap.Modal.getInstance(document.getElementById('configEditorModal'))?.hide();
  } catch (e) {
    alert('Lỗi khi lưu: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-floppy me-1"></i>Lưu cấu hình'; }
  }
};

function tsToInputDate(ts) {
  try {
    const d = ts?.toDate?.() || (ts instanceof Date ? ts : null);
    if (!d) return '';
    return d.toISOString().slice(0, 10);
  } catch { return ''; }
}

function setVal(id, val) {
  const el = document.getElementById(id); if (el) el.value = val;
}

// ============================================================
// CONFIG LOADER — lắng nghe Firestore realtime
// ============================================================
function listenConfig() {
  const configRef = doc(db, 'config', 'roadmap');

  // Hiển thị skeleton loading
  showLoading(true);

  onSnapshot(configRef, snap => {
    if (snap.exists()) {
      CFG = snap.data();
    } else {
      // Doc chưa tồn tại → CFG = null, trang hiển thị thông báo admin cần thiết lập
      CFG = null;
    }
    showLoading(false);
    renderAll();
  }, err => {
    console.error('Config load error:', err);
    showLoading(false);
    showConfigError(err);
  });
}

function renderAll() {
  if (!CFG) {
    showNoConfig();
    return;
  }
  updateCountdown();
  buildTimeline();
  buildCurrentVersionPanel();
  buildAdminConfigBtn();
}

function showLoading(on) {
  const el = document.getElementById('pageLoadingOverlay');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function showNoConfig() {
  // Nếu là admin → gợi ý thiết lập; nếu không → thông báo đang chờ config
  const hero = document.getElementById('heroSubtitle');
  if (hero) hero.textContent = isAdmin
    ? 'Chưa có cấu hình. Nhấn "Thiết lập cấu hình" để bắt đầu.'
    : 'Đang chờ Admin thiết lập cấu hình roadmap...';

  setText('heroVersion', '—');
  setText('heroVersionCode', '—');
  buildAdminConfigBtn();
}

function showConfigError(err) {
  const isPermission = err?.code === 'permission-denied';

  // Hero subtitle
  const hero = document.getElementById('heroSubtitle');
  if (hero) hero.textContent = isPermission
    ? 'Không có quyền đọc cấu hình — xem hướng dẫn bên dưới'
    : `Lỗi tải dữ liệu: ${err?.message || err}`;

  // Hiện banner hướng dẫn fix
  const banner = document.getElementById('permissionErrorBanner');
  if (banner) {
    banner.style.display = 'block';
    if (!isPermission) {
      // Lỗi khác — hiện message chung
      banner.innerHTML = `
        <div class="perm-banner-icon"><i class="bi bi-exclamation-triangle-fill"></i></div>
        <div>
          <div class="perm-banner-title">Lỗi tải cấu hình</div>
          <div class="perm-banner-desc">${err?.message || err}</div>
        </div>`;
    }
  }

  // Vẫn render timeline/countdown với defaults để trang không trắng
  CFG = null;
  setText('heroVersion', '—');
  setText('heroVersionCode', '—');
  buildTimeline();
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
  hint:    { label: '🔮 Gợi ý nhỏ',       css: 'hint' },
  partial: { label: '⚡ Rò rỉ một phần',  css: 'partial' },
  major:   { label: '🔥 Tiết lộ lớn',     css: 'major' },
};

function loadLeaks() {
  const list = document.getElementById('leaksList');
  if (!list) return;

  onSnapshot(query(collection(db, 'roadmap_leaks'), orderBy('createdAt', 'desc')), snap => {
    if (snap.empty) {
      list.innerHTML = `
        <div class="leaks-empty">
          <i class="bi bi-lock" style="font-size:2.5rem;opacity:0.3;"></i>
          <div style="margin-top:12px;color:var(--text-secondary);">Chưa có rò rỉ nào được đăng</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;">Admin sẽ tiết lộ sớm thôi!</div>
        </div>`;
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
        ${isAdmin ? `<div class="leak-admin-actions">
          <button class="btn-leak-delete" data-id="${docSnap.id}"><i class="bi bi-trash me-1"></i>Xóa</button>
        </div>` : ''}
      `;
      if (isAdmin) {
        card.querySelector('.btn-leak-delete')?.addEventListener('click', () => {
          if (confirm('Xóa rò rỉ này?')) deleteDoc(doc(db, 'roadmap_leaks', docSnap.id));
        });
      }
      list.appendChild(card);
    });
  }, err => {
    list.innerHTML = `<div class="leaks-empty" style="color:var(--liquid-danger);">Lỗi: ${esc(err.message)}</div>`;
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
  if (!currentUser || !isAdmin) { alert('Bạn không có quyền!'); return; }
  const title   = document.getElementById('leakTitle')?.value?.trim();
  const level   = document.getElementById('leakLevel')?.value;
  const version = document.getElementById('leakVersion')?.value?.trim();
  const content = leakQuill?.root?.innerHTML || '';
  if (!title) { alert('Vui lòng nhập tiêu đề!'); return; }
  if (leakQuill?.getText()?.trim().length < 5) { alert('Nội dung quá ngắn!'); return; }
  const btn = document.getElementById('btnSubmitLeak');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang đăng...'; }
  try {
    await addDoc(collection(db, 'roadmap_leaks'), { title, level, version, content, authorUid: currentUser.uid, createdAt: serverTimestamp() });
    document.getElementById('leakTitle').value = '';
    document.getElementById('leakVersion').value = '';
    if (leakQuill) leakQuill.root.innerHTML = '';
    leakModal?.hide();
  } catch (e) { alert('Lỗi: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-send me-1"></i>Đăng rò rỉ'; } }
};

// ============================================================
// AUTH
// ============================================================
async function checkAdmin(uid) {
  try {
    const d = await getDoc(doc(db, 'users', uid));
    return d.exists() && d.data()?.type === 'admin';
  } catch { return false; }
}

function updateMenuAuth(user) {
  const area = document.getElementById('menuAuthArea');
  if (!area) return;
  if (user) {
    area.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8f9fa;border-radius:12px;">
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||user.email||'U')}&background=007AFF&color=fff&size=40" style="width:40px;height:40px;border-radius:50%;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(user.displayName||user.email||'Người dùng')}</div>
          ${isAdmin ? '<div style="font-size:0.7rem;color:#FF9500;font-weight:700;">⭐ ADMIN</div>' : ''}
        </div>
        <button onclick="doLogout()" style="background:none;border:none;color:#dc3545;font-size:0.8rem;cursor:pointer;">Đăng xuất</button>
      </div>`;

  } else {
    area.innerHTML = `<button onclick="openLoginModal()" style="width:100%;padding:10px;background:linear-gradient(135deg,#0d6efd,#5856D6);color:white;border:none;border-radius:12px;font-weight:700;cursor:pointer;"><i class="bi bi-person me-2"></i>Đăng nhập</button>`;
  }
}

window.openLoginModal = () => new bootstrap.Modal(document.getElementById('loginModal')).show();
window.doLogin = async function () {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const pass  = document.getElementById('loginPassword')?.value;
  const errEl = document.getElementById('loginError');
  if (errEl) errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    bootstrap.Modal.getInstance(document.getElementById('loginModal'))?.hide();
  } catch { if (errEl) errEl.textContent = 'Email hoặc mật khẩu không đúng.'; }
};
window.doLogout = () => signOut(auth);

// ============================================================
// INIT
// ============================================================
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin     = user ? await checkAdmin(user.uid) : false;
  updateMenuAuth(user);
  const btnAddLeak = document.getElementById('btnAddLeak');
  if (btnAddLeak) btnAddLeak.style.display = isAdmin ? 'inline-flex' : 'none';
  buildAdminConfigBtn();
  loadLeaks();
});

// Bắt đầu lắng nghe config từ Firestore
listenConfig();

// Countdown refresh mỗi giây (chỉ chạy sau khi CFG đã có)
setInterval(() => { if (CFG) updateCountdown(); }, 1000);