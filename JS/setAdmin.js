  // ── Import giống các trang Relife khác ──────────────────────
  import { initFirebase } from '../firebase-config.js';
  import {
    getAuth, onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
  import {
    doc, getDoc, setDoc, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

  const db   = initFirebase();
  const auth = getAuth();

  // ── Config mặc định ─────────────────────────────────────────
  const DEFAULT_CONFIG = {
    maintenanceMode:    false,
    betaMode:           false,
    allowRegister:      true,
    allowCreatePost:    true,
    allowComment:       true,
    allowLikeDislike:   true,
    allowFollow:        true,
    allowSearch:        true,
    showNotification:   true,
    allowTagMention:    true,
    allowEditComment:   true,
    allowReportComment: true,
    showVisitors:       true,
    showAchievements:   true,
  };

  const CONFIG_DOC = doc(db, 'config', 'features');

  let currentConfig = { ...DEFAULT_CONFIG };
  let pendingConfig  = { ...DEFAULT_CONFIG };

  // ── DOM ─────────────────────────────────────────────────────
  const loadingScreen = document.getElementById('loadingScreen');
  const accessDenied  = document.getElementById('accessDenied');
  const mainContent   = document.getElementById('mainContent');
  const deniedMsg     = document.getElementById('deniedMsg');
  const adminName     = document.getElementById('adminName');
  const saveBar       = document.getElementById('saveBar');
  const saveBtn       = document.getElementById('saveBtn');
  const toastEl       = document.getElementById('toast');
  const betaSection   = document.getElementById('betaSection');

  // ── Auth check — dùng session đăng nhập của Relife ──────────
  // Không có form login riêng. Nếu chưa đăng nhập → báo lỗi.
  // Nếu đã đăng nhập → kiểm tra users/{uid}.type == "admin".
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      showDenied('Bạn chưa đăng nhập. Vui lòng đăng nhập trên Relife trước.');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists() || snap.data().type !== 'admin') {
        showDenied('Tài khoản của bạn không có quyền Admin.');
        return;
      }
      // Xác nhận admin thành công
      adminName.textContent = snap.data().displayName || user.email;
      showMain();
      await loadConfig();
    } catch (e) {
      showDenied('Không thể xác minh quyền. Thử tải lại trang.');
    }
  });

  // Dùng removeProperty + setProperty vì CSS có !important
  function forceShow(el, displayValue) {
    el.style.removeProperty('display');
    el.style.setProperty('display', displayValue, 'important');
  }

  function forceHide(el) {
    el.style.setProperty('display', 'none', 'important');
  }

  function showDenied(msg) {
    forceHide(loadingScreen);
    deniedMsg.textContent = msg;
    forceShow(accessDenied, 'flex');
  }

  function showMain() {
    forceHide(loadingScreen);
    forceShow(mainContent, 'block');
  }

  // ── Load config ─────────────────────────────────────────────
  async function loadConfig() {
    try {
      const snap = await getDoc(CONFIG_DOC);
      const data = snap.exists() ? snap.data() : {};
      currentConfig = { ...DEFAULT_CONFIG, ...data };
      pendingConfig  = { ...currentConfig };
      renderAll();
    } catch (e) {
      showToast('Lỗi tải config: ' + e.message, 'error');
    }
  }

  // ── Render tất cả toggles ────────────────────────────────────
  function renderAll() {
    Object.keys(DEFAULT_CONFIG).forEach(key => {
      const tog = document.querySelector(`[data-key="${key}"]`);
      if (!tog) return;
      tog.checked = !!currentConfig[key];
      updateCard(key, tog.checked);
    });
    updateBetaDim(!!currentConfig.betaMode);
    saveBar.classList.remove('visible');
  }

  function updateCard(key, isOn) {
    const lbl  = document.getElementById('lbl_' + key);
    const card = document.getElementById('card_' + key);

    if (lbl) {
      lbl.textContent = isOn ? 'ON' : 'OFF';
      // Màu đặc biệt cho maintenance (đỏ khi ON)
      if (key === 'maintenanceMode') {
        lbl.style.color = isOn ? 'var(--liquid-danger)' : 'var(--text-secondary)';
      } else if (key === 'betaMode') {
        lbl.style.color = isOn ? 'var(--liquid-warning)' : 'var(--text-secondary)';
      } else {
        lbl.style.color = isOn ? 'var(--liquid-success)' : 'var(--liquid-danger)';
      }
    }

    // Chỉ cập nhật is-on/is-off cho card thường, không override banner
    if (card && !card.classList.contains('banner-danger') && !card.classList.contains('banner-warning')) {
      card.classList.remove('is-on', 'is-off');
      card.classList.add(isOn ? 'is-on' : 'is-off');
    }
  }

  function updateBetaDim(betaOn) {
    betaSection.classList.toggle('dimmed', !betaOn);
  }

  // ── Toggle listeners ─────────────────────────────────────────
  document.querySelectorAll('[data-key]').forEach(tog => {
    tog.addEventListener('change', () => {
      const key = tog.dataset.key;
      pendingConfig[key] = tog.checked;
      updateCard(key, tog.checked);
      if (key === 'betaMode') updateBetaDim(tog.checked);
      saveBar.classList.add('visible');
    });
  });

  // ── Save ─────────────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang lưu...';
    try {
      await setDoc(CONFIG_DOC, {
        ...pendingConfig,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || 'admin'
      });
      currentConfig = { ...pendingConfig };
      saveBar.classList.remove('visible');
      showToast('Đã lưu cấu hình!', 'success');
    } catch (e) {
      showToast('Lỗi lưu: ' + e.message, 'error');
    }
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="bi bi-cloud-upload"></i> Lưu cấu hình';
  });

  // ── Toast ─────────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, type = 'success') {
    const icon = type === 'success'
      ? '<i class="bi bi-check-circle-fill"></i>'
      : '<i class="bi bi-x-circle-fill"></i>';
    toastEl.innerHTML = icon + ' ' + msg;
    toastEl.className = 'relife-toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
  }