// api/mail/delete.js — DELETE /api/mail/delete
const { initAdmin, verifyAndGetUser, getAccountTier, setCORS, SA_TYPES } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'DELETE')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db;
  try { ({ db } = initAdmin()); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  let caller;
  try { caller = await verifyAndGetUser(req, db); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { mailId, collection: colName } = req.body || {};

  if (!mailId || typeof mailId !== 'string')
    return res.status(400).json({ ok: false, error: 'Thiếu mailId' });
  if (!['server', 'dm'].includes(colName))
    return res.status(400).json({ ok: false, error: 'collection phải là "server" hoặc "dm"' });

  const colPath  = colName === 'server' ? 'mailbox_server' : 'mailbox_dm';
  const mailRef  = db.doc(`${colPath}/${mailId}`);
  const mailSnap = await mailRef.get();

  if (!mailSnap.exists)
    return res.status(404).json({ ok: false, error: 'Không tìm thấy thư' });

  const mail       = mailSnap.data();
  const isSACaller = SA_TYPES.includes(caller.type);

  if (colName === 'server') {
    if (!isSACaller)
      return res.status(403).json({ ok: false, error: 'Chỉ SA mới xóa được thư server' });
  } else {
    const canDelete = isSACaller
      || mail.senderUid    === caller.uid
      || mail.recipientUid === caller.uid;
    if (!canDelete)
      return res.status(403).json({ ok: false, error: 'Bạn không có quyền xóa thư này' });
  }

  try {
    await mailRef.delete();
    return res.status(200).json({ ok: true, message: 'Đã xóa thư thành công' });
  } catch (e) {
    console.error('[delete]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi khi xóa thư' });
  }
};