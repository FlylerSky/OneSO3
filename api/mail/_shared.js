// api/mail/_shared.js — Relife MailBox API
// Module dùng chung: Firebase Admin init, xác thực token, helpers phân quyền
// ─────────────────────────────────────────────────────────────────────────────
// Dùng CommonJS (require) thay vì ESM import để tương thích tốt hơn
// với Vercel Serverless Functions + firebase-admin v11/v12
// ─────────────────────────────────────────────────────────────────────────────

const admin = require('firebase-admin');

// ── Tier config ───────────────────────────────────────────────────────────────
const ACCOUNT_TYPE_CONFIG = {
  admin:     { tier: 'SA',  rank: 100, name: 'Admin'      },
  dev:       { tier: 'SA',  rank:  90, name: 'Dev'         },
  operator:  { tier: 'SA',  rank:  80, name: 'Vận hành'   },
  moderator: { tier: 'SA',  rank:  70, name: 'Kiểm duyệt' },
  advanced:  { tier: 'RA',  rank:  30, name: 'Nâng cao'   },
  user:      { tier: 'RA',  rank:  20, name: 'Người dùng' },
  shared:    { tier: 'LLA', rank:  10, name: 'Dùng chung' },
  trial:     { tier: 'LLA', rank:   5, name: 'Thử nghiệm' },
};

const SA_TYPES  = ['admin', 'dev', 'operator', 'moderator'];
const RA_TYPES  = ['advanced', 'user'];
const LLA_TYPES = ['shared', 'trial'];

function getAccountTier(typeKey) {
  return ACCOUNT_TYPE_CONFIG[typeKey]?.tier || 'RA';
}

// ── Firebase Admin singleton ──────────────────────────────────────────────────
let _db = null;

function initAdmin() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Thiếu env var FIREBASE_SERVICE_ACCOUNT');
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  if (!_db) _db = admin.firestore();
  return { db: _db, admin, FieldValue: admin.firestore.FieldValue };
}

// ── Xác thực token + đọc user profile ────────────────────────────────────────
async function verifyAndGetUser(req, db) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) throw new Error('Thiếu Authorization token');

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (e) {
    throw new Error('Token không hợp lệ hoặc đã hết hạn');
  }

  const snap = await db.doc(`users/${decoded.uid}`).get();
  if (!snap.exists) throw new Error('Tài khoản không tồn tại trong hệ thống');

  const data = snap.data();
  return {
    uid:         decoded.uid,
    email:       decoded.email   || '',
    displayName: data.displayName|| '',
    tagName:     data.tagName    || '',
    avatarUrl:   data.avatarUrl  || null,
    type:        data.type       || 'user',
    activated:   data.activated  ?? false,
  };
}

// ── CORS ──────────────────────────────────────────────────────────────────────
function setCORS(res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin',  origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Rate limit (Firestore count query) ───────────────────────────────────────
async function isRateLimited(db, collectionName, uid, maxCount) {
  const oneHourAgo = new Date(Date.now() - 3600 * 1000);
  try {
    const snap = await db.collection(collectionName)
      .where('senderUid', '==', uid)
      .where('createdAt', '>=', oneHourAgo)
      .count()
      .get();
    return snap.data().count >= maxCount;
  } catch {
    return false; // Không block nếu count lỗi
  }
}

module.exports = {
  ACCOUNT_TYPE_CONFIG,
  SA_TYPES, RA_TYPES, LLA_TYPES,
  getAccountTier,
  initAdmin,
  verifyAndGetUser,
  setCORS,
  isRateLimited,
};