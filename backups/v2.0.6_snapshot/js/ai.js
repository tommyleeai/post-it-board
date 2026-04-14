// ============================================
// AI 時效性語意解析模組 (Gemini API)
// ============================================
PostIt.AI = (function () {
    'use strict';

    // 系統提示詞
    const SYSTEM_PROMPT = `你是一個時間排程助手，你的任務是從使用者的「便利貼文字」中尋找任何「未來的時間點或日期」，並建立時效性提醒。
請以嚴格的 JSON 格式回傳：

{
  "hasIntent": true或false, // 只要文章內有出現明確的「時間、日期、或是今明後天等時間副詞」，一律回傳 true！
  "eventTime": "YYYY-MM-DDTHH:mm:ss", // 該事件發生的精確時間 (絕對不要加上 Z 或時區)
  "alertTime": "YYYY-MM-DDTHH:mm:ss", // 提醒時間。若為外出/拿藥/買東西，提早1小時；會議，提早10分鐘。若無特別定義則提早10分鐘。(絕對不要包含 Z 或時區)
  "reason": "字串", // 給使用者的貼心提示，例如「為您提早一小時提醒出發前往 Costco」。
  "needsClarification": true或false, // 若時間模糊到無法猜測 (例如: 生日那天)，設為 true
  "clarificationQuestion": "字串" // 若需釐清，反問使用者的問題
}

注意事項：
1. 只要文字有提到具體的相對或絕對時間（如：下午5:30、等一下、四點），就代表有時間意圖 (hasIntent: true)！
2. 請依照傳入的「目前本地時間」推算。回傳時間務必是 ISO 8601 格式但「絕對不要帶 Z 或是 +08:00」。`;

    async function parseIntent(noteText) {
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
        const prompt = `目前使用者的本地時間為: ${localTimeStr}\n\n使用者的便利貼內容:\n"${noteText}"`;

        try {
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
                                needsClarification: { type: "BOOLEAN" },
                                clarificationQuestion: { type: "STRING" }
                            },
                            required: ["hasIntent"]
                        }
                    }
                })
            });

            if (!response.ok) {
                console.error('[AI] API 調用失敗:', await response.text());
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
            return { hasIntent: false, error: 'PARSE_ERROR' };
        }
    }

    return { parseIntent };
})();
