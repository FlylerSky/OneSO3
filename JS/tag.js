// JS/tag.js (module)
import { initFirebase } from '../firebase-config.js';
import { collection, query, orderBy, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();

const activeTagTitle = document.getElementById('activeTagTitle');
const postsList = document.getElementById('postsList');
const hashtagLeaderboard = document.getElementById('hashtagLeaderboard');
const statusConn = document.getElementById('statusConn');

const esc = s => String(s || '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('vi-VN') : ''; } catch { return ''; } };

function updateConn(){ statusConn.textContent = navigator.onLine ? 'Online' : 'Offline'; }
window.addEventListener('online', updateConn); window.addEventListener('offline', updateConn); updateConn();

let selectedTag = new URLSearchParams(location.search).get('tag'); if(selectedTag) selectedTag = decodeURIComponent(selectedTag);
let viewMode = 'trending';
const sortTrendingBtn = document.getElementById('sortTrending');
const sortNewestBtn = document.getElementById('sortNewest');
if(sortTrendingBtn) sortTrendingBtn.addEventListener('click', ()=> { viewMode='trending'; loadPostsForTag(); });
if(sortNewestBtn) sortNewestBtn.addEventListener('click', ()=> { viewMode='newest'; loadPostsForTag(); });

if(!selectedTag){
  activeTagTitle.textContent='Khám phá Topics';
  const c = document.getElementById('activeTagCount');
  if(c) c.textContent='Chọn hashtag để bắt đầu.';
} else {
  activeTagTitle.textContent = selectedTag.replace(/^#/, '');
}

const postsRef = collection(db,'posts');
onSnapshot(query(postsRef, orderBy('createdAt','desc')), snap => {
  computeTrendingHashtagsRealtime(snap.docs.map(d => ({ id:d.id, ...d.data() })));
  if(selectedTag) loadPostsForTag();
});

async function loadPostsForTag(){
  postsList.innerHTML = '<div class="text-center text-muted py-4">Đang tải...</div>';
  if(!selectedTag){ postsList.innerHTML = '<div class="text-center text-muted py-4">Chọn hashtag từ bảng bên phải.</div>'; return; }
  const snaps = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc')));
  const arr = [];
  snaps.forEach(s => { const d = s.data(); if((d.hashtags||[]).some(h => h.toLowerCase() === selectedTag.toLowerCase())) arr.push({ id:s.id, ...d }); });
  if(arr.length === 0){ postsList.innerHTML = `<div class="text-center text-muted py-4">Chưa có bài cho ${esc(selectedTag)}</div>`; return; }

  const now = Date.now();
  function score(p){ const likes = p.likes||0, comments = p.commentsCount||0; const created = p.createdAt?.toMillis ? p.createdAt.toMillis() : 0; const daysAgo = created ? Math.max(0,(now-created)/(1000*60*60*24)) : 365; const freshness = Math.max(0, 14 - daysAgo); return likes*1 + comments*2 + freshness*3; }

  if(viewMode==='trending') arr.sort((a,b)=> score(b)-score(a)); else arr.sort((a,b)=> (b.createdAt?.toMillis?b.createdAt.toMillis():0) - (a.createdAt?.toMillis?a.createdAt.toMillis():0));

  let html='';
  arr.forEach(p => {
    const plain = DOMPurify.sanitize(p.content||'', {ALLOWED_TAGS:[]});
    const snippet = plain.length>220?plain.slice(0,220)+'…':plain;
    html += `<div class="mb-3 p-2 border rounded">
      <div class="d-flex justify-content-between">
        <div>
          <div class="fw-bold">${esc(p.title||'(Không tiêu đề)')}</div>
          <div class="small-muted">${esc(p.displayName||'')}</div>
        </div>
        <div class="text-end small-muted">
          <div><i class="bi bi-hand-thumbs-up"></i> ${p.likes||0}</div>
          <div><i class="bi bi-chat"></i> ${p.commentsCount||0}</div>
        </div>
      </div>
      <div class="mt-2 snippet">${esc(snippet)}</div>
      <div class="mt-2 text-end"><a class="btn btn-sm btn-outline-primary btn-rounded" href="post.html?id=${p.id}"><i class="bi bi-box-arrow-up-right"></i></a></div>
    </div>`;
  });
  postsList.innerHTML = html;
  const activeTagCountEl = document.getElementById('activeTagCount');
  if(activeTagCountEl) activeTagCountEl.textContent = `${arr.length} bài`;
}

function computeTrendingHashtagsRealtime(all){
  const now = Date.now(); const windowDays = 14; const tagMap = new Map();
  all.forEach(p => {
    const created = p.createdAt?.toMillis ? p.createdAt.toMillis() : 0;
    const daysAgo = created ? Math.max(0,(now-created)/(1000*60*60*24)) : 365;
    if(daysAgo > windowDays) return;
    const likes = p.likes||0, comments = p.commentsCount||0;
    const freshness = Math.max(0, windowDays - daysAgo);
    const postScore = likes*1 + comments*2 + freshness*3;
    (p.hashtags||[]).forEach(h => {
      const key = h.toLowerCase();
      const existing = tagMap.get(key) || { tag: h, count:0, score:0 };
      existing.count += 1;
      existing.score += postScore;
      tagMap.set(key, existing);
    });
  });
  const items = Array.from(tagMap.values()).sort((a,b)=> b.score - a.score).slice(0,20);
  if(items.length===0){ hashtagLeaderboard.innerHTML = '<div class="text-muted py-2">Chưa có hashtag thịnh hành</div>'; return; }
  let html='';
  items.forEach(it => html += `<div class="leaderboard-item"><a class="hashtag-btn" href="tag.html?tag=${encodeURIComponent(it.tag)}">${esc(it.tag)}</a><div class="small-muted">${it.count} bài</div></div>`);
  hashtagLeaderboard.innerHTML = html;
}

// initial compute once
(async ()=>{
  const snaps = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc')));
  computeTrendingHashtagsRealtime(snaps.docs.map(s=>({ id:s.id, ...s.data() })));
  if(selectedTag) loadPostsForTag();
})();
