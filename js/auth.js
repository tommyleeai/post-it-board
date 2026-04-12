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
        auth.onAuthStateChanged((user) => {
            currentUser = user;
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

    return { init, signIn, signOut, getUser, getUid };
})();
