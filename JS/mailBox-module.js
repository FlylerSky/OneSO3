// JS/mailBox-module.js — Relife MailBox Module v5
// ─────────────────────────────────────────────────────────────
// Dùng:
//   import { initMailBoxModule } from './JS/mailBox-module.js';
//   initMailBoxModule({ position: 'bottom-right' });
// ─────────────────────────────────────────────────────────────

import { initFirebase }   from '../firebase-config.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import {
  collection, query, where, onSnapshot,
  doc, getDoc, getDocs, limit
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

// ── Config ────────────────────────────────────────────────────
const W   = 'relife-mb-module';   // wrapper id
const P   = W + '-';              // child id prefix
const API = window.location.origin;

const TIER_MAP = {
  admin:'SA', dev:'SA', operator:'SA', moderator:'SA',
  advanced:'RA', user:'RA', shared:'LLA', trial:'LLA',
};
const SA_LIST = ['admin','dev','operator','moderator'];

// ── Helpers ───────────────────────────────────────────────────
const esc  = s => String(s||'').replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t    = k => TIER_MAP[k] || 'RA';
const isSA = k => t(k) === 'SA';
const avUrl = (url, name) =>
  url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name||'U')}&background=0D6EFD&color=fff&size=64`;

function fmtDate(v) {
  try {
    const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null);
    if (!d || isNaN(d)) return '';
    const s = Date.now()-d, m=Math.floor(s/6e4), h=Math.floor(s/36e5), day=Math.floor(s/864e5);
    if(m<1) return 'Vừa xong';
    if(m<60) return m+'ph'; if(h<24) return h+'g'; if(day<7) return day+'ng';
    return d.toLocaleDateString('vi-VN');
  } catch { return ''; }
}

// ── Read tracking ─────────────────────────────────────────────
const rsKey = type => `rl_r_${type}_${_uid||'x'}`;
function readSet(type) {
  try { return new Set(JSON.parse(localStorage.getItem(rsKey(type))||'[]')); }
  catch { return new Set(); }
}
function markLocal(id, type) {
  try {
    const s=[...readSet(type)]; s.push(id);
    localStorage.setItem(rsKey(type), JSON.stringify(s.slice(-300)));
  } catch {}
}

// ── State ─────────────────────────────────────────────────────
let _db=null, _auth=null, _uid=null, _userDoc=null;
let _open=false, _tab='server';
let _uSrv=null, _uInb=null;
let _unread=0, _recips=[], _deb=null, _opts={};

// ── DOM ───────────────────────────────────────────────────────
const $  = id  => document.getElementById(P+id);
const $$ = sel => document.querySelector('#'+W+' '+sel);

// ── View switcher ─────────────────────────────────────────────
// Mỗi view là .mb-view; active = .mb-active
function showView(name) {
  document.querySelectorAll('#'+W+' .mb-view').forEach(el => {
    el.classList.toggle('mb-active', el.dataset.view === name);
  });
}

function setTab(tab) {
  _tab = tab;
  document.querySelectorAll('#'+W+' .mb-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  showView(tab === 'server' ? 'server' : 'inbox');
}

function updateBadge(n) {
  _unread = n;
  const fb = $('fab-badge'), hb = $('hd-badge');
  if (fb) { fb.textContent=n>99?'99+':n; fb.style.display=n>0?'flex':'none'; }
  if (hb) { hb.textContent=n; hb.style.display=n>0?'flex':'none'; }
}

// ── API ───────────────────────────────────────────────────────
async function api(method, path, body=null) {
  const tok = await _auth.currentUser.getIdToken(false);
  const r = await fetch(API+path, {
    method,
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
    ...(body && method!=='GET' ? {body:JSON.stringify(body)} : {}),
  });
  const d = await r.json().catch(()=>({ok:false,error:'HTTP '+r.status}));
  if (!r.ok||!d.ok) throw new Error(d.error||'HTTP '+r.status);
  return d;
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, err=false) {
  const el = $('toast');
  if (!el) return;
  el.textContent = (err?'⚠ ':'✓ ')+msg;
  el.className   = 'mb-toast'+(err?' err':'')+' show';
  clearTimeout(el._t);
  el._t = setTimeout(()=>el.classList.remove('show'), 3000);
}

// ── Skeleton ──────────────────────────────────────────────────
function skels(el, n=3) {
  el.innerHTML = '<div class="mb-skels">'+Array.from({length:n},()=>`
    <div class="mb-skel">
      <div class="mb-skel-ic"></div>
      <div class="mb-skel-lines">
        <div class="mb-skel-ln mb-sl-w"></div>
        <div class="mb-skel-ln mb-sl-m"></div>
        <div class="mb-skel-ln mb-sl-s"></div>
      </div>
    </div>`).join('')+'</div>';
}

// ── Mail item ─────────────────────────────────────────────────
function mailItem(mail, type) {
  const unread = !readSet(type).has(mail.id);
  const priColor = {urgent:'#FF3B30',important:'#FF9500'}[mail.priority]||null;
  const priTag   = mail.priority==='urgent'
    ? '<span class="mb-pri-tag mb-pri-u">Khẩn</span>'
    : mail.priority==='important'
    ? '<span class="mb-pri-tag mb-pri-i">Q.Trọng</span>' : '';
  const st = type==='server' ? 'SA' : t(mail.senderType||'user');

  const el = document.createElement('div');
  el.className = 'mb-item'+(unread?' mb-unread':'');
  if (priColor) el.style.setProperty('--item-stripe', priColor);
  el.innerHTML = `
    <div class="mb-item-icon"><i class="bi ${type==='server'?'bi-globe2':'bi-envelope-fill'}"></i></div>
    <div class="mb-item-body">
      <div class="mb-item-row1">
        ${unread?'<span class="mb-dot"></span>':''}
        <span class="mb-subject">${esc(mail.subject||'(Không có tiêu đề)')}</span>
        ${priTag}
      </div>
      <div class="mb-item-row2">
        <span class="mb-sender">${esc(mail.senderName||'Hệ thống')}</span>
        <span class="mb-tier ${st==='SA'?'mb-tier-sa':'mb-tier-ra'}">${st}</span>
        <span class="mb-time">${fmtDate(mail.createdAt)}</span>
      </div>
      <div class="mb-preview">${esc((mail.body||'').substring(0,80))}</div>
    </div>`;
  el.addEventListener('click', ()=>openDetail(mail, type));
  return el;
}

// ── Detail ────────────────────────────────────────────────────
function openDetail(mail, type) {
  if (type==='dm' && mail.recipientUid===_uid) markLocal(mail.id,'dm');

  const isSACaller = isSA(_userDoc?.type||'user');
  const canDel  = isSACaller || mail.senderUid===_uid || mail.recipientUid===_uid;
  const canReply = type==='dm' && mail.senderUid!==_uid;
  const st = type==='server'?'SA':t(mail.senderType||'user');
  const sav = avUrl(mail.senderAvatarUrl, mail.senderName);
  const pb  = mail.priority==='urgent'
    ? '<span class="mb-pri-badge u">🚨 Khẩn</span>'
    : mail.priority==='important'
    ? '<span class="mb-pri-badge i">⚠ Q.Trọng</span>' : '';

  const view = $('view-detail');
  if (!view) return;
  view.innerHTML = `
    <div class="mb-detail-hd">
      <button class="mb-back" id="${P}back"><i class="bi bi-arrow-left"></i></button>
      <span class="mb-detail-title">${esc(mail.subject||'(Không có tiêu đề)')}</span>
    </div>
    <div class="mb-meta-bar">
      <div class="mb-sender-row">
        <img src="${esc(sav)}" class="mb-sender-av" alt="">
        <div>
          <div class="mb-sender-name">${esc(mail.senderName||'Hệ thống')}</div>
          <div class="mb-sender-time">${fmtDate(mail.createdAt)}</div>
        </div>
      </div>
      <span class="mb-tier ${st==='SA'?'mb-tier-sa':'mb-tier-ra'}">${st}</span>
      ${pb}
    </div>
    <div class="mb-body-text">${esc(mail.body||'')}</div>
    <div class="mb-detail-actions">
      ${canReply ? `<button class="mb-act-btn mb-btn-reply"  id="${P}reply"><i class="bi bi-reply-fill"></i>Trả lời</button>` : ''}
      ${canDel   ? `<button class="mb-act-btn mb-btn-delete" id="${P}delbtn"><i class="bi bi-trash3"></i>Xóa</button>` : ''}
    </div>`;

  showView('detail');

  $('back')?.addEventListener('click', ()=>showView(_tab==='server'?'server':'inbox'));

  $('reply')?.addEventListener('click', ()=>{
    showView(_tab==='server'?'server':'inbox');
    openCompose({uid:mail.senderUid, name:mail.senderName||'Ẩn danh',
      tag:mail.senderTag||'', type:mail.senderType||'user', avatarUrl:mail.senderAvatarUrl||null},
      mail.subject?.startsWith('Re: ') ? mail.subject : 'Re: '+(mail.subject||''));
  });

  $('delbtn')?.addEventListener('click', async()=>{
    const btn=$('delbtn'); if(!btn) return;
    btn.disabled=true; btn.innerHTML='<span class="mb-spin"></span>';
    try {
      await api('DELETE','/api/mail/delete',{mailId:mail.id,collection:type});
      showView(_tab==='server'?'server':'inbox'); toast('Đã xóa thư');
    } catch(e) {
      toast(e.message,true); btn.disabled=false;
      btn.innerHTML='<i class="bi bi-trash3"></i>Xóa';
    }
  });

  if(type==='dm' && mail.recipientUid===_uid)
    api('POST','/api/mail/mark-read',{mailId:mail.id}).catch(()=>{});
}

// ── Compose ───────────────────────────────────────────────────
function openCompose(prefR=null, prefS='') {
  _recips = prefR ? [prefR] : [];
  const isS = isSA(_userDoc?.type||'user');
  let mode  = 'dm';

  const view = $('view-compose');
  if (!view) return;
  view.innerHTML = `
    <div class="mb-detail-hd">
      <button class="mb-back" id="${P}cback"><i class="bi bi-arrow-left"></i></button>
      <span class="mb-detail-title">Soạn thư</span>
    </div>
    <div class="mb-compose-scroll">
      ${isS?`<div class="mb-seg">
        <button class="mb-seg-btn active" id="${P}sdm"><i class="bi bi-person-fill"></i> Thư riêng</button>
        <button class="mb-seg-btn"        id="${P}ssv"><i class="bi bi-globe2"></i> Toàn server</button>
      </div>`:''}

      <div id="${P}rwrap">
        <div class="mb-label"><i class="bi bi-people"></i>Người nhận
          <span id="${P}rhint" class="mb-label-hint"></span>
        </div>
        <div class="mb-srow">
          <i class="bi bi-search"></i>
          <input id="${P}ri" class="mb-input" placeholder="Tên hoặc @tag...">
        </div>
        <div id="${P}rres" class="mb-rr" style="display:none;"></div>
        <div id="${P}rchips" class="mb-chips"></div>
      </div>

      <div class="mb-label"><i class="bi bi-card-heading"></i>Tiêu đề</div>
      <input id="${P}subj" class="mb-field" maxlength="120" placeholder="Nhập tiêu đề..." value="${esc(prefS)}">

      <div class="mb-label"><i class="bi bi-body-text"></i>Nội dung</div>
      <textarea id="${P}cbody" class="mb-field mb-textarea" placeholder="Nội dung thư..." maxlength="2000" rows="5"></textarea>

      ${isS?`<div class="mb-label"><i class="bi bi-flag"></i>Ưu tiên</div>
        <div class="mb-prow">
          <label class="mb-popt"><input type="radio" name="mbp" value="normal" checked><span>Thường</span></label>
          <label class="mb-popt"><input type="radio" name="mbp" value="important"><span>⚠ Quan trọng</span></label>
          <label class="mb-popt"><input type="radio" name="mbp" value="urgent"><span>🚨 Khẩn</span></label>
        </div>`:''}

      <div id="${P}cerr" class="mb-cerr" style="display:none;"></div>
      <button id="${P}csend" class="mb-send"><i class="bi bi-send-fill"></i>Gửi thư</button>
    </div>`;

  showView('compose');

  const showErr = msg=>{ const e=$('cerr'); if(e){e.textContent=msg;e.style.display='flex';} };
  const hideErr = ()=>{ const e=$('cerr'); if(e) e.style.display='none'; };

  const renderChips = ()=>{
    const el=$('rchips'), hint=$('rhint'); if(!el) return;
    const max=isS?10:1;
    if(hint) hint.textContent=_recips.length?`(${_recips.length}/${max})`:'';
    el.innerHTML=_recips.map((u,i)=>`
      <div class="mb-chip">
        <img src="${esc(avUrl(u.avatarUrl,u.name))}" class="mb-chip-av" alt="">
        <span class="mb-chip-name">${esc(u.name||'?')}</span>
        ${u.tag?`<span class="mb-chip-tag">@${esc(u.tag)}</span>`:''}
        <button class="mb-chip-rm" data-i="${i}"><i class="bi bi-x"></i></button>
      </div>`).join('');
    el.querySelectorAll('.mb-chip-rm').forEach(b=>
      b.addEventListener('click',()=>{_recips.splice(parseInt(b.dataset.i,10),1);renderChips();})
    );
  };
  renderChips();

  $('cback')?.addEventListener('click',()=>{
    showView(_tab==='server'?'server':'inbox'); _recips=[];
  });

  $('sdm')?.addEventListener('click',()=>{
    mode='dm'; $('sdm')?.classList.add('active'); $('ssv')?.classList.remove('active');
    const w=$('rwrap'); if(w) w.style.display='';
  });
  $('ssv')?.addEventListener('click',()=>{
    mode='server'; $('ssv')?.classList.add('active'); $('sdm')?.classList.remove('active');
    const w=$('rwrap'); if(w) w.style.display='none';
  });

  const rres = $('rres');
  $('ri')?.addEventListener('input',()=>{
    clearTimeout(_deb);
    const q=($('ri')?.value||'').trim();
    if(!q){ if(rres){rres.style.display='none';rres.innerHTML='';} return; }
    _deb=setTimeout(()=>searchR(q,renderChips), 400);
  });

  $('csend')?.addEventListener('click',async()=>{
    hideErr();
    const subj=($('subj')?.value||'').trim();
    const body=($('cbody')?.value||'').trim();
    const prio = view.querySelector('input[name="mbp"]:checked')?.value||'normal';
    if(!subj){showErr('Vui lòng nhập tiêu đề.');return;}
    if(!body){showErr('Vui lòng nhập nội dung.');return;}
    if(mode==='dm'&&!_recips.length){showErr('Vui lòng chọn người nhận.');return;}

    const btn=$('csend');
    if(btn){btn.disabled=true;btn.innerHTML='<span class="mb-spin"></span>Đang gửi...';}
    try {
      if(mode==='server'){
        await api('POST','/api/mail/send',{type:'server',subject:subj,body,priority:prio});
        toast('Đã gửi thư toàn server ✓');
      } else {
        const total=_recips.length; let ok=0;
        for(const r of _recips){
          try{ await api('POST','/api/mail/send',{type:'dm',subject:subj,body,priority:prio,recipientUid:r.uid}); ok++; }
          catch{}
          if(btn) btn.innerHTML=`<span class="mb-spin"></span>${ok}/${total}`;
        }
        toast(ok===total?(total>1?`Đã gửi đến ${total} người ✓`:'Đã gửi thư ✓'):`Gửi ${ok}/${total} thành công`, ok<total);
      }
      showView(_tab==='server'?'server':'inbox'); _recips=[];
    } catch(e){ showErr(e.message||'Lỗi khi gửi thư'); }
    finally{ if(btn){btn.disabled=false;btn.innerHTML='<i class="bi bi-send-fill"></i>Gửi thư';} }
  });
}

// ── Search ────────────────────────────────────────────────────
async function searchR(q, cb) {
  const rr=$('rres'); if(!rr) return;
  rr.style.display='block';
  rr.innerHTML='<div class="mb-loading"><span class="mb-spin"></span>Đang tìm...</div>';
  try {
    const d=await api('GET','/api/mail/search-recipients?q='+encodeURIComponent(q));
    renderRList(d.users||[], cb);
  } catch { await searchRFallback(q,cb); }
}

async function searchRFallback(q, cb) {
  const rr=$('rres'), ql=q.toLowerCase().replace(/^@/,'');
  const isS=isSA(_userDoc?.type||'user');
  try {
    const ps=[
      getDocs(query(collection(_db,'users'),where('tagName','>=',ql),where('tagName','<=',ql+'\uf8ff'),limit(10))).catch(()=>({docs:[]})),
      getDocs(query(collection(_db,'users'),where('displayName','>=',q),where('displayName','<=',q+'\uf8ff'),limit(10))).catch(()=>({docs:[]})),
    ];
    if(!isS) SA_LIST.forEach(x=>ps.push(getDocs(query(collection(_db,'users'),where('type','==',x),limit(20))).catch(()=>({docs:[]}))));
    const snaps=await Promise.all(ps);
    const seen=new Set(), users=[];
    snaps.forEach(s=>s.docs.forEach(d=>{
      if(seen.has(d.id)||d.id===_uid) return;
      const dt=d.data(), tr=t(dt.type||'user');
      if(!isS&&tr!=='SA') return;
      if(isS&&!(dt.displayName||'').toLowerCase().includes(ql)&&!(dt.tagName||'').toLowerCase().includes(ql)) return;
      seen.add(d.id);
      users.push({uid:d.id,displayName:dt.displayName||'',tagName:dt.tagName||'',avatarUrl:dt.avatarUrl||null,type:dt.type||'user',tier:tr});
    }));
    renderRList(users.slice(0,10), cb);
  } catch { if(rr) rr.innerHTML='<div class="mb-rr-msg">Không thể tìm kiếm</div>'; }
}

function renderRList(users, cb) {
  const rr=$('rres'); if(!rr) return;
  const isS=isSA(_userDoc?.type||'user');
  rr.style.display='block';
  if(!users.length){
    rr.innerHTML=`<div class="mb-rr-msg">${isS?'Không tìm thấy':'Không tìm thấy tài khoản SA'}</div>`;
    return;
  }
  const already=new Set(_recips.map(r=>r.uid));
  rr.innerHTML=users.map(u=>{
    const added=already.has(u.uid);
    const tg=u.tagName?`@${esc(u.tagName)}`:'';
    const tb=u.tier==='SA'
      ?'<span class="mb-tier mb-tier-sa">SA</span>'
      :'<span class="mb-tier mb-tier-ra">RA</span>';
    return `<div class="mb-rr-item${added?' mb-added':''}"
      data-uid="${esc(u.uid)}" data-name="${esc(u.displayName)}"
      data-tag="${esc(u.tagName||'')}" data-type="${esc(u.type)}"
      data-av="${esc(avUrl(u.avatarUrl,u.displayName))}">
      <img src="${esc(avUrl(u.avatarUrl,u.displayName))}" class="mb-rr-av" alt="">
      <div class="mb-rr-info">
        <div class="mb-rr-name">${esc(u.displayName||'Ẩn danh')}</div>
        <div class="mb-rr-sub">${tg?`<span>${tg}</span>`:''}${tb}</div>
      </div>
      ${added?'<i class="bi bi-check-circle-fill mb-rr-check"></i>':'<i class="bi bi-plus-circle mb-rr-plus"></i>'}
    </div>`;
  }).join('');

  rr.querySelectorAll('.mb-rr-item:not(.mb-added)').forEach(el=>
    el.addEventListener('click',()=>{
      const max=isS?10:1;
      const nr={uid:el.dataset.uid,name:el.dataset.name,tag:el.dataset.tag,type:el.dataset.type,avatarUrl:el.dataset.av};
      if(_recips.length>=max){ if(!isS) _recips=[nr]; else return; }
      else _recips.push(nr);
      const ri=$('ri'); if(ri) ri.value='';
      rr.style.display='none'; rr.innerHTML='';
      cb();
    })
  );
}

// ── Subscriptions ─────────────────────────────────────────────
function subscribe() {
  if(!_db||!_uid) return;

  _uSrv?.();
  const pSrv=$('view-server');
  if(pSrv) skels(pSrv,3);
  _uSrv=onSnapshot(
    query(collection(_db,'mailbox_server'),limit(40)),
    snap=>{
      const mails=snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const el=$('view-server'); if(!el) return;
      el.innerHTML='';
      if(!mails.length){el.innerHTML='<div class="mb-empty"><i class="bi bi-envelope-open"></i><p>Chưa có thư server</p></div>';return;}
      mails.forEach(m=>el.appendChild(mailItem(m,'server')));
    }, ()=>{}
  );

  _uInb?.();
  const pInb=$('view-inbox');
  if(pInb) skels(pInb,2);
  _uInb=onSnapshot(
    query(collection(_db,'mailbox_dm'),where('recipientUid','==',_uid),limit(40)),
    snap=>{
      const mails=snap.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const el=$('view-inbox'); if(!el) return;
      el.innerHTML='';
      const un=mails.filter(m=>!readSet('dm').has(m.id)).length;
      updateBadge(un);
      if(!mails.length){el.innerHTML='<div class="mb-empty"><i class="bi bi-tray"></i><p>Hộp thư trống</p></div>';return;}
      mails.forEach(m=>el.appendChild(mailItem(m,'dm')));
    }, ()=>{}
  );
}

// ── Build DOM ─────────────────────────────────────────────────
function buildDOM(opts) {
  if(document.getElementById(W)) return;
  const fabLeft = opts.position==='bottom-left';
  const wrap = document.createElement('div');
  wrap.id = W;
  wrap.innerHTML = `
    <!-- FAB -->
    <button id="${P}fab" class="mb-fab${fabLeft?' mb-left':''}" aria-label="Hộp thư">
      <i class="bi bi-envelope-fill"></i>
      <span id="${P}fab-badge" class="mb-fab-badge" style="display:none;"></span>
    </button>

    <!-- Backdrop -->
    <div id="${P}bd" class="mb-bd" style="display:none;"></div>

    <!-- Panel -->
    <div id="${P}panel" class="mb-panel" role="dialog">

      <div class="mb-hd">
        <div class="mb-hd-icon"><i class="bi bi-envelope-fill"></i></div>
        <div class="mb-hd-title">
          Hộp Thư
          <span id="${P}hd-badge" class="mb-hd-badge" style="display:none;"></span>
        </div>
        <div class="mb-hd-actions">
          <button id="${P}compose-btn" class="mb-ib" title="Soạn thư"><i class="bi bi-pencil-fill"></i></button>
          <button id="${P}close-btn"   class="mb-ib" title="Đóng"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>

      <div class="mb-tabs">
        <button class="mb-tab active" data-tab="server"><i class="bi bi-globe2"></i><span> Toàn server</span></button>
        <button class="mb-tab"        data-tab="inbox"> <i class="bi bi-inbox-fill"></i><span> Của tôi</span></button>
      </div>

      <!-- Tất cả views nằm trong .mb-body, đều position:absolute -->
      <div class="mb-body">

        <!-- Login prompt -->
        <div id="${P}login" class="mb-view" data-view="login" style="display:none;">
          <div class="mb-login">
            <i class="bi bi-lock-fill"></i>
            <p>Đăng nhập để xem hộp thư</p>
            <a href="index.html" class="mb-login-btn">Đăng nhập</a>
          </div>
        </div>

        <!-- Server list -->
        <div id="${P}view-server" class="mb-view mb-list-view mb-active" data-view="server">
          <div class="mb-skels">
            <div class="mb-skel"><div class="mb-skel-ic"></div><div class="mb-skel-lines"><div class="mb-skel-ln mb-sl-w"></div><div class="mb-skel-ln mb-sl-m"></div></div></div>
            <div class="mb-skel"><div class="mb-skel-ic"></div><div class="mb-skel-lines"><div class="mb-skel-ln mb-sl-w"></div><div class="mb-skel-ln mb-sl-s"></div></div></div>
            <div class="mb-skel"><div class="mb-skel-ic"></div><div class="mb-skel-lines"><div class="mb-skel-ln mb-sl-m"></div><div class="mb-skel-ln mb-sl-s"></div></div></div>
          </div>
        </div>

        <!-- Inbox list -->
        <div id="${P}view-inbox" class="mb-view mb-list-view" data-view="inbox">
          <div class="mb-skels">
            <div class="mb-skel"><div class="mb-skel-ic"></div><div class="mb-skel-lines"><div class="mb-skel-ln mb-sl-w"></div><div class="mb-skel-ln mb-sl-m"></div></div></div>
            <div class="mb-skel"><div class="mb-skel-ic"></div><div class="mb-skel-lines"><div class="mb-skel-ln mb-sl-m"></div><div class="mb-skel-ln mb-sl-s"></div></div></div>
          </div>
        </div>

        <!-- Detail -->
        <div id="${P}view-detail" class="mb-view" data-view="detail"></div>

        <!-- Compose -->
        <div id="${P}view-compose" class="mb-view" data-view="compose"></div>

      </div>

      <div class="mb-footer">
        <a href="mailBox.html" class="mb-full-link">
          <i class="bi bi-box-arrow-up-right"></i>Mở hộp thư đầy đủ
        </a>
      </div>
    </div>

    <div id="${P}toast" class="mb-toast"></div>`;
  document.body.appendChild(wrap);
}

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
  const open = ()=>{
    _open=true;
    $('panel')?.classList.add('mb-open');
    const bd=$('bd'); if(bd) bd.style.display='block';
    document.querySelectorAll('#'+W+' .mb-tab').forEach(b=>
      b.addEventListener('click',()=>setTab(b.dataset.tab))
    );
    _opts.onOpen?.();
  };
  const close = ()=>{
    _open=false;
    $('panel')?.classList.remove('mb-open');
    const bd=$('bd'); if(bd) bd.style.display='none';
    showView(_tab==='server'?'server':'inbox');
    _opts.onClose?.();
  };

  $('fab')?.addEventListener('click',()=>_open?close():open());
  $('close-btn')?.addEventListener('click', close);
  $('bd')?.addEventListener('click', close);
  $('compose-btn')?.addEventListener('click',()=>{
    if(!_uid){toast('Vui lòng đăng nhập trước',true);return;}
    openCompose();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&_open) close();});
}

// ── Public API ────────────────────────────────────────────────
export function initMailBoxModule(opts={}) {
  _opts = {position:'bottom-right', showFab:true, onOpen:null, onClose:null, ...opts};

  if(!document.getElementById(W+'-css')) {
    const l=document.createElement('link');
    l.id=W+'-css'; l.rel='stylesheet'; l.href='CSS/mailBox-module.css';
    document.head.appendChild(l);
  }
  if(!document.querySelector('link[href*="bootstrap-icons"]')) {
    const l=document.createElement('link');
    l.rel='stylesheet';
    l.href='https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css';
    document.head.appendChild(l);
  }

  buildDOM(_opts);
  if(!_opts.showFab){ const f=$('fab'); if(f) f.style.display='none'; }
  bindEvents();

  _db   = initFirebase();
  _auth = getAuth();

  onAuthStateChanged(_auth, async user=>{
    const login=$('login');
    if(!user){
      _uid=null; _userDoc=null;
      if(login) login.style.display='flex';
      updateBadge(0); _uSrv?.(); _uInb?.();
      return;
    }
    _uid=user.uid;
    if(login) login.style.display='none';
    try {
      const s=await getDoc(doc(_db,'users',user.uid));
      _userDoc=s.exists()?s.data():{};
    } catch { _userDoc={}; }
    subscribe();
  });
}

export const openMailBox  = ()=>{ if(!_open) $('fab')?.click(); };
export const closeMailBox = ()=>{ if(_open)  $('close-btn')?.click(); };
export const getUnreadCount = ()=>_unread;