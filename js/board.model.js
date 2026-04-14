// ============================================
// 白板 CRUD 模組 (Board Model)
// ============================================
PostIt.BoardModel = (function () {
    'use strict';

    const MAX_BOARDS = 10;
    const DEFAULT_BOARD_ID = 'default';
    const STORAGE_KEY = 'postit_active_board';

    // 預設白板清單（新使用者初次登入時自動建立）
    const DEFAULT_BOARD = {
        name: '我的白板',
        icon: '📌',
        color: '#4A90D9',
        order: 0
    };

    let boardsCache = {};   // { boardId: boardData }
    let activeBoardId = null;
    let unsubscribe = null;
    let onSwitchCallback = null; // 白板切換時的回呼

    // -------- 取得 boards collection ref --------
    function getBoardsRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        return db.collection('users').doc(uid).collection('boards');
    }

    // -------- 確保預設白板存在（首次登入或遷移後） --------
    async function ensureDefault() {
        const ref = getBoardsRef();
        if (!ref) return;

        const doc = await ref.doc(DEFAULT_BOARD_ID).get();
        if (!doc.exists) {
            await ref.doc(DEFAULT_BOARD_ID).set({
                ...DEFAULT_BOARD,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[BoardModel] 已建立預設白板');
        }
    }

    // -------- 訂閱白板清單即時更新 --------
    function subscribe(onUpdate) {
        cleanup();
        const ref = getBoardsRef();
        if (!ref) return;

        unsubscribe = ref.orderBy('order', 'asc').onSnapshot((snapshot) => {
            boardsCache = {};
            snapshot.forEach((doc) => {
                boardsCache[doc.id] = { id: doc.id, ...doc.data() };
            });

            // 若尚未設定 activeBoardId，從 localStorage 讀取或預設
            if (!activeBoardId) {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved && boardsCache[saved]) {
                    activeBoardId = saved;
                } else {
                    activeBoardId = DEFAULT_BOARD_ID;
                }
            }

            if (onUpdate) onUpdate(boardsCache, activeBoardId);
        }, (error) => {
            console.error('[BoardModel] Firestore 訂閱錯誤:', error);
        });
    }

    function cleanup() {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        boardsCache = {};
        activeBoardId = null;
    }

    // -------- 建立新白板 --------
    async function create(name, icon = '📋', color = '#4A90D9') {
        const count = Object.keys(boardsCache).length;
        if (count >= MAX_BOARDS) {
            PostIt.Board.showToast(`已達 ${MAX_BOARDS} 塊白板上限！`, 'error');
            return null;
        }

        const ref = getBoardsRef();
        if (!ref) return null;

        const boardData = {
            name: name,
            icon: icon,
            color: color,
            order: count, // 排在最後
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const docRef = await ref.add(boardData);
            console.log('[BoardModel] 白板已建立:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('[BoardModel] 建立白板失敗:', error);
            PostIt.Board.showToast('建立白板失敗', 'error');
            return null;
        }
    }

    // -------- 更新白板資訊 --------
    async function update(boardId, data) {
        const ref = getBoardsRef();
        if (!ref || !boardId) return;

        try {
            await ref.doc(boardId).update(data);
        } catch (error) {
            console.error('[BoardModel] 更新白板失敗:', error);
        }
    }

    // -------- 刪除白板（含所有子資料） --------
    async function remove(boardId) {
        if (boardId === DEFAULT_BOARD_ID) {
            PostIt.Board.showToast('無法刪除預設白板', 'error');
            return;
        }

        const ref = getBoardsRef();
        if (!ref) return;

        try {
            // 先刪除子集合的所有文件
            const db = PostIt.Firebase.getDb();
            const uid = PostIt.Auth.getUid();
            const boardRef = db.collection('users').doc(uid).collection('boards').doc(boardId);

            // 刪除 notes
            const notesSnap = await boardRef.collection('notes').get();
            const batch1 = db.batch();
            notesSnap.forEach(doc => batch1.delete(doc.ref));
            await batch1.commit();

            // 刪除 archived
            const archivedSnap = await boardRef.collection('archived').get();
            const batch2 = db.batch();
            archivedSnap.forEach(doc => batch2.delete(doc.ref));
            await batch2.commit();

            // 刪除 meta
            const metaSnap = await boardRef.collection('meta').get();
            const batch3 = db.batch();
            metaSnap.forEach(doc => batch3.delete(doc.ref));
            await batch3.commit();

            // 最後刪除白板文件本身
            await boardRef.delete();

            // 如果刪除的是當前白板，切回預設
            if (activeBoardId === boardId) {
                setActive(DEFAULT_BOARD_ID);
            }

            console.log('[BoardModel] 白板已刪除:', boardId);
            PostIt.Board.showToast('白板已刪除');
        } catch (error) {
            console.error('[BoardModel] 刪除白板失敗:', error);
            PostIt.Board.showToast('刪除失敗', 'error');
        }
    }

    // -------- 切換白板 --------
    function setActive(boardId) {
        if (!boardsCache[boardId]) return;
        activeBoardId = boardId;
        localStorage.setItem(STORAGE_KEY, boardId);

        if (onSwitchCallback) {
            onSwitchCallback(boardId);
        }
    }

    // -------- 設定切換回呼 --------
    function onSwitch(callback) {
        onSwitchCallback = callback;
    }

    // -------- Getters --------
    function getActive() { return activeBoardId || DEFAULT_BOARD_ID; }
    function getBoard(id) { return boardsCache[id] || null; }
    function getAll() { return boardsCache; }
    function getCount() { return Object.keys(boardsCache).length; }

    // -------- 取得當前白板的子集合路徑 --------
    function getActiveNotesRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || DEFAULT_BOARD_ID;
        return db.collection('users').doc(uid).collection('boards').doc(bid).collection('notes');
    }

    function getActiveArchivedRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || DEFAULT_BOARD_ID;
        return db.collection('users').doc(uid).collection('boards').doc(bid).collection('archived');
    }

    function getActiveMetaRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || DEFAULT_BOARD_ID;
        return db.collection('users').doc(uid).collection('boards').doc(bid).collection('meta');
    }

    return {
        ensureDefault, subscribe, cleanup,
        create, update, remove,
        setActive, onSwitch,
        getActive, getBoard, getAll, getCount,
        getActiveNotesRef, getActiveArchivedRef, getActiveMetaRef,
        DEFAULT_BOARD_ID
    };
})();
