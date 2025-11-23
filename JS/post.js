// JS/post.js - Relife UI 1.2 Enhanced
// NEW: Follow system, Reply to comments, Delete comments, Author badge
// UPDATE: Fixed indent + Color coding, Scroll to comment with highlight
import { initFirebase } from '../firebase-config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc, getDoc, updateDoc, increment, setDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, where, getDocs
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();
const auth = getAuth();
const params = new URLSearchParams(location.search);
const postId = params.get('id');
const postArea = document.getElementById('postArea');
const commentsSection = document.getElementById('commentsSection');
const hiddenRenderer = document.getElementById('__qs_hidden_renderer');

// Global state
let currentPostData = null;
let currentReplyTo = null;

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

// Navigate to profile page
function navigateToProfile(userId) {
  if(!userId) return;
  window.location.href = `profile.html?user=${userId}`;
}

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
 * Check follow status
 */
async function checkFollowStatus(authorUserId) {
  const user = auth.currentUser;
  if(!user || user.uid === authorUserId) return false;
  
  try {
    const followDoc = await getDoc(
      doc(db, 'users', user.uid, 'following', authorUserId)
    );
    return followDoc.exists();
  } catch(e) {
    console.error('Check follow error:', e);
    return false;
  }
}

/**
 * Follow/Unfollow user
 */
async function toggleFollow(targetUserId) {
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập để theo dõi người dùng.');
    return;
  }
  
  if(user.uid === targetUserId) {
    alert('Bạn không thể theo dõi chính mình.');
    return;
  }
  
  const followBtn = document.getElementById('followBtn');
  if(followBtn) followBtn.disabled = true;
  
  try {
    const isFollowing = await checkFollowStatus(targetUserId);
    
    // Get profiles
    const currentUserDoc = await getDoc(doc(db, 'users', user.uid));
    const targetUserDoc = await getDoc(doc(db, 'users', targetUserId));
    const currentProfile = currentUserDoc.exists() ? currentUserDoc.data() : {};
    const targetProfile = targetUserDoc.exists() ? targetUserDoc.data() : {};
    
    if(!isFollowing) {
      // Follow
      await setDoc(
        doc(db, 'users', targetUserId, 'followers', user.uid),
        {
          userId: user.uid,
          displayName: currentProfile.displayName || user.email,
          tagName: currentProfile.tagName || null,
          avatarUrl: currentProfile.avatarUrl || null,
          createdAt: serverTimestamp()
        }
      );
      
      await setDoc(
        doc(db, 'users', user.uid, 'following', targetUserId),
        {
          userId: targetUserId,
          displayName: targetProfile.displayName || 'User',
          avatarUrl: targetProfile.avatarUrl || null,
          createdAt: serverTimestamp()
        }
      );
      
      if(followBtn) {
        followBtn.classList.add('following');
        followBtn.innerHTML = '<i class="bi bi-check-lg"></i><span>Đang theo dõi</span>';
      }
    } else {
      // Unfollow
      await deleteDoc(doc(db, 'users', targetUserId, 'followers', user.uid));
      await deleteDoc(doc(db, 'users', user.uid, 'following', targetUserId));
      
      if(followBtn) {
        followBtn.classList.remove('following');
        followBtn.innerHTML = '<i class="bi bi-person-plus-fill"></i><span>Theo dõi</span>';
      }
    }
  } catch(err) {
    console.error('Follow error:', err);
    alert('Không thể thực hiện. Vui lòng thử lại.');
  } finally {
    if(followBtn) followBtn.disabled = false;
  }
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
    currentPostData = d;

    // Get author info
    let authorHtml = '';
    let authorAvatar = '';
    let followBtnHtml = '';
    
    if(d.userId) {
      const userSnap = await getDoc(doc(db, 'users', d.userId));
      const prof = userSnap.exists() ? userSnap.data() : null;
      authorAvatar = prof?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(prof?.displayName||d.displayName||'U')}&background=0D6EFD&color=fff&size=128`;
      const tag = prof?.tagName || d.authorTag || '';
      
      // Check if current user is author
      const currentUser = auth.currentUser;
      const isAuthor = currentUser && currentUser.uid === d.userId;
      
      // Follow button (only for non-authors)
      if(currentUser && !isAuthor) {
        const isFollowing = await checkFollowStatus(d.userId);
        followBtnHtml = `
          <button id="followBtn" class="relife-follow-btn ${isFollowing ? 'following' : ''}" onclick="window.toggleFollowFromPost()">
            <i class="bi bi-${isFollowing ? 'check-lg' : 'person-plus-fill'}"></i>
            <span>${isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span>
          </button>
        `;
      }
      
      authorHtml = `
        <div class="relife-post-header">
          <img src="${authorAvatar}" class="relife-author-avatar" alt="avatar" onclick="window.navigateToProfile('${d.userId}')">
          <div class="relife-author-info">
            <div class="relife-author-name" onclick="window.navigateToProfile('${d.userId}')">${esc(d.displayName || prof?.displayName || 'Người dùng')}</div>
            <div class="relife-author-meta">
              ${tag ? `<div class="relife-author-tag" onclick="window.navigateToProfile('${d.userId}')">${esc(tag)}</div>` : ''}
              <div class="relife-post-time">
                <i class="bi bi-clock"></i>
                <span>${fmtDate(d.createdAt)}</span>
              </div>
              ${followBtnHtml}
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
            <span id="commentCountBtn">...</span>
          </button>
        </div>
      </div>
    `;

    // Attach image viewer
    attachImageViewerToContent();

    // Show comments section
    commentsSection.style.display = 'block';
    // NOTE: Will be updated by onSnapshot (accurate count)
    document.getElementById('commentCount').textContent = '...';

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
    renderComments(snap);
    
    // NEW: Update comment count from snapshot.size (ALWAYS ACCURATE)
    const actualCount = snap.size;
    document.getElementById('commentCountBtn').textContent = actualCount;
    document.getElementById('commentCount').textContent = actualCount;
  });

  // Watch post counters (likes/dislikes only, NOT commentsCount)
  const postRef = doc(db, 'posts', postId);
  onSnapshot(postRef, snap => {
    const d = snap.data();
    if(!d) return;
    const likeEl = document.getElementById('likeCount');
    const disEl = document.getElementById('dislikeCount');
    if(likeEl) likeEl.textContent = d.likes || 0;
    if(disEl) disEl.textContent = d.dislikes || 0;
    // NOTE: commentsCount NO LONGER USED (using snapshot.size instead)
  });
}

/**
 * Render comments with nested reply support and collapse
 */
async function renderComments(snapshot) {
  const list = document.getElementById('commentsList');
  list.innerHTML = '';
  
  if(snapshot.empty) {
    list.innerHTML = '<div class="text-center text-muted py-3">Chưa có bình luận</div>';
    return;
  }
  
  const currentUser = auth.currentUser;
  const comments = [];
  
  snapshot.forEach((s) => {
    comments.push({ id: s.id, ...s.data() });
  });
  
  // Build reply tree (support nested replies)
  const replyMap = new Map();
  const rootComments = [];
  
  comments.forEach(c => {
    if(!c.replyTo) {
      rootComments.push(c);
    } else {
      if(!replyMap.has(c.replyTo)) replyMap.set(c.replyTo, []);
      replyMap.get(c.replyTo).push(c);
    }
  });
  
  // Render root comments with their reply trees
  rootComments.forEach((c, idx) => {
    renderCommentWithReplies(list, c, idx, currentUser, replyMap, 0);
  });
}

/**
 * Render comment with its reply tree (recursive)
 */
function renderCommentWithReplies(parentContainer, comment, index, currentUser, replyMap, depth) {
  const replies = replyMap.get(comment.id) || [];
  const hasReplies = replies.length > 0;
  
  // Render the comment
  const commentEl = renderCommentElement(comment, index, currentUser, depth, hasReplies, replies.length);
  parentContainer.appendChild(commentEl);
  
  // Create collapsible replies container
  if(hasReplies) {
    const repliesContainer = document.createElement('div');
    repliesContainer.className = 'relife-replies-container';
    repliesContainer.id = `replies-${comment.id}`;
    repliesContainer.style.display = 'none'; // Hidden by default
    
    // Render each reply recursively
    replies.forEach((reply, replyIdx) => {
      renderCommentWithReplies(repliesContainer, reply, replyIdx, currentUser, replyMap, depth + 1);
    });
    
    parentContainer.appendChild(repliesContainer);
  }
}

/**
 * Render individual comment element with collapse support
 */
function renderCommentElement(comment, index, currentUser, depth, hasReplies, replyCount) {
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.displayName||'U')}&background=0D6EFD&color=fff&size=80`;
  const isOwnComment = currentUser && comment.userId === currentUser.uid;
  const isAuthor = currentPostData && comment.userId === currentPostData.userId;
  
  // NEW: Check if highly reported (warning)
  const reportCount = comment.reportCount || 0;
  const isReported = reportCount >= 3; // Threshold: 3 reports
  
  // Limit visual indent - all depths > 0 use same margin, different border colors
  const isReply = depth > 0;
  const replyLevelClass = isReply ? `reply reply-level-${Math.min(depth, 5)}` : '';
  const reportedClass = isReported ? ' reported' : '';
  
  // Reply to indicator (for replies only)
  let replyToHtml = '';
  if(comment.replyTo && comment.replyToName) {
    replyToHtml = `
      <div class="relife-reply-to" onclick="window.scrollToComment('${comment.replyTo}')">
        <i class="bi bi-reply-fill"></i>
        <span>Phản hồi ${esc(comment.replyToName)}</span>
      </div>
    `;
  }
  
  // NEW: Parse mentions in text
  const displayText = parseMentions(comment.text, comment.mentions || []);
  
  // NEW: Edited badge
  let editedBadge = '';
  if(comment.editedAt) {
    editedBadge = `
      <span class="relife-edited-badge">
        <i class="bi bi-pencil-fill"></i>
        <span>Đã chỉnh sửa</span>
      </span>
    `;
  }
  
  // NEW: Report warning badge
  let reportBadge = '';
  if(isReported) {
    reportBadge = `
      <span class="relife-report-badge">
        <i class="bi bi-flag-fill"></i>
        <span>${reportCount} báo cáo</span>
      </span>
    `;
  }
  
  // Actions
  let actionsHtml = `
    <div class="relife-comment-actions">
      <button class="relife-comment-action-btn" onclick="window.setReplyTo('${comment.id}', '${esc(comment.displayName)}')">
        <i class="bi bi-reply-fill"></i>
        <span>Trả lời</span>
      </button>
  `;
  
  if(isOwnComment) {
    actionsHtml += `
      <button class="relife-comment-action-btn" onclick="window.editComment('${comment.id}')">
        <i class="bi bi-pencil-fill"></i>
        <span>Sửa</span>
      </button>
      <button class="relife-comment-action-btn delete" onclick="window.deleteComment('${comment.id}')">
        <i class="bi bi-trash-fill"></i>
        <span>Xóa</span>
      </button>
    `;
  } else {
    // Can report if not own comment
    actionsHtml += `
      <button class="relife-comment-action-btn delete" onclick="window.openReportModal('${comment.id}')">
        <i class="bi bi-flag-fill"></i>
        <span>Báo cáo</span>
      </button>
    `;
  }
  
  actionsHtml += '</div>';
  
  // Toggle replies button (if has replies)
  let toggleRepliesHtml = '';
  if(hasReplies) {
    toggleRepliesHtml = `
      <button class="relife-toggle-replies" onclick="window.toggleReplies('${comment.id}')" id="toggle-${comment.id}">
        <i class="bi bi-chevron-down"></i>
        <span>Xem ${replyCount} phản hồi</span>
      </button>
    `;
  }
  
  const commentEl = document.createElement('div');
  commentEl.className = `relife-comment ${replyLevelClass}${reportedClass}`;
  commentEl.id = `comment-${comment.id}`;
  commentEl.setAttribute('data-comment-data', JSON.stringify({text: comment.text, mentions: comment.mentions || []}));
  commentEl.style.animationDelay = `${index * 0.05}s`;
  
  commentEl.innerHTML = `
    <div class="relife-comment-header">
      <img src="${avatar}" class="relife-comment-avatar" alt="avatar" onclick="window.navigateToProfile('${comment.userId}')">
      <div class="relife-comment-author">
        <div>
          <span class="relife-comment-name" onclick="window.navigateToProfile('${comment.userId}')">${esc(comment.displayName||'Ẩn danh')}</span>
          ${isAuthor ? '<span class="relife-author-badge"><i class="bi bi-patch-check-fill"></i> Tác giả</span>' : ''}
          ${editedBadge}
          ${reportBadge}
        </div>
        <div class="relife-comment-time">
          <i class="bi bi-clock"></i>
          <span>${fmtDate(comment.createdAt)}</span>
        </div>
      </div>
    </div>
    ${replyToHtml}
    <div class="relife-comment-text">${displayText}</div>
    ${actionsHtml}
    ${toggleRepliesHtml}
  `;
  
  return commentEl;
}

/**
 * NEW: Parse @mentions in comment text
 */
function parseMentions(text, mentionedUserIds) {
  if(!mentionedUserIds || mentionedUserIds.length === 0) {
    return esc(text);
  }
  
  // Escape HTML first
  let result = esc(text);
  
  // Find @mentions and wrap in clickable spans
  const mentionRegex = /@(\w+)/g;
  result = result.replace(mentionRegex, (match, tagName) => {
    // Find matching user ID (would need to fetch from cache or Firestore)
    // For now, make all @mentions clickable
    return `<span class="relife-mention" onclick="window.navigateToMention('@${esc(tagName)}')">${match}</span>`;
  });
  
  return result;
}

/**
 * NEW: Navigate to mentioned user's profile
 */
window.navigateToMention = async function(tagName) {
  try {
    // Search for user by tagName
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('tagName', '==', tagName));
    const snapshot = await getDocs(q);
    
    if(!snapshot.empty) {
      const userId = snapshot.docs[0].id;
      window.navigateToProfile(userId);
    } else {
      alert('Không tìm thấy người dùng này.');
    }
  } catch(err) {
    console.error('Navigate to mention error:', err);
  }
};

/**
 * Scroll to and highlight parent comment
 */
window.scrollToComment = function(commentId) {
  const commentEl = document.getElementById(`comment-${commentId}`);
  if(!commentEl) {
    console.warn('Comment not found:', commentId);
    return;
  }
  
  // First, expand all parent containers if comment is hidden
  let parentContainer = commentEl.closest('.relife-replies-container');
  while(parentContainer) {
    const parentCommentId = parentContainer.id.replace('replies-', '');
    const toggleBtn = document.getElementById(`toggle-${parentCommentId}`);
    
    // Expand if collapsed
    if(parentContainer.style.display === 'none') {
      parentContainer.style.display = 'block';
      if(toggleBtn) {
        toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i><span>Ẩn phản hồi</span>';
        toggleBtn.classList.add('expanded');
      }
    }
    
    // Move to next parent level
    parentContainer = parentContainer.parentElement?.closest('.relife-replies-container');
  }
  
  // Scroll to comment with smooth animation
  commentEl.scrollIntoView({ 
    behavior: 'smooth', 
    block: 'center' 
  });
  
  // Add highlight effect
  commentEl.classList.add('highlight');
  
  // Remove highlight after animation
  setTimeout(() => {
    commentEl.classList.remove('highlight');
  }, 2000);
};

/**
 * Toggle replies visibility
 */
window.toggleReplies = function(commentId) {
  const repliesContainer = document.getElementById(`replies-${commentId}`);
  const toggleBtn = document.getElementById(`toggle-${commentId}`);
  
  if(!repliesContainer || !toggleBtn) return;
  
  const isHidden = repliesContainer.style.display === 'none';
  
  if(isHidden) {
    repliesContainer.style.display = 'block';
    toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i><span>Ẩn phản hồi</span>';
    toggleBtn.classList.add('expanded');
  } else {
    repliesContainer.style.display = 'none';
    const replyCount = repliesContainer.querySelectorAll('.relife-comment').length;
    toggleBtn.innerHTML = `<i class="bi bi-chevron-down"></i><span>Xem ${replyCount} phản hồi</span>`;
    toggleBtn.classList.remove('expanded');
  }
};

/**
 * Set reply target
 */
window.setReplyTo = function(commentId, displayName) {
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập để trả lời bình luận.');
    return;
  }
  
  currentReplyTo = { id: commentId, name: displayName };
  
  const indicator = document.getElementById('replyIndicator');
  const nameSpan = document.getElementById('replyToName');
  
  if(indicator && nameSpan) {
    nameSpan.textContent = `Đang trả lời ${displayName}`;
    indicator.style.display = 'flex';
  }
  
  const input = document.getElementById('commentText');
  if(input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

/**
 * Cancel reply
 */
document.addEventListener('DOMContentLoaded', () => {
  const cancelBtn = document.getElementById('cancelReply');
  if(cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      currentReplyTo = null;
      const indicator = document.getElementById('replyIndicator');
      if(indicator) indicator.style.display = 'none';
    });
  }
});

/**
 * Delete comment - SIMPLIFIED (No counter update needed)
 */
window.deleteComment = async function(commentId) {
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập.');
    return;
  }
  
  if(!confirm('Bạn có chắc muốn xóa bình luận này?\n(Tất cả phản hồi cũng sẽ bị xóa)')) return;
  
  try {
    // Step 1: Get all comments to find replies
    const commentsRef = collection(db, 'posts', postId, 'comments');
    const allCommentsSnap = await getDocs(commentsRef);
    const allComments = [];
    allCommentsSnap.forEach(doc => {
      allComments.push({ id: doc.id, ...doc.data() });
    });
    
    // Step 2: Build reply tree to find all nested replies
    const findAllReplies = (parentId, commentsList) => {
      const directReplies = commentsList.filter(c => c.replyTo === parentId);
      let allReplies = [...directReplies];
      
      // Recursively find nested replies
      directReplies.forEach(reply => {
        allReplies = allReplies.concat(findAllReplies(reply.id, commentsList));
      });
      
      return allReplies;
    };
    
    // Step 3: Find target comment and all its nested replies
    const targetComment = allComments.find(c => c.id === commentId);
    if(!targetComment) {
      alert('Không tìm thấy bình luận.');
      return;
    }
    
    // Check ownership
    if(targetComment.userId !== user.uid) {
      alert('Bạn chỉ có thể xóa bình luận của mình.');
      return;
    }
    
    const repliesToDelete = findAllReplies(commentId, allComments);
    const totalToDelete = 1 + repliesToDelete.length; // Parent + all children
    
    console.log(`Deleting comment ${commentId} and ${repliesToDelete.length} nested replies (total: ${totalToDelete})`);
    
    // Step 4: Delete all in batch (NO COUNTER UPDATE)
    const batch = writeBatch(db);
    
    // Delete parent
    batch.delete(doc(db, 'posts', postId, 'comments', commentId));
    
    // Delete all nested replies
    repliesToDelete.forEach(reply => {
      batch.delete(doc(db, 'posts', postId, 'comments', reply.id));
    });
    
    // NOTE: No commentsCount update - using snapshot.size instead!
    
    await batch.commit();
    
    console.log(`Successfully deleted ${totalToDelete} comments (counter auto-updated by snapshot)`);
  } catch(err) {
    console.error('Delete comment error:', err);
    alert('Không thể xóa bình luận. Vui lòng thử lại.');
  }
};

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
      
      // NEW: Extract and resolve mentions
      const mentions = extractMentions(text);
      const mentionedUserIds = await resolveMentions(mentions);
      
      const commentData = {
        displayName: prof?.displayName || user.email,
        userId: user.uid,
        text,
        createdAt: serverTimestamp(),
        mentions: mentionedUserIds,  // NEW
        reportCount: 0               // NEW: Initialize
      };
      
      // Add reply info if replying
      if(currentReplyTo) {
        commentData.replyTo = currentReplyTo.id;
        commentData.replyToName = currentReplyTo.name;
      }
      
      await addDoc(collection(db, 'posts', postId, 'comments'), commentData);
      // NOTE: No counter update - snapshot.size will auto-update UI
      
      document.getElementById('commentText').value = '';
      
      // Clear reply state
      currentReplyTo = null;
      const indicator = document.getElementById('replyIndicator');
      if(indicator) indicator.style.display = 'none';
      
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
      
      // NEW: Setup mention autocomplete for main comment input
      const commentTextarea = document.getElementById('commentText');
      if(commentTextarea) {
        setupMentionAutocomplete(commentTextarea);
      }
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

/**
 * Make all window functions globally accessible
 */
window.navigateToProfile = navigateToProfile;
window.toggleFollowFromPost = () => {
  if(currentPostData && currentPostData.userId) {
    toggleFollow(currentPostData.userId);
  }
};

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

// ═══════════════════════════════════════════════════════════
// NEW v1.5 FEATURES
// ═══════════════════════════════════════════════════════════

/**
 * NEW: Edit comment
 */
let currentEditingCommentId = null;

window.editComment = async function(commentId) {
  const commentEl = document.getElementById(`comment-${commentId}`);
  if(!commentEl) return;
  
  // Get original text
  const commentData = JSON.parse(commentEl.getAttribute('data-comment-data'));
  const originalText = commentData.text;
  
  // Check if already editing
  if(currentEditingCommentId === commentId) return;
  
  // Cancel any other edits
  if(currentEditingCommentId) {
    const prevEditForm = document.getElementById(`edit-form-${currentEditingCommentId}`);
    if(prevEditForm) prevEditForm.remove();
  }
  
  currentEditingCommentId = commentId;
  
  // Create edit form
  const editForm = document.createElement('div');
  editForm.id = `edit-form-${commentId}`;
  editForm.className = 'relife-edit-comment-form';
  editForm.innerHTML = `
    <textarea class="relife-edit-textarea" id="edit-textarea-${commentId}" placeholder="Nhập @username để gắn tag người khác...">${esc(originalText)}</textarea>
    <div class="relife-edit-buttons">
      <button class="relife-btn-save" onclick="window.saveEdit('${commentId}')">
        <i class="bi bi-check-lg"></i> Lưu
      </button>
      <button class="relife-btn-cancel" onclick="window.cancelEdit('${commentId}')">
        Hủy
      </button>
    </div>
  `;
  
  // Insert after comment text
  const commentText = commentEl.querySelector('.relife-comment-text');
  commentText.after(editForm);
  
  // Focus textarea
  const textarea = document.getElementById(`edit-textarea-${commentId}`);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  
  // Setup mention autocomplete
  setupMentionAutocomplete(textarea);
};

window.cancelEdit = function(commentId) {
  const editForm = document.getElementById(`edit-form-${commentId}`);
  if(editForm) editForm.remove();
  currentEditingCommentId = null;
};

window.saveEdit = async function(commentId) {
  const textarea = document.getElementById(`edit-textarea-${commentId}`);
  const newText = textarea.value.trim();
  
  if(!newText) {
    alert('Bình luận không được để trống.');
    return;
  }
  
  try {
    // Extract mentions
    const mentions = extractMentions(newText);
    const mentionedUserIds = await resolveMentions(mentions);
    
    // Update Firestore
    await updateDoc(doc(db, 'posts', postId, 'comments', commentId), {
      text: newText,
      mentions: mentionedUserIds,
      editedAt: serverTimestamp(),
      editCount: increment(1)
    });
    
    // Remove edit form
    window.cancelEdit(commentId);
    
    console.log('Comment updated successfully');
  } catch(err) {
    console.error('Edit comment error:', err);
    alert('Không thể cập nhật bình luận. Vui lòng thử lại.');
  }
};

/**
 * NEW: Extract @mentions from text
 */
function extractMentions(text) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while((match = mentionRegex.exec(text)) !== null) {
    mentions.push('@' + match[1]);
  }
  return [...new Set(mentions)]; // Unique
}

/**
 * NEW: Resolve @mentions to user IDs
 */
async function resolveMentions(mentions) {
  if(mentions.length === 0) return [];
  
  const userIds = [];
  for(const tagName of mentions) {
    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('tagName', '==', tagName));
      const snapshot = await getDocs(q);
      
      if(!snapshot.empty) {
        userIds.push(snapshot.docs[0].id);
      }
    } catch(err) {
      console.error('Resolve mention error:', err);
    }
  }
  
  return userIds;
}

/**
 * NEW: Setup mention autocomplete
 */
function setupMentionAutocomplete(textarea) {
  const dropdown = document.getElementById('mentionDropdown');
  let currentQuery = '';
  
  textarea.addEventListener('input', async (e) => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    
    // Find @ before cursor
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtPos = textBeforeCursor.lastIndexOf('@');
    
    if(lastAtPos === -1) {
      dropdown.classList.remove('show');
      return;
    }
    
    const queryText = textBeforeCursor.substring(lastAtPos + 1);
    
    // Check if query is valid (no spaces)
    if(queryText.includes(' ')) {
      dropdown.classList.remove('show');
      return;
    }
    
    currentQuery = queryText.toLowerCase();
    
    // Search users
    if(currentQuery.length >= 2) {
      await searchUsersForMention(currentQuery, dropdown, textarea, lastAtPos);
    } else {
      dropdown.classList.remove('show');
    }
  });
  
  // Close dropdown on blur
  textarea.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.remove('show'), 200);
  });
}

/**
 * NEW: Search users for mention
 */
async function searchUsersForMention(query, dropdown, textarea, atPos) {
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    
    const matches = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const tagName = data.tagName || '';
      if(tagName.toLowerCase().includes(query)) {
        matches.push({
          id: doc.id,
          displayName: data.displayName,
          tagName: data.tagName,
          avatarUrl: data.avatarUrl
        });
      }
    });
    
    if(matches.length === 0) {
      dropdown.classList.remove('show');
      return;
    }
    
    // Render matches
    dropdown.innerHTML = matches.slice(0, 5).map(user => {
      const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=0D6EFD&color=fff&size=64`;
      return `
        <div class="relife-mention-item" data-tagname="${esc(user.tagName)}" data-userid="${user.id}">
          <img src="${avatar}" class="relife-mention-avatar" alt="avatar">
          <div class="relife-mention-name">${esc(user.displayName)}</div>
          <div class="relife-mention-tag">${esc(user.tagName)}</div>
        </div>
      `;
    }).join('');
    
    // Position dropdown
    const rect = textarea.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.width = Math.min(rect.width, 300) + 'px';
    dropdown.classList.add('show');
    
    // Add click handlers
    dropdown.querySelectorAll('.relife-mention-item').forEach(item => {
      item.addEventListener('click', () => {
        const tagName = item.getAttribute('data-tagname');
        const text = textarea.value;
        const before = text.substring(0, atPos);
        const after = text.substring(textarea.selectionStart);
        textarea.value = before + tagName + ' ' + after;
        textarea.focus();
        textarea.setSelectionRange(before.length + tagName.length + 1, before.length + tagName.length + 1);
        dropdown.classList.remove('show');
      });
    });
  } catch(err) {
    console.error('Search users error:', err);
  }
}

/**
 * NEW: Report comment
 */
let currentReportCommentId = null;

window.openReportModal = function(commentId) {
  currentReportCommentId = commentId;
  document.getElementById('reportOverlay').classList.add('show');
  document.getElementById('reportModal').classList.add('show');
};

window.closeReportModal = function() {
  currentReportCommentId = null;
  document.getElementById('reportOverlay').classList.remove('show');
  document.getElementById('reportModal').classList.remove('show');
};

window.submitReport = async function() {
  if(!currentReportCommentId) return;
  
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập để báo cáo.');
    return;
  }
  
  // Get selected reason
  const reasonRadio = document.querySelector('input[name="reportReason"]:checked');
  const reason = reasonRadio ? reasonRadio.value : 'other';
  
  try {
    const reportRef = doc(db, 'posts', postId, 'comments', currentReportCommentId, 'reports', user.uid);
    const reportDoc = await getDoc(reportRef);
    
    if(reportDoc.exists()) {
      alert('Bạn đã báo cáo bình luận này rồi.');
      window.closeReportModal();
      return;
    }
    
    // Add report
    const batch = writeBatch(db);
    
    batch.set(reportRef, {
      userId: user.uid,
      reason,
      createdAt: serverTimestamp()
    });
    
    batch.update(doc(db, 'posts', postId, 'comments', currentReportCommentId), {
      reportCount: increment(1)
    });
    
    await batch.commit();
    
    alert('Đã gửi báo cáo. Cảm ơn bạn!');
    window.closeReportModal();
  } catch(err) {
    console.error('Report error:', err);
    alert('Không thể gửi báo cáo. Vui lòng thử lại.');
  }
};

// Close report modal on overlay click
document.getElementById('reportOverlay').addEventListener('click', window.closeReportModal);