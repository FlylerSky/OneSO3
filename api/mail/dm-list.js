// api/mail/dm-list.js — GET /api/mail/dm-list?box=inbox|sent
const { initAdmin, verifyAndGetUser, setCORS } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db;
  try { ({ db } = initAdmin()); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  let caller;
  try { caller = await verifyAndGetUser(req, db); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { box, limit: limitStr } = req.query;
  if (!['inbox', 'sent'].includes(box))
    return res.status(400).json({ ok: false, error: 'box phải là "inbox" hoặc "sent"' });

  const limitNum = Math.min(parseInt(limitStr || '50', 10), 100);
  const field    = box === 'inbox' ? 'recipientUid' : 'senderUid';

  try {
    const snap  = await db.collection('mailbox_dm')
      .where(field, '==', caller.uid)
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .get();
    const mails = snap.docs.map(d => ({
      id: d.id, _type: 'dm',
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
    }));
    return res.status(200).json({ ok: true, mails, count: mails.length });
  } catch (e) {
    console.error('[dm-list]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi khi tải hộp thư' });
  }
};