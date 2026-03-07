// JS/profile.js — Relife Profile V3.2
// ✅ Cover photo (URL + transform: scale/translateX/translateY)
// ✅ Avatar frame picker (3 free + 9 special unlocked via achievements)
// ✅ Avatar transform controls (scale/translateX/translateY)
// ✅ Grouped achievements modal (Đồng hành group + frame reward badges)
// ✅ Profile edit in modal (not inline)
// ✅ All existing features preserved

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

// ─── Firebase init ────────────────────────────────────────
const db   = initFirebase();
const auth = getAuth();

// ─── DOM refs ─────────────────────────────────────────────
const profileArea          = document.getElementById('profileArea');
const profileSearchInput   = document.getElementById('profileSearchInput');
const profileSearchResults = document.getElementById('profileSearchResults');
const menuToggleBtn        = document.getElementById('menuToggleBtn');
const profileMenuCanvas    = document.getElementById('profileMenuCanvas');
const menuAuthAreaProfile  = document.getElementById('menuAuthAreaProfile');
const openAchievementsBtn  = document.getElementById('openAchievementsBtn');
const openVisitorsBtn      = document.getElementById('openVisitorsBtn');
const visitorsListEl       = document.getElementById('visitorsList');
// commentsModalEl / postEditorModalEl removed — accessed via getModal() helper

// ─── Lazy Bootstrap modal getter ─────────────────────────
// ES modules run deferred — top-level new bootstrap.Modal()
// can fail if the element resolves to null at parse time.
// Use getOrCreateInstance lazily at each call-site instead.
function getModal(id) {
  const el = document.getElementById(id);
  if (!el) return { show(){}, hide(){} };
  return bootstrap.Modal.getOrCreateInstance(el);
}

// Thin wrappers so the rest of the code stays unchanged
const commentsModal     = { show: () => getModal('profileCommentsModal').show(), hide: () => getModal('profileCommentsModal').hide() };
const loginModalProfile = { show: () => getModal('loginModalProfile').show(),    hide: () => getModal('loginModalProfile').hide() };
const postEditorModal   = { show: () => getModal('postEditorModal').show(),       hide: () => getModal('postEditorModal').hide() };
const profileEditModal  = { show: () => getModal('profileEditModal').show(),      hide: () => getModal('profileEditModal').hide() };
const avatarFrameModal  = { show: () => getModal('avatarFrameModal').show(),      hide: () => getModal('avatarFrameModal').hide() };
const achievementsModal = { show: () => getModal('achievementsModal').show(),     hide: () => getModal('achievementsModal').hide() };

// ─── State ────────────────────────────────────────────────
let currentUser   = null;
let profileUid    = null;   // UID of the profile being viewed
let userDoc       = null;   // Firestore data of profile user
let postsUnsub    = null;
let commentsUnsub = null;
let lastPostsDocs = [];
let currentCommentsPostId = null;
let quillEditor   = null;
let bioQuill      = null;   // Quill for bio in edit modal

// Frame picker state
let selectedFrameId    = null;  // currently selected (not yet applied) frame in picker
let isLoadingProfile   = false; // guard against concurrent loadProfile calls

// ─── AVATAR_FRAMES resolver ───────────────────────────────
// avatar_frames_data.js is a plain <script> (not a module),
// so its top-level `const` is NOT on window in strict mode.
// We capture it once at DOMContentLoaded when it IS accessible
// as a script-scope global, then keep a module-level reference.
let _FRAMES = null;
function getAvatarFrames() {
  if (_FRAMES) return _FRAMES;
  // Try every access pattern the browser might expose it under
  try { if (typeof AVATAR_FRAMES !== 'undefined') { _FRAMES = AVATAR_FRAMES; return _FRAMES; } } catch(_) {}
  if (window.AVATAR_FRAMES) { _FRAMES = window.AVATAR_FRAMES; return _FRAMES; }
  return null;
}

// ─── Utilities ────────────────────────────────────────────
const esc = s => String(s || '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const fmtDate = ts => {
  try {
    if (!ts?.toDate) return '';
    const d = ts.toDate(), now = new Date(), diff = now - d;
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), dy = Math.floor(diff / 86400000);
    if (m < 1)  return 'Vừa xong';
    if (m < 60) return `${m} phút trước`;
    if (h < 24) return `${h} giờ trước`;
    if (dy < 7) return `${dy} ngày trước`;
    return d.toLocaleDateString('vi-VN');
  } catch { return ''; }
};

function getAvatarUrl(profile, fallback) {
  return profile?.avatarUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fallback || 'U')}&background=0D6EFD&color=fff&size=256`;
}

function buildAvatarStyle(settings) {
  // Avatar img fills the clipped circle container; transform is applied
  // via object-position + scale so the frame (absolute overlay) always
  // perfectly covers the circle regardless of transform.
  // We use CSS on the <img> inside a clipped wrapper.
  return ''; // transform applied via CSS class + inline vars (see renderProfile)
}
function avatarTransformVars(settings) {
  const sc = (settings?.scale      ?? 100) / 100;
  const tx = settings?.translateX ?? 0;
  const ty = settings?.translateY ?? 0;
  return `--av-scale:${sc};--av-tx:${tx}px;--av-ty:${ty}px;`;
}

function buildCoverStyle(settings) {
  if (!settings) return '';
  const sc = settings.scale      ?? 100;
  const tx = settings.translateX ?? 0;
  const ty = settings.translateY ?? 0;
  return `transform:scale(${sc/100}) translate(${tx}px,${ty}px);transform-origin:center center;`;
}

// ═══════════════════════════════════════════════════════════
// INIT — URL param parsing + auth listener
// ═══════════════════════════════════════════════════════════
const params = new URLSearchParams(location.search);
profileUid = params.get('user') || null;

menuToggleBtn.addEventListener('click', () =>
  new bootstrap.Offcanvas(profileMenuCanvas).toggle());

// Quill for post editor
function ensureQuill() {
  if (quillEditor) return;
  if (!document.getElementById('editorQuill')) return;
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

onAuthStateChanged(auth, async user => {
  currentUser = user;
  // applyFeatureFlags once per auth change (does not need quill)
  await applyFeatureFlags('profile');
  const targetUid = profileUid || (user ? user.uid : null);
  if (!targetUid) {
    profileArea.innerHTML = `
      <div class="text-center p-4">
        <div class="mb-3">Bạn chưa đăng nhập.</div>
        <a class="btn btn-primary" href="index.html">Về trang chủ</a>
      </div>`;
    return;
  }
  if (!profileUid) profileUid = targetUid;
  loadProfile(targetUid);
});

window.addEventListener('beforeunload', () => {
  if (postsUnsub) postsUnsub();
});

// ═══════════════════════════════════════════════════════════
// LOAD PROFILE
// ═══════════════════════════════════════════════════════════
async function loadProfile(uid) {
  if (isLoadingProfile) return;
  isLoadingProfile = true;
  try {
    profileArea.innerHTML = `<div class="text-center text-muted py-5">Đang tải...</div>`;

    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      profileArea.innerHTML = `<div class="text-center p-4 text-danger">Không tìm thấy người dùng.</div>`;
      return;
    }

    userDoc = { id: snap.id, ...snap.data() };
    renderProfile(uid);

    // Subscribe follow counts
    subscribeFollowerCounts(uid);

    // Subscribe posts
    subscribePosts(uid);

    // Record visitor
    if (currentUser && currentUser.uid !== uid) {
      try {
        let vProf = null;
        try {
          const vs = await getDoc(doc(db, 'users', currentUser.uid));
          if (vs.exists()) vProf = vs.data();
        } catch (_) {}
        await setDoc(doc(db, 'users', uid, 'visitors', currentUser.uid), {
          userId:      currentUser.uid,
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
// RENDER PROFILE HTML
// ═══════════════════════════════════════════════════════════
function renderProfile(uid) {
  const u = userDoc;
  const isOwner = currentUser && currentUser.uid === uid;

  // ── Cover photo ──
  const coverUrl      = u.coverPhotoUrl || '';
  const coverSettings = u.coverPhotoSettings || {};
  const coverImgHtml  = coverUrl
    ? `<img class="cover-img" src="${esc(coverUrl)}" style="${buildCoverStyle(coverSettings)}" alt="cover">`
    : `<div class="cover-placeholder"><i class="bi bi-panorama"></i></div>`;
  const coverEditBtn  = isOwner
    ? `<button class="cover-edit-btn" id="coverEditBtn">
         <i class="bi bi-camera"></i> Chỉnh ảnh bìa
       </button>`
    : '';

  // ── Avatar ──
  const avatarUrl      = getAvatarUrl(u, u.displayName);
  const avatarSettings = u.avatarSettings || {};
  const avVars         = avatarTransformVars(avatarSettings);
  const frameId        = u.avatarFrame || 'none';
  const frameObj       = getFrameById(frameId);
  // Frame is an SVG circle overlay — must sit OUTSIDE the clipped circle div
  const frameImgHtml   = frameObj?.image
    ? `<img class="profile-avatar-frame" src="${esc(frameObj.image)}" alt="frame" draggable="false">`
    : '';
  const ownerAvatarBtns = isOwner ? `
    <button class="avatar-action-btn avatar-frame-btn" id="avatarFrameEditBtn" title="Chọn khung">
      <i class="bi bi-circle-square"></i>
    </button>
    <button class="avatar-action-btn avatar-edit-btn" id="avatarEditBtn" title="Chỉnh ảnh đại diện">
      <i class="bi bi-pencil"></i>
    </button>` : '';

  // ── Basic info ──
  const genderMap  = { male: 'Nam', female: 'Nữ', other: 'Khác' };
  const genderText = u.gender ? genderMap[u.gender] || u.gender : '';
  const birthdayText = u.birthday
    ? new Date(u.birthday).toLocaleDateString('vi-VN') : '';

  let basicItems = [];
  if (genderText)   basicItems.push(`<span><i class="bi bi-gender-ambiguous me-1"></i>${esc(genderText)}</span>`);
  if (birthdayText) basicItems.push(`<span><i class="bi bi-cake2 me-1"></i>${esc(birthdayText)}</span>`);
  if (u.country)    basicItems.push(`<span><i class="bi bi-geo-alt me-1"></i>${esc(u.country)}</span>`);

  // ── Action area ──
  const actionAreaHtml = `<div id="profileActionArea" class="ms-auto"></div>`;

  profileArea.innerHTML = `
    <!-- Cover banner -->
    <div class="profile-cover-banner" id="coverBanner">
      ${coverImgHtml}
      ${isOwner ? `<button class="cover-edit-btn" id="coverEditBtn" title="Chỉnh ảnh bìa">
        <i class="bi bi-camera"></i> Ảnh bìa
      </button>` : ''}
    </div>

    <!-- Info area -->
    <div class="profile-info-area">
      <div class="profile-top-row">

        <!-- Avatar wrapper: clipped circle + frame overlay outside -->
        <div class="profile-avatar-outer" id="avatarWrapper" style="${avVars}">
          <div class="profile-avatar-clip">
            <img id="profileAvatarImg" class="profile-avatar-img" src="${esc(avatarUrl)}" alt="avatar">
          </div>
          ${frameImgHtml}
          ${ownerAvatarBtns}
        </div>

        <!-- Name + tag + follow stats + action -->
        <div class="profile-meta">
          <div class="profile-name-row">
            <div>
              <div class="profile-name">
                ${esc(u.displayName || '(Chưa đặt tên)')}
                ${u.type === 'admin' ? '<span class="badge bg-danger ms-2" style="font-size:0.65rem;vertical-align:middle;">ADMIN</span>' : ''}
              </div>
              ${u.tagName ? `<div class="profile-tag">${esc('@' + u.tagName)}</div>` : ''}
            </div>
            <div id="profileActionArea" class="ms-auto"></div>
          </div>

          <!-- FIX 4: follow stats on ONE row -->
          <div class="follow-stats-row">
            <span class="follow-stat-item"><strong id="followersCount">0</strong> người theo dõi</span>
            <span class="follow-stat-sep">·</span>
            <span class="follow-stat-item">Đang theo dõi <strong id="followingCount">0</strong></span>
            ${basicItems.length ? `<span class="follow-stat-sep">·</span>
            <button class="btn-xem-them" id="btnXemThem">Xem thêm <i class="bi bi-chevron-down"></i></button>` : ''}
          </div>
        </div>
      </div>

      <!-- Bio (short, always visible) -->
      ${u.bio ? `<div class="profile-bio">${u.bio}</div>` : ''}

      <!-- Posts section -->
      <div class="profile-posts mt-3">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <h6 class="mb-0">Bài viết của ${esc(u.displayName || '')}</h6>
          <div id="ownerControls"></div>
        </div>
        <div id="userPostsList"><div class="text-muted py-3">Đang tải bài viết...</div></div>
      </div>
    </div>
  `;

  // Owner controls
  const ownerControls = document.getElementById('ownerControls');
  if (isOwner) {
    ownerControls.innerHTML = `
      <button id="btnAddPost" class="btn btn-sm btn-primary btn-rounded">
        <i class="bi bi-plus-lg"></i> Thêm bài viết
      </button>`;
    document.getElementById('btnAddPost').addEventListener('click', openAddPostEditor);
    openVisitorsBtn.style.display = 'block';

    // FIX 5: Cover edit → open modal scrolled to cover section
    document.getElementById('coverEditBtn')?.addEventListener('click', () => openEditModal('cover'));

    // FIX 5: Avatar edit btn → open modal scrolled to avatar section
    document.getElementById('avatarEditBtn')?.addEventListener('click', () => openEditModal('avatar'));

    // Avatar frame edit button
    document.getElementById('avatarFrameEditBtn')?.addEventListener('click', openFramePicker);
  } else {
    openVisitorsBtn.style.display = 'none';
  }

  // FIX 3: "Xem thêm" button → show profile info modal
  document.getElementById('btnXemThem')?.addEventListener('click', openProfileInfoModal);

  renderFollowActionArea(uid);
  renderMenuAuthArea();
}

// ═══════════════════════════════════════════════════════════
// FRAME HELPERS
// ═══════════════════════════════════════════════════════════
function getFrameById(id) {
  const frames = getAvatarFrames();
  if (!frames) return null;
  return getAllFrames().find(f => f.id === id) || null;
}

function getAllFrames() {
  const frames = getAvatarFrames();
  if (!frames) return [];
  return [...(frames.free || []), ...(frames.special || [])];
}

// Check if a special frame is unlocked for a user (based on achievements)
function isFrameUnlocked(frame, achievementsData) {
  if (frame.type === 'free') return true;
  if (!achievementsData) return false;
  if (typeof window.checkFrameUnlock === 'function') {
    return checkFrameUnlock(frame.id, achievementsData);
  }
  // Fallback: check companionship milestones
  const req = frame.requirement; // e.g. '1_year'
  if (!req) return false;
  const MS = { day:86400000, week:604800000, month:2592000000, year:31536000000 };
  const thresholds = {
    '1_day':   MS.day,   '1_week':  MS.week,   '1_month': MS.month,
    '1_year':  MS.year,  '2_years': 2*MS.year, '3_years': 3*MS.year,
    '4_years': 4*MS.year,'5_years': 5*MS.year, '10_years':10*MS.year
  };
  if (!thresholds[req]) return false;
  const created = achievementsData?._createdAt;
  if (!created) return false;
  const elapsed = Date.now() - (created instanceof Date ? created : new Date(created)).getTime();
  return elapsed >= thresholds[req];
}

// ═══════════════════════════════════════════════════════════
// AVATAR FRAME PICKER MODAL
// ═══════════════════════════════════════════════════════════
function openFramePicker() {
  if (!currentUser) { loginModalProfile.show(); return; }
  const _af = getAvatarFrames();
  if (!_af) {
    alert('Dữ liệu khung chưa sẵn sàng. Vui lòng thử lại.');
    return;
  }

  const u = userDoc || {};
  const currentFrameId = u.avatarFrame || 'none';
  selectedFrameId = currentFrameId;

  const avatarSrc = getAvatarUrl(u, u.displayName);

  // Build preview
  renderFrameModalPreview(avatarSrc, currentFrameId);

  // Build grids
  renderFrameGrid('freeFramesGrid',    _af.free,    avatarSrc, u.achievements, currentFrameId);
  renderFrameGrid('specialFramesGrid', _af.special, avatarSrc, u.achievements, currentFrameId);

  avatarFrameModal.show();
}

function renderFrameModalPreview(avatarSrc, frameId) {
  const wrapper = document.getElementById('frameModalPreview');
  const label   = document.getElementById('frameModalPreviewLabel');
  if (!wrapper) return;

  const frame = getFrameById(frameId);
  const frameHtml = frame?.image
    ? `<img class="frame-preview-fr" src="${frame.image}" alt="">`
    : '';

  wrapper.innerHTML = `
    <img class="frame-preview-av" src="${esc(avatarSrc)}" alt="avatar">
    ${frameHtml}
  `;
  if (label) label.textContent = frame ? frame.name : 'Không khung';
}

function renderFrameGrid(containerId, frames, avatarSrc, achievementsData, currentFrameId) {
  const container = document.getElementById(containerId);
  if (!container || !frames) return;

  container.innerHTML = '';

  frames.forEach(frame => {
    const unlocked = isFrameUnlocked(frame, achievementsData);
    const isSelected = frame.id === selectedFrameId;

    const card = document.createElement('div');
    card.className = [
      'frame-card',
      isSelected ? 'selected' : '',
      !unlocked  ? 'locked'   : ''
    ].filter(Boolean).join(' ');
    card.dataset.frameId = frame.id;

    const frameOverlayHtml = frame.image
      ? `<img class="frame-thumb-overlay" src="${frame.image}" alt="">`
      : '';

    const lockBadge = !unlocked
      ? `<div class="frame-card-locked-label"><i class="bi bi-lock-fill"></i></div>`
      : '';

    const checkBadge = `<div class="frame-card-check"><i class="bi bi-check-lg"></i></div>`;

    const unlockHint = (!unlocked && frame.requirementText)
      ? `<div class="frame-unlock-hint"><i class="bi bi-lock me-1"></i>${esc(frame.requirementText)}</div>`
      : '';

    card.innerHTML = `
      <div class="frame-thumb-wrapper">
        <img class="frame-thumb-avatar" src="${esc(avatarSrc)}" alt="avatar">
        ${frameOverlayHtml}
      </div>
      <div class="frame-card-name">${esc(frame.name)}</div>
      ${unlockHint}
      ${lockBadge}
      ${checkBadge}
    `;

    if (unlocked) {
      card.addEventListener('click', () => {
        selectedFrameId = frame.id;
        // Update selection state in all cards
        document.querySelectorAll('.frame-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        // Update preview
        renderFrameModalPreview(avatarSrc, frame.id);
      });
    }

    container.appendChild(card);
  });
}

// Apply frame button
document.getElementById('applyFrameBtn').addEventListener('click', async () => {
  if (!currentUser || !selectedFrameId) return;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { avatarFrame: selectedFrameId });
    userDoc.avatarFrame = selectedFrameId;
    avatarFrameModal.hide();
    // Update frame overlay in profile header
    updateProfileAvatarFrame(selectedFrameId);
    // Update mini selector in edit modal if open
    updateFrameSelectorPreview();
  } catch (err) {
    console.error('apply frame error', err);
    alert('Không thể áp dụng khung. Vui lòng thử lại.');
  }
});

function updateProfileAvatarFrame(frameId) {
  // Update overlay on avatar in profile header
  const wrapper = document.getElementById('avatarWrapper');
  if (!wrapper) return;
  let overlay = wrapper.querySelector('.profile-avatar-frame');
  const frame = getFrameById(frameId);
  if (frame?.image) {
    if (!overlay) {
      overlay = document.createElement('img');
      overlay.className = 'profile-avatar-frame';
      overlay.alt = 'frame';
      wrapper.appendChild(overlay);
    }
    overlay.src = frame.image;
    overlay.style.display = '';
  } else {
    if (overlay) overlay.remove();
  }
}

// ═══════════════════════════════════════════════════════════
// PROFILE EDIT MODAL
// ═══════════════════════════════════════════════════════════
function openEditModal(scrollTo) {
  if (!currentUser || !userDoc) return;
  populateEditModal(userDoc);
  profileEditModal.show();
  // After modal animates in, scroll to the relevant section
  if (scrollTo) {
    setTimeout(() => {
      const targetId = scrollTo === 'cover'  ? 'editCoverSection'
                     : scrollTo === 'avatar' ? 'editAvatarSection'
                     : null;
      if (targetId) {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 400);
  }
}

function populateEditModal(u) {
  // ── Avatar ──
  const avatarSrc = getAvatarUrl(u, u.displayName);
  const avatarEl  = document.getElementById('avatarPreview');
  if (avatarEl) avatarEl.src = avatarSrc;
  const editAvatarUrl = document.getElementById('editAvatarUrl');
  if (editAvatarUrl) editAvatarUrl.value = u.avatarUrl || '';

  // Init avatar transform sliders
  const avSettings = u.avatarSettings || {};
  setSliderPair('avatarScale',      'avatarScaleNum',      avSettings.scale      ?? 100);
  setSliderPair('avatarTranslateX', 'avatarTranslateXNum', avSettings.translateX ?? 0);
  setSliderPair('avatarTranslateY', 'avatarTranslateYNum', avSettings.translateY ?? 0);
  applyAvatarTransform(); // apply CSS vars to clip wrapper

  // Show avatar frame overlay
  const frameOverlay = document.getElementById('avatarFrameOverlay');
  const frame = getFrameById(u.avatarFrame || 'none');
  if (frameOverlay) {
    if (frame?.image) { frameOverlay.src = frame.image; frameOverlay.style.display = ''; }
    else { frameOverlay.style.display = 'none'; }
  }

  const avatarControls = document.getElementById('avatarTransformControls');
  if (avatarControls) avatarControls.style.display = u.avatarUrl ? '' : 'none';

  // ── Cover ──
  const coverBannerEl = document.getElementById('coverPreviewBanner');
  const coverImgEl    = document.getElementById('coverPreviewImg');
  const coverPhEl     = document.getElementById('coverPreviewPlaceholder');
  const editCoverUrl  = document.getElementById('editCoverUrl');
  if (editCoverUrl) editCoverUrl.value = u.coverPhotoUrl || '';
  if (coverImgEl && u.coverPhotoUrl) {
    coverImgEl.src = u.coverPhotoUrl;
    coverImgEl.style.display = '';
    if (coverPhEl) coverPhEl.style.display = 'none';
    // Apply saved transform
    const cvSettings = u.coverPhotoSettings || {};
    coverImgEl.style.transform = buildCoverStyle(cvSettings);
  } else {
    if (coverImgEl) coverImgEl.style.display = 'none';
    if (coverPhEl) coverPhEl.style.display = '';
  }
  const cvSettings = u.coverPhotoSettings || {};
  setSliderPair('coverScale',      'coverScaleNum',      cvSettings.scale      ?? 100);
  setSliderPair('coverTranslateX', 'coverTranslateXNum', cvSettings.translateX ?? 0);
  setSliderPair('coverTranslateY', 'coverTranslateYNum', cvSettings.translateY ?? 0);
  const coverControls = document.getElementById('coverTransformControls');
  if (coverControls) coverControls.style.display = u.coverPhotoUrl ? '' : 'none';

  // ── Frame selector mini ──
  const editAvatarFrame = document.getElementById('editAvatarFrame');
  if (editAvatarFrame) editAvatarFrame.value = u.avatarFrame || 'none';
  updateFrameSelectorPreview();

  // ── Text fields ──
  const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  f('editDisplayName', u.displayName);
  f('editTagName',     u.tagName);
  f('editFullName',    u.fullName);
  f('editBirthday',    u.birthday);
  f('editCountry',     u.country);

  const genderEl = document.getElementById('editGender');
  if (genderEl) genderEl.value = u.gender || '';

  // ── Bio Quill ──
  if (!bioQuill && document.getElementById('bioEditQuill')) {
    bioQuill = new Quill('#bioEditQuill', {
      theme: 'snow',
      modules: { toolbar: [['bold','italic','underline'], ['clean']] },
      placeholder: 'Giới thiệu bản thân...'
    });
  }
  if (bioQuill) bioQuill.root.innerHTML = u.bio || '';

  // Wire up all interactive controls
  wireEditModalControls();
}

function updateFrameSelectorPreview() {
  const editAvatarFrame = document.getElementById('editAvatarFrame');
  const frameId  = editAvatarFrame?.value || userDoc?.avatarFrame || 'none';
  const frame    = getFrameById(frameId);
  const nameEl   = document.getElementById('currentFrameName');
  const previewAv = document.getElementById('frameSelectorPreviewAvatar');
  const previewFr = document.getElementById('frameSelectorPreviewFrame');

  if (nameEl) nameEl.textContent = frame?.name || 'Không khung';
  if (previewAv) previewAv.src = getAvatarUrl(userDoc, userDoc?.displayName);
  if (previewFr) {
    if (frame?.image) { previewFr.src = frame.image; previewFr.style.display = ''; }
    else { previewFr.style.display = 'none'; }
  }
}

function setSliderPair(sliderId, numId, value) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  if (slider) slider.value = value;
  if (num)    num.value    = value;
}

function wireEditModalControls() {
  // ── Avatar preview & transform ──
  const avatarUrlInput = document.getElementById('editAvatarUrl');
  const avatarPreview  = document.getElementById('avatarPreview');
  const avatarControls = document.getElementById('avatarTransformControls');

  document.getElementById('testAvatarBtn')?.addEventListener('click', () => {
    const url = avatarUrlInput?.value.trim();
    if (url && avatarPreview) {
      avatarPreview.src = url;
      if (avatarControls) avatarControls.style.display = '';
      applyAvatarTransform();
    }
  });

  document.getElementById('clearAvatarBtn')?.addEventListener('click', () => {
    if (avatarUrlInput) avatarUrlInput.value = '';
    if (avatarPreview) avatarPreview.src = getAvatarUrl(userDoc, userDoc?.displayName);
    if (avatarControls) avatarControls.style.display = 'none';
    setSliderPair('avatarScale', 'avatarScaleNum', 100);
    setSliderPair('avatarTranslateX', 'avatarTranslateXNum', 0);
    setSliderPair('avatarTranslateY', 'avatarTranslateYNum', 0);
    applyAvatarTransform();
  });

  document.getElementById('resetAvatarTransformBtn')?.addEventListener('click', () => {
    setSliderPair('avatarScale', 'avatarScaleNum', 100);
    setSliderPair('avatarTranslateX', 'avatarTranslateXNum', 0);
    setSliderPair('avatarTranslateY', 'avatarTranslateYNum', 0);
    applyAvatarTransform();
  });

  wireSliderNum('avatarScale',      'avatarScaleNum',      applyAvatarTransform);
  wireSliderNum('avatarTranslateX', 'avatarTranslateXNum', applyAvatarTransform);
  wireSliderNum('avatarTranslateY', 'avatarTranslateYNum', applyAvatarTransform);

  // ── Cover preview & transform ──
  const coverUrlInput = document.getElementById('editCoverUrl');
  const coverImgEl    = document.getElementById('coverPreviewImg');
  const coverPhEl     = document.getElementById('coverPreviewPlaceholder');
  const coverControls = document.getElementById('coverTransformControls');

  document.getElementById('testCoverBtn')?.addEventListener('click', () => {
    const url = coverUrlInput?.value.trim();
    if (url && coverImgEl) {
      coverImgEl.src = url;
      coverImgEl.style.display = '';
      if (coverPhEl) coverPhEl.style.display = 'none';
      if (coverControls) coverControls.style.display = '';
    }
  });

  document.getElementById('clearCoverBtn')?.addEventListener('click', () => {
    if (coverUrlInput) coverUrlInput.value = '';
    if (coverImgEl) coverImgEl.style.display = 'none';
    if (coverPhEl) coverPhEl.style.display = '';
    if (coverControls) coverControls.style.display = 'none';
    setSliderPair('coverScale', 'coverScaleNum', 100);
    setSliderPair('coverTranslateX', 'coverTranslateXNum', 0);
    setSliderPair('coverTranslateY', 'coverTranslateYNum', 0);
  });

  document.getElementById('resetCoverTransformBtn')?.addEventListener('click', () => {
    setSliderPair('coverScale', 'coverScaleNum', 100);
    setSliderPair('coverTranslateX', 'coverTranslateXNum', 0);
    setSliderPair('coverTranslateY', 'coverTranslateYNum', 0);
    applyCoverTransform();
  });

  wireSliderNum('coverScale',      'coverScaleNum',      applyCoverTransform);
  wireSliderNum('coverTranslateX', 'coverTranslateXNum', applyCoverTransform);
  wireSliderNum('coverTranslateY', 'coverTranslateYNum', applyCoverTransform);

  // ── Frame picker opener ──
  document.getElementById('openFramePickerBtn')?.addEventListener('click', () => {
    profileEditModal.hide();
    setTimeout(() => openFramePicker(), 350);
  });

  // Re-open edit modal when frame modal closes (if user was editing)
  document.getElementById('avatarFrameModal')?.addEventListener('hidden.bs.modal', () => {
    if (document.getElementById('profileEditModal')) {
      updateFrameSelectorPreview();
    }
  });
}

function wireSliderNum(sliderId, numId, onChange) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  if (!slider || !num) return;
  slider.addEventListener('input', () => { num.value = slider.value; onChange(); });
  num.addEventListener('input',   () => { slider.value = num.value;  onChange(); });
}

function applyAvatarTransform() {
  const sc = parseFloat(document.getElementById('avatarScaleNum')?.value      ?? 100);
  const tx = parseFloat(document.getElementById('avatarTranslateXNum')?.value ?? 0);
  const ty = parseFloat(document.getElementById('avatarTranslateYNum')?.value ?? 0);
  // Set CSS vars on the outer wrapper — the img inside reads them via CSS
  // The clip div handles overflow:hidden so the img never escapes the circle
  const outer = document.getElementById('avatarPreviewClip');
  if (outer) {
    outer.style.setProperty('--av-scale', sc / 100);
    outer.style.setProperty('--av-tx', tx + 'px');
    outer.style.setProperty('--av-ty', ty + 'px');
  }
}

function applyCoverTransform() {
  const sc = parseInt(document.getElementById('coverScaleNum')?.value      || 100);
  const tx = parseInt(document.getElementById('coverTranslateXNum')?.value || 0);
  const ty = parseInt(document.getElementById('coverTranslateYNum')?.value || 0);
  const img = document.getElementById('coverPreviewImg');
  if (img) img.style.transform = `scale(${sc/100}) translate(${tx}px,${ty}px)`;
}

// ── Save profile ──────────────────────────────────────────
document.getElementById('saveProfileModalBtn').addEventListener('click', async () => {
  if (!currentUser) return;
  const btn = document.getElementById('saveProfileModalBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Đang lưu...';

  try {
    const newDisplay  = (document.getElementById('editDisplayName')?.value || '').trim();
    const newTag      = (document.getElementById('editTagName')?.value     || '').trim();
    const newFullName = (document.getElementById('editFullName')?.value    || '').trim();
    const newGender   = document.getElementById('editGender')?.value       || '';
    const newBirthday = document.getElementById('editBirthday')?.value     || '';
    const newCountry  = (document.getElementById('editCountry')?.value     || '').trim();
    const newBio      = bioQuill ? bioQuill.root.innerHTML.trim() : '';
    const newAvatarUrl  = (document.getElementById('editAvatarUrl')?.value  || '').trim();
    const newCoverUrl   = (document.getElementById('editCoverUrl')?.value   || '').trim();
    const newFrameId    = document.getElementById('editAvatarFrame')?.value || 'none';

    // Transform settings
    const avatarSettings = {
      scale:      parseInt(document.getElementById('avatarScaleNum')?.value      || 100),
      translateX: parseInt(document.getElementById('avatarTranslateXNum')?.value || 0),
      translateY: parseInt(document.getElementById('avatarTranslateYNum')?.value || 0)
    };
    const coverPhotoSettings = {
      scale:      parseInt(document.getElementById('coverScaleNum')?.value      || 100),
      translateX: parseInt(document.getElementById('coverTranslateXNum')?.value || 0),
      translateY: parseInt(document.getElementById('coverTranslateYNum')?.value || 0)
    };

    if (!newDisplay) {
      alert('Tên hiển thị không được để trống.');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi';
      return;
    }

    // Tag uniqueness check (skip if unchanged)
    if (newTag && newTag !== userDoc.tagName) {
      const tagQ   = query(collection(db, 'users'), where('tagName', '==', newTag));
      const tagSnap = await getDocs(tagQ);
      if (!tagSnap.empty && tagSnap.docs[0].id !== currentUser.uid) {
        alert('Tag này đã được sử dụng. Vui lòng chọn tag khác.');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi';
        return;
      }
    }

    const updateData = {
      displayName:       newDisplay,
      tagName:           newTag,
      fullName:          newFullName,
      gender:            newGender,
      birthday:          newBirthday,
      country:           newCountry,
      bio:               newBio,
      avatarUrl:         newAvatarUrl   || null,
      coverPhotoUrl:     newCoverUrl    || null,
      avatarFrame:       newFrameId,
      avatarSettings,
      coverPhotoSettings,
      updatedAt: serverTimestamp()
    };

    await updateDoc(doc(db, 'users', currentUser.uid), updateData);

    // Propagate displayName + avatarUrl to comments (best-effort)
    if (newDisplay !== userDoc.displayName || newAvatarUrl !== userDoc.avatarUrl) {
      propagateProfileToComments(currentUser.uid, newDisplay, newTag, newAvatarUrl);
    }

    // Update local userDoc
    Object.assign(userDoc, updateData);

    profileEditModal.hide();
    await loadProfile(currentUser.uid);

  } catch (err) {
    console.error('saveProfile error', err);
    alert('Lỗi khi lưu: ' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Lưu thay đổi';
  }
});

async function propagateProfileToComments(uid, displayName, tagName, avatarUrl) {
  try {
    const postsQ  = query(collection(db, 'posts'), where('userId', '==', uid));
    const postsSnap = await getDocs(postsQ);
    const batch = writeBatch(db);
    let ops = 0;
    for (const postDoc of postsSnap.docs) {
      const commentsSnap = await getDocs(
        query(collection(db, 'posts', postDoc.id, 'comments'), where('userId', '==', uid))
      );
      commentsSnap.docs.forEach(cd => {
        batch.update(cd.ref, { displayName, avatarUrl: avatarUrl || null });
        ops++;
        if (ops >= 400) return;
      });
    }
    if (ops > 0) await batch.commit();
  } catch (e) {
    console.warn('propagateProfile failed (non-critical)', e);
  }
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

  const rows = [
    u.fullName   && ['<i class="bi bi-person-badge"></i> Họ và tên', esc(u.fullName)],
    genderText   && ['<i class="bi bi-gender-ambiguous"></i> Giới tính', esc(genderText)],
    birthday     && ['<i class="bi bi-cake2"></i> Sinh nhật', esc(birthday)],
    u.country    && ['<i class="bi bi-geo-alt"></i> Quốc gia', esc(u.country)],
    u.tagName    && ['<i class="bi bi-at"></i> Tag', `@${esc(u.tagName)}`],
  ].filter(Boolean);

  const tableHtml = rows.length ? `
    <table class="table table-borderless mb-0">
      <tbody>
        ${rows.map(([label, val]) => `
          <tr>
            <td class="text-muted" style="width:40%;font-size:.9rem;">${label}</td>
            <td class="fw-semibold" style="font-size:.9rem;">${val}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p class="text-muted">Chưa có thông tin bổ sung.</p>';

  // Use a simple dynamic modal (create if not exists)
  let modalEl = document.getElementById('profileInfoModal');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.id = 'profileInfoModal';
    modalEl.tabIndex = -1;
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-person-lines-fill me-2"></i>Thông tin cá nhân</h5>
            <button class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body" id="profileInfoModalBody"></div>
        </div>
      </div>`;
    document.body.appendChild(modalEl);
  }
  document.getElementById('profileInfoModalBody').innerHTML = tableHtml;
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

// ═══════════════════════════════════════════════════════════
// ACHIEVEMENTS MODAL — GROUPED
// ═══════════════════════════════════════════════════════════
openAchievementsBtn.addEventListener('click', () => {
  renderAchievementGroups();
  achievementsModal.show();
});

function renderAchievementGroups() {
  // Show group list, hide detail
  document.getElementById('achievementGroupList').style.display = '';
  document.getElementById('achievementDetailCompanionship').style.display = 'none';

  // Compute summary for Đồng hành group
  if (!userDoc) return;
  const created = userDoc.createdAt?.toDate ? userDoc.createdAt.toDate() : null;
  const elapsed  = created ? Date.now() - created.getTime() : 0;
  const MS_YEAR  = 365 * 24 * 3600 * 1000;
  const MILESTONES_COUNT = 9; // 1d,1w,1m,1y,2y,3y,4y,5y,10y
  const thresholds = [
    86400000, 604800000, 2592000000, MS_YEAR, 2*MS_YEAR,
    3*MS_YEAR, 4*MS_YEAR, 5*MS_YEAR, 10*MS_YEAR
  ];
  const completed = thresholds.filter(t => elapsed >= t).length;

  const summaryEl = document.getElementById('companionshipSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span class="badge bg-primary bg-opacity-10 text-primary" style="font-size:0.78rem;">
        ${completed}/${MILESTONES_COUNT} mốc hoàn thành
      </span>`;
  }
}

// Click on Đồng hành group → show detail
document.getElementById('groupCompanionship').addEventListener('click', () => {
  document.getElementById('achievementGroupList').style.display = 'none';
  document.getElementById('achievementDetailCompanionship').style.display = '';
  renderCompanionshipAchievements();
});

document.getElementById('groupCompanionship').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') e.target.click();
});

document.getElementById('backToGroupsBtn').addEventListener('click', () => {
  document.getElementById('achievementDetailCompanionship').style.display = 'none';
  document.getElementById('achievementGroupList').style.display = '';
});

function renderCompanionshipAchievements() {
  const container = document.getElementById('achievementsContainer');
  if (!container) return;
  container.innerHTML = '';

  const u = userDoc;
  if (!u) return;

  const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : null;
  const now  = new Date();
  const MS   = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };

  const milestones = [
    { key: '1_day',   label: '1 Ngày',        target: MS.day,        style: 'small', frameReq: null },
    { key: '1_week',  label: '1 Tuần',         target: MS.week,       style: 'small', frameReq: null },
    { key: '1_month', label: '1 Tháng',        target: MS.month,      style: 'medium',frameReq: null },
    { key: '1_year',  label: '1 Năm',          target: MS.year,       style: 'medium',frameReq: 'bronze_star' },
    { key: '2_years', label: '2 Năm',          target: 2*MS.year,     style: 'medium',frameReq: 'silver_moon' },
    { key: '3_years', label: '3 Năm',          target: 3*MS.year,     style: 'big',   frameReq: 'diamond_crown' },
    { key: '4_years', label: '4 Năm',          target: 4*MS.year,     style: 'big',   frameReq: 'platinum_wings' },
    { key: '5_years', label: '5 Năm',          target: 5*MS.year,     style: 'hero',  frameReq: 'mythic_aurora' },
    { key: '10_years',label: '10 Năm',         target: 10*MS.year,    style: 'hero',  frameReq: 'eternal_galaxy' },
    { key: 'infinite',label: 'Năm vô hạn',    target: 10*MS.year,    style: 'hero',  frameReq: null }
  ];

  let elapsed = createdAt ? now - createdAt : 0;

  milestones.forEach(ms => {
    const colDiv = document.createElement('div');
    colDiv.className = 'col-12 col-md-6 col-xl-4';

    const inner = document.createElement('div');
    inner.className = 'achievement-card' +
      (ms.style === 'big'  ? ' big'  : '') +
      (ms.style === 'hero' ? ' hero' : '');

    let pct = 0, subtitle = '', completed = false;

    if (!createdAt) {
      pct = 0;
      subtitle = 'Chưa có dữ liệu';
    } else if (ms.key === 'infinite') {
      const years = Math.floor(elapsed / MS.year);
      const intoYear = elapsed - years * MS.year;
      pct = (intoYear / MS.year) * 100;
      subtitle = `Đã đồng hành ${years} năm — tiến trình năm tiếp theo: ${Math.round(pct)}%`;
      completed = false; // never "completed"
    } else {
      pct = Math.min(100, (elapsed / ms.target) * 100);
      completed = pct >= 100;
      subtitle = completed
        ? `Hoàn thành!`
        : `${Math.round(pct)}% đạt mốc ${ms.label}`;
    }

    // Frame reward badge (only for milestones that unlock a frame, and not infinite)
    let frameRewardHtml = '';
    if (ms.frameReq) {
      const rewardFrame = getFrameById(ms.frameReq);
      if (rewardFrame) {
        const frameThumb = rewardFrame.image
          ? `<img src="${rewardFrame.image}" alt="">`
          : `<i class="bi bi-circle-square"></i>`;
        frameRewardHtml = `
          <div class="achievement-frame-reward">
            ${frameThumb}
            <span>Khung: ${esc(rewardFrame.name)}</span>
          </div>`;
      }
    }

    const completedBadge = completed
      ? `<span class="achievement-completed-badge"><i class="bi bi-check-circle-fill me-1"></i>Hoàn thành</span>`
      : '';

    const icon = ms.style === 'hero' ? '🏆' : ms.style === 'big' ? '⭐' : '🎯';

    inner.innerHTML = `
      <div class="d-flex justify-content-between align-items-start w-100">
        <div>
          <div class="achievement-title">${icon} ${esc(ms.label)}</div>
          <div class="achievement-meta">${esc(subtitle)}</div>
        </div>
        <div class="text-end d-flex flex-column align-items-end gap-1">
          ${completedBadge}
        </div>
      </div>
      <div class="achievement-bar w-100" aria-hidden="true">
        <div class="achievement-progress" style="width:${Math.max(0, Math.round(pct))}%"></div>
      </div>
      ${frameRewardHtml}
    `;

    colDiv.appendChild(inner);
    container.appendChild(colDiv);
  });
}

// ═══════════════════════════════════════════════════════════
// FOLLOW / UNFOLLOW
// ═══════════════════════════════════════════════════════════
async function renderFollowActionArea(profileId) {
  const actionArea = document.getElementById('profileActionArea');
  if (!actionArea) return;
  actionArea.innerHTML = '';

  if (!currentUser) {
    actionArea.innerHTML = `
      <button id="btnLoginToFollow" class="btn btn-sm btn-outline-primary btn-rounded">Theo dõi</button>`;
    document.getElementById('btnLoginToFollow')
      .addEventListener('click', () => loginModalProfile.show());
    return;
  }

  if (currentUser.uid === profileId) {
    actionArea.innerHTML = `
      <button id="btnEditProfile" class="btn btn-outline-primary btn-rounded btn-sm">
        <i class="bi bi-pencil-square me-1"></i>Chỉnh sửa
      </button>`;
    document.getElementById('btnEditProfile')
      .addEventListener('click', openEditModal);
    return;
  }

  try {
    const fSnap = await getDoc(doc(db, 'users', profileId, 'followers', currentUser.uid));
    const isFollowing = fSnap.exists();
    actionArea.innerHTML = isFollowing
      ? `<button id="btnUnfollow" class="btn btn-sm btn-outline-danger btn-rounded">Đang theo dõi · Hủy</button>`
      : `<button id="btnFollow"   class="btn btn-sm btn-primary btn-rounded">Theo dõi</button>`;

    if (isFollowing) {
      document.getElementById('btnUnfollow').addEventListener('click', () => doUnfollow(profileId));
    } else {
      document.getElementById('btnFollow').addEventListener('click', () => doFollow(profileId));
    }
  } catch (e) {
    console.error('renderFollowActionArea error', e);
  }
}

async function doFollow(profileId) {
  if (!currentUser) { loginModalProfile.show(); return; }
  const followerRef = doc(db, 'users', profileId,            'followers', currentUser.uid);
  const followingRef= doc(db, 'users', currentUser.uid,      'following', profileId);

  try {
    await setDoc(followerRef, {
      userId: currentUser.uid, createdAt: serverTimestamp(),
      displayName: currentUser.displayName || null,
      tagName: null, avatarUrl: currentUser.photoURL || null
    });
  } catch (err) {
    console.error('doFollow: follower doc failed', err);
    alert('Không thể theo dõi. Kiểm tra Firestore Rules.');
    return;
  }
  try {
    await setDoc(followingRef, {
      userId: profileId, createdAt: serverTimestamp(),
      displayName: userDoc?.displayName || null,
      avatarUrl:   userDoc?.avatarUrl   || null
    });
  } catch (err) {
    console.error('doFollow: following doc failed', err);
    try { await deleteDoc(followerRef); } catch (_) {}
    alert('Không thể tạo following record.');
    return;
  }
  renderFollowActionArea(profileId);
}

async function doUnfollow(profileId) {
  if (!currentUser) { loginModalProfile.show(); return; }
  try { await deleteDoc(doc(db, 'users', currentUser.uid, 'following', profileId)); } catch (_) {}
  try { await deleteDoc(doc(db, 'users', profileId, 'followers', currentUser.uid)); } catch (_) {}
  renderFollowActionArea(profileId);
}

function subscribeFollowerCounts(uid) {
  try {
    onSnapshot(collection(db, 'users', uid, 'followers'), snap => {
      const el = document.getElementById('followersCount');
      if (el) el.textContent = snap.size;
    }, err => console.warn('followers snap error', err));

    onSnapshot(collection(db, 'users', uid, 'following'), snap => {
      const el = document.getElementById('followingCount');
      if (el) el.textContent = snap.size;
    }, err => console.warn('following snap error', err));
  } catch (e) { console.warn('subscribeFollowerCounts failed', e); }
}

// ═══════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════
function subscribePosts(uid) {
  if (postsUnsub) { postsUnsub(); postsUnsub = null; }
  try {
    const postsQ = query(
      collection(db, 'posts'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    postsUnsub = onSnapshot(postsQ, snap => {
      lastPostsDocs = snap.docs;
      renderPostsSnapshot(snap.docs);
    }, err => {
      console.error('subscribePosts error', err);
      const listEl = document.getElementById('userPostsList');
      if (listEl) listEl.innerHTML = `<div class="text-muted py-3">Không thể tải bài viết.</div>`;
    });
  } catch (e) { console.error('subscribePosts failed', e); }
}

async function fetchCommentCounts(postIds) {
  const counts = {};
  await Promise.all(postIds.map(async id => {
    try {
      const s = await getDocs(collection(db, 'posts', id, 'comments'));
      counts[id] = s.size;
    } catch (_) { counts[id] = 0; }
  }));
  return counts;
}

async function renderPostsSnapshot(docs) {
  const listEl = document.getElementById('userPostsList');
  if (!listEl) return;
  if (!docs.length) {
    listEl.innerHTML = `<div class="text-muted py-3">Người dùng chưa có bài viết nào.</div>`;
    return;
  }

  const postIds      = docs.map(d => d.id);
  const commentCounts = await fetchCommentCounts(postIds);
  const isOwner      = currentUser && currentUser.uid === profileUid;
  const frag         = document.createDocumentFragment();

  docs.forEach(docSnap => {
    const d  = docSnap.data();
    const id = docSnap.id;
    const commentCount = commentCounts[id] || 0;

    const authorHtml = d.userId
      ? `<a href="profile.html?user=${esc(d.userId)}" class="fw-bold text-decoration-none">${esc(d.displayName || 'Người dùng')}</a>`
        + (d.authorTag ? ` <span class="small text-muted">${esc(d.authorTag)}</span>` : '')
      : `<span class="fw-bold">${esc(d.displayName || 'Người dùng')}</span>`;

    const hashtagsHtml = (d.hashtags || [])
      .map(h => `<a href="hashtag.html?tag=${encodeURIComponent(h)}" class="hashtag">${esc(h)}</a>`)
      .join('');

    const ownerButtonsHtml = isOwner ? `
      <button class="btn btn-sm btn-outline-secondary btn-rounded btn-edit-post me-1">
        <i class="bi bi-pencil"></i>
      </button>
      <button class="btn btn-sm btn-outline-danger btn-rounded btn-delete-post">
        <i class="bi bi-trash"></i>
      </button>` : '';

    const card = document.createElement('div');
    card.className = 'card card-post p-3 mb-3';
    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-start mb-1">
        <div>${authorHtml}</div>
        <div class="small-muted">${fmtDate(d.createdAt)}</div>
      </div>
      <div class="fw-semibold mb-1">${esc(d.title || '')}</div>
      <div class="mb-2">${hashtagsHtml}</div>
      <div class="d-flex gap-2 align-items-center flex-wrap">
        <button class="btn btn-sm btn-outline-primary btn-rounded btn-like">
          <i class="bi bi-hand-thumbs-up"></i> <span class="like-count">${d.likes || 0}</span>
        </button>
        <button class="btn btn-sm btn-outline-secondary btn-rounded btn-dislike">
          <i class="bi bi-hand-thumbs-down"></i> <span class="dislike-count">${d.dislikes || 0}</span>
        </button>
        <button class="btn btn-sm btn-outline-secondary btn-rounded btn-comment-icon">
          <i class="bi bi-chat"></i> ${commentCount}
        </button>
        <a href="post.html?id=${esc(id)}" class="btn btn-sm btn-outline-secondary btn-rounded ms-auto">
          <i class="bi bi-arrow-up-right"></i> Xem
        </a>
      </div>
      <div class="mt-2 text-end">${ownerButtonsHtml}</div>
    `;

    card.querySelectorAll('.btn-like').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); toggleReaction(id, 'like', card); }));
    card.querySelectorAll('.btn-dislike').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); toggleReaction(id, 'dislike', card); }));
    card.querySelectorAll('.btn-comment-icon').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); openCommentsModal(id, d.title || ''); }));
    card.querySelectorAll('.btn-edit-post').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); openEditPost(id); }));
    card.querySelectorAll('.btn-delete-post').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); confirmDeletePost(id); }));

    frag.appendChild(card);
  });

  listEl.innerHTML = '';
  listEl.appendChild(frag);

  const kw = profileSearchInput.value.trim();
  if (kw) filterPostsByKeyword(kw);
}

async function toggleReaction(postId, reaction, cardEl) {
  if (!currentUser) { loginModalProfile.show(); return; }
  try {
    const likeRef  = doc(db, 'posts', postId, 'likes', currentUser.uid);
    const postRef  = doc(db, 'posts', postId);
    const likeSnap = await getDoc(likeRef);
    const batch    = writeBatch(db);

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
        if (reaction === 'like') {
          batch.update(postRef, { likes: increment(1), dislikes: increment(-1) });
        } else {
          batch.update(postRef, { dislikes: increment(1), likes: increment(-1) });
        }
      }
    }

    const likeBtn = cardEl.querySelector('.btn-like');
    const disBtn  = cardEl.querySelector('.btn-dislike');
    if (likeBtn) likeBtn.disabled = true;
    if (disBtn)  disBtn.disabled  = true;
    try { await batch.commit(); }
    catch (err) { console.error('reaction failed', err); alert('Không thể cập nhật phản hồi.'); }
    finally {
      if (likeBtn) likeBtn.disabled = false;
      if (disBtn)  disBtn.disabled  = false;
    }
  } catch (err) { console.error('toggleReaction error', err); }
}

// ── Post editor ───────────────────────────────────────────
function openAddPostEditor() {
  ensureQuill();
  document.getElementById('postEditorTitle').textContent = 'Viết bài mới';
  document.getElementById('postTitleInput').value    = '';
  document.getElementById('postHashtagsInput').value = '';
  if (quillEditor) quillEditor.root.innerHTML = '';
  // clear hidden postId
  let hidEl = document.getElementById('editorPostId');
  if (!hidEl) {
    hidEl = document.createElement('input');
    hidEl.type = 'hidden'; hidEl.id = 'editorPostId';
    document.getElementById('postEditorModal').querySelector('.modal-body').appendChild(hidEl);
  }
  hidEl.value = '';
  postEditorModal.show();
}

async function openEditPost(postId) {
  ensureQuill();
  try {
    const pSnap = await getDoc(doc(db, 'posts', postId));
    if (!pSnap.exists()) { alert('Bài viết không tồn tại.'); return; }
    const p = pSnap.data();
    document.getElementById('postEditorTitle').textContent    = 'Chỉnh sửa bài';
    document.getElementById('postTitleInput').value           = p.title    || '';
    document.getElementById('postHashtagsInput').value        = (p.hashtags || []).join(' ');
    if (quillEditor) quillEditor.root.innerHTML = p.content   || '';
    let hidEl = document.getElementById('editorPostId');
    if (!hidEl) {
      hidEl = document.createElement('input');
      hidEl.type = 'hidden'; hidEl.id = 'editorPostId';
      document.getElementById('postEditorModal').querySelector('.modal-body').appendChild(hidEl);
    }
    hidEl.value = postId;
    postEditorModal.show();
  } catch (e) { console.error('openEditPost error', e); alert('Không thể mở bài.'); }
}

document.getElementById('savePostBtn').addEventListener('click', async () => {
  if (!currentUser) return;
  const title    = (document.getElementById('postTitleInput')?.value || '').trim();
  const hashRaw  = document.getElementById('postHashtagsInput')?.value || '';
  const hashtags = hashRaw.split(/[, ]+/).map(s => s.trim()).filter(Boolean)
    .map(s => s.startsWith('#') ? s : '#' + s);
  const content  = quillEditor?.root.innerHTML || '';
  const postId   = document.getElementById('editorPostId')?.value || null;

  try {
    if (postId) {
      await updateDoc(doc(db, 'posts', postId), {
        title, content, hashtags, updatedAt: serverTimestamp()
      });
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
  if (!confirm('Bạn có chắc muốn xóa bài này? Hành động không thể hoàn tác.')) return;
  try { await deleteDoc(doc(db, 'posts', postId)); }
  catch (e) { console.error('deletePost error', e); alert('Không thể xóa bài.'); }
}

// ═══════════════════════════════════════════════════════════
// COMMENTS MODAL
// ═══════════════════════════════════════════════════════════
async function openCommentsModal(postId, title) {
  currentCommentsPostId = postId;
  document.getElementById('profileCommentsTitle').textContent = `Bình luận — ${title || ''}`;

  const listEl = document.getElementById('profileCommentsList');
  listEl.innerHTML = '<div class="text-muted py-3 text-center">Đang tải...</div>';

  if (!currentUser) {
    document.getElementById('profileMustLoginToComment').style.display = '';
    document.getElementById('profileCommentBoxArea').style.display     = 'none';
    document.getElementById('openLoginFromProfileComment').onclick = e => {
      e.preventDefault();
      loginModalProfile.show();
    };
  } else {
    document.getElementById('profileMustLoginToComment').style.display = 'none';
    document.getElementById('profileCommentBoxArea').style.display     = '';
    try {
      const udoc = await getDoc(doc(db, 'users', currentUser.uid));
      const prof = udoc.exists() ? udoc.data() : null;
      const av   = getAvatarUrl(prof, prof?.displayName || currentUser.email);
      document.getElementById('profileCommenterInfo').innerHTML = `
        <div class="d-flex gap-2 align-items-center">
          <img src="${esc(av)}" class="user-avatar" style="cursor:default;">
          <div class="fw-bold">${esc(prof?.displayName || currentUser.email)}</div>
        </div>`;
    } catch (_) {}
  }

  subscribeToComments(postId);
  commentsModal.show();
}

function subscribeToComments(postId) {
  if (commentsUnsub) commentsUnsub();
  const q = query(
    collection(db, 'posts', postId, 'comments'),
    orderBy('createdAt', 'desc')
  );
  let timeout = null;
  commentsUnsub = onSnapshot(q, snap => {
    clearTimeout(timeout);
    timeout = setTimeout(() => renderComments(snap), 250);
  });
}

async function renderComments(snapshot) {
  const listEl = document.getElementById('profileCommentsList');
  if (!listEl) return;
  if (snapshot.empty) {
    listEl.innerHTML = '<div class="text-muted py-3 text-center">Chưa có bình luận</div>';
    return;
  }

  listEl.innerHTML = '';
  snapshot.docs.forEach(docSnap => {
    const c   = docSnap.data();
    const av  = c.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.displayName||'U')}&background=0D6EFD&color=fff&size=80`;
    const isReply = !!c.replyTo;
    const item = document.createElement('div');
    item.className = 'comment-item';
    if (isReply) item.style.marginLeft = '24px';
    item.innerHTML = `
      <div class="d-flex gap-2 align-items-center mb-1">
        <img src="${esc(av)}" class="user-avatar" style="width:32px;height:32px;">
        <span class="fw-bold">${esc(c.displayName || 'Người dùng')}</span>
        <span class="small-muted ms-auto">${fmtDate(c.createdAt)}</span>
      </div>
      <div class="comment-text">${esc(c.text || '')}</div>
    `;
    listEl.appendChild(item);
  });
}

document.getElementById('profilePostCommentBtn').addEventListener('click', async () => {
  const text = (document.getElementById('profileCommentText').value || '').trim();
  if (!text) return;
  if (!currentUser) { loginModalProfile.show(); return; }

  let prof = null;
  try {
    const uSnap = await getDoc(doc(db, 'users', currentUser.uid));
    if (uSnap.exists()) prof = uSnap.data();
  } catch (_) {}

  try {
    await addDoc(collection(db, 'posts', currentCommentsPostId, 'comments'), {
      displayName: prof?.displayName || currentUser.email,
      userId: currentUser.uid,
      avatarUrl: prof?.avatarUrl || null,
      text,
      createdAt: serverTimestamp()
    });
    document.getElementById('profileCommentText').value = '';
  } catch (err) {
    console.error('post comment failed', err);
    alert('Không thể gửi bình luận.');
  }
});

// ═══════════════════════════════════════════════════════════
// VISITORS MODAL
// ═══════════════════════════════════════════════════════════
openVisitorsBtn.addEventListener('click', async () => {
  if (!userDoc) return;
  try {
    const vQ    = query(collection(db, 'users', userDoc.id, 'visitors'), orderBy('lastVisitedAt', 'desc'));
    const snaps = await getDocs(vQ);
    visitorsListEl.innerHTML = '';
    if (snaps.empty) {
      visitorsListEl.innerHTML = `<div class="text-muted py-2">Chưa có khách ghé thăm</div>`;
      return;
    }
    snaps.forEach(s => {
      const v       = s.data();
      const display = v.displayName || '(Người dùng)';
      const tag     = v.tagName || '';
      const avatar  = v.avatarUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(display)}&background=0D6EFD&color=fff&size=128`;
      const el = document.createElement('div');
      el.className = 'visitor-item position-relative';
      el.style.cursor = 'pointer';
      el.innerHTML = `
        <img src="${esc(avatar)}" class="visitor-avatar" alt="">
        <div>
          <div class="fw-bold">${esc(display)}${tag ? ` <span class="small text-muted">${esc(tag)}</span>` : ''}</div>
          <div class="small text-muted">${fmtDate(v.lastVisitedAt)}</div>
        </div>`;
      el.addEventListener('click', () => {
        window.location.href = `profile.html?user=${encodeURIComponent(v.userId)}`;
      });
      visitorsListEl.appendChild(el);
    });
    new bootstrap.Modal(document.getElementById('visitorsModal')).show();
  } catch (err) {
    console.error('visitors modal error', err);
    alert('Không thể tải danh sách khách.');
  }
});

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
profileSearchInput.addEventListener('input', ev => {
  const kw = ev.target.value.trim();
  if (!kw) { renderPostsSnapshot(lastPostsDocs); profileSearchResults.style.display = 'none'; return; }
  filterPostsByKeyword(kw);
});

function filterPostsByKeyword(keyword) {
  const low   = keyword.toLowerCase();
  const listEl = document.getElementById('userPostsList');
  if (!listEl) return;
  listEl.querySelectorAll('.card-post, .card').forEach(card => {
    card.style.display = card.textContent.toLowerCase().includes(low) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════
// MENU AUTH AREA
// ═══════════════════════════════════════════════════════════
function renderMenuAuthArea() {
  if (!menuAuthAreaProfile) return;
  const u = userDoc;
  if (currentUser && u) {
    const av = getAvatarUrl(u, u.displayName);
    menuAuthAreaProfile.innerHTML = `
      <div class="d-flex gap-2 align-items-center">
        <img src="${esc(av)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
        <div>
          <div class="fw-bold">${esc(u.displayName || currentUser.email)}</div>
          <div class="small-muted">${esc(u.email || '')}</div>
        </div>
      </div>
      <div class="mt-3">
        <button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button>
      </div>`;
    document.getElementById('btnLogoutProfile').addEventListener('click', async () => {
      await signOut(auth);
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  } else if (currentUser) {
    menuAuthAreaProfile.innerHTML = `
      <div class="d-flex gap-2 align-items-center">
        <div class="fw-bold">${esc(currentUser.email || '')}</div>
      </div>
      <div class="mt-3">
        <button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button>
      </div>`;
    document.getElementById('btnLogoutProfile').addEventListener('click', async () => {
      await signOut(auth);
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  } else {
    menuAuthAreaProfile.innerHTML = `
      <div class="d-grid gap-2">
        <button id="openLoginProfile" class="btn btn-primary btn-rounded">Đăng nhập</button>
      </div>`;
    document.getElementById('openLoginProfile').addEventListener('click', () => {
      loginModalProfile.show();
      new bootstrap.Offcanvas(profileMenuCanvas).hide();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// LOGIN MODAL
// ═══════════════════════════════════════════════════════════
document.getElementById('loginBtnProfile').addEventListener('click', async () => {
  const email    = (document.getElementById('loginEmailProfile').value    || '').trim();
  const password =  document.getElementById('loginPasswordProfile').value || '';
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const u    = cred.user;
    const udoc = await getDoc(doc(db, 'users', u.uid));
    const profile = udoc.exists() ? udoc.data() : null;
    if (profile && profile.activated) {
      loginModalProfile.hide();
    } else {
      document.getElementById('activateBlockProfile').style.display = '';
      const code = prompt('Tài khoản chưa kích hoạt. Nhập mã kích hoạt do admin gửi:');
      if (code) {
        const uRef  = doc(db, 'users', u.uid);
        const uSnap = await getDoc(uRef);
        if (uSnap.exists() && uSnap.data().activationCode === code) {
          await updateDoc(uRef, { activated: true });
          alert('Kích hoạt thành công.');
          loginModalProfile.hide();
        } else {
          alert('Mã kích hoạt sai. Liên hệ admin.');
          await signOut(auth);
        }
      } else {
        await signOut(auth);
      }
    }
  } catch (err) {
    console.error('loginProfile error', err);
    alert('Lỗi đăng nhập: ' + (err.message || err));
  }
});

// ═══════════════════════════════════════════════════════════
// WINDOW EXPORTS (legacy compatibility)
// ═══════════════════════════════════════════════════════════
window.openEditPost       = openEditPost;
window.confirmDeletePost  = confirmDeletePost;
window.doFollow           = doFollow;
window.doUnfollow         = doUnfollow;
window.navigateToProfile  = uid => { window.location.href = `profile.html?user=${uid}`; };