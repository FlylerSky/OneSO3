// JS/tag.js - Relife UI 1.1 (Optimized for Performance)
// 60fps smooth experience with minimal animations
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

// Connection status
function updateConn() {
  const isOnline = navigator.onLine;
  const statusDot = statusConn.querySelector('.relife-status-dot');
  const statusText = statusConn.querySelector('.relife-status-text');
  
  if(isOnline) {
    statusConn.style.background = 'rgba(25, 135, 84, 0.1)';
    statusConn.style.color = '#198754';
    statusDot.style.background = '#198754';
    statusText.textContent = 'Online';
  } else {
    statusConn.style.background = 'rgba(220, 53, 69, 0.1)';
    statusConn.style.color = '#dc3545';
    statusDot.style.background = '#dc3545';
    statusText.textContent = 'Offline';
  }
}
window.addEventListener('online', updateConn);
window.addEventListener('offline', updateConn);
updateConn();

// State
let allPosts = [];
let selectedTag = new URLSearchParams(location.search).get('tag');
if(selectedTag) selectedTag = decodeURIComponent(selectedTag);
let viewMode = 'trending';
let allHashtags = new Map();

// Initialize
if(!selectedTag) {
  activeTagTitle.textContent = 'Khám phá';
  const c = document.getElementById('activeTagCount');
  if(c) c.textContent = 'Chọn hashtag để bắt đầu';
} else {
  activeTagTitle.textContent = selectedTag.replace(/^#/, '');
}

// Sort button handlers
sortTrendingBtn.addEventListener('click', () => {
  if(viewMode === 'trending') return;
  viewMode = 'trending';
  sortTrendingBtn.classList.add('active');
  sortNewestBtn.classList.remove('active');
  loadPostsForTag();
});

sortNewestBtn.addEventListener('click', () => {
  if(viewMode === 'newest') return;
  viewMode = 'newest';
  sortNewestBtn.classList.add('active');
  sortTrendingBtn.classList.remove('active');
  loadPostsForTag();
});

// Real-time posts subscription
const postsRef = collection(db, 'posts');
onSnapshot(query(postsRef, orderBy('createdAt', 'desc')), snap => {
  allPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  buildHashtagCollections(allPosts);
  computeTrendingHashtagsRealtime(allPosts);
  renderAllHashtags();
  
  if(selectedTag) loadPostsForTag();
}, err => {
  console.error('Posts subscription error:', err);
  showError('Không thể tải bài viết. Vui lòng thử lại.');
});

/**
 * Build complete hashtag collections
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
 * Render all hashtags list
 */
function renderAllHashtags() {
  const items = Array.from(allHashtags.values())
    .sort((a, b) => b.count - a.count);
  
  allHashtagsCount.textContent = items.length;
  
  if(items.length === 0) {
    allHashtagsList.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-hash"></i>
        <div>Chưa có hashtag nào</div>
      </div>
    `;
    return;
  }
  
  // Performance optimization: use DocumentFragment
  const fragment = document.createDocumentFragment();
  
  items.forEach(it => {
    const div = document.createElement('div');
    div.className = 'all-hashtag-item';
    div.dataset.tag = it.tag;
    div.innerHTML = `
      <a class="hashtag-btn" href="tag.html?tag=${encodeURIComponent(it.tag)}">${esc(it.tag)}</a>
      <span class="badge">${it.count}</span>
    `;
    fragment.appendChild(div);
  });
  
  allHashtagsList.innerHTML = '';
  allHashtagsList.appendChild(fragment);
}

/**
 * Compute trending hashtags
 */
function computeTrendingHashtagsRealtime(posts) {
  const now = Date.now();
  const windowDays = 14;
  const tagMap = new Map();
  
  posts.forEach(p => {
    const created = p.createdAt?.toMillis ? p.createdAt.toMillis() : 0;
    const daysAgo = created ? Math.max(0, (now - created) / (1000 * 60 * 60 * 24)) : 365;
    
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
    hashtagLeaderboard.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-graph-up"></i>
        <div>Chưa có hashtag thịnh hành</div>
      </div>
    `;
    return;
  }
  
  // Performance optimization: use DocumentFragment
  const fragment = document.createDocumentFragment();
  
  items.forEach((it, idx) => {
    const rank = idx + 1;
    const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    const div = document.createElement('div');
    div.className = 'leaderboard-item';
    div.innerHTML = `
      <a class="hashtag-btn" href="tag.html?tag=${encodeURIComponent(it.tag)}">
        ${emoji} ${esc(it.tag)}
      </a>
      <div class="small-muted">${it.count} bài</div>
    `;
    fragment.appendChild(div);
  });
  
  hashtagLeaderboard.innerHTML = '';
  hashtagLeaderboard.appendChild(fragment);
}

/**
 * Load and display posts for selected tag
 */
function loadPostsForTag() {
  showLoading();
  
  if(!selectedTag) {
    postsList.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-inbox"></i>
        <div>Chọn hashtag từ bảng bên phải để xem bài viết</div>
      </div>
    `;
    return;
  }
  
  const filteredPosts = allPosts.filter(p =>
    (p.hashtags || []).some(h => h.toLowerCase() === selectedTag.toLowerCase())
  );
  
  if(filteredPosts.length === 0) {
    postsList.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-inbox"></i>
        <div>Chưa có bài viết cho ${esc(selectedTag)}</div>
      </div>
    `;
    return;
  }
  
  const sortedPosts = sortPosts(filteredPosts, viewMode);
  renderPosts(sortedPosts);
  
  const activeTagCountEl = document.getElementById('activeTagCount');
  if(activeTagCountEl) activeTagCountEl.textContent = `${sortedPosts.length} bài viết`;
}

/**
 * Sort posts by mode
 */
function sortPosts(posts, mode) {
  const now = Date.now();
  
  if(mode === 'trending') {
    return [...posts].sort((a, b) => {
      const scoreA = calculateTrendingScore(a, now);
      const scoreB = calculateTrendingScore(b, now);
      return scoreB - scoreA;
    });
  } else {
    return [...posts].sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return timeB - timeA;
    });
  }
}

/**
 * Calculate trending score
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
 * Render posts (Performance optimized)
 */
function renderPosts(posts) {
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  
  posts.forEach(p => {
    const plain = DOMPurify.sanitize(p.content || '', { ALLOWED_TAGS: [] });
    const snippet = plain.length > 180 ? plain.slice(0, 180) + '…' : plain;
    
    const card = document.createElement('div');
    card.className = 'relife-post-card';
    card.innerHTML = `
      <div class="relife-post-header">
        <div class="relife-post-info">
          <div class="fw-bold">${esc(p.title || '(Không tiêu đề)')}</div>
          <div class="small-muted">
            <i class="bi bi-person-circle"></i> ${esc(p.displayName || 'Ẩn danh')}
          </div>
        </div>
        <div class="relife-post-stats">
          <div><i class="bi bi-hand-thumbs-up-fill"></i> ${p.likes || 0}</div>
          <div><i class="bi bi-chat-fill"></i> ${p.commentsCount || 0}</div>
        </div>
      </div>
      <div class="relife-post-snippet">${esc(snippet)}</div>
      <div class="relife-post-meta">
        <div class="relife-post-time">
          <i class="bi bi-clock"></i>
          <span>${fmtDate(p.createdAt)}</span>
        </div>
        <a class="relife-post-action" href="post.html?id=${p.id}">
          <span>Xem bài</span>
          <i class="bi bi-arrow-right"></i>
        </a>
      </div>
    `;
    fragment.appendChild(card);
  });
  
  postsList.innerHTML = '';
  postsList.appendChild(fragment);
}

/**
 * Show loading state
 */
function showLoading() {
  postsList.innerHTML = `
    <div class="relife-loading">
      <div class="relife-spinner"></div>
      <div>Đang tải bài viết...</div>
    </div>
  `;
}

/**
 * Show error state
 */
function showError(message) {
  postsList.innerHTML = `
    <div class="empty-state">
      <i class="bi bi-exclamation-triangle"></i>
      <div>${esc(message)}</div>
    </div>
  `;
}

/**
 * Search functionality with debounce
 */
let searchTimeout = null;

tagSearchInput.addEventListener('input', (e) => {
  const keyword = e.target.value.trim();
  
  clearSearchBtn.style.display = keyword ? 'block' : 'none';
  
  if(!keyword) {
    tagSearchResults.style.display = 'none';
    return;
  }
  
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(keyword), 300);
});

clearSearchBtn.addEventListener('click', () => {
  tagSearchInput.value = '';
  clearSearchBtn.style.display = 'none';
  tagSearchResults.style.display = 'none';
  tagSearchInput.focus();
});

/**
 * Perform search (Performance optimized)
 */
function performSearch(keyword) {
  const kw = keyword.toLowerCase();
  
  const matchingHashtags = Array.from(allHashtags.values())
    .filter(h => h.tag.toLowerCase().includes(kw))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const matchingPosts = allPosts
    .filter(p => {
      const titleMatch = (p.title || '').toLowerCase().includes(kw);
      const contentMatch = (p.content || '').toLowerCase().includes(kw);
      const authorMatch = (p.displayName || '').toLowerCase().includes(kw);
      return titleMatch || contentMatch || authorMatch;
    })
    .slice(0, 8);
  
  // Use DocumentFragment
  const fragment = document.createDocumentFragment();
  
  if(matchingHashtags.length > 0) {
    const header = document.createElement('div');
    header.className = 'mb-2 px-2';
    header.innerHTML = '<small class="small-muted fw-bold">HASHTAGS</small>';
    fragment.appendChild(header);
    
    matchingHashtags.forEach(h => {
      const div = document.createElement('div');
      div.className = 'search-result-item search-result-hashtag';
      div.dataset.type = 'hashtag';
      div.dataset.tag = h.tag;
      div.innerHTML = `
        <div>
          <i class="bi bi-hash text-primary"></i>
          <span class="fw-bold">${esc(h.tag)}</span>
        </div>
        <small class="small-muted">${h.count} bài</small>
      `;
      fragment.appendChild(div);
    });
    
    if(matchingPosts.length > 0) {
      const hr = document.createElement('hr');
      hr.style.opacity = '0.2';
      fragment.appendChild(hr);
    }
  }
  
  if(matchingPosts.length > 0) {
    const header = document.createElement('div');
    header.className = 'mb-2 px-2';
    header.innerHTML = '<small class="small-muted fw-bold">BÀI VIẾT</small>';
    fragment.appendChild(header);
    
    matchingPosts.forEach(p => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.dataset.type = 'post';
      div.dataset.id = p.id;
      div.innerHTML = `
        <div class="fw-bold">${esc(p.title || '(Không tiêu đề)')}</div>
        <small class="small-muted">
          ${esc(p.displayName || 'Ẩn danh')} · 
          <i class="bi bi-hand-thumbs-up"></i> ${p.likes || 0} · 
          <i class="bi bi-chat"></i> ${p.commentsCount || 0}
        </small>
      `;
      fragment.appendChild(div);
    });
  }
  
  if(matchingHashtags.length === 0 && matchingPosts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.style.padding = '2rem 1rem';
    empty.innerHTML = `
      <i class="bi bi-search" style="font-size: 2rem;"></i>
      <div>Không tìm thấy kết quả</div>
    `;
    fragment.appendChild(empty);
  }
  
  tagSearchResults.innerHTML = '';
  tagSearchResults.appendChild(fragment);
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
  if(!tagSearchInput.contains(e.target) && 
     !tagSearchResults.contains(e.target) && 
     !clearSearchBtn.contains(e.target)) {
    tagSearchResults.style.display = 'none';
  }
});

// Keyboard navigation for search
tagSearchInput.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') {
    tagSearchResults.style.display = 'none';
    tagSearchInput.blur();
  }
});

// Initial load
(async () => {
  try {
    showLoading();
    const snaps = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')));
    allPosts = snaps.docs.map(s => ({ id: s.id, ...s.data() }));
    
    buildHashtagCollections(allPosts);
    computeTrendingHashtagsRealtime(allPosts);
    renderAllHashtags();
    
    if(selectedTag) {
      loadPostsForTag();
    } else {
      postsList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-hash"></i>
          <div>Chọn hashtag để bắt đầu khám phá</div>
        </div>
      `;
    }
  } catch(err) {
    console.error('Initial load error:', err);
    showError('Lỗi khi tải dữ liệu. Vui lòng thử lại.');
  }
})();