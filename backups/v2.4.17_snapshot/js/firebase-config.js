// ============================================
// Firebase 初始化 — 共用 tommylee-ai 專案
// ============================================
const PostIt = window.PostIt || {};
window.PostIt = PostIt;

PostIt.Firebase = (function () {
    'use strict';

    // 共用 tommylee-ai Firebase 專案設定
    const firebaseConfig = {
        apiKey: "AIzaSyCaeS087aGAeTlr83mKBxeoP3XTj85lZf4",
        authDomain: "tommylee-ai.firebaseapp.com",
        projectId: "tommylee-ai",
        storageBucket: "tommylee-ai.firebasestorage.app",
        messagingSenderId: "925429359201",
        appId: "1:925429359201:web:f95ef585c9ccc516280020"
    };

    let app = null;
    let auth = null;
    let db = null;
    let storage = null;

    function init() {
        try {
            if (typeof firebase === 'undefined') {
                console.error('[PostIt] Firebase SDK 未載入');
                return false;
            }

            app = firebase.initializeApp(firebaseConfig);
            auth = firebase.auth();
            db = firebase.firestore();
            storage = firebase.storage();

            // 繁體中文
            auth.languageCode = 'zh-TW';

            console.log('[PostIt] ✅ Firebase 初始化成功');
            return true;
        } catch (error) {
            console.error('[PostIt] ❌ Firebase 初始化失敗:', error);
            return false;
        }
    }

    function getAuth() { return auth; }
    function getDb() { return db; }
    function getStorage() { return storage; }

    return { init, getAuth, getDb, getStorage };
})();
