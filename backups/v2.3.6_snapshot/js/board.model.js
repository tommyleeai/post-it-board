// ============================================
// 白板 CRUD 模組 (Board Model) v3 - 跨帳號協作版
// ============================================
PostIt.BoardModel = (function () {
    'use strict';

    const MAX_BOARDS = 10;
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

    function getDefaultBoardId() {
        const uid = PostIt.Auth.getUid();
        return uid ? `default_${uid}` : 'default';
    }

    // -------- 取得 boards collection ref --------
    function getBoardsRef() {
        const db = PostIt.Firebase.getDb();
        return db.collection('boards');
    }

    // -------- 確保預設白板存在 + 自動遷移舊資料 --------
    async function ensureDefault() {
        const ref = getBoardsRef();
        if (!ref) return;

        const uid = PostIt.Auth.getUid();
        const defaultBoardId = getDefaultBoardId();
        const defaultBoardRef = ref.doc(defaultBoardId);

        let docExists = false;
        try {
            const doc = await defaultBoardRef.get();
            docExists = doc.exists;
        } catch (e) {
            // Firestore rules will throw 'permission denied' if the document doesn't exist 
            // because `resource.data.members` evaluates to an error when resource is null.
            // We can safely assume it doesn't exist and attempt to create it.
            console.warn('[BoardModel] 無法讀取預設白板 (可能是尚未建立被規則阻擋):', e.message);
        }

        if (!docExists) {
            try {
                await defaultBoardRef.set({
                    ...DEFAULT_BOARD,
                    ownerId: uid,
                    members: [uid], // 加入自己到成員列表以利查詢
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log('[BoardModel] 已建立預設白板');
            } catch (createErr) {
                console.error('[BoardModel] 建立預設白板失敗:', createErr);
                // 如果連建立都失敗，就拋出例外
                throw createErr;
            }
        }

        // ====== 自動遷移所有的舊資料 ======
        const db = PostIt.Firebase.getDb();
        const userRef = db.collection('users').doc(uid);
        
        // 1. 遷移 V2 的所有的舊白板 (users/{uid}/boards/{boardId})
        const oldBoardsSnap = await userRef.collection('boards').get();
        if (!oldBoardsSnap.empty) {
            for (const oldBoardDoc of oldBoardsSnap.docs) {
                const oldBoardId = oldBoardDoc.id;
                const newBoardId = (oldBoardId === 'default') ? defaultBoardId : `${uid}_${oldBoardId}`;
                const newBoardRef = ref.doc(newBoardId);
                
                // 檢查是否已遷移過：看白板主文件是否存在，如果存在再看 notes 是否為空
                let newBoardExists = false;
                try {
                    const newBoardSnap = await newBoardRef.get();
                    newBoardExists = newBoardSnap.exists;
                } catch (e) {
                    // 如果文件不存在，Firestore Rules 可能會拋出權限錯誤
                }
                
                let isMigrated = false;
                if (newBoardExists) {
                    // 如果白板已經存在 (例如剛剛建立的預設白板)，需要檢查裡面有沒有貼紙
                    const notesSnap = await newBoardRef.collection('notes').limit(1).get();
                    isMigrated = !notesSnap.empty;
                }
                
                if (!isMigrated) {
                    // 檢查舊的是否真的有資料
                    const oldNotesSnap = await userRef.collection('boards').doc(oldBoardId).collection('notes').limit(1).get();
                    if (!oldNotesSnap.empty) {
                        console.log(`[BoardModel] 偵測到 v2.1 舊白板 ${oldBoardId}，開始遷移...`);
                        const oldData = oldBoardDoc.data();
                        await newBoardRef.set({
                            ...DEFAULT_BOARD,
                            ...oldData,
                            ownerId: uid,
                            members: [uid]
                        }, { merge: true });
                        
                        await migrateOldData(userRef.collection('boards').doc(oldBoardId), newBoardRef);
                    }
                }
            }
        }
        
        // 2. 檢查 V1 殘留的 postit_notes (如果預設白板是空的)
        const newDefaultNotesSnap = await defaultBoardRef.collection('notes').limit(1).get();
        if (newDefaultNotesSnap.empty) {
            const v1OldNotesSnap = await userRef.collection('postit_notes').limit(1).get();
            if (!v1OldNotesSnap.empty) {
                console.log('[BoardModel] 偵測到 v1 舊資料，開始遷移至共用區...');
                await migrateV1Data(userRef, defaultBoardRef);
            }
        }

        // 提前從 localStorage 恢復 activeBoardId，避免 Note.subscribe() 的時序競爭
        if (!activeBoardId) {
            const saved = localStorage.getItem(STORAGE_KEY);
            activeBoardId = saved || defaultBoardId;
        }
    }

    // -------- 從舊路徑遷移資料到 boards/{bid} --------
    async function migrateOldData(oldBoardRef, newBoardRef) {
        const db = PostIt.Firebase.getDb();
        try {
            // 1. 遷移 notes
            const oldNotes = await oldBoardRef.collection('notes').get();
            if (!oldNotes.empty) {
                console.log(`[BoardModel] 偵測到 ${oldNotes.size} 筆舊便利貼，開始遷移...`);
                const chunks = chunkArray(oldNotes.docs, 400);
                for (const chunk of chunks) {
                    const batch = db.batch();
                    chunk.forEach(doc => {
                        const newRef = newBoardRef.collection('notes').doc(doc.id);
                        batch.set(newRef, doc.data());
                    });
                    await batch.commit();
                }
            }

            // 2. 遷移 archived
            const oldArchived = await oldBoardRef.collection('archived').get();
            if (!oldArchived.empty) {
                const chunks = chunkArray(oldArchived.docs, 400);
                for (const chunk of chunks) {
                    const batch = db.batch();
                    chunk.forEach(doc => {
                        const newRef = newBoardRef.collection('archived').doc(doc.id);
                        batch.set(newRef, doc.data());
                    });
                    await batch.commit();
                }
            }

            // 3. 遷移 meta/connections
            const oldConn = await oldBoardRef.collection('meta').doc('connections').get();
            if (oldConn.exists) {
                await newBoardRef.collection('meta').doc('connections').set(oldConn.data());
            }

            if (!oldNotes.empty || !oldArchived.empty || oldConn.exists) {
                PostIt.Board.showToast('v2 資料遷移完成！支援跨帳號協作 🎉', 'success');
            }
        } catch (error) {
            console.error('[BoardModel] 遷移失敗:', error);
            PostIt.Board.showToast('資料遷移時發生錯誤', 'error');
        }
    }

    // -------- 從 v1 舊路徑遷移資料 --------
    async function migrateV1Data(userRef, newBoardRef) {
        const db = PostIt.Firebase.getDb();
        try {
            // 1. 遷移 postit_notes → boards/default/notes
            const oldNotes = await userRef.collection('postit_notes').get();
            if (!oldNotes.empty) {
                const chunks = chunkArray(oldNotes.docs, 400);
                for (const chunk of chunks) {
                    const batch = db.batch();
                    chunk.forEach(doc => {
                        const newRef = newBoardRef.collection('notes').doc(doc.id);
                        batch.set(newRef, doc.data());
                    });
                    await batch.commit();
                }
            }

            // 2. 遷移 postit_archived → boards/default/archived
            const oldArchived = await userRef.collection('postit_archived').get();
            if (!oldArchived.empty) {
                const chunks = chunkArray(oldArchived.docs, 400);
                for (const chunk of chunks) {
                    const batch = db.batch();
                    chunk.forEach(doc => {
                        const newRef = newBoardRef.collection('archived').doc(doc.id);
                        batch.set(newRef, doc.data());
                    });
                    await batch.commit();
                }
            }

            // 3. 遷移 postit_meta/connections → boards/default/meta/connections
            const oldConn = await userRef.collection('postit_meta').doc('connections').get();
            if (oldConn.exists) {
                await newBoardRef.collection('meta').doc('connections').set(oldConn.data());
            }
            if (!oldNotes.empty || !oldArchived.empty || oldConn.exists) {
                PostIt.Board.showToast('v1 資料遷移完成！支援跨帳號協作 🎉', 'success');
            }
        } catch (error) {
            console.error('[BoardModel] v1 遷移失敗:', error);
            PostIt.Board.showToast('資料遷移時發生錯誤', 'error');
        }
    }

    // -------- 工具：陣列分批 --------
    function chunkArray(arr, size) {
        const result = [];
        for (let i = 0; i < arr.length; i += size) {
            result.push(arr.slice(i, i + size));
        }
        return result;
    }

    // -------- 訂閱白板清單即時更新 --------
    function subscribe(onUpdate) {
        cleanup();
        const ref = getBoardsRef();
        const uid = PostIt.Auth.getUid();
        if (!ref || !uid) return;

        // 查詢自己有參與的白板 (利用 members array-contains)
        unsubscribe = ref.where('members', 'array-contains', uid)
            .onSnapshot((snapshot) => {
            let tempBoards = [];
            snapshot.forEach((doc) => {
                tempBoards.push({ id: doc.id, ...doc.data() });
            });
            // 手動排序 (因為 array-contains 搭配 orderBy 需要複合索引)
            tempBoards.sort((a, b) => (a.order || 0) - (b.order || 0));

            boardsCache = {};
            tempBoards.forEach(board => {
                boardsCache[board.id] = board;
            });

            // 若尚未設定 activeBoardId，從 localStorage 讀取或預設
            if (!activeBoardId) {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved && boardsCache[saved]) {
                    activeBoardId = saved;
                } else {
                    activeBoardId = getDefaultBoardId();
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
        // 注意：不清除 activeBoardId，避免覆蓋 ensureDefault() 已恢復的值
    }

    // -------- 建立新白板 --------
    async function create(name, icon = '📋', color = '#4A90D9') {
        const count = Object.keys(boardsCache).length;
        if (count >= MAX_BOARDS) {
            PostIt.Board.showToast(`已達 ${MAX_BOARDS} 塊白板上限！`, 'error');
            return null;
        }

        const ref = getBoardsRef();
        const uid = PostIt.Auth.getUid();
        if (!ref || !uid) return null;

        const boardData = {
            name: name,
            icon: icon,
            color: color,
            order: count, // 排在最後
            ownerId: uid,
            members: [uid],
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

    // -------- 加入共用白板 --------
    async function joinBoard(boardId) {
        const ref = getBoardsRef();
        const uid = PostIt.Auth.getUid();
        if (!ref || !uid || !boardId) return false;

        try {
            const doc = await ref.doc(boardId).get();
            if (!doc.exists) {
                PostIt.Board.showToast('找不到該白板', 'error');
                return false;
            }

            // 使用 arrayUnion 避免重複加入
            await ref.doc(boardId).update({
                members: firebase.firestore.FieldValue.arrayUnion(uid)
            });

            // 切換過去
            setActive(boardId);
            PostIt.Board.showToast('已成功加入共用白板 🎉', 'success');
            return true;
        } catch (error) {
            console.error('[BoardModel] 加入白板失敗:', error);
            PostIt.Board.showToast('加入失敗', 'error');
            return false;
        }
    }

    // -------- 刪除白板（含所有子資料） --------
    async function remove(boardId) {
        if (boardId === getDefaultBoardId()) {
            PostIt.Board.showToast('無法刪除預設白板', 'error');
            return;
        }

        const ref = getBoardsRef();
        const uid = PostIt.Auth.getUid();
        if (!ref || !uid) return;

        const boardData = boardsCache[boardId];
        if (boardData && boardData.ownerId !== uid) {
            PostIt.Board.showToast('只有擁有者可以刪除此白板', 'error');
            return;
        }

        try {
            // 先刪除子集合的所有文件
            const db = PostIt.Firebase.getDb();
            const boardRef = db.collection('boards').doc(boardId);

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
                setActive(getDefaultBoardId());
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
    function getActive() { return activeBoardId || getDefaultBoardId(); }
    function getBoard(id) { return boardsCache[id] || null; }
    function getAll() { return boardsCache; }
    function getCount() { return Object.keys(boardsCache).length; }

    // -------- 取得當前白板的子集合路徑 --------
    function getActiveNotesRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || getDefaultBoardId();
        return db.collection('boards').doc(bid).collection('notes');
    }

    function getActiveArchivedRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || getDefaultBoardId();
        return db.collection('boards').doc(bid).collection('archived');
    }

    function getActiveMetaRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        const bid = activeBoardId || getDefaultBoardId();
        return db.collection('boards').doc(bid).collection('meta');
    }

    return {
        ensureDefault, subscribe, cleanup,
        create, update, remove, joinBoard,
        setActive, onSwitch,
        getActive, getBoard, getAll, getCount,
        getActiveNotesRef, getActiveArchivedRef, getActiveMetaRef,
        getDefaultBoardId
    };
})();
