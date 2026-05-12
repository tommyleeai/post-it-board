
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

    // -------- 獲取當前白板的 notes collection ref --------
    
    // -------- 訂閱 Yjs 即時更新 --------
    async function subscribe(onUpdate, onAwarenessUpdate) {
        cleanup();
        const boardId = typeof PostIt.BoardModel !== 'undefined' ? PostIt.BoardModel.getActive() : null;
        if (!boardId) return;

        // 初始化 Yjs，取代原本的 Firestore onSnapshot
        await PostIt.YjsSync.init(boardId, (notesMapData) => {
            notesCache = notesMapData;
            if (onUpdate) onUpdate(notesCache);
        }, onAwarenessUpdate);
    }

    function cleanup() {
        if (typeof PostIt.YjsSync !== 'undefined') {
            PostIt.YjsSync.cleanup();
        }
        notesCache = {};
        activeNoteId = null;
    }

    // -------- 新增貼紙 --------
    async function create(content = '', type = 'text', color = null, role = 'user', overridePos = null) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return null;

        const count = Object.keys(notesCache).length;
        if (count >= MAX_NOTES) {
            PostIt.Board.showToast('已達 50 張貼紙上限！', 'error');
            return null;
        }

        if (!color) {
            const acctSettings = PostIt.Settings.getAccountSettings();
            if (acctSettings.defaultNoteColor && acctSettings.defaultNoteColor !== 'random') {
                color = acctSettings.defaultNoteColor;
            } else {
                color = COLORS[Math.floor(Math.random() * COLORS.length)];
            }
        }
        if (role === 'ai') color = null;

        let x = 20 + Math.random() * 40;
        let y = 15 + Math.random() * 40;
        let customZIndex = PostIt.Drag.getMaxZIndex() + 1;

        if (overridePos) {
            if (overridePos.x !== undefined) x = overridePos.x;
            if (overridePos.y !== undefined) y = overridePos.y;
            if (overridePos.zIndex !== undefined) customZIndex = overridePos.zIndex;
        }

        const rotation = (Math.random() - 0.5) * 6;

        const noteId = 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

        const Y = PostIt.YjsSync.getY();
        const yNote = new Y.Map();
        yNote.set('type', type);
        yNote.set('role', role);
        yNote.set('content', content);
        yNote.set('color', color);
        yNote.set('x', x);
        yNote.set('y', y);
        yNote.set('rotation', rotation);
        yNote.set('zIndex', customZIndex);
        yNote.set('createdAt', { seconds: Math.floor(Date.now() / 1000) });
        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });

        yNotesMap.set(noteId, yNote);
        PostIt.Drag.setMaxZIndex(customZIndex);
        return noteId;
    }
    // -------- 更新貼紙內容 --------
    // -------- 更新貼紙內容 --------
    async function updateContent(noteId, content) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;

        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;

        const type = detectType(content);
        yNote.set('content', content);
        yNote.set('type', type);
        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
    }
    // -------- 更新位置 --------
    // -------- 更新位置 --------
    async function updatePosition(noteId, x, y, zIndex) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;

        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;

        const mode = PostIt.getDeviceMode();
        
        let yLayouts = yNote.get('layouts');
        if (!yLayouts || !yLayouts.set) {
            const Y = PostIt.YjsSync.getY();
            yLayouts = new Y.Map();
            yNote.set('layouts', yLayouts);
        }
        
        let yMode = yLayouts.get(mode);
        if (!yMode || !yMode.set) {
            const Y = PostIt.YjsSync.getY();
            yMode = new Y.Map();
            yLayouts.set(mode, yMode);
        }
        yMode.set('x', x);
        yMode.set('y', y);
        yMode.set('zIndex', zIndex);

        // 為了相容也寫入 root
        yNote.set('x', x);
        yNote.set('y', y);
        yNote.set('zIndex', zIndex);
        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
    }
    // -------- 更新顏色 --------
    // -------- 更新顏色 --------
    async function updateColor(noteId, color) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;
        const yNote = yNotesMap.get(noteId);
        if (yNote) {
            yNote.set('color', color);
            yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
        }
    }

    // -------- 更新字型樣式（單卡覆蓋） --------
    async function updateStyle(noteId, styleObj) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;
        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;

        if ('fontFamily' in styleObj) yNote.set('fontFamily', styleObj.fontFamily || null);
        if ('fontSize' in styleObj) yNote.set('fontSize', styleObj.fontSize || null);
        if ('fontColor' in styleObj) yNote.set('fontColor', styleObj.fontColor || null);
        if ('rainbow' in styleObj) yNote.set('rainbow', !!styleObj.rainbow);

        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
    }
    // -------- 蓋章歸檔貼紙 --------
    async function archive(noteId) {
        const uid = PostIt.Auth.getUid();
        if (!uid || !noteId) return;

        const note = notesCache[noteId];
        if (!note) return;

        try {
            const db = PostIt.Firebase.getDb();
            const archiveRef = (typeof PostIt.BoardModel !== 'undefined')
                ? PostIt.BoardModel.getActiveArchivedRef()
                : db.collection('users').doc(uid).collection('postit_archived');

            // 複製到歸檔集合
            const archiveData = { ...note };
            delete archiveData.id; // 移除本地 id 欄位
            archiveData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
            archiveData.archivedFrom = noteId;

            const docRef = await archiveRef.add(archiveData);

            // 從原集合刪除
            const ref = getNotesRef();
            await ref.doc(noteId).delete();

            const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
            if (yNotesMap) {
                yNotesMap.delete(noteId);
            }

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
            const archiveCollection = (typeof PostIt.BoardModel !== 'undefined')
                ? PostIt.BoardModel.getActiveArchivedRef()
                : db.collection('users').doc(uid).collection('postit_archived');
            const archiveRef = archiveCollection.doc(archiveId);
            
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
            
            // 同步寫入 Yjs 以恢復顯示
            const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
            if (yNotesMap) {
                const Y = PostIt.YjsSync.getY();
                const yNote = new Y.Map();
                for (const [k, v] of Object.entries(data)) {
                    yNote.set(k, v);
                }
                const restoreId = originalId || 'note_' + Date.now().toString(36);
                yNotesMap.set(restoreId, yNote);
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
            const archiveCollection = (typeof PostIt.BoardModel !== 'undefined')
                ? PostIt.BoardModel.getActiveArchivedRef()
                : db.collection('users').doc(uid).collection('postit_archived');
            const archiveRef = archiveCollection.doc(archiveId);
            
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
            const archiveCollection = (typeof PostIt.BoardModel !== 'undefined')
                ? PostIt.BoardModel.getActiveArchivedRef()
                : db.collection('users').doc(uid).collection('postit_archived');
            const archiveQuery = archiveCollection.orderBy('completedAt', 'desc');
            
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
    // -------- 刪除貼紙 --------
    async function remove(noteId) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;

        const note = notesCache[noteId];
        if (note && note.type === 'image' && note.storagePath) {
            try {
                const storageRef = PostIt.Firebase.getStorage().ref(note.storagePath);
                await storageRef.delete();
            } catch (err) {
                console.warn('[Note] 刪除 Storage 圖片失敗（可能已不存在）:', err);
            }
        }

        yNotesMap.delete(noteId);
        PostIt.Board.showToast('貼紙已刪除');
    }
    // -------- 上傳圖片 --------
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

        if (file.size > 5 * 1024 * 1024) {
            PostIt.Board.showToast('圖片太大了，最多 5MB', 'error');
            return null;
        }

        let ext = 'png';
        if (file.name && file.name.includes('.')) {
            ext = file.name.split('.').pop();
        } else if (file.type) {
            ext = file.type.split('/').pop() || 'png';
        }

        const timestamp = Date.now();
        const storagePath = `users/${uid}/postit/${noteId}_${timestamp}.${ext}`;
        const storageRef = PostIt.Firebase.getStorage().ref(storagePath);

        try {
            PostIt.Board.showToast('上傳中...⏳');
            const snapshot = await storageRef.put(file);
            const downloadURL = await snapshot.ref.getDownloadURL();

            const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
            if (yNotesMap) {
                const yNote = yNotesMap.get(noteId);
                if (yNote) {
                    yNote.set('imageUrl', downloadURL);
                    yNote.set('storagePath', storagePath);
                    yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
                }
            }

            PostIt.Board.showToast('圖片上傳成功！✅', 'success');
            return downloadURL;
        } catch (error) {
            console.error('[Note] 上傳圖片失敗:', error);
            const msg = error.code === 'storage/unauthorized'
                ? '上傳被拒：請到 Firebase Console 設定 Storage 安全規則'
                : `上傳失敗：${error.message || error.code || '未知錯誤'}`;
            PostIt.Board.showToast(msg, 'error');
            return null;
        }
    }
    // -------- 內容類型偵測 --------
    function detectType(content) {
        if (!content || String(content).trim() === '') return 'text';
        const trimmed = String(content).trim();
        if (URL_REGEX.test(trimmed)) return 'url';
        return 'text';
    }

    // -------- AI 鬧鐘邏輯更新 --------
    
    // -------- AI 鬧鐘邏輯更新 --------
    function updateReminderLogic(noteId, aiResult) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return;
        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;

        if (!aiResult) {
            yNote.set('alertTime', null);
            yNote.set('eventTime', null);
            yNote.set('reminderStatus', null);
            yNote.set('aiReason', null);
            yNote.set('repeatRule', null);
            yNote.set('needsClarification', null);
            yNote.set('clarificationQuestion', null);
            yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
            return;
        }

        yNote.set('alertTime', aiResult.alertTime || null);
        yNote.set('eventTime', aiResult.eventTime || null);
        yNote.set('reminderStatus', aiResult.alertTime ? 'pending' : null);
        yNote.set('aiReason', aiResult.reason || null);
        yNote.set('repeatRule', aiResult.repeatRule || 'none');
        yNote.set('needsClarification', !!aiResult.needsClarification);
        yNote.set('clarificationQuestion', aiResult.clarificationQuestion || null);
        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
    }

    function updateReminderStatus(noteId, status) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return;
        const yNote = yNotesMap.get(noteId);
        if (yNote) {
            yNote.set('reminderStatus', status);
            yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
        }
    }

    // -------- 股價提醒 --------
    function updateStockAlert(noteId, alertData) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return;
        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;

        yNote.set('stockAlert', {
            symbol: alertData.symbol || '',
            targetPrice: alertData.targetPrice || 0,
            condition: alertData.condition || '>=',
            status: alertData.status || 'watching',
            basePrice: alertData.basePrice || null,
            lastPrice: alertData.lastPrice || null,
            lastChecked: alertData.lastChecked || null,
            triggeredAt: alertData.triggeredAt || null,
            reason: alertData.reason || ''
        });
        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
    }

    function clearStockAlert(noteId) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return;
        const yNote = yNotesMap.get(noteId);
        if (yNote) {
            yNote.set('stockAlert', null);
            yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
        }
    }

    function updateStockAlertField(noteId, field, value) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return;
        const yNote = yNotesMap.get(noteId);
        if (!yNote) return;
        const existing = yNote.get('stockAlert');
        if (existing) {
            const updated = { ...existing, [field]: value };
            yNote.set('stockAlert', updated);
        }
    }

    // -------- 群組系統 --------
    const MAX_GROUP_SIZE = 10;

    function generateGroupId() {
        return 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // 合併兩張（或兩組）便利貼到同一群組，使用 Firestore batch write 確保一致性
    async function mergeToGroup(noteAId, noteBId) {
        // noteA 是拖曳的卡片 (Dragged), noteB 是底下的卡片 (Target)
        // 確保 A 永遠在 B 之上
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap) return null;

        const noteA = notesCache[noteAId];
        const noteB = notesCache[noteBId];
        if (!noteA || !noteB) return null;

        const groupIdA = noteA.groupId || null;
        const groupIdB = noteB.groupId || null;

        let targetGroupId;

        // 檢查人數限制
        const countA = groupIdA ? Object.values(notesCache).filter(n => n.groupId === groupIdA).length : 1;
        const countB = groupIdB ? Object.values(notesCache).filter(n => n.groupId === groupIdB).length : 1;
        if (groupIdA !== groupIdB && countA + countB > MAX_GROUP_SIZE) {
            PostIt.Board.showToast('群組已滿，最多 ' + MAX_GROUP_SIZE + ' 張', 'error');
            if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_full');
            return null;
        }

        try {
            if (groupIdA && groupIdB && groupIdA !== groupIdB) {
                // 群組 A 拖到 群組 B 上面 -> A 搬進 B，且 A 的成員疊加在 B 之上
                targetGroupId = groupIdB;
                const bMembers = Object.values(notesCache).filter(n => n.groupId === groupIdB);
                const aMembers = Object.values(notesCache).filter(n => n.groupId === groupIdA);
                
                const maxOrderB = Math.max(...bMembers.map(m => m.groupOrder || 0), -1);
                
                aMembers.sort((a, b) => (a.groupOrder || 0) - (b.groupOrder || 0)).forEach((member, i) => {
                    const yNote = yNotesMap.get(member.id);
                    if (yNote) {
                        yNote.set('groupId', targetGroupId);
                        yNote.set('groupOrder', maxOrderB + 1 + i);
                        yNote.set('groupOffsetX', (Math.random() - 0.5) * 6);
                        yNote.set('groupOffsetY', (Math.random() - 0.5) * 6);
                        yNote.set('updatedAt', { seconds: Math.floor(Date.now() / 1000) });
                    }
                });
            } else if (!groupIdA && !groupIdB) {
                // 單張 A 拖到 單張 B -> A 在 B 上面 (A=1, B=0)
                targetGroupId = generateGroupId();
                const yNoteB = yNotesMap.get(noteBId);
                if (yNoteB) {
                    yNoteB.set('groupId', targetGroupId);
                    yNoteB.set('groupOrder', 0);
                    yNoteB.set('groupOffsetX', (Math.random() - 0.5) * 6);
                    yNoteB.set('groupOffsetY', (Math.random() - 0.5) * 6);
                }
                const yNoteA = yNotesMap.get(noteAId);
                if (yNoteA) {
                    yNoteA.set('groupId', targetGroupId);
                    yNoteA.set('groupOrder', 1);
                    yNoteA.set('groupOffsetX', (Math.random() - 0.5) * 6);
                    yNoteA.set('groupOffsetY', (Math.random() - 0.5) * 6);
                }
            } else if (groupIdA && !groupIdB) {
                // 群組 A 拖到 單張 B -> A 在 B 上面，所以將 B 塞入 A 的最底層
                targetGroupId = groupIdA;
                const aMembers = Object.values(notesCache).filter(n => n.groupId === groupIdA);
                const minOrderA = Math.min(...aMembers.map(m => m.groupOrder || 0), 0);
                
                const yNoteB = yNotesMap.get(noteBId);
                if (yNoteB) {
                    yNoteB.set('groupId', targetGroupId);
                    yNoteB.set('groupOrder', minOrderA - 1);
                    yNoteB.set('groupOffsetX', (Math.random() - 0.5) * 6);
                    yNoteB.set('groupOffsetY', (Math.random() - 0.5) * 6);
                }
            } else if (!groupIdA && groupIdB) {
                // 單張 A 拖到 群組 B -> A 放在 B 的最上層
                targetGroupId = groupIdB;
                const bMembers = Object.values(notesCache).filter(n => n.groupId === groupIdB);
                const maxOrderB = Math.max(...bMembers.map(m => m.groupOrder || 0), -1);
                
                const yNoteA = yNotesMap.get(noteAId);
                if (yNoteA) {
                    yNoteA.set('groupId', targetGroupId);
                    yNoteA.set('groupOrder', maxOrderB + 1);
                    yNoteA.set('groupOffsetX', (Math.random() - 0.5) * 6);
                    yNoteA.set('groupOffsetY', (Math.random() - 0.5) * 6);
                }
            } else {
                targetGroupId = groupIdA; // 已經在同個群組
            }

            console.log('[Note] 群組合併成功:', targetGroupId);
            return targetGroupId;
        } catch (error) {
            console.error('[Note] 群組合併失敗:', error);
            PostIt.Board.showToast('合併失敗，請再試一次', 'error');
            return null;
        }
    }

    async function removeFromGroup(noteId) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !noteId) return;

        const note = notesCache[noteId];
        if (!note || !note.groupId) return;

        const groupId = note.groupId;

        try {
            const yNote = yNotesMap.get(noteId);
            if (yNote) {
                yNote.set('groupId', null);
                yNote.set('groupOrder', null);
                yNote.set('groupOffsetX', null);
                yNote.set('groupOffsetY', null);
            }

            const remaining = Object.values(notesCache).filter(
                n => n.groupId === groupId && n.id !== noteId
            );
            if (remaining.length === 1) {
                const yRem = yNotesMap.get(remaining[0].id);
                if (yRem) {
                    yRem.set('groupId', null);
                    yRem.set('groupOrder', null);
                    yRem.set('groupOffsetX', null);
                    yRem.set('groupOffsetY', null);
                }
            }
            console.log('[Note] 已從群組拆出:', noteId);
        } catch (error) {
            console.error('[Note] 拆出群組失敗:', error);
        }
    }

    async function disbandGroup(groupId) {
        const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
        if (!yNotesMap || !groupId) return;

        const members = Object.values(notesCache).filter(n => n.groupId === groupId);
        if (members.length === 0) return;

        try {
            members.forEach(member => {
                const yNote = yNotesMap.get(member.id);
                if (yNote) {
                    yNote.set('groupId', null);
                    yNote.set('groupOrder', null);
                    yNote.set('groupOffsetX', null);
                    yNote.set('groupOffsetY', null);
                }
            });
            console.log('[Note] 群組已解散:', groupId);
        } catch (error) {
            console.error('[Note] 解散群組失敗:', error);
            PostIt.Board.showToast('解散失敗', 'error');
        }
    }

    async function removeGroup(groupId) {
        if (!groupId) return;
        const members = getGroupNotes(groupId);
        if (members.length === 0) return;

        try {
            const yNotesMap = typeof PostIt.YjsSync !== 'undefined' ? PostIt.YjsSync.getNotesMap() : null;
            if (!yNotesMap) return;

            const storage = PostIt.Firebase.getStorage();

            for (const member of members) {
                if (member.type === 'image' && member.imageUrl && member.imageUrl.includes('firebasestorage.googleapis.com')) {
                    try {
                        let fileRef;
                        if (member.imageRefPath) {
                            fileRef = storage.ref().child(member.imageRefPath);
                        } else {
                            fileRef = storage.refFromURL(member.imageUrl);
                        }
                        await fileRef.delete();
                    } catch (e) {
                        console.warn('Storage 圖片刪除失敗:', e);
                    }
                }
                
                yNotesMap.delete(member.id);
            }

            console.log('群組已完整刪除:', groupId);
            PostIt.Board.showToast('群組已刪除');
        } catch (error) {
            console.error('刪除整個群組時發生錯誤:', error);
            PostIt.Board.showToast('刪除群組失敗，請檢查網路連線', 'error');
        }
    }
    // 取得群組內所有便利貼（按建立時間排序）
    function getGroupNotes(groupId) {
        if (!groupId) return [];
        return Object.values(notesCache)
            .filter(n => n.groupId === groupId)
            .sort((a, b) => {
                const ta = a.createdAt ? (a.createdAt.seconds || 0) : 0;
                const tb = b.createdAt ? (b.createdAt.seconds || 0) : 0;
                return ta - tb;
            });
    }

    // -------- Getters --------
    function getNotesRef() {
        if (typeof PostIt.Auth === 'undefined') return null;
        const uid = PostIt.Auth.getUid();
        if (!uid) return null;
        if (typeof PostIt.Firebase === 'undefined') return null;
        const db = PostIt.Firebase.getDb();
        if (typeof PostIt.BoardModel !== 'undefined') {
            return PostIt.BoardModel.getActiveNotesRef();
        }
        return db.collection('users').doc(uid).collection('postit_notes');
    }
    function getCache() { return notesCache; }
    function getCount() { return Object.keys(notesCache).length; }
    function getNote(id) { return notesCache[id] || null; }
    function getActiveNoteId() { return activeNoteId; }
    function setActiveNoteId(id) { activeNoteId = id; }

    return {
        subscribe, cleanup, create, updateContent, updatePosition,
        updateColor, updateStyle, archive, unarchive, deleteArchive, getArchivedNotes, remove, uploadImage, detectType,
        updateReminderLogic, updateReminderStatus, getNotesRef,
        updateStockAlert, clearStockAlert, updateStockAlertField,
        mergeToGroup, removeFromGroup, disbandGroup, removeGroup, getGroupNotes, MAX_GROUP_SIZE,
        getCache, getCount, getNote, getActiveNoteId, setActiveNoteId
    };
})();
