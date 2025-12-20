// JS/index.js (module) - Full file (updated to link display names to profile pages)
// Imports
import { initFirebase } from '../firebase-config.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, increment, getDocs, getDoc, where, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// init
const db = initFirebase();
const auth = getAuth();

// quill
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: [
      [{ 'font': [] }, { 'size': ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ 'color': [] }, { 'background': [] }],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      ['link', 'image', 'video'],
      ['clean']
    ]
  }
});

// utils
const esc = s => String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtDate = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('vi-VN') : ''; } catch { return ''; } };
const parseHashtagsInput = v => v ? v.split(/[, ]+/).map(s => s.trim()).filter(Boolean).map(s => s.startsWith('#') ? s : '#' + s) : [];

// DOM refs
const feed = document.getElementById('feed');
const menuAuthArea = document.getElementById('menuAuthArea');
const newPostUserInfo = document.getElementById('newPostUserInfo');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

// caches & state
let cachedUsers = null;
let cachedPosts = null;
let cachedSearchStats = null;
let currentUserProfile = null;
let currentUser = null;

// Helpers
function getAvatar(profile, fallback) {
  return profile?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(fallback || 'U')}&background=0D6EFD&color=fff&size=128`;
}

// Auth state handling
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (user) {
    const udoc = await getDoc(doc(db, 'users', user.uid));
    currentUserProfile = udoc.exists() ? udoc.data() : null;
    renderMenuLoggedIn(user, currentUserProfile);
    renderNewPostUser(user, currentUserProfile);
    // optionally update profile menu link to point to user's own profile
    const myProfileLink = document.getElementById('myProfileMenuLink');
    if (myProfileLink) myProfileLink.href = `profile.html?user=${encodeURIComponent(user.uid)}`;
  } else {
    currentUserProfile = null;
    renderMenuLoggedOut();
    renderNewPostUser(null, null);
    const myProfileLink = document.getElementById('myProfileMenuLink');
    if (myProfileLink) myProfileLink.href = `profile.html`;
  }
});

function renderMenuLoggedOut() {
  menuAuthArea.innerHTML = `<div class="d-grid gap-2"><button id="openRegister" class="btn btn-outline-primary btn-rounded">Đăng ký</button><button id="openLogin" class="btn btn-primary btn-rounded">Đăng nhập</button></div>`;
  document.getElementById('openRegister').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).show());
  document.getElementById('openLogin').addEventListener('click', () => bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show());
}

function renderMenuLoggedIn(user, profile) {
  const avatar = getAvatar(profile, profile?.displayName || user.email);
  const disp = profile?.displayName || user.displayName || user.email;
  menuAuthArea.innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${avatar}" class="user-avatar" alt="avatar"><div><div class="fw-bold">${esc(disp)}</div><div class="small-muted">${esc(user.email)}</div></div></div><div class="mt-3"><button id="btnLogout" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button></div>`;
  document.getElementById('btnLogout').addEventListener('click', async () => { await signOut(auth); bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('menuCanvas')).hide(); });
}

// new post user area
function renderNewPostUser(user, profile) {
  if (user && profile) {
    newPostUserInfo.innerHTML = `<div class="d-flex gap-2 align-items-center mb-2"><img src="${getAvatar(profile, profile.displayName)}" class="user-avatar"><div><div class="fw-bold">${esc(profile.displayName)}</div><div class="small-muted">${esc(profile.email)}</div></div></div>`;
  } else {
    newPostUserInfo.innerHTML = `<input id="anonDisplayName" class="form-control mb-2" placeholder="Tên hiển thị (nếu muốn) - sẽ là 'Tài khoản thử nghiệm' nếu để trống">`;
  }
}

// Feed realtime (posts)
const postsRef = collection(db, 'posts');
onSnapshot(query(postsRef, orderBy('createdAt', 'desc')), snap => {
  feed.innerHTML = '';
  if (snap.empty) { feed.innerHTML = '<div class="text-center text-muted py-5">Chưa có bài viết nào.</div>'; return; }
  snap.forEach(docSnap => {
    const d = docSnap.data(); const id = docSnap.id;
    const card = document.createElement('div'); card.className = 'card card-post p-3';
    let authorHtml = '';
    if (d.userId) {
      // display name clickable to profile
      authorHtml = `<div class="fw-bold"><a href="profile.html?user=${encodeURIComponent(d.userId)}">${esc(d.displayName || '')}</a></div><div class="small-muted">${esc(d.authorTag || '')}</div>`;
    } else {
      authorHtml = `<div class="fw-bold">${esc(d.displayName || 'Tài khoản thử nghiệm')}</div><div><span class="badge-trial">Tài khoản thử nghiệm</span></div>`;
    }
    const hashtagsHtml = (d.hashtags || []).map(h => `<a href="tag.html?tag=${encodeURIComponent(h)}" class="hashtag">${esc(h)}</a>`).join(' ');
    card.innerHTML = `
      <div class="d-flex justify-content-between">
        <div>${authorHtml}<div class="small-muted">${esc(d.title || '')}</div></div>
        <div class="small-muted">${fmtDate(d.createdAt)}</div>
      </div>
      <div class="mt-2">${hashtagsHtml}</div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn btn-sm btn-outline-primary btn-rounded btn-like" data-id="${id}"><i class="bi bi-hand-thumbs-up"></i> <span class="like-count">${d.likes || 0}</span></button>
        <button class="btn btn-sm btn-outline-danger btn-rounded btn-dislike" data-id="${id}"><i class="bi bi-hand-thumbs-down"></i> <span class="dislike-count">${d.dislikes || 0}</span></button>
        <button class="btn btn-sm btn-outline-secondary btn-rounded btn-comment" data-id="${id}"><i class="bi bi-chat"></i> <span class="comment-count">${d.commentsCount || 0}</span></button>
        <a href="post.html?id=${encodeURIComponent(id)}" class="btn btn-sm btn-outline-success btn-rounded ms-auto"><i class="bi bi-box-arrow-up-right"></i> Xem</a>
      </div>`;
    // events
    card.querySelector('.btn-like').addEventListener('click', e => toggleReaction(id, 'like'));
    card.querySelector('.btn-dislike').addEventListener('click', e => toggleReaction(id, 'dislike'));
    card.querySelector('.btn-comment').addEventListener('click', async e => {
      const pid = e.currentTarget.dataset.id;
      const snap = await getDoc(doc(db, 'posts', pid));
      openCommentsModal(pid, snap.exists() ? snap.data().title : '');
    });
    feed.appendChild(card);
  });
});

// New post submit
document.getElementById('newPostForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const title = document.getElementById('postTitle').value.trim();
  if (!title) return alert('Cần có tiêu đề');
  const hashtags = parseHashtagsInput(document.getElementById('postHashtags').value);
  const contentHTML = quill.root.innerHTML;
  const user = auth.currentUser;
  if (user && currentUserProfile) {
    await addDoc(postsRef, { displayName: currentUserProfile.displayName || user.email, title, content: contentHTML, hashtags, likes: 0, dislikes: 0, commentsCount: 0, createdAt: serverTimestamp(), userId: user.uid, authorTag: currentUserProfile.tagName || null });
  } else {
    const anon = (document.getElementById('anonDisplayName') && document.getElementById('anonDisplayName').value.trim()) || 'Tài khoản thử nghiệm';
    await addDoc(postsRef, { displayName: anon, title, content: contentHTML, hashtags, likes: 0, dislikes: 0, commentsCount: 0, createdAt: serverTimestamp() });
  }
  document.getElementById('postTitle').value = ''; document.getElementById('postHashtags').value = ''; quill.root.innerHTML = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('newPostModal')).hide();
});

// Register
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
    // uniqueness check
    const existing = await getDocs(query(collection(db, 'users'), where('tagName', '==', tagName)));
    if (!existing.empty) { alert('Tag Name đã tồn tại.'); return; }
    const cred = await createUserWithEmailAndPassword(getAuth(), email, password);
    const uid = cred.user.uid;
    await setDoc(doc(db, 'users', uid), { fullName, displayName, tagName, gender, birthday, country, email, avatarUrl: null, activated: false, createdAt: serverTimestamp() });
    await signOut(getAuth());
    bootstrap.Modal.getOrCreateInstance(document.getElementById('registerModal')).hide();
    alert('Đăng ký thành công. Chờ admin gửi mã kích hoạt.');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show();
  } catch (err) {
    console.error(err);
    alert('Lỗi đăng ký: ' + (err.message || err));
  }
});

// Login
document.getElementById('loginForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const cred = await signInWithEmailAndPassword(getAuth(), email, password);
    const u = cred.user;
    const udoc = await getDoc(doc(db, 'users', u.uid));
    const profile = udoc.exists() ? udoc.data() : null;
    if (profile && profile.activated) {
      bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).hide();
    } else {
      document.getElementById('activateBlock').style.display = 'block';
      const code = prompt('Tài khoản chưa kích hoạt. Nhập mã kích hoạt do admin gửi:');
      if (code) {
        const userRef = doc(db, 'users', u.uid);
        const uSnap = await getDoc(userRef);
        if (uSnap.exists() && uSnap.data().activationCode === code) {
          await updateDoc(userRef, { activated: true });
          alert('Kích hoạt thành công.');
          bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).hide();
        } else {
          alert('Mã kích hoạt sai. Liên hệ admin.');
          await signOut(getAuth());
        }
      } else {
        await signOut(getAuth());
      }
    }
  } catch (err) {
    console.error(err);
    alert('Lỗi đăng nhập: ' + (err.message || err) + "\n Lỗi có thể do nhập sai mật khẩu hoặc lỗi hệ thống");
  }
});

// SEARCH logic (client-side caches)
let searchTimer = 0;
searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(handleSearchInput, 220); });

async function ensureCaches() {
  if (!cachedUsers) {
    const us = await getDocs(query(collection(db, 'users')));
    cachedUsers = us.docs.map(s => ({ id: s.id, ...s.data() }));
  }
  if (!cachedPosts) {
    const ps = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')));
    cachedPosts = ps.docs.map(s => ({ id: s.id, ...s.data() }));
  }
  if (!cachedSearchStats) {
    const ss = await getDocs(query(collection(db, 'searchStats')));
    cachedSearchStats = ss.docs.map(s => ({ id: s.id, ...s.data() }));
  }
}

async function handleSearchInput() {
  const kw = searchInput.value.trim().toLowerCase();
  if (!kw) { searchResults.style.display = 'none'; return; }
  await ensureCaches();
  const users = (cachedUsers || []).filter(u => (u.displayName || '').toLowerCase().includes(kw) || (u.tagName || '').toLowerCase().includes(kw));
  const posts = (cachedPosts || []).filter(p => (p.title || '').toLowerCase().includes(kw) || (p.content || '').toLowerCase().includes(kw) || (p.hashtags || []).some(h => h.toLowerCase().includes(kw)));
  const suggestions = (cachedSearchStats || []).filter(s => s.term && s.term.toLowerCase().includes(kw)).slice(0, 8);
  let html = '';
  if (suggestions.length) {
    html += '<div class="mb-2"><small class="small-muted">Gợi ý phổ biến</small></div>';
    suggestions.forEach(s => html += `<div class="search-suggestion" data-term="${esc(s.term)}"><i class="bi bi-star-fill me-2"></i>${esc(s.term)} <small class="small-muted ms-2">(${s.count || 0})</small></div>`);
  }
  if (users.length) {
    html += '<hr><div class="mb-2"><small class="small-muted">Người dùng</small></div>';
    users.slice(0, 6).forEach(u => html += `<div class="p-2 border-bottom user-result" data-user="${u.id}"><i class="bi bi-person-circle me-2"></i>${esc(u.displayName || u.email)} <small class="small-muted ms-2">${esc(u.tagName || '')}</small></div>`);
  }
  if (posts.length) {
    html += '<hr><div class="mb-2"><small class="small-muted">Bài viết</small></div>';
    posts.slice(0, 8).forEach(p => html += `<div class="p-2 border-bottom post-result" data-post="${p.id}">${esc(p.title || '(Không tiêu đề)')} <small class="small-muted ms-2">${esc(p.displayName || '')}</small></div>`);
  }
  if (!html) html = `<div class="p-2 text-muted">Không tìm thấy</div>`;
  searchResults.innerHTML = html;
  searchResults.style.display = 'block';
}

searchResults.addEventListener('click', async ev => {
  const s = ev.target.closest('.search-suggestion'); if (s) { const term = s.dataset.term; searchInput.value = term; await recordSearchTerm(term); handleSearchInput(); return; }
  const ur = ev.target.closest('.user-result'); if (ur) { const uid = ur.dataset.user; window.location.href = `profile.html?user=${encodeURIComponent(uid)}`; return; }
  const pr = ev.target.closest('.post-result'); if (pr) { const pid = pr.dataset.post; await recordSearchTerm(searchInput.value.trim()); window.location.href = `post.html?id=${pid}`; return; }
});

async function recordSearchTerm(term) {
  if (!term) return;
  const id = encodeURIComponent(term.toLowerCase());
  try {
    // merge increment
    await setDoc(doc(db, 'searchStats', id), { term, count: increment(1) }, { merge: true });
    cachedSearchStats = null;
  } catch (e) { console.error('recordSearchTerm error', e); }
}

document.addEventListener('click', e => { if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) searchResults.style.display = 'none'; });

// Comments modal logic
let currentCommentsPostId = null; let commentsUnsub = null;
async function openCommentsModal(pid, title) {
  currentCommentsPostId = pid;
  document.getElementById('commentsModalTitle').textContent = 'Bình luận — ' + (title || '');
  const user = auth.currentUser;
  if (!user) {
    document.getElementById('mustLoginToComment').style.display = 'block';
    document.getElementById('commentBoxArea').style.display = 'none';
    document.getElementById('openLoginFromComment').addEventListener('click', ev => { ev.preventDefault(); bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show(); });
  } else {
    document.getElementById('mustLoginToComment').style.display = 'none';
    document.getElementById('commentBoxArea').style.display = 'block';
    const udoc = await getDoc(doc(db, 'users', user.uid));
    const prof = udoc.exists() ? udoc.data() : null;
    document.getElementById('commenterInfo').innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${getAvatar(prof, prof?.displayName || user.email)}" class="user-avatar"><div><div class="fw-bold">${esc(prof?.displayName || user.email)}</div></div></div>`;
  }
  const commentsList = document.getElementById('commentsList'); commentsList.innerHTML = '<div class="text-muted">Đang tải...</div>';
  if (commentsUnsub) commentsUnsub();
  commentsUnsub = onSnapshot(query(collection(db, 'posts', pid, 'comments'), orderBy('createdAt', 'desc')), snap => {
    commentsList.innerHTML = '';
    if (snap.empty) { commentsList.innerHTML = '<div class="text-muted">Chưa có bình luận nào.</div>'; return; }
    snap.forEach(s => { const c = s.data(); commentsList.innerHTML += `<div class="mb-2"><div class="fw-bold">${esc(c.displayName || '')}</div><div class="small-muted">${fmtDate(c.createdAt)}</div><div class="comment-text">${esc(c.text)}</div><hr></div>`; });
  });
  bootstrap.Modal.getOrCreateInstance(document.getElementById('commentsModal')).show();
}

document.getElementById('postCommentBtn').addEventListener('click', async () => {
  const text = document.getElementById('commentText').value.trim(); if (!text) return alert('Viết bình luận trước khi gửi.');
  const user = auth.currentUser; if (!user) return alert('Bạn cần đăng nhập để bình luận.');
  const udoc = await getDoc(doc(db, 'users', user.uid)); const prof = udoc.exists() ? udoc.data() : null;
  await addDoc(collection(db, 'posts', currentCommentsPostId, 'comments'), { displayName: prof?.displayName || user.email, userId: user.uid, text, createdAt: serverTimestamp() });
  await updateDoc(doc(db, 'posts', currentCommentsPostId), { commentsCount: increment(1) });
  document.getElementById('commentText').value = '';
});

// Reaction (atomic)
async function toggleReaction(postId, reaction) { // 'like' or 'dislike'
  const user = auth.currentUser;
  if (!user) { alert('Bạn cần đăng nhập để tương tác.'); bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).show(); return; }
  const likeDocRef = doc(db, 'posts', postId, 'likes', user.uid);
  const postRef = doc(db, 'posts', postId);
  const likeSnap = await getDoc(likeDocRef);
  const batch = writeBatch(db);
  if (!likeSnap.exists()) {
    batch.set(likeDocRef, { userId: user.uid, type: reaction, createdAt: serverTimestamp() });
    if (reaction === 'like') batch.update(postRef, { likes: increment(1) });
    else batch.update(postRef, { dislikes: increment(1) });
  } else {
    const prev = likeSnap.data().type;
    if (prev === reaction) {
      batch.delete(likeDocRef);
      if (reaction === 'like') batch.update(postRef, { likes: increment(-1) });
      else batch.update(postRef, { dislikes: increment(-1) });
    } else {
      batch.update(likeDocRef, { type: reaction, updatedAt: serverTimestamp() });
      if (reaction === 'like') batch.update(postRef, { likes: increment(1), dislikes: increment(-1) });
      else batch.update(postRef, { dislikes: increment(1), likes: increment(-1) });
    }
  }
  try { await batch.commit(); } catch (err) { console.error('Reaction failed', err); alert('Không thể cập nhật phản hồi — thử lại sau.'); }
}

// initial UI
renderMenuLoggedOut();
renderNewPostUser(null, null);
