// JS/profile.js (module) - Profile (updated)
// - Remove client-side increments for followersCount/followingCount (use subcollection size instead)
// - Store visitor displayName + tagName when visiting
// - Propagate profile changes to posts AND comments authored by the user
// - Keep robust error handling and export functions to window for legacy calls

import { initFirebase } from '../firebase-config.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  collection, query, where, orderBy, onSnapshot, doc, getDoc, getDocs,
  addDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, writeBatch, increment
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const db = initFirebase();
const auth = getAuth();

// DOM refs
const profileArea = document.getElementById('profileArea');
const profileSearchInput = document.getElementById('profileSearchInput');
const profileSearchResults = document.getElementById('profileSearchResults');
const menuToggleBtn = document.getElementById('menuToggleBtn');
const profileMenuCanvas = document.getElementById('profileMenuCanvas');
const menuAuthAreaProfile = document.getElementById('menuAuthAreaProfile');
const openAchievementsBtn = document.getElementById('openAchievementsBtn');
const achievementsContainer = document.getElementById('achievementsContainer');
const openVisitorsBtn = document.getElementById('openVisitorsBtn');
const visitorsListEl = document.getElementById('visitorsList');

const commentsModalEl = document.getElementById('profileCommentsModal');
const commentsModal = new bootstrap.Modal(commentsModalEl);
const loginModalProfile = new bootstrap.Modal(document.getElementById('loginModalProfile'));
const postEditorModalEl = document.getElementById('postEditorModal');
const postEditorModal = new bootstrap.Modal(postEditorModalEl);
const postEditorForm = document.getElementById('postEditorForm');

let quillEditor = null;

// helpers
const esc = s => String(s||'').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('vi-VN') : ''; } catch { return ''; } };

const params = new URLSearchParams(location.search);
let profileUid = params.get('user');
let currentUser = null;
let userDoc = null;

let postsUnsub = null;
let commentsSubsCleanup = null;
let lastPostsDocs = [];

// show loading
function showLoading(){ profileArea.innerHTML = '<div id="profileLoading" class="text-center text-muted py-4">Đang tải...</div>'; }

// quill init
function ensureQuill(){
  if(quillEditor) return;
  quillEditor = new Quill('#editorQuill', {
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
}

// Load profile data
async function loadProfile(uid){
  showLoading();
  // cleanup subs
  if(postsUnsub){ postsUnsub(); postsUnsub = null; }
  if(commentsSubsCleanup){ commentsSubsCleanup(); commentsSubsCleanup = null; }

  try {
    const uRef = doc(db,'users', uid);
    const uSnap = await getDoc(uRef);
    if(!uSnap.exists()){
      profileArea.innerHTML = '<div class="text-center p-4 text-muted">Không tìm thấy người dùng</div>';
      return;
    }
    userDoc = { id: uSnap.id, ...uSnap.data() };
    const isOwner = currentUser && currentUser.uid === uid;
    const avatar = userDoc.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(userDoc.displayName||'U')}&background=0D6EFD&color=fff&size=256`;

    profileArea.innerHTML = `
      <div class="profile-header">
        <img src="${avatar}" alt="avatar" class="profile-avatar">
        <div class="profile-meta">
          <div class="profile-name">
            <div>${esc(userDoc.displayName || '(Không tên)')}</div>
            <div class="profile-tag">${esc(userDoc.tagName || '')}</div>
            <div id="profileActionArea" class="ms-2"></div>
          </div>
          <div class="profile-basic">
            <div>Giới tính: ${esc(userDoc.gender || 'Chưa cập nhật')}</div>
            <div>Ngày sinh: ${esc(userDoc.birthday || 'Chưa cập nhật')}</div>
            <div>Quốc gia: ${esc(userDoc.country || 'Chưa cập nhật')}</div>
            <div id="profileEmailArea">${isOwner?`<div class="small-muted">Email: ${esc(userDoc.email||'')}</div>`:''}</div>
            <div class="follow-stats mt-2">
              <div class="stat">Followers: <span id="followersCount">${userDoc.followersCount||0}</span></div>
              <div class="stat">Following: <span id="followingCount">${userDoc.followingCount||0}</span></div>
            </div>
          </div>
        </div>
      </div>
      ${ userDoc.bio ? `<div class="profile-bio">${esc(userDoc.bio)}</div>` : `<div class="profile-bio text-muted">(Chưa có mô tả)</div>` }
      <div id="editArea" class="profile-edit mt-3" style="display:none;"></div>
      <div class="profile-posts mt-3">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <h6 class="mb-0">Bài viết của ${esc(userDoc.displayName||'')}</h6>
          <div id="ownerControls"></div>
        </div>
        <div id="userPostsList"><div class="text-muted py-3">Đang tải bài viết...</div></div>
      </div>
    `;

    // owner controls & visitors menu visibility
    const ownerControls = document.getElementById('ownerControls');
    if(currentUser && currentUser.uid === uid){
      ownerControls.innerHTML = `<button id="btnAddPost" class="btn btn-sm btn-primary btn-rounded"><i class="bi bi-plus-lg"></i> Thêm bài viết</button>`;
      document.getElementById('btnAddPost').addEventListener('click', openAddPostEditor);
      document.getElementById('openVisitorsBtn').style.display = 'block';
    } else {
      ownerControls.innerHTML = '';
      document.getElementById('openVisitorsBtn').style.display = 'none';
    }

    // render follow action area
    await renderFollowActionArea(uid);

    // render menu
    renderMenuAuthArea();

    // subscribe follower/following counts (we'll also use collection sizes for accurate shown counts)
    subscribeFollowerCounts(uid);

    // record visitor if viewer is logged in and not owner
    if(currentUser && currentUser.uid !== uid){
      try {
        // fetch visitor's profile in users collection to get displayName & tagName if available
        let visitorProfile = null;
        try {
          const vSnap = await getDoc(doc(db,'users',currentUser.uid));
          if(vSnap.exists()) visitorProfile = vSnap.data();
        } catch(e){ /* ignore */ }

        await setDoc(doc(db,'users',uid,'visitors', currentUser.uid), {
          userId: currentUser.uid,
          displayName: (visitorProfile && visitorProfile.displayName) ? visitorProfile.displayName : (currentUser.displayName || null),
          tagName: (visitorProfile && visitorProfile.tagName) ? visitorProfile.tagName : (visitorProfile && visitorProfile.tag ? visitorProfile.tag : null),
          avatarUrl: (visitorProfile && visitorProfile.avatarUrl) ? visitorProfile.avatarUrl : (currentUser.photoURL || null),
          lastVisitedAt: serverTimestamp()
        }, { merge: true });
      } catch(e){
        console.warn('visitor record failed', e);
      }
    }

    // subscribe posts
    subscribePosts(uid);

  } catch(err){
    console.error('loadProfile error', err);
    profileArea.innerHTML = `<div class="text-center p-4 text-danger">Lỗi khi tải thông tin người dùng.</div>`;
  }
}

// helper avatar builder
function userAvatarUrlFor(user){
  if(!user) return '';
  if(user.photoURL) return user.photoURL;
  if(user.avatarUrl) return user.avatarUrl;
  if(user.email) return `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||user.email)}&background=0D6EFD&color=fff&size=120`;
  return `https://ui-avatars.com/api/?name=U&background=0D6EFD&color=fff&size=120`;
}

// render follow action area
async function renderFollowActionArea(profileId){
  const actionArea = document.getElementById('profileActionArea');
  if(!actionArea) return;
  actionArea.innerHTML = '';

  if(!currentUser){
    actionArea.innerHTML = `<button id="btnLoginToFollow" class="btn btn-sm btn-outline-primary btn-rounded">Theo dõi</button>`;
    document.getElementById('btnLoginToFollow').addEventListener('click', ()=> loginModalProfile.show());
    return;
  }

  if(currentUser.uid === profileId){
    actionArea.innerHTML = `<button id="btnEditProfile" class="btn btn-outline-primary btn-rounded btn-sm">Chỉnh sửa</button>`;
    document.getElementById('btnEditProfile').addEventListener('click', ()=> showEditForm(userDoc, profileId));
    return;
  }

  try {
    const fSnap = await getDoc(doc(db,'users',profileId,'followers', currentUser.uid));
    const isFollowing = fSnap.exists();
    const btnHtml = isFollowing
      ? `<button id="btnUnfollow" class="btn btn-sm btn-outline-danger btn-rounded">Đang theo dõi · Hủy</button>`
      : `<button id="btnFollow" class="btn btn-sm btn-primary btn-rounded">Theo dõi</button>`;
    actionArea.innerHTML = btnHtml;
    if(isFollowing){
      document.getElementById('btnUnfollow').addEventListener('click', ()=> doUnfollow(profileId));
    } else {
      document.getElementById('btnFollow').addEventListener('click', ()=> doFollow(profileId));
    }
  } catch(e){
    console.error('renderFollowActionArea error', e);
  }
}

// doFollow: KEEP IT STEP-BY-STEP, but REMOVE client-side increment of counters (we use collection sizes)
async function doFollow(profileId){
  if(!currentUser){ loginModalProfile.show(); return; }

  const followerRef = doc(db,'users',profileId,'followers', currentUser.uid);
  const followingRef = doc(db,'users',currentUser.uid,'following', profileId);

  // 1) create follower doc on target
  try {
    await setDoc(followerRef, {
      userId: currentUser.uid,
      createdAt: serverTimestamp(),
      displayName: currentUser.displayName || null,
      tagName: null,
      avatarUrl: (currentUser.photoURL || null)
    });
  } catch(err){
    console.error('doFollow: failed to create follower doc', err);
    alert('Không thể tạo record follower. Kiểm tra Rules. Chi tiết console.');
    return;
  }

  // 2) try to get profile displayName/tagName for local record
  let profileDisplay = userDoc && userDoc.displayName ? userDoc.displayName : null;
  let profileAvatar = userDoc && userDoc.avatarUrl ? userDoc.avatarUrl : null;

  // 3) create following doc on current user
  try {
    await setDoc(followingRef, {
      userId: profileId,
      createdAt: serverTimestamp(),
      displayName: profileDisplay,
      avatarUrl: profileAvatar
    });
  } catch(err){
    console.error('doFollow: failed to create following doc', err);
    // rollback follower doc
    try { await deleteDoc(followerRef); } catch(e){ console.warn('rollback follower delete failed', e); }
    alert('Không thể tạo record following. Kiểm tra Rules. Chi tiết console.');
    return;
  }

  // UI refresh via snapshot (followersCount displayed by snapshot size)
  try { await renderFollowActionArea(profileId); } catch(e){ console.warn('renderFollow after follow failed', e); }
}

// doUnfollow: delete docs, don't try decrement counters (use subcollection sizes)
async function doUnfollow(profileId){
  if(!currentUser){ loginModalProfile.show(); return; }
  const followerRef = doc(db,'users',profileId,'followers', currentUser.uid);
  const followingRef = doc(db,'users',currentUser.uid,'following', profileId);

  try { await deleteDoc(followingRef); } catch(err){ console.warn('doUnfollow: could not delete following ref', err); }
  try { await deleteDoc(followerRef); } catch(err){ console.warn('doUnfollow: could not delete follower ref', err); }

  try { await renderFollowActionArea(profileId); } catch(e){}
}

// subscribe follower/following counts using collection snapshot sizes
function subscribeFollowerCounts(uid){
  try {
    const followersColl = collection(db,'users',uid,'followers');
    const followingColl = collection(db,'users',uid,'following');

    // subscribers update DOM with snapshot.size
    onSnapshot(followersColl, snap => {
      const el = document.getElementById('followersCount');
      if(el) el.textContent = snap.size;
    }, err => { console.warn('followers snap error', err); });

    onSnapshot(followingColl, snap => {
      const el2 = document.getElementById('followingCount');
      if(el2) el2.textContent = snap.size;
    }, err => { console.warn('following snap error', err); });

  } catch(e){
    console.warn('subscribeFollowerCounts failed', e);
  }
}

// subscribe posts realtime
function subscribePosts(uid){
  if(postsUnsub){ postsUnsub(); postsUnsub = null; }
  try {
    const postsQ = query(collection(db,'posts'), where('userId','==', uid), orderBy('createdAt','desc'));
    postsUnsub = onSnapshot(postsQ, snap => {
      lastPostsDocs = snap.docs;
      renderPostsSnapshot(snap.docs);
    }, err => {
      console.error('subscribePosts error', err);
      const listEl = document.getElementById('userPostsList');
      if(listEl) listEl.innerHTML = `<div class="text-muted py-3">Không thể tải bài viết. Nếu console báo "requires an index", tạo composite index userId ASC, createdAt DESC. Nếu là permission error, check Firestore Rules.</div>`;
    });
  } catch(e){
    console.error('subscribePosts failed', e);
  }
}

// render posts (same as previous)
function renderPostsSnapshot(docs){
  const listEl = document.getElementById('userPostsList');
  if(!listEl) return;
  if(!docs.length){ listEl.innerHTML = `<div class="text-muted py-3">Người dùng chưa có bài viết nào.</div>`; return; }

  const frag = document.createDocumentFragment();
  docs.forEach(docSnap => {
    const d = docSnap.data(); const id = docSnap.id;
    const card = document.createElement('div');
    card.className = 'card card-post p-3';

    const authorHtml = d.userId ? `<div class="fw-bold">${esc(d.displayName||'')}</div><div class="small-muted">${esc(d.authorTag||'')}</div>` : `<div class="fw-bold">${esc(d.displayName||'Tài khoản thử nghiệm')}</div><div><span class="badge-trial">Tài khoản thử nghiệm</span></div>`;
    const hashtagsHtml = (d.hashtags||[]).map(h => `<a href="tag.html?tag=${encodeURIComponent(h)}" class="hashtag">${esc(h)}</a>`).join(' ');

    let ownerButtonsHtml = '';
    if(currentUser && currentUser.uid === profileUid){
      ownerButtonsHtml = `<button class="btn btn-sm btn-outline-secondary btn-rounded btn-edit-post me-1" data-id="${id}"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-outline-danger btn-rounded btn-delete-post" data-id="${id}"><i class="bi bi-trash"></i></button>`;
    }

    card.innerHTML = `
      <div class="d-flex justify-content-between">
        <div>${authorHtml}<div class="small-muted">${esc(d.title||'')}</div></div>
        <div class="small-muted">${fmtDate(d.createdAt)}</div>
      </div>
      <div class="mt-2">${hashtagsHtml}</div>
      <div class="d-flex gap-2 mt-2 align-items-center">
        <button class="btn btn-sm btn-outline-primary btn-rounded btn-like" data-id="${id}" title="Like"><i class="bi bi-hand-thumbs-up"></i> <span class="like-count">${d.likes||0}</span></button>
        <button class="btn btn-sm btn-outline-danger btn-rounded btn-dislike" data-id="${id}" title="Dislike"><i class="bi bi-hand-thumbs-down"></i> <span class="dislike-count">${d.dislikes||0}</span></button>
        <button class="btn btn-sm btn-outline-secondary btn-rounded btn-comment-icon" data-id="${id}" title="Bình luận"><i class="bi bi-chat"></i> <span class="comment-count">${d.commentsCount||0}</span></button>
        <a href="post.html?id=${encodeURIComponent(id)}" class="btn btn-sm btn-outline-success btn-rounded ms-auto"><i class="bi bi-box-arrow-up-right"></i> Xem</a>
      </div>
      <div class="mt-2 text-end">${ownerButtonsHtml}</div>
    `;

    // listeners
    card.querySelectorAll('.btn-like').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); toggleReaction(id, 'like', card); }));
    card.querySelectorAll('.btn-dislike').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); toggleReaction(id, 'dislike', card); }));
    card.querySelectorAll('.btn-comment-icon').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); openCommentsModal(id, d.title || ''); }));
    card.querySelectorAll('.btn-edit-post').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); openEditPost(id); }));
    card.querySelectorAll('.btn-delete-post').forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); confirmDeletePost(id); }));

    frag.appendChild(card);
  });

  listEl.innerHTML = '';
  listEl.appendChild(frag);
  // apply search
  const kw = profileSearchInput.value.trim();
  if(kw) filterPostsByKeyword(kw);
}

// Reaction handling unchanged (uses batch)
async function toggleReaction(postId, reaction, cardEl){
  if(!currentUser){ loginModalProfile.show(); return; }
  try {
    const likeDocRef = doc(db,'posts',postId,'likes',currentUser.uid);
    const postRef = doc(db,'posts',postId);
    const likeSnap = await getDoc(likeDocRef);
    const batch = writeBatch(db);

    if(!likeSnap.exists()){
      batch.set(likeDocRef, { userId: currentUser.uid, type: reaction, createdAt: serverTimestamp() });
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

    // disable buttons briefly
    const likeBtn = cardEl.querySelector('.btn-like');
    const disBtn = cardEl.querySelector('.btn-dislike');
    if(likeBtn) likeBtn.disabled = true;
    if(disBtn) disBtn.disabled = true;

    await batch.commit();

    // refresh counts from server
    const freshPost = await getDoc(postRef);
    if(freshPost.exists()){
      const pdata = freshPost.data();
      cardEl.querySelector('.like-count').textContent = pdata.likes || 0;
      cardEl.querySelector('.dislike-count').textContent = pdata.dislikes || 0;
    }
  } catch(err){
    console.error('Reaction failed', err);
    alert('Reaction failed — kiểm tra quyền (permission) hoặc kết nối. Chi tiết xem console.');
  } finally {
    const likeBtn = cardEl.querySelector('.btn-like');
    const disBtn = cardEl.querySelector('.btn-dislike');
    if(likeBtn) likeBtn.disabled = false;
    if(disBtn) disBtn.disabled = false;
  }
}

/* ---------------- Comments modal logic ---------------- */
let currentCommentsPostId = null;

async function openCommentsModal(postId, title){
  currentCommentsPostId = postId;
  document.getElementById('profileCommentsTitle').textContent = 'Bình luận — ' + (title || '');
  if(!currentUser){
    document.getElementById('profileMustLoginToComment').style.display = 'block';
    document.getElementById('profileCommentBoxArea').style.display = 'none';
    document.getElementById('openLoginFromProfileComment').addEventListener('click', ev => { ev.preventDefault(); loginModalProfile.show(); });
  } else {
    document.getElementById('profileMustLoginToComment').style.display = 'none';
    document.getElementById('profileCommentBoxArea').style.display = 'block';
    try {
      const uSnap = await getDoc(doc(db,'users',currentUser.uid));
      const prof = uSnap.exists() ? uSnap.data() : null;
      document.getElementById('profileCommenterInfo').innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${userAvatarUrlFor(prof||currentUser)}" class="user-avatar" style="width:36px;height:36px;border-radius:50%;object-fit:cover;"><div><div class="fw-bold">${esc(prof?.displayName || currentUser.email)}</div></div></div>`;
    } catch(e){}
  }

  // subscribe comments realtime
  if(commentsSubsCleanup) commentsSubsCleanup();
  try {
    const commentsQ = query(collection(db,'posts',postId,'comments'), orderBy('createdAt','desc'));
    commentsSubsCleanup = onSnapshot(commentsQ, snap => {
      const list = document.getElementById('profileCommentsList'); list.innerHTML = '';
      if(snap.empty){ list.innerHTML = '<div class="text-muted">Chưa có bình luận</div>'; return; }
      snap.forEach(s => {
        const c = s.data();
        const el = document.createElement('div');
        el.className = 'mb-3';
        el.innerHTML = `<div class="fw-bold">${esc(c.displayName||'')}</div><div class="small-muted">${fmtDate(c.createdAt)}</div><div class="comment-text">${esc(c.text)}</div><hr>`;
        list.appendChild(el);
      });
    });
  } catch(err){
    console.error('comments subscription error', err);
  }

  commentsModal.show();
}

// send comment: create comment doc then try increment commentsCount (best-effort)
document.getElementById('profilePostCommentBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('profileCommentText').value.trim();
  if(!text) return alert('Viết bình luận trước khi gửi.');
  if(!currentUser) return loginModalProfile.show();

  let prof = null;
  try { const uSnap = await getDoc(doc(db,'users',currentUser.uid)); if(uSnap.exists()) prof = uSnap.data(); } catch(e){}

  try {
    // 1) create comment
    await addDoc(collection(db,'posts',currentCommentsPostId,'comments'), {
      displayName: prof?.displayName || currentUser.email,
      userId: currentUser.uid,
      text,
      createdAt: serverTimestamp()
    });

    // 2) try increment commentsCount - if fail, just warn (comment already created)
    try {
      await updateDoc(doc(db,'posts',currentCommentsPostId), { commentsCount: increment(1) });
    } catch(updateErr){
      console.warn('Could not increment commentsCount (permission or other issue):', updateErr);
    }

    document.getElementById('profileCommentText').value = '';
  } catch(err){
    console.error('post comment creation failed', err);
    alert('Không thể gửi bình luận — thử lại sau.');
  }
});

/* ---------------- Client-side search ---------------- */
profileSearchInput.addEventListener('input', (ev)=>{
  const kw = ev.target.value.trim();
  if(!kw){ renderPostsSnapshot(lastPostsDocs); profileSearchResults.style.display = 'none'; return; }
  filterPostsByKeyword(kw);
});

function filterPostsByKeyword(keyword){
  const low = keyword.toLowerCase();
  const listEl = document.getElementById('userPostsList');
  if(!listEl) return;
  const cards = listEl.querySelectorAll('.card-post');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(low) ? '' : 'none';
  });
}

/* ---------------- Visitors modal (owner only) ---------------- */
document.getElementById('openVisitorsBtn').addEventListener('click', async ()=>{
  if(!userDoc) return;
  try {
    const vQ = query(collection(db,'users',userDoc.id,'visitors'), orderBy('lastVisitedAt','desc'));
    const snaps = await getDocs(vQ);
    visitorsListEl.innerHTML = '';
    if(snaps.empty){
      visitorsListEl.innerHTML = `<div class="text-muted py-2">Chưa có khách ghé thăm</div>`;
    } else {
      snaps.forEach(s => {
        const v = s.data();
        // Use fallback values and link to profile
        const display = v.displayName || '(Người dùng)';
        const tag = v.tagName || '';
        const avatar = v.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(display)}&background=0D6EFD&color=fff&size=128`;
        const profileLink = `<a href="profile.html?user=${encodeURIComponent(v.userId)}" class="stretched-link text-decoration-none text-reset"></a>`;
        const el = document.createElement('div');
        el.className = 'visitor-item position-relative';
        el.innerHTML = `
          <img src="${esc(avatar)}" class="visitor-avatar">
          <div>
            <div class="fw-bold">${esc(display)} ${ tag ? `<small class="text-muted">(${esc(tag)})</small>` : '' }</div>
            <div class="small-muted">${fmtDate(v.lastVisitedAt)}</div>
          </div>
        `;
        // wrap with link
        const wrapper = document.createElement('div');
        wrapper.className = 'position-relative';
        wrapper.appendChild(el);
        const link = document.createElement('a');
        link.href = `profile.html?user=${encodeURIComponent(v.userId)}`;
        link.className = 'stretched-link';
        wrapper.appendChild(link);
        visitorsListEl.appendChild(wrapper);
      });
    }
    new bootstrap.Modal(document.getElementById('visitorsModal')).show();
  } catch(e){
    console.error('openVisitors error', e);
    alert('Không thể tải danh sách khách — thử lại sau.');
  }
});

/* ---------------- Add / Edit / Delete posts (owner) ---------------- */
ensureQuill();
postEditorForm.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  if(!currentUser) return loginModalProfile.show();
  const title = document.getElementById('editorPostTitle').value.trim();
  if(!title) return alert('Cần có tiêu đề');
  const hashtags = (document.getElementById('editorPostHashtags').value || '').split(/[, ]+/).map(s=>s.trim()).filter(Boolean).map(s => s.startsWith('#')? s : '#'+s);
  const contentHTML = quillEditor.root.innerHTML;
  const postId = document.getElementById('editorPostId').value || null;

  try {
    if(postId){
      await updateDoc(doc(db,'posts',postId), {
        title, content: contentHTML, hashtags, updatedAt: serverTimestamp()
      });
    } else {
      const uSnap = await getDoc(doc(db,'users',currentUser.uid));
      const profile = uSnap.exists() ? uSnap.data() : {};
      await addDoc(collection(db,'posts'), {
        displayName: profile.displayName || currentUser.email,
        title, content: contentHTML, hashtags, likes:0, dislikes:0, commentsCount:0, createdAt: serverTimestamp(),
        userId: currentUser.uid, authorTag: profile.tagName || null
      });
    }
    postEditorModal.hide();
  } catch(e){
    console.error('post save error', e);
    alert('Không thể lưu bài — thử lại sau.');
  }
});

function openAddPostEditor(){
  ensureQuill();
  document.getElementById('postEditorTitle').textContent = 'Viết bài mới';
  document.getElementById('editorPostTitle').value = '';
  document.getElementById('editorPostHashtags').value = '';
  document.getElementById('editorPostId').value = '';
  quillEditor.root.innerHTML = '';
  postEditorModal.show();
}

async function openEditPost(postId){
  ensureQuill();
  try {
    const pSnap = await getDoc(doc(db,'posts',postId));
    if(!pSnap.exists()) return alert('Bài viết không tồn tại');
    const p = pSnap.data();
    document.getElementById('postEditorTitle').textContent = 'Chỉnh sửa bài';
    document.getElementById('editorPostTitle').value = p.title || '';
    document.getElementById('editorPostHashtags').value = (p.hashtags||[]).join(' ');
    document.getElementById('editorPostId').value = postId;
    quillEditor.root.innerHTML = p.content || '';
    postEditorModal.show();
  } catch(e){
    console.error('openEditPost error', e);
    alert('Không thể mở bài để chỉnh sửa');
  }
}

async function confirmDeletePost(postId){
  if(!confirm('Bạn có chắc muốn xóa bài này? Hành động không thể hoàn tác.')) return;
  try {
    await deleteDoc(doc(db,'posts',postId));
    alert('Đã xóa bài');
  } catch(e){
    console.error('deletePost error', e);
    alert('Không thể xóa bài — thử lại sau.');
  }
}

/* ---------------- Propagate profile to posts AND comments ---------------- */
/**
 * propagateProfileToPostsAndComments(uid, updates, progressCb)
 * - updates: object fields to update in post doc (e.g. { displayName: 'New Name', authorTag: '@newtag' })
 * - will also find comments authored by uid under each post and update comment.displayName accordingly
 */
async function propagateProfileToPostsAndComments(uid, updates, progressCb){
  if(!uid) return { updatedPosts:0, updatedComments:0, totalPosts:0 };
  const BATCH_SIZE = 450; // under limit (max 500 ops per batch)
  const postsSnap = await getDocs(query(collection(db,'posts'), where('userId','==', uid)));
  if(postsSnap.empty) return { updatedPosts:0, updatedComments:0, totalPosts:0 };
  const posts = postsSnap.docs;
  let totalPosts = posts.length;
  let updatedPosts = 0;
  let updatedComments = 0;

  for(let i=0;i<posts.length;i++){
    const pDoc = posts[i];
    // update post doc
    try {
      await updateDoc(doc(db,'posts',pDoc.id), updates);
      updatedPosts++;
    } catch(e){
      console.warn('propagate: update post failed', pDoc.id, e);
    }

    // now update comments in subcollection where userId == uid
    try {
      const commentsQ = query(collection(db,'posts',pDoc.id,'comments'), where('userId','==', uid));
      const cSnap = await getDocs(commentsQ);
      if(!cSnap.empty){
        // batch update comments in chunks to be safe
        const commentDocs = cSnap.docs;
        for(let j=0;j<commentDocs.length;j+=BATCH_SIZE){
          const batch = writeBatch(db);
          const chunk = commentDocs.slice(j, j+BATCH_SIZE);
          chunk.forEach(cdoc => {
            const cRef = doc(db,'posts',pDoc.id,'comments', cdoc.id);
            batch.update(cRef, { displayName: updates.displayName || cdoc.data().displayName || null });
          });
          await batch.commit();
          updatedComments += chunk.length;
        }
      }
    } catch(e){
      console.warn('propagate: update comments failed for post', pDoc.id, e);
    }

    if(typeof progressCb === 'function') progressCb({ updatedPosts, updatedComments, totalPosts });
  }

  return { updatedPosts, updatedComments, totalPosts };
}

/* ---------------- Achievements rendering (unchanged) ---------------- */
openAchievementsBtn.addEventListener('click', async ()=>{
  if(!userDoc) return alert('Thiếu thông tin người dùng.');
  achievementsContainer.innerHTML = '';
  const createdAt = (userDoc.createdAt && userDoc.createdAt.toDate) ? userDoc.createdAt.toDate() : (userDoc.createdAt ? new Date(userDoc.createdAt) : null);
  const now = new Date();
  const MS = { day: 24*60*60*1000, week: 7*24*60*60*1000, month: 30*24*60*60*1000, year: 365*24*60*60*1000 };
  const milestones = [
    { key:'1_day', label:'1 Ngày', target: MS.day, style:'small' },
    { key:'1_week', label:'1 Tuần', target: MS.week, style:'small' },
    { key:'1_month', label:'1 Tháng', target: MS.month, style:'medium' },
    { key:'1_year', label:'1 Năm', target: MS.year, style:'medium' },
    { key:'2_years', label:'2 Năm', target: 2*MS.year, style:'medium' },
    { key:'3_years', label:'3 Năm', target: 3*MS.year, style:'big' },
    { key:'4_years', label:'4 Năm', target: 4*MS.year, style:'big' },
    { key:'5_years', label:'5 Năm', target: 5*MS.year, style:'hero' },
    { key:'10_years', label:'10 Năm', target: 10*MS.year, style:'hero' },
    { key:'infinite', label:'Năm vô hạn', target: 10*MS.year, style:'hero' }
  ];
  let elapsed = 0;
  if(createdAt) elapsed = now - createdAt;
  milestones.forEach(ms => {
    const card = document.createElement('div');
    card.className = 'col-12 col-md-6 col-xl-4';
    const inner = document.createElement('div');
    inner.className = 'achievement-card' + (ms.style==='big' ? ' big' : '') + (ms.style==='hero' ? ' hero' : '');
    let pct = 0; let subtitle = '';
    if(!createdAt){ pct=0; subtitle='Chưa có dữ liệu'; }
    else {
      if(ms.key === 'infinite'){
        const years = Math.floor(elapsed / MS.year);
        const intoYear = elapsed - (years * MS.year);
        pct = (intoYear / MS.year) * 100;
        subtitle = `Đã đồng hành ${years} năm — tiến trình năm tiếp theo: ${Math.round(pct)}%`;
      } else {
        pct = Math.min(100, (elapsed / ms.target) * 100);
        subtitle = `${Math.min(100, Math.round(pct))}% đạt mốc ${ms.label}`;
      }
    }
    inner.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <div class="achievement-title">${ms.label} ${ms.style==='hero' ? '<span class="badge bg-warning text-dark ms-2">Đặc biệt</span>' : ''}</div>
          <div class="achievement-meta">${subtitle}</div>
        </div>
        <div><i class="bi bi-award-fill fs-3 text-warning"></i></div>
      </div>
      <div class="achievement-bar" aria-hidden="true"><div class="achievement-progress" style="width:${Math.max(0,Math.min(100, Math.round(pct)))}%"></div></div>
    `;
    card.appendChild(inner);
    achievementsContainer.appendChild(card);
  });
  new bootstrap.Modal(document.getElementById('achievementsModal')).show();
});

/* ---------------- Menu & auth area ---------------- */
menuToggleBtn.addEventListener('click', ()=> new bootstrap.Offcanvas(profileMenuCanvas).toggle());

function renderMenuAuthArea(){
  if(!menuAuthAreaProfile) return;
  if(currentUser && userDoc && currentUser.uid === userDoc.id){
    menuAuthAreaProfile.innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${userAvatarUrlFor(userDoc)}" class="user-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"><div><div class="fw-bold">${esc(userDoc.displayName||currentUser.email)}</div><div class="small-muted">${esc(userDoc.email||'')}</div></div></div><div class="mt-3"><button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button></div>`;
    document.getElementById('btnLogoutProfile').addEventListener('click', async ()=> { await signOut(auth); new bootstrap.Offcanvas(profileMenuCanvas).hide(); });
  } else if(currentUser){
    menuAuthAreaProfile.innerHTML = `<div class="d-flex gap-2 align-items-center"><img src="${userAvatarUrlFor(currentUser)}" class="user-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;"><div><div class="fw-bold">${esc(currentUser.email || '')}</div></div></div><div class="mt-3"><button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button></div>`;
    document.getElementById('btnLogoutProfile').addEventListener('click', async ()=> { await signOut(auth); new bootstrap.Offcanvas(profileMenuCanvas).hide(); });
  } else {
    menuAuthAreaProfile.innerHTML = `<div class="d-grid gap-2"><button id="openLoginProfile" class="btn btn-primary btn-rounded">Đăng nhập</button></div>`;
    document.getElementById('openLoginProfile').addEventListener('click', ()=> { loginModalProfile.show(); new bootstrap.Offcanvas(profileMenuCanvas).hide(); });
  }
}

/* ---------------- Login form handling (activation flow) ---------------- */
document.getElementById('loginFormProfile').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const email = document.getElementById('loginEmailProfile').value.trim();
  const password = document.getElementById('loginPasswordProfile').value;
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const u = cred.user;
    const udoc = await getDoc(doc(db,'users',u.uid));
    const profile = udoc.exists() ? udoc.data() : null;
    if(profile && profile.activated){
      loginModalProfile.hide();
    } else {
      document.getElementById('activateBlockProfile').style.display = 'block';
      const code = prompt('Tài khoản chưa kích hoạt. Nhập mã kích hoạt do admin gửi:');
      if(code){
        const userRef = doc(db,'users',u.uid);
        const uSnap = await getDoc(userRef);
        if(uSnap.exists() && uSnap.data().activationCode === code){
          await updateDoc(userRef, { activated: true });
          alert('Kích hoạt thành công.');
          loginModalProfile.hide();
        } else {
          alert('Mã kích hoạt sai. Liên hệ admin.');
          await signOut(auth);
        }
      } else {
        await signOut(auth);
      }
    }
  } catch(err){
    console.error('loginProfile error', err);
    alert('Lỗi đăng nhập: ' + (err.message || err));
  }
});

/* ---------------- Edit profile + propagation ---------------- */
function showEditForm(profile, uid){
  const editArea = document.getElementById('editArea');
  editArea.style.display = 'block';
  editArea.innerHTML = `
    <form id="profileEditForm" class="p-3 border rounded bg-white">
      <div class="mb-2">
        <label class="form-label">Tên hiển thị (public)</label>
        <input id="editDisplayName" class="form-control" value="${esc(profile.displayName||'')}">
      </div>
      <div class="mb-2">
        <label class="form-label">Tag Name Search (ví dụ: @lan123)</label>
        <input id="editTagName" class="form-control" value="${esc(profile.tagName||'')}">
        <div class="form-note">Tag phải là duy nhất; không đổi nếu trùng.</div>
      </div>
      <div class="mb-2">
        <label class="form-label">Giới thiệu (bio)</label>
        <textarea id="editBio" class="form-control" rows="4">${esc(profile.bio||'')}</textarea>
      </div>
      <div class="d-flex gap-2">
        <button type="submit" class="btn btn-primary btn-rounded">Lưu</button>
        <button type="button" id="cancelEdit" class="btn btn-outline-secondary btn-rounded">Hủy</button>
      </div>
      <div id="editMsg" class="mt-2 small-muted"></div>
    </form>
  `;

  document.getElementById('cancelEdit').addEventListener('click', ()=> { editArea.style.display='none'; });

  document.getElementById('profileEditForm').addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const newDisplay = document.getElementById('editDisplayName').value.trim();
    let newTag = document.getElementById('editTagName').value.trim();
    const newBio = document.getElementById('editBio').value.trim();
    if(!newDisplay) return alert('Tên hiển thị không được để trống.');
    if(newTag && !newTag.startsWith('@')) newTag = '@' + newTag;
    const editMsg = document.getElementById('editMsg');
    editMsg.textContent = 'Đang kiểm tra & cập nhật...';

    try {
      // check uniqueness of tagName if changed
      if(newTag && newTag !== (profile.tagName || '')){
        const snaps = await getDocs(query(collection(db,'users'), where('tagName','==', newTag)));
        let conflict = false; snaps.forEach(s=>{ if(s.id !== uid) conflict = true; });
        if(conflict){ editMsg.textContent=''; return alert('Tag Name đã được sử dụng.'); }
      }

      const userRef = doc(db,'users',uid);
      const dataToUpdate = { displayName: newDisplay, bio: newBio, updatedAt: serverTimestamp() };
      if(newTag) dataToUpdate.tagName = newTag;
      await updateDoc(userRef, dataToUpdate);

      // propagate to posts and comments
      const propagateFields = { displayName: newDisplay };
      if(newTag) propagateFields.authorTag = newTag;
      editMsg.textContent = 'Đang cập nhật bài viết và bình luận cũ...';
      await propagateProfileToPostsAndComments(uid, propagateFields, (progress)=> {
        editMsg.textContent = `Đã cập nhật ${progress.updatedPosts}/${progress.totalPosts} bài — ${progress.updatedComments} bình luận...`;
      });

      editMsg.textContent = 'Hoàn tất.';
      await loadProfile(uid);
      setTimeout(()=> { editArea.style.display='none'; }, 900);
    } catch(err){
      console.error(err);
      editMsg.textContent = '';
      alert('Lỗi khi cập nhật thông tin.');
    }
  });
}

/* ---------------- Utility ---------------- */
function stripHtml(html){ if(!html) return ''; return String(html).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim(); }

/* ---------------- Expose functions to window (legacy inline handlers) ---------------- */
window.showEditForm = async function(profile, uid){
  if(!profile && uid){
    try { const s = await getDoc(doc(db,'users',uid)); if(s.exists()) profile = s.data(); } catch(e){}
  }
  showEditForm(profile, uid);
};
window.openEditPost = openEditPost;
window.confirmDeletePost = confirmDeletePost;
window.doFollow = doFollow;
window.doUnfollow = doUnfollow;

/* ---------------- Auth handling ---------------- */
onAuthStateChanged(auth, user => {
  currentUser = user;
  ensureQuill();
  if(!profileUid){
    if(user){ profileUid = user.uid; loadProfile(profileUid); }
    else { profileArea.innerHTML = `<div class="text-center p-4"><div class="mb-3">Bạn chưa đăng nhập.</div><div><a class="btn btn-primary" href="index.html" onclick="bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModalProfile')).show(); return false;">Đăng nhập để xem profile của bạn</a></div></div>`; }
  } else {
    loadProfile(profileUid);
  }
});

/* ---------------- Cleanup ---------------- */
window.addEventListener('beforeunload', ()=>{
  if(postsUnsub) postsUnsub();
  if(commentsSubsCleanup) commentsSubsCleanup();
});
