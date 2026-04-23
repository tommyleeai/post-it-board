// ============================================
// Yjs 同步模組 (Yjs Sync Engine) - Phase 2 CRDT
// ============================================
window.PostIt = window.PostIt || {};

PostIt.YjsSync = (function () {
    'use strict';

    let Y = null;
    let WebrtcProvider = null;
    let IndexeddbPersistence = null;

    let currentDoc = null;
    let currentProvider = null;
    let currentPersistence = null;
    let yNotesMap = null;
    let onNotesUpdatedCallback = null;
    let backupTimeout = null;

    async function loadModules() {
        if (Y) return;
        try {
            console.log('[Yjs] 正在從 CDN 載入 Yjs 模組...');
            const yjsMod = await import('https://cdn.jsdelivr.net/npm/yjs@13.6.14/+esm');
            Y = yjsMod;
            const webrtcMod = await import('https://cdn.jsdelivr.net/npm/y-webrtc@10.3.0/+esm');
            WebrtcProvider = webrtcMod.WebrtcProvider;
            const idbMod = await import('https://cdn.jsdelivr.net/npm/y-indexeddb@9.0.12/+esm');
            IndexeddbPersistence = idbMod.IndexeddbPersistence;
            console.log('[Yjs] 模組載入完成');
        } catch (e) {
            console.error('[Yjs] 載入模組失敗:', e);
            if (window.PostIt && PostIt.Board && PostIt.Board.showToast) {
                PostIt.Board.showToast('無法載入多人同步模組，請檢查網路連線', 'error');
            }
        }
    }

    async function init(boardId, onUpdate) {
        await loadModules();
        if (!Y) return false;

        cleanup();
        onNotesUpdatedCallback = onUpdate;

        currentDoc = new Y.Doc();
        yNotesMap = currentDoc.getMap('notes');

        // IndexedDB 本地快取
        currentPersistence = new IndexeddbPersistence(`postit_board_${boardId}`, currentDoc);
        
        // P2P WebRTC 房間
        const roomName = `postit-room-v3-${boardId}`;
        currentProvider = new WebrtcProvider(roomName, currentDoc, {
            // 使用預設的公共信號伺服器
            signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com']
        });

        // 監聽連線狀態
        currentProvider.on('synced', synced => {
            console.log(`[Yjs] WebRTC 同步狀態: ${synced.synced ? '已同步' : '連線中'}`);
        });

        // 本地 DB 載入完成後，拉取雲端備份合併
        currentPersistence.whenSynced.then(async () => {
            console.log('[Yjs] IndexedDB 同步完成');
            await restoreFromCloud(boardId);
            
            // 手動觸發一次 UI 更新 (確保載入後畫面刷新)
            triggerUpdate();
        });

        // 每當資料改變，延遲寫入 Firestore 備份
        currentDoc.on('update', () => {
            clearTimeout(backupTimeout);
            backupTimeout = setTimeout(() => backupToCloud(boardId), 5000);
        });

        // 監聽 Y.Map 變更以更新 UI
        yNotesMap.observeDeep(() => {
            triggerUpdate();
        });
        
        return true;
    }

    function triggerUpdate() {
        if (!onNotesUpdatedCallback || !yNotesMap) return;
        const notesObj = {};
        for (let [id, yNote] of yNotesMap.entries()) {
            if (yNote && typeof yNote.toJSON === 'function') {
                notesObj[id] = { id: id, ...yNote.toJSON() };
            }
        }
        onNotesUpdatedCallback(notesObj);
    }

    async function restoreFromCloud(boardId) {
        try {
            const db = PostIt.Firebase.getDb();
            const docSnap = await db.collection('boards').doc(boardId).get();
            if (docSnap.exists) {
                const data = docSnap.data();
                if (data.yjs_state) {
                    const bytes = data.yjs_state.toUint8Array();
                    Y.applyUpdate(currentDoc, bytes);
                    console.log('[Yjs] 從雲端合併備份成功');
                }
            }
        } catch(e) { console.error('[Yjs] Cloud restore failed', e); }
    }

    async function backupToCloud(boardId) {
        if (!currentDoc) return;
        try {
            const stateVector = Y.encodeStateAsUpdate(currentDoc);
            const blob = firebase.firestore.Blob.fromUint8Array(stateVector);
            const db = PostIt.Firebase.getDb();
            await db.collection('boards').doc(boardId).update({
                yjs_state: blob,
                yjs_updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Yjs] 已備份至雲端');
        } catch(e) { console.error('[Yjs] Cloud backup failed', e); }
    }

    function cleanup() {
        if (currentProvider) currentProvider.destroy();
        if (currentDoc) currentDoc.destroy();
        currentDoc = null;
        currentProvider = null;
        currentPersistence = null;
        yNotesMap = null;
        clearTimeout(backupTimeout);
    }

    function getNotesMap() { return yNotesMap; }
    function getY() { return Y; }

    return { init, cleanup, getNotesMap, getY };
})();
