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
  "eventTime": "ISO 8601 時間戳", // 若可解析，回傳該事件的原始時間，否則為 null
  "alertTime": "ISO 8601 時間戳", // 若為實體會議/外出，自動提早1小時提醒；若為線上，提早5~10分鐘。若僅為日常提醒則與 eventTime 相同。否則為 null
  "reason": "字串", // 給使用者的簡短對話語氣解釋，例如「已為您提早一小時提醒以便出發前往 Costco」。若不需要特別解釋，可留空。
  "needsClarification": true或false, // 若使用者提及如「我生日那天」但缺乏確切資訊無法計算，則設為 true
  "clarificationQuestion": "字串" // 若需釐清，反問使用者的問題
}

注意事項：
1. 你的回答將直接被程式 parsing，嚴禁回傳 \`\`\`json 等任何 markdown！
2. 請根據邏輯推演合理的提醒時間。若文字毫無時間概念，請回傳 {"hasIntent": false}。`;

    async function parseIntent(noteText) {
        if (!noteText || noteText.trim() === '') return { hasIntent: false };

        const apiKey = PostIt.Settings.getAiKey();
        if (!apiKey) {
            console.warn('[AI] 尚未設定 API Key');
            return { hasIntent: false, error: 'NO_API_KEY' };
        }

        const tzOffset = new Date().getTimezoneOffset();
        const now = new Date();
        // 將 Date 轉成清楚的當前時區表達方式，讓 AI 參考
        const prompt = `目前使用者的本地時間為: ${now.toISOString()} (UTC${tzOffset <= 0 ? '+' : '-'}${Math.abs(tzOffset)/60})\n\n使用者的便利貼內容:\n"${noteText}"`;

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
            const textResult = data.candidates[0].content.parts[0].text;
            
            const resultObj = JSON.parse(textResult);
            return resultObj;

        } catch (error) {
            console.error('[AI] 語意解析發生不可預期錯誤:', error);
            return { hasIntent: false, error: 'PARSE_ERROR' };
        }
    }

    return { parseIntent };
})();
