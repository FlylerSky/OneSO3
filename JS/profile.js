// JS/profile.js - Relife UI 1.2 ENHANCED
// ✅ Fixed comment counter (snapshot.size)
// ✅ Removed increment logic
// ✅ Display nested replies
// 🆕 Avatar editor with preview
// 🆕 Cover photo with customization
// 🆕 Avatar frames system (3 free + 9 special)
// 🆕 Achievement groups (Companionship)

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

// Load avatar frames configuration
let avatarFramesData = null;
if (typeof AVATAR_FRAMES !== 'undefined') {
  avatarFramesData = AVATAR_FRAMES;
}

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
const fmtDate = ts => { 
  try { 
    return ts?.toDate ? ts.toDate().toLocaleDateString('vi-VN', {year:'numeric',month:'2-digit',day:'2-digit'}) : '';
  } catch { 
    return ''; 
  } 
};

// State
let currentUser = null;
let userDoc = null;
let profileUid = null;
let postsUnsub = null;
let commentsSubsCleanup = null;
let selectedFrameId = 'none';

// Parse URL
const params = new URLSearchParams(location.search);
const userParam = params.get('user');
if(userParam) profileUid = userParam;

// Quill config
const QUILL_FORMATS = ['header','bold','italic','underline','strike','blockquote','code-block','list','link','image','video','align','color','background','font','size'];
const QUILL_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered'}, { list: 'bullet' }],
  ['blockquote', 'code-block'],
  ['link', 'image', 'video'],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  ['clean']
];

function ensureQuill(){
  if(!quillEditor && document.getElementById('postEditor')){
    quillEditor = new Quill('#postEditor', {
      theme: 'snow',
      modules: { toolbar: QUILL_TOOLBAR },
      formats: QUILL_FORMATS,
      placeholder: 'Viết nội dung...'
    });
  }
}

/* ========== COVER PHOTO & AVATAR FRAME RENDERING ========== */

function renderProfileCoverAndAvatar(userDoc) {
  if (!userDoc) return;
  
  const coverContainer = document.getElementById('profileCover');
  const coverImage = document.getElementById('profileCoverImage');
  const avatar = document.getElementById('profileAvatarImg');
  const frameContainer = document.getElementById('profileAvatarFrame');
  
  if (!avatar) return;
  
  // Cover Photo
  if (coverImage && userDoc.coverPhotoUrl) {
    const settings = userDoc.coverPhotoSettings || { scale: 1, translateX: 0, translateY: 0 };
    coverImage.src = userDoc.coverPhotoUrl;
    coverImage.style.display = 'block';
    coverImage.style.transform = `scale(${settings.scale}) translate(${settings.translateX}%, ${settings.translateY}%)`;
  } else if (coverImage) {
    coverImage.style.display = 'none';
  }
  
  // Avatar
  const avatarUrl = userDoc.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(userDoc.displayName || 'U')}&background=0D6EFD&color=fff&size=256`;
  avatar.src = avatarUrl;
  
  if (userDoc.avatarSettings) {
    const settings = userDoc.avatarSettings;
    avatar.style.transform = `scale(${settings.scale || 1}) translate(${settings.translateX || 0}%, ${settings.translateY || 0}%)`;
  }
  
  // Avatar Frame
  if (frameContainer && userDoc.avatarFrame && avatarFramesData) {
    const allFrames = [...avatarFramesData.free, ...avatarFramesData.special];
    const frame = allFrames.find(f => f.id === userDoc.avatarFrame);
    
    if (frame && frame.image) {
      const frameImg = frameContainer.querySelector('img');
      if (frameImg) {
        frameImg.src = frame.image;
        frameContainer.style.display = 'block';
      }
    } else {
      frameContainer.style.display = 'none';
    }
  } else if (frameContainer) {
    frameContainer.style.display = 'none';
  }
}

/* ========== LOAD PROFILE ========== */

async function loadProfile(uid){
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if(!userSnap.exists()){
      profileArea.innerHTML = '<div class="text-center p-4">Không tìm thấy người dùng.</div>';
      return;
    }
    
    userDoc = { id: uid, ...userSnap.data() };
    
    // Update achievement status (auto-unlock frames) - only if createdAt exists
    if (userDoc.createdAt) {
      await updateAchievementStatus(uid, userDoc);
      
      // Reload userDoc after achievement update
      const refreshSnap = await getDoc(doc(db, 'users', uid));
      if (refreshSnap.exists()) {
        userDoc = { id: uid, ...refreshSnap.data() };
      }
    }
    
    // Render cover photo and avatar with frame
    renderProfileCoverAndAvatar(userDoc);
    
    // Render profile info
    const displayName = userDoc.displayName || userDoc.email || 'Người dùng';
    const tagName = userDoc.tagName || '';
    const bio = userDoc.bio || '';
    const gender = userDoc.gender || '';
    const birthday = userDoc.birthday || '';
    const country = userDoc.country || '';
    
    const displayNameEl = document.getElementById('profileDisplayName');
    const tagNameEl = document.getElementById('profileTagName');
    const bioEl = document.getElementById('profileBio');
    const basicInfoEl = document.getElementById('profileBasicInfo');
    
    if (displayNameEl) displayNameEl.textContent = displayName;
    if (tagNameEl) tagNameEl.textContent = tagName ? `@${tagName}` : '';
    if (bioEl) bioEl.textContent = bio || 'Chưa có giới thiệu';
    
    if (basicInfoEl) {
      let infoHTML = '';
      if(gender) infoHTML += `<div><i class="bi bi-gender-ambiguous"></i> ${esc(gender)}</div>`;
      if(birthday) infoHTML += `<div><i class="bi bi-cake"></i> ${esc(birthday)}</div>`;
      if(country) infoHTML += `<div><i class="bi bi-geo-alt"></i> ${esc(country)}</div>`;
      basicInfoEl.innerHTML = infoHTML || '<div class="text-muted">Chưa có thông tin</div>';
    }
    
    // Followers/Following counts
    const followersCountEl = document.getElementById('profileFollowersCount');
    const followingCountEl = document.getElementById('profileFollowingCount');
    
    if (followersCountEl) {
      onSnapshot(collection(db,'users',uid,'followers'), snap => {
        followersCountEl.textContent = snap.size;
      });
    }
    
    if (followingCountEl) {
      onSnapshot(collection(db,'users',uid,'following'), snap => {
        followingCountEl.textContent = snap.size;
      });
    }
    
    // Action area
    await renderFollowActionArea(uid);
    
    // Update achievements button to show groups
    if (openAchievementsBtn) {
      openAchievementsBtn.onclick = () => {
        renderAchievementsWithGroups(userDoc);
        new bootstrap.Modal(document.getElementById('achievementsModal')).show();
      };
    }
    
    // Visitors button (only for owner)
    if(openVisitorsBtn){
      if(currentUser && currentUser.uid === uid){
        openVisitorsBtn.style.display = 'inline-block';
      } else {
        openVisitorsBtn.style.display = 'none';
      }
    }
    
    // Record visitor
    if(currentUser && currentUser.uid !== uid){
      try {
        const visitorProfile = await getDoc(doc(db,'users', currentUser.uid));
        const vData = visitorProfile.exists() ? visitorProfile.data() : null;
        await setDoc(doc(db,'users',uid,'visitors', currentUser.uid), {
          displayName: vData?.displayName || currentUser.displayName || null,
          tagName: vData?.tagName || null,
          avatarUrl: vData?.avatarUrl || currentUser.photoURL || null,
          lastVisitedAt: serverTimestamp()
        }, { merge: true });
      } catch(e){
        console.warn('visitor record failed', e);
      }
    }
    
    // Subscribe posts
    subscribePosts(uid);
    
  } catch(err){
    console.error('loadProfile error', err);
    profileArea.innerHTML = `<div class="text-center p-4 text-danger">Lỗi khi tải thông tin người dùng.</div>`;
  }
}

/* ========== ACHIEVEMENT SYSTEM ========== */

async function updateAchievementStatus(uid, userDoc) {
  if (!uid || !userDoc) {
    console.warn('updateAchievementStatus: missing uid or userDoc');
    return;
  }
  
  const createdAt = userDoc.createdAt?.toDate?.() || (userDoc.createdAt ? new Date(userDoc.createdAt) : null);
  if (!createdAt) {
    console.warn('updateAchievementStatus: no createdAt date');
    return;
  }
  
  const now = new Date();
  const elapsed = now - createdAt;
  
  const MS = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };
  
  const milestones = [
    { key: '1_day', target: MS.day },
    { key: '1_week', target: MS.week },
    { key: '1_month', target: MS.month },
    { key: '1_year', target: MS.year },
    { key: '2_years', target: 2 * MS.year },
    { key: '3_years', target: 3 * MS.year },
    { key: '4_years', target: 4 * MS.year },
    { key: '5_years', target: 5 * MS.year },
    { key: '10_years', target: 10 * MS.year }
  ];
  
  const achievementsData = userDoc.achievements?.companionship || {};
  let needsUpdate = false;
  const updates = {};
  
  milestones.forEach(ms => {
    const completed = elapsed >= ms.target;
    const existing = achievementsData[ms.key];
    
    if (completed && (!existing || !existing.completed)) {
      updates[`achievements.companionship.${ms.key}`] = {
        completed: true,
        completedAt: serverTimestamp()
      };
      needsUpdate = true;
    }
  });
  
  if (needsUpdate) {
    try {
      await updateDoc(doc(db, 'users', uid), updates);
      console.log('✅ Achievements updated');
    } catch (err) {
      console.error('Achievement update error:', err);
    }
  }
}

function renderAchievementsWithGroups(userDoc) {
  if (!achievementsContainer) return;
  
  try {
    const createdAt = userDoc.createdAt?.toDate?.() || (userDoc.createdAt ? new Date(userDoc.createdAt) : null);
    const now = new Date();
    const elapsed = createdAt ? now - createdAt : 0;
  
  const MS = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000
  };
  
  const milestones = [
    { key: '1_day', label: '1 Ngày', target: MS.day, reward: 'bronze_star' },
    { key: '1_week', label: '1 Tuần', target: MS.week, reward: 'emerald_ring' },
    { key: '1_month', label: '1 Tháng', target: MS.month, reward: 'sapphire_crown' },
    { key: '1_year', label: '1 Năm', target: MS.year, reward: 'ruby_flame' },
    { key: '2_years', label: '2 Năm', target: 2 * MS.year, reward: 'amethyst_shield' },
    { key: '3_years', label: '3 Năm', target: 3 * MS.year, reward: 'diamond_halo' },
    { key: '4_years', label: '4 Năm', target: 4 * MS.year, reward: 'platinum_wings' },
    { key: '5_years', label: '5 Năm', target: 5 * MS.year, reward: 'mythic_aurora' },
    { key: '10_years', label: '10 Năm', target: 10 * MS.year, reward: 'eternal_galaxy' },
    { key: 'infinite', label: 'Năm vô hạn', target: 10 * MS.year, reward: null }
  ];
  
  let completedCount = 0;
  const totalCount = milestones.length;
  
  const achievementItems = milestones.map(ms => {
    let pct = 0;
    let completed = false;
    let subtitle = '';
    
    if (!createdAt) {
      subtitle = 'Chưa có dữ liệu';
    } else {
      if (ms.key === 'infinite') {
        const years = Math.floor(elapsed / MS.year);
        const intoYear = elapsed - (years * MS.year);
        pct = (intoYear / MS.year) * 100;
        subtitle = `Đã đồng hành ${years} năm — ${Math.round(pct)}% tiến trình năm tiếp theo`;
      } else {
        pct = Math.min(100, (elapsed / ms.target) * 100);
        completed = pct >= 100;
        subtitle = completed 
          ? `✓ Đã hoàn thành` 
          : `${Math.round(pct)}% - còn ${formatTimeRemaining(ms.target - elapsed)}`;
      }
    }
    
    if (completed) completedCount++;
    
    // Get frame info for reward
    let rewardInfo = '';
    if (ms.reward && avatarFramesData) {
      const allFrames = [...avatarFramesData.free, ...avatarFramesData.special];
      const frame = allFrames.find(f => f.id === ms.reward);
      if (frame) {
        rewardInfo = `
          <div class="achievement-reward-badge">
            <i class="bi bi-award-fill"></i> Phần thưởng: ${frame.name}
          </div>
        `;
      }
    }
    
    return `
      <div class="col-12">
        <div class="achievement-card ${completed ? 'completed' : ''}">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="achievement-title">
                ${completed ? '<i class="bi bi-check-circle-fill text-success"></i>' : '<i class="bi bi-hourglass-split"></i>'}
                ${ms.label}
              </div>
              <div class="achievement-meta">${subtitle}</div>
              ${rewardInfo}
            </div>
            <div>
              <i class="bi bi-award-fill fs-3 ${completed ? 'text-success' : 'text-muted'}"></i>
            </div>
          </div>
          <div class="achievement-bar">
            <div class="achievement-progress" style="width: ${Math.max(0, Math.min(100, Math.round(pct)))}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  const progressPct = Math.round((completedCount / totalCount) * 100);
  
  achievementsContainer.innerHTML = `
    <div class="achievement-groups-container">
      <div class="achievement-group expanded" id="companionshipGroup">
        <div class="achievement-group-header" onclick="toggleAchievementGroup('companionshipGroup')">
          <div class="achievement-group-title-section">
            <div class="achievement-group-icon">
              <i class="bi bi-heart-fill text-white"></i>
            </div>
            <div class="achievement-group-info">
              <h4>Đồng hành</h4>
              <p>Thành tích về thời gian đồng hành cùng Relife</p>
            </div>
          </div>
          
          <div class="achievement-group-stats">
            <div class="achievement-progress-circle">
              <svg width="60" height="60">
                <circle cx="30" cy="30" r="25" fill="none" stroke="#eef2ff" stroke-width="5"/>
                <circle cx="30" cy="30" r="25" fill="none" stroke="#0d6efd" stroke-width="5"
                        stroke-dasharray="${2 * Math.PI * 25}" 
                        stroke-dashoffset="${2 * Math.PI * 25 * (1 - progressPct / 100)}"
                        transform="rotate(-90 30 30)"/>
              </svg>
              <div class="achievement-progress-text">${progressPct}%</div>
            </div>
            <div>
              <div style="font-weight: 700; font-size: 1.1rem;">${completedCount}/${totalCount}</div>
              <div style="font-size: 0.85rem; color: #6c757d;">Hoàn thành</div>
            </div>
            <i class="bi bi-chevron-down achievement-expand-icon"></i>
          </div>
        </div>
        
        <div class="achievement-group-content">
          <div class="achievement-items-grid">
            ${achievementItems}
          </div>
        </div>
      </div>
    </div>
  `;
  } catch (err) {
    console.error('renderAchievementsWithGroups error:', err);
    achievementsContainer.innerHTML = `
      <div class="alert alert-danger">
        Lỗi khi hiển thị thành tích. Vui lòng thử lại sau.
      </div>
    `;
  }
}

window.toggleAchievementGroup = function(groupId) {
  const group = document.getElementById(groupId);
  if (group) {
    group.classList.toggle('expanded');
  }
};

function formatTimeRemaining(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  
  if (days > 365) {
    const years = Math.floor(days / 365);
    return `${years} năm`;
  } else if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months} tháng`;
  } else if (days > 0) {
    return `${days} ngày`;
  } else {
    return `${hours} giờ`;
  }
}

/* ========== EDIT FORM WITH COVER & FRAMES ========== */

function showEditForm(profile, uid) {
  const editArea = document.getElementById('editArea');
  if (!editArea) return;
  
  editArea.style.display = 'block';
  
  const currentFrame = profile.avatarFrame || 'none';
  const coverSettings = profile.coverPhotoSettings || { scale: 1, translateX: 0, translateY: 0 };
  const avatarSettings = profile.avatarSettings || { scale: 1, translateX: 0, translateY: 0 };
  
  // Calculate unlocked frames
  const achievements = profile.achievements?.companionship || {};
  const unlockedFrames = [];
  
  if (avatarFramesData) {
    const allFrames = [...avatarFramesData.free, ...avatarFramesData.special];
    allFrames.forEach(frame => {
      if (frame.type === 'free') {
        unlockedFrames.push(frame.id);
      } else if (frame.requirement && achievements[frame.requirement]?.completed) {
        unlockedFrames.push(frame.id);
      }
    });
  }
  
  selectedFrameId = currentFrame;
  
  const currentAvatar = profile.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName||'U')}&background=0D6EFD&color=fff&size=256`;
  
  editArea.innerHTML = `
    <form id="profileEditForm" class="p-3 border rounded bg-white">
      <h6 class="mb-3 fw-bold">
        <i class="bi bi-person-gear me-2"></i>Chỉnh sửa thông tin cá nhân
      </h6>
      
      <!-- Cover Photo Section -->
      <div class="cover-editor-section mb-4">
        <h6 class="mb-3"><i class="bi bi-image"></i> Ảnh bìa</h6>
        
        <div class="cover-preview-container">
          <img id="coverPreview" class="cover-preview-image" 
               src="${profile.coverPhotoUrl || ''}" 
               style="display: ${profile.coverPhotoUrl ? 'block' : 'none'}; transform: scale(${coverSettings.scale}) translate(${coverSettings.translateX}%, ${coverSettings.translateY}%);">
        </div>
        
        <div class="mb-3">
          <label class="form-label">URL ảnh bìa</label>
          <input type="url" class="form-control" id="editCoverUrl" 
                 value="${profile.coverPhotoUrl || ''}" 
                 placeholder="https://example.com/cover.jpg">
          <small class="form-text text-muted">Kích thước đề xuất: 1200x280px</small>
        </div>
        
        <div class="cover-controls">
          <div class="cover-control-group">
            <label class="cover-control-label">
              <i class="bi bi-zoom-in"></i> Phóng to/Thu nhỏ: <span id="coverScaleValue">${Math.round(coverSettings.scale * 100)}%</span>
            </label>
            <input type="range" class="cover-slider" id="coverScale" 
                   min="0.5" max="2" step="0.1" value="${coverSettings.scale}">
          </div>
          
          <div class="cover-control-group">
            <label class="cover-control-label">
              <i class="bi bi-arrow-left-right"></i> Di chuyển ngang: <span id="coverXValue">${coverSettings.translateX}%</span>
            </label>
            <input type="range" class="cover-slider" id="coverTranslateX" 
                   min="-100" max="100" step="5" value="${coverSettings.translateX}">
          </div>
          
          <div class="cover-control-group">
            <label class="cover-control-label">
              <i class="bi bi-arrow-down-up"></i> Di chuyển dọc: <span id="coverYValue">${coverSettings.translateY}%</span>
            </label>
            <input type="range" class="cover-slider" id="coverTranslateY" 
                   min="-100" max="100" step="5" value="${coverSettings.translateY}">
          </div>
          
          <div class="cover-control-group">
            <button type="button" class="btn btn-sm btn-outline-secondary w-100" id="resetCoverBtn">
              <i class="bi bi-arrow-counterclockwise"></i> Đặt lại
            </button>
          </div>
        </div>
      </div>
      
      <!-- Avatar Frame Selector -->
      <div class="avatar-frame-selector mb-4">
        <h6 class="frame-selector-title">
          <i class="bi bi-award"></i> Khung avatar
        </h6>
        
        <div class="frame-grid" id="frameGrid">
          ${renderFrameOptions(currentFrame, unlockedFrames, profile)}
        </div>
      </div>
      
      <!-- Avatar Editor -->
      <div class="mb-3">
        <label class="form-label fw-bold">
          <i class="bi bi-image me-1"></i>Ảnh đại diện
        </label>
        <div class="d-flex gap-3 align-items-start avatar-editor-container">
          <div>
            <img id="avatarPreview" src="${currentAvatar}" 
                 class="rounded-circle" 
                 style="width:120px;height:120px;object-fit:cover;border:3px solid #dee2e6;"
                 alt="avatar preview">
          </div>
          <div class="flex-fill">
            <input 
              id="editAvatarUrl" 
              type="url"
              class="form-control mb-2" 
              placeholder="https://example.com/avatar.jpg"
              value="${profile.avatarUrl || ''}">
            <div class="form-note mb-2">
              <i class="bi bi-info-circle me-1"></i>
              Nhập URL ảnh từ internet (imgur.com, ibb.co, v.v.).
            </div>
          </div>
        </div>
      </div>
      
      <!-- Other fields -->
      <div class="mb-3">
        <label class="form-label fw-bold">
          <i class="bi bi-person me-1"></i>Tên hiển thị
        </label>
        <input 
          id="editDisplayName" 
          type="text" 
          class="form-control" 
          value="${esc(profile.displayName || '')}" 
          placeholder="Tên của bạn">
      </div>
      
      <div class="mb-3">
        <label class="form-label fw-bold">
          <i class="bi bi-at me-1"></i>Tên người dùng (TagName)
        </label>
        <input 
          id="editTagName" 
          type="text" 
          class="form-control" 
          value="${esc(profile.tagName || '')}" 
          placeholder="username">
        <div class="form-note">
          <i class="bi bi-info-circle me-1"></i>
          Tên này sẽ hiển thị là @username
        </div>
      </div>
      
      <div class="mb-3">
        <label class="form-label fw-bold">
          <i class="bi bi-file-text me-1"></i>Giới thiệu bản thân
        </label>
        <textarea 
          id="editBio" 
          class="form-control" 
          rows="3" 
          placeholder="Viết một vài điều về bản thân...">${esc(profile.bio || '')}</textarea>
      </div>
      
      <div class="row g-2 mb-3">
        <div class="col-md-4">
          <label class="form-label">Giới tính</label>
          <select id="editGender" class="form-select">
            <option value="">Không chọn</option>
            <option value="Nam" ${profile.gender === 'Nam' ? 'selected' : ''}>Nam</option>
            <option value="Nữ" ${profile.gender === 'Nữ' ? 'selected' : ''}>Nữ</option>
            <option value="Khác" ${profile.gender === 'Khác' ? 'selected' : ''}>Khác</option>
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label">Ngày sinh</label>
          <input 
            id="editBirthday" 
            type="date" 
            class="form-control" 
            value="${profile.birthday || ''}">
        </div>
        <div class="col-md-4">
          <label class="form-label">Quốc gia</label>
          <input 
            id="editCountry" 
            type="text" 
            class="form-control" 
            value="${esc(profile.country || '')}" 
            placeholder="Việt Nam">
        </div>
      </div>
      
      <div class="d-flex gap-2 editor-buttons">
        <button type="submit" class="btn btn-primary">
          <i class="bi bi-check-lg me-1"></i>Lưu thay đổi
        </button>
        <button type="button" class="btn btn-outline-secondary" id="cancelEditBtn">
          <i class="bi bi-x-lg me-1"></i>Hủy
        </button>
      </div>
      
      <div id="editMessage" class="mt-3"></div>
    </form>
  `;
  
  // Event listeners
  setupEditFormEventListeners(uid, profile);
}

function renderFrameOptions(selectedFrame, unlockedFrames, profile) {
  if (!avatarFramesData) return '';
  
  const allFrames = [...avatarFramesData.free, ...avatarFramesData.special];
  const avatarUrl = profile.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName || 'U')}&background=0D6EFD&color=fff&size=64`;
  
  return allFrames.map(frame => {
    const isUnlocked = unlockedFrames.includes(frame.id);
    const isSelected = frame.id === selectedFrame;
    const classes = `frame-option ${isSelected ? 'selected' : ''} ${!isUnlocked ? 'locked' : ''}`;
    
    return `
      <div class="${classes}" data-frame-id="${frame.id}" ${isUnlocked ? `onclick="window.selectFrame('${frame.id}')"` : ''}>
        <div class="frame-preview-wrapper">
          <img class="frame-preview-avatar" src="${avatarUrl}" alt="Avatar">
          ${frame.image ? `<img class="frame-preview-border" src="${frame.image}" alt="${frame.name}">` : ''}
        </div>
        ${!isUnlocked ? `
          <div class="frame-lock-icon">
            <i class="bi bi-lock-fill"></i>
          </div>
        ` : ''}
        <div class="frame-name">
          ${frame.name}
          ${!isUnlocked && frame.requirementText ? `
            <div class="frame-unlock-requirement">${frame.requirementText}</div>
          ` : ''}
        </div>
        ${!isUnlocked ? `
          <div class="frame-tooltip">Hoàn thành thành tích "${frame.requirementText}" để mở khóa</div>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.selectFrame = function(frameId) {
  selectedFrameId = frameId;
  
  // Update UI
  document.querySelectorAll('.frame-option').forEach(opt => {
    opt.classList.remove('selected');
  });
  const selected = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (selected) {
    selected.classList.add('selected');
  }
};

function setupEditFormEventListeners(uid, profile) {
  // Cover photo URL change
  const editCoverUrl = document.getElementById('editCoverUrl');
  const coverPreview = document.getElementById('coverPreview');
  
  if (editCoverUrl && coverPreview) {
    editCoverUrl.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      
      if (url) {
        coverPreview.src = url;
        coverPreview.style.display = 'block';
      } else {
        coverPreview.style.display = 'none';
      }
    });
  }
  
  // Cover controls
  const coverScale = document.getElementById('coverScale');
  const coverTranslateX = document.getElementById('coverTranslateX');
  const coverTranslateY = document.getElementById('coverTranslateY');
  
  function updateCoverPreview() {
    if (!coverPreview) return;
    const scale = coverScale?.value || 1;
    const x = coverTranslateX?.value || 0;
    const y = coverTranslateY?.value || 0;
    
    coverPreview.style.transform = `scale(${scale}) translate(${x}%, ${y}%)`;
  }
  
  if (coverScale) {
    coverScale.addEventListener('input', (e) => {
      const val = e.target.value;
      const scaleValue = document.getElementById('coverScaleValue');
      if (scaleValue) {
        scaleValue.textContent = Math.round(val * 100) + '%';
      }
      updateCoverPreview();
    });
  }
  
  if (coverTranslateX) {
    coverTranslateX.addEventListener('input', (e) => {
      const xValue = document.getElementById('coverXValue');
      if (xValue) {
        xValue.textContent = e.target.value + '%';
      }
      updateCoverPreview();
    });
  }
  
  if (coverTranslateY) {
    coverTranslateY.addEventListener('input', (e) => {
      const yValue = document.getElementById('coverYValue');
      if (yValue) {
        yValue.textContent = e.target.value + '%';
      }
      updateCoverPreview();
    });
  }
  
  // Reset cover button
  const resetCoverBtn = document.getElementById('resetCoverBtn');
  if (resetCoverBtn) {
    resetCoverBtn.addEventListener('click', () => {
      if (coverScale) coverScale.value = 1;
      if (coverTranslateX) coverTranslateX.value = 0;
      if (coverTranslateY) coverTranslateY.value = 0;
      
      const scaleValue = document.getElementById('coverScaleValue');
      const xValue = document.getElementById('coverXValue');
      const yValue = document.getElementById('coverYValue');
      
      if (scaleValue) scaleValue.textContent = '100%';
      if (xValue) xValue.textContent = '0%';
      if (yValue) yValue.textContent = '0%';
      
      updateCoverPreview();
    });
  }
  
  // Avatar preview
  const editAvatarUrl = document.getElementById('editAvatarUrl');
  const avatarPreview = document.getElementById('avatarPreview');
  
  if (editAvatarUrl && avatarPreview) {
    editAvatarUrl.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url) {
        avatarPreview.src = url;
      }
    });
  }
  
  // Form submit
  const form = document.getElementById('profileEditForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveProfileEdits(uid, profile);
    });
  }
  
  // Cancel button
  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const editArea = document.getElementById('editArea');
      if (editArea) {
        editArea.style.display = 'none';
      }
    });
  }
}

async function saveProfileEdits(uid, oldProfile) {
  const editMsg = document.getElementById('editMessage');
  if (!editMsg) return;
  
  editMsg.textContent = '⏳ Đang lưu...';
  editMsg.className = 'alert alert-info';
  
  try {
    const newDisplayName = document.getElementById('editDisplayName')?.value.trim() || oldProfile.displayName;
    const newTagName = document.getElementById('editTagName')?.value.trim() || null;
    const newBio = document.getElementById('editBio')?.value.trim() || null;
    const newAvatarUrl = document.getElementById('editAvatarUrl')?.value.trim() || null;
    const newGender = document.getElementById('editGender')?.value || null;
    const newBirthday = document.getElementById('editBirthday')?.value || null;
    const newCountry = document.getElementById('editCountry')?.value.trim() || null;
    
    const updates = {
      displayName: newDisplayName,
      tagName: newTagName,
      bio: newBio,
      avatarUrl: newAvatarUrl,
      gender: newGender,
      birthday: newBirthday,
      country: newCountry,
      coverPhotoUrl: document.getElementById('editCoverUrl')?.value.trim() || null,
      coverPhotoSettings: {
        scale: parseFloat(document.getElementById('coverScale')?.value || 1),
        translateX: parseInt(document.getElementById('coverTranslateX')?.value || 0),
        translateY: parseInt(document.getElementById('coverTranslateY')?.value || 0)
      },
      avatarFrame: selectedFrameId === 'none' ? null : selectedFrameId,
      updatedAt: serverTimestamp()
    };
    
    await updateDoc(doc(db, 'users', uid), updates);
    
    editMsg.textContent = '✅ Đã lưu thành công!';
    editMsg.className = 'alert alert-success';
    
    // Update main avatar immediately
    const mainAvatar = document.getElementById('profileAvatarImg');
    if (mainAvatar) {
      mainAvatar.src = newAvatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(newDisplayName)}&background=0D6EFD&color=fff&size=256`;
    }
    
    // Propagate to posts and comments
    if (newDisplayName !== oldProfile.displayName) {
      editMsg.textContent = '✅ Đã lưu! Đang cập nhật bài viết và bình luận...';
      await propagateProfileToPostsAndComments(uid, { displayName: newDisplayName });
    }
    
    // Reload profile
    await loadProfile(uid);
    
    setTimeout(() => {
      const editArea = document.getElementById('editArea');
      if (editArea) {
        editArea.style.display = 'none';
      }
    }, 1500);
    
  } catch (err) {
    console.error('Save error:', err);
    editMsg.textContent = '❌ Lỗi: ' + err.message;
    editMsg.className = 'alert alert-danger';
  }
}

/* ========== HELPER FUNCTIONS ========== */

function userAvatarUrlFor(user){
  if(!user) return '';
  if(user.photoURL) return user.photoURL;
  if(user.avatarUrl) return user.avatarUrl;
  if(user.email) return `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName||user.email)}&background=0D6EFD&color=fff&size=120`;
  return `https://ui-avatars.com/api/?name=U&background=0D6EFD&color=fff&size=120`;
}

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
      ? `<button onclick="window.doUnfollow('${profileId}')" class="btn btn-sm btn-outline-secondary btn-rounded">Đang theo dõi</button>`
      : `<button onclick="window.doFollow('${profileId}')" class="btn btn-sm btn-primary btn-rounded">Theo dõi</button>`;
    actionArea.innerHTML = btnHtml;
  } catch(e){
    console.error('renderFollowActionArea error', e);
    actionArea.innerHTML = `<button class="btn btn-sm btn-outline-secondary btn-rounded disabled">Lỗi</button>`;
  }
}

window.doFollow = async function(profileId){
  if(!currentUser) return;
  try {
    await setDoc(doc(db,'users',profileId,'followers', currentUser.uid), {
      displayName: currentUser.displayName || null,
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db,'users', currentUser.uid,'following', profileId), {
      displayName: userDoc?.displayName || null,
      createdAt: serverTimestamp()
    });
    await renderFollowActionArea(profileId);
  } catch(e){
    console.error('doFollow error', e);
    alert('Không thể theo dõi');
  }
};

window.doUnfollow = async function(profileId){
  if(!currentUser) return;
  try {
    await deleteDoc(doc(db,'users',profileId,'followers', currentUser.uid));
    await deleteDoc(doc(db,'users', currentUser.uid,'following', profileId));
    await renderFollowActionArea(profileId);
  } catch(e){
    console.error('doUnfollow error', e);
    alert('Không thể bỏ theo dõi');
  }
};

/* ========== POSTS SUBSCRIPTION ========== */

function subscribePosts(uid){
  if(postsUnsub) postsUnsub();
  const postsArea = document.getElementById('profilePostsArea');
  if(!postsArea) return;

  const q = query(collection(db,'posts'), where('userId','==', uid), orderBy('createdAt','desc'));
  postsUnsub = onSnapshot(q, snap => {
    if(snap.empty){
      postsArea.innerHTML = '<div class="text-center p-4 text-muted">Chưa có bài viết nào</div>';
      return;
    }

    postsArea.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const hashtags = (p.hashtags || []).map(h => `<a href="tag.html?tag=${encodeURIComponent(h)}" class="hashtag">${esc(h)}</a>`).join(' ');
      return `
        <div class="post-card" data-post-id="${d.id}">
          <div class="post-header">
            <div class="post-author-info">
              <img src="${userAvatarUrlFor(p)}" class="post-avatar" alt="avatar">
              <div>
                <div class="post-author">${esc(p.displayName || 'Người dùng')}</div>
                <div class="post-meta">${fmtDate(p.createdAt)}</div>
              </div>
            </div>
            ${currentUser && currentUser.uid === uid ? `
              <div class="dropdown">
                <button class="btn btn-sm btn-link text-secondary" data-bs-toggle="dropdown">
                  <i class="bi bi-three-dots-vertical"></i>
                </button>
                <ul class="dropdown-menu">
                  <li><a class="dropdown-item" href="#" onclick="window.openEditPost('${d.id}')"><i class="bi bi-pencil me-2"></i>Sửa</a></li>
                  <li><a class="dropdown-item text-danger" href="#" onclick="window.confirmDeletePost('${d.id}')"><i class="bi bi-trash me-2"></i>Xóa</a></li>
                </ul>
              </div>
            ` : ''}
          </div>
          <div class="post-content">
            <h5 class="post-title">${esc(p.title || '')}</h5>
            ${hashtags ? `<div class="post-hashtags mb-2">${hashtags}</div>` : ''}
          </div>
          <div class="post-actions">
            <button class="post-action-btn"><i class="bi bi-hand-thumbs-up"></i> ${p.likes || 0}</button>
            <button class="post-action-btn"><i class="bi bi-hand-thumbs-down"></i> ${p.dislikes || 0}</button>
            <button class="post-action-btn" onclick="window.openCommentsModal('${d.id}')"><i class="bi bi-chat"></i> ${p.commentsCount || 0}</button>
            <a href="post.html?id=${d.id}" class="btn btn-sm btn-link">Xem bài <i class="bi bi-arrow-right"></i></a>
          </div>
        </div>
      `;
    }).join('');
  }, err => {
    console.error('posts subscription error', err);
    postsArea.innerHTML = '<div class="text-center p-4 text-danger">Lỗi khi tải bài viết</div>';
  });
}

/* ========== COMMENTS MODAL ========== */

window.openCommentsModal = function(postId){
  if(commentsSubsCleanup) commentsSubsCleanup();
  
  document.getElementById('profileCommentsTitle').textContent = 'Bình luận';
  document.getElementById('profileCommentsList').innerHTML = '<div class="text-center p-3 text-muted">Đang tải...</div>';
  commentsModal.show();
  
  const q = query(collection(db,'posts',postId,'comments'), orderBy('createdAt','desc'));
  const unsub = onSnapshot(q, snap => {
    const list = document.getElementById('profileCommentsList');
    if(snap.empty){
      list.innerHTML = '<div class="text-center p-3 text-muted">Chưa có bình luận</div>';
      return;
    }
    
    list.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `
        <div class="comment-item">
          <div class="comment-header">
            <img src="${userAvatarUrlFor(c)}" class="comment-avatar" alt="avatar">
            <div>
              <div class="comment-author">${esc(c.displayName || 'Người dùng')}</div>
              <div class="comment-meta">${fmtDate(c.createdAt)}</div>
            </div>
          </div>
          <div class="comment-text">${esc(c.text || '')}</div>
        </div>
      `;
    }).join('');
  });
  
  commentsSubsCleanup = unsub;
  
  // Comment form
  const mustLogin = document.getElementById('profileMustLoginToComment');
  const commentForm = document.getElementById('profileCommentForm');
  
  if(mustLogin && commentForm){
    if(!currentUser){
      mustLogin.style.display = 'block';
      commentForm.style.display = 'none';
    } else {
      mustLogin.style.display = 'none';
      commentForm.style.display = 'block';
      
      commentForm.onsubmit = async (e) => {
        e.preventDefault();
        const textarea = document.getElementById('profileCommentText');
        const text = textarea?.value.trim();
        if(!text) return;
        
        try {
          await addDoc(collection(db,'posts',postId,'comments'), {
            text,
            userId: currentUser.uid,
            displayName: currentUser.displayName || currentUser.email || 'Người dùng',
            createdAt: serverTimestamp()
          });
          
          textarea.value = '';
          
          try {
            await updateDoc(doc(db,'posts',postId), {
              commentsCount: increment(1)
            });
          } catch(e){
            console.warn('Cannot update commentsCount', e);
          }
        } catch(err){
          console.error('Add comment error', err);
          alert('Không thể thêm bình luận');
        }
      };
    }
  }
};

/* ========== POST EDITOR ========== */

window.openEditPost = async function(postId){
  ensureQuill();
  const postSnap = await getDoc(doc(db,'posts',postId));
  if(!postSnap.exists()) return alert('Bài viết không tồn tại');
  
  const post = postSnap.data();
  document.getElementById('postTitle').value = post.title || '';
  document.getElementById('postHashtags').value = (post.hashtags || []).join(' ');
  quillEditor.root.innerHTML = post.content || '';
  
  postEditorModalEl.dataset.postId = postId;
  postEditorModalEl.dataset.mode = 'edit';
  postEditorModal.show();
};

postEditorForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = postEditorModalEl.dataset.mode;
  const postId = postEditorModalEl.dataset.postId;
  
  const title = document.getElementById('postTitle').value.trim();
  const hashtagsInput = document.getElementById('postHashtags').value.trim();
  const hashtags = hashtagsInput ? hashtagsInput.split(/\s+/).map(h => h.startsWith('#') ? h : '#'+h) : [];
  const content = quillEditor.root.innerHTML;
  
  if(!title){
    return alert('Vui lòng nhập tiêu đề');
  }
  
  try {
    if(mode === 'edit' && postId){
      await updateDoc(doc(db,'posts',postId), {
        title,
        hashtags,
        content,
        updatedAt: serverTimestamp()
      });
      alert('Đã cập nhật bài viết');
    }
    
    postEditorModal.hide();
    quillEditor.root.innerHTML = '';
    document.getElementById('postTitle').value = '';
    document.getElementById('postHashtags').value = '';
  } catch(err){
    console.error('Save post error', err);
    alert('Lỗi khi lưu bài viết');
  }
});

window.confirmDeletePost = async function(postId){
  if(!confirm('Xóa bài viết này? Hành động không thể hoàn tác.')) return;
  try {
    await deleteDoc(doc(db,'posts',postId));
    alert('Đã xóa bài');
  } catch(e){
    console.error('deletePost error', e);
    alert('Không thể xóa bài');
  }
};

/* ========== PROPAGATE PROFILE ========== */

async function propagateProfileToPostsAndComments(uid, updates){
  if(!uid) return { updatedPosts:0, updatedComments:0, totalPosts:0 };
  const BATCH_SIZE = 450;
  const postsSnap = await getDocs(query(collection(db,'posts'), where('userId','==', uid)));
  if(postsSnap.empty) return { updatedPosts:0, updatedComments:0, totalPosts:0 };
  
  const posts = postsSnap.docs;
  let totalPosts = posts.length;
  let updatedPosts = 0;
  let updatedComments = 0;

  for(let i=0;i<posts.length;i++){
    const pDoc = posts[i];
    
    try {
      await updateDoc(doc(db,'posts',pDoc.id), updates);
      updatedPosts++;
    } catch(e){
      console.warn('propagate: update post failed', pDoc.id, e);
    }

    try {
      const commentsQ = query(collection(db,'posts',pDoc.id,'comments'), where('userId','==', uid));
      const cSnap = await getDocs(commentsQ);
      if(!cSnap.empty){
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
  }

  return { updatedPosts, updatedComments, totalPosts };
}

/* ========== VISITORS MODAL ========== */

openVisitorsBtn?.addEventListener('click', async () => {
  if(!userDoc || !currentUser || currentUser.uid !== userDoc.id) return;
  
  visitorsListEl.innerHTML = '<div class="text-center p-3">Đang tải...</div>';
  new bootstrap.Modal(document.getElementById('visitorsModal')).show();
  
  try {
    const visitorsSnap = await getDocs(query(collection(db,'users',userDoc.id,'visitors'), orderBy('lastVisitedAt','desc')));
    if(visitorsSnap.empty){
      visitorsListEl.innerHTML = '<div class="text-center p-3 text-muted">Chưa có khách nào ghé thăm</div>';
      return;
    }
    
    visitorsListEl.innerHTML = visitorsSnap.docs.map(d => {
      const v = d.data();
      return `
        <div class="visitor-item" onclick="window.location.href='profile.html?user=${d.id}'">
          <img src="${v.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.displayName||'U')}&background=0D6EFD&color=fff&size=64`}" class="visitor-avatar" alt="avatar">
          <div class="visitor-info">
            <div class="visitor-name">${esc(v.displayName || 'Người dùng')}</div>
            <div class="visitor-tag">${v.tagName ? '@'+esc(v.tagName) : ''}</div>
          </div>
          <div class="visitor-time">${fmtDate(v.lastVisitedAt)}</div>
        </div>
      `;
    }).join('');
  } catch(err){
    console.error('Load visitors error', err);
    visitorsListEl.innerHTML = '<div class="text-center p-3 text-danger">Lỗi khi tải danh sách khách</div>';
  }
});

/* ========== MENU & AUTH ========== */

menuToggleBtn?.addEventListener('click', ()=> new bootstrap.Offcanvas(profileMenuCanvas).toggle());

function renderMenuAuthArea(){
  if(!menuAuthAreaProfile) return;
  if(currentUser && userDoc && currentUser.uid === userDoc.id){
    menuAuthAreaProfile.innerHTML = `
      <div class="d-flex gap-2 align-items-center">
        <img src="${userAvatarUrlFor(userDoc)}" class="user-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
        <div>
          <div class="fw-bold">${esc(userDoc.displayName||currentUser.email)}</div>
          <div class="small-muted">${esc(userDoc.email||'')}</div>
        </div>
      </div>
      <div class="mt-3">
        <button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button>
      </div>
    `;
    document.getElementById('btnLogoutProfile').addEventListener('click', async ()=> { 
      await signOut(auth); 
      new bootstrap.Offcanvas(profileMenuCanvas).hide(); 
    });
  } else if(currentUser){
    menuAuthAreaProfile.innerHTML = `
      <div class="d-flex gap-2 align-items-center">
        <img src="${userAvatarUrlFor(currentUser)}" class="user-avatar" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
        <div>
          <div class="fw-bold">${esc(currentUser.email || '')}</div>
        </div>
      </div>
      <div class="mt-3">
        <button id="btnLogoutProfile" class="btn btn-outline-danger w-100 btn-rounded">Đăng xuất</button>
      </div>
    `;
    document.getElementById('btnLogoutProfile').addEventListener('click', async ()=> { 
      await signOut(auth); 
      new bootstrap.Offcanvas(profileMenuCanvas).hide(); 
    });
  } else {
    menuAuthAreaProfile.innerHTML = `
      <div class="d-grid gap-2">
        <button id="openLoginProfile" class="btn btn-primary btn-rounded">Đăng nhập</button>
      </div>
    `;
    document.getElementById('openLoginProfile').addEventListener('click', ()=> { 
      loginModalProfile.show(); 
      new bootstrap.Offcanvas(profileMenuCanvas).hide(); 
    });
  }
}

/* ========== LOGIN FORM ========== */

document.getElementById('loginFormProfile')?.addEventListener('submit', async (ev)=>{
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

/* ========== SEARCH USERS ========== */

let searchTimeout;
profileSearchInput?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const term = e.target.value.trim().toLowerCase();
  
  if(!term){
    profileSearchResults.innerHTML = '';
    profileSearchResults.style.display = 'none';
    return;
  }
  
  searchTimeout = setTimeout(async () => {
    try {
      const usersSnap = await getDocs(collection(db,'users'));
      const matches = usersSnap.docs.filter(d => {
        const data = d.data();
        return (data.displayName?.toLowerCase().includes(term)) || 
               (data.tagName?.toLowerCase().includes(term)) ||
               (data.email?.toLowerCase().includes(term));
      }).slice(0, 5);
      
      if(matches.length === 0){
        profileSearchResults.innerHTML = '<div class="p-2 text-muted">Không tìm thấy</div>';
        profileSearchResults.style.display = 'block';
        return;
      }
      
      profileSearchResults.innerHTML = matches.map(d => {
        const u = d.data();
        return `
          <a href="profile.html?user=${d.id}" class="search-result-item">
            <img src="${userAvatarUrlFor(u)}" class="search-result-avatar" alt="avatar">
            <div>
              <div class="search-result-name">${esc(u.displayName || 'Người dùng')}</div>
              <div class="search-result-tag">${u.tagName ? '@'+esc(u.tagName) : ''}</div>
            </div>
          </a>
        `;
      }).join('');
      profileSearchResults.style.display = 'block';
    } catch(err){
      console.error('Search error', err);
    }
  }, 300);
});

// Click outside to close search results
document.addEventListener('click', (e) => {
  if(!profileSearchInput?.contains(e.target) && !profileSearchResults?.contains(e.target)){
    if(profileSearchResults){
      profileSearchResults.style.display = 'none';
    }
  }
});

/* ========== EXPOSE FUNCTIONS ========== */

window.showEditForm = async function(profile, uid){
  if(!profile && uid){
    try { 
      const s = await getDoc(doc(db,'users',uid)); 
      if(s.exists()) profile = s.data(); 
    } catch(e){}
  }
  showEditForm(profile, uid);
};
window.openEditPost = openEditPost;
window.confirmDeletePost = confirmDeletePost;
window.doFollow = doFollow;
window.doUnfollow = doUnfollow;

/* ========== AUTH HANDLING ========== */

onAuthStateChanged(auth, user => {
  currentUser = user;
  ensureQuill();
  renderMenuAuthArea();
  
  if(!profileUid){
    if(user){ 
      profileUid = user.uid; 
      loadProfile(profileUid); 
    } else { 
      profileArea.innerHTML = `
        <div class="text-center p-4">
          <div class="mb-3">Bạn chưa đăng nhập.</div>
          <div><a class="btn btn-primary" href="index.html">Về trang chủ</a></div>
        </div>
      `; 
    }
  } else {
    loadProfile(profileUid);
  }
});

/* ========== CLEANUP ========== */

window.addEventListener('beforeunload', ()=>{
  if(postsUnsub) postsUnsub();
  if(commentsSubsCleanup) commentsSubsCleanup();
});