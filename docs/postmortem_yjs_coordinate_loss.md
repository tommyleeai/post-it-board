# Postmortem: Yjs 多分頁座標重置 (跳躍至左上角/中心) Bug

## 1. 症狀描述 (Symptoms)
在多分頁 (Multi-tab) 協作的場景下，當使用者在 Tab A 移動一張卡牌時：
1. Tab B 的該張卡牌會瞬間失去原本的座標，跳躍至預設降級位置（例如左上角或畫面正中央）。
2. 更嚴重的是，有時連 Tab A 的卡牌也會跟著跳躍。
3. 系統出現「Tab B 無法改變 Tab A」的單向同步失效狀態。
4. 即使重新整理頁面 (Hard Reload)，卡牌依然停留在錯誤的位置，彷彿正確的座標從未被存入資料庫中。

## 2. 錯誤的懷疑與排查過程 (False Leads & Investigation)
在經歷了超過數個小時的排查中，我們經歷了以下幾個階段的假設，並一一被推翻：

- **懷疑一：Yjs 的 `undefined` 序列化漏洞**
  - **假設**：我們懷疑某處程式碼傳入了 `undefined` 的座標，導致 Yjs 在 `toJSON()` 時直接將 `x` 和 `y` 屬性抹除。
  - **行動**：我們在 `updatePosition` 加入了極度嚴格的型別檢查與防護（`typeof x === 'number' && !isNaN(x)`）。
  - **結果**：防護生效，攔截了不合法的數值，但 **Bug 依然存在**。

- **懷疑二：舊版 Firestore `onSnapshot` 觸發的 Echo 效應 (Race Condition)**
  - **假設**：舊版的 `v2Snap` 監聽器在載入時，從 Firestore 讀取了缺乏座標的舊資料，並強制覆寫了 Yjs 中的狀態。
  - **行動**：我們禁用了 `processSnapshot` 在運行時期的動態重建能力，阻斷了舊版同步的干擾。
  - **結果**：干擾消失，但 **跨 Tab 同步依然丟失座標**。

- **懷疑三：Firestore `yjs_state` 檔案超過 1MB 限制被雲端靜默拒絕**
  - **假設**：「B 無法改變 A」以及「重整後座標依然遺失」是典型的「資料根本沒寫進資料庫」特徵。我們懷疑 `stateVector` 夾帶了過大圖片導致超過 Firestore 的 1MB 上限。
  - **行動**：加入了 payload size 的監控與日誌攔截。
  - **結果**：日誌顯示 Payload 只有不到 100KB。**假設被推翻**。但這份日誌卻意外揭露了真正的兇手。

## 3. 真正的根本原因 (Root Cause)
在觀察 DevTools Console 時，我們發現了 Yjs 引擎噴出的紅色警告：
> ❌ `Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438`

### 模組重複載入災難 (The ESM Module Duplication Disaster)
我們使用 `esm.sh` CDN 動態引入了兩個套件：
```javascript
const yjsMod = await import('https://esm.sh/yjs@13.6.14');
const idbMod = await import('https://esm.sh/y-indexeddb@9.0.12');
```
因為 CDN 的相依性解析機制，`y-indexeddb` 在底層偷偷拉取了**另一個實體**的 Yjs 模組。這導致瀏覽器記憶體中同時存在 **引擎 A (主程式用)** 與 **引擎 B (IndexedDB用)**。

### 骨牌效應
1. `y-indexeddb` (引擎 B) 從本地快取還原了文件 (`Y.Doc`)，並生成了卡牌的 `Y.Map`。
2. 我們的程式碼使用引擎 A 建立了新的嵌套 `Y.Map` (例如 `layouts` 裡面的座標結構)，並把它 `set` 進去。
3. 當 `Y.encodeStateAsUpdate` 準備將資料打包傳給其他分頁或雲端時，引擎 A 會檢查內部的資料結構 (`instanceof Y.Map`)。
4. 因為最外層的 `Y.Map` 是引擎 B 做的，引擎 A 判定**「這不是合法的 Y.Map」**！
5. **致命一擊**：引擎 A 在序列化時，直接將無法通過 Constructor Check 的結構 (以及裡面包含的 `x`, `y` 屬性) **當作無法辨識的垃圾丟棄**。
6. 接收端 (Tab B 或 Firestore) 收到了一個沒有座標的殘缺結構，導致渲染邏輯觸發 Fallback，卡牌跳躍至 (50, 50)。

## 4. 解決方案 (The Fix)
要解決這個問題，必須強制整個應用程式 (包含所有的第三方 Yjs provider) **共用同一個 Yjs 記憶體實例**。
對於 `esm.sh`，我們透過加入 `?deps=yjs@<version>` 參數來強制鎖定依賴：

```javascript
// 【錯誤寫法】這會導致 y-indexeddb 引入自己的 yjs 副本
const idbMod = await import('https://esm.sh/y-indexeddb@9.0.12');

// 【正確寫法】強制 y-indexeddb 共用外層指定的 yjs 版本實例
const yjsMod = await import('https://esm.sh/yjs@13.6.14');
const idbMod = await import('https://esm.sh/y-indexeddb@9.0.12?deps=yjs@13.6.14');
```

## 5. 未來開發守則 (Takeaways for Future AI & Developers)
1. **永遠警戒 `Yjs was already imported` 警告**：這不是一個普通的 warning，這代表你的 CRDT 資料結構正在發生跨實例污染，接下來一定會發生資料遺失 (Data Loss)。
2. **ESM CDN 引入陷阱**：在無打包工具 (No-Bundler) 的環境下使用 `esm.sh` 或 `jsdelivr` 引入任何 Yjs 的擴充套件 (如 `y-webrtc`, `y-websocket`, `y-indexeddb`) 時，**絕對必須明確指定 peer dependency** (`?deps=yjs@...`)，否則 Constructor Checks 必定失敗。
3. **不要輕易懷疑 Yjs 的核心序列化能力**：Yjs 的 `encodeStateAsUpdate` 非常穩固。如果發生屬性蒸發，99% 是因為傳入了錯誤的型別 (`undefined`)，或者是發生了實例重複導致的 `instanceof` 判斷失敗。
