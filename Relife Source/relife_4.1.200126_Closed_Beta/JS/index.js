// JS/index.js - Relife 3.1 Synchronized COMPLETE
// ✅ All features from POST.js integrated
// ✅ Infinite scroll, Search with history, Follow, Reply, Edit, Delete, Report, Mentions

import { initFirebase } from '../firebase-config.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, increment, getDocs, getDoc, where, setDoc, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Initialize
const db = initFirebase();
const auth = getAuth();

// Quill editor (link-only mode)
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: [
      [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link', 'video', 'code-block'], // Only links, no image/video upload
      ['clean']
    ]
  },
  placeholder: 'Nhập link ảnh/video thay vì upload trực tiếp...'
});

// Utilities
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
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
  } catch { return ''; } 
};
const parseHashtagsInput = v => v ? v.split(/[, ]+/).map(s => s.trim()).filter(Boolean).map(s => s.startsWith('#') ? s : '#' + s) : [];

// DOM refs
const feed = document.getElementById('feed');
const menuAuthArea = document.getElementById('menuAuthArea');
const newPostUserInfo = document.getElementById('newPostUserInfo');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const loadingIndicator = document.getElementById('loadingIndicator');

// State
let currentUserProfile = null;
let currentUser = null;
let allPosts = [];
let displayedPosts = new Set();
let isLoadingMore = false;
let hasMorePosts = true;
const POSTS_PER_PAGE = 10;

// Comments state
let currentCommentsPostId = null;
let commentsUnsub = null;
let currentReplyTo = null;
let currentReportCommentId = null;
let currentEditingCommentId = null;

// Search history
const MAX_SEARCH_HISTORY = 5;

function getAvatar(profile, fallback) {
  return profile?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallback || 'U')}&background=0D6EFD&color=fff&size=128`;
}

function navigateToProfile(userId) {
  if(!userId) return;
  window.location.href = `profile.html?user=${userId}`;
}
window.navigateToProfile = navigateToProfile;

// ═══════════════════════════════════════════════════════════
// AUTH STATE
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    const udoc = await getDoc(doc(db, 'users', user.uid));
    currentUserProfile = udoc.exists() ? udoc.data() : null;
    renderMenuLoggedIn(user, currentUserProfile);
    renderNewPostUser(user, currentUserProfile);
    document.getElementById('myProfileMenuLink').href = `profile.html?user=${encodeURIComponent(user.uid)}`;
  } else {
    currentUserProfile = null;
    renderMenuLoggedOut();
    renderNewPostUser(null, null);
    document.getElementById('myProfileMenuLink').href = `profile.html`;
  }
});

function renderMenuLoggedOut() {
  menuAuthArea.innerHTML = `
    <div class="d-grid gap-2">
      <button id="openRegister" class="btn btn-outline-primary btn-rounded">
        <i class="bi bi-person-plus me-2"></i>Đăng ký
      </button>
      <button id="openLogin" class="btn btn-primary btn-rounded">
        <i class="bi bi-box-arrow-in-right me-2"></i>Đăng nhập
      </button>
    </div>
  `;
  document.getElementById('openRegister').onclick = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).show();
  document.getElementById('openLogin').onclick = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
}

function renderMenuLoggedIn(user, profile) {
  const avatar = getAvatar(profile, profile?.displayName || user.email);
  const disp = profile?.displayName || user.displayName || user.email;
  menuAuthArea.innerHTML = `
    <div class="d-flex gap-2 align-items-center p-3 bg-light rounded">
      <img src="${avatar}" class="user-avatar" alt="avatar" style="cursor:pointer;" onclick="window.navigateToProfile('${user.uid}')">
      <div class="flex-fill">
        <div class="fw-bold">${esc(disp)}</div>
        <div class="small-muted">${esc(user.email)}</div>
      </div>
    </div>
    <div class="mt-3">
      <button id="btnLogout" class="btn btn-outline-danger w-100 btn-rounded">
        <i class="bi bi-box-arrow-right me-2"></i>Đăng xuất
      </button>
    </div>
  `;
  document.getElementById('btnLogout').onclick = async () => { 
    await signOut(auth); 
    bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('menuCanvas')).hide(); 
  };
}

function renderNewPostUser(user, profile) {
  if (user && profile) {
    newPostUserInfo.innerHTML = `
      <div class="d-flex gap-2 align-items-center p-2 bg-light rounded">
        <img src="${getAvatar(profile, profile.displayName)}" class="user-avatar">
        <div>
          <div class="fw-bold">${esc(profile.displayName)}</div>
          <div class="small-muted">${esc(profile.email)}</div>
        </div>
      </div>
    `;
  } else {
    newPostUserInfo.innerHTML = `<div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>Đăng nhập để đăng bài với tài khoản của bạn</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// FEED: INFINITE SCROLL + REALTIME
// ═══════════════════════════════════════════════════════════
let feedUnsub = null;

function initFeed() {
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
  if(feedUnsub) feedUnsub();
  
  feedUnsub = onSnapshot(q, snapshot => {
    allPosts = snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
    
    // Update existing posts (counters)
    snapshot.docChanges().forEach(change => {
      if(change.type === 'modified') {
        updatePostInFeed(change.doc.id, change.doc.data());
      }
    });
    
    if(displayedPosts.size === 0) loadMorePosts();
  });
}

function updatePostInFeed(postId, data) {
  const postCard = document.querySelector(`[data-post-id="${postId}"]`);
  if(!postCard) return;
  
  const likeCount = postCard.querySelector('.like-count');
  const dislikeCount = postCard.querySelector('.dislike-count');
  const commentCount = postCard.querySelector('.comment-count');
  
  if(likeCount) likeCount.textContent = data.likes || 0;
  if(dislikeCount) dislikeCount.textContent = data.dislikes || 0;
  if(commentCount) commentCount.textContent = data.commentsCount || 0;
}

async function loadMorePosts() {
  if(isLoadingMore || !hasMorePosts) return;
  
  isLoadingMore = true;
  loadingIndicator.classList.add('show');
  
  try {
    const postsToDisplay = allPosts.filter(p => !displayedPosts.has(p.id)).slice(0, POSTS_PER_PAGE);
    if(postsToDisplay.length === 0) {
      hasMorePosts = false;
      loadingIndicator.classList.remove('show');
      return;
    }
    
    for(const post of postsToDisplay) {
      await renderPost(post);
      displayedPosts.add(post.id);
    }
    
    if(postsToDisplay.length < POSTS_PER_PAGE) hasMorePosts = false;
  } catch(err) {
    console.error('Load more error:', err);
  } finally {
    isLoadingMore = false;
    loadingIndicator.classList.remove('show');
  }
}

async function renderPost(d) {
  const id = d.id;
  let authorAvatar = '', authorHtml = '', followBtnHtml = '';
  
  if(d.userId) {
    const userSnap = await getDoc(doc(db, 'users', d.userId));
    const prof = userSnap.exists() ? userSnap.data() : null;
    authorAvatar = getAvatar(prof, prof?.displayName || d.displayName);
    const tag = prof?.tagName || d.authorTag || '';
    const isAuthor = currentUser && currentUser.uid === d.userId;
    
    if(currentUser && !isAuthor) {
      const isFollowing = await checkFollowStatus(d.userId);
      followBtnHtml = `<button class="post-follow-btn ${isFollowing ? 'following' : ''}" onclick="window.toggleFollowFromFeed('${d.userId}', this)"><i class="bi bi-${isFollowing ? 'check-lg' : 'person-plus-fill'}"></i><span>${isFollowing ? 'Đang theo dõi' : 'Theo dõi'}</span></button>`;
    }
    
    // ✅ FIX: Tên và tag trong cùng phạm vi avatar (vertical stack)
    authorHtml = `
      <div class="post-header">
        <img src="${authorAvatar}" class="post-author-avatar" alt="avatar" onclick="window.navigateToProfile('${d.userId}')">
        <div class="post-author-info">
          <div class="post-author-name" onclick="window.navigateToProfile('${d.userId}')">${esc(d.displayName || prof?.displayName || 'Người dùng')}</div>
          ${tag ? `<div class="post-author-tag" onclick="window.navigateToProfile('${d.userId}')">${esc(tag)}</div>` : ''}
        </div>
        ${followBtnHtml}
      </div>
    `;
  } else {
    authorAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(d.displayName||'T')}&background=FFC107&color=000&size=128`;
    authorHtml = `
      <div class="post-header">
        <img src="${authorAvatar}" class="post-author-avatar" alt="avatar">
        <div class="post-author-info">
          <div class="post-author-name">${esc(d.displayName || 'Tài khoản thử nghiệm')}</div>
          <span class="badge-trial">Tài khoản thử nghiệm</span>
        </div>
      </div>
    `;
  }
  
  const hashtagsHtml = (d.hashtags || []).map(h => `<a href="tag.html?tag=${encodeURIComponent(h)}" class="hashtag">${esc(h)}</a>`).join(' ');
  
  // ✅ FIX: Get accurate comment count using subcollection size
  let commentCount = 0;
  try {
    const commentsSnap = await getDocs(collection(db, 'posts', id, 'comments'));
    commentCount = commentsSnap.size;
  } catch(e) {
    console.warn('Failed to get comment count for post', id, e);
  }
  
  const card = document.createElement('div');
  card.className = 'card card-post p-3';
  card.setAttribute('data-post-id', id);
  card.style.animation = 'fadeInUp 0.3s ease';
  card.innerHTML = `
    ${authorHtml}
    <div class="d-flex justify-content-between align-items-start mb-2">
      <div class="flex-fill">
        <div class="fw-bold">${esc(d.title || '')}</div>
        <div class="small-muted">${fmtDate(d.createdAt)}</div>
      </div>
    </div>
    <div class="mt-2">${hashtagsHtml}</div>
    <div class="d-flex gap-2 mt-3">
      <button class="btn btn-sm btn-outline-primary btn-rounded btn-like" data-id="${id}"><i class="bi bi-hand-thumbs-up"></i> <span class="like-count">${d.likes || 0}</span></button>
      <button class="btn btn-sm btn-outline-danger btn-rounded btn-dislike" data-id="${id}"><i class="bi bi-hand-thumbs-down"></i> <span class="dislike-count">${d.dislikes || 0}</span></button>
      <button class="btn btn-sm btn-outline-secondary btn-rounded btn-comment" data-id="${id}"><i class="bi bi-chat"></i> <span class="comment-count">${commentCount}</span></button>
      <a href="post.html?id=${encodeURIComponent(id)}" class="btn btn-sm btn-outline-success btn-rounded ms-auto"><i class="bi bi-box-arrow-up-right"></i> Xem</a>
    </div>
  `;
  
  card.querySelector('.btn-like').onclick = e => toggleReaction(id, 'like', card);
  card.querySelector('.btn-dislike').onclick = e => toggleReaction(id, 'dislike', card);
  card.querySelector('.btn-comment').onclick = async e => await openCommentsModal(id, d.title);
  
  feed.appendChild(card);
}

// Infinite scroll
let scrollTimeout = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    if(window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !isLoadingMore && hasMorePosts) {
      loadMorePosts();
    }
  }, 100);
});

// ═══════════════════════════════════════════════════════════
// FOLLOW
// ═══════════════════════════════════════════════════════════
async function checkFollowStatus(authorUserId) {
  if(!currentUser || currentUser.uid === authorUserId) return false;
  try {
    const followDoc = await getDoc(doc(db, 'users', currentUser.uid, 'following', authorUserId));
    return followDoc.exists();
  } catch(e) { return false; }
}

async function toggleFollow(targetUserId, btnElement) {
  if(!currentUser) {
    alert('Bạn cần đăng nhập để theo dõi.');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
    return;
  }
  
  if(currentUser.uid === targetUserId) {
    alert('Bạn không thể theo dõi chính mình.');
    return;
  }
  
  if(btnElement) btnElement.disabled = true;
  
  try {
    const isFollowing = await checkFollowStatus(targetUserId);
    const currentUserDoc = await getDoc(doc(db, 'users', currentUser.uid));
    const targetUserDoc = await getDoc(doc(db, 'users', targetUserId));
    const currentProfile = currentUserDoc.exists() ? currentUserDoc.data() : {};
    const targetProfile = targetUserDoc.exists() ? targetUserDoc.data() : {};
    
    if(!isFollowing) {
      await setDoc(doc(db, 'users', targetUserId, 'followers', currentUser.uid), {
        userId: currentUser.uid,
        displayName: currentProfile.displayName || currentUser.email,
        tagName: currentProfile.tagName || null,
        avatarUrl: currentProfile.avatarUrl || null,
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, 'users', currentUser.uid, 'following', targetUserId), {
        userId: targetUserId,
        displayName: targetProfile.displayName || 'User',
        avatarUrl: targetProfile.avatarUrl || null,
        createdAt: serverTimestamp()
      });
      if(btnElement) {
        btnElement.classList.add('following');
        btnElement.innerHTML = '<i class="bi bi-check-lg"></i><span>Đang theo dõi</span>';
      }
    } else {
      await deleteDoc(doc(db, 'users', targetUserId, 'followers', currentUser.uid));
      await deleteDoc(doc(db, 'users', currentUser.uid, 'following', targetUserId));
      if(btnElement) {
        btnElement.classList.remove('following');
        btnElement.innerHTML = '<i class="bi bi-person-plus-fill"></i><span>Theo dõi</span>';
      }
    }
  } catch(err) {
    console.error('Follow error:', err);
    alert('Không thể thực hiện.');
  } finally {
    if(btnElement) btnElement.disabled = false;
  }
}
window.toggleFollowFromFeed = toggleFollow;

// ═══════════════════════════════════════════════════════════
// REACTIONS
// ═══════════════════════════════════════════════════════════
async function toggleReaction(postId, reaction, cardEl) {
  if(!currentUser) {
    alert('Bạn cần đăng nhập để Like/Dislike.');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
    return;
  }
  
  const likeDocRef = doc(db, 'posts', postId, 'likes', currentUser.uid);
  const postRef = doc(db, 'posts', postId);
  const likeSnap = await getDoc(likeDocRef);
  const batch = writeBatch(db);
  
  if(!likeSnap.exists()) {
    batch.set(likeDocRef, { userId: currentUser.uid, type: reaction, createdAt: serverTimestamp() });
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
  
  const likeBtn = cardEl.querySelector('.btn-like');
  const disBtn = cardEl.querySelector('.btn-dislike');
  if(likeBtn) likeBtn.disabled = true;
  if(disBtn) disBtn.disabled = true;
  
  try {
    await batch.commit();
  } catch(err) {
    console.error('Reaction failed', err);
    alert('Không thể cập nhật phản hồi.');
  } finally {
    if(likeBtn) likeBtn.disabled = false;
    if(disBtn) disBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
// COMMENTS MODAL (Full sync from POST)
// ═══════════════════════════════════════════════════════════
async function openCommentsModal(postId, title) {
  currentCommentsPostId = postId;
  document.getElementById('commentsModalTitle').innerHTML = `<i class="bi bi-chat-dots-fill me-2"></i>Bình luận — ${esc(title || '')}`;
  
  if(!currentUser) {
    document.getElementById('mustLoginToComment').style.display = 'block';
    document.getElementById('commentBoxArea').style.display = 'none';
    document.getElementById('openLoginFromComment').onclick = e => { e.preventDefault(); bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show(); };
  } else {
    document.getElementById('mustLoginToComment').style.display = 'none';
    document.getElementById('commentBoxArea').style.display = 'block';
    const udoc = await getDoc(doc(db, 'users', currentUser.uid));
    const prof = udoc.exists() ? udoc.data() : null;
    document.getElementById('commenterInfo').innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${getAvatar(prof, prof?.displayName || currentUser.email)}" class="user-avatar" onclick="window.navigateToProfile('${currentUser.uid}')"><div><div class="fw-bold">${esc(prof?.displayName || currentUser.email)}</div></div></div>`;
    setupMentionAutocomplete(document.getElementById('commentText'));
  }
  
  subscribeToComments(postId);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('commentsModal')).show();
}

function subscribeToComments(postId) {
  if(commentsUnsub) commentsUnsub();
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'));
  commentsUnsub = onSnapshot(q, snap => renderComments(snap, postId));
}

async function renderComments(snapshot, postId) {
  const list = document.getElementById('commentsList');
  list.innerHTML = '';
  
  if(snapshot.empty) {
    list.innerHTML = '<div class="text-center text-muted py-3">Chưa có bình luận</div>';
    return;
  }
  
  const postSnap = await getDoc(doc(db, 'posts', postId));
  const postAuthorId = postSnap.exists() ? postSnap.data().userId : null;
  
  const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const replyMap = new Map();
  const topLevelComments = [];
  
  comments.forEach(c => {
    if(c.replyTo) {
      if(!replyMap.has(c.replyTo)) replyMap.set(c.replyTo, []);
      replyMap.get(c.replyTo).push(c);
    } else {
      topLevelComments.push(c);
    }
  });
  
  topLevelComments.forEach(c => renderCommentWithReplies(list, c, 0, replyMap, postAuthorId));
}

function renderCommentWithReplies(container, comment, depth, replyMap, postAuthorId) {
  const replies = replyMap.get(comment.id) || [];
  const hasReplies = replies.length > 0;
  
  const commentEl = renderCommentElement(comment, depth, hasReplies, replies.length, postAuthorId);
  container.appendChild(commentEl);
  
  if(hasReplies) {
    const repliesContainer = document.createElement('div');
    repliesContainer.className = 'relife-replies-container';
    repliesContainer.id = `replies-${comment.id}`;
    repliesContainer.style.display = 'none';
    replies.forEach(reply => renderCommentWithReplies(repliesContainer, reply, depth + 1, replyMap, postAuthorId));
    container.appendChild(repliesContainer);
  }
}

function renderCommentElement(comment, depth, hasReplies, replyCount, postAuthorId) {
  const avatar = getAvatar(null, comment.displayName);
  const isOwnComment = currentUser && comment.userId === currentUser.uid;
  const isAuthor = comment.userId === postAuthorId;
  const reportCount = comment.reportCount || 0;
  const isReported = reportCount >= 3;
  const isReply = depth > 0;
  const replyLevelClass = isReply ? `reply reply-level-${Math.min(depth, 5)}` : '';
  const reportedClass = isReported ? ' reported' : '';
  
  let replyToHtml = '';
  if(comment.replyTo && comment.replyToName) {
    replyToHtml = `<div class="reply-to-badge" onclick="window.scrollToComment('${comment.replyTo}')"><i class="bi bi-reply-fill"></i><span>Phản hồi ${esc(comment.replyToName)}</span></div>`;
  }
  
  const displayText = parseMentions(comment.text, comment.mentions || []);
  
  let editedBadge = '';
  if(comment.editedAt) {
    editedBadge = `<span class="edited-badge"><i class="bi bi-pencil-fill"></i><span>Đã chỉnh sửa</span></span>`;
  }
  
  let reportBadge = '';
  if(isReported) {
    reportBadge = `<span class="report-badge"><i class="bi bi-flag-fill"></i><span>${reportCount} báo cáo</span></span>`;
  }
  
  let actionsHtml = `<div class="comment-actions"><button class="comment-action-btn" onclick="window.setReplyTo('${comment.id}', '${esc(comment.displayName)}')"><i class="bi bi-reply-fill"></i><span>Trả lời</span></button>`;
  
  if(isOwnComment) {
    actionsHtml += `<button class="comment-action-btn" onclick="window.editComment('${comment.id}')"><i class="bi bi-pencil-fill"></i><span>Sửa</span></button><button class="comment-action-btn delete" onclick="window.deleteComment('${comment.id}')"><i class="bi bi-trash-fill"></i><span>Xóa</span></button>`;
  } else {
    actionsHtml += `<button class="comment-action-btn delete" onclick="window.openReportModal('${comment.id}')"><i class="bi bi-flag-fill"></i><span>Báo cáo</span></button>`;
  }
  actionsHtml += '</div>';
  
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
        <div><span class="comment-name" onclick="window.navigateToProfile('${comment.userId}')">${esc(comment.displayName||'Ẩn danh')}</span>${isAuthor ? '<span class="author-badge"><i class="bi bi-patch-check-fill"></i> Tác giả</span>' : ''}${editedBadge}${reportBadge}</div>
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

function parseMentions(text, mentionedUserIds) {
  if(!mentionedUserIds || mentionedUserIds.length === 0) return esc(text);
  let result = esc(text);
  const mentionRegex = /@(\w+)/g;
  result = result.replace(mentionRegex, (match, tagName) => `<span class="mention" onclick="window.navigateToMention('@${esc(tagName)}')">${match}</span>`);
  return result;
}

window.navigateToMention = async function(tagName) {
  try {
    const q = query(collection(db, 'users'), where('tagName', '==', tagName));
    const snapshot = await getDocs(q);
    if(!snapshot.empty) navigateToProfile(snapshot.docs[0].id);
    else alert('Không tìm thấy người dùng.');
  } catch(err) {
    console.error(err);
  }
};

window.scrollToComment = function(commentId) {
  const commentEl = document.getElementById(`comment-${commentId}`);
  if(!commentEl) return;
  
  let parentContainer = commentEl.closest('.relife-replies-container');
  while(parentContainer) {
    const parentCommentId = parentContainer.id.replace('replies-', '');
    const toggleBtn = document.getElementById(`toggle-${parentCommentId}`);
    
    if(parentContainer.style.display === 'none') {
      parentContainer.style.display = 'block';
      if(toggleBtn) {
        toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i><span>Ẩn phản hồi</span>';
        toggleBtn.classList.add('expanded');
      }
    }
    parentContainer = parentContainer.parentElement?.closest('.relife-replies-container');
  }
  
  commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  commentEl.classList.add('highlight');
  setTimeout(() => commentEl.classList.remove('highlight'), 2000);
};

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

window.setReplyTo = function(commentId, displayName) {
  if(!currentUser) {
    alert('Bạn cần đăng nhập để trả lời bình luận.');
    return;
  }
  currentReplyTo = { id: commentId, name: displayName };
  document.getElementById('replyToName').textContent = `Đang trả lời ${displayName}`;
  document.getElementById('replyIndicator').style.display = 'flex';
  document.getElementById('commentText').focus();
};

document.getElementById('cancelReply').onclick = () => {
  currentReplyTo = null;
  document.getElementById('replyIndicator').style.display = 'none';
};

window.deleteComment = async function(commentId) {
  if(!currentUser) {
    alert('Bạn cần đăng nhập.');
    return;
  }
  
  if(!confirm('Bạn có chắc muốn xóa bình luận này?\n(Tất cả phản hồi cũng sẽ bị xóa)')) return;
  
  try {
    const commentsRef = collection(db, 'posts', currentCommentsPostId, 'comments');
    const allCommentsSnap = await getDocs(commentsRef);
    const allComments = allCommentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const findAllReplies = (parentId, commentsList) => {
      const directReplies = commentsList.filter(c => c.replyTo === parentId);
      let allReplies = [...directReplies];
      directReplies.forEach(reply => {
        allReplies = allReplies.concat(findAllReplies(reply.id, commentsList));
      });
      return allReplies;
    };
    
    const targetComment = allComments.find(c => c.id === commentId);
    if(!targetComment || targetComment.userId !== currentUser.uid) {
      alert('Bạn chỉ có thể xóa bình luận của mình.');
      return;
    }
    
    const repliesToDelete = findAllReplies(commentId, allComments);
    const batch = writeBatch(db);
    
    batch.delete(doc(db, 'posts', currentCommentsPostId, 'comments', commentId));
    repliesToDelete.forEach(reply => {
      batch.delete(doc(db, 'posts', currentCommentsPostId, 'comments', reply.id));
    });
    
    await batch.commit();
  } catch(err) {
    console.error('Delete comment error:', err);
    alert('Không thể xóa bình luận.');
  }
};

window.editComment = async function(commentId) {
  const commentEl = document.getElementById(`comment-${commentId}`);
  if(!commentEl) return;
  
  const commentData = JSON.parse(commentEl.getAttribute('data-comment-data'));
  const originalText = commentData.text;
  
  if(currentEditingCommentId === commentId) return;
  if(currentEditingCommentId) {
    const prevEditForm = document.getElementById(`edit-form-${currentEditingCommentId}`);
    if(prevEditForm) prevEditForm.remove();
  }
  
  currentEditingCommentId = commentId;
  
  const editForm = document.createElement('div');
  editForm.id = `edit-form-${commentId}`;
  editForm.className = 'edit-comment-form';
  editForm.innerHTML = `
    <textarea class="edit-textarea" id="edit-textarea-${commentId}" placeholder="Nhập @username để gắn tag...">${esc(originalText)}</textarea>
    <div class="edit-buttons">
      <button class="btn-save" onclick="window.saveEdit('${commentId}')"><i class="bi bi-check-lg"></i> Lưu</button>
      <button class="btn-cancel" onclick="window.cancelEdit('${commentId}')">Hủy</button>
    </div>
  `;
  
  const commentText = commentEl.querySelector('.comment-text');
  commentText.after(editForm);
  
  const textarea = document.getElementById(`edit-textarea-${commentId}`);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
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
    const mentions = extractMentions(newText);
    const mentionedUserIds = await resolveMentions(mentions);
    
    await updateDoc(doc(db, 'posts', currentCommentsPostId, 'comments', commentId), {
      text: newText,
      mentions: mentionedUserIds,
      editedAt: serverTimestamp(),
      editCount: increment(1)
    });
    
    window.cancelEdit(commentId);
  } catch(err) {
    console.error('Edit comment error:', err);
    alert('Không thể cập nhật bình luận.');
  }
};

function extractMentions(text) {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while((match = mentionRegex.exec(text)) !== null) {
    mentions.push('@' + match[1]);
  }
  return [...new Set(mentions)];
}

async function resolveMentions(mentions) {
  if(mentions.length === 0) return [];
  const userIds = [];
  for(const tagName of mentions) {
    try {
      const q = query(collection(db, 'users'), where('tagName', '==', tagName));
      const snapshot = await getDocs(q);
      if(!snapshot.empty) userIds.push(snapshot.docs[0].id);
    } catch(err) {
      console.error('Resolve mention error:', err);
    }
  }
  return userIds;
}

function setupMentionAutocomplete(textarea) {
  const dropdown = document.getElementById('mentionDropdown');
  let currentQuery = '';
  
  textarea.addEventListener('input', async (e) => {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtPos = textBeforeCursor.lastIndexOf('@');
    
    if(lastAtPos === -1) {
      dropdown.classList.remove('show');
      return;
    }
    
    const queryText = textBeforeCursor.substring(lastAtPos + 1);
    if(queryText.includes(' ')) {
      dropdown.classList.remove('show');
      return;
    }
    
    currentQuery = queryText.toLowerCase();
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
      const avatar = getAvatar(user, user.displayName);
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
  if(!currentReportCommentId || !currentUser) {
    alert('Bạn cần đăng nhập để báo cáo.');
    return;
  }
  
  const reasonRadio = document.querySelector('input[name="reportReason"]:checked');
  let reason = reasonRadio ? reasonRadio.value : 'other';
  reason = reason.toLowerCase();
  
  try {
    const reportRef = doc(db, 'posts', currentCommentsPostId, 'comments', currentReportCommentId, 'reports', currentUser.uid);
    const reportDoc = await getDoc(reportRef);
    
    if(reportDoc.exists()) {
      alert('Bạn đã báo cáo bình luận này rồi.');
      window.closeReportModal();
      return;
    }
    
    const batch = writeBatch(db);
    batch.set(reportRef, {
      userId: currentUser.uid,
      reason: reason,
      createdAt: serverTimestamp()
    });
    
    const commentRef = doc(db, 'posts', currentCommentsPostId, 'comments', currentReportCommentId);
    batch.set(commentRef, { reportCount: increment(1) }, { merge: true });
    
    await batch.commit();
    alert('Đã gửi báo cáo. Cảm ơn bạn!');
    window.closeReportModal();
  } catch(err) {
    console.error('Report error:', err);
    alert('Không thể gửi báo cáo.');
  }
};

document.getElementById('reportOverlay').onclick = window.closeReportModal;

document.getElementById('postCommentBtn').onclick = async () => {
  const text = document.getElementById('commentText').value.trim();
  if(!text) return alert('Viết bình luận trước khi gửi.');
  if(!currentUser) return alert('Bạn cần đăng nhập.');
  
  try {
    const udoc = await getDoc(doc(db, 'users', currentUser.uid));
    const prof = udoc.exists() ? udoc.data() : null;
    
    const mentions = extractMentions(text);
    const mentionedUserIds = await resolveMentions(mentions);
    
    const commentData = {
      displayName: prof?.displayName || currentUser.email,
      userId: currentUser.uid,
      text,
      createdAt: serverTimestamp(),
      mentions: mentionedUserIds,
      reportCount: 0
    };
    
    if(currentReplyTo) {
      commentData.replyTo = currentReplyTo.id;
      commentData.replyToName = currentReplyTo.name;
    }
    
    await addDoc(collection(db, 'posts', currentCommentsPostId, 'comments'), commentData);
    document.getElementById('commentText').value = '';
    currentReplyTo = null;
    document.getElementById('replyIndicator').style.display = 'none';
  } catch(err) {
    console.error('Comment error:', err);
    alert('Không thể gửi bình luận.');
  }
};

// ═══════════════════════════════════════════════════════════
// SEARCH WITH HISTORY
// ═══════════════════════════════════════════════════════════
let searchTimer = 0;
searchInput.addEventListener('input', () => { 
  clearTimeout(searchTimer); 
  searchTimer = setTimeout(handleSearchInput, 220); 
});

async function handleSearchInput() {
  const kw = searchInput.value.trim().toLowerCase();
  if(!kw) { 
    searchResults.style.display = 'none'; 
    return; 
  }
  
  await ensureCaches();
  
  // Search history
  let html = '';
  const history = await loadSearchHistory();
  if(history.length > 0) {
    html += '<div class="search-category-header">LỊCH SỬ TÌM KIẾM</div>';
    history.forEach(item => {
      html += `<div class="search-history-item" data-term="${esc(item.term)}"><i class="bi bi-clock-history search-history-icon"></i><span class="search-history-text">${esc(item.term)}</span><button class="search-history-remove" onclick="window.removeSearchHistory('${esc(item.term)}', event)"><i class="bi bi-x-lg"></i></button></div>`;
    });
    html += '<div class="search-category-divider"></div>';
  }
  
  // Search users
  const usersSnap = await getDocs(collection(db, 'users'));
  const users = [];
  usersSnap.forEach(doc => {
    const data = doc.data();
    const nameMatch = (data.displayName || '').toLowerCase().includes(kw);
    const tagMatch = (data.tagName || '').toLowerCase().includes(kw);
    if(nameMatch || tagMatch) users.push({ id: doc.id, ...data });
  });
  
  if(users.length > 0) {
    html += '<div class="search-category-header">NGƯỜI DÙNG</div>';
    for(const u of users.slice(0, 6)) {
      const avatar = getAvatar(u, u.displayName);
      const isFollowing = await checkFollowStatus(u.id);
      const followBtnHtml = currentUser && currentUser.uid !== u.id 
        ? `<button class="search-follow-btn ${isFollowing ? 'following' : ''}" onclick="window.toggleFollowFromSearch('${u.id}', this, event)"><i class="bi bi-${isFollowing ? 'check-lg' : 'person-plus-fill'}"></i><span>${isFollowing ? 'Theo dõi' : 'Theo dõi'}</span></button>`
        : '';
      html += `<div class="search-user-item" data-user="${u.id}"><img src="${avatar}" class="search-user-avatar" alt="avatar"><div class="search-user-info"><div class="search-user-name">${esc(u.displayName || u.email)}</div><div class="search-user-tag">${esc(u.tagName || '')}</div></div>${followBtnHtml}</div>`;
    }
    html += '<div class="search-category-divider"></div>';
  }
  
  // Search posts
  const posts = allPosts.filter(p => {
    const titleMatch = (p.title || '').toLowerCase().includes(kw);
    const contentMatch = (p.content || '').toLowerCase().includes(kw);
    const authorMatch = (p.displayName || '').toLowerCase().includes(kw);
    const hashtagMatch = (p.hashtags || []).some(h => h.toLowerCase().includes(kw));
    return titleMatch || contentMatch || authorMatch || hashtagMatch;
  });
  
  if(posts.length > 0) {
    html += '<div class="search-category-header">BÀI VIẾT</div>';
    posts.slice(0, 8).forEach(p => {
      html += `<div class="search-result-item post-result" data-post="${p.id}"><div class="fw-bold">${esc(p.title || '(Không tiêu đề)')}</div><small class="small-muted">${esc(p.displayName || '')} · <i class="bi bi-hand-thumbs-up"></i> ${p.likes || 0} · <i class="bi bi-chat"></i> ${p.commentsCount || 0}</small></div>`;
    });
  }
  
  if(!html) html = `<div class="text-center text-muted py-3">Không tìm thấy</div>`;
  
  searchResults.innerHTML = html;
  searchResults.style.display = 'block';
  
  // Bind events
  searchResults.querySelectorAll('.search-history-item').forEach(item => {
    item.onclick = async (e) => {
      if(e.target.closest('.search-history-remove')) return;
      const term = item.dataset.term;
      searchInput.value = term;
      await saveSearchHistory(term);
      handleSearchInput();
    };
  });
  
  searchResults.querySelectorAll('.search-user-item').forEach(item => {
    item.onclick = async (e) => {
      if(e.target.closest('.search-follow-btn')) return;
      const uid = item.dataset.user;
      await saveSearchHistory(searchInput.value);
      navigateToProfile(uid);
    };
  });
  
  searchResults.querySelectorAll('.post-result').forEach(item => {
    item.onclick = async () => {
      const pid = item.dataset.post;
      await saveSearchHistory(searchInput.value);
      window.location.href = `post.html?id=${pid}`;
    };
  });
}

let cachedUsers = null;
async function ensureCaches() {
  if(!cachedUsers) {
    const us = await getDocs(query(collection(db, 'users')));
    cachedUsers = us.docs.map(s => ({ id: s.id, ...s.data() }));
  }
}

async function loadSearchHistory() {
  if(!currentUser) return [];
  try {
    const historyRef = doc(db, 'users', currentUser.uid, 'searchHistory', 'history');
    const historySnap = await getDoc(historyRef);
    if(historySnap.exists()) {
      return historySnap.data().items || [];
    }
  } catch(e) {
    console.error('Load history error:', e);
  }
  return [];
}

async function saveSearchHistory(term) {
  if(!currentUser || !term) return;
  try {
    let history = await loadSearchHistory();
    history = history.filter(item => item.term !== term);
    history.unshift({ term, timestamp: Date.now() });
    history = history.slice(0, MAX_SEARCH_HISTORY);
    
    const historyRef = doc(db, 'users', currentUser.uid, 'searchHistory', 'history');
    await setDoc(historyRef, { items: history }, { merge: true });
  } catch(e) {
    console.error('Save history error:', e);
  }
}

window.removeSearchHistory = async function(term, event) {
  event.stopPropagation();
  if(!currentUser) return;
  try {
    let history = await loadSearchHistory();
    history = history.filter(item => item.term !== term);
    const historyRef = doc(db, 'users', currentUser.uid, 'searchHistory', 'history');
    await setDoc(historyRef, { items: history }, { merge: true });
    handleSearchInput();
  } catch(e) {
    console.error('Remove history error:', e);
  }
};

window.toggleFollowFromSearch = async function(targetUserId, btnElement, event) {
  event.stopPropagation();
  await toggleFollow(targetUserId, btnElement);
};

document.addEventListener('click', e => { 
  if(!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
    searchResults.style.display = 'none'; 
  }
});

// ═══════════════════════════════════════════════════════════
// NEW POST
// ═══════════════════════════════════════════════════════════
document.getElementById('newPostForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const title = document.getElementById('postTitle').value.trim();
  if (!title) return alert('Cần có tiêu đề');
  const hashtags = parseHashtagsInput(document.getElementById('postHashtags').value);
  const contentHTML = quill.root.innerHTML;
  
  if (currentUser && currentUserProfile) {
    await addDoc(collection(db, 'posts'), { 
      displayName: currentUserProfile.displayName || currentUser.email, 
      title, 
      content: contentHTML, 
      hashtags, 
      likes: 0, 
      dislikes: 0, 
      commentsCount: 0, 
      createdAt: serverTimestamp(), 
      userId: currentUser.uid, 
      authorTag: currentUserProfile.tagName || null 
    });
  } else {
    alert('Bạn cần đăng nhập để đăng bài.');
    return;
  }
  
  document.getElementById('postTitle').value = '';
  document.getElementById('postHashtags').value = '';
  quill.root.innerHTML = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('newPostModal')).hide();
});

// ═══════════════════════════════════════════════════════════
// REGISTER & LOGIN
// ═══════════════════════════════════════════════════════════
document.getElementById('registerForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const fullName = document.getElementById('regFullName').value.trim();
  const displayName = document.getElementById('regDisplayName').value.trim();
  let tagName = document.getElementById('regTagName').value.trim();
  const gender = document.getElementById('regGender').value || '';
  const birthday = document.getElementById('regBirthday').value || '';
  const country = document.getElementById('regCountry').value.trim() || '';
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!tagName.startsWith('@')) tagName = '@' + tagName;
  
  try {
    const existing = await getDocs(query(collection(db, 'users'), where('tagName', '==', tagName)));
    if (!existing.empty) { alert('Tag Name đã tồn tại.'); return; }
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    await setDoc(doc(db, 'users', uid), { 
      fullName, displayName, tagName, gender, birthday, country, email, 
      avatarUrl: null, activated: false, createdAt: serverTimestamp() 
    });
    await signOut(auth);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).hide();
    alert('Đăng ký thành công. Chờ admin gửi mã kích hoạt.');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
  } catch (err) {
    console.error(err);
    alert('Lỗi đăng ký: ' + (err.message || err));
  }
});

document.getElementById('loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const u = cred.user;
    const udoc = await getDoc(doc(db, 'users', u.uid));
    const profile = udoc.exists() ? udoc.data() : null;
    
    if (profile && profile.activated) {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).hide();
    } else {
      document.getElementById('activateBlock').style.display = 'block';
      const code = prompt('Tài khoản chưa kích hoạt. Nhập mã kích hoạt:');
      if (code) {
        const userRef = doc(db, 'users', u.uid);
        const uSnap = await getDoc(userRef);
        if (uSnap.exists() && uSnap.data().activationCode === code) {
          await updateDoc(userRef, { activated: true });
          alert('Kích hoạt thành công.');
          bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).hide();
        } else {
          alert('Mã kích hoạt sai.');
          await signOut(auth);
        }
      } else {
        await signOut(auth);
      }
    }
  } catch (err) {
    console.error(err);
    alert('Lỗi đăng nhập: ' + (err.message || err));
  }
});

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
initFeed();