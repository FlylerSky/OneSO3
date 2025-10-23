// JS/post.js (module)
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
const hiddenRenderer = document.getElementById('__qs_hidden_renderer');

const esc = s => String(s||'').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('vi-VN') : ''; } catch { return ''; } };

const PURIFY_CFG_ALLOW_CLASS = {
  ADD_TAGS: ['iframe','table','thead','tbody','tfoot','tr','td','th','video','source','figure','figcaption','caption','pre','code','span','ul','ol','li'],
  ADD_ATTR: ['style','class','id','width','height','allow','allowfullscreen','frameborder','controls','playsinline','loading','referrerpolicy','sandbox','data-*','src','srcdoc'],
  FORBID_TAGS: ['script','object','embed'],
  KEEP_CONTENT: false
};

function inlineComputedStyles(root){
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

async function renderDeltaPreserveStyles(delta){
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

async function renderHtmlPreserveStyles(rawHtml){
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
 * postProcessHtml:
 * - Strip quill UI bits
 * - Normalize Quill list output (handles <p class="ql-list"...>, and also <ol><li data-list="bullet"> cases)
 * - Wrap iframes and tables for responsiveness.
 */
function postProcessHtml(sanitizedHtml){
  const wrapper = document.createElement('div');
  wrapper.innerHTML = sanitizedHtml;

  // 1) Remove Quill UI helper spans (<span class="ql-ui"...>) which break list markup
  wrapper.querySelectorAll('span.ql-ui').forEach(el => el.remove());

  // 2) Normalize Quill 'p' or other block nodes that represent lists
  (function normalizeQuillParagraphLists(container){
    if(!container) return;
    const qlNodes = Array.from(container.querySelectorAll('.ql-list'));
    const processed = new Set();
    for(const node of qlNodes){
      if(processed.has(node)) continue;
      if(node.closest('ul,ol')) { processed.add(node); continue; }
      const listType = (node.getAttribute && node.getAttribute('data-list')) || 'bullet';
      const tagName = /order|ordered|number/i.test(listType) ? 'ol' : 'ul';
      const items = [];
      let cur = node;
      while(cur && cur.classList && cur.classList.contains('ql-list') && ((cur.getAttribute && (cur.getAttribute('data-list') || 'bullet')) === listType)){
        items.push(cur);
        processed.add(cur);
        cur = cur.nextElementSibling;
      }
      if(items.length){
        const listEl = document.createElement(tagName);
        for(const itemNode of items){
          const li = document.createElement('li');
          li.innerHTML = itemNode.innerHTML;
          listEl.appendChild(li);
          itemNode.parentNode && itemNode.parentNode.removeChild(itemNode);
        }
        if(cur && cur.parentNode){
          cur.parentNode.insertBefore(listEl, cur);
        } else {
          container.appendChild(listEl);
        }
      }
    }
  })(wrapper);

  // 3) Handle cases like: <ol><li data-list="bullet">...</li></ol>  => convert container ol->ul
  (function fixListContainerTypes(container){
    if(!container) return;
    const liNodes = Array.from(container.querySelectorAll('li[data-list]'));
    for(const li of liNodes){
      const dataList = (li.getAttribute('data-list') || '').toLowerCase();
      const desiredTag = /order|ordered|number/i.test(dataList) ? 'ol' : 'ul';
      const parent = li.parentElement;
      if(!parent) continue;
      const parentTag = parent.tagName.toLowerCase();
      if(parentTag === desiredTag){
        continue;
      }
      const siblings = [];
      let prev = li.previousElementSibling;
      while(prev && prev.tagName.toLowerCase() === 'li' && (prev.getAttribute && prev.getAttribute('data-list') || '') === (li.getAttribute('data-list') || '')){
        prev = prev.previousElementSibling;
      }
      let cur = prev ? prev.nextElementSibling : parent.firstElementChild;
      while(cur && cur.tagName.toLowerCase() === 'li' && (cur.getAttribute && cur.getAttribute('data-list') || '') === (li.getAttribute('data-list') || '')){
        siblings.push(cur);
        cur = cur.nextElementSibling;
      }
      if(siblings.length){
        const newList = document.createElement(desiredTag);
        for(const item of siblings){
          const newLi = document.createElement('li');
          newLi.innerHTML = item.innerHTML;
          newList.appendChild(newLi);
          item.parentNode && item.parentNode.removeChild(item);
        }
        const insertBeforeNode = cur || null;
        if(insertBeforeNode && insertBeforeNode.parentNode){
          insertBeforeNode.parentNode.insertBefore(newList, insertBeforeNode);
        } else {
          parent.parentNode.insertBefore(newList, parent.nextSibling);
        }
      }
      if(parent && parent.children.length === 0 && parent.parentNode){
        parent.parentNode.removeChild(parent);
      }
    }
  })(wrapper);

  // 4) Wrap iframes into responsive wrapper and tables into scroll wrappers
  wrapper.querySelectorAll('iframe').forEach(iframe => {
    const src = iframe.getAttribute('src') || iframe.src || '';
    if(!src || src.trim() === '') {
      return;
    }
    if(iframe.closest('.iframe-wrapper')) return;
    const widthAttr = iframe.getAttribute('width') || iframe.style.width || '';
    const needsWrap = !widthAttr || widthAttr.includes('%') || widthAttr === '100%';
    if(needsWrap){
      const container = document.createElement('div');
      container.className = 'iframe-wrapper';
      if(iframe.hasAttribute('sandbox')) {
        container.setAttribute('data-has-sandbox', '1');
      }
      iframe.parentNode.replaceChild(container, iframe);
      container.appendChild(iframe);
    } else {
      iframe.style.maxWidth = '100%';
      iframe.style.display = 'block';
    }
  });

  wrapper.querySelectorAll('table').forEach(tbl => {
    if(tbl.closest('.table-wrapper')) return;
    const w = document.createElement('div');
    w.className = 'table-wrapper';
    tbl.parentNode.replaceChild(w, tbl);
    w.appendChild(tbl);
  });

  // 5) Ensure links open in new tab and are safe
  wrapper.querySelectorAll('a').forEach(a => {
    if(!a.target) a.setAttribute('target','_blank');
    if(!a.rel) a.setAttribute('rel','noopener noreferrer');
  });

  // 6) Remove leftover data-list attributes (optional cosmetic cleanup)
  wrapper.querySelectorAll('[data-list]').forEach(el => {
    el.removeAttribute('data-list');
  });

  return wrapper.innerHTML;
}

/* ========================= Performance-focused Image Viewer =========================
   Uses rAF smoothing, pointer events, touch pinch and SVG icons.
*/
function createImageViewerElements_perf(){
  const existing = document.getElementById('os-image-viewer');
  if(existing && existing._perfApi) return existing._perfApi;

  const overlay = document.createElement('div');
  overlay.id = 'os-image-viewer';
  overlay.className = 'os-viewer-overlay';
  overlay.innerHTML = `
    <div class="os-viewer-inner" role="dialog" aria-modal="true" tabindex="-1">
      <img class="os-viewer-img" alt="One Social image viewer">
      <div class="os-viewer-controls" aria-hidden="false">
        <button data-action="zoom-in" title="Zoom in" aria-label="Zoom in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/></svg>
        </button>
        <button data-action="zoom-out" title="Zoom out" aria-label="Zoom out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14"/></svg>
        </button>
        <button data-action="fit" title="Fit to screen" aria-label="Fit to screen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 12h3M18 12h3M12 3v3M12 18v3"/></svg>
        </button>
        <a data-action="download" title="Tải xuống" href="#" download style="text-decoration:none;">
          <button type="button" title="Tải xuống" aria-label="Download">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 10l5 5 5-5M12 15V3"/></svg>
          </button>
        </a>
        <button data-action="close" title="Đóng" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="os-viewer-zoom-indicator" aria-hidden="true">100%</div>
      <div class="os-viewer-hint">Kéo để di chuyển — Cuộn để phóng to/thu nhỏ — Esc để đóng</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const inner = overlay.querySelector('.os-viewer-inner');
  const img = overlay.querySelector('.os-viewer-img');
  const controls = overlay.querySelector('.os-viewer-controls');
  const downloadAnchor = overlay.querySelector('[data-action="download"]');
  const zoomIndicator = overlay.querySelector('.os-viewer-zoom-indicator');

  let target = { scale: 1, tx: 0, ty: 0 };
  let rendered = { scale: 1, tx: 0, ty: 0 };
  const SMOOTH = 0.18;
  let rafId = null;

  function rafLoop(){
    let changed = false;
    if(Math.abs(rendered.scale - target.scale) > 0.001){
      rendered.scale += (target.scale - rendered.scale) * SMOOTH;
      changed = true;
    } else if(rendered.scale !== target.scale){
      rendered.scale = target.scale; changed = true;
    }
    if(Math.abs(rendered.tx - target.tx) > 0.5){
      rendered.tx += (target.tx - rendered.tx) * SMOOTH; changed = true;
    } else if(rendered.tx !== target.tx){
      rendered.tx = target.tx; changed = true;
    }
    if(Math.abs(rendered.ty - target.ty) > 0.5){
      rendered.ty += (target.ty - rendered.ty) * SMOOTH; changed = true;
    } else if(rendered.ty !== target.ty){
      rendered.ty = target.ty; changed = true;
    }

    if(changed){
      img.style.transform = `translate3d(${rendered.tx}px, ${rendered.ty}px, 0) scale(${rendered.scale})`;
      zoomIndicator.textContent = `${Math.round(rendered.scale * 100)}%`;
    }
    rafId = requestAnimationFrame(rafLoop);
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  function resetToFit(){
    const rect = img.getBoundingClientRect();
    const containerRect = inner.getBoundingClientRect();
    target.scale = 1;
    target.tx = (containerRect.width - rect.width)/2;
    target.ty = (containerRect.height - rect.height)/2;
  }

  function open(src){
    if(!src) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    img.src = src;
    img.style.transition = 'none';
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
      } catch(e){
        downloadAnchor.removeAttribute('download');
      }
      overlay.focus();
    };
  }

  function close(){
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
    img.src = '';
    target = { scale: 1, tx: 0, ty: 0 };
    rendered = { scale: 1, tx: 0, ty: 0 };
  }

  overlay.addEventListener('pointerdown', ev => {
    if(!overlay.classList.contains('open')) return;
    ev.preventDefault();
  }, { passive: false });

  controls.addEventListener('click', ev => {
    ev.stopPropagation();
    const action = ev.target.closest('[data-action]')?.getAttribute('data-action');
    if(!action) return;
    if(action === 'zoom-in'){ target.scale = clamp(target.scale * 1.25, 0.2, 6); }
    else if(action === 'zoom-out'){ target.scale = clamp(target.scale / 1.25, 0.2, 6); }
    else if(action === 'fit'){ resetToFit(); }
    else if(action === 'close'){ close(); }
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

  let lastTouchDist = 0;
  overlay.addEventListener('touchstart', ev => {
    if(!overlay.classList.contains('open')) return;
    if(ev.touches.length === 2){
      ev.preventDefault();
      lastTouchDist = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
    }
  }, { passive: false });

  overlay.addEventListener('touchmove', ev => {
    if(!overlay.classList.contains('open')) return;
    if(ev.touches.length === 2){
      ev.preventDefault();
      const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
      if(lastTouchDist > 0){
        const factor = d / lastTouchDist;
        const midX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        const midY = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
        const rect = img.getBoundingClientRect();
        const cx = midX - rect.left;
        const cy = midY - rect.top;
        const prevScale = target.scale;
        const newScale = clamp(prevScale * factor, 0.2, 6);
        const scaleRatio = newScale / prevScale;
        target.tx = (target.tx - cx) * scaleRatio + cx;
        target.ty = (target.ty - cy) * scaleRatio + cy;
        target.scale = newScale;
      }
      lastTouchDist = d;
    }
  }, { passive: false });

  overlay.addEventListener('touchend', ev => {
    if(ev.touches.length === 0) lastTouchDist = 0;
  });

  const api = { open, close, overlay, img };
  overlay._perfApi = api;
  return api;
}

function attachImageViewerToContent_perf(){
  createImageViewerElements_perf();
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if(!target) return;
    const inPost = target.closest && target.closest('#postContentContainer');
    if(inPost && target.tagName && target.tagName.toLowerCase() === 'img'){
      ev.preventDefault();
      const src = target.getAttribute('data-full') || target.src || target.getAttribute('data-src') || '';
      const overlayEl = document.getElementById('os-image-viewer');
      if(overlayEl && overlayEl._perfApi && overlayEl._perfApi.open){
        overlayEl._perfApi.open(src);
      } else {
        const api2 = createImageViewerElements_perf();
        const overlayNow = document.getElementById('os-image-viewer');
        if(overlayNow) overlayNow._perfApi = api2;
        api2.open(src);
      }
    }
  }, false);
}

(function ensureViewerPerfAttached(){
  const el = document.getElementById('os-image-viewer');
  if(!el){
    const a = createImageViewerElements_perf();
    const overlay = document.getElementById('os-image-viewer');
    if(overlay) overlay._perfApi = a;
  } else {
    if(!el._perfApi) el._perfApi = createImageViewerElements_perf();
  }
})();

/* ========================= end image viewer ========================= */

async function renderContent(rawContent){
  if(!rawContent && rawContent !== '') return '<div style="white-space:pre-wrap;color:#6c757d;">(Không có nội dung)</div>';
  if(typeof rawContent === 'object') return await renderDeltaPreserveStyles(rawContent);
  const str = String(rawContent).trim();
  if(str.startsWith('<')) return await renderHtmlPreserveStyles(rawContent);
  try {
    const parsed = JSON.parse(str);
    if((parsed && parsed.ops && Array.isArray(parsed.ops)) || (Array.isArray(parsed) && parsed.length)) return await renderDeltaPreserveStyles(parsed);
  } catch(e){}
  return `<div style="white-space:pre-wrap;">${esc(rawContent)}</div>`;
}

async function load(){
  if(!postId){ postArea.innerHTML = '<div class="p-4 text-center text-muted">ID bài viết không hợp lệ. <a href="index.html">Về trang chính</a></div>'; return; }
  const snap = await getDoc(doc(db,'posts',postId));
  if(!snap.exists()){ postArea.innerHTML = '<div class="p-4 text-center text-muted">Không tìm thấy bài viết</div>'; return; }
  const d = snap.data();

  let authorHtml = '';
  if(d.userId){
    const userSnap = await getDoc(doc(db,'users',d.userId));
    const prof = userSnap.exists() ? userSnap.data() : null;
    const avatar = prof?.avatarUrl ? prof.avatarUrl : `https://ui-avatars.com/api/?name=${encodeURIComponent(prof?.displayName||d.displayName||'U')}&background=0D6EFD&color=fff&size=128`;
    const tag = prof?.tagName || d.authorTag || '';
    authorHtml = `<div class="d-flex align-items-center gap-2 mb-2"><img src="${avatar}" class="user-avatar" alt="avatar"><div><div class="fw-bold">${esc(d.displayName || prof?.displayName || 'Người dùng')}</div><div class="small-muted">${esc(tag)}</div></div></div>`;
  } else {
    authorHtml = `<div class="mb-2"><div class="fw-bold">${esc(d.displayName || 'Tài khoản thử nghiệm')}</div><div><span class="badge-trial">Tài khoản thử nghiệm</span></div></div>`;
  }

  const raw = d.content || '';
  let rendered = '';
  try {
    rendered = await renderContent(raw);
  } catch(err){
    console.error('Render failed', err);
    rendered = DOMPurify.sanitize(String(raw), PURIFY_CFG_ALLOW_CLASS);
  }

  const hashtagsHtml = (d.hashtags||[]).map(h=>`<a href="tag.html?tag=${encodeURIComponent(h)}" class="small-muted me-2">${esc(h)}</a>`).join(' ');

  postArea.innerHTML = `
    <div>${authorHtml}</div>
    <h4>${esc(d.title || '')}</h4>
    <div class="small-muted mb-2">${fmtDate(d.createdAt)}</div>
    <hr>
    <div id="postContentContainer" class="post-content mb-3">${rendered}</div>
    <div class="mb-3">${hashtagsHtml}</div>

    <div class="d-flex gap-2 align-items-center mb-3">
      <button id="likeBtn" class="btn btn-outline-primary btn-sm btn-rounded"><i class="bi bi-hand-thumbs-up"></i> <span id="likeCount">${d.likes||0}</span></button>
      <button id="dislikeBtn" class="btn btn-outline-danger btn-sm btn-rounded"><i class="bi bi-hand-thumbs-down"></i> <span id="dislikeCount">${d.dislikes||0}</span></button>
      <button id="commentToggle" class="btn btn-outline-secondary btn-sm btn-rounded ms-2"><i class="bi bi-chat"></i> <span id="commentCount">${d.commentsCount||0}</span></button>
      <button id="shareBtn" class="btn btn-outline-success btn-sm btn-rounded ms-auto"><i class="bi bi-share"></i> Chia sẻ</button>
    </div>

    <hr>
    <h6>Bình luận</h6>
    <div id="commentsList" class="mb-3"></div>
    <div id="loginNotice" class="alert alert-warning" style="display:none;">Bạn cần đăng nhập để viết bình luận.</div>
    <div id="commentFormArea" style="display:none;">
      <textarea id="commentText" class="form-control mb-2" rows="3" placeholder="Viết bình luận..."></textarea>
      <button id="sendComment" class="btn btn-primary btn-rounded w-100">Gửi</button>
    </div>
  `;

  // Attach image viewer handler AFTER content is injected
  attachImageViewerToContent_perf();

  bindEvents();
  watchRealtime();
  updateReactionButtonsState();
}

let commentsUnsub = null;
function watchRealtime(){
  const commentsRef = collection(db,'posts',postId,'comments');
  const q = query(commentsRef, orderBy('createdAt','desc'));
  if(commentsUnsub) commentsUnsub();
  commentsUnsub = onSnapshot(q, snap => {
    const list = document.getElementById('commentsList'); list.innerHTML = '';
    if(snap.empty){ list.innerHTML = '<div class="text-muted">Chưa có bình luận</div>'; return; }
    snap.forEach(s => {
      const c = s.data();
      list.innerHTML += `<div class="mb-3"><div class="fw-bold">${esc(c.displayName||'')}</div><div class="small-muted">${fmtDate(c.createdAt)}</div><div class="comment-text">${esc(c.text)}</div><hr></div>`;
    });
  });

  const postRef = doc(db,'posts',postId);
  onSnapshot(postRef, snap => {
    const d = snap.data();
    if(!d) return;
    const likeEl = document.getElementById('likeCount');
    const disEl = document.getElementById('dislikeCount');
    const comEl = document.getElementById('commentCount');
    if(likeEl) likeEl.textContent = d.likes || 0;
    if(disEl) disEl.textContent = d.dislikes || 0;
    if(comEl) comEl.textContent = d.commentsCount || 0;
  });
}

function bindEvents(){
  document.getElementById('shareBtn').addEventListener('click', async ()=>{
    try { await navigator.clipboard.writeText(location.href); const btn = document.getElementById('shareBtn'); const old = btn.innerHTML; btn.innerHTML = '<i class="bi bi-check-lg"></i> Đã sao chép'; setTimeout(()=> btn.innerHTML = old, 1200); } catch(e){ alert('Không thể sao chép URL'); }
  });

  document.getElementById('likeBtn').addEventListener('click', ()=> toggleReaction(postId, 'like'));
  document.getElementById('dislikeBtn').addEventListener('click', ()=> toggleReaction(postId, 'dislike'));
  document.getElementById('commentToggle').addEventListener('click', ()=> { const area = document.getElementById('commentFormArea'); area.scrollIntoView({ behavior:'smooth', block:'center' }); });

  document.getElementById('sendComment').addEventListener('click', async ()=>{
    const text = document.getElementById('commentText').value.trim();
    if(!text) return alert('Viết bình luận trước khi gửi.');
    const user = auth.currentUser;
    if(!user) return alert('Bạn cần đăng nhập để bình luận.');
    const udoc = await getDoc(doc(db,'users',user.uid)); const prof = udoc.exists() ? udoc.data() : null;
    await addDoc(collection(db,'posts',postId,'comments'), { displayName: prof?.displayName || user.email, userId: user.uid, text, createdAt: serverTimestamp() });
    await updateDoc(doc(db,'posts',postId), { commentsCount: increment(1) });
    document.getElementById('commentText').value = '';
  });

  onAuthStateChanged(auth, user => {
    if(user){ document.getElementById('loginNotice').style.display = 'none'; document.getElementById('commentFormArea').style.display = 'block'; }
    else { document.getElementById('loginNotice').style.display = 'block'; document.getElementById('commentFormArea').style.display = 'none'; }
    updateReactionButtonsState();
  });
}

async function updateReactionButtonsState(){
  const user = auth.currentUser;
  const likeBtn = document.getElementById('likeBtn');
  const disBtn = document.getElementById('dislikeBtn');
  if(!likeBtn || !disBtn) return;
  likeBtn.classList.remove('btn-primary'); likeBtn.classList.add('btn-outline-primary');
  disBtn.classList.remove('btn-danger'); disBtn.classList.add('btn-outline-danger');
  if(!user) return;
  try {
    const likeDoc = await getDoc(doc(db,'posts',postId,'likes',user.uid));
    if(likeDoc.exists()){
      const t = likeDoc.data().type;
      if(t === 'like'){ likeBtn.classList.remove('btn-outline-primary'); likeBtn.classList.add('btn-primary'); }
      else if(t === 'dislike'){ disBtn.classList.remove('btn-outline-danger'); disBtn.classList.add('btn-danger'); }
    }
  } catch(e){ console.error(e); }
}

async function toggleReaction(postId, reaction){
  const user = auth.currentUser;
  if(!user){ alert('Bạn cần đăng nhập để tương tác (Like/Dislike).'); return; }
  const likeDocRef = doc(db,'posts',postId,'likes',user.uid);
  const postRef = doc(db,'posts',postId);
  const likeSnap = await getDoc(likeDocRef);
  const batch = writeBatch(db);
  if(!likeSnap.exists()){
    batch.set(likeDocRef, { userId: user.uid, type: reaction, createdAt: serverTimestamp() });
    if(reaction === 'like') batch.update(postRef, { likes: increment(1) }); else batch.update(postRef, { dislikes: increment(1) });
  } else {
    const prev = likeSnap.data().type;
    if(prev === reaction){
      batch.delete(likeDocRef);
      if(reaction === 'like') batch.update(postRef, { likes: increment(-1) }); else batch.update(postRef, { dislikes: increment(-1) });
    } else {
      batch.update(likeDocRef, { type: reaction, updatedAt: serverTimestamp() });
      if(reaction === 'like') batch.update(postRef, { likes: increment(1), dislikes: increment(-1) }); else batch.update(postRef, { dislikes: increment(1), likes: increment(-1) });
    }
  }
  try { await batch.commit(); updateReactionButtonsState(); } catch(err){ console.error('Reaction failed', err); alert('Không thể cập nhật phản hồi — thử lại sau.'); }
}

load();
