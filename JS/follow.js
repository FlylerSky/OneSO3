// JS/follow.js - Relife Follow & Friends Page
// Full implementation with friend detection and post filtering

import { initFirebase } from '../firebase-config.js';
import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  collection,
  query,
  orderBy,
  getDocs,
  getDoc,
  doc,
  where,
  deleteDoc,
  onSnapshot,
  limit,
  startAfter
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Initialize
const db = initFirebase();
const auth = getAuth();

// DOM refs
const tabFollowing = document.getElementById('tabFollowing');
const tabFriends = document.getElementById('tabFriends');
const followingCount = document.getElementById('followingCount');
const friendsCount = document.getElementById('friendsCount');
const userSectionLabel = document.getElementById('userSectionLabel');
const postsSectionLabel = document.getElementById('postsSectionLabel');
const toggleViewBtn = document.getElementById('toggleViewBtn');
const userListHorizontal = document.getElementById('userListHorizontal');
const userGrid = document.getElementById('userGrid');
const postsList = document.getElementById('postsList');
const filterBadge = document.getElementById('filterBadge');
const filterUserName = document.getElementById('filterUserName');
const clearFilterBtn = document.getElementById('clearFilterBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const floatingActions = document.getElementById('floatingActions');
const fabScrollToUsers = document.getElementById('fabScrollToUsers');
const mainHeader = document.getElementById('mainHeader');
const bottomTabBar = document.getElementById('bottomTabBar');
const userSection = document.getElementById('userSection');

// Utilities
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

function getAvatar(profile, fallback) {
  return profile?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallback || 'U')}&background=0D6EFD&color=fff&size=128`;
}

function navigateToProfile(userId) {
  if (!userId) return;
  window.location.href = `profile.html?user=${userId}`;
}
window.navigateToProfile = navigateToProfile;

// State
let currentUser = null;
let currentTab = 'following'; // 'following' or 'friends'
let isGridView = false;
let followingList = [];
let friendsList = [];
let selectedUserId = null;
let allPosts = [];
let displayedPosts = [];
let lastVisiblePost = null;
let isLoadingMore = false;
let hasMorePosts = true;
const POSTS_PER_PAGE = 10;

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    showEmptyState('login');
    return;
  }
  await loadData();
});

// ═══════════════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════════════
async function loadData() {
  if (!currentUser) return;

  try {
    // Load following list
    const followingSnap = await getDocs(
      collection(db, 'users', currentUser.uid, 'following')
    );

    followingList = [];
    const followingPromises = followingSnap.docs.map(async docSnap => {
      const followingData = docSnap.data();
      const userId = followingData.userId || docSnap.id;

      // Get user profile
      const userDoc = await getDoc(doc(db, 'users', userId));
      const profile = userDoc.exists() ? userDoc.data() : null;

      // Check if this is a friend (mutual follow)
      const isFriend = await checkIfFriend(userId);

      return {
        id: userId,
        displayName: profile?.displayName || followingData.displayName || 'User',
        tagName: profile?.tagName || followingData.tagName || '',
        avatarUrl: getAvatar(profile, profile?.displayName || 'User'),
        isFriend
      };
    });

    followingList = await Promise.all(followingPromises);
    friendsList = followingList.filter(user => user.isFriend);

    // Update counts
    followingCount.textContent = followingList.length;
    friendsCount.textContent = friendsList.length;

    // ALWAYS render users first (regardless of posts)
    renderUsers();

    // Then load posts
    await loadPosts();

  } catch (err) {
    console.error('Load data error:', err);
    showError('Không thể tải dữ liệu. Vui lòng thử lại.');
  }
}

// ═══════════════════════════════════════════════════════════
// CHECK IF FRIEND
// ═══════════════════════════════════════════════════════════
async function checkIfFriend(userId) {
  if (!currentUser) return false;
  try {
    const followerDoc = await getDoc(
      doc(db, 'users', userId, 'following', currentUser.uid)
    );
    return followerDoc.exists();
  } catch (err) {
    console.error('Check friend error:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER USERS
// ═══════════════════════════════════════════════════════════
function renderUsers() {
  const users = currentTab === 'following' ? followingList : friendsList;

  // Clear both containers
  userListHorizontal.innerHTML = '';
  userGrid.innerHTML = '';

  if (users.length === 0) {
    const emptyMsg = currentTab === 'following' 
      ? '<div class="relife-empty-state"><i class="bi bi-people"></i><h5>Chưa theo dõi ai</h5><p>Hãy bắt đầu theo dõi những người bạn quan tâm.</p></div>'
      : '<div class="relife-empty-state"><i class="bi bi-emoji-frown"></i><h5>Chưa có bạn bè</h5><p>Bạn bè là những người theo dõi lẫn nhau.</p></div>';
    
    userListHorizontal.innerHTML = emptyMsg;
    userGrid.innerHTML = emptyMsg;
    return;
  }

  const fragment = document.createDocumentFragment();

  users.forEach((user, index) => {
    const card = createUserCard(user, index);
    fragment.appendChild(card);
  });

  if (isGridView) {
    userGrid.appendChild(fragment);
  } else {
    userListHorizontal.appendChild(fragment);
  }
}

function createUserCard(user, index) {
  const card = document.createElement('div');
  card.className = 'relife-user-card';
  card.style.animationDelay = `${index * 0.05}s`;
  if (selectedUserId === user.id) card.classList.add('selected');

  card.innerHTML = `
    ${user.isFriend ? '<div class="relife-friend-badge"><i class="bi bi-stars"></i><span>Bạn bè</span></div>' : ''}
    <img src="${user.avatarUrl}" class="relife-user-avatar" alt="avatar" onclick="window.navigateToProfile('${user.id}')">
    <div class="relife-user-info">
      <div class="relife-user-name">${esc(user.displayName)}</div>
      <div class="relife-user-tag">${esc(user.tagName)}</div>
    </div>
    <button class="relife-unfollow-btn" data-user-id="${user.id}">
      <i class="bi bi-person-dash-fill"></i>
      <span>Bỏ theo dõi</span>
    </button>
  `;

  // Click to filter posts
  card.addEventListener('click', (e) => {
    if (e.target.closest('.relife-unfollow-btn') || e.target.closest('.relife-user-avatar')) return;
    filterPostsByUser(user);
  });

  // Unfollow button
  const unfollowBtn = card.querySelector('.relife-unfollow-btn');
  unfollowBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    unfollowUser(user.id);
  });

  return card;
}

// ═══════════════════════════════════════════════════════════
// FILTER POSTS BY USER
// ═══════════════════════════════════════════════════════════
function filterPostsByUser(user) {
  selectedUserId = user.id;
  filterUserName.textContent = user.displayName;
  filterBadge.style.display = 'flex';

  // Update UI
  document.querySelectorAll('.relife-user-card').forEach(card => {
    card.classList.remove('selected');
  });
  event.currentTarget.classList.add('selected');

  // Reload posts
  loadPosts();
}

clearFilterBtn.addEventListener('click', () => {
  selectedUserId = null;
  filterBadge.style.display = 'none';
  document.querySelectorAll('.relife-user-card').forEach(card => {
    card.classList.remove('selected');
  });
  loadPosts();
});

// ═══════════════════════════════════════════════════════════
// LOAD POSTS
// ═══════════════════════════════════════════════════════════
async function loadPosts() {
  if (!currentUser) return;

  postsList.innerHTML = '<div class="relife-loading"><div class="relife-spinner"></div><div>Đang tải bài viết...</div></div>';
  displayedPosts = [];
  lastVisiblePost = null;
  hasMorePosts = true;

  try {
    const users = currentTab === 'following' ? followingList : friendsList;
    if (users.length === 0) {
      showEmptyState('no-posts');
      return;
    }

    // Get user IDs to query
    let userIds = selectedUserId
      ? [selectedUserId]
      : users.map(u => u.id);

    // Firestore 'in' query limit is 10
    if (userIds.length > 10 && !selectedUserId) {
      userIds = userIds.slice(0, 10);
      console.warn('Limited to 10 users for Firestore query');
    }

    if (userIds.length === 0) {
      showEmptyState('no-posts');
      return;
    }

    // Query posts
    const postsRef = collection(db, 'posts');
    const q = query(
      postsRef,
      where('userId', 'in', userIds),
      orderBy('createdAt', 'desc'),
      limit(POSTS_PER_PAGE)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showEmptyState('no-posts');
      return;
    }

    allPosts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _doc: doc
    }));

    lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
    hasMorePosts = snapshot.docs.length === POSTS_PER_PAGE;

    renderPosts(allPosts);

  } catch (err) {
    console.error('Load posts error:', err);
    showError('Không thể tải bài viết. Vui lòng thử lại.');
  }
}

async function loadMorePosts() {
  if (!currentUser || isLoadingMore || !hasMorePosts || !lastVisiblePost) return;

  isLoadingMore = true;
  loadingIndicator.style.display = 'flex';

  try {
    const users = currentTab === 'following' ? followingList : friendsList;
    let userIds = selectedUserId
      ? [selectedUserId]
      : users.map(u => u.id);

    if (userIds.length > 10 && !selectedUserId) {
      userIds = userIds.slice(0, 10);
    }

    const postsRef = collection(db, 'posts');
    const q = query(
      postsRef,
      where('userId', 'in', userIds),
      orderBy('createdAt', 'desc'),
      startAfter(lastVisiblePost),
      limit(POSTS_PER_PAGE)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      hasMorePosts = false;
      loadingIndicator.style.display = 'none';
      return;
    }

    const newPosts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      _doc: doc
    }));

    allPosts = [...allPosts, ...newPosts];
    lastVisiblePost = snapshot.docs[snapshot.docs.length - 1];
    hasMorePosts = snapshot.docs.length === POSTS_PER_PAGE;

    renderPosts(newPosts, true);

  } catch (err) {
    console.error('Load more error:', err);
  } finally {
    isLoadingMore = false;
    loadingIndicator.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
// RENDER POSTS
// ═══════════════════════════════════════════════════════════
function renderPosts(posts, append = false) {
  const fragment = document.createDocumentFragment();

  posts.forEach((post, index) => {
    const card = createPostCard(post, index);
    fragment.appendChild(card);
    displayedPosts.push(post.id);
  });

  if (append) {
    postsList.appendChild(fragment);
  } else {
    postsList.innerHTML = '';
    postsList.appendChild(fragment);
  }
}

function createPostCard(post, index) {
  const card = document.createElement('div');
  card.className = 'relife-post-card';
  card.style.animationDelay = `${index * 0.05}s`;

  // Find user info
  const users = currentTab === 'following' ? followingList : friendsList;
  const author = users.find(u => u.id === post.userId) || {
    displayName: post.displayName || 'User',
    tagName: post.authorTag || '',
    avatarUrl: getAvatar(null, post.displayName)
  };

  const hashtagsHtml = (post.hashtags || []).map(h =>
    `<a href="tag.html?tag=${encodeURIComponent(h)}" class="relife-hashtag">
      <i class="bi bi-hash"></i>${esc(h.replace(/^#/, ''))}
    </a>`
  ).join('');

  // Check if user has liked/disliked (you can track this in state if needed)
  const hasLiked = false; // TODO: implement like tracking
  const hasDisliked = false; // TODO: implement dislike tracking

  card.innerHTML = `
    <div class="relife-post-header">
      <img src="${author.avatarUrl}" class="relife-post-avatar" alt="avatar" onclick="window.navigateToProfile('${post.userId}')">
      <div class="relife-post-author-info">
        <div class="relife-post-author-name" onclick="window.navigateToProfile('${post.userId}')">
          ${esc(author.displayName)}
          ${author.isFriend ? '<span class="relife-post-verified-badge"><i class="bi bi-check-lg"></i></span>' : ''}
        </div>
        ${author.tagName ? `<div class="relife-post-author-tag" onclick="window.navigateToProfile('${post.userId}')">${esc(author.tagName)}</div>` : ''}
      </div>
      <div class="relife-post-time">
        <i class="bi bi-clock"></i>
        <span>${fmtDate(post.createdAt)}</span>
      </div>
    </div>
    
    <div class="relife-post-content">
      <div class="relife-post-title">${esc(post.title || 'Không có tiêu đề')}</div>
      ${hashtagsHtml ? `<div class="relife-post-hashtags">${hashtagsHtml}</div>` : ''}
    </div>
    
    <div class="relife-post-actions">
      <button class="relife-action-btn ${hasLiked ? 'liked' : ''}" data-action="like" data-post-id="${post.id}">
        <i class="bi bi-hand-thumbs-up-fill"></i>
        <span>${post.likes || 0}</span>
      </button>
      <button class="relife-action-btn ${hasDisliked ? 'disliked' : ''}" data-action="dislike" data-post-id="${post.id}">
        <i class="bi bi-hand-thumbs-down-fill"></i>
        <span>${post.dislikes || 0}</span>
      </button>
      <button class="relife-action-btn" data-action="comment" data-post-id="${post.id}">
        <i class="bi bi-chat-fill"></i>
        <span>${post.commentsCount || 0}</span>
      </button>
      <a href="post.html?id=${post.id}" class="relife-view-post-btn">
        <span>Xem chi tiết</span>
        <i class="bi bi-arrow-right"></i>
      </a>
    </div>
  `;

  // Add event listeners for action buttons
  const likeBtn = card.querySelector('[data-action="like"]');
  const dislikeBtn = card.querySelector('[data-action="dislike"]');
  const commentBtn = card.querySelector('[data-action="comment"]');

  likeBtn.addEventListener('click', () => handlePostAction('like', post.id));
  dislikeBtn.addEventListener('click', () => handlePostAction('dislike', post.id));
  commentBtn.addEventListener('click', () => {
    window.location.href = `post.html?id=${post.id}#comments`;
  });

  return card;
}

// Handle post actions (like, dislike)
async function handlePostAction(action, postId) {
  if (!currentUser) {
    alert('Bạn cần đăng nhập để thực hiện hành động này');
    return;
  }

  try {
    // TODO: Implement actual like/dislike logic with Firebase
    console.log(`${action} post ${postId}`);
    // For now, just navigate to post detail
    window.location.href = `post.html?id=${postId}`;
  } catch (err) {
    console.error('Action error:', err);
  }
}

// ═══════════════════════════════════════════════════════════
// UNFOLLOW USER
// ═══════════════════════════════════════════════════════════
async function unfollowUser(userId) {
  if (!currentUser) return;

  if (!confirm('Bạn có chắc muốn bỏ theo dõi người này?')) return;

  try {
    // Delete both documents
    await deleteDoc(doc(db, 'users', currentUser.uid, 'following', userId));
    await deleteDoc(doc(db, 'users', userId, 'followers', currentUser.uid));

    // Reload data
    await loadData();

  } catch (err) {
    console.error('Unfollow error:', err);
    alert('Không thể bỏ theo dõi. Vui lòng thử lại.');
  }
}

// ═══════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════
tabFollowing.addEventListener('click', () => {
  if (currentTab === 'following') return;
  currentTab = 'following';
  updateTabUI();
  selectedUserId = null;
  filterBadge.style.display = 'none';
  renderUsers();
  loadPosts();
});

tabFriends.addEventListener('click', () => {
  if (currentTab === 'friends') return;
  currentTab = 'friends';
  updateTabUI();
  selectedUserId = null;
  filterBadge.style.display = 'none';
  renderUsers();
  loadPosts();
});

function updateTabUI() {
  // Update bottom tab bar
  const allTabs = document.querySelectorAll('.relife-bottom-tab');
  allTabs.forEach(tab => tab.classList.remove('active'));
  
  if (currentTab === 'following') {
    tabFollowing.classList.add('active');
    userSectionLabel.textContent = 'Danh sách theo dõi';
    postsSectionLabel.textContent = 'Bài viết từ người bạn theo dõi';
  } else {
    tabFriends.classList.add('active');
    userSectionLabel.textContent = 'Danh sách bạn bè';
    postsSectionLabel.textContent = 'Bài viết từ bạn bè';
  }
}

// ═══════════════════════════════════════════════════════════
// VIEW TOGGLE
// ═══════════════════════════════════════════════════════════
toggleViewBtn.addEventListener('click', () => {
  isGridView = !isGridView;

  if (isGridView) {
    userListHorizontal.style.display = 'none';
    userGrid.style.display = 'grid';
    toggleViewBtn.classList.add('active');
    toggleViewBtn.innerHTML = '<i class="bi bi-list-ul"></i><span>Danh sách</span>';
  } else {
    userGrid.style.display = 'none';
    userListHorizontal.style.display = 'flex';
    toggleViewBtn.classList.remove('active');
    toggleViewBtn.innerHTML = '<i class="bi bi-grid-3x3-gap-fill"></i><span>Chỉ user</span>';
  }

  // Re-render users in new view mode
  renderUsers();
});

// ═══════════════════════════════════════════════════════════
// SCROLL HANDLING
// ═══════════════════════════════════════════════════════════
let lastScrollTop = 0;
let scrollTimeout;
let isScrollingDown = false;

window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(handleScroll, 50);
}, { passive: true });

function handleScroll() {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';

  // Detect scroll direction
  if (scrollTop > lastScrollTop && scrollTop > 100) {
    // Scrolling down - hide header and tab bar
    if (!isScrollingDown) {
      mainHeader.classList.add('scrolled-down');
      bottomTabBar.classList.add('scrolled-down');
      isScrollingDown = true;
    }
  } else if (scrollTop < lastScrollTop) {
    // Scrolling up - show header and tab bar
    if (isScrollingDown) {
      mainHeader.classList.remove('scrolled-down');
      bottomTabBar.classList.remove('scrolled-down');
      isScrollingDown = false;
    }
  }

  // Show floating action button when scrolled down
  if (isScrollingDown && scrollTop > 200) {
    floatingActions.style.display = 'block';
  } else {
    floatingActions.style.display = 'none';
  }

  // Infinite scroll for posts
  if (window.innerHeight + scrollTop >= document.body.offsetHeight - 500) {
    loadMorePosts();
  }

  lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
}

// Scroll to users section
fabScrollToUsers.addEventListener('click', () => {
  userSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  
  // Show header and tab bar after scroll
  setTimeout(() => {
    mainHeader.classList.remove('scrolled-down');
    bottomTabBar.classList.remove('scrolled-down');
    isScrollingDown = false;
  }, 500);
});

// ═══════════════════════════════════════════════════════════
// EMPTY STATES
// ═══════════════════════════════════════════════════════════
function showEmptyState(type) {
  let html = '';

  switch (type) {
    case 'login':
      html = `
        <div class="relife-empty-state">
          <i class="bi bi-person-x"></i>
          <h5>Bạn chưa đăng nhập</h5>
          <p>Vui lòng đăng nhập để xem danh sách theo dõi và bạn bè.</p>
          <a href="index.html" class="relife-empty-state-btn">
            <i class="bi bi-box-arrow-in-right"></i>
            <span>Đăng nhập</span>
          </a>
        </div>
      `;
      postsList.innerHTML = html;
      userListHorizontal.innerHTML = html;
      userGrid.innerHTML = html;
      break;

    case 'no-posts':
      html = `
        <div class="relife-empty-state">
          <i class="bi bi-inbox"></i>
          <h5>Chưa có bài viết</h5>
          <p>Những người bạn ${currentTab === 'friends' ? 'là bạn bè' : 'theo dõi'} chưa đăng bài nào.</p>
        </div>
      `;
      postsList.innerHTML = html;
      break;
  }
}

function showError(message) {
  postsList.innerHTML = `
    <div class="relife-empty-state">
      <i class="bi bi-exclamation-triangle"></i>
      <h5>Lỗi</h5>
      <p>${esc(message)}</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
console.log('Relife Follow & Friends page loaded');