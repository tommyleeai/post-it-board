// ============================================
// Yjs 同步模組 (Yjs Sync Engine) - Phase 2 CRDT
// ============================================
window.PostIt = window.PostIt || {};

PostIt.YjsSync = (function () {
    'use strict';

    let Y = null;
    let IndexeddbPersistence = null;

    let currentDoc = null;
    let currentPersistence = null;
    let yNotesMap = null;
    let onNotesUpdatedCallback = null;
    let backupTimeout = null;

    async function loadModules() {
        if (Y) return;
        try {
            console.log('[Yjs] 正在從 CDN 載入 Yjs 模組...');
            const yjsMod = await import('https://esm.sh/yjs@13.6.14');
            Y = yjsMod;
            const idbMod = await import('https://esm.sh/y-indexeddb@9.0.12');
            IndexeddbPersistence = idbMod.IndexeddbPersistence;
            console.log('[Yjs] 模組載入完成');
        } catch (e) {
            console.error('[Yjs] 載入模組失敗:', e);
            if (window.PostIt && PostIt.Board && PostIt.Board.showToast) {
                PostIt.Board.showToast('無法載入多人同步模組，請檢查網路連線', 'error');
            }
        }
    }

    async function init(boardId, onUpdate, onAwarenessUpdate) {
        await loadModules();
        if (!Y) return false;
        if (window.updateLoader) window.updateLoader(80, '載入本地快取...');

        cleanup();
        onNotesUpdatedCallback = onUpdate;

        currentDoc = new Y.Doc();
        yNotesMap = currentDoc.getMap('notes');

        // IndexedDB 本地快取
        currentPersistence = new IndexeddbPersistence(`postit_board_${boardId}`, currentDoc);


        // 本地 DB 載入完成後，設定 Firestore 即時同步並取得是否需遷移
        currentPersistence.whenSynced.then(async () => {
            console.log('[Yjs] IndexedDB 同步完成');
            if (window.updateLoader) window.updateLoader(90, '與雲端進行同步...');
            const hasCloudYjs = await setupCloudSync(boardId);
            
            // 如果從未備份到雲端，執行自動遷移
            await migrateOldNotesToYjs(boardId, hasCloudYjs);

            // 手動觸發一次 UI 更新 (確保載入後畫面刷新)
            triggerUpdate();
        });

        // 每當資料改變，延遲寫入 Firestore 備份
        currentDoc.on('update', () => {
            clearTimeout(backupTimeout);
            backupTimeout = setTimeout(() => backupToCloud(boardId), 800);
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

    function setupCloudSync(boardId) {
        const db = PostIt.Firebase.getDb();
        
        // 建立即時監聽，取代原本的單次拉取
        // 當 WebRTC 斷線時，透過 Firestore 確保多個分頁/裝置依然能保持同步
        db.collection('boards').doc(boardId).onSnapshot(docSnap => {
            if (docSnap.exists) {
                const data = docSnap.data();
                if (data.yjs_state) {
                    try {
                        const bytes = data.yjs_state.toUint8Array();
                        // 合併雲端的更新到本地
                        Y.applyUpdate(currentDoc, bytes);
                    } catch(e) {
                        console.error('[Yjs] Cloud sync apply failed', e);
                    }
                }
            }
        });
        
        // 初始拉取，用於判斷是否需要執行 v2 到 v3 遷移
        return db.collection('boards').doc(boardId).get().then(docSnap => {
            if (docSnap.exists && docSnap.data().v3_migrated) {
                return true;
            }
            return false;
        });
    }

    async function migrateOldNotesToYjs(boardId, isMigrated) {
        try {
            const db = PostIt.Firebase.getDb();
            const uid = PostIt.Auth.getUid();
            if (!db || !uid || !yNotesMap) return;

            const docSnap = await db.collection('boards').doc(boardId).get();
            if (docSnap.exists && docSnap.data().v3_deep_migrated_v8) {
                return; // Already deep migrated
            }

            console.log('[Yjs] 開始執行乾淨資料重置 (清除舊版幽靈並還原正確座標)...');
            let count = 0;

            async function processSnapshot(snapshot) {
                if (snapshot.empty) return;
                snapshot.forEach(doc => {
                    const id = doc.id;
                    const data = doc.data();
                    
                    // 只有當 Yjs 裡面沒有這張便利貼時才寫入，保護已存在的資料
                    if (yNotesMap.has(id)) return;

                    const yNote = new Y.Map();
                    for (let [k, v] of Object.entries(data)) {
                        // 處理舊版資料相容性
                        if (k === 'text' && !data.content) {
                            yNote.set('content', v);
                        }
                        
                        // Normalize legacy absolute coordinates (px) to percentages (0-100)
                        if (k === 'x' || k === 'y') {
                            if (typeof v === 'string' && v.includes('px')) {
                                v = parseFloat(v);
                            }
                            if (typeof v === 'number' && Math.abs(v) > 150) {
                                v = (k === 'x') ? (v / 1920) * 100 : (k === 'y') ? (v / 1080) * 100 : v;
                                v = Math.max(0, Math.min(v, 95)); // clamp to screen
                            }
                        }

                        // Fix for Yjs crashing on custom classes like firebase.firestore.Timestamp
                        if (v && typeof v === 'object') {
                            if (typeof v.toDate === 'function') {
                                // Firestore Timestamp
                                yNote.set(k, { seconds: v.seconds, nanoseconds: v.nanoseconds });
                            } else if (v.seconds !== undefined) {
                                // Already plain object
                                yNote.set(k, { seconds: v.seconds, nanoseconds: v.nanoseconds });
                            } else {
                                // Array or plain object
                                try {
                                    yNote.set(k, JSON.parse(JSON.stringify(v)));
                                } catch (e) {
                                    yNote.set(k, v); // Fallback
                                }
                            }
                        } else {
                            yNote.set(k, v);
                        }
                    }
                    if (data.layouts) {
                        const yLayouts = new Y.Map();
                        for (const [mode, layout] of Object.entries(data.layouts)) {
                            const yMode = new Y.Map();
                            for (let [lk, lv] of Object.entries(layout)) {
                                if (lk === 'x' || lk === 'y') {
                                    if (typeof lv === 'string' && lv.includes('px')) {
                                        lv = parseFloat(lv);
                                    }
                                    if (typeof lv === 'number' && Math.abs(lv) > 150) {
                                        lv = (lk === 'x') ? (lv / 1920) * 100 : (lv / 1080) * 100;
                                        lv = Math.max(0, Math.min(lv, 95));
                                    }
                                }
                                yMode.set(lk, lv);
                            }
                            yLayouts.set(mode, yMode);
                        }
                        yNote.set('layouts', yLayouts);
                    }

                    yNotesMap.set(id, yNote);
                    count++;
                });
            }

            // 1. 清除所有格式錯誤的幽靈便利貼 (字串 px、過大座標、缺乏 content)
            const currentKeys = Array.from(yNotesMap.keys());
            for (const key of currentKeys) {
                const n = yNotesMap.get(key);
                const x = n.get('x');
                const y = n.get('y');
                const hasText = n.get('text') !== undefined;
                const hasContent = n.get('content') !== undefined;
                
                // 判斷是否為壞掉的舊資料格式
                const isBrokenX = (typeof x === 'string' && x.includes('px')) || (typeof x === 'number' && Math.abs(x) > 150);
                const isBrokenY = (typeof y === 'string' && y.includes('px')) || (typeof y === 'number' && Math.abs(y) > 150);
                const isMissingContent = hasText && !hasContent;

                if (isBrokenX || isBrokenY || isMissingContent) {
                    yNotesMap.delete(key);
                    console.log(`[Yjs] 已刪除異常便利貼: ${key}`);
                }
            }

            // 2. 僅從 v2 官方資料夾 (boards/{boardId}/notes) 撈取有效便利貼
            const v2Snap = await db.collection('boards').doc(boardId).collection('notes').get();
            await processSnapshot(v2Snap);

            console.log(`[Yjs] 乾淨重置完成，共載入 ${count} 筆有效便利貼`);
            
            // 標記為已深度遷移
            await db.collection('boards').doc(boardId).set({ v3_deep_migrated_v8: true }, { merge: true });
        } catch (e) {
            console.error('[Yjs] 深度遷移失敗:', e);
        }
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
        if (currentDoc) currentDoc.destroy();
        currentDoc = null;
        currentPersistence = null;
        yNotesMap = null;
        clearTimeout(backupTimeout);
    }

    function getNotesMap() { return yNotesMap; }
    function getY() { return Y; }

    return { init, cleanup, getNotesMap, getY };
})();
