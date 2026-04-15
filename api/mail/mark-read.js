// api/mail/mark-read.js — POST /api/mail/mark-read
const { initAdmin, verifyAndGetUser, setCORS } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db, FieldValue;
  try { ({ db, FieldValue } = initAdmin()); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  let caller;
  try { caller = await verifyAndGetUser(req, db); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { mailId } = req.body || {};
  if (!mailId || typeof mailId !== 'string')
    return res.status(400).json({ ok: false, error: 'Thiếu mailId' });

  try {
    const mailRef  = db.doc(`mailbox_dm/${mailId}`);
    const mailSnap = await mailRef.get();

    if (!mailSnap.exists)
      return res.status(404).json({ ok: false, error: 'Không tìm thấy thư' });

    const mail = mailSnap.data();
    if (mail.recipientUid !== caller.uid)
      return res.status(403).json({ ok: false, error: 'Bạn không phải người nhận thư này' });

    if (!mail.read) {
      await mailRef.update({ read: true, readAt: FieldValue.serverTimestamp() });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[mark-read]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi khi cập nhật trạng thái đọc' });
  }
};