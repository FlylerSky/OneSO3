// JS/post.js - Relife UI 1.0 Enhanced
// Optimized for Liquid Glass Design System with full Quill support
import { initFirebase } from '../firebase-config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc, getDoc, updateDoc, increment,
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();
const auth = getAuth();
const params = new URLSearchParams(location.search);
const postId = params.get('id');
const postArea = document.getElementById('postArea');
const commentsSection = document.getElementById('commentsSection');
const hiddenRenderer = document.getElementById('__qs_hidden_renderer');

// Utility functions
const esc = s => String(s||'').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => { 
  try {
    if(!ts?.toDate) return '';
    const date = ts.toDate();
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if(minutes < 1) return 'Vừa xong';
    if(minutes < 60) return `${minutes} phút trước`;
    if(hours < 24) return `${hours} giờ trước`;
    if(days < 7) return `${days} ngày trước`;
    return date.toLocaleDateString('vi-VN');
  } catch { 
    return ''; 
  }
};

// DOMPurify config
const PURIFY_CFG_ALLOW_CLASS = {
  ADD_TAGS: ['iframe','table','thead','tbody','tfoot','tr','td','th','video','source','figure','figcaption','caption','pre','code','span','ul','ol','li'],
  ADD_ATTR: ['style','class','id','width','height','allow','allowfullscreen','frameborder','controls','playsinline','loading','referrerpolicy','sandbox','data-*','src','srcdoc'],
  FORBID_TAGS: ['script','object','embed'],
  KEEP_CONTENT: false
};

/**
 * Inline computed styles for rendering
 */
function inlineComputedStyles(root) {
  if(!root) return;
  const walk = el => {
    if(el.nodeType !== 1) return;
    const cs = window.getComputedStyle(el);
    try {
      if(cs.fontSize) el.style.fontSize = cs.fontSize;
      if(cs.fontFamily) el.style.fontFamily = cs.fontFamily;
      if(cs.fontWeight) el.style.fontWeight = cs.fontWeight;
      if(cs.fontStyle && cs.fontStyle !== 'normal') el.style.fontStyle = cs.fontStyle;
      if(cs.textDecorationLine && cs.textDecorationLine !== 'none') el.style.textDecoration = cs.textDecorationLine;
      if(cs.color) el.style.color = cs.color;
      if(cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') el.style.backgroundColor = cs.backgroundColor;
      if(cs.textAlign && el.tagName.match(/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/i)) el.style.textAlign = cs.textAlign;
      if(cs.lineHeight) el.style.lineHeight = cs.lineHeight;
      if(cs.letterSpacing && cs.letterSpacing !== 'normal') el.style.letterSpacing = cs.letterSpacing;
    } catch(e){}
    Array.from(el.children).forEach(child => walk(child));
  };
  walk(root);
}

/**
 * Render Delta format (preserve styles)
 */
async function renderDeltaPreserveStyles(delta) {
  hiddenRenderer.style.display = 'block';
  hiddenRenderer.innerHTML = '';
  const temp = document.createElement('div');
  const editorHolder = document.createElement('div');
  editorHolder.className = 'ql-container ql-snow';
  temp.appendChild(editorHolder);
  hiddenRenderer.appendChild(temp);
  const q = new Quill(editorHolder, { theme: 'snow', readOnly: true, modules: { toolbar: false } });
  if(delta.ops) q.setContents(delta); else q.setContents({ ops: delta });
  const editor = editorHolder.querySelector('.ql-editor') || editorHolder.querySelector('[contenteditable]');
  inlineComputedStyles(editor);
  let html = editor.innerHTML;
  hiddenRenderer.innerHTML = '';
  hiddenRenderer.style.display = 'none';
  const sanitized = DOMPurify.sanitize(html, PURIFY_CFG_ALLOW_CLASS);
  return postProcessHtml(sanitized);
}

/**
 * Render HTML format (preserve styles)
 */
async function renderHtmlPreserveStyles(rawHtml) {
  const sanitizedKeep = DOMPurify.sanitize(rawHtml, PURIFY_CFG_ALLOW_CLASS);
  hiddenRenderer.style.display = 'block';
  hiddenRenderer.innerHTML = `<div class="ql-editor">${sanitizedKeep}</div>`;
  const editor = hiddenRenderer.querySelector('.ql-editor');
  inlineComputedStyles(editor);
  let html = editor.innerHTML;
  hiddenRenderer.innerHTML = '';
  hiddenRenderer.style.display = 'none';
  const sanitizedFinal = DOMPurify.sanitize(html, PURIFY_CFG_ALLOW_CLASS);
  return postProcessHtml(sanitizedFinal);
}

/**
 * Post-process HTML: normalize lists, wrap media, etc.
 */
function postProcessHtml(sanitizedHtml) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = sanitizedHtml;

  // Remove Quill UI spans
  wrapper.querySelectorAll('span.ql-ui').forEach(el => el.remove());

  // Normalize Quill paragraph lists
  normalizeQuillParagraphLists(wrapper);
  
  // Fix list container types
  fixListContainerTypes(wrapper);

  // Wrap iframes
  wrapper.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || iframe.src || '';
    if(!src || src.trim() === '') return;
    if(iframe.closest('.iframe-wrapper')) return;
    const container = document.createElement('div');
    container.className = 'iframe-wrapper';
    iframe.parentNode.replaceChild(container, iframe);
    container.appendChild(iframe);
  });

  // Wrap tables
  wrapper.querySelectorAll('table').forEach(tbl => {
    if(tbl.closest('.table-wrapper')) return;
    const w = document.createElement('div');
    w.className = 'table-wrapper';
    tbl.parentNode.replaceChild(w, tbl);
    w.appendChild(tbl);
  });

  // Ensure links open in new tab
  wrapper.querySelectorAll('a').forEach(a => {
    if(!a.target) a.setAttribute('target','_blank');
    if(!a.rel) a.setAttribute('rel','noopener noreferrer');
  });

  // Remove leftover data-list attributes
  wrapper.querySelectorAll('[data-list]').forEach(el => {
    el.removeAttribute('data-list');
  });

  return wrapper.innerHTML;
}

function normalizeQuillParagraphLists(container) {
  if(!container) return;
  const qlNodes = Array.from(container.querySelectorAll('.ql-list'));
  const processed = new Set();
  for(const node of qlNodes) {
    if(processed.has(node)) continue;
    if(node.closest('ul,ol')) { processed.add(node); continue; }
    const listType = (node.getAttribute && node.getAttribute('data-list')) || 'bullet';
    const tagName = /order|ordered|number/i.test(listType) ? 'ol' : 'ul';
    const items = [];
    let cur = node;
    while(cur && cur.classList && cur.classList.contains('ql-list') && ((cur.getAttribute && (cur.getAttribute('data-list') || 'bullet')) === listType)) {
      items.push(cur);
      processed.add(cur);
      cur = cur.nextElementSibling;
    }
    if(items.length) {
      const listEl = document.createElement(tagName);
      for(const itemNode of items) {
        const li = document.createElement('li');
        li.innerHTML = itemNode.innerHTML;
        listEl.appendChild(li);
        itemNode.parentNode && itemNode.parentNode.removeChild(itemNode);
      }
      if(cur && cur.parentNode) {
        cur.parentNode.insertBefore(listEl, cur);
      } else {
        container.appendChild(listEl);
      }
    }
  }
}

function fixListContainerTypes(container) {
  if(!container) return;
  const liNodes = Array.from(container.querySelectorAll('li[data-list]'));
  for(const li of liNodes) {
    const dataList = (li.getAttribute('data-list') || '').toLowerCase();
    const desiredTag = /order|ordered|number/i.test(dataList) ? 'ol' : 'ul';
    const parent = li.parentElement;
    if(!parent) continue;
    const parentTag = parent.tagName.toLowerCase();
    if(parentTag === desiredTag) continue;
    
    const siblings = [];
    let prev = li.previousElementSibling;
    while(prev && prev.tagName.toLowerCase() === 'li' && (prev.getAttribute && prev.getAttribute('data-list') || '') === (li.getAttribute('data-list') || '')) {
      prev = prev.previousElementSibling;
    }
    let cur = prev ? prev.nextElementSibling : parent.firstElementChild;
    while(cur && cur.tagName.toLowerCase() === 'li' && (cur.getAttribute && cur.getAttribute('data-list') || '') === (li.getAttribute('data-list') || '')) {
      siblings.push(cur);
      cur = cur.nextElementSibling;
    }
    if(siblings.length) {
      const newList = document.createElement(desiredTag);
      for(const item of siblings) {
        const newLi = document.createElement('li');
        newLi.innerHTML = item.innerHTML;
        newList.appendChild(newLi);
        item.parentNode && item.parentNode.removeChild(item);
      }
      const insertBeforeNode = cur || null;
      if(insertBeforeNode && insertBeforeNode.parentNode) {
        insertBeforeNode.parentNode.insertBefore(newList, insertBeforeNode);
      } else {
        parent.parentNode.insertBefore(newList, parent.nextSibling);
      }
    }
    if(parent && parent.children.length === 0 && parent.parentNode) {
      parent.parentNode.removeChild(parent);
    }
  }
}

/**
 * Render content (auto-detect format)
 */
async function renderContent(rawContent) {
  if(!rawContent && rawContent !== '') return '<div class="text-muted" style="white-space:pre-wrap;">(Không có nội dung)</div>';
  if(typeof rawContent === 'object') return await renderDeltaPreserveStyles(rawContent);
  const str = String(rawContent).trim();
  if(str.startsWith('<')) return await renderHtmlPreserveStyles(rawContent);
  try {
    const parsed = JSON.parse(str);
    if((parsed && parsed.ops && Array.isArray(parsed.ops)) || (Array.isArray(parsed) && parsed.length)) return await renderDeltaPreserveStyles(parsed);
  } catch(e){}
  return `<div style="white-space:pre-wrap;">${esc(rawContent)}</div>`;
}

/**
 * Image Viewer (Performance-optimized)
 */
function createImageViewerElements() {
  const existing = document.getElementById('os-image-viewer');
  if(existing && existing._perfApi) return existing._perfApi;

  const overlay = existing || document.getElementById('os-image-viewer');
  const inner = overlay.querySelector('.os-viewer-inner');
  const img = overlay.querySelector('.os-viewer-img');
  const controls = overlay.querySelector('.os-viewer-controls');
  const downloadAnchor = overlay.querySelector('[data-action="download"]');
  const zoomIndicator = overlay.querySelector('.os-viewer-zoom-indicator');

  let target = { scale: 1, tx: 0, ty: 0 };
  let rendered = { scale: 1, tx: 0, ty: 0 };
  const SMOOTH = 0.18;
  let rafId = null;

  function rafLoop() {
    let changed = false;
    if(Math.abs(rendered.scale - target.scale) > 0.001) {
      rendered.scale += (target.scale - rendered.scale) * SMOOTH;
      changed = true;
    } else if(rendered.scale !== target.scale) {
      rendered.scale = target.scale; changed = true;
    }
    if(Math.abs(rendered.tx - target.tx) > 0.5) {
      rendered.tx += (target.tx - rendered.tx) * SMOOTH; changed = true;
    } else if(rendered.tx !== target.tx) {
      rendered.tx = target.tx; changed = true;
    }
    if(Math.abs(rendered.ty - target.ty) > 0.5) {
      rendered.ty += (target.ty - rendered.ty) * SMOOTH; changed = true;
    } else if(rendered.ty !== target.ty) {
      rendered.ty = target.ty; changed = true;
    }

    if(changed) {
      img.style.transform = `translate3d(${rendered.tx}px, ${rendered.ty}px, 0) scale(${rendered.scale})`;
      zoomIndicator.textContent = `${Math.round(rendered.scale * 100)}%`;
    }
    rafId = requestAnimationFrame(rafLoop);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resetToFit() {
    const rect = img.getBoundingClientRect();
    const containerRect = inner.getBoundingClientRect();
    target.scale = 1;
    target.tx = (containerRect.width - rect.width) / 2;
    target.ty = (containerRect.height - rect.height) / 2;
  }

  function open(src) {
    if(!src) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    img.src = src;
    img.onload = () => {
      target.scale = 1;
      rendered.scale = 1; rendered.tx = 0; rendered.ty = 0;
      const rect = img.getBoundingClientRect();
      const containerRect = inner.getBoundingClientRect();
      target.tx = (containerRect.width - rect.width) / 2;
      target.ty = (containerRect.height - rect.height) / 2;
      if(!rafId) rafLoop();
      downloadAnchor.href = src;
      try {
        const url = new URL(src, location.href);
        const fn = url.pathname.split('/').pop() || 'image';
        downloadAnchor.setAttribute('download', fn);
      } catch(e) {
        downloadAnchor.removeAttribute('download');
      }
      overlay.focus();
    };
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if(rafId) { cancelAnimationFrame(rafId); rafId = null; }
    img.src = '';
    target = { scale: 1, tx: 0, ty: 0 };
    rendered = { scale: 1, tx: 0, ty: 0 };
  }

  controls.addEventListener('click', ev => {
    ev.stopPropagation();
    const action = ev.target.closest('[data-action]')?.getAttribute('data-action');
    if(!action) return;
    if(action === 'zoom-in') { target.scale = clamp(target.scale * 1.25, 0.2, 6); }
    else if(action === 'zoom-out') { target.scale = clamp(target.scale / 1.25, 0.2, 6); }
    else if(action === 'fit') { resetToFit(); }
    else if(action === 'close') { close(); }
  });

  overlay.addEventListener('click', ev => {
    if(ev.target === overlay) close();
  });

  window.addEventListener('keydown', ev => {
    if(!overlay.classList.contains('open')) return;
    if(ev.key === 'Escape') { close(); }
    if(ev.key === '+' || ev.key === '=') { target.scale = clamp(target.scale * 1.25, 0.2, 6); }
    if(ev.key === '-') { target.scale = clamp(target.scale / 1.25, 0.2, 6); }
  });

  overlay.addEventListener('wheel', ev => {
    if(!overlay.classList.contains('open')) return;
    ev.preventDefault();
    const delta = -ev.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    const rect = img.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const prevScale = target.scale;
    const newScale = clamp(prevScale * factor, 0.2, 6);
    const scaleRatio = newScale / prevScale;
    target.tx = (target.tx - cx) * scaleRatio + cx;
    target.ty = (target.ty - cy) * scaleRatio + cy;
    target.scale = newScale;
  }, { passive: false });

  let pointerActive = false;
  let pointerStart = null;
  overlay.addEventListener('pointerdown', ev => {
    if(!overlay.classList.contains('open')) return;
    const onImg = ev.target === img;
    if(!onImg) return;
    ev.preventDefault();
    pointerActive = true;
    overlay.setPointerCapture(ev.pointerId);
    pointerStart = { x: ev.clientX, y: ev.clientY, tx: target.tx, ty: target.ty };
    img.style.cursor = 'grabbing';
  });

  overlay.addEventListener('pointermove', ev => {
    if(!pointerActive || !pointerStart) return;
    ev.preventDefault();
    const dx = ev.clientX - pointerStart.x;
    const dy = ev.clientY - pointerStart.y;
    target.tx = pointerStart.tx + dx;
    target.ty = pointerStart.ty + dy;
  });

  overlay.addEventListener('pointerup', ev => {
    if(!pointerActive) return;
    try { overlay.releasePointerCapture(ev.pointerId); } catch(e){}
    pointerActive = false;
    pointerStart = null;
    img.style.cursor = 'grab';
  });

  const api = { open, close, overlay, img };
  overlay._perfApi = api;
  return api;
}

function attachImageViewerToContent() {
  createImageViewerElements();
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if(!target) return;
    const inPost = target.closest && target.closest('#postContentContainer');
    if(inPost && target.tagName && target.tagName.toLowerCase() === 'img') {
      ev.preventDefault();
      const src = target.getAttribute('data-full') || target.src || target.getAttribute('data-src') || '';
      const overlayEl = document.getElementById('os-image-viewer');
      if(overlayEl && overlayEl._perfApi && overlayEl._perfApi.open) {
        overlayEl._perfApi.open(src);
      }
    }
  }, false);
}

/**
 * Load and render post
 */
async function load() {
  if(!postId) {
    postArea.innerHTML = `
      <div class="relife-glass-card">
        <div class="text-center text-muted py-5">
          <i class="bi bi-exclamation-circle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
          <div>ID bài viết không hợp lệ.</div>
          <a href="index.html" class="relife-btn-primary mt-3">Về trang chủ</a>
        </div>
      </div>
    `;
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'posts', postId));
    if(!snap.exists()) {
      postArea.innerHTML = `
        <div class="relife-glass-card">
          <div class="text-center text-muted py-5">
            <i class="bi bi-file-earmark-x" style="font-size: 3rem; margin-bottom: 1rem;"></i>
            <div>Không tìm thấy bài viết</div>
            <a href="index.html" class="relife-btn-primary mt-3">Về trang chủ</a>
          </div>
        </div>
      `;
      return;
    }

    const d = snap.data();

    // Get author info
    let authorHtml = '';
    let authorAvatar = '';
    if(d.userId) {
      const userSnap = await getDoc(doc(db, 'users', d.userId));
      const prof = userSnap.exists() ? userSnap.data() : null;
      authorAvatar = prof?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(prof?.displayName||d.displayName||'U')}&background=0D6EFD&color=fff&size=128`;
      const tag = prof?.tagName || d.authorTag || '';
      authorHtml = `
        <div class="relife-post-header">
          <img src="${authorAvatar}" class="relife-author-avatar" alt="avatar">
          <div class="relife-author-info">
            <div class="relife-author-name">${esc(d.displayName || prof?.displayName || 'Người dùng')}</div>
            <div class="relife-author-meta">
              ${tag ? `<div class="relife-author-tag">${esc(tag)}</div>` : ''}
              <div class="relife-post-time">
                <i class="bi bi-clock"></i>
                <span>${fmtDate(d.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      authorAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'T')}&background=FFC107&color=000&size=128`;
      authorHtml = `
        <div class="relife-post-header">
          <img src="${authorAvatar}" class="relife-author-avatar" alt="avatar">
          <div class="relife-author-info">
            <div class="relife-author-name">${esc(d.displayName || 'Tài khoản thử nghiệm')}</div>
            <div class="relife-author-meta">
              <span class="relife-trial-badge">Tài khoản thử nghiệm</span>
              <div class="relife-post-time">
                <i class="bi bi-clock"></i>
                <span>${fmtDate(d.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Render content
    const raw = d.content || '';
    let rendered = '';
    try {
      rendered = await renderContent(raw);
    } catch(err) {
      console.error('Render failed', err);
      rendered = DOMPurify.sanitize(String(raw), PURIFY_CFG_ALLOW_CLASS);
    }

    // Hashtags
    const hashtagsHtml = (d.hashtags||[]).map(h => 
      `<a href="tag.html?tag=${encodeURIComponent(h)}" class="relife-hashtag">
        <i class="bi bi-hash"></i>${esc(h.replace(/^#/, ''))}
      </a>`
    ).join('');

    // Build post HTML
    postArea.innerHTML = `
      <div class="relife-glass-card">
        ${authorHtml}
        <h1 class="relife-post-title">${esc(d.title || 'Không có tiêu đề')}</h1>
        ${hashtagsHtml ? `<div class="relife-hashtags">${hashtagsHtml}</div>` : ''}
        <div id="postContentContainer" class="post-content">${rendered}</div>
        
        <div class="relife-reactions">
          <button id="likeBtn" class="relife-reaction-btn">
            <i class="bi bi-hand-thumbs-up-fill"></i>
            <span id="likeCount">${d.likes||0}</span>
          </button>
          <button id="dislikeBtn" class="relife-reaction-btn">
            <i class="bi bi-hand-thumbs-down-fill"></i>
            <span id="dislikeCount">${d.dislikes||0}</span>
          </button>
          <button id="commentToggle" class="relife-reaction-btn">
            <i class="bi bi-chat-dots-fill"></i>
            <span id="commentCountBtn">${d.commentsCount||0}</span>
          </button>
        </div>
      </div>
    `;

    // Attach image viewer
    attachImageViewerToContent();

    // Show comments section
    commentsSection.style.display = 'block';
    document.getElementById('commentCount').textContent = d.commentsCount || 0;

    // Bind events
    bindEvents();
    watchRealtime();
    updateReactionButtonsState();

    // Smooth scroll animation
    postArea.querySelector('.relife-glass-card').style.animation = 'fadeInUp 0.5s ease';

  } catch(err) {
    console.error('Load post error:', err);
    postArea.innerHTML = `
      <div class="relife-glass-card">
        <div class="text-center text-danger py-5">
          <i class="bi bi-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
          <div>Lỗi khi tải bài viết</div>
          <small class="text-muted d-block mt-2">${esc(err.message || err)}</small>
          <a href="index.html" class="relife-btn-primary mt-3">Về trang chủ</a>
        </div>
      </div>
    `;
  }
}

/**
 * Watch realtime updates
 */
let commentsUnsub = null;
function watchRealtime() {
  // Watch comments
  const commentsRef = collection(db, 'posts', postId, 'comments');
  const q = query(commentsRef, orderBy('createdAt', 'desc'));
  if(commentsUnsub) commentsUnsub();
  commentsUnsub = onSnapshot(q, snap => {
    const list = document.getElementById('commentsList');
    list.innerHTML = '';
    if(snap.empty) {
      list.innerHTML = '<div class="text-center text-muted py-3">Chưa có bình luận</div>';
      return;
    }
    snap.forEach((s, idx) => {
      const c = s.data();
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.displayName||'U')}&background=0D6EFD&color=fff&size=80`;
      const commentEl = document.createElement('div');
      commentEl.className = 'relife-comment';
      commentEl.style.animationDelay = `${idx * 0.05}s`;
      commentEl.innerHTML = `
        <div class="relife-comment-header">
          <img src="${avatar}" class="relife-comment-avatar" alt="avatar">
          <div class="relife-comment-author">
            <div class="relife-comment-name">${esc(c.displayName||'Ẩn danh')}</div>
            <div class="relife-comment-time">
              <i class="bi bi-clock"></i>
              <span>${fmtDate(c.createdAt)}</span>
            </div>
          </div>
        </div>
        <div class="relife-comment-text">${esc(c.text)}</div>
      `;
      list.appendChild(commentEl);
    });
  });

  // Watch post counters
  const postRef = doc(db, 'posts', postId);
  onSnapshot(postRef, snap => {
    const d = snap.data();
    if(!d) return;
    const likeEl = document.getElementById('likeCount');
    const disEl = document.getElementById('dislikeCount');
    const comEl = document.getElementById('commentCountBtn');
    const comBadge = document.getElementById('commentCount');
    if(likeEl) likeEl.textContent = d.likes || 0;
    if(disEl) disEl.textContent = d.dislikes || 0;
    if(comEl) comEl.textContent = d.commentsCount || 0;
    if(comBadge) comBadge.textContent = d.commentsCount || 0;
  });
}

/**
 * Bind event listeners
 */
function bindEvents() {
  // Share button
  document.getElementById('shareBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const btn = document.getElementById('shareBtn');
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '<i class="bi bi-check-lg"></i>';
      btn.style.background = 'rgba(52, 199, 89, 0.2)';
      btn.style.color = '#34C759';
      setTimeout(() => {
        btn.innerHTML = oldHtml;
        btn.style.background = '';
        btn.style.color = '';
      }, 1500);
    } catch(e) {
      alert('Không thể sao chép URL');
    }
  });

  // Reaction buttons
  document.getElementById('likeBtn').addEventListener('click', () => toggleReaction(postId, 'like'));
  document.getElementById('dislikeBtn').addEventListener('click', () => toggleReaction(postId, 'dislike'));
  
  // Comment toggle - smooth scroll
  document.getElementById('commentToggle').addEventListener('click', () => {
    const commentForm = document.getElementById('commentFormArea');
    if(commentForm) {
      commentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        const input = document.getElementById('commentText');
        if(input) input.focus();
      }, 500);
    }
  });

  // Send comment
  document.getElementById('sendComment').addEventListener('click', async () => {
    const text = document.getElementById('commentText').value.trim();
    if(!text) return alert('Viết bình luận trước khi gửi.');
    const user = auth.currentUser;
    if(!user) return alert('Bạn cần đăng nhập để bình luận.');
    
    const btn = document.getElementById('sendComment');
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i><span>Đang gửi...</span>';
    
    try {
      const udoc = await getDoc(doc(db, 'users', user.uid));
      const prof = udoc.exists() ? udoc.data() : null;
      await addDoc(collection(db, 'posts', postId, 'comments'), {
        displayName: prof?.displayName || user.email,
        userId: user.uid,
        text,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'posts', postId), { commentsCount: increment(1) });
      document.getElementById('commentText').value = '';
      
      // Success feedback
      btn.innerHTML = '<i class="bi bi-check-lg"></i><span>Đã gửi</span>';
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-fill"></i><span>Gửi bình luận</span>';
      }, 1500);
    } catch(err) {
      console.error('Comment error:', err);
      alert('Không thể gửi bình luận. Vui lòng thử lại.');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-fill"></i><span>Gửi bình luận</span>';
    }
  });

  // Auth state for comments
  onAuthStateChanged(auth, user => {
    if(user) {
      document.getElementById('loginNotice').style.display = 'none';
      document.getElementById('commentFormArea').style.display = 'block';
    } else {
      document.getElementById('loginNotice').style.display = 'block';
      document.getElementById('commentFormArea').style.display = 'none';
    }
    updateReactionButtonsState();
  });
}

/**
 * Update reaction buttons visual state
 */
async function updateReactionButtonsState() {
  const user = auth.currentUser;
  const likeBtn = document.getElementById('likeBtn');
  const disBtn = document.getElementById('dislikeBtn');
  if(!likeBtn || !disBtn) return;
  
  likeBtn.classList.remove('active-like');
  disBtn.classList.remove('active-dislike');
  
  if(!user) return;
  
  try {
    const likeDoc = await getDoc(doc(db, 'posts', postId, 'likes', user.uid));
    if(likeDoc.exists()) {
      const t = likeDoc.data().type;
      if(t === 'like') {
        likeBtn.classList.add('active-like');
      } else if(t === 'dislike') {
        disBtn.classList.add('active-dislike');
      }
    }
  } catch(e) {
    console.error(e);
  }
}

/**
 * Toggle reaction (like/dislike)
 */
async function toggleReaction(postId, reaction) {
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập để tương tác (Like/Dislike).');
    return;
  }
  
  const likeDocRef = doc(db, 'posts', postId, 'likes', user.uid);
  const postRef = doc(db, 'posts', postId);
  const likeSnap = await getDoc(likeDocRef);
  const batch = writeBatch(db);
  
  if(!likeSnap.exists()) {
    batch.set(likeDocRef, { userId: user.uid, type: reaction, createdAt: serverTimestamp() });
    if(reaction === 'like') batch.update(postRef, { likes: increment(1) });
    else batch.update(postRef, { dislikes: increment(1) });
  } else {
    const prev = likeSnap.data().type;
    if(prev === reaction) {
      batch.delete(likeDocRef);
      if(reaction === 'like') batch.update(postRef, { likes: increment(-1) });
      else batch.update(postRef, { dislikes: increment(-1) });
    } else {
      batch.update(likeDocRef, { type: reaction, updatedAt: serverTimestamp() });
      if(reaction === 'like') batch.update(postRef, { likes: increment(1), dislikes: increment(-1) });
      else batch.update(postRef, { dislikes: increment(1), likes: increment(-1) });
    }
  }
  
  try {
    await batch.commit();
    updateReactionButtonsState();
  } catch(err) {
    console.error('Reaction failed', err);
    alert('Không thể cập nhật phản hồi — thử lại sau.');
  }
}

// Page visibility: pause animations
document.addEventListener('visibilitychange', () => {
  const orbs = document.querySelectorAll('.relife-orb');
  const gradient = document.querySelector('.relife-gradient');
  
  if(document.hidden) {
    orbs.forEach(orb => orb.style.animationPlayState = 'paused');
    if(gradient) gradient.style.animationPlayState = 'paused';
  } else {
    orbs.forEach(orb => orb.style.animationPlayState = 'running');
    if(gradient) gradient.style.animationPlayState = 'running';
  }
});

// Initialize
load();