// JS/notification.js - Relife Notification Page
// Read-only notification system with admin HTML editor tool

import { initFirebase } from '../firebase-config.js';
import {
  collection,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();

// DOM elements
const notificationsList = document.getElementById('notificationsList');
const totalCountEl = document.getElementById('totalCount');
const latestDateEl = document.getElementById('latestDate');
const openEditorBtn = document.getElementById('openEditorBtn');
const editorModal = new bootstrap.Modal(document.getElementById('editorModal'));

// Editor elements
const editorTitle = document.getElementById('editorTitle');
const editorCategory = document.getElementById('editorCategory');
const editorPriority = document.getElementById('editorPriority');
const outputJson = document.getElementById('outputJson');
const generateBtn = document.getElementById('generateBtn');
const copyBtn = document.getElementById('copyBtn');

// Quill editor
let quill = null;

// Utility functions
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[m]));

const fmtDate = ts => {
  try {
    if (!ts?.toDate) return '';
    const date = ts.toDate();
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    if (hours < 24) return `${hours} giờ trước`;
    if (days < 7) return `${days} ngày trước`;
    return date.toLocaleDateString('vi-VN');
  } catch {
    return '';
  }
};

/**
 * Initialize Quill editor
 */
function initQuill() {
  if (quill) return;

  quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        [{ 'align': [] }],
        ['link', 'image', 'video'],
        ['clean']
      ]
    },
    placeholder: 'Nhập nội dung notification...'
  });
}

/**
 * Load notifications from Firestore (realtime)
 */
function loadNotifications() {
  try {
    const notificationsRef = collection(db, 'notifications');
    const q = query(notificationsRef, orderBy('createdAt', 'desc'));

    onSnapshot(q, snapshot => {
      console.log('📦 Notifications snapshot received:', snapshot.size, 'docs');
      
      if (snapshot.empty) {
        notificationsList.innerHTML = `
          <div class="relife-glass-card" style="padding: 3rem; text-align: center;">
            <i class="bi bi-inbox" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
            <div style="color: var(--text-secondary); font-size: 1.125rem; margin-bottom: 0.5rem;">Chưa có thông báo nào</div>
            <small style="color: var(--text-secondary);">Thông báo mới sẽ xuất hiện ở đây</small>
          </div>
        `;
        totalCountEl.textContent = '0';
        latestDateEl.textContent = '--';
        return;
      }

      // Update stats
      totalCountEl.textContent = snapshot.size;
      
      try {
        const latest = snapshot.docs[0].data();
        latestDateEl.textContent = fmtDate(latest.createdAt);
      } catch(e) {
        console.warn('Cannot format latest date:', e);
        latestDateEl.textContent = '--';
      }

      // Render notifications
      renderNotifications(snapshot.docs);
    }, error => {
      console.error('Load notifications error:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      
      let errorMsg = 'Lỗi không xác định';
      if(error.code === 'permission-denied') {
        errorMsg = 'Không có quyền truy cập. Vui lòng kiểm tra Firestore Rules.';
      } else if(error.message) {
        errorMsg = error.message;
      }
      
      notificationsList.innerHTML = `
        <div class="relife-glass-card" style="padding: 2rem; text-align: center; color: var(--liquid-danger);">
          <i class="bi bi-exclamation-triangle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <div style="margin-bottom: 0.5rem; font-weight: 600;">Lỗi khi tải thông báo</div>
          <small style="display: block; margin-bottom: 1rem;">${esc(errorMsg)}</small>
          ${error.code === 'permission-denied' ? `
            <div style="background: rgba(255,149,0,0.1); padding: 1rem; border-radius: 12px; margin-top: 1rem;">
              <div style="font-weight: 600; margin-bottom: 0.5rem;">🔧 Cách sửa:</div>
              <ol style="text-align: left; padding-left: 1.5rem; margin: 0;">
                <li>Mở Firebase Console → Firestore → Rules</li>
                <li>Thêm: <code>match /notifications/{notificationId} { allow read: if true; }</code></li>
                <li>Nhấn Publish</li>
              </ol>
            </div>
          ` : ''}
        </div>
      `;
    });
  } catch(initError) {
    console.error('Initialize notifications error:', initError);
    notificationsList.innerHTML = `
      <div class="relife-glass-card" style="padding: 2rem; text-align: center; color: var(--liquid-danger);">
        <i class="bi bi-x-circle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
        <div>Không thể khởi tạo</div>
        <small>${esc(initError.message || initError)}</small>
      </div>
    `;
  }
}

/**
 * Render notifications list (title only, click to POST page)
 */
function renderNotifications(docs) {
  const fragment = document.createDocumentFragment();

  docs.forEach((docSnap, index) => {
    const data = docSnap.data();
    const id = docSnap.id;

    const card = document.createElement('div');
    card.className = `relife-notification-card priority-${data.priority || 'normal'}`;
    card.style.animationDelay = `${index * 0.05}s`;

    const categoryIcon = getCategoryIcon(data.category);
    const priorityBadge = data.priority === 'high' ? '<span class="notification-badge" style="background: rgba(255, 59, 48, 0.15); color: var(--liquid-danger);">Quan trọng</span>' : '';

    card.innerHTML = `
      <div class="notification-header">
        <div style="flex: 1;">
          <div class="notification-title">${esc(data.title || 'Không có tiêu đề')}</div>
          <div class="notification-meta">
            <span class="notification-badge category-${data.category || 'news'}">
              ${categoryIcon} ${getCategoryLabel(data.category)}
            </span>
            ${priorityBadge}
            <div class="notification-date">
              <i class="bi bi-clock"></i>
              <span>${fmtDate(data.createdAt)}</span>
            </div>
          </div>
        </div>
        <i class="bi bi-chevron-right" style="font-size: 1.5rem; color: var(--text-secondary);"> Nhấn để xem thêm</i>
      </div>
    `;

    // Click → redirect to POST page with notification ID
    card.addEventListener('click', () => {
      window.location.href = `post.html?notification=${id}`;
    });
    
    fragment.appendChild(card);
  });

  notificationsList.innerHTML = '';
  notificationsList.appendChild(fragment);
}

/**
 * Get category icon
 */
function getCategoryIcon(category) {
  const icons = {
    'update': '<i class="bi bi-arrow-up-circle-fill"></i>',
    'maintenance': '<i class="bi bi-tools"></i>',
    'feature': '<i class="bi bi-stars"></i>',
    'news': '<i class="bi bi-newspaper"></i>'
  };
  return icons[category] || icons.news;
}

/**
 * Get category label
 */
function getCategoryLabel(category) {
  const labels = {
    'update': 'Cập nhật',
    'maintenance': 'Bảo trì',
    'feature': 'Tính năng mới',
    'news': 'Tin tức'
  };
  return labels[category] || 'Tin tức';
}

/**
 * Generate JSON for Firestore
 */
function generateJson() {
  const title = editorTitle.value.trim();
  if (!title) {
    alert('❌ Vui lòng nhập tiêu đề');
    return;
  }

  const contentHTML = quill.root.innerHTML;
  const category = editorCategory.value;
  const priority = editorPriority.value;

  const json = {
    title: title,
    content: contentHTML,
    category: category,
    priority: priority,
    createdAt: "{{REPLACE_WITH_TIMESTAMP}}"
  };

  const jsonString = JSON.stringify(json, null, 2);
  outputJson.value = jsonString;

  // Show success message
  const originalText = generateBtn.innerHTML;
  generateBtn.innerHTML = '<i class="bi bi-check-lg me-2"></i>Đã tạo';
  generateBtn.classList.add('btn-success');
  generateBtn.classList.remove('btn-primary');

  setTimeout(() => {
    generateBtn.innerHTML = originalText;
    generateBtn.classList.remove('btn-success');
    generateBtn.classList.add('btn-primary');
  }, 2000);
}

/**
 * Copy JSON to clipboard
 */
async function copyJson() {
  if (!outputJson.value) {
    alert('⚠️ Chưa có JSON để copy. Vui lòng nhấn "Tạo JSON" trước.');
    return;
  }

  try {
    await navigator.clipboard.writeText(outputJson.value);

    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i class="bi bi-check-lg me-2"></i>Đã copy';
    copyBtn.classList.add('btn-success');

    setTimeout(() => {
      copyBtn.innerHTML = originalText;
      copyBtn.classList.remove('btn-success');
    }, 2000);
  } catch (err) {
    console.error('Copy error:', err);
    alert('❌ Không thể copy. Vui lòng copy thủ công.');
  }
}

/**
 * Clear editor form
 */
function clearEditor() {
  editorTitle.value = '';
  editorCategory.value = 'update';
  editorPriority.value = 'normal';
  quill.root.innerHTML = '';
  outputJson.value = '';
}

// Event listeners
openEditorBtn.addEventListener('click', () => {
  initQuill();
  clearEditor();
  editorModal.show();
});

generateBtn.addEventListener('click', generateJson);
copyBtn.addEventListener('click', copyJson);

// Initialize
loadNotifications();

console.log('🔔 Relife Notification loaded');
console.log('📌 Instructions:');
console.log('1. Nhấn icon 🔨 để mở công cụ soạn thảo');
console.log('2. Soạn nội dung và nhấn "Tạo JSON"');
console.log('3. Copy JSON và thêm vào Firestore collection "notifications"');
console.log('4. Thay "{{REPLACE_WITH_TIMESTAMP}}" bằng serverTimestamp() trong Firestore Console');
console.log('5. Click vào notification → Xem đầy đủ trên trang POST');