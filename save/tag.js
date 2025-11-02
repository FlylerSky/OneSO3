// JS/tag.js (module) - Complete rewrite with search and fixes
import { initFirebase } from '../firebase-config.js';
import { collection, query, orderBy, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();

// DOM elements
const activeTagTitle = document.getElementById('activeTagTitle');
const postsList = document.getElementById('postsList');
const hashtagLeaderboard = document.getElementById('hashtagLeaderboard');
const allHashtagsList = document.getElementById('allHashtagsList');
const allHashtagsCount = document.getElementById('allHashtagsCount');
const statusConn = document.getElementById('statusConn');
const tagSearchInput = document.getElementById('tagSearchInput');
const tagSearchResults = document.getElementById('tagSearchResults');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const sortTrendingBtn = document.getElementById('sortTrending');
const sortNewestBtn = document.getElementById('sortNewest');

// Utility functions
const esc = s => String(s || '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('vi-VN') : ''; } catch { return ''; } };

// Connection status
function updateConn(){ 
  statusConn.textContent = navigator.onLine ? 'Online' : 'Offline'; 
}
window.addEventListener('online', updateConn); 
window.addEventListener('offline', updateConn); 
updateConn();

// State
let allPosts = [];
let selectedTag = new URLSearchParams(location.search).get('tag');
if(selectedTag) selectedTag = decodeURIComponent(selectedTag);
let viewMode = 'trending'; // 'trending' or 'newest'
let allHashtags = new Map(); // Map<lowercaseTag, {tag, count, posts}>

// Initialize
if(!selectedTag){
  activeTagTitle.textContent = 'Khám phá Topics';
  const c = document.getElementById('activeTagCount');
  if(c) c.textContent = 'Chọn hashtag để bắt đầu.';
} else {
  activeTagTitle.textContent = selectedTag.replace(/^#/, '');
}

// Sort button handlers
sortTrendingBtn.addEventListener('click', () => { 
  viewMode = 'trending'; 
  sortTrendingBtn.classList.remove('btn-outline-primary');
  sortTrendingBtn.classList.add('btn-primary');
  sortNewestBtn.classList.remove('btn-primary');
  sortNewestBtn.classList.add('btn-outline-secondary');
  loadPostsForTag(); 
});

sortNewestBtn.addEventListener('click', () => { 
  viewMode = 'newest'; 
  sortNewestBtn.classList.remove('btn-outline-secondary');
  sortNewestBtn.classList.add('btn-primary');
  sortTrendingBtn.classList.remove('btn-primary');
  sortTrendingBtn.classList.add('btn-outline-primary');
  loadPostsForTag(); 
});

// Real-time posts subscription
const postsRef = collection(db, 'posts');
onSnapshot(query(postsRef, orderBy('createdAt', 'desc')), snap => {
  allPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  // Rebuild hashtag collections
  buildHashtagCollections(allPosts);
  
  // Render trending (14-day window)
  computeTrendingHashtagsRealtime(allPosts);
  
  // Render all hashtags list
  renderAllHashtags();
  
  // Load posts for selected tag if any
  if(selectedTag) loadPostsForTag();
});

/**
 * Build complete hashtag collections (all time)
 */
function buildHashtagCollections(posts) {
  allHashtags.clear();
  
  posts.forEach(p => {
    (p.hashtags || []).forEach(h => {
      const key = h.toLowerCase();
      if(!allHashtags.has(key)) {
        allHashtags.set(key, { tag: h, count: 0, posts: [] });
      }
      const entry = allHashtags.get(key);
      entry.count++;
      entry.posts.push(p);
    });
  });
}

/**
 * Render all hashtags list (right sidebar)
 */
function renderAllHashtags() {
  const items = Array.from(allHashtags.values())
    .sort((a, b) => b.count - a.count);
  
  allHashtagsCount.textContent = items.length;
  
  if(items.length === 0) {
    allHashtagsList.innerHTML = '<div class="empty-state"><i class="bi bi-hash"></i><div>Chưa có hashtag nào</div></div>';
    return;
  }
  
  let html = '';
  items.forEach(it => {
    html += `
      <div class="all-hashtag-item" data-tag="${esc(it.tag)}">
        <a class="hashtag-btn" href="tag.html?tag=${encodeURIComponent(it.tag)}">${esc(it.tag)}</a>
        <span class="badge">${it.count}</span>
      </div>
    `;
  });
  
  allHashtagsList.innerHTML = html;
  
  // Add click handlers
  allHashtagsList.querySelectorAll('.all-hashtag-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if(e.target.tagName.toLowerCase() !== 'a') {
        const tag = item.dataset.tag;
        window.location.href = `tag.html?tag=${encodeURIComponent(tag)}`;
      }
    });
  });
}

/**
 * Compute trending hashtags (14-day window) for leaderboard
 */
function computeTrendingHashtagsRealtime(posts) {
  const now = Date.now();
  const windowDays = 14;
  const tagMap = new Map();
  
  posts.forEach(p => {
    const created = p.createdAt?.toMillis ? p.createdAt.toMillis() : 0;
    const daysAgo = created ? Math.max(0, (now - created) / (1000 * 60 * 60 * 24)) : 365;
    
    // Only include posts within 14-day window for trending
    if(daysAgo > windowDays) return;
    
    const likes = p.likes || 0;
    const comments = p.commentsCount || 0;
    const freshness = Math.max(0, windowDays - daysAgo);
    const postScore = likes * 1 + comments * 2 + freshness * 3;
    
    (p.hashtags || []).forEach(h => {
      const key = h.toLowerCase();
      const existing = tagMap.get(key) || { tag: h, count: 0, score: 0 };
      existing.count += 1;
      existing.score += postScore;
      tagMap.set(key, existing);
    });
  });
  
  const items = Array.from(tagMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  
  if(items.length === 0) {
    hashtagLeaderboard.innerHTML = '<div class="empty-state"><i class="bi bi-graph-up"></i><div>Chưa có hashtag thịnh hành (14 ngày)</div></div>';
    return;
  }
  
  let html = '';
  items.forEach(it => {
    html += `
      <div class="leaderboard-item">
        <a class="hashtag-btn" href="tag.html?tag=${encodeURIComponent(it.tag)}">${esc(it.tag)}</a>
        <div class="small-muted">${it.count} bài</div>
      </div>
    `;
  });
  
  hashtagLeaderboard.innerHTML = html;
}

/**
 * Load and display posts for selected tag
 */
function loadPostsForTag() {
  postsList.innerHTML = '<div class="text-center text-muted py-4">Đang tải...</div>';
  
  if(!selectedTag) {
    postsList.innerHTML = '<div class="text-center text-muted py-4">Chọn hashtag từ bảng bên phải.</div>';
    return;
  }
  
  // Filter posts by selected tag
  const filteredPosts = allPosts.filter(p => 
    (p.hashtags || []).some(h => h.toLowerCase() === selectedTag.toLowerCase())
  );
  
  if(filteredPosts.length === 0) {
    postsList.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><div>Chưa có bài viết cho ${esc(selectedTag)}</div></div>`;
    return;
  }
  
  // Sort based on view mode
  const sortedPosts = sortPosts(filteredPosts, viewMode);
  
  // Render posts
  renderPosts(sortedPosts);
  
  // Update count
  const activeTagCountEl = document.getElementById('activeTagCount');
  if(activeTagCountEl) activeTagCountEl.textContent = `${sortedPosts.length} bài`;
}

/**
 * Sort posts by mode
 */
function sortPosts(posts, mode) {
  const now = Date.now();
  
  if(mode === 'trending') {
    // Trending: likes + comments + freshness
    return [...posts].sort((a, b) => {
      const scoreA = calculateTrendingScore(a, now);
      const scoreB = calculateTrendingScore(b, now);
      return scoreB - scoreA;
    });
  } else {
    // Newest: by createdAt desc
    return [...posts].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return timeB - timeA;
    });
  }
}

/**
 * Calculate trending score for a post
 */
function calculateTrendingScore(post, now) {
  const likes = post.likes || 0;
  const comments = post.commentsCount || 0;
  const created = post.createdAt?.toMillis ? post.createdAt.toMillis() : 0;
  const daysAgo = created ? Math.max(0, (now - created) / (1000 * 60 * 60 * 24)) : 365;
  const freshness = Math.max(0, 14 - daysAgo);
  
  return likes * 1 + comments * 2 + freshness * 3;
}

/**
 * Render posts list
 */
function renderPosts(posts) {
  let html = '';
  
  posts.forEach(p => {
    const plain = DOMPurify.sanitize(p.content || '', { ALLOWED_TAGS: [] });
    const snippet = plain.length > 220 ? plain.slice(0, 220) + '…' : plain;
    
    html += `
      <div class="mb-3 p-3 border rounded card">
        <div class="d-flex justify-content-between">
          <div>
            <div class="fw-bold">${esc(p.title || '(Không tiêu đề)')}</div>
            <div class="small-muted">${esc(p.displayName || '')}</div>
          </div>
          <div class="text-end small-muted">
            <div><i class="bi bi-hand-thumbs-up"></i> ${p.likes || 0}</div>
            <div><i class="bi bi-chat"></i> ${p.commentsCount || 0}</div>
          </div>
        </div>
        <div class="mt-2 snippet">${esc(snippet)}</div>
        <div class="mt-2">
          <small class="small-muted"><i class="bi bi-clock"></i> ${fmtDate(p.createdAt)}</small>
        </div>
        <div class="mt-2 text-end">
          <a class="btn btn-sm btn-outline-primary btn-rounded" href="post.html?id=${p.id}">
            <i class="bi bi-box-arrow-up-right"></i> Xem bài
          </a>
        </div>
      </div>
    `;
  });
  
  postsList.innerHTML = html;
}

/**
 * Search functionality
 */
let searchTimeout = null;

tagSearchInput.addEventListener('input', (e) => {
  const keyword = e.target.value.trim();
  
  // Show/hide clear button
  clearSearchBtn.style.display = keyword ? 'block' : 'none';
  
  if(!keyword) {
    tagSearchResults.style.display = 'none';
    return;
  }
  
  // Debounce search
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(keyword), 300);
});

clearSearchBtn.addEventListener('click', () => {
  tagSearchInput.value = '';
  clearSearchBtn.style.display = 'none';
  tagSearchResults.style.display = 'none';
});

/**
 * Perform search across hashtags and posts
 */
function performSearch(keyword) {
  const kw = keyword.toLowerCase();
  
  // Search hashtags
  const matchingHashtags = Array.from(allHashtags.values())
    .filter(h => h.tag.toLowerCase().includes(kw))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Search posts (title + content)
  const matchingPosts = allPosts
    .filter(p => {
      const titleMatch = (p.title || '').toLowerCase().includes(kw);
      const contentMatch = (p.content || '').toLowerCase().includes(kw);
      const authorMatch = (p.displayName || '').toLowerCase().includes(kw);
      return titleMatch || contentMatch || authorMatch;
    })
    .slice(0, 10);
  
  // Render search results
  let html = '';
  
  if(matchingHashtags.length > 0) {
    html += '<div class="mb-2"><small class="small-muted fw-bold">HASHTAGS</small></div>';
    matchingHashtags.forEach(h => {
      html += `
        <div class="search-result-item search-result-hashtag" data-type="hashtag" data-tag="${esc(h.tag)}">
          <div>
            <i class="bi bi-hash text-primary"></i>
            <span class="fw-bold">${esc(h.tag)}</span>
          </div>
          <small class="small-muted">${h.count} bài</small>
        </div>
      `;
    });
    html += '<hr>';
  }
  
  if(matchingPosts.length > 0) {
    html += '<div class="mb-2"><small class="small-muted fw-bold">BÀI VIẾT</small></div>';
    matchingPosts.forEach(p => {
      html += `
        <div class="search-result-item" data-type="post" data-id="${p.id}">
          <div class="fw-bold">${esc(p.title || '(Không tiêu đề)')}</div>
          <small class="small-muted">
            ${esc(p.displayName || '')} · 
            <i class="bi bi-hand-thumbs-up"></i> ${p.likes || 0} · 
            <i class="bi bi-chat"></i> ${p.commentsCount || 0}
          </small>
        </div>
      `;
    });
  }
  
  if(!html) {
    html = '<div class="text-center text-muted py-3">Không tìm thấy kết quả</div>';
  }
  
  tagSearchResults.innerHTML = html;
  tagSearchResults.style.display = 'block';
  
  // Add click handlers
  tagSearchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      
      if(type === 'hashtag') {
        const tag = item.dataset.tag;
        window.location.href = `tag.html?tag=${encodeURIComponent(tag)}`;
      } else if(type === 'post') {
        const id = item.dataset.id;
        window.location.href = `post.html?id=${id}`;
      }
    });
  });
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
  if(!tagSearchInput.contains(e.target) && !tagSearchResults.contains(e.target)) {
    tagSearchResults.style.display = 'none';
  }
});

// Initial load
(async () => {
  try {
    const snaps = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')));
    allPosts = snaps.docs.map(s => ({ id: s.id, ...s.data() }));
    
    buildHashtagCollections(allPosts);
    computeTrendingHashtagsRealtime(allPosts);
    renderAllHashtags();
    
    if(selectedTag) loadPostsForTag();
  } catch(err) {
    console.error('Initial load error:', err);
    postsList.innerHTML = '<div class="text-center text-danger py-4">Lỗi khi tải dữ liệu. Vui lòng thử lại.</div>';
  }
})();