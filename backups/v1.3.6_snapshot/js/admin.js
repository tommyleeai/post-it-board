// ============================================
// Post It Admin Dashboard — 管理後台邏輯
// ============================================
(function () {
    'use strict';

    const ADMIN_EMAIL = 'tommylee@gmail.com';

    let db = null;
    let auth = null;
    let allUsersData = []; // [{uid, name, email, photo, notes:[], noteCount, imageCount, lastActive}]
    let sortField = 'notes';
    let sortDir = 'desc';

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
                renderUsersTable();
            });
        });

        // 監聽登入狀態
        auth.onAuthStateChanged(user => {
            if (user && user.email === ADMIN_EMAIL) {
                showAdminApp();
                loadAllData();
            } else if (user) {
                // 不是管理員
                showAuthError('此帳號無管理員權限');
                auth.signOut();
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

    // ======== 載入所有資料 ========
    async function loadAllData() {
        allUsersData = [];

        try {
            // 取得所有 users 下的文件
            const usersSnap = await db.collection('users').get();
            const userIds = [];

            usersSnap.forEach(doc => {
                userIds.push(doc.id);
            });

            // 同時查詢 Auth 使用者資料（從 Firestore 存的 metadata，或 Auth 本身）
            // 因為前端無法直接列出 Auth users，我們需要從 Firestore 或 Auth Token
            // 這裡的做法：讀取每位使用者的 postit_notes 並從 Auth 取得資訊
            
            // 取得 auth 使用者列表
            // 注意：前端 SDK 無法列出所有 Auth 使用者
            // 替代方案：從每個 user 的 postit_notes 推導

            for (const uid of userIds) {
                const notesSnap = await db.collection('users').doc(uid).collection('postit_notes').get();
                const notes = [];
                let imageCount = 0;
                let urlCount = 0;
                let lastActive = null;

                notesSnap.forEach(noteDoc => {
                    const data = noteDoc.data();
                    notes.push({ id: noteDoc.id, ...data });
                    if (data.type === 'image') imageCount++;
                    if (data.type === 'url') urlCount++;

                    // 最近活動時間
                    const updatedAt = data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)) : null;
                    if (updatedAt && (!lastActive || updatedAt > lastActive)) {
                        lastActive = updatedAt;
                    }
                });

                allUsersData.push({
                    uid,
                    name: uid, // 稍後嘗試從 Auth 取得
                    email: '',
                    photo: '',
                    notes,
                    noteCount: notes.length,
                    imageCount,
                    urlCount,
                    lastActive
                });
            }

            // 嘗試取得使用者顯示資料（名稱、Email、頭像）
            // 從 users/{uid}/profile 或其他來源
            // 如果沒有特別存的話，只能看 UID
            // 我們新增一個機制：每次登入時存 profile
            await enrichUserProfiles();

            renderStats();
            renderUsersTable();
            renderActivityFeed();

        } catch (error) {
            console.error('[Admin] 載入資料失敗:', error);
        }
    }

    // ======== 嘗試豐富使用者資料 ========
    async function enrichUserProfiles() {
        for (const user of allUsersData) {
            try {
                const profileDoc = await db.collection('users').doc(user.uid).get();
                const profileData = profileDoc.data();
                if (profileData) {
                    user.name = profileData.displayName || profileData.name || user.uid.substring(0, 8);
                    user.email = profileData.email || '';
                    user.photo = profileData.photoURL || profileData.photo || '';
                }
            } catch (_) {
                // 忽略
            }
        }
    }

    // ======== 渲染統計 ========
    function renderStats() {
        const totalUsers = allUsersData.length;
        const totalNotes = allUsersData.reduce((sum, u) => sum + u.noteCount, 0);
        const totalImages = allUsersData.reduce((sum, u) => sum + u.imageCount, 0);
        const totalDocs = totalUsers + totalNotes; // users docs + notes docs

        document.getElementById('stat-users').textContent = totalUsers;
        document.getElementById('stat-notes').textContent = totalNotes;
        document.getElementById('stat-images').textContent = totalImages;
        document.getElementById('stat-storage').textContent = totalDocs;
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
            tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">沒有找到使用者</td></tr>';
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
                    <button class="mini-note-delete" onclick="AdminApp.deleteNote('${user.uid}', '${note.id}')" title="刪除">
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

    // ======== 刪除操作 ========
    async function deleteNote(uid, noteId) {
        if (!confirm('確定要刪除這張貼紙嗎？')) return;

        try {
            await db.collection('users').doc(uid).collection('postit_notes').doc(noteId).delete();
            // 重新載入
            await loadAllData();
            // 重新打開 modal
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
            const batch = db.batch();
            for (const note of user.notes) {
                const ref = db.collection('users').doc(uid).collection('postit_notes').doc(note.id);
                batch.delete(ref);
            }
            await batch.commit();
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
