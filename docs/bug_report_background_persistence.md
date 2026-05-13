# 除錯紀錄 (Post-Mortem)：白板背景無法持久化保存與閃退消失事件

**發生時間**：2026-04-12
**受影響組件**：白板設定模組 (`settings_v2.js`)、主控制器 (`board_v2.js`)、認證模組 (`auth.js`)

## 🐛 異常現象
使用者回報：
1. 「發現只要我換了自己上傳的白板桌布，改版後 reload 就會不見了。」
2. 「我開啓一個新視窗背景就不見了，reload 一次也不見了。」
3. 「重新上傳後 reload 就不見了，**但是多按 F5 幾次就出現了**。」

## 🔍 根本原因分析 (Root Cause Analysis)
這個看似單純的「存檔失敗」問題，實際上是由 **4 款不同層級的 Bug 完美連環相扣**所導致的結果，極具教育與歷史參考價值：

### 1. Firestore 巢狀物件覆寫 (Merge Behavior)
一開始在儲存背景 URL 時，前端僅送出 `{ settings: { boardBgImage: url } }` 請求。在特定的 Firebase Web SDK v8 機制中，如果未明確使用 Dot Notation (`settings.boardBgImage`)，這種寫法極易觸發**將整個 settings 字典覆蓋為單一屬性**的行為，導致使用者的字型大小、字體顏色等設定在更新背景時無故遺失。

### 2. 瀏覽器對 `index.html` 的硬碟快取霸權 (Disk Cache)
即便在修復存檔函式後，並在 `index.html` 修改 `<script src="...?v=8.6">` 嘗試推出版控，使用者的瀏覽器在一般重整 (F5) 時，經常連 `index.html` 本身都直接使用「磁碟快取 (304 Not Modified / Memory Cache)」，導致使用者永遠在跑「缺乏自動存檔功能」的舊版 JavaScript 檔案。

### 3. Firebase SDK 的「延遲補償」競爭危害 (Race Condition)
這是最刁鑽的底層邏輯。
當使用者重整頁面時，Firebase `onAuthStateChanged` 會立刻觸發。我們過去的設計是在這裡更新使用者的 `lastLogin` (呼叫 `saveProfile`)：
1. `saveProfile()` 會送出 `.set({ lastLogin: ... }, { merge: true })`，這個寫入動作會**立刻**改變本機的快取狀態。
2. 同一毫秒，`Settings.load()` 被呼叫，向資料庫呼叫 `.get()` 獲取設定資料。
3. **競爭危害爆發**：因為同一個 `user` 文件正處於「尚未被伺服器確認 (Uncommitted Mutation)」的狀態，Firebase 為了省下網路時間，會直接回傳其內部的「**延遲補償快取 (Latency-compensated snapshot)**」。
4. 但這個快取在網頁剛載入時，根本還沒來得及把雲端的 `settings` 拉下來！結果 `get()` 回傳的物件裡 `settings` 屬性呈現不存在，導致程式誤以為使用者沒有自訂背景，立刻用預設值 (空字串) 覆蓋本機狀態，並清除了畫面渲染。

### 4. 龐大圖片與 CSS 渲染的時間差 (Visual Illusion / Download Delay)
這解釋了為什麼「多按幾次 F5 就出現了」。
即使前三個問題皆已解開、資料也完美取回了，但由於 Firebase Storage 傳回的原圖（可能高達數 MB），在塞進 `boardEl.style.backgroundImage = url(...)` 時，瀏覽器需要 **1-3 秒來下載這張大圖**。
在這幾秒的下載期間，畫面背景呈現純白，使得使用者在視覺上誤判「背景又不見了、修復無效」，因而直覺性地反覆按下 F5，最終因快取累積完成，圖片才在某次 F5 中瞬間彈出。

---

## 🛠️ 終極修復方案清單 (Resolutions)

為了徹底斬除這四條隱患，我們實作了以下改動：

1. **防禦性手動合併儲存 (Settings_v2.js)**
   在寫入雲端前，強制在前端記憶體中將 `accountSettings` 與 `newSettings` 做一次完整的展開合併 (Spread Override)：
   ```javascript
   const mergedSettings = { ...(accountSettings || DEFAULTS), ...newSettings };
   // 一次性把完整的帳戶設定推送到雲端，確保零遺失
   ```

2. **核心檔案改名強勢繞過快取 (Cache Busting)**
   為了擊碎使用者的本機快取霸權，直接將核心檔案重新命名為 `board_v2.js` 與 `settings_v2.js`，這保證了不管瀏覽器快取多深，面對未知的檔名都必須誠實向伺服器重新請求。

3. **節流及伺服器強制讀取 (Server Source Enforcement)**
   - 在 `Settings.load()` 設定 `.get({ source: 'server' })`，強迫 Firebase 的讀取動作無視本地端被污染或未完備的快取，確保必然拿到最新且具備 `settings` 的雲端快照。
   - 在 `auth.js` 加入 `sessionStorage.getItem('profileSaved')` 的節流閘道，確保 `lastLogin` 等基本資料在同一個會話期間只會寫入一次，減輕 Firebase 無謂的寫入請求與網路阻塞。

4. **圖片記憶體預先載入機制 (Image Pre-loader)**
   修改 `applyBoardBgImage` 函式，利用 `new Image()` 物件進行後台下載。在圖片的 `.onload` 事件尚未觸發前，維持現有畫面不破壞；一旦載入完畢，才一瞬間將 `background-image` 反應到畫布上。這賦予了「背景瞬換」的順滑感，徹底根除白畫面導致的焦慮感與誤判。

---

## ⚠️ 退化事件紀錄 (Regression Log)

### 2026-05-13：同一根因復發（v2.5.20 ~ v2.5.22 → v2.5.23 修復）

**退化原因**：在後續版本迭代中，`auth.js` 的 `saveProfile(user)` 前面的 `await` 被意外移除，導致第 3 層根因（Firestore 延遲補償快取競爭危害）完整復發。

**誤判經過**：AI 助手連續嘗試了 3 個錯誤方向的修復（修改 `applyBoardBgImage` 的預載機制），浪費了 v2.5.20、v2.5.21、v2.5.22 三個版本，最終才回頭比對本報告，確認根因仍是 `auth.js` 的 Race Condition。

**修復**：`auth.js` 第 26 行：`saveProfile(user)` → `await saveProfile(user)`

### 防護措施（已實施）

1. **auth.js 註解警告**：在 `await saveProfile(user)` 上方加入 4 行完整的根因說明，任何人若移除 `await` 必會看到警示。
2. **settings_v2.js 防護性斷言**：`load()` 函式加入前置條件註解 + 執行時期偵測，若 Firestore 文件存在但缺少 `settings` 欄位，立即輸出 `console.warn` 指向本報告。
3. **本報告新增退化紀錄**：確保未來的 AI 助手或開發者能讀到完整歷史。

---
*記錄者：Antigravity*
