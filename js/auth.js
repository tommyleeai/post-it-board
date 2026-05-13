// ============================================
// Google 登入 / 登出模組
// ============================================
PostIt.Auth = (function () {
    'use strict';

    let currentUser = null;
    let onAuthChangeCallback = null;

    function init(onAuthChange) {
        onAuthChangeCallback = onAuthChange;

        const auth = PostIt.Firebase.getAuth();
        if (!auth) return;

        // 監聽登入狀態變化
        auth.onAuthStateChanged(async (user) => {
            currentUser = user;

            // 登入時儲存 profile（讓 admin 可以看到使用者資訊）
            // 使用 sessionStorage 避免每次 F5 重整都觸發寫入
            // ⚠️ 必須 await 等待完成，否則 saveProfile 的 Firestore 寫入會污染
            //    Settings.load() 的延遲補償快取 (Latency-compensated snapshot)，
            //    導致 get() 拿到不含 settings 欄位的快照 → boardBgImage 掉回空字串
            if (user && !sessionStorage.getItem('profileSaved')) {
                await saveProfile(user);
                sessionStorage.setItem('profileSaved', 'true');
            }

            if (onAuthChangeCallback) {
                onAuthChangeCallback(user);
            }
        });

        // 綁定登入按鈕
        const btnLogin = document.getElementById('btn-google-login');
        if (btnLogin) {
            btnLogin.addEventListener('click', signIn);
        }

        // 綁定登出按鈕
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', signOut);
        }
    }

    async function signIn() {
        try {
            const auth = PostIt.Firebase.getAuth();
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        } catch (error) {
            console.error('[Auth] 登入失敗:', error);
            if (error.code !== 'auth/popup-closed-by-user') {
                PostIt.Board.showToast('登入失敗，請再試一次', 'error');
            }
        }
    }

    async function signOut() {
        try {
            const auth = PostIt.Firebase.getAuth();
            await auth.signOut();
        } catch (error) {
            console.error('[Auth] 登出失敗:', error);
        }
    }

    function getUser() {
        return currentUser;
    }

    function getUid() {
        return currentUser ? currentUser.uid : null;
    }

    // 儲存使用者 profile 到 Firestore（供 admin 後台查看）
    async function saveProfile(user) {
        try {
            const db = PostIt.Firebase.getDb();
            await db.collection('users').doc(user.uid).set({
                displayName: user.displayName || '',
                email: user.email || '',
                photoURL: user.photoURL || '',
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.warn('[Auth] 儲存 profile 失敗:', err);
        }
    }

    return { init, signIn, signOut, getUser, getUid };
})();
