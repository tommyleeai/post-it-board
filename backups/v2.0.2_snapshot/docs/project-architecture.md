# Post It — 數位白板 📌

> **網址**: https://post.tommylee.ai  
> **後台**: https://post.tommylee.ai/admin.html  
> **GitHub**: https://github.com/tommyleeai/post-it-board

---

## 一、專案簡介

Post It 是一個網頁版的數位白板應用程式，模擬真實 3M 便利貼的使用體驗。使用者可以透過 Google 帳號登入後，在白板上新增、編輯、移動、刪除便利貼，記錄文字、網址、圖片等各種臨時資訊。

### 核心理念
- **隨開即用**：打開網頁就能看到自己的白板，不需要管理檔案
- **擬真體驗**：貼紙有紙質紋理、陰影、捲角效果，就像真的 3M 貼紙
- **多端同步**：資料即時儲存在雲端，任何裝置登入都能看到

---

## 二、技術架構

### 架構模式
**純前端 Serverless 架構** — 無後端伺服器，所有邏輯在瀏覽器端執行，搭配 Firebase 雲端服務。

```
┌──────────────────────────────────────────────────┐
│                   前端 (Browser)                    │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │ HTML │ │ CSS  │ │Board │ │ Note │ │ Drag │  │
│  │      │ │      │ │  .js │ │  .js │ │  .js │  │
│  └──┬───┘ └──────┘ └──┬───┘ └──┬───┘ └──────┘  │
│     │                  │        │                 │
│  ┌──┴──────────────────┴────────┴──────────────┐ │
│  │         firebase-config.js + auth.js         │ │
│  └──────────────────┬──────────────────────────┘ │
└─────────────────────┼────────────────────────────┘
                      │ Firebase SDK (compat)
┌─────────────────────┼────────────────────────────┐
│              Firebase Cloud Services              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │   Auth   │  │Firestore │  │   Storage    │   │
│  │ (Google) │  │ (NoSQL)  │  │  (圖片存放)  │   │
│  └──────────┘  └──────────┘  └──────────────┘   │
└──────────────────────────────────────────────────┘
```

### 技術選型

| 層面 | 技術 | 說明 |
|------|------|------|
| **結構** | HTML5 | 語意化標籤 |
| **樣式** | Vanilla CSS | 不使用框架，完全自訂 |
| **邏輯** | Vanilla JavaScript | IIFE 模組化，無框架依賴 |
| **字型** | Google Fonts (Caveat, Inter) | 手寫風 + UI 字型 |
| **圖示** | Font Awesome 6.5 | 豐富向量圖示庫 |
| **認證** | Firebase Authentication | Google OAuth Popup 登入 |
| **資料庫** | Cloud Firestore | NoSQL 即時同步資料庫 |
| **儲存** | Firebase Storage | 圖片上傳與 CDN 發佈 |
| **託管** | GitHub Pages | 靜態網站免費託管 |
| **DNS** | Cloudflare | CNAME 指向 + DNS 管理 |
| **網域** | post.tommylee.ai | 自訂子域名 |

---

## 三、專案結構

```
白板/
├── index.html          # 主白板頁面
├── admin.html          # 管理後台頁面
├── favicon.svg         # 瀏覽器分頁圖示（黃色便利貼）
├── CNAME               # GitHub Pages 自訂域名
├── package.json        # 本地開發伺服器設定
├── .gitignore          # Git 忽略規則
│
├── css/
│   ├── style.css       # 主白板樣式（登入、工具列、貼紙、設定面板）
│   ├── animations.css  # 動畫定義（進場、退場、脈動）
│   └── admin.css       # 管理後台樣式（深色主題儀表板）
│
└── js/
    ├── firebase-config.js  # Firebase 初始化 + SDK 設定
    ├── auth.js             # Google 登入/登出 + Profile 儲存
    ├── drag.js             # Pointer Events 拖曳引擎
    ├── note.js             # 貼紙 CRUD + 圖片上傳 + 內容偵測
    ├── board.js            # 主控制器（UI 事件、渲染、排列）
    └── admin.js            # 管理後台邏輯
```

---

## 四、模組說明

### `firebase-config.js`
Firebase 初始化模組，使用共用的 `tommylee-ai` 專案。透過 `PostIt.Firebase` 命名空間提供 `getAuth()`, `getDb()`, `getStorage()` 存取器。

### `auth.js`
Google OAuth 登入流程。登入成功後自動將使用者 profile（displayName、email、photoURL）寫入 Firestore `users/{uid}` 文件，供管理後台識別使用者。

### `drag.js`
基於 Pointer Events 的拖曳系統。支援：
- 拖曳閾值（避免點擊誤觸發拖曳）
- z-index 自動疊層管理
- 百分比座標轉換（響應式佈局）
- 邊界限制（貼紙不會拖出白板）

### `note.js`
貼紙 CRUD 模組：
- **Create**: 隨機顏色、位置、微旋轉，最多 50 張
- **Read**: Firestore `onSnapshot` 即時監聽
- **Update**: 內容、位置、顏色分別更新
- **Delete**: 同步刪除 Storage 圖片
- **Upload**: 圖片大小限制 5MB，自動取副檔名

### `board.js`
主控制器，負責：
- UI 事件綁定（新增、編輯、刪除、設定面板）
- 貼紙 DOM 渲染與 diff 更新
- 全域 Ctrl+V 圖片貼上（自動建立或替換）
- 自動排列（網格佈局 + 動畫）
- 一鍵還原位置功能
- 編輯支援 Shift+Enter 換行、Esc 結束

### `admin.js`
管理後台，功能包括：
- 管理員身份驗證（限定 email）
- 全使用者資料讀取與統計
- 使用者表格（搜尋、排序）
- 使用者詳情 Modal（查看所有貼紙）
- 刪除貼紙（單張或全部）
- CSV 匯出
- 最近活動動態

---

## 五、Firestore 資料結構

```
users/
├── {uid}/                          # 使用者文件
│   ├── displayName: "Tommy"        # 顯示名稱
│   ├── email: "tommy@gmail.com"    # Email
│   ├── photoURL: "https://..."     # 頭像 URL
│   ├── lastLogin: Timestamp        # 最後登入時間
│   │
│   └── postit_notes/               # 貼紙子集合
│       └── {noteId}/
│           ├── type: "text"|"url"|"image"
│           ├── content: "..."      # 內容或圖片 URL
│           ├── color: "#FFF176"    # 貼紙顏色
│           ├── x: 35.2            # 百分比 X 座標
│           ├── y: 22.8            # 百分比 Y 座標
│           ├── rotation: -1.5     # 旋轉角度
│           ├── zIndex: 3          # 疊層順序
│           ├── storagePath: "..."  # Storage 路徑（圖片用）
│           ├── createdAt: Timestamp
│           └── updatedAt: Timestamp
```

---

## 六、安全規則

### Firestore
```javascript
match /users/{userId}/{document=**} {
  // 使用者讀寫自己的資料
  allow read, write: if request.auth != null && request.auth.uid == userId;
  // 管理員可讀取 + 刪除
  allow read, delete: if request.auth.token.email == 'tommylee@gmail.com';
}
```

### Storage
```javascript
match /users/{userId}/postit/{allPaths=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

---

## 七、部署架構

```
使用者 → post.tommylee.ai
         │
         ▼
   Cloudflare DNS (CNAME, DNS only)
         │
         ▼
   GitHub Pages (tommyleeai.github.io/post-it-board)
         │
         ▼
   靜態檔案 (HTML/CSS/JS)
         │
         ▼
   Firebase Services (Auth / Firestore / Storage)
```

### 部署流程
1. 本地修改程式碼
2. `git add -A && git commit -m "描述" && git push`
3. GitHub Pages 自動部署（約 1-2 分鐘）

### 網域設定
- **Cloudflare**: CNAME `post` → `tommyleeai.github.io` (DNS only)
- **GitHub Pages**: Custom domain `post.tommylee.ai` + Enforce HTTPS
- **Firebase Auth**: Authorized domain 已加入 `post.tommylee.ai`

---

## 八、已完成功能

### v1.0.0 — 初始版本
- [x] Google 帳號登入 / 登出
- [x] 擬真 3M 貼紙 UI（紙質紋理、陰影、捲角）
- [x] 深色漸層背景 + 毛玻璃登入畫面
- [x] 拖曳移動貼紙（Pointer Events）
- [x] 新增 / 雙擊編輯 / 刪除貼紙
- [x] Shift+Enter 換行、Esc 結束編輯
- [x] 6 色貼紙切換
- [x] URL 自動偵測轉連結
- [x] 50 張貼紙上限
- [x] 響應式佈局（百分比座標儲存）
- [x] 隱藏捲軸、增強陰影
- [x] GitHub Pages 部署 + 自訂域名

### v1.1.0 — 功能增強
- [x] 全域 Ctrl+V 圖片貼上
- [x] Firebase Storage 圖片上傳
- [x] 自動排列功能（網格 + 動畫）
- [x] 一鍵還原原始位置
- [x] 工具列排列 / 還原按鈕

### v1.2.0 — 管理後台
- [x] Admin 後台頁面（深色主題）
- [x] 統計卡片（使用者數、貼紙數、圖片數）
- [x] 使用者表格（搜尋、排序）
- [x] 使用者詳情 Modal（查看所有貼紙）
- [x] 刪除貼紙功能（單張 / 全部）
- [x] CSV 匯出
- [x] 最近活動動態
- [x] 使用者 profile 自動儲存
- [x] Favicon 品牌圖示

---

## 九、待辦事項

- [ ] 貼紙智慧縮放（依內容量自動調整大小）
- [ ] 貼紙拖曳排序優化（觸控裝置支援）
- [ ] 深色 / 淺色白板主題切換
- [ ] 貼紙分類 / 標籤功能
- [ ] 多白板支援（不同主題分開管理）
- [ ] 協作功能（多人即時編輯同一白板）
- [ ] PWA 支援（離線使用、桌面安裝）

---

## 十、Firebase 專案資訊

| 項目 | 值 |
|------|------|
| 專案 ID | `tommylee-ai` |
| 方案 | Blaze（按量付費，有免費額度） |
| Auth 方式 | Google OAuth |
| Firestore 位置 | 預設 |
| Storage Bucket | `tommylee-ai.firebasestorage.app` |
| Storage 位置 | US-EAST1 |
| 管理員 Email | `tommylee@gmail.com` |

---

## 十一、本地開發

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm start
# → http://localhost:5051

# 同區網其他裝置測試
http://192.168.x.x:5051
# 需在 Firebase Auth 加入該 IP 為 Authorized Domain
```

---

*最後更新：2026-04-12*
