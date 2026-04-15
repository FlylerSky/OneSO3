# Relife MailBox — Hướng dẫn Deploy Vercel Functions

## Cấu trúc file

```
/
├── api/
│   └── mail/
│       ├── _shared.js          ← Firebase Admin init + helpers dùng chung
│       ├── send.js             ← POST /api/mail/send
│       ├── server-list.js      ← GET  /api/mail/server-list
│       ├── dm-list.js          ← GET  /api/mail/dm-list
│       ├── mark-read.js        ← POST /api/mail/mark-read
│       ├── delete.js           ← DELETE /api/mail/delete
│       └── search-recipients.js← GET  /api/mail/search-recipients
├── JS/
│   └── mailBox.js              ← Frontend logic (dùng Vercel API)
├── CSS/
│   └── mailBox.css
├── mailBox.html
├── vercel.json                 ← Routing config
├── package.json                ← firebase-admin dependency
└── rules-mailbox.txt           ← Firestore rules cần thêm
```

---

## Bước 1 — Lấy Firebase Service Account Key

1. Vào **Firebase Console** → Project Settings → **Service Accounts**
2. Nhấn **"Generate new private key"** → Download file JSON
3. Giữ file này bí mật, **không commit lên GitHub**

---

## Bước 2 — Thêm Environment Variable trên Vercel

1. Vào Vercel Dashboard → Project → **Settings → Environment Variables**
2. Thêm 2 biến:

| Name | Value |
|------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Toàn bộ nội dung file JSON service account (dạng string) |
| `ALLOWED_ORIGIN` | URL frontend của bạn, ví dụ `https://relife-mda.vercel.app` |

> ⚠️ `FIREBASE_SERVICE_ACCOUNT` phải là JSON **1 dòng** (minified).
> Dùng lệnh này để minify: `jq -c . serviceAccount.json`
> Hoặc copy nội dung file và paste thẳng vào Vercel (Vercel tự xử lý multiline).

---

## Bước 3 — Thêm package.json dependency

Đảm bảo `package.json` ở root có:

```json
{
  "type": "module",
  "engines": { "node": "20.x" },
  "dependencies": {
    "firebase-admin": "^12.0.0"
  }
}
```

---

## Bước 4 — Thêm Firestore Rules

Mở **Firebase Console → Firestore → Rules**, thêm 2 block từ file
`rules-mailbox.txt` vào trong `match /databases/{database}/documents { ... }`
(sau các rule hiện tại).

Nhấn **Publish**.

---

## Bước 5 — Tạo Firestore Composite Indexes

Vào **Firebase Console → Firestore → Indexes → Composite**, tạo các index:

### mailbox_server
| Collection | Fields | Order |
|------------|--------|-------|
| mailbox_server | createdAt | Descending |
| mailbox_server | senderUid ↑, createdAt ↓ | — |

### mailbox_dm
| Collection | Fields |
|------------|--------|
| mailbox_dm | recipientUid ↑, createdAt ↓ |
| mailbox_dm | senderUid ↑, createdAt ↓ |
| mailbox_dm | senderUid ↑, createdAt ↑ |

> 💡 Khi chạy lần đầu, nếu Firebase báo lỗi thiếu index, nó sẽ cho
> đường link trực tiếp để tạo index — nhấn vào là xong.

---

## Bước 6 — Thêm displayNameSearch vào users

Để tìm kiếm người nhận hoạt động, mỗi user document cần có field
`displayNameSearch` = `displayName.toLowerCase()`.

Thêm vào hàm tạo/cập nhật user trong code hiện tại:

```js
// Khi tạo hoặc cập nhật user
await updateDoc(userRef, {
  displayName: newName,
  displayNameSearch: newName.toLowerCase(), // thêm dòng này
});
```

---

## Bước 7 — Deploy

```bash
# Nếu dùng Vercel CLI
vercel --prod

# Hoặc push lên GitHub → Vercel tự deploy
git add .
git commit -m "feat: add MailBox Vercel Functions"
git push
```

---

## API Reference

### POST /api/mail/send
```json
// Headers: Authorization: Bearer <idToken>
// Body:
{
  "type": "server",         // "server" | "dm"
  "subject": "Thông báo",
  "body": "Nội dung thư...",
  "priority": "normal",     // "normal" | "important" | "urgent"
  "recipientUid": "abc123"  // Chỉ cần khi type === "dm"
}
// Response: { "ok": true, "mailId": "xyz", "message": "..." }
```

### DELETE /api/mail/delete
```json
// Headers: Authorization: Bearer <idToken>
// Body:
{ "mailId": "xyz", "collection": "dm" }
// Response: { "ok": true }
```

### POST /api/mail/mark-read
```json
// Headers: Authorization: Bearer <idToken>
// Body: { "mailId": "xyz" }
// Response: { "ok": true }
```

### GET /api/mail/search-recipients?q=ten
```json
// Headers: Authorization: Bearer <idToken>
// Response:
{
  "ok": true,
  "users": [
    {
      "uid": "...",
      "displayName": "Admin",
      "tagName": "admin01",
      "avatarUrl": "...",
      "type": "admin",
      "tier": "SA"
    }
  ]
}
```

---

## Phân quyền tóm tắt

| Hành động | SA | RA | LLA |
|-----------|----|----|-----|
| Gửi thư toàn server | ✅ | ❌ | ❌ |
| Gửi DM đến SA | ✅ | ✅ | ✅ |
| Gửi DM đến RA/LLA | ✅ | ❌ | ❌ |
| Xóa thư server | ✅ | ❌ | ❌ |
| Xóa DM của mình | ✅ | ✅ | ✅ |
| Đọc thư server | ✅ | ✅ | ✅ |
| Rate limit DM/giờ | 50 | 10 | 10 |
| Rate limit server/giờ | 20 | — | — |