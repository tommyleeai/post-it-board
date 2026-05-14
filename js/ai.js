// ============================================
// AI 時效性語意解析模組 (Gemini API)
// ============================================
PostIt.AI = (function () {
    'use strict';

    // 系統提示詞
    const SYSTEM_PROMPT = `你是一個時間排程助手，你的任務是從使用者的「便利貼文字」中尋找任何「未來的時間點或日期」或「提醒意圖」，並建立時效性提醒。
請以嚴格的 JSON 格式回傳：

{
  "hasIntent": true或false,
  "eventTime": "YYYY-MM-DDTHH:mm:ss",
  "alertTime": "YYYY-MM-DDTHH:mm:ss",
  "reason": "字串",
  "repeatRule": "none|minutely|daily|weekdays|weekly|monthly|yearly",
  "needsClarification": true或false,
  "clarificationQuestion": "字串",
  "conflictWarning": "字串"
}

hasIntent 判斷規則（符合任一即為 true）：
A) 文字中出現明確的「時間、日期、或是今明後天等時間副詞」（如：下午5:30、等一下、四點、明天）
B) 文字中出現提醒意圖動詞或片語（中文：提醒、提示、記得、要記得、別忘了、不要忘記、別忘記、忘了、不能忘、千萬記得、叫我、通知我、告訴我、催我、鬧鐘、設鬧鐘、備忘、待辦、要做、該做、得做、必須、準時、截止、到期、繳費、預約、掛號、報名、簽到、打卡、出發、接人、送件、還書、還車、取貨、拿藥、買東西；英文：remind、reminder、remember、don't forget、do not forget、alert me、notify、notification、alarm、set alarm、wake me、todo、to-do、to do、deadline、due、schedule、appointment、pick up、drop off、by today、by tomorrow、ASAP、heads up、note to self、follow up），即使沒有明確時間也算 true

注意事項：
1. 若符合規則 A（有明確時間），請正常計算 eventTime 和 alertTime，needsClarification 設為 false。
2. 若只符合規則 B（有提醒意圖但無明確時間），請設 hasIntent 為 true、needsClarification 為 true，並在 clarificationQuestion 反問使用者「你希望什麼時候被提醒？」，eventTime 和 alertTime 設為空字串 ""。
3. 請依照傳入的「目前本地時間」推算。回傳時間務必是 ISO 8601 格式但「絕對不要帶 Z 或是 +08:00」。
4. 若為外出/拿藥/買東西，提早1小時提醒；會議，提早10分鐘。若無特別定義則提早10分鐘。
5. 若時間模糊到無法猜測（例如：生日那天、下次開會），設 needsClarification 為 true 並反問。
6. repeatRule 規則：「每分鐘/每一分鐘」→ minutely、「每天」→ daily、「每個工作日/週一到週五」→ weekdays、「每週X」→ weekly、「每月X號」→ monthly、「每年」→ yearly。若無重複意圖則設為 "none"。重複提醒時，eventTime 和 alertTime 設為「最近一次」的觸發時間（minutely 的話 alertTime 就是目前時間加 1 分鐘）。
7. 欄位必須完整！若 hasIntent 為 false，請將其餘字串欄位設為空字串 ""，布林值設為 false，repeatRule 設為 "none"。
8. 衝突偵測：若輸入包含了「現有其他行程」，請比對新的 eventTime（與地點）是否與現有行程發生時間重疊、或交通時間明顯不合理的衝突。若有衝突，請在 conflictWarning 提供簡短繁體中文警告；若無，設為空字串 ""。
9. **最重要**：若使用者的意圖是「股價提醒」（hasStockAlert 為 true），且文字中沒有額外的時間提醒需求，則時間提醒部分應設為 hasIntent: false、needsClarification: false。因為股價提醒的觸發條件是「價格達標」而非「特定時間」，不需要反問使用者任何時間問題。

=== 股價提醒功能 ===
除了時間提醒之外，你也要偵測使用者是否想監控股價。
若文字中包含股票代碼（如 TSLA、AAPL、GOOG、AMZN、NVDA 等美股代碼）加上價格條件，視為股價提醒。

額外回傳欄位：
{
  "hasStockAlert": true或false,
  "stockSymbol": "股票代碼（大寫）",
  "stockTargetPrice": 目標價格（數字）,
  "stockCondition": ">=" 或 "<=",
  "stockAlertReason": "簡短說明"
}

股價提醒判斷規則：
- 「TSLA 到 450 通知我」「TSLA $450 的時候叫我」→ hasStockAlert: true, stockSymbol: "TSLA", stockTargetPrice: 450, stockCondition: ">="
- 「AAPL 跌到 150 提醒」「AAPL 跌破 150」→ stockCondition: "<="
- 「特斯拉到 450 叫我」→ 辨識為 TSLA
- 「蘋果股票 200 通知」→ 辨識為 AAPL
- 若同時包含時間提醒與股價提醒，兩者都設為 true。
- 若不是股價相關，hasStockAlert 設為 false，其餘股價欄位設為預設值（空字串或 0）。

=== 待辦事項提取功能 ===
你也要偵測使用者的文字中是否包含「多個待辦事項 / 行動項目」。
若文字中列舉了 2 個以上需要執行的事項，視為待辦清單。

額外回傳欄位：
{
  "hasTodoItems": true或false,
  "todoTitle": "清單標題（若有的話）",
  "todoItems": ["事項1", "事項2", "事項3"]
}

待辦事項判斷規則：
- 文字中有 2 個以上需要行動的項目，用序號(1. 2. 3.)、頓號(、)、換行、或逗號分隔
- 例如：「買菜清單：雞蛋、牛奶、麵包」→ hasTodoItems: true, todoTitle: "買菜清單", todoItems: ["雞蛋", "牛奶", "麵包"]
- 例如：「開會結論：1.修改報告 2.聯繫客戶 3.更新文件」→ hasTodoItems: true, todoTitle: "開會結論", todoItems: ["修改報告", "聯繫客戶", "更新文件"]
- 例如：「今天要做的事：\n寫作業\n洗衣服\n買晚餐」→ hasTodoItems: true
- 若只有單一句子或純敘述（如「今天天氣很好」），hasTodoItems 設為 false
- todoTitle 是可選的：若原文有明確標題（如「買菜清單：」「開會結論：」），提取出來；若沒有，設為空字串
- todoItems 中的每個項目應該是簡潔的行動描述，去除序號和多餘符號
- 若不是待辦清單，hasTodoItems 設為 false，todoTitle 設為空字串，todoItems 設為空陣列 []`;

    async function parseIntent(noteText, otherNotesContext = '') {
        if (!noteText || noteText.trim() === '') return { hasIntent: false };

        const apiKey = PostIt.Settings.getAiKey();
        if (!apiKey) {
            console.warn('[AI] 尚未設定 API Key');
            return { hasIntent: false, error: 'NO_API_KEY' };
        }

        const now = new Date();
        const year = now.getFullYear();
        const mon = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hr = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const sec = String(now.getSeconds()).padStart(2, '0');
        const localTimeStr = `${year}-${mon}-${day}T${hr}:${min}:${sec}`;

        // 將清楚的無時區本地時間交給 AI 推算
        let prompt = `目前使用者的本地時間為: ${localTimeStr}\n\n使用者的便利貼內容:\n"${noteText}"`;
        if (otherNotesContext && otherNotesContext.trim() !== '') {
            prompt += `\n\n白板上現有的其他行程列表:\n${otherNotesContext}`;
        }

        try {
            // 改用快速且日常實用的 Gemini 2.5 Flash 模型
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { 
                        parts: [{ text: SYSTEM_PROMPT }]
                    },
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.1, // 低隨機性，高精度
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                hasIntent: { type: "BOOLEAN" },
                                eventTime: { type: "STRING" },
                                alertTime: { type: "STRING" },
                                reason: { type: "STRING" },
                                repeatRule: { type: "STRING" },
                                needsClarification: { type: "BOOLEAN" },
                                clarificationQuestion: { type: "STRING" },
                                conflictWarning: { type: "STRING" },
                                hasStockAlert: { type: "BOOLEAN" },
                                stockSymbol: { type: "STRING" },
                                stockTargetPrice: { type: "NUMBER" },
                                stockCondition: { type: "STRING" },
                                stockAlertReason: { type: "STRING" },
                                hasTodoItems: { type: "BOOLEAN" },
                                todoTitle: { type: "STRING" },
                                todoItems: { type: "ARRAY", items: { type: "STRING" } }
                            },
                            required: ["hasIntent", "eventTime", "alertTime", "reason", "repeatRule", "needsClarification", "clarificationQuestion", "conflictWarning", "hasStockAlert", "stockSymbol", "stockTargetPrice", "stockCondition", "stockAlertReason", "hasTodoItems", "todoTitle", "todoItems"]
                        }
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('[AI] API 調用失敗:', errText);
                
                // 放寬報錯條件：不論是什麼錯誤都直接拋給使用者看
                if (typeof PostIt.Board !== 'undefined') {
                    if (errText.includes('expired') || errText.includes('API_KEY_INVALID')) {
                        PostIt.Board.showToast('AI 解析失敗：API Key 已過期或無效', 'error', null, 6000);
                    } else if (response.status === 429 || response.status === 503) {
                        const ollamaSettings = PostIt.Settings.getOllamaSettings();
                        if (ollamaSettings && ollamaSettings.enableFallback && ollamaSettings.url && ollamaSettings.model) {
                            if (typeof PostIt.Board !== 'undefined') {
                                PostIt.Board.showToast('雲端 AI 繁忙，正在切換至本地端 Ollama 備援解析...', 'info', null, 4000);
                            }
                            return await fallbackToOllama(prompt, ollamaSettings);
                        } else {
                            const errMsg = response.status === 429 ? '呼叫次數達上限 (429)' : 'AI 伺服器目前大塞車 (503)';
                            PostIt.Board.showToast(`AI 解析失敗：${errMsg}，請稍後重試`, 'error', null, 6000);
                        }
                    } else {
                        // 未知錯誤，直接顯示大略內容
                        const snippet = errText.substring(0, 100);
                        PostIt.Board.showToast('AI 解析拒絕 (HTTP ' + response.status + ')：' + snippet, 'error', null, 8000);
                    }
                }
                return { hasIntent: false, error: 'API_ERROR' };
            }

            const data = await response.json();
            let textResult = data.candidates[0].content.parts[0].text;
            
            // 強制清除可能出現的 markdown 區塊
            textResult = textResult.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

            const resultObj = JSON.parse(textResult);
            
            // 防呆：強制移除可能導致時區錯亂的 Z 或 +08:00
            if (resultObj.eventTime && typeof resultObj.eventTime === 'string') {
                resultObj.eventTime = resultObj.eventTime.replace(/Z|[+-]\d{2}:\d{2}$/, '');
            }
            if (resultObj.alertTime && typeof resultObj.alertTime === 'string') {
                resultObj.alertTime = resultObj.alertTime.replace(/Z|[+-]\d{2}:\d{2}$/, '');
            }

            return resultObj;

        } catch (error) {
            console.error('[AI] 語意解析發生不可預期錯誤:', error);
            if (typeof PostIt.Board !== 'undefined') {
                PostIt.Board.showToast('AI 解析發生錯誤：' + (error.message || '未知錯誤'), 'error', null, 8000);
            }
            return { hasIntent: false, error: 'PARSE_ERROR' };
        }
    }

    async function fallbackToOllama(promptText, settings) {
        try {
            const urlObj = settings.url.replace(/\/$/, "");
            const response = await fetch(`${urlObj}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: settings.model,
                    prompt: promptText,
                    system: SYSTEM_PROMPT,
                    format: "json",
                    stream: false
                })
            });

            if (!response.ok) {
                console.error('[AI] Ollama 備援請求失敗 HTTP:', response.status);
                if (typeof PostIt.Board !== 'undefined') {
                    if (response.status === 404) {
                        PostIt.Board.showToast(`Ollama 備援失敗：找不到模型 "${settings.model}"，請確認名稱是否正確！`, 'error', null, 7000);
                    } else {
                        PostIt.Board.showToast(`Ollama 備援伺服器錯誤 (HTTP ${response.status})`, 'error', null, 6000);
                    }
                }
                return { hasIntent: false, error: 'OLLAMA_HTTP_ERROR' };
            }

            const data = await response.json();
            let textResult = data.response;

            // 強制清除可能出現的 markdown 區塊 (Ollama 小模型經常給出這些)
            textResult = textResult.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();

            const resultObj = JSON.parse(textResult);

            // 防呆：強制移除可能導致時區錯亂的 Z 或 +08:00
            if (resultObj.eventTime && typeof resultObj.eventTime === 'string') {
                resultObj.eventTime = resultObj.eventTime.replace(/Z|[+-]\d{2}:\d{2}$/, '');
            }
            if (resultObj.alertTime && typeof resultObj.alertTime === 'string') {
                resultObj.alertTime = resultObj.alertTime.replace(/Z|[+-]\d{2}:\d{2}$/, '');
            }

            if (typeof PostIt.Board !== 'undefined') {
                PostIt.Board.showToast('✅ 已成功透過本地端 Ollama 完成解析！', 'success', null, 3000);
            }

            return resultObj;
        } catch (error) {
            console.error('[AI] Ollama 備援遭遇網路或解析錯誤:', error);
            if (typeof PostIt.Board !== 'undefined') {
                PostIt.Board.showToast('Ollama 備援連線失敗：請確認網址正確或是否發生 CORS 跨域阻擋', 'error', null, 8000);
            }
            return { hasIntent: false, error: 'OLLAMA_FETCH_ERROR' };
        }
    }

    async function testOllama(url, model) {
        try {
            const urlObj = url.replace(/\/$/, "");
            const response = await fetch(`${urlObj}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: "這是一個網路傳輸與模型負載測試，請只回覆我一個字：OK",
                    format: "json",
                    stream: false
                })
            });

            if (!response.ok) {
                if (response.status === 404) return { success: false, msg: `找不到模型 "${model}"` };
                return { success: false, msg: `伺服器回應錯誤 (HTTP ${response.status})` };
            }
            return { success: true, msg: '連線與解析測試成功！' };
        } catch (error) {
            return { success: false, msg: '無法連線伺服器，可能為防毒、CORS 阻擋或尚未開啟' };
        }
    }

    async function testGemini(apiKey) {
        if (!apiKey || apiKey.trim() === '') return { success: false, msg: 'API Key 不可為空' };
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "這是一個網路傳輸與模型負載測試，請只回覆我一個字：OK" }] }]
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                if (response.status === 400 || errText.includes('API_KEY_INVALID') || errText.includes('API key not valid')) {
                    return { success: false, msg: 'API Key 無效或已過期' };
                } else if (response.status === 429) {
                    return { success: false, msg: '呼叫次數達上限 (429)' };
                } else if (response.status === 503) {
                    return { success: false, msg: '伺服器目前大塞車 (503)' };
                }
                return { success: false, msg: `伺服器回應錯誤 (HTTP ${response.status})` };
            }
            return { success: true, msg: '✅ 雲端 Gemini 連線測試成功！' };
        } catch (error) {
            return { success: false, msg: '無法連線至 Google 伺服器，請檢查網路' };
        }
    }

    return { parseIntent, testOllama, testGemini };
})();
