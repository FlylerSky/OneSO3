// JS/post.js - Relife UI 1.6.1
// Base: v1.6.0 (Notification Support)
// [#1] Post-header: avatar | (tên \n tag+time) | follow — layout gọn 2 dòng
// [#2] Tiêu đề bài viết → header subtitle, truncate + modal khi dài
// [#3] Like/Dislike cùng hàng (reactions-row), comment full-width
// [#4] Sticky header ẩn/hiện khi scroll
// [#5] Floating comment button ẩn/hiện cùng header
import { initFirebase } from '../firebase-config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  doc, getDoc, updateDoc, increment, setDoc, deleteDoc,
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, writeBatch, where, getDocs
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();
const auth = getAuth();
const params = new URLSearchParams(location.search);

// ✅ NEW: Detect content type and ID
const notificationId = params.get('notification');
const postId = params.get('id');
const isNotification = !!notificationId;
const contentId = notificationId || postId;

const postArea = document.getElementById('postArea');
const commentsSection = document.getElementById('commentsSection');
const hiddenRenderer = document.getElementById('__qs_hidden_renderer');

// Global state
let currentPostData = null;
let currentReplyTo = null;

// Avatar cache
const avatarCache = new Map();

async function getUserAvatar(userId, fallbackName, knownAvatarUrl) {
  // Nếu comment đã lưu avatarUrl trực tiếp → dùng luôn
  if(knownAvatarUrl) {
    if(userId) avatarCache.set(userId, knownAvatarUrl);
    return knownAvatarUrl;
  }
  if(!userId) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName||'U')}&background=0D6EFD&color=fff&size=128`;
  }
  if(avatarCache.has(userId)) return avatarCache.get(userId);
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if(snap.exists()) {
      const data = snap.data();
      const url = data.avatarUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(data.displayName || fallbackName || 'U')}&background=0D6EFD&color=fff&size=128`;
      avatarCache.set(userId, url);
      return url;
    }
  } catch(e) {}
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName||'U')}&background=0D6EFD&color=fff&size=128`;
  avatarCache.set(userId, fallback);
  return fallback;
}

// Utility functions
const esc = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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
  ADD_TAGS: [
    'iframe','table','thead','tbody','tfoot','tr','td','th',
    'video','source','figure','figcaption','caption',
    'pre','code','span','ul','ol','li',
    'blockquote','h1','h2','h3','h4','h5','h6',
    'sub','sup','s','u','mark','kbd','abbr',
    'details','summary','hr','br'
  ],
  ADD_ATTR: [
    'style','class','id',
    'width','height','allow','allowfullscreen','frameborder',
    'controls','playsinline','loading','referrerpolicy','sandbox',
    'data-list','data-checked','data-indent','data-align','data-formula',
    'data-id','data-row-span','data-col-span',
    'src','srcdoc','href','target','rel',
    'colspan','rowspan','scope'
  ],
  FORBID_TAGS: ['script','object','embed'],
  KEEP_CONTENT: false
};

/**
 * Inline computed styles for rendering
 */
function inlineComputedStyles(root) {
  if(!root) return;
  const BLOCK_TAGS = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH|CAPTION|FIGCAPTION|SUMMARY)$/i;
  const walk = el => {
    if(el.nodeType !== 1) return;
    const cs = window.getComputedStyle(el);
    try {
      // Typography
      if(cs.fontSize)     el.style.fontSize     = cs.fontSize;
      if(cs.fontFamily)   el.style.fontFamily   = cs.fontFamily;
      if(cs.fontWeight)   el.style.fontWeight   = cs.fontWeight;
      if(cs.fontStyle && cs.fontStyle !== 'normal') el.style.fontStyle = cs.fontStyle;
      // Text decoration (bold/italic/underline/strikethrough)
      if(cs.textDecorationLine && cs.textDecorationLine !== 'none')
        el.style.textDecoration = cs.textDecorationLine + ' ' + (cs.textDecorationStyle||'') + ' ' + (cs.textDecorationColor||'');
      // Color & background
      // Skip color/bg for code blocks — CSS handles them, inline styles would override
      const inCodeBlock = el.closest && (el.closest('.ql-code-block-container') || el.closest('pre'));
      if(!inCodeBlock) {
        if(cs.color) el.style.color = cs.color;
        if(cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
          el.style.backgroundColor = cs.backgroundColor;
      }
      // Block-level layout
      if(BLOCK_TAGS.test(el.tagName)) {
        if(cs.textAlign)   el.style.textAlign   = cs.textAlign;
        if(cs.paddingLeft && cs.paddingLeft !== '0px') el.style.paddingLeft = cs.paddingLeft;
      }
      // Spacing
      if(cs.lineHeight)   el.style.lineHeight   = cs.lineHeight;
      if(cs.letterSpacing && cs.letterSpacing !== 'normal') el.style.letterSpacing = cs.letterSpacing;
      // Subscript / superscript via vertical-align
      if(cs.verticalAlign && !['baseline','auto',''].includes(cs.verticalAlign))
        el.style.verticalAlign = cs.verticalAlign;
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

  // ── Remove Quill UI chrome ────────────────────────────────────────────────
  wrapper.querySelectorAll('span.ql-ui, .ql-clipboard, .ql-tooltip').forEach(el => el.remove());

  // ── Checklist (data-list="checked" / "unchecked") ────────────────────────
  wrapper.querySelectorAll('li[data-list="checked"], li[data-list="unchecked"]').forEach(li => {
    const checked = li.getAttribute('data-list') === 'checked';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = true;
    cb.checked = checked;
    cb.className = 'ql-checklist-cb';
    cb.style.cssText = 'margin-right:8px;vertical-align:middle;pointer-events:none;';
    li.prepend(cb);
    li.removeAttribute('data-list');
    if(!li.closest('ul.ql-checklist')) {
      // wrap in a special ul if needed
      const parent = li.parentElement;
      if(parent && !parent.classList.contains('ql-checklist')) {
        parent.classList.add('ql-checklist');
      }
    }
  });

  // ── Indent (Quill adds class ql-indent-N via CSS paddingLeft) ────────────
  // Already handled by inlineComputedStyles, but ensure data-indent attrs
  // are converted to inline padding if not already present
  for(let n = 1; n <= 8; n++) {
    wrapper.querySelectorAll(`.ql-indent-${n}`).forEach(el => {
      if(!el.style.paddingLeft) el.style.paddingLeft = (n * 3) + 'em';
    });
  }

  // ── Normalize Quill paragraph lists → <ul>/<ol> ──────────────────────────
  normalizeQuillParagraphLists(wrapper);
  fixListContainerTypes(wrapper);

  // ── Quill align classes → text-align inline ──────────────────────────────
  ['center','right','justify'].forEach(align => {
    wrapper.querySelectorAll(`.ql-align-${align}`).forEach(el => {
      el.style.textAlign = align;
    });
  });

  // ── Quill direction (RTL) ─────────────────────────────────────────────────
  wrapper.querySelectorAll('.ql-direction-rtl').forEach(el => {
    el.style.direction = 'rtl';
    el.style.textAlign = el.style.textAlign || 'right';
  });

  // ── Code blocks: handle both Quill 2 (div.ql-code-block) and Quill 1 (pre.ql-syntax) ──
  // Quill 2 renders: <div class="ql-code-block-container"><div class="ql-code-block">...</div></div>
  // Quill 1 renders: <pre class="ql-syntax">...</pre>
  // Both: wrap in .ql-code-block-container and ensure proper styling class

  // Quill 1 pre tags
  wrapper.querySelectorAll('pre.ql-syntax, pre[class*="language-"]').forEach(pre => {
    if(pre.closest('.ql-code-block-container')) return;
    const container = document.createElement('div');
    container.className = 'ql-code-block-container';
    pre.parentNode.replaceChild(container, pre);
    container.appendChild(pre);
  });

  // Quill 2 div.ql-code-block — group consecutive siblings into one container
  const codeBlocks = Array.from(wrapper.querySelectorAll('div.ql-code-block'));
  const processed = new Set();
  for(const block of codeBlocks) {
    if(processed.has(block)) continue;
    if(block.closest('.ql-code-block-container')) { processed.add(block); continue; }
    // Collect consecutive siblings
    const group = [block];
    let next = block.nextElementSibling;
    while(next && next.classList.contains('ql-code-block')) {
      group.push(next);
      next = next.nextElementSibling;
    }
    const container = document.createElement('div');
    container.className = 'ql-code-block-container';
    block.parentNode.insertBefore(container, block);
    group.forEach(el => { container.appendChild(el); processed.add(el); });
  }

  // ── Images: ensure clickable for viewer ──────────────────────────────────
  wrapper.querySelectorAll('img').forEach(img => {
    if(!img.getAttribute('data-full')) img.setAttribute('data-full', img.src || img.getAttribute('src') || '');
    img.style.cursor = 'zoom-in';
  });

  // ── Wrap iframes ─────────────────────────────────────────────────────────
  wrapper.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || iframe.src || '';
    if(!src || src.trim() === '') return;
    if(iframe.closest('.iframe-wrapper')) return;
    const container = document.createElement('div');
    container.className = 'iframe-wrapper';
    iframe.parentNode.replaceChild(container, iframe);
    container.appendChild(iframe);
  });

  // ── Wrap tables ──────────────────────────────────────────────────────────
  wrapper.querySelectorAll('table').forEach(tbl => {
    if(tbl.closest('.table-wrapper')) return;
    const w = document.createElement('div');
    w.className = 'table-wrapper';
    tbl.parentNode.replaceChild(w, tbl);
    w.appendChild(tbl);
  });

  // ── Links: secure + new tab ──────────────────────────────────────────────
  wrapper.querySelectorAll('a').forEach(a => {
    if(!a.target) a.setAttribute('target','_blank');
    if(!a.rel)    a.setAttribute('rel','noopener noreferrer');
  });

  // ── Clean leftover Quill data attrs ──────────────────────────────────────
  wrapper.querySelectorAll('[data-list]').forEach(el => el.removeAttribute('data-list'));

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
 * Image Viewer (Performance-optimized with RAF smooth animation)
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
      if(zoomIndicator) zoomIndicator.textContent = `${Math.round(rendered.scale * 100)}%`;
    }
    rafId = requestAnimationFrame(rafLoop);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function resetToFit() {
    // With transform-origin: center center, tx=0/ty=0 means perfectly centered
    target.scale = 1;
    target.tx = 0;
    target.ty = 0;
  }

  function open(src) {
    if(!src) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Reset state immediately so there's no flash of wrong position
    target = { scale: 1, tx: 0, ty: 0 };
    rendered = { scale: 1, tx: 0, ty: 0 };
    img.style.transform = 'translate3d(0,0,0) scale(1)';
    img.src = src;
    img.onload = () => {
      target = { scale: 1, tx: 0, ty: 0 };
      rendered = { scale: 1, tx: 0, ty: 0 };
      img.style.transform = 'translate3d(0,0,0) scale(1)';
      if(!rafId) rafLoop();
      if(downloadAnchor) {
        downloadAnchor.href = src;
        try {
          const url = new URL(src, location.href);
          const fn = url.pathname.split('/').pop() || 'image';
          downloadAnchor.setAttribute('download', fn);
        } catch(e) {
          downloadAnchor.removeAttribute('download');
        }
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

  if(controls) {
    controls.addEventListener('click', ev => {
      ev.stopPropagation();
      const action = ev.target.closest('[data-action]')?.getAttribute('data-action');
      if(!action) return;
      if(action === 'zoom-in') { target.scale = clamp(target.scale * 1.25, 0.2, 6); }
      else if(action === 'zoom-out') { target.scale = clamp(target.scale / 1.25, 0.2, 6); }
      else if(action === 'fit') { resetToFit(); }
      else if(action === 'close') { close(); }
    });
  }

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

let _imageViewerAttached = false;
function attachImageViewerToContent() {
  createImageViewerElements();
  if(_imageViewerAttached) return;
  _imageViewerAttached = true;
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

// ─────────────────────────────────────────────────────────────
// [#2] Header title helpers
// ─────────────────────────────────────────────────────────────

/**
 * Ghi tiêu đề vào thanh header.
 * Nếu tiêu đề bị cắt (overflow) thì thêm class is-truncated
 * và gắn click để mở titleModal hiển thị đầy đủ.
 */
function setHeaderTitle(title) {
  const el = document.getElementById('postTitleHeader');
  if(!el) return;
  el.textContent = title || 'Chi tiết nội dung';
  el.classList.toggle('has-title', !!title);
  el.setAttribute('title', title || '');

  // Fill modal content
  const modalContent = document.getElementById('titleModalContent');
  if(modalContent) modalContent.textContent = title || '';

  // Check truncation after paint
  requestAnimationFrame(() => {
    const isTruncated = el.scrollWidth > el.clientWidth;
    if(isTruncated) {
      el.classList.add('is-truncated');
      el.onclick = openTitleModal;
    } else {
      el.classList.remove('is-truncated');
      el.onclick = null;
    }
  });
}

function openTitleModal() {
  document.getElementById('titleModalOverlay')?.classList.add('show');
  document.getElementById('titleModal')?.classList.add('show');
}

function closeTitleModal() {
  document.getElementById('titleModalOverlay')?.classList.remove('show');
  document.getElementById('titleModal')?.classList.remove('show');
}

function initTitleModal() {
  document.getElementById('titleModalClose')?.addEventListener('click', closeTitleModal);
  document.getElementById('titleModalOverlay')?.addEventListener('click', closeTitleModal);
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape') closeTitleModal();
  });
}

// ─────────────────────────────────────────────────────────────
// [#4] Sticky header + [#5] Float button — scroll logic
// ─────────────────────────────────────────────────────────────
function initScrollBehaviour() {
  const header   = document.getElementById('stickyHeader');
  const floatBtn = document.getElementById('floatCommentBtn');
  if(!header) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  function onScroll() {
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const scrollingDown = currentY > lastScrollY;

      // Chỉ ẩn khi đã scroll xuống ít nhất 60px
      if(currentY > 60) {
        header.classList.toggle('header-hidden', scrollingDown);
        if(floatBtn && floatBtn.style.display !== 'none') {
          floatBtn.classList.toggle('btn-hidden', scrollingDown);
        }
      } else {
        header.classList.remove('header-hidden');
        if(floatBtn) floatBtn.classList.remove('btn-hidden');
      }

      lastScrollY = currentY;
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
}

// ─────────────────────────────────────────────────────────────
// [#5] Floating comment button
// ─────────────────────────────────────────────────────────────
function initFloatCommentBtn() {
  const btn = document.getElementById('floatCommentBtn');
  if(!btn) return;
  btn.addEventListener('click', () => {
    const form = document.getElementById('commentFormArea');
    const section = document.getElementById('commentsSection');
    const target = form || section;
    if(target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => {
        const input = document.getElementById('commentText');
        if(input) input.focus();
      }, 600);
    }
  });
}

function syncFloatCommentCount(count) {
  const badge = document.getElementById('floatCommentCount');
  if(badge) badge.textContent = count;
}

// ─────────────────────────────────────────────────────────────
// Load & render content
// ─────────────────────────────────────────────────────────────
async function load() {
  if(!contentId) {
    postArea.innerHTML = `
      <div class="relife-glass-card">
        <div class="text-center text-muted py-5">
          <i class="bi bi-exclamation-circle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
          <div>ID ${isNotification ? 'thông báo' : 'bài viết'} không hợp lệ.</div>
          <a href="${isNotification ? 'notification.html' : 'index.html'}" class="relife-btn-primary mt-3">
            Về ${isNotification ? 'trang thông báo' : 'trang chủ'}
          </a>
        </div>
      </div>
    `;
    return;
  }

  try {
    // ✅ Load from appropriate collection
    const collectionName = isNotification ? 'notifications' : 'posts';
    const snap = await getDoc(doc(db, collectionName, contentId));

    if(!snap.exists()) {
      postArea.innerHTML = `
        <div class="relife-glass-card">
          <div class="text-center text-muted py-5">
            <i class="bi bi-file-earmark-x" style="font-size: 3rem; margin-bottom: 1rem;"></i>
            <div>Không tìm thấy ${isNotification ? 'thông báo' : 'bài viết'}.</div>
            <a href="${isNotification ? 'notification.html' : 'index.html'}" class="relife-btn-primary mt-3">
              Về ${isNotification ? 'trang thông báo' : 'trang chủ'}
            </a>
          </div>
        </div>
      `;
      return;
    }

    const d = { id: snap.id, ...snap.data() };
    if(!isNotification) currentPostData = d;

    // ─── Build header HTML ───────────────────────────────
    let headerHtml = '';
    let followBtnHtml = '';

    if(isNotification) {
      // Notification-specific header
      const icon = getCategoryIcon(d.category);
      const label = getCategoryLabel(d.category);
      headerHtml = `
        <div class="relife-post-header">
          <div class="relife-notification-icon">${icon}</div>
          <div class="relife-author-info">
            <div class="relife-notification-category">
              ${label}
              <span class="relife-notification-badge priority-${d.priority || 'normal'}">
                ${d.priority === 'high' ? 'Quan trọng' : 'Thông báo'}
              </span>
            </div>
            <div class="relife-post-time">
              <i class="bi bi-clock"></i>
              <span>${fmtDate(d.createdAt)}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      // Post header — [#1] avatar | (tên \n tag+time) | follow
      let authorAvatar = `https://ui-avatars.com/api/?name=U&background=0D6EFD&color=fff&size=128`;

      if(d.userId) {
        const userSnap = await getDoc(doc(db, 'users', d.userId));
        const prof = userSnap.exists() ? userSnap.data() : null;
        authorAvatar = prof?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(prof?.displayName||d.displayName||'U')}&background=0D6EFD&color=fff&size=128`;
        const tag = prof?.tagName || d.authorTag || '';
        
        const currentUser = auth.currentUser;
        const isAuthor = currentUser && currentUser.uid === d.userId;
        
        if(currentUser && !isAuthor) {
          const isFollowing = await checkFollowStatus(d.userId);
          followBtnHtml = `
            <button id="followBtn" class="relife-follow-btn ${isFollowing ? 'following' : ''}" onclick="window.toggleFollowFromPost()">
              <i class="bi bi-${isFollowing ? 'check-lg' : 'person-plus-fill'}"></i>
              <span>${isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span>
            </button>
          `;
        }

        // [#1] Layout gọn: avatar | (tên trên / tag+time dưới) | nút follow
        headerHtml = `
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
              </div>
            </div>
            ${followBtnHtml}
          </div>
        `;
      } else {
        // Trial / anonymous author
        authorAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'T')}&background=FFC107&color=000&size=128`;
        headerHtml = `
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

    // Hashtags (only for posts)
    const hashtagsHtml = !isNotification && d.hashtags 
      ? d.hashtags.map(h => 
          `<a href="tag.html?tag=${encodeURIComponent(h)}" class="relife-hashtag">
            <i class="bi bi-hash"></i>${esc(h.replace(/^#/, ''))}
          </a>`
        ).join('')
      : '';

    // [#3] Reactions — Like/Dislike cùng hàng, Comment full-width dòng riêng
    const reactionsHtml = isNotification ? '' : `
      <div class="relife-reactions">
        <div class="relife-reactions-row">
          <button id="likeBtn" class="relife-reaction-btn">
            <i class="bi bi-hand-thumbs-up-fill"></i>
            <span id="likeCount">${d.likes||0}</span>
          </button>
          <button id="dislikeBtn" class="relife-reaction-btn">
            <i class="bi bi-hand-thumbs-down-fill"></i>
            <span id="dislikeCount">${d.dislikes||0}</span>
          </button>
        </div>
        <button id="commentToggle" class="relife-reaction-btn">
          <i class="bi bi-chat-dots-fill"></i>
          <span id="commentCountBtn">...</span>
        </button>
      </div>
    `;

    // Build final HTML
    postArea.innerHTML = `
      <div class="relife-glass-card">
        ${headerHtml}
        ${!isNotification ? `<h1 class="relife-post-title">${esc(d.title || 'Không có tiêu đề')}</h1>` : ''}
        ${hashtagsHtml ? `<div class="relife-hashtags">${hashtagsHtml}</div>` : ''}
        <div id="postContentContainer" class="post-content">${rendered}</div>
        ${reactionsHtml}
      </div>
    `;

    // Attach image viewer
    attachImageViewerToContent();

    // [#2] Set header title
    if(!isNotification) {
      setHeaderTitle(d.title || '');
    } else {
      setHeaderTitle(getCategoryLabel(d.category));
    }

    // ✅ Only show comments section for posts
    if(!isNotification) {
      commentsSection.style.display = 'block';
      document.getElementById('commentCount').textContent = '...';
      watchRealtime();
      updateReactionButtonsState();

      // [#5] Show float button after post loaded
      const floatBtn = document.getElementById('floatCommentBtn');
      if(floatBtn) floatBtn.style.display = 'flex';
    } else {
      // Hide comments section for notifications
      commentsSection.style.display = 'none';
    }

    // Smooth scroll animation
    postArea.querySelector('.relife-glass-card').style.animation = 'fadeInUp 0.5s ease';
    
    // Set back button destination based on content type
    const backBtn = document.getElementById('nut_thoat');
    if(backBtn) {
      backBtn.href = isNotification ? 'notification.html' : 'index.html';
    }

    // Bind events (share button and post-specific features)
    bindEvents();

  } catch(err) {
    console.error('Load content error:', err);
    postArea.innerHTML = `
      <div class="relife-glass-card">
        <div class="text-center text-danger py-5">
          <i class="bi bi-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
          <div>Lỗi khi tải ${isNotification ? 'thông báo' : 'bài viết'}</div>
          <small class="text-muted d-block mt-2">${esc(err.message || err)}</small>
          <a href="${isNotification ? 'notification.html' : 'index.html'}" class="relife-btn-primary mt-3">
            Về ${isNotification ? 'trang thông báo' : 'trang chủ'}
          </a>
        </div>
      </div>
    `;
  }
}

/**
 * Helper functions for notification display
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
 * Watch realtime updates (POSTS ONLY)
 */
let commentsUnsub = null;
function watchRealtime() {
  if(isNotification) return; // Skip for notifications
  
  // Watch comments
  const commentsRef = collection(db, 'posts', contentId, 'comments');
  const q = query(commentsRef, orderBy('createdAt', 'desc'));
  if(commentsUnsub) commentsUnsub();
  commentsUnsub = onSnapshot(q, snap => {
    renderComments(snap);
    
    const actualCount = snap.size;
    const countBtn = document.getElementById('commentCountBtn');
    const countBadge = document.getElementById('commentCount');
    if(countBtn) countBtn.textContent = actualCount;
    if(countBadge) countBadge.textContent = actualCount;
    // [#5] Sync float button badge
    syncFloatCommentCount(actualCount);
  });

  // Watch post counters (likes/dislikes only)
  const postRef = doc(db, 'posts', contentId);
  onSnapshot(postRef, snap => {
    const d = snap.data();
    if(!d) return;
    const likeEl = document.getElementById('likeCount');
    const disEl = document.getElementById('dislikeCount');
    if(likeEl) likeEl.textContent = d.likes || 0;
    if(disEl) disEl.textContent = d.dislikes || 0;
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
  for(const [idx, c] of rootComments.entries()) {
    await renderCommentWithReplies(list, c, idx, currentUser, replyMap, 0);
  }
}

/**
 * Render comment with its reply tree (recursive)
 */
async function renderCommentWithReplies(parentContainer, comment, index, currentUser, replyMap, depth) {
  const replies = replyMap.get(comment.id) || [];
  const hasReplies = replies.length > 0;
  
  // Render the comment
  const commentEl = await renderCommentElement(comment, index, currentUser, depth, hasReplies, replies.length);
  parentContainer.appendChild(commentEl);
  
  // Create collapsible replies container
  if(hasReplies) {
    const repliesContainer = document.createElement('div');
    repliesContainer.className = 'relife-replies-container';
    repliesContainer.id = `replies-${comment.id}`;
    repliesContainer.style.display = 'none'; // Hidden by default
    
    // Render each reply recursively
    for(const [replyIdx, reply] of replies.entries()) {
      await renderCommentWithReplies(repliesContainer, reply, replyIdx, currentUser, replyMap, depth + 1);
    }
    
    parentContainer.appendChild(repliesContainer);
  }
}

/**
 * Render individual comment element with collapse support
 */
async function renderCommentElement(comment, index, currentUser, depth, hasReplies, replyCount) {
  const avatar = await getUserAvatar(comment.userId, comment.displayName, comment.avatarUrl || null);
  const isOwnComment = currentUser && comment.userId === currentUser.uid;
  const isAuthor = currentPostData && comment.userId === currentPostData.userId;
  
  // Check if highly reported (warning)
  const reportCount = comment.reportCount || 0;
  const isReported = reportCount >= 3; // Threshold: 3 reports
  
  // Limit visual indent - all depths > 0 use same margin, different border colors
  const isReply = depth > 0;
  const replyLevelClass = isReply ? `reply reply-level-${Math.min(depth, 5)}` : '';
  const reportedClass = isReported ? ' reported' : '';
  
  // Reply to indicator (for replies only)
  let replyToHtml = '';
  if(comment.replyTo && comment.replyToName) {
    replyToHtml = `<div class="reply-to-badge" onclick="window.scrollToComment('${comment.replyTo}')"><i class="bi bi-reply-fill"></i><span>Phản hồi ${esc(comment.replyToName)}</span></div>`;
  }
  
  // Parse mentions in text
  const displayText = parseMentions(comment.text, comment.mentions || []);
  
  // Edited badge
  let editedBadge = '';
  if(comment.editedAt) {
    editedBadge = `<span class="edited-badge"><i class="bi bi-pencil-fill"></i><span>Đã chỉnh sửa</span></span>`;
  }
  
  // Report warning badge
  let reportBadge = '';
  if(isReported) {
    reportBadge = `<span class="report-badge"><i class="bi bi-flag-fill"></i><span>${reportCount} báo cáo</span></span>`;
  }
  
  // Author badge
  const authorBadge = isAuthor ? `<span class="author-badge"><i class="bi bi-patch-check-fill"></i> Tác giả</span>` : '';
  
  // Actions
  let actionsHtml = `<div class="comment-actions"><button class="comment-action-btn" onclick="window.setReplyTo('${comment.id}', '${esc(comment.displayName)}')"><i class="bi bi-reply-fill"></i><span>Trả lời</span></button>`;
  
  if(isOwnComment) {
    actionsHtml += `<button class="comment-action-btn" onclick="window.editComment('${comment.id}')"><i class="bi bi-pencil-fill"></i><span>Sửa</span></button><button class="comment-action-btn delete" onclick="window.deleteComment('${comment.id}')"><i class="bi bi-trash-fill"></i><span>Xóa</span></button>`;
  } else {
    actionsHtml += `<button class="comment-action-btn delete" onclick="window.openReportModal('${comment.id}')"><i class="bi bi-flag-fill"></i><span>Báo cáo</span></button>`;
  }
  actionsHtml += '</div>';
  
  // Toggle replies button (if has replies)
  let toggleRepliesHtml = '';
  if(hasReplies) {
    toggleRepliesHtml = `<button class="toggle-replies" onclick="window.toggleReplies('${comment.id}')" id="toggle-${comment.id}"><i class="bi bi-chevron-down"></i><span>Xem ${replyCount} phản hồi</span></button>`;
  }
  
  const el = document.createElement('div');
  el.className = `comment-item ${replyLevelClass}${reportedClass}`;
  el.id = `comment-${comment.id}`;
  el.setAttribute('data-comment-data', JSON.stringify({text: comment.text, mentions: comment.mentions || []}));
  el.innerHTML = `
    <div class="comment-header">
      <img src="${avatar}" class="comment-avatar" alt="avatar" onclick="window.navigateToProfile('${comment.userId}')">
      <div class="comment-author">
        <div><span class="comment-name" onclick="window.navigateToProfile('${comment.userId}')">${esc(comment.displayName||'Ẩn danh')}</span>${authorBadge}${editedBadge}${reportBadge}</div>
        <div class="comment-time"><i class="bi bi-clock"></i><span>${fmtDate(comment.createdAt)}</span></div>
      </div>
    </div>
    ${replyToHtml}
    <div class="comment-text">${displayText}</div>
    ${actionsHtml}
    ${toggleRepliesHtml}
  `;
  return el;
}

// ═══════════════════════════════════════════════════════════
// v1.5 FEATURES: Edit, Report, Mention (POSTS ONLY)
// ═══════════════════════════════════════════════════════════

/**
 * Edit comment
 */
let currentEditingCommentId = null;

window.editComment = function(commentId) {
  if(currentEditingCommentId) {
    const prevForm = document.getElementById(`edit-form-${currentEditingCommentId}`);
    if(prevForm) prevForm.remove();
  }
  
  const commentEl = document.getElementById(`comment-${commentId}`);
  if(!commentEl) return;
  
  // Get original text from data attribute
  let originalText = '';
  try {
    const dataAttr = commentEl.getAttribute('data-comment-data');
    originalText = JSON.parse(dataAttr)?.text || '';
  } catch(e) {}
  
  currentEditingCommentId = commentId;
  
  const form = document.createElement('div');
  form.className = 'edit-comment-form';
  form.id = `edit-form-${commentId}`;
  form.innerHTML = `
    <textarea class="edit-textarea" id="edit-textarea-${commentId}" placeholder="Nhập @username để gắn tag...">${esc(originalText)}</textarea>
    <div class="edit-buttons">
      <button class="btn-save" onclick="window.saveEdit('${commentId}')"><i class="bi bi-check-lg"></i> Lưu</button>
      <button class="btn-cancel" onclick="window.cancelEdit('${commentId}')">Hủy</button>
    </div>
  `;
  
  const commentText = commentEl.querySelector('.comment-text');
  if(commentText) commentText.after(form);
  else commentEl.appendChild(form);
  
  const textarea = document.getElementById(`edit-textarea-${commentId}`);
  if(textarea) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    setupMentionAutocomplete(textarea);
  }
};

window.cancelEdit = function(commentId) {
  const form = document.getElementById(`edit-form-${commentId}`);
  if(form) form.remove();
  currentEditingCommentId = null;
};

window.saveEdit = async function(commentId) {
  if(isNotification) return;
  
  const textarea = document.getElementById(`edit-textarea-${commentId}`);
  if(!textarea) return;
  
  const newText = textarea.value.trim();
  if(!newText) return alert('Nội dung không được để trống.');
  
  const user = auth.currentUser;
  if(!user) return alert('Bạn cần đăng nhập.');
  
  try {
    const mentions = extractMentions(newText);
    const mentionedUserIds = await resolveMentions(mentions);
    
    await updateDoc(doc(db, 'posts', contentId, 'comments', commentId), {
      text: newText,
      mentions: mentionedUserIds,
      editedAt: serverTimestamp(),
      editCount: increment(1)
    });
    window.cancelEdit(commentId);
  } catch(err) {
    console.error('Edit error:', err);
    alert('Không thể sửa bình luận. Vui lòng thử lại.');
  }
};

/**
 * Delete comment (with cascade delete of all nested replies)
 */
let allComments = [];

function findAllReplies(commentId, comments) {
  const directReplies = comments.filter(c => c.replyTo === commentId);
  let allReplies = [...directReplies];
  directReplies.forEach(reply => {
    allReplies = allReplies.concat(findAllReplies(reply.id, comments));
  });
  return allReplies;
}

window.deleteComment = async function(commentId) {
  if(!confirm('Bạn chắc chắn muốn xóa bình luận này?')) return;
  
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập.');
    return;
  }
  
  try {
    // Step 1: Verify comment exists and belongs to user
    const commentSnap = await getDoc(doc(db, 'posts', contentId, 'comments', commentId));
    if(!commentSnap.exists()) {
      alert('Bình luận không tồn tại.');
      return;
    }
    
    // Step 2: Verify ownership
    const targetComment = commentSnap.data();
    if(targetComment.userId !== user.uid) {
      alert('Bạn chỉ có thể xóa bình luận của mình.');
      return;
    }
    
    // Step 3: Get all comments to find nested replies
    const commentsSnap = await getDocs(collection(db, 'posts', contentId, 'comments'));
    allComments = commentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const repliesToDelete = findAllReplies(commentId, allComments);
    const totalToDelete = 1 + repliesToDelete.length;
    
    console.log(`Deleting comment ${commentId} and ${repliesToDelete.length} nested replies (total: ${totalToDelete})`);
    
    // Step 4: Delete all in batch
    const batch = writeBatch(db);
    
    // Delete parent
    batch.delete(doc(db, 'posts', contentId, 'comments', commentId));
    
    // Delete all nested replies
    repliesToDelete.forEach(reply => {
      batch.delete(doc(db, 'posts', contentId, 'comments', reply.id));
    });
    
    await batch.commit();
    
    console.log(`Successfully deleted ${totalToDelete} comments`);
  } catch(err) {
    console.error('Delete comment error:', err);
    alert('Không thể xóa bình luận. Vui lòng thử lại.');
  }
};

/**
 * Bind event listeners
 */
function bindEvents() {
  // Share button - ALWAYS available (works for both posts and notifications)
  const shareBtn = document.getElementById('shareBtn');
  if(shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        const oldHtml = shareBtn.innerHTML;
        shareBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
        shareBtn.style.background = 'rgba(52, 199, 89, 0.2)';
        shareBtn.style.color = '#34C759';
        setTimeout(() => {
          shareBtn.innerHTML = oldHtml;
          shareBtn.style.background = '';
          shareBtn.style.color = '';
        }, 1500);
      } catch(e) {
        alert('Không thể sao chép URL');
      }
    });
  }
  
  // Skip interactive features for notifications
  if(isNotification) return;

  // Reaction buttons
  document.getElementById('likeBtn').addEventListener('click', () => toggleReaction(contentId, 'like'));
  document.getElementById('dislikeBtn').addEventListener('click', () => toggleReaction(contentId, 'dislike'));
  
  // [#3/#5] Comment toggle - smooth scroll to comment form
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
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i>';
    
    try {
      const udoc = await getDoc(doc(db, 'users', user.uid));
      const prof = udoc.exists() ? udoc.data() : null;
      
      // Extract and resolve mentions
      const mentions = extractMentions(text);
      const mentionedUserIds = await resolveMentions(mentions);
      
      const commentData = {
        displayName: prof?.displayName || user.email,
        userId: user.uid,
        avatarUrl: prof?.avatarUrl || null,
        text,
        createdAt: serverTimestamp(),
        mentions: mentionedUserIds,
        reportCount: 0
      };
      
      // Add reply info if replying
      if(currentReplyTo) {
        commentData.replyTo = currentReplyTo.id;
        commentData.replyToName = currentReplyTo.name;
      }
      
      await addDoc(collection(db, 'posts', contentId, 'comments'), commentData);
      
      document.getElementById('commentText').value = '';
      
      // Clear reply state
      currentReplyTo = null;
      const indicator = document.getElementById('replyIndicator');
      if(indicator) indicator.style.display = 'none';
      
      // Success feedback
      btn.innerHTML = '<i class="bi bi-check-lg"></i>';
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-fill"></i>';
      }, 1500);
    } catch(err) {
      console.error('Comment error:', err);
      alert('Không thể gửi bình luận. Vui lòng thử lại.');
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-fill"></i>';
    }
  });

  // Auth state for comments
  onAuthStateChanged(auth, user => {
    if(user) {
      document.getElementById('loginNotice').style.display = 'none';
      document.getElementById('commentFormArea').style.display = 'block';
      
      // Setup mention autocomplete for main comment input
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

  // Cancel reply
  document.getElementById('cancelReply')?.addEventListener('click', () => {
    currentReplyTo = null;
    const indicator = document.getElementById('replyIndicator');
    if(indicator) indicator.style.display = 'none';
  });
}

/**
 * Update reaction buttons visual state (POSTS ONLY)
 */
async function updateReactionButtonsState() {
  if(isNotification) return;
  
  const user = auth.currentUser;
  const likeBtn = document.getElementById('likeBtn');
  const disBtn = document.getElementById('dislikeBtn');
  if(!likeBtn || !disBtn) return;
  
  likeBtn.classList.remove('active-like');
  disBtn.classList.remove('active-dislike');
  
  if(!user) return;
  
  try {
    const likeDoc = await getDoc(doc(db, 'posts', contentId, 'likes', user.uid));
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
 * Toggle reaction (like/dislike) - POSTS ONLY
 */
async function toggleReaction(postId, reaction) {
  if(isNotification) return;
  
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

/**
 * Mention helpers
 */
function parseMentions(text, mentionedUserIds) {
  if(!text) return '';
  const escaped = esc(text);
  return escaped.replace(/@(\S+)/g, (match, tag) => {
    return `<span class="mention" onclick="window.navigateToMention('@${esc(tag)}')">${esc(match)}</span>`;
  });
}

function extractMentions(text) {
  const matches = text.match(/@(\S+)/g) || [];
  return matches.map(m => m.slice(1).toLowerCase());
}

async function resolveMentions(tags) {
  if(!tags.length) return [];
  try {
    const usersRef = collection(db, 'users');
    const snap = await getDocs(usersRef);
    const ids = [];
    snap.forEach(d => {
      const data = d.data();
      const tagName = (data.tagName || '').toLowerCase().replace(/^@/, '');
      if(tags.includes(tagName) || tags.includes('@' + tagName)) ids.push(d.id);
    });
    return ids;
  } catch(e) { return []; }
}

window.navigateToMention = async function(tagName) {
  try {
    const snap = await getDocs(collection(db, 'users'));
    let targetId = null;
    snap.forEach(d => {
      if((d.data().tagName || '').toLowerCase() === tagName.toLowerCase()) targetId = d.id;
    });
    if(targetId) {
      navigateToProfile(targetId);
    } else {
      alert(`Không tìm thấy người dùng ${tagName}`);
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
    const replyCount = repliesContainer.querySelectorAll('.comment-item').length;
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
  const nameEl = document.getElementById('replyToName');
  if(indicator) indicator.style.display = 'flex';
  if(nameEl) nameEl.textContent = `Đang trả lời ${displayName}`;
  
  const textarea = document.getElementById('commentText');
  if(textarea) {
    textarea.focus();
    textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

/**
 * Report comment
 */
let currentReportCommentId = null;

window.openReportModal = function(commentId) {
  if(isNotification) return;
  
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
  if(isNotification) return;
  if(!currentReportCommentId) return;
  
  const user = auth.currentUser;
  if(!user) {
    alert('Bạn cần đăng nhập để báo cáo.');
    return;
  }
  
  const reasonRadio = document.querySelector('input[name="reportReason"]:checked');
  let reason = reasonRadio ? reasonRadio.value : 'other';
  reason = reason.toLowerCase();

  try {
    const reportRef = doc(db, 'posts', contentId, 'comments', currentReportCommentId, 'reports', user.uid);
    const reportDoc = await getDoc(reportRef);
    
    if(reportDoc.exists()) {
      alert('Bạn đã báo cáo bình luận này rồi.');
      window.closeReportModal();
      return;
    }
    
    const batch = writeBatch(db);
    
    batch.set(reportRef, {
      userId: user.uid,
      reason: reason,
      createdAt: serverTimestamp()
    });
    
    const commentRef = doc(db, 'posts', contentId, 'comments', currentReportCommentId);
    batch.set(commentRef, { 
      reportCount: increment(1) 
    }, { merge: true });
    
    await batch.commit();
    
    console.log('Report submitted successfully');
    alert('Đã gửi báo cáo. Cảm ơn bạn!');
    window.closeReportModal();
  } catch(err) {
    console.error('Report error:', err);
    alert('Không thể gửi báo cáo. Vui lòng thử lại.\n\nLỗi: ' + (err.message || err.code || err));
  }
};

document.getElementById('reportOverlay').addEventListener('click', window.closeReportModal);

/**
 * Mention autocomplete
 */
function setupMentionAutocomplete(textarea) {
  const dropdown = document.getElementById('mentionDropdown');
  let lastAtPos = -1;

  textarea.addEventListener('input', async () => {
    const text = textarea.value;
    const cursor = textarea.selectionStart;
    const before = text.substring(0, cursor);
    const atIdx = before.lastIndexOf('@');
    
    if(atIdx === -1) { dropdown.classList.remove('show'); return; }
    
    const currentQuery = before.substring(atIdx + 1).toLowerCase();
    lastAtPos = atIdx;
    
    if(currentQuery.length >= 2) {
      await searchUsersForMention(currentQuery, dropdown, textarea, lastAtPos);
    } else {
      dropdown.classList.remove('show');
    }
  });
  
  textarea.addEventListener('blur', () => {
    setTimeout(() => dropdown.classList.remove('show'), 200);
  });
}

/**
 * Search users for mention
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
    
    dropdown.innerHTML = matches.slice(0, 5).map(user => {
      const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=0D6EFD&color=fff&size=64`;
      return `
        <div class="mention-item" data-tagname="${esc(user.tagName)}" data-userid="${user.id}">
          <img src="${avatar}" class="mention-avatar" alt="avatar">
          <div class="mention-name">${esc(user.displayName)}</div>
          <div class="mention-tag">${esc(user.tagName)}</div>
        </div>
      `;
    }).join('');
    
    const rect = textarea.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 5) + 'px';
    dropdown.style.width = Math.min(rect.width, 300) + 'px';
    dropdown.classList.add('show');
    
    dropdown.querySelectorAll('.mention-item').forEach(item => {
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

// ─────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────
initTitleModal();      // [#2]
initScrollBehaviour(); // [#4]
initFloatCommentBtn(); // [#5]

// Wait for auth state before loading content so follow/reaction state is correct
let _loaded = false;
onAuthStateChanged(auth, () => {
  if(_loaded) return; // only load once
  _loaded = true;
  load();
});