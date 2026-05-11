// ============================================
// Post It Admin Dashboard — 管理後台邏輯
// ============================================
(function () {
    'use strict';

    // 管理員 Email 清單（fallback，優先從 Firestore config/admin 讀取）
    const FALLBACK_ADMIN_EMAILS = ['tommylee@gmail.com'];
    let adminEmails = [...FALLBACK_ADMIN_EMAILS];

    let db = null;
    let auth = null;
    let allUsersData = []; // [{uid, name, email, photo, notes:[], noteCount, imageCount, lastActive}]
    let sortField = 'notes';
    let sortDir = 'desc';
    let totalBoardCount = 0; // 追蹤白板總數

    // ======== 初始化 ========
    function init() {
        // Firebase 初始化
        if (!PostIt.Firebase.init()) {
            console.error('[Admin] Firebase 初始化失敗');
            return;
        }

        db = PostIt.Firebase.getDb();
        auth = PostIt.Firebase.getAuth();

        // 登入按鈕
        document.getElementById('btn-admin-login').addEventListener('click', doLogin);
        document.getElementById('btn-admin-logout').addEventListener('click', doLogout);
        document.getElementById('btn-refresh').addEventListener('click', loadAllData);
        document.getElementById('btn-close-modal').addEventListener('click', closeModal);
        document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
        document.querySelector('.modal-backdrop').addEventListener('click', closeModal);

        // 搜尋
        document.getElementById('search-user').addEventListener('input', renderUsersTable);

        // 排序
        document.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (sortField === field) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortField = field;
                    sortDir = 'desc';
                }
                updateSortIcons();
                renderUsersTable();
            });
        });

        // 監聽登入狀態
        auth.onAuthStateChanged(async user => {
            if (user) {
                // 先嘗試從 Firestore 讀取管理員清單
                try {
                    const configDoc = await db.collection('config').doc('admin').get();
                    if (configDoc.exists && configDoc.data().emails) {
                        adminEmails = configDoc.data().emails;
                    }
                } catch (e) {
                    console.warn('[Admin] 無法讀取 Firestore 管理員設定，使用 fallback:', e.message);
                }

                if (adminEmails.includes(user.email)) {
                    showAdminApp();
                    loadAllData();
                } else {
                    showAuthError('此帳號無管理員權限');
                    auth.signOut();
                }
            } else {
                showAuthScreen();
            }
        });
    }

    // ======== 登入 / 登出 ========
    async function doLogin() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        } catch (err) {
            showAuthError('登入失敗：' + err.message);
        }
    }

    function doLogout() {
        auth.signOut();
    }

    function showAdminApp() {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('admin-app').classList.remove('hidden');
    }

    function showAuthScreen() {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('admin-app').classList.add('hidden');
    }

    function showAuthError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    // ======== 載入所有資料（支援多白板） ========
    async function loadAllData() {
        allUsersData = [];
        totalBoardCount = 0;
        const tbody = document.getElementById('users-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="loading-cell"><i class="fa-solid fa-spinner fa-spin"></i> 正在讀取使用者資料...</td></tr>';

        try {
            const usersMap = {};
            
            // 1. 建立使用者基底資料
            const usersSnap = await db.collection('users').get();
            usersSnap.forEach(doc => {
                const data = doc.data();
                usersMap[doc.id] = {
                    uid: doc.id,
                    name: data.displayName || data.name || doc.id.substring(0, 8),
                    email: data.email || '',
                    photo: data.photoURL || data.photo || '',
                    notes: [],
                    noteCount: 0,
                    imageCount: 0,
                    urlCount: 0,
                    boardCount: 0,
                    boardNames: [],
                    lastActive: null
                };
            });

            // 2. 讀取 V3 根目錄的所有白板 (跨帳號協作版)
            const boardsSnap = await db.collection('boards').get();
            totalBoardCount = boardsSnap.size;
            for (let i = 0; i < boardsSnap.docs.length; i++) {
                const boardDoc = boardsSnap.docs[i];
                const boardData = boardDoc.data();
                const ownerId = boardData.ownerId;

                // 更新進度
                if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell"><i class="fa-solid fa-spinner fa-spin"></i> 正在讀取白板 ${i + 1}/${boardsSnap.size}...</td></tr>`;
                
                // 如果找不到 owner，或者 owner 已經被刪除，就先跳過歸屬
                if (!ownerId || !usersMap[ownerId]) {
                    if (ownerId) {
                        usersMap[ownerId] = { uid: ownerId, name: ownerId, email: '', photo: '', notes: [], noteCount: 0, imageCount: 0, urlCount: 0, boardCount: 0, boardNames: [], lastActive: null };
                    } else {
                        continue; 
                    }
                }

                const user = usersMap[ownerId];
                user.boardCount++;
                user.boardNames.push({ id: boardDoc.id, name: boardData.name || '白板', icon: boardData.icon || '📋' });

                // 讀取該白板的筆記
                const boardNotesSnap = await db.collection('boards').doc(boardDoc.id).collection('notes').get();
                boardNotesSnap.forEach(noteDoc => {
                    const data = noteDoc.data();
                    user.notes.push({ id: noteDoc.id, boardId: boardDoc.id, boardName: boardData.name || '白板', ...data, isV3: true });
                    if (data.type === 'image') user.imageCount++;
                    if (data.type === 'url') user.urlCount++;
                    const updatedAt = data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)) : null;
                    if (updatedAt && (!user.lastActive || updatedAt > user.lastActive)) user.lastActive = updatedAt;
                });
            }

            // 3. 處理還沒遷移的 V2/V1 舊筆記 (降級相容)
            for (const uid in usersMap) {
                const user = usersMap[uid];
                
                // 如果已經有 V3 白板，代表已經被系統遷移過，不重複讀取舊資料以免數量膨脹三倍
                if (user.boardCount === 0) {
                    const userRef = db.collection('users').doc(uid);
                    
                    // 嘗試讀取 V2 boards
                    const oldBoardsSnap = await userRef.collection('boards').get();
                    if (!oldBoardsSnap.empty) {
                        user.boardCount = oldBoardsSnap.size;
                        for (const boardDoc of oldBoardsSnap.docs) {
                            const boardData = boardDoc.data();
                            user.boardNames.push({ id: boardDoc.id, name: boardData.name || '舊版白板', icon: boardData.icon || '📋' });
                            
                            const oldBoardNotesSnap = await userRef.collection('boards').doc(boardDoc.id).collection('notes').get();
                            oldBoardNotesSnap.forEach(noteDoc => {
                                const data = noteDoc.data();
                                user.notes.push({ id: noteDoc.id, boardId: boardDoc.id, boardName: boardData.name || '舊版白板', ...data, isV2: true });
                                if (data.type === 'image') user.imageCount++;
                                if (data.type === 'url') user.urlCount++;
                                const updatedAt = data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)) : null;
                                if (updatedAt && (!user.lastActive || updatedAt > user.lastActive)) user.lastActive = updatedAt;
                            });
                        }
                    } else {
                        // 嘗試讀取 V1 postit_notes
                        const oldNotesSnap = await userRef.collection('postit_notes').get();
                        oldNotesSnap.forEach(noteDoc => {
                            const data = noteDoc.data();
                            user.notes.push({ id: noteDoc.id, boardId: 'legacy', boardName: 'V1舊版', ...data, isV1: true });
                            if (data.type === 'image') user.imageCount++;
                            if (data.type === 'url') user.urlCount++;
                            const updatedAt = data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)) : null;
                            if (updatedAt && (!user.lastActive || updatedAt > user.lastActive)) user.lastActive = updatedAt;
                        });
                    }
                }
                
                user.noteCount = user.notes.length;
                allUsersData.push(user);
            }


            renderStats();
            renderUsersTable();
            renderActivityFeed();

        } catch (error) {
            console.error('[Admin] 載入資料失敗:', error);
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="loading-cell" style="color:red">載入失敗：${error.message}</td></tr>`;
        }
    }



    // ======== 渲染統計 ========
    function renderStats() {
        const totalUsers = allUsersData.length;
        const totalNotes = allUsersData.reduce((sum, u) => sum + u.noteCount, 0);
        const totalImages = allUsersData.reduce((sum, u) => sum + u.imageCount, 0);
        const totalDocs = totalUsers + totalNotes + totalBoardCount; // users + notes + boards

        document.getElementById('stat-users').textContent = totalUsers;
        document.getElementById('stat-notes').textContent = totalNotes;
        document.getElementById('stat-images').textContent = totalImages;
        document.getElementById('stat-storage').textContent = totalDocs;
    }

    // ======== 更新排序箭頭 ========
    function updateSortIcons() {
        document.querySelectorAll('th.sortable').forEach(th => {
            const icon = th.querySelector('i');
            if (th.dataset.sort === sortField) {
                icon.className = sortDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
                th.classList.add('active-sort');
            } else {
                icon.className = 'fa-solid fa-sort';
                th.classList.remove('active-sort');
            }
        });
    }

    // ======== 渲染使用者表格 ========
    function renderUsersTable() {
        const searchTerm = document.getElementById('search-user').value.toLowerCase();

        let filtered = allUsersData.filter(u => {
            return u.name.toLowerCase().includes(searchTerm)
                || u.email.toLowerCase().includes(searchTerm)
                || u.uid.toLowerCase().includes(searchTerm);
        });

        // 排序
        filtered.sort((a, b) => {
            let va, vb;
            switch (sortField) {
                case 'name': va = a.name; vb = b.name; break;
                case 'email': va = a.email; vb = b.email; break;
                case 'notes': va = a.noteCount; vb = b.noteCount; break;
                case 'images': va = a.imageCount; vb = b.imageCount; break;
                case 'lastActive':
                    va = a.lastActive ? a.lastActive.getTime() : 0;
                    vb = b.lastActive ? b.lastActive.getTime() : 0;
                    break;
                default: va = a.noteCount; vb = b.noteCount;
            }
            if (typeof va === 'string') {
                return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            return sortDir === 'asc' ? va - vb : vb - va;
        });

        const tbody = document.getElementById('users-tbody');

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">沒有找到使用者</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(user => `
            <tr>
                <td>
                    ${user.photo
                        ? `<img src="${escapeHtml(user.photo)}" class="user-avatar-small" alt="">`
                        : '<i class="fa-solid fa-user-circle" style="font-size:36px;color:var(--admin-text-dim)"></i>'}
                </td>
                <td><strong>${escapeHtml(user.name)}</strong></td>
                <td style="color:var(--admin-text-dim)">${escapeHtml(user.email || user.uid.substring(0, 12) + '...')}</td>
                <td><span class="badge badge-notes">${user.noteCount}</span></td>
                <td><span class="badge badge-images">${user.imageCount}</span></td>
                <td><span class="badge" style="background:rgba(155,89,182,0.15);color:#9b59b6">${user.boardCount || 0}</span></td>
                <td style="color:var(--admin-text-dim);font-size:13px">${user.lastActive ? formatTime(user.lastActive) : '—'}</td>
                <td>
                    <button class="btn-view" onclick="AdminApp.openUserModal('${user.uid}')">
                        <i class="fa-solid fa-eye"></i> 查看
                    </button>
                    <button class="btn-danger" onclick="AdminApp.deleteAllNotes('${user.uid}')" title="刪除所有貼紙">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // ======== 渲染活動動態 ========
    function renderActivityFeed() {
        const allNotes = [];
        allUsersData.forEach(user => {
            user.notes.forEach(note => {
                allNotes.push({ ...note, userName: user.name, userPhoto: user.photo, userUid: user.uid });
            });
        });

        // 按更新時間排序
        allNotes.sort((a, b) => {
            const ta = a.updatedAt ? (a.updatedAt.toDate ? a.updatedAt.toDate().getTime() : new Date(a.updatedAt).getTime()) : 0;
            const tb = b.updatedAt ? (b.updatedAt.toDate ? b.updatedAt.toDate().getTime() : new Date(b.updatedAt).getTime()) : 0;
            return tb - ta;
        });

        const feed = document.getElementById('activity-feed');
        const recent = allNotes.slice(0, 20);

        if (recent.length === 0) {
            feed.innerHTML = '<div class="loading-cell">沒有活動紀錄</div>';
            return;
        }

        feed.innerHTML = recent.map(note => {
            const time = note.updatedAt ? (note.updatedAt.toDate ? note.updatedAt.toDate() : new Date(note.updatedAt)) : null;
            const typeIcon = note.type === 'image' ? '🖼️' : note.type === 'url' ? '🔗' : '📝';
            const preview = note.type === 'image' ? '[圖片]' : (note.content || '').substring(0, 60);

            return `
                <div class="activity-item">
                    ${note.userPhoto
                        ? `<img src="${escapeHtml(note.userPhoto)}" class="activity-avatar" alt="">`
                        : '<i class="fa-solid fa-user-circle activity-avatar" style="font-size:32px;color:var(--admin-text-dim)"></i>'}
                    <div>
                        <div class="activity-text">
                            <strong>${escapeHtml(note.userName)}</strong>
                            <span class="activity-action"> ${typeIcon} 更新了貼紙</span>
                        </div>
                        <div class="activity-time">${time ? formatTime(time) : ''}</div>
                        ${preview ? `<div class="activity-preview">${escapeHtml(preview)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ======== 使用者詳情 Modal ========
    function openUserModal(uid) {
        const user = allUsersData.find(u => u.uid === uid);
        if (!user) return;

        document.getElementById('modal-avatar').src = user.photo || '';
        document.getElementById('modal-name').textContent = user.name;
        document.getElementById('modal-email').textContent = user.email || user.uid;

        document.getElementById('modal-note-count').textContent = `📝 ${user.noteCount} 張貼紙`;
        document.getElementById('modal-note-count').style.cssText = 'background:rgba(0,184,148,0.15);color:#00b894';
        document.getElementById('modal-image-count').textContent = `🖼️ ${user.imageCount} 張圖片`;
        document.getElementById('modal-image-count').style.cssText = 'background:rgba(9,132,227,0.15);color:#0984e3';
        document.getElementById('modal-url-count').textContent = `🔗 ${user.urlCount} 個連結`;
        document.getElementById('modal-url-count').style.cssText = 'background:rgba(253,203,110,0.15);color:#f39c12';

        // 渲染貼紙
        const grid = document.getElementById('modal-notes');
        grid.innerHTML = user.notes.map(note => {
            const time = note.createdAt ? (note.createdAt.toDate ? note.createdAt.toDate() : new Date(note.createdAt)) : null;
            const typeBadge = note.type === 'image' ? '圖片' : note.type === 'url' ? '連結' : '文字';

            let contentHtml = '';
            if (note.type === 'image' && note.content) {
                contentHtml = `<img src="${escapeHtml(note.content)}" alt="圖片">`;
            } else if (note.type === 'url' && note.content) {
                contentHtml = `<a href="${escapeHtml(note.content)}" target="_blank">${escapeHtml(note.content)}</a>`;
            } else {
                contentHtml = escapeHtml(note.content || '').replace(/\n/g, '<br>');
            }

            return `
                <div class="mini-note" style="background:${note.color || '#FFF176'}">
                    <button class="mini-note-delete" onclick="AdminApp.deleteNote('${user.uid}', '${note.id}', '${note.boardId || ''}', ${note.isV3 || false}, ${note.isV2 || false})" title="刪除">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                    <span class="note-type-badge">${typeBadge}</span>
                    ${contentHtml}
                    <span class="note-time">${time ? formatTimeShort(time) : ''}</span>
                </div>
            `;
        }).join('');

        if (user.notes.length === 0) {
            grid.innerHTML = '<p style="color:var(--admin-text-dim);text-align:center;padding:40px;">此使用者沒有貼紙</p>';
        }

        document.getElementById('user-modal').classList.remove('hidden');
    }

    function closeModal() {
        document.getElementById('user-modal').classList.add('hidden');
    }

    // ======== 刪除操作（支援多白板路徑） ========
    async function deleteNote(uid, noteId, boardId, isV3 = false, isV2 = false) {
        if (!confirm('確定要刪除這張貼紙嗎？')) return;

        try {
            if (isV3) {
                await db.collection('boards').doc(boardId).collection('notes').doc(noteId).delete();
            } else if (isV2) {
                await db.collection('users').doc(uid).collection('boards').doc(boardId).collection('notes').doc(noteId).delete();
            } else {
                await db.collection('users').doc(uid).collection('postit_notes').doc(noteId).delete();
            }
            await loadAllData();
            openUserModal(uid);
        } catch (err) {
            alert('刪除失敗：' + err.message);
        }
    }

    async function deleteAllNotes(uid) {
        const user = allUsersData.find(u => u.uid === uid);
        if (!user) return;
        if (!confirm(`確定要刪除 ${user.name} 的所有 ${user.noteCount} 張貼紙嗎？此操作無法還原！`)) return;

        try {
            // Firestore batch 上限 500 筆，分批處理
            const BATCH_LIMIT = 450;
            const refs = user.notes.map(note => {
                if (note.isV3) {
                    return db.collection('boards').doc(note.boardId).collection('notes').doc(note.id);
                } else if (note.isV2) {
                    return db.collection('users').doc(uid).collection('boards').doc(note.boardId).collection('notes').doc(note.id);
                } else {
                    return db.collection('users').doc(uid).collection('postit_notes').doc(note.id);
                }
            });

            for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
                const batch = db.batch();
                const chunk = refs.slice(i, i + BATCH_LIMIT);
                chunk.forEach(ref => batch.delete(ref));
                await batch.commit();
            }
            await loadAllData();
        } catch (err) {
            alert('刪除失敗：' + err.message);
        }
    }

    // ======== 匯出 CSV ========
    function exportCSV() {
        if (allUsersData.length === 0) return;

        const headers = ['名稱', 'Email', 'UID', '貼紙數', '圖片數', '連結數', '最近活動'];
        const rows = allUsersData.map(u => [
            u.name,
            u.email,
            u.uid,
            u.noteCount,
            u.imageCount,
            u.urlCount,
            u.lastActive ? u.lastActive.toISOString() : ''
        ]);

        const csvContent = '\uFEFF' + [headers, ...rows].map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `post-it-users-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ======== 工具函式 ========
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTime(date) {
        const now = new Date();
        const diff = now - date;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return '剛剛';
        if (mins < 60) return `${mins} 分鐘前`;
        if (hours < 24) return `${hours} 小時前`;
        if (days < 7) return `${days} 天前`;
        return date.toLocaleDateString('zh-TW');
    }

    function formatTimeShort(date) {
        const m = date.getMonth() + 1;
        const d = date.getDate();
        return `${m}/${d}`;
    }

    // ======== DOM Ready ========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 暴露到全域供 onclick 使用
    window.AdminApp = {
        openUserModal,
        deleteNote,
        deleteAllNotes
    };
})();
