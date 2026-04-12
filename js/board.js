// ============================================
// 白板主控制器 — 整合所有模組
// ============================================
PostIt.Board = (function () {
    'use strict';

    let boardEl = null;
    let toastTimer = null;

    // ======== 初始化 ========
    function init() {
        // 初始化 Firebase
        if (!PostIt.Firebase.init()) {
            showToast('系統初始化失敗', 'error');
            return;
        }

        boardEl = document.getElementById('whiteboard');

        // 初始化拖曳引擎
        PostIt.Drag.init();

        // 初始化登入模組
        PostIt.Auth.init(onAuthStateChanged);

        // 綁定 UI 事件
        bindUIEvents();
    }

    // ======== 登入狀態變化 ========
    function onAuthStateChanged(user) {
        const loginScreen = document.getElementById('login-screen');
        const app = document.getElementById('app');

        if (user) {
            // 已登入 → 顯示白板
            loginScreen.classList.add('hidden');
            app.classList.remove('hidden');

            // 更新使用者資訊
            document.getElementById('user-avatar').src = user.photoURL || '';
            document.getElementById('user-name').textContent = user.displayName || user.email;

            // 訂閱筆記
            PostIt.Note.subscribe(renderNotes);

            console.log('[Board] 使用者已登入:', user.displayName);
        } else {
            // 已登出 → 顯示登入畫面
            loginScreen.classList.remove('hidden');
            app.classList.add('hidden');

            // 清除白板
            PostIt.Note.cleanup();
            clearBoard();

            console.log('[Board] 使用者已登出');
        }
    }

    // ======== 綁定 UI 事件 ========
    function bindUIEvents() {
        // FAB 新增貼紙
        const fabAdd = document.getElementById('fab-add');
        fabAdd.addEventListener('click', async () => {
            if (PostIt.Note.getCount() >= 50) {
                showToast('已達 50 張貼紙上限！', 'error');
                return;
            }
            await PostIt.Note.create();
        });

        // 設定面板關閉
        document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
        document.getElementById('settings-overlay').addEventListener('click', closeSettings);

        // 顏色選擇
        document.querySelectorAll('#color-picker .color-swatch').forEach((swatch) => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                const noteId = PostIt.Note.getActiveNoteId();
                if (noteId) {
                    PostIt.Note.updateColor(noteId, color);
                    // 更新 UI active 狀態
                    document.querySelectorAll('#color-picker .color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                }
            });
        });

        // 圖片上傳
        const btnUpload = document.getElementById('btn-upload-image');
        const fileInput = document.getElementById('file-input');

        btnUpload.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                await PostIt.Note.uploadImage(noteId, file);
                closeSettings();
            }
            fileInput.value = '';
        });

        // 刪除貼紙
        document.getElementById('btn-delete-note').addEventListener('click', async () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                // 播放離開動畫
                const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
                if (noteEl) {
                    noteEl.classList.add('leaving');
                    await new Promise(r => setTimeout(r, 300));
                }
                await PostIt.Note.remove(noteId);
                closeSettings();
            }
        });

        // 白板雙擊 — 快速新增貼紙
        boardEl.addEventListener('dblclick', async (e) => {
            // 如果點擊的是貼紙本身，不處理（由貼紙的雙擊編輯處理）
            if (e.target.closest('.sticky-note')) return;

            if (PostIt.Note.getCount() >= 50) {
                showToast('已達 50 張貼紙上限！', 'error');
                return;
            }

            const boardRect = boardEl.getBoundingClientRect();
            const xPercent = ((e.clientX - boardRect.left) / boardRect.width) * 100;
            const yPercent = ((e.clientY - boardRect.top) / boardRect.height) * 100;

            // 直接在點擊位置建立新貼紙（覆寫隨機位置）
            const noteId = await PostIt.Note.create();
            if (noteId) {
                // 立即更新位置到點擊位置
                PostIt.Note.updatePosition(noteId, xPercent - 5, yPercent - 5, PostIt.Drag.getMaxZIndex() + 1);
            }
        });

        // ===== 全域 Ctrl+V 貼上圖片 =====
        document.addEventListener('paste', async (e) => {
            // 未登入或隱藏中不處理
            if (!PostIt.Auth.getUid()) return;

            // 從剪貼簿中抓圖片
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;

            let imageFile = null;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    imageFile = items[i].getAsFile();
                    break;
                }
            }

            // 沒有圖片，不攔截（讓文字正常貼上）
            if (!imageFile) return;

            e.preventDefault();

            // 判斷是否正在編輯某張貼紙
            const editingContent = document.querySelector('.note-content[contenteditable="true"]');
            if (editingContent) {
                // 情況 2：正在編輯中 → 圖片貼到該貼紙
                const noteEl = editingContent.closest('.sticky-note');
                const noteId = noteEl ? noteEl.dataset.noteId : null;
                if (noteId) {
                    // 結束編輯模式
                    editingContent.blur();
                    await PostIt.Note.uploadImage(noteId, imageFile);
                }
            } else {
                // 情況 1：不在任何貼紙中 → 自動建立新貼紙
                if (PostIt.Note.getCount() >= 50) {
                    showToast('已達 50 張貼紙上限！', 'error');
                    return;
                }
                const noteId = await PostIt.Note.create('', 'text');
                if (noteId) {
                    await PostIt.Note.uploadImage(noteId, imageFile);
                }
            }
        });

        // ===== 自動排列按鈕 =====
        document.getElementById('btn-auto-sort').addEventListener('click', autoSort);

        // ===== 還原位置按鈕 =====
        document.getElementById('btn-restore-pos').addEventListener('click', restorePositions);
    }

    // ======== 自動排列 ========
    let savedPositions = null; // 儲存排列前的原始位置

    function autoSort() {
        const notes = PostIt.Note.getCache();
        const noteIds = Object.keys(notes);
        if (noteIds.length === 0) {
            showToast('白板上沒有貼紙', 'error');
            return;
        }

        // 記住原始位置（只在第一次排列時儲存，避免重複排列覆蓋原始位置）
        if (!savedPositions) {
            savedPositions = {};
            noteIds.forEach(id => {
                const note = notes[id];
                savedPositions[id] = { x: note.x, y: note.y, zIndex: note.zIndex, rotation: note.rotation };
            });
        }

        const boardRect = boardEl.getBoundingClientRect();

        // 計算網格參數
        const padding = 20; // 邊距 px
        const gap = 16;     // 間距 px
        const noteW = 200;  // 估計貼紙寬度 px
        const noteH = 180;  // 估計貼紙高度 px

        const availW = boardRect.width - padding * 2;
        const cols = Math.max(1, Math.floor(availW / (noteW + gap)));

        // 按建立時間排序
        const sortedIds = noteIds.sort((a, b) => {
            const ta = notes[a].createdAt ? (notes[a].createdAt.seconds || 0) : 0;
            const tb = notes[b].createdAt ? (notes[b].createdAt.seconds || 0) : 0;
            return ta - tb;
        });

        // 計算每張貼紙的網格位置並更新
        sortedIds.forEach((id, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const xPx = padding + col * (noteW + gap);
            const yPx = padding + row * (noteH + gap);

            const xPercent = (xPx / boardRect.width) * 100;
            const yPercent = (yPx / boardRect.height) * 100;

            // 更新 Firestore（rotation 歸零讓排列更整齊）
            PostIt.Note.updatePosition(id, xPercent, yPercent, i + 1);

            // 動畫移動 DOM
            const noteEl = document.querySelector(`[data-note-id="${id}"]`);
            if (noteEl) {
                noteEl.style.transition = 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), top 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s ease';
                noteEl.style.left = xPx + 'px';
                noteEl.style.top = yPx + 'px';
                noteEl.style.transform = 'rotate(0deg)';
                noteEl.style.zIndex = i + 1;

                // 動畫結束後移除 transition
                setTimeout(() => {
                    noteEl.style.transition = '';
                }, 550);
            }
        });

        // 顯示還原按鈕
        document.getElementById('btn-restore-pos').classList.remove('hidden');
        showToast('已自動排列 ✨');
    }

    // ======== 還原位置 ========
    function restorePositions() {
        if (!savedPositions) {
            showToast('沒有可還原的位置', 'error');
            return;
        }

        const boardRect = boardEl.getBoundingClientRect();

        Object.entries(savedPositions).forEach(([id, pos]) => {
            // 更新 Firestore
            PostIt.Note.updatePosition(id, pos.x, pos.y, pos.zIndex || 1);

            // 動畫移動 DOM
            const noteEl = document.querySelector(`[data-note-id="${id}"]`);
            if (noteEl) {
                const xPx = (pos.x / 100) * boardRect.width;
                const yPx = (pos.y / 100) * boardRect.height;
                const rotation = pos.rotation || 0;

                noteEl.style.transition = 'left 0.5s cubic-bezier(0.4, 0, 0.2, 1), top 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s ease';
                noteEl.style.left = xPx + 'px';
                noteEl.style.top = yPx + 'px';
                noteEl.style.transform = `rotate(${rotation}deg)`;
                noteEl.style.zIndex = pos.zIndex || 1;

                setTimeout(() => {
                    noteEl.style.transition = '';
                }, 550);
            }
        });

        // 清除儲存 & 隱藏還原按鈕
        savedPositions = null;
        document.getElementById('btn-restore-pos').classList.add('hidden');
        showToast('已還原位置 ↩️');
    }

    // ======== 渲染貼紙 ========
    function renderNotes(notes) {
        const existingIds = new Set();

        // 更新或新增
        Object.values(notes).forEach((note) => {
            existingIds.add(note.id);
            let noteEl = document.querySelector(`[data-note-id="${note.id}"]`);

            if (!noteEl) {
                // 新增 DOM 元素
                noteEl = createNoteElement(note);
                boardEl.appendChild(noteEl);
                // 播放進入動畫
                requestAnimationFrame(() => noteEl.classList.add('entering'));
            } else {
                // 更新已存在的元素
                updateNoteElement(noteEl, note);
            }
        });

        // 移除不存在的貼紙
        document.querySelectorAll('.sticky-note').forEach((el) => {
            if (!existingIds.has(el.dataset.noteId)) {
                el.classList.add('leaving');
                setTimeout(() => el.remove(), 300);
            }
        });

        // 更新計數
        updateNoteCount();

        // 更新空白板提示
        const emptyHint = document.getElementById('empty-hint');
        if (Object.keys(notes).length === 0) {
            emptyHint.classList.remove('hidden');
        } else {
            emptyHint.classList.add('hidden');
        }
    }

    // ======== 建立貼紙 DOM ========
    function createNoteElement(note) {
        const el = document.createElement('div');
        el.className = 'sticky-note';
        el.dataset.noteId = note.id;

        // 位置（百分比轉像素）
        const boardRect = boardEl.getBoundingClientRect();
        const x = (note.x / 100) * boardRect.width;
        const y = (note.y / 100) * boardRect.height;
        el.style.left = x + 'px';
        el.style.top = y + 'px';

        // 旋轉
        const rotation = note.rotation || 0;
        el.style.setProperty('--note-rotation', rotation + 'deg');
        el.style.transform = `rotate(${rotation}deg)`;

        // 顏色
        el.style.backgroundColor = note.color || '#FFF176';

        // z-index
        if (note.zIndex) {
            el.style.zIndex = note.zIndex;
            PostIt.Drag.setMaxZIndex(note.zIndex);
        }

        // 內容區
        const contentEl = document.createElement('div');
        contentEl.className = 'note-content';
        contentEl.innerHTML = renderContent(note);
        el.appendChild(contentEl);

        // 時間戳
        const timeEl = document.createElement('div');
        timeEl.className = 'note-timestamp';
        timeEl.textContent = formatTimestamp(note.createdAt);
        el.appendChild(timeEl);

        // 設定按鈕（捲角區）
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'note-settings-trigger';
        settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettings(note.id);
        });
        el.appendChild(settingsBtn);

        // 雙擊編輯
        contentEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            startEditing(el, note.id);
        });

        return el;
    }

    // ======== 更新貼紙 DOM ========
    function updateNoteElement(el, note) {
        // 顏色
        el.style.backgroundColor = note.color || '#FFF176';

        // 位置（只在非拖曳時更新）
        if (!el.classList.contains('dragging')) {
            const boardRect = boardEl.getBoundingClientRect();
            el.style.left = ((note.x / 100) * boardRect.width) + 'px';
            el.style.top = ((note.y / 100) * boardRect.height) + 'px';
        }

        // z-index
        if (note.zIndex && !el.classList.contains('dragging')) {
            el.style.zIndex = note.zIndex;
            PostIt.Drag.setMaxZIndex(note.zIndex);
        }

        // 內容（只在非編輯時更新）
        const contentEl = el.querySelector('.note-content');
        if (contentEl && contentEl.getAttribute('contenteditable') !== 'true') {
            contentEl.innerHTML = renderContent(note);
        }
    }

    // ======== 渲染不同類型的內容 ========
    function renderContent(note) {
        if (!note.content) return '';

        switch (note.type) {
            case 'url':
                // 嘗試顯示漂亮的連結
                try {
                    const url = new URL(note.content);
                    return `<a href="${escapeHtml(note.content)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(note.content)}">${escapeHtml(url.hostname + url.pathname)}</a>`;
                } catch {
                    return `<a href="${escapeHtml(note.content)}" target="_blank" rel="noopener noreferrer">${escapeHtml(note.content)}</a>`;
                }

            case 'image':
                return `<img src="${escapeHtml(note.content)}" alt="上傳的圖片" loading="lazy" draggable="false">`;

            default:
                return escapeHtml(note.content).replace(/\n/g, '<br>');
        }
    }

    // ======== 開始編輯 ========
    function startEditing(noteEl, noteId) {
        if (PostIt.Drag.getIsDragging()) return;

        const contentEl = noteEl.querySelector('.note-content');
        const note = PostIt.Note.getNote(noteId);
        if (!contentEl || !note) return;

        // 圖片型不支持文字編輯
        if (note.type === 'image') return;

        // 設為可編輯
        contentEl.setAttribute('contenteditable', 'true');
        // 用 innerText 保留換行符
        contentEl.innerText = note.content || '';
        contentEl.focus();

        // 游標移到最後
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        // 失焦時儲存
        const onBlur = () => {
            contentEl.removeAttribute('contenteditable');
            // innerText 會保留 Shift+Enter 產生的換行
            const newContent = contentEl.innerText.trim();
            PostIt.Note.updateContent(noteId, newContent);
            contentEl.removeEventListener('blur', onBlur);
            contentEl.removeEventListener('keydown', onKeyDown);
        };

        // Escape 結束編輯，Shift+Enter 換行由瀏覽器原生處理
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                contentEl.blur();
            }
        };

        contentEl.addEventListener('blur', onBlur);
        contentEl.addEventListener('keydown', onKeyDown);
    }

    // ======== 設定面板 ========
    function openSettings(noteId) {
        PostIt.Note.setActiveNoteId(noteId);
        const note = PostIt.Note.getNote(noteId);
        if (!note) return;

        // 更新顏色選擇器
        document.querySelectorAll('#color-picker .color-swatch').forEach((swatch) => {
            swatch.classList.toggle('active', swatch.dataset.color === note.color);
        });

        // 顯示面板
        document.getElementById('note-settings').classList.remove('hidden');
        document.getElementById('note-settings').classList.add('visible');
        document.getElementById('settings-overlay').classList.remove('hidden');
        document.getElementById('settings-overlay').classList.add('visible');
    }

    function closeSettings() {
        PostIt.Note.setActiveNoteId(null);
        document.getElementById('note-settings').classList.remove('visible');
        document.getElementById('note-settings').classList.add('hidden');
        document.getElementById('settings-overlay').classList.remove('visible');
        document.getElementById('settings-overlay').classList.add('hidden');
    }

    // ======== 清空白板 DOM ========
    function clearBoard() {
        document.querySelectorAll('.sticky-note').forEach(el => el.remove());
        updateNoteCount();
    }

    // ======== 更新貼紙計數 ========
    function updateNoteCount() {
        const count = PostIt.Note.getCount();
        const el = document.getElementById('note-count');
        if (el) el.textContent = `${count} / 50`;

        // FAB 狀態
        const fab = document.getElementById('fab-add');
        if (count >= 50) {
            fab.classList.add('disabled');
        } else {
            fab.classList.remove('disabled');
        }
    }

    // ======== Toast 通知 ========
    function showToast(message, type = 'info') {
        // 移除既有 toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        // 觸發動畫
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // 自動消失
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        }, 2500);
    }

    // ======== 工具函式 ========
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hours = d.getHours().toString().padStart(2, '0');
        const mins = d.getMinutes().toString().padStart(2, '0');
        return `${month}/${day} ${hours}:${mins}`;
    }

    // ======== 視窗 resize 時重新計算貼紙位置 ========
    function handleResize() {
        const notes = PostIt.Note.getCache();
        Object.values(notes).forEach((note) => {
            const noteEl = document.querySelector(`[data-note-id="${note.id}"]`);
            if (noteEl && !noteEl.classList.contains('dragging')) {
                const boardRect = boardEl.getBoundingClientRect();
                noteEl.style.left = ((note.x / 100) * boardRect.width) + 'px';
                noteEl.style.top = ((note.y / 100) * boardRect.height) + 'px';
            }
        });
    }

    // 監聽 resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(handleResize, 150);
    });

    // ======== DOM Ready ========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init, showToast, handleResize };
})();
