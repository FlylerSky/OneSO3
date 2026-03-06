// JS/featureFlags.js
// ─────────────────────────────────────────────────────────────
// Đọc config từ Firestore (config/features) và áp dụng
// bật/tắt UI cho toàn Relife.
//
// Pattern giống các file khác: tự gọi initFirebase()
// KHÔNG nhận db từ ngoài → không bao giờ conflict biến.
//
// CÁCH DÙNG — thêm 2 dòng vào mỗi trang:
//
//   import { applyFeatureFlags } from './featureFlags.js';
//
//   // Gọi bên trong onAuthStateChanged hoặc bất kỳ
//   // async function nào, KHÔNG ở top-level:
//   onAuthStateChanged(auth, async user => {
//     await applyFeatureFlags('index');
//     // ... code hiện tại
//   });
// ─────────────────────────────────────────────────────────────

import { initFirebase } from '../firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Instance riêng — không đụng đến biến db của file gọi
const _db = initFirebase();

const DEFAULTS = {
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

// Export để file gọi có thể đọc flag nếu cần
export let flags = { ...DEFAULTS };

/**
 * Load config từ Firestore rồi áp dụng lên trang hiện tại.
 * @param {'index'|'post'|'profile'|'notification'} page
 */
export async function applyFeatureFlags(page = 'index') {
  try {
    const snap = await getDoc(doc(_db, 'config', 'features'));
    if (snap.exists()) {
      flags = { ...DEFAULTS, ...snap.data() };
    }
  } catch (e) {
    console.warn('[FeatureFlags] Dùng config mặc định.', e.message);
    // Không crash — tiếp tục với DEFAULTS
  }

  // ── Maintenance Mode: ghi đè toàn bộ trang ──────────────
  if (flags.maintenanceMode) {
    document.body.innerHTML = `
      <div style="
        min-height:100vh;display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        background:linear-gradient(135deg,#f5f5f7,#e8e8ea);
        text-align:center;padding:24px;
      ">
        <div style="font-size:3.5rem;margin-bottom:16px;">🔧</div>
        <h2 style="font-weight:700;color:#1d1d1f;margin-bottom:8px;">Đang bảo trì</h2>
        <p style="color:#86868b;max-width:360px;line-height:1.6;">
          Relife đang được nâng cấp. Vui lòng quay lại sau ít phút.
        </p>
      </div>`;
    return;
  }

  // ── Apply theo từng trang ────────────────────────────────
  _applyCommon();
  if (page === 'index')        _applyIndex();
  if (page === 'post')         _applyPost();
  if (page === 'profile')      _applyProfile();
  if (page === 'notification') _applyNotification();
}

// ─── Helpers ─────────────────────────────────────────────────

function _hide(...selectors) {
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
}

// Ẩn phần tử xuất hiện động (render sau khi JS chạy)
function _observeHide(containerSel, targetSel) {
  _hide(targetSel);
  const container = document.querySelector(containerSel);
  if (!container) return;
  new MutationObserver(() => {
    container.querySelectorAll(targetSel).forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });
  }).observe(container, { childList: true, subtree: true });
}

// ─── Common (áp dụng cho tất cả trang) ───────────────────────

function _applyCommon() {
  // Notification link trong menu
  if (!flags.showNotification || !flags.betaMode) {
    _hide('a[href="notification.html"]');
  }
  // Search
  if (!flags.allowSearch) {
    _hide('.search-box', '#searchInput', '#profileSearchInput');
  }
}

// ─── index.js ────────────────────────────────────────────────

function _applyIndex() {
  // Đăng ký: render động nên dùng observer trên menuAuthArea
  if (!flags.allowRegister) {
    _observeHide('#menuAuthArea', '#openRegister');
  }
  // Đăng bài
  if (!flags.allowCreatePost) {
    _hide('#btnOpenNewPost');
  }
  // Like / Dislike — render động trong feed
  if (!flags.allowLikeDislike) {
    _observeHide('#feed', '.btn-like, .btn-dislike');
  }
  // Comment
  if (!flags.allowComment) {
    _observeHide('#feed', '.btn-comment-icon');
  }
  // Follow trong feed
  if (!flags.allowFollow) {
    _observeHide('#feed', '.btn-follow-feed');
  }
  // Beta: Edit / Report comment
  if (!flags.allowEditComment || !flags.betaMode) {
    _observeHide('#commentsList', '.btn-edit-comment');
  }
  if (!flags.allowReportComment || !flags.betaMode) {
    _observeHide('#commentsList', '.btn-report-comment');
  }
}

// ─── post.js ─────────────────────────────────────────────────

function _applyPost() {
  if (!flags.allowLikeDislike) {
    _hide('#likeBtn', '#dislikeBtn');
  }
  if (!flags.allowComment) {
    _hide('#commentsSection', '#commentFormArea', '#commentCountBtn');
  }
  if (!flags.allowFollow) {
    _hide('#followBtn');
  }
  if (!flags.allowEditComment || !flags.betaMode) {
    _observeHide('#commentsList', '.btn-edit-comment');
  }
  if (!flags.allowReportComment || !flags.betaMode) {
    _observeHide('#commentsList', '.btn-report-comment');
  }
}

// ─── profile.js ──────────────────────────────────────────────

function _applyProfile() {
  if (!flags.allowFollow) {
    _hide('#followActionArea', '#followBtn');
  }
  if (!flags.allowComment) {
    _observeHide('#userPostsList', '.btn-comment-icon');
  }
  if (!flags.allowLikeDislike) {
    _observeHide('#userPostsList', '.btn-like, .btn-dislike');
  }
  // Beta
  if (!flags.showVisitors || !flags.betaMode) {
    _hide('#openVisitorsBtn');
  }
  if (!flags.showAchievements || !flags.betaMode) {
    _hide('#openAchievementsBtn');
  }
  if (!flags.allowEditComment || !flags.betaMode) {
    _observeHide('#profileCommentsList', '.btn-edit-comment');
  }
  if (!flags.allowReportComment || !flags.betaMode) {
    _observeHide('#profileCommentsList', '.btn-report-comment');
  }
}

// ─── notification.js ─────────────────────────────────────────

function _applyNotification() {
  // Trang này chỉ hợp lệ khi betaMode + showNotification = true
  if (!flags.showNotification || !flags.betaMode) {
    window.location.replace('index.html');
  }
}