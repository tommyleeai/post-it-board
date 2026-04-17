// ============================================
// 帳號設定模組 — 字型/大小/顏色預設值管理
// ============================================
PostIt.Settings = (function () {
    'use strict';

    // 系統預設值
    const DEFAULTS = {
        fontFamily: 'Caveat',
        fontSize: 20,
        fontColor: 'rgba(0,0,0,0.78)',
        defaultNoteColor: 'random',
        boardBgImage: '' // 白板背景（空白表示預設紋理）
    };

    // 可用字型清單
    const FONT_OPTIONS = [
        { value: 'Caveat', label: 'Caveat（手寫風）' },
        { value: 'Noto Sans TC', label: 'Noto Sans TC（中文正黑）' },
        { value: 'Inter', label: 'Inter（現代無襯線）' },
        { value: 'Comic Neue', label: 'Comic Neue（漫畫風）' },
        { value: 'Kalam', label: 'Kalam（手寫風）' }
    ];

    // 預設字體顏色選項
    const FONT_COLOR_PRESETS = [
        'rgba(0,0,0,0.78)',  // 深黑（預設）
        '#333333',            // 深灰
        '#1a1a1a',            // 幾乎全黑
        '#1565C0',            // 深藍
        '#c62828',            // 深紅
        '#2e7d32',            // 深綠
        '#6A1B9A'             // 深紫
    ];

    let accountSettings = null; // 當前帳號設定（從 Firestore 載入）

    // -------- 載入帳號設定 --------
    async function load() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return;

        try {
            const db = PostIt.Firebase.getDb();
            // 強制從伺服器讀取，避免與 auth.js 的 saveProfile 產生本地快取的競爭危害
            const doc = await db.collection('users').doc(uid).get({ source: 'server' });
            if (doc.exists && doc.data().settings) {
                accountSettings = { ...DEFAULTS, ...doc.data().settings };
            } else {
                accountSettings = { ...DEFAULTS };
            }
            console.log('[Settings] 帳號設定已載入:', accountSettings);
        } catch (error) {
            console.error('[Settings] 載入設定失敗:', error);
            accountSettings = { ...DEFAULTS };
        }
    }

    // -------- 儲存帳號設定到 Firestore --------
    async function save(newSettings) {
        const uid = PostIt.Auth.getUid();
        if (!uid) return;

        try {
            const db = PostIt.Firebase.getDb();
            // 在本地先行完整合併設定
            const mergedSettings = { ...(accountSettings || DEFAULTS), ...newSettings };
            
            await db.collection('users').doc(uid).set({
                settings: mergedSettings
            }, { merge: true });

            accountSettings = mergedSettings;
            console.log('[Settings] 帳號設定已儲存:', accountSettings);
        } catch (error) {
            console.error('[Settings] 儲存設定失敗:', error);
            throw error;
        }
    }

    // -------- 重設為系統預設 --------
    async function reset() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return;

        try {
            const db = PostIt.Firebase.getDb();
            await db.collection('users').doc(uid).set({
                settings: DEFAULTS
            }, { merge: true });

            accountSettings = { ...DEFAULTS };
            console.log('[Settings] 已重設為系統預設');
        } catch (error) {
            console.error('[Settings] 重設失敗:', error);
            throw error;
        }
    }

    // -------- 取得有效設定（合併帳號預設 + 單卡覆蓋） --------
    // 優先順序: 單卡 > 帳號預設 > 系統預設
    function getEffective(noteData) {
        const base = accountSettings || DEFAULTS;
        return {
            fontFamily: noteData.fontFamily || base.fontFamily || DEFAULTS.fontFamily,
            fontSize: noteData.fontSize || base.fontSize || DEFAULTS.fontSize,
            fontColor: noteData.fontColor || base.fontColor || DEFAULTS.fontColor
        };
    }

    // -------- 取得帳號設定（唯讀） --------
    function getAccountSettings() {
        return accountSettings || { ...DEFAULTS };
    }

    // -------- AI API Key 管理 (純本地端儲存) --------
    const AI_KEY_STORAGE_KEY = 'postit_gemini_api_key';
    const DEFAULT_AI_KEY = 'AIzaSyA4rngnyQfawDPXU1W2clDtUHbrqHB8DnU'; // 預設使用提供的金鑰

    function getAiKey() {
        return localStorage.getItem(AI_KEY_STORAGE_KEY) || DEFAULT_AI_KEY;
    }

    function setAiKey(key) {
        if (!key || key.trim() === '') {
            localStorage.removeItem(AI_KEY_STORAGE_KEY);
        } else {
            localStorage.setItem(AI_KEY_STORAGE_KEY, key.trim());
        }
    }

    // -------- 取得系統預設 --------
    function getDefaults() {
        return { ...DEFAULTS };
    }

    // -------- 取得字型選項清單 --------
    function getFontOptions() {
        return FONT_OPTIONS;
    }

    // -------- 取得字體顏色預設值 --------
    function getFontColorPresets() {
        return FONT_COLOR_PRESETS;
    }

    return {
        load, save, reset,
        getEffective, getAccountSettings, getDefaults,
        getFontOptions, getFontColorPresets,
        getAiKey, setAiKey
    };
})();
