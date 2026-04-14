
// ============================================
// 終端機狀態判定引擎 (Device Mode Engine)
// ============================================
// 避免因跨裝置查看導致坐標覆寫破壞排版
window.PostIt = window.PostIt || {};
PostIt.getDeviceMode = function() {
    // 嚴格判定流派：直接比對機身 Agent (User-Agent)
    const ua = navigator.userAgent.toLowerCase();
    
    // 判定是否為平板 (iPad 或 包含 tablet 字眼，或只包含 android 但不包含 mobile)
    const isTablet = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
    if (isTablet) return 'tablet';
    
    // 判定是否為手機
    const isMobile = /mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua);
    if (isMobile) return 'mobile';
    
    // 預設為電腦
    return 'desktop';
};

// ============================================
// 貼紙 CRUD + 內容偵測 + 圖片上傳
// ============================================

PostIt.Note = (function () {
    'use strict';

    const MAX_NOTES = 50;
    const COLORS = ['#FFF176', '#F48FB1', '#A5D6A7', '#90CAF9', '#FFCC80', '#CE93D8'];
    const URL_REGEX = /^(https?:\/\/[^\s]+)$/i;

    let notesCache = {}; // { noteId: noteData }
    let activeNoteId = null; // 目前選中的貼紙 ID
    let unsubscribe = null; // Firestore listener

    // -------- 獲取使用者的 notes collection ref --------
    function getNotesRef() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        const db = PostIt.Firebase.getDb();
        return db.collection('users').doc(uid).collection('postit_notes');
    }

    // -------- 訂閱 Firestore 即時更新 --------
    function subscribe(onUpdate) {
        cleanup();
        const ref = getNotesRef();
        if (!ref) return;

        unsubscribe = ref.orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                const id = change.doc.id;

                if (change.type === 'added' || change.type === 'modified') {
                    notesCache[id] = { id, ...data };
                } else if (change.type === 'removed') {
                    delete notesCache[id];
                }
            });
            if (onUpdate) onUpdate(notesCache);
        }, (error) => {
            console.error('[Note] Firestore 訂閱錯誤:', error);
        });
    }

    function cleanup() {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }
        notesCache = {};
        activeNoteId = null;
    }

    // -------- 新增貼紙 --------
    async function create(content = '', type = 'text', color = null, role = 'user') {
        const count = Object.keys(notesCache).length;
        if (count >= MAX_NOTES) {
            PostIt.Board.showToast('已達 50 張貼紙上限！', 'error');
            return null;
        }

        const ref = getNotesRef();
        if (!ref) return null;

        // 使用帳號預設顏色，若無設定或設定為隨機則取隨機色
        if (!color) {
            const acctSettings = PostIt.Settings.getAccountSettings();
            if (acctSettings.defaultNoteColor && acctSettings.defaultNoteColor !== 'random') {
                color = acctSettings.defaultNoteColor;
            } else {
                color = COLORS[Math.floor(Math.random() * COLORS.length)];
            }
        }

        // 當角色是 AI 時，可以給予一個統一特殊底色避免太花俏，或是維持原本色彩也行。
        if (role === 'ai') {
            color = null; // AI 便利貼的顏色由 CSS class 單獨處理，不需要 inline color 覆寫
        }

        // 隨機位置（白板中央附近）
        const x = 20 + Math.random() * 40; // 20% ~ 60%
        const y = 15 + Math.random() * 40; // 15% ~ 55%

        // 隨機旋轉
        const rotation = (Math.random() - 0.5) * 6; // -3° ~ +3°

        const noteData = {
            type: type,
            role: role,
            content: content,
            color: color,
            x: x,
            y: y,
            width: null,  // 自動
            height: null, // 自動
            rotation: rotation,
            zIndex: PostIt.Drag.getMaxZIndex() + 1,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            const docRef = await ref.add(noteData);
            PostIt.Drag.setMaxZIndex(noteData.zIndex);
            return docRef.id;
        } catch (error) {
            console.error('[Note] 建立失敗:', error);
            PostIt.Board.showToast('新增失敗，請再試一次', 'error');
            return null;
        }
    }

    // -------- 更新貼紙內容 --------
    async function updateContent(noteId, content) {
        const ref = getNotesRef();
        if (!ref || !noteId) return;

        // 自動偵測類型
        const type = detectType(content);

        try {
            await ref.doc(noteId).update({
                content: content,
                type: type,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('[Note] 更新內容失敗:', error);
        }
    }

    // -------- 更新位置 --------
    async function updatePosition(noteId, x, y, zIndex) {
        const ref = getNotesRef();
        if (!ref || !noteId) return;
        
        const mode = PostIt.getDeviceMode();

        try {
            // 動態寫入對應裝置的 Layout 子節點
            const updateData = {};
            updateData['layouts.' + mode + '.x'] = x;
            updateData['layouts.' + mode + '.y'] = y;
            updateData['layouts.' + mode + '.zIndex'] = zIndex;
            updateData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            
            await ref.doc(noteId).update(updateData);
        } catch (error) {
            console.error('[Note] 更新 ' + mode + ' 位置失敗:', error);
        }
    }

    // -------- 更新顏色 --------
    async function updateColor(noteId, color) {
        const ref = getNotesRef();
        if (!ref || !noteId) return;

        try {
            await ref.doc(noteId).update({
                color: color,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (error) {
            console.error('[Note] 更新顏色失敗:', error);
        }
    }

    // -------- 更新字型樣式（單卡覆蓋） --------
    async function updateStyle(noteId, styleObj) {
        const ref = getNotesRef();
        if (!ref || !noteId) return;

        const updateData = {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // 只更新有傳入的欄位（null 代表清除單卡設定，回歸帳號預設）
        if ('fontFamily' in styleObj) updateData.fontFamily = styleObj.fontFamily || null;
        if ('fontSize' in styleObj) updateData.fontSize = styleObj.fontSize || null;
        if ('fontColor' in styleObj) updateData.fontColor = styleObj.fontColor || null;
        // 彩色流光開關
        if ('rainbow' in styleObj) updateData.rainbow = !!styleObj.rainbow;

        try {
            await ref.doc(noteId).update(updateData);
        } catch (error) {
            console.error('[Note] 更新樣式失敗:', error);
        }
    }

    // -------- 蓋章歸檔貼紙 --------
    async function archive(noteId) {
        const uid = PostIt.Auth.getUid();
        if (!uid || !noteId) return;

        const note = notesCache[noteId];
        if (!note) return;

        try {
            const db = PostIt.Firebase.getDb();
            const archiveRef = db.collection('users').doc(uid).collection('postit_archived');

            // 複製到歸檔集合
            const archiveData = { ...note };
            delete archiveData.id; // 移除本地 id 欄位
            archiveData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            archiveData.archivedFrom = noteId;

            const docRef = await archiveRef.add(archiveData);

            // 從原集合刪除
            const ref = getNotesRef();
            await ref.doc(noteId).delete();

            console.log('[Note] 貼紙已歸檔:', docRef.id);
            return docRef.id;
        } catch (error) {
            console.error('[Note] 歸檔失敗:', error);
            PostIt.Board.showToast('歸檔失敗，請再試一次', 'error');
            return null;
        }
    }

    // -------- 復原歸檔貼紙 --------
    async function unarchive(archiveId) {
        const uid = PostIt.Auth.getUid();
        if (!uid || !archiveId) return;

        try {
            const db = PostIt.Firebase.getDb();
            const archiveRef = db.collection('users').doc(uid).collection('postit_archived').doc(archiveId);
            
            const doc = await archiveRef.get();
            if (!doc.exists) return;
            
            const data = doc.data();
            const originalId = data.archivedFrom;
            
            // 移轉回原本的 collection
            delete data.completedAt;
            delete data.archivedFrom;
            
            const ref = getNotesRef();
            if (originalId) {
                await ref.doc(originalId).set(data);
            } else {
                await ref.add(data);
            }
            
            // 從歸檔集合刪除
            await archiveRef.delete();
            console.log('[Note] 貼紙已復原');
        } catch (error) {
            console.error('[Note] 復原失敗:', error);
            PostIt.Board.showToast('復原失敗', 'error');
        }
    }

    // -------- 永久刪除歸檔紀錄 --------
    async function deleteArchive(archiveId) {
        const uid = PostIt.Auth.getUid();
        if (!uid || !archiveId) return;

        try {
            const db = PostIt.Firebase.getDb();
            const archiveRef = db.collection('users').doc(uid).collection('postit_archived').doc(archiveId);
            
            await archiveRef.delete();
            console.log('[Note] 歸檔紀錄已永久刪除');
        } catch (error) {
            console.error('[Note] 永久刪除失敗:', error);
            PostIt.Board.showToast('刪除失敗', 'error');
        }
    }

    // -------- 取得所有歷史歸檔 --------
    async function getArchivedNotes() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return [];

        try {
            const db = PostIt.Firebase.getDb();
            const archiveQuery = db.collection('users')
                .doc(uid)
                .collection('postit_archived')
                .orderBy('completedAt', 'desc');
            
            const snapshot = await archiveQuery.get();
            const results = [];
            snapshot.forEach(doc => {
                results.push({
                    archiveId: doc.id,
                    ...doc.data()
                });
            });
            return results;
        } catch (error) {
            console.error('[Note] 取得歷史歸檔失敗:', error);
            PostIt.Board.showToast('無法取得歷史歸檔', 'error');
            return [];
        }
    }

    // -------- 刪除貼紙 --------
    async function remove(noteId) {
        const ref = getNotesRef();
        if (!ref || !noteId) return;

        // 如果有圖片，也要刪除 Storage
        const note = notesCache[noteId];
        if (note && note.type === 'image' && note.storagePath) {
            try {
                const storageRef = PostIt.Firebase.getStorage().ref(note.storagePath);
                await storageRef.delete();
            } catch (err) {
                console.warn('[Note] 刪除 Storage 圖片失敗（可能已不存在）:', err);
            }
        }

        try {
            await ref.doc(noteId).delete();
            PostIt.Board.showToast('貼紙已刪除');
        } catch (error) {
            console.error('[Note] 刪除失敗:', error);
            PostIt.Board.showToast('刪除失敗', 'error');
        }
    }

    // -------- 上傳圖片 --------
    async function uploadImage(noteId, file) {
        if (!file || !noteId) {
            PostIt.Board.showToast('上傳參數錯誤', 'error');
            return null;
        }

        const uid = PostIt.Auth.getUid();
        if (!uid) {
            PostIt.Board.showToast('尚未登入', 'error');
            return null;
        }

        // 檢查檔案大小（最大 5MB）
        if (file.size > 5 * 1024 * 1024) {
            PostIt.Board.showToast('圖片太大了，最多 5MB', 'error');
            return null;
        }

        // 從剪貼簿貼上時，file.name 可能是 "image.png"，確保副檔名正確
        let ext = 'png';
        if (file.name && file.name.includes('.')) {
            ext = file.name.split('.').pop();
        } else if (file.type) {
            // 從 MIME type 取得副檔名 e.g. "image/png" → "png"
            ext = file.type.split('/').pop() || 'png';
        }

        const timestamp = Date.now();
        const storagePath = `users/${uid}/postit/${noteId}_${timestamp}.${ext}`;
        const storageRef = PostIt.Firebase.getStorage().ref(storagePath);

        try {
            PostIt.Board.showToast('上傳中...⏳');
            const snapshot = await storageRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();

            // 更新貼紙
            const ref = getNotesRef();
            await ref.doc(noteId).update({
                type: 'image',
                content: downloadURL,
                storagePath: storagePath,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            PostIt.Board.showToast('圖片上傳成功！✅', 'success');
            return downloadURL;
        } catch (error) {
            console.error('[Note] 上傳圖片失敗:', error);
            // 顯示具體錯誤原因
            const msg = error.code === 'storage/unauthorized'
                ? '上傳被拒：請到 Firebase Console 設定 Storage 安全規則'
                : `上傳失敗：${error.message || error.code || '未知錯誤'}`;
            PostIt.Board.showToast(msg, 'error');
            return null;
        }
    }

    // -------- 內容類型偵測 --------
    function detectType(content) {
        if (!content || content.trim() === '') return 'text';
        const trimmed = content.trim();
        if (URL_REGEX.test(trimmed)) return 'url';
        return 'text';
    }

    // -------- AI 鬧鐘邏輯更新 --------
    function updateReminderLogic(noteId, aiResult) {
        const ref = getNotesRef();
        if (!ref) return;
        
        if (!aiResult) {
            ref.doc(noteId).update({
                alertTime: firebase.firestore.FieldValue.delete(),
                reminderStatus: firebase.firestore.FieldValue.delete(),
                aiReason: firebase.firestore.FieldValue.delete(),
                needsClarification: firebase.firestore.FieldValue.delete(),
                clarificationQuestion: firebase.firestore.FieldValue.delete(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.error(e));
            return;
        }

        ref.doc(noteId).update({
            alertTime: aiResult.alertTime || null,
            reminderStatus: aiResult.alertTime ? 'pending' : null,
            aiReason: aiResult.reason || null,
            needsClarification: !!aiResult.needsClarification,
            clarificationQuestion: aiResult.clarificationQuestion || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.error(e));
    }

    function updateReminderStatus(noteId, status) {
        const ref = getNotesRef();
        if (!ref) return;
        ref.doc(noteId).update({ 
            reminderStatus: status,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(e => console.error(e));
    }

    // -------- Getters --------
    function getCache() { return notesCache; }
    function getCount() { return Object.keys(notesCache).length; }
    function getNote(id) { return notesCache[id] || null; }
    function getActiveNoteId() { return activeNoteId; }
    function setActiveNoteId(id) { activeNoteId = id; }

    return {
        subscribe, cleanup, create, updateContent, updatePosition,
        updateColor, updateStyle, archive, unarchive, deleteArchive, getArchivedNotes, remove, uploadImage, detectType,
        updateReminderLogic, updateReminderStatus,
        getCache, getCount, getNote, getActiveNoteId, setActiveNoteId
    };
})();
