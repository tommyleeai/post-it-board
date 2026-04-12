// ============================================
// AI 時效性語意解析模組 (Gemini API)
// ============================================
PostIt.AI = (function () {
    'use strict';

    // 系統提示詞
    const SYSTEM_PROMPT = `你是一個時間排程助手，請從使用者的「便利貼文字」與「目前本地時間」中解析出具有時效性提醒的意圖。
請嚴格依據以下 JSON 格式回傳，不要包含任何 markdown 或多餘字串：

{
  "hasIntent": true或false, // 是否包含時間排程意圖
  "eventTime": "YYYY-MM-DDTHH:mm:ss", // 若可解析，回傳該事件的原始時間，例如 2026-04-12T15:30:00 (絕對不要加上 Z 或時區)
  "alertTime": "YYYY-MM-DDTHH:mm:ss", // 若為實體會議/外出，自動提早1小時提醒；若為線上，提早5~10分鐘。若僅為日常提醒則與 eventTime 相同。(絕對不要加上 Z 或時區)
  "reason": "字串", // 給使用者的簡短對話語氣解釋，例如「已為您提早一小時提醒以便出發前往 Costco」。若不需要特別解釋，可留空。
  "needsClarification": true或false, // 若使用者提及如「我生日那天」但缺乏確切資訊無法計算，則設為 true
  "clarificationQuestion": "字串" // 若需釐清，反問使用者的問題
}

注意事項：
1. 請嚴格依照給定的「目前本地時間」進行推算，並且回傳的時間字串「絕對不要」包含結尾的 Z 或是任何時區偏移（例如 +08:00）！
2. 你的回答將直接被程式 parsing，嚴禁回傳 \`\`\`json 等任何 markdown！
3. 請根據邏輯推演合理的提醒時間。若文字毫無時間概念，請回傳 {"hasIntent": false}。`;

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
                        responseMimeType: "application/json"
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
