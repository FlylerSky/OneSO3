// api/mail/search-recipients.js — GET /api/mail/search-recipients?q=...
// Fix: fallback khi không có displayNameSearch field, tìm nhiều strategy hơn
const { initAdmin, verifyAndGetUser, getAccountTier, SA_TYPES, setCORS } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db;
  try { ({ db } = initAdmin()); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  let caller;
  try { caller = await verifyAndGetUser(req, db); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const raw = (req.query.q || '').trim();
  const q   = raw.toLowerCase().replace(/^@/, '');

  if (q.length < 1)
    return res.status(400).json({ ok: false, error: 'Cần ít nhất 1 ký tự để tìm kiếm' });

  const callerIsSA = SA_TYPES.includes(caller.type);

  try {
    // Chạy song song nhiều query để tăng khả năng tìm thấy:
    // 1. displayNameSearch (lowercase, nếu có)
    // 2. tagName (luôn lowercase)
    // 3. Nếu RA/LLA: lấy tất cả SA users để filter client-side
    const queries = [
      // displayNameSearch prefix
      db.collection('users')
        .where('displayNameSearch', '>=', q)
        .where('displayNameSearch', '<=', q + '\uf8ff')
        .limit(15).get()
        .catch(() => ({ docs: [] })),

      // tagName prefix
      db.collection('users')
        .where('tagName', '>=', q)
        .where('tagName', '<=', q + '\uf8ff')
        .limit(15).get()
        .catch(() => ({ docs: [] })),

      // displayName prefix (original case — Firestore range query)
      db.collection('users')
        .where('displayName', '>=', raw)
        .where('displayName', '<=', raw + '\uf8ff')
        .limit(15).get()
        .catch(() => ({ docs: [] })),

      // displayName lowercase prefix (vd user nhập thường, tên lưu hoa)
      db.collection('users')
        .where('displayName', '>=', q)
        .where('displayName', '<=', q + '\uf8ff')
        .limit(15).get()
        .catch(() => ({ docs: [] })),
    ];

    // Nếu RA/LLA: thêm query lấy tất cả SA để không bỏ sót ai
    if (!callerIsSA) {
      SA_TYPES.forEach(saType => {
        queries.push(
          db.collection('users')
            .where('type', '==', saType)
            .limit(20).get()
            .catch(() => ({ docs: [] }))
        );
      });
    }

    const snaps = await Promise.all(queries);

    const seen    = new Set();
    const results = [];

    snaps.forEach(snap => {
      snap.docs.forEach(doc => {
        if (seen.has(doc.id) || doc.id === caller.uid) return;

        const data     = doc.data();
        const userTier = getAccountTier(data.type || 'user');

        // RA/LLA chỉ thấy SA
        if (!callerIsSA && userTier !== 'SA') return;

        // Filter: tên hoặc tag phải chứa chuỗi tìm kiếm (case-insensitive)
        const nameMatch = (data.displayName || '').toLowerCase().includes(q);
        const tagMatch  = (data.tagName     || '').toLowerCase().includes(q);
        const searchMatch = (data.displayNameSearch || '').toLowerCase().includes(q);

        // Nếu là SA user được fetch do RA/LLA → luôn include (không filter chữ)
        // Nếu là kết quả từ prefix query → cũng luôn include
        // Chỉ skip nếu không match gì cả
        if (!nameMatch && !tagMatch && !searchMatch && callerIsSA) return;

        seen.add(doc.id);
        results.push({
          uid:         doc.id,
          displayName: data.displayName || '',
          tagName:     data.tagName     || '',
          avatarUrl:   data.avatarUrl   || null,
          type:        data.type        || 'user',
          tier:        userTier,
        });
      });
    });

    // Client filter cuối: nếu callerIsSA, bỏ các item không match q
    const filtered = callerIsSA
      ? results.filter(u =>
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.tagName     || '').toLowerCase().includes(q)
        )
      : results; // RA/LLA: show tất cả SA đã fetch

    // Sort: SA trước, rồi theo tên
    filtered.sort((a, b) => {
      if (a.tier === 'SA' && b.tier !== 'SA') return -1;
      if (a.tier !== 'SA' && b.tier === 'SA') return  1;
      return (a.displayName || '').localeCompare(b.displayName || '', 'vi');
    });

    return res.status(200).json({ ok: true, users: filtered.slice(0, 10) });

  } catch (e) {
    console.error('[search-recipients]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi khi tìm kiếm người dùng' });
  }
};