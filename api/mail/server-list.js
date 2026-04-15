// api/mail/server-list.js — GET /api/mail/server-list
const { initAdmin, verifyAndGetUser, setCORS } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db;
  try { ({ db } = initAdmin()); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  try { await verifyAndGetUser(req, db); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const limitNum = Math.min(parseInt(req.query.limit || '50', 10), 100);

  try {
    const snap  = await db.collection('mailbox_server').orderBy('createdAt', 'desc').limit(limitNum).get();
    const mails = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    }));
    return res.status(200).json({ ok: true, mails, count: mails.length });
  } catch (e) {
    console.error('[server-list]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi khi tải danh sách thư' });
  }
};