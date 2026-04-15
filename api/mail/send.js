// api/mail/send.js — Relife MailBox API
// POST /api/mail/send
// ─────────────────────────────────────────────────────────────────────────────
// Body JSON: { type, subject, body, priority, recipientUid? }
// ─────────────────────────────────────────────────────────────────────────────

const { initAdmin, verifyAndGetUser, getAccountTier, isRateLimited, setCORS } = require('./_shared');

module.exports = async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let db, FieldValue;
  try {
    ({ db, FieldValue } = initAdmin());
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }

  // 1. Xác thực token
  let caller;
  try {
    caller = await verifyAndGetUser(req, db);
  } catch (e) {
    return res.status(401).json({ ok: false, error: e.message });
  }

  if (!caller.activated) {
    return res.status(403).json({ ok: false, error: 'Tài khoản chưa được kích hoạt' });
  }

  const { type, subject, body, priority = 'normal', recipientUid } = req.body || {};
  const callerTier = getAccountTier(caller.type);

  // 2. Validate
  const errors = [];
  if (!type || !['server', 'dm'].includes(type))
    errors.push('type phải là "server" hoặc "dm"');
  if (!subject?.trim())           errors.push('Thiếu tiêu đề thư');
  else if (subject.trim().length > 120) errors.push('Tiêu đề tối đa 120 ký tự');
  if (!body?.trim())              errors.push('Thiếu nội dung thư');
  else if (body.trim().length > 2000)   errors.push('Nội dung tối đa 2000 ký tự');
  if (!['normal', 'important', 'urgent'].includes(priority))
    errors.push('priority không hợp lệ');
  if (errors.length)
    return res.status(400).json({ ok: false, error: errors.join('; ') });

  try {
    if (type === 'server') {
      // Chỉ SA
      if (callerTier !== 'SA')
        return res.status(403).json({ ok: false, error: 'Chỉ Tài khoản Bậc cao (SA) mới được gửi thư toàn server' });

      // Rate limit 20/giờ
      if (await isRateLimited(db, 'mailbox_server', caller.uid, 20))
        return res.status(429).json({ ok: false, error: 'Đã gửi quá nhiều thư server trong 1 giờ' });

      const ref = await db.collection('mailbox_server').add({
        subject:         subject.trim(),
        body:            body.trim(),
        priority,
        senderUid:       caller.uid,
        senderName:      caller.displayName,
        senderTag:       caller.tagName,
        senderType:      caller.type,
        senderAvatarUrl: caller.avatarUrl,
        createdAt:       FieldValue.serverTimestamp(),
        type:            'server',
      });

      return res.status(200).json({ ok: true, mailId: ref.id, message: 'Đã gửi thư toàn server thành công' });
    }

    // type === 'dm'
    if (!recipientUid || typeof recipientUid !== 'string')
      return res.status(400).json({ ok: false, error: 'Thiếu recipientUid' });
    if (recipientUid === caller.uid)
      return res.status(400).json({ ok: false, error: 'Không thể gửi thư cho chính mình' });

    const recipSnap = await db.doc(`users/${recipientUid}`).get();
    if (!recipSnap.exists)
      return res.status(404).json({ ok: false, error: 'Người nhận không tồn tại' });

    const recipData = recipSnap.data();
    const recipTier = getAccountTier(recipData.type || 'user');

    if (callerTier !== 'SA' && recipTier !== 'SA')
      return res.status(403).json({ ok: false, error: 'Tài khoản thông thường chỉ được gửi thư đến Tài khoản Bậc cao (SA)' });

    const dmLimit = callerTier === 'SA' ? 50 : 10;
    if (await isRateLimited(db, 'mailbox_dm', caller.uid, dmLimit))
      return res.status(429).json({ ok: false, error: `Đã gửi quá nhiều thư trong 1 giờ (tối đa ${dmLimit})` });

    const ref = await db.collection('mailbox_dm').add({
      subject:          subject.trim(),
      body:             body.trim(),
      priority,
      senderUid:        caller.uid,
      senderName:       caller.displayName,
      senderTag:        caller.tagName,
      senderType:       caller.type,
      senderAvatarUrl:  caller.avatarUrl,
      recipientUid,
      recipientName:    recipData.displayName || '',
      recipientTag:     recipData.tagName     || '',
      recipientType:    recipData.type        || 'user',
      createdAt:        FieldValue.serverTimestamp(),
      type:             'dm',
      read:             false,
    });

    return res.status(200).json({ ok: true, mailId: ref.id, message: 'Đã gửi thư riêng thành công' });

  } catch (e) {
    console.error('[send]', e);
    return res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ' });
  }
};