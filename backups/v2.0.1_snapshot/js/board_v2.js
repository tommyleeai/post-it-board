// ============================================
// 白板主控制器 — 整合所有模組
// ============================================
PostIt.Board = (function () {
    'use strict';

    let pendingAutoFocusId = null; // 雙擊新增後，等卡片渲染完自動聚焦用

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

        // 初始化印章系統
        if (typeof PostIt.Stamp !== 'undefined') PostIt.Stamp.init();

        // 初始化圖釘連線系統
        if (typeof PostIt.Connect !== 'undefined') PostIt.Connect.init();

        // 初始化登入模組
        PostIt.Auth.init(onAuthStateChanged);

        // 綁定 UI 事件
        bindUIEvents();
    }

    // ======== 登入狀態變化 ========
    async function onAuthStateChanged(user) {
        const loginScreen = document.getElementById('login-screen');
        const app = document.getElementById('app');

        if (user) {
            // 已登入 → 顯示白板
            loginScreen.classList.add('hidden');
            app.classList.remove('hidden');

            // 更新使用者資訊
            document.getElementById('user-avatar').src = user.photoURL || '';
            document.getElementById('user-name').textContent = user.displayName || user.email;

            // 載入帳號設定
            await PostIt.Settings.load();

            // 套用白板背景
            applyBoardBgImage(PostIt.Settings.getAccountSettings().boardBgImage);

            // 初始化多白板系統
            if (typeof PostIt.BoardModel !== 'undefined') {
                await PostIt.BoardModel.ensureDefault();
                PostIt.BoardModel.onSwitch(onBoardSwitch);
                PostIt.BoardModel.subscribe(renderSidebar);
            }

            // 訂閱筆記
            PostIt.Note.subscribe(renderNotes);

            // 啟提圖釘連線系統
            if (typeof PostIt.Connect !== 'undefined') PostIt.Connect.start();

            // 啟動更新日誌模組 (檢查是否需要自動顯示)
            if (typeof PostIt.Changelog !== 'undefined') PostIt.Changelog.init();

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

        // 蓋章完成歸檔
        document.getElementById('btn-stamp-complete').addEventListener('click', async () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (!noteId) return;

            const noteEl = document.querySelector(`[data-note-id="${noteId}"]`);
            if (!noteEl) return;

            closeSettings();

            // 建立印章 DOM
            const overlay = document.createElement('div');
            overlay.className = 'note-stamp-overlay';
            const stamp = document.createElement('div');
            stamp.className = 'note-stamp';
            stamp.textContent = '已完成';
            overlay.appendChild(stamp);
            noteEl.appendChild(overlay);

            // 觸發蓋章動畫
            requestAnimationFrame(() => {
                stamp.classList.add('stamping');
            });

            // 等動畫完成再漸灰
            await new Promise(r => setTimeout(r, 600));
            noteEl.classList.add('stamped-archiving');

            // 等灰階效果完成再歸檔
            await new Promise(r => setTimeout(r, 1800));
            const archiveId = await PostIt.Note.archive(noteId);
            
            if (archiveId) {
                showToast('已完成！貼紙已歸檔 ✅', 'success', {
                    label: '復原',
                    onClick: async () => {
                        await PostIt.Note.unarchive(archiveId);
                        showToast('已復原歸檔貼紙', 'info');
                    }
                });
            } else {
                showToast('已完成！貼紙已歸檔 ✅', 'success');
            }
        });

        // 彩色流光效果開關
        document.getElementById('btn-rainbow').addEventListener('click', () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (!noteId) return;
            const note = PostIt.Note.getNote(noteId);
            const newVal = !(note && note.rainbow);
            PostIt.Note.updateStyle(noteId, { rainbow: newVal });
            // 即時更新按鈕狀態
            document.getElementById('btn-rainbow').classList.toggle('active', newVal);
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
                // 等 DOM 渲染完成後，直接抓元素並自動進入編輯模式
                // 不依賴 renderNotes 的 snapshot 時序，避免 race condition
                setTimeout(() => {
                    const newEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
                    if (newEl) startEditing(newEl, noteId);
                }, 350);
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

        // ===== 帳號控制台 =====
        bindAccountSettingsEvents();
        
        // ===== 歷史歸檔區 =====
        bindArchiveModalEvents();

        // ===== 單卡樣式設定 =====
        bindCardStyleEvents();

        // ===== 手機版側邊欄 =====
        const mobileToggle = document.getElementById('mobile-sidebar-toggle');
        const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
        const boardSidebar = document.getElementById('board-sidebar');
        
        if (mobileToggle && mobileOverlay && boardSidebar) {
            mobileToggle.addEventListener('click', () => {
                boardSidebar.classList.add('mobile-open');
                mobileOverlay.classList.add('active');
            });
            mobileOverlay.addEventListener('click', () => {
                boardSidebar.classList.remove('mobile-open');
                mobileOverlay.classList.remove('active');
            });
        }
        
        // ===== 行動端 Tab 切換過濾 =====
        const mobileTabs = document.querySelectorAll('.mobile-tab-btn');
        mobileTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 更新 active 狀態
                mobileTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const filter = tab.dataset.tab; // 'all', 'text', 'image'
                const notes = document.querySelectorAll('.sticky-note');
                
                notes.forEach(noteEl => {
                    const hasImage = !!noteEl.querySelector('.note-content img');
                    const isSystem = noteEl.classList.contains('ai-system-note');
                    
                    if (filter === 'all' || isSystem) {
                        noteEl.style.display = 'block';
                    } else if (filter === 'image') {
                        noteEl.style.display = hasImage ? 'block' : 'none';
                    } else if (filter === 'text') {
                        noteEl.style.display = !hasImage ? 'block' : 'none';
                    }
                });
            });
        });

        // ===== 行動端 FAB 觸控防護 =====
        const stampWrapper = document.querySelector('.stamp-wrapper');
        const fabStamp = document.getElementById('fab-stamp');
        if (fabStamp && stampWrapper) {
            fabStamp.addEventListener('click', (e) => {
                if (window.innerWidth <= 768) {
                    e.stopPropagation(); // 阻止冒泡以免立刻觸發 document 的 click 事件而關閉
                    stampWrapper.classList.toggle('mobile-open');
                }
            });
            // 點擊畫面其他地方自動收起印章選單
            document.addEventListener('click', (e) => {
                if (window.innerWidth <= 768 && !stampWrapper.contains(e.target)) {
                    stampWrapper.classList.remove('mobile-open');
                }
            });
        }
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
        const noteW = 340;  // 估計貼紙寬度 px（加倍後）
        const noteH = 300;  // 估計貼紙高度 px（加倍後）

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
                requestAnimationFrame(() => {
                    noteEl.classList.add('entering');
                    // 動畫播完後必須移除，否則其 animation forwards 屬性會永久壓死後續的鬧鐘動畫
                    setTimeout(() => noteEl.classList.remove('entering'), 500);

                    // 若是使用者雙擊新增的這張卡片，自動進入編輯模式
                    // (自動聚焦已移至 dblclick handler 的 setTimeout，此處不再處理)
                });
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

        // 同步鬧鐘狀態
        if (typeof PostIt.Alarm !== 'undefined') {
            PostIt.Alarm.sync(notes);
        }

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
        if (note.role === 'ai') {
            el.classList.add('ai-system-note');
        }
        el.dataset.noteId = note.id;

        // 位置（百分比轉像素）— 跨裝置獨立座標
        const mode = (window.PostIt && PostIt.getDeviceMode) ? PostIt.getDeviceMode() : 'desktop';
        const layoutData = (note.layouts && note.layouts[mode]) ? note.layouts[mode] : note; // 降級相容舊版
        
        const boardRect = boardEl.getBoundingClientRect();
        const xVal = typeof layoutData.x === 'number' ? layoutData.x : (note.x || 0);
        const yVal = typeof layoutData.y === 'number' ? layoutData.y : (note.y || 0);
        const zVal = typeof layoutData.zIndex === 'number' ? layoutData.zIndex : (note.zIndex || 1);

        const x = (xVal / 100) * boardRect.width;
        const y = (yVal / 100) * boardRect.height;
        el.style.left = x + 'px';
        el.style.top = y + 'px';

        // 旋轉
        const rotation = note.rotation || 0;
        el.style.setProperty('--note-rotation', rotation + 'deg');
        el.style.transform = `rotate(${rotation}deg)`;

        // 顏色
        el.style.backgroundColor = 'transparent';
        el.style.setProperty('--note-bg-color', note.color || '#FFF176');

        // z-index - 從專屬 layout 讀取
        el.style.zIndex = zVal;
        if (window.PostIt && PostIt.Drag) PostIt.Drag.setMaxZIndex(zVal);

        // 隨機膠帶
        const tape = document.createElement('div');
        tape.className = 'note-tape';
        const tapeWidth = 50 + Math.random() * 60;   // 50~110px
        const tapeLeft = 20 + Math.random() * 50;     // 20%~70%
        const tapeRotation = (Math.random() - 0.5) * 24; // -12°~+12°
        const tapeOpacity = 0.8 + Math.random() * 0.2;  // 0.8~1.0
        tape.style.width = tapeWidth + 'px';
        tape.style.left = tapeLeft + '%';
        tape.style.transform = `translateX(-50%) rotate(${tapeRotation}deg)`;
        tape.style.opacity = tapeOpacity;
        // 20% 機率髒污
        if (Math.random() < 0.2) tape.classList.add('tape-dirty');
        // 15% 機率翹起
        if (Math.random() < 0.15) tape.classList.add('tape-peeling');
        el.appendChild(tape);

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

        // 垃圾桶快速刪除按鈕（右上角）
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'note-delete-btn';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        deleteBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
        });
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            // 播放離開動畫
            el.classList.add('leaving');
            await new Promise(r => setTimeout(r, 300));
            await PostIt.Note.remove(note.id);
        });
        el.appendChild(deleteBtn);

        // 右上角 hover 1秒延遲顯現垃圾桶
        let deleteTimer = null;
        let isInCorner = false;

        el.addEventListener('mousemove', (e) => {
            const rect = el.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            const localY = e.clientY - rect.top;

            // 右上角 50x50 區域
            const inCorner = localX > (rect.width - 50) && localY < 50;

            if (inCorner && !isInCorner) {
                isInCorner = true;
                deleteTimer = setTimeout(() => {
                    deleteBtn.classList.add('note-delete-visible');
                }, 1000);
            } else if (!inCorner && isInCorner) {
                isInCorner = false;
                clearTimeout(deleteTimer);
                deleteBtn.classList.remove('note-delete-visible');
            }
        });

        el.addEventListener('mouseleave', () => {
            isInCorner = false;
            clearTimeout(deleteTimer);
            deleteBtn.classList.remove('note-delete-visible');
        });

        // 單擊進入編輯（點擊卡片任一處即可）
        el.addEventListener('click', (e) => {
            // 果如目前是圖釘連線模式，交由 Connect 處理，不觸發編輯
            if (typeof PostIt.Connect !== 'undefined' && PostIt.Connect.isPinModeActive()) {
                e.stopPropagation();
                PostIt.Connect.handleNotePin(el);
                return;
            }

            // 不阻擋特定按鈕的點擊（設定齒輪或刪除按鈕）
            if (e.target.closest('.note-settings-trigger') || e.target.closest('.note-delete-btn')) return;

            e.stopPropagation();
            
            // 如果正在響鈴，單擊只是用來解除鬧鐘，不進入編輯模式
            if (el.classList.contains('alarming')) {
                if(typeof PostIt.Alarm !== 'undefined') PostIt.Alarm.dismissAlarm(note.id);
                return;
            }

            startEditing(el, note.id);
        });

        // 套用字型樣式
        applyNoteStyle(el, note);

        // 渲染鬧鐘徽章
        renderAlarmBadge(el, note);

        return el;
    }

    // ======== 更新貼紙 DOM ========
    function updateNoteElement(el, note) {
        // 顏色
        el.style.backgroundColor = 'transparent';
        el.style.setProperty('--note-bg-color', note.color || '#FFF176');

        // 位置（只在非拖曳時更新）— 跨裝置獨立座標
        if (!el.classList.contains('dragging')) {
            const mode = (window.PostIt && PostIt.getDeviceMode) ? PostIt.getDeviceMode() : 'desktop';
            const layoutData = (note.layouts && note.layouts[mode]) ? note.layouts[mode] : note; // 降級相容舊版
            
            const xVal = typeof layoutData.x === 'number' ? layoutData.x : (note.x || 0);
            const yVal = typeof layoutData.y === 'number' ? layoutData.y : (note.y || 0);
            const zVal = typeof layoutData.zIndex === 'number' ? layoutData.zIndex : (note.zIndex || 1);

            const boardRect = boardEl.getBoundingClientRect();
            el.style.left = ((xVal / 100) * boardRect.width) + 'px';
            el.style.top = ((yVal / 100) * boardRect.height) + 'px';

            // z-index
            el.style.zIndex = zVal;
            if (window.PostIt && PostIt.Drag) PostIt.Drag.setMaxZIndex(zVal);
        }

        // 內容（只在非編輯時更新）
        const contentEl = el.querySelector('.note-content');
        if (contentEl && contentEl.getAttribute('contenteditable') !== 'true') {
            contentEl.innerHTML = renderContent(note);
        }

        // 套用字型樣式
        applyNoteStyle(el, note);

        // 彩色流光
        el.classList.toggle('rainbow-note', !!note.rainbow);

        // 渲染鬧鐘徽章
        renderAlarmBadge(el, note);
    }

    // ======== 渲染 AI 鬧鐘徽章 ========
    function renderAlarmBadge(el, note) {
        let badgeEl = el.querySelector('.ai-alarm-badge');
        
        if (note.needsClarification && note.clarificationQuestion) {
            if (!badgeEl) {
                badgeEl = document.createElement('div');
                badgeEl.className = 'ai-alarm-badge';
                el.appendChild(badgeEl);
            }
            badgeEl.innerHTML = `<i class="fa-solid fa-circle-question"></i> 反問`;
            badgeEl.title = note.clarificationQuestion;
            badgeEl.style.cursor = 'pointer';
            badgeEl.style.color = '#fff';
            badgeEl.style.background = 'rgba(231, 76, 60, 0.95)';
            badgeEl.onclick = (e) => {
                e.stopPropagation();
                const ans = prompt("系統詢問：" + note.clarificationQuestion);
                if (ans && ans.trim() !== '') {
                    // 將答案附掛上去重新解析
                    const newText = (note.content || '') + "\n(備註: " + ans + ")";
                    PostIt.Note.updateContent(note.id, newText);
                    if (typeof PostIt.AI !== 'undefined') {
                        PostIt.AI.parseIntent(newText).then(res => {
                            if(res && res.hasIntent) PostIt.Note.updateReminderLogic(note.id, res);
                        });
                    }
                }
            };
        } else if (note.alertTime && note.reminderStatus !== 'acknowledged') {
            if (!badgeEl) {
                badgeEl = document.createElement('div');
                badgeEl.className = 'ai-alarm-badge';
                el.appendChild(badgeEl);
            }
            const dt = new Date(note.alertTime);
            // 格式化為 HH:mm 顯示
            badgeEl.innerHTML = `<i class="fa-regular fa-clock"></i> ${dt.getHours()}:${dt.getMinutes().toString().padStart(2, '0')}`;
            if (note.aiReason) badgeEl.title = note.aiReason;
            badgeEl.style.cursor = 'default';
            badgeEl.style.color = 'rgba(231, 76, 60, 0.95)';
            badgeEl.style.background = 'rgba(255,255,255,0.85)';
            badgeEl.onclick = null;
        } else {
            if (badgeEl) badgeEl.remove();
        }

        // 當狀態變成已確認，主動消除抖動
        if (note.reminderStatus === 'acknowledged') {
            el.classList.remove('alarming');
        }
    }

    // ======== 渲染不同類型的內容 ========
    function renderContent(note) {
        if (!note.content) return '';

        const text = note.content.trim();

        if (note.role === 'ai') {
            const lines = text.split('\n');
            if (lines.length > 0) {
                const title = lines[0];
                const rest = lines.slice(1).join('\n');
                return `<div class="ai-note-header">${escapeHtml(title)}</div><div class="note-content-body">${escapeHtml(rest).replace(/\n/g, '<br>')}</div><i class="fa-solid fa-robot ai-robot-icon"></i>`;
            }
        }

        // 智慧判斷：如果整段內容純粹就是一個圖片網址，直接渲染為圖片
        const isImageUrl = /^https?:\/\/.*?\.(jpg|jpeg|png|gif|webp|svg|bmp)(?:\?.*)?$/i.test(text) || /^data:image\/[a-zA-Z0-9+]+;base64,/.test(text);
        if (isImageUrl) {
            return `<img src="${escapeHtml(text)}" alt="圖片" loading="lazy" draggable="false">`;
        }

        switch (note.type) {
            case 'url':
                // 嘗試顯示漂亮的連結
                try {
                    const url = new URL(text);
                    return `<a href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(text)}">${escapeHtml(url.hostname + url.pathname)}</a>`;
                } catch {
                    return `<a href="${escapeHtml(text)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
                }

            case 'image':
                return `<img src="${escapeHtml(text)}" alt="上傳的圖片" loading="lazy" draggable="false">`;

            default:
                return escapeHtml(text).replace(/\n/g, '<br>');
        }
    }

    // ======== 開始編輯 ========
    function startEditing(noteEl, noteId) {
        if (PostIt.Drag.getIsDragging()) return;

        const contentEl = noteEl.querySelector('.note-content');
        if (!contentEl) return;

        // 如果 note 還在 cache 中（可能是新建立尚未同步），允許繼續
        const note = PostIt.Note.getNote(noteId);
        // 圖片型不支持文字編輯（僅當 note 已載入時才判斷）
        if (note && note.type === 'image') return;
        // AI/系統公告便利貼不支持直接文字竄改
        if (note && note.role === 'ai') return;

        // 如果已經在編輯狀態中，不要重新設定以免覆蓋使用者正在輸入的內容並導致游標重製跳動
        if (contentEl.getAttribute('contenteditable') === 'true') return;

        // 設為可編輯
        contentEl.setAttribute('contenteditable', 'true');
        // 用 innerText 保留換行符
        contentEl.innerText = note?.content || '';
        contentEl.focus();

        // 游標移到最後
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        // 失焦時儲存
        const onBlur = async () => {
            contentEl.removeAttribute('contenteditable');
            // innerText 會保留 Shift+Enter 產生的換行
            const newContent = contentEl.innerText.trim();
            
            // 只有內容改變才更新並呼叫 AI
            if (newContent !== (note?.content || '')) {
                PostIt.Note.updateContent(noteId, newContent);
                
                // AI 背景語意解析
                if (typeof PostIt.AI !== 'undefined') {
                    const aiResult = await PostIt.AI.parseIntent(newContent);
                    if (aiResult && aiResult.hasIntent) {
                        PostIt.Note.updateReminderLogic(noteId, aiResult);
                    } else if (aiResult && aiResult.hasIntent === false && !aiResult.error) {
                        PostIt.Note.updateReminderLogic(noteId, null);
                    }
                }
            }

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

        // 更新單卡樣式設定
        document.getElementById('card-font-family').value = note.fontFamily || '';
        const fontSizeInput = document.getElementById('card-font-size');
        fontSizeInput.value = note.fontSize || '';
        fontSizeInput.placeholder = PostIt.Settings.getAccountSettings().fontSize || '20';

        const fontColorInput = document.getElementById('card-font-color');
        const effective = PostIt.Settings.getEffective(note);
        fontColorInput.value = rgbaToHex(note.fontColor || effective.fontColor);

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
    function showToast(message, type = 'info', action = null, duration = 4000) {
        // 移除既有 toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;
        toast.appendChild(msgSpan);

        // 如果有傳入動作（例如復原）
        if (action) {
            const btn = document.createElement('button');
            btn.className = 'toast-action-btn';
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                toast.classList.remove('visible');
                clearTimeout(toastTimer);
                setTimeout(() => toast.remove(), 400);
                action.onClick();
            });
            toast.appendChild(btn);
        }

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

    // ======== 多白板：側邊欄渲染 ========
    function renderSidebar(boards, activeBoardId) {
        const listEl = document.getElementById('sidebar-board-list');
        if (!listEl) return;
        listEl.innerHTML = '';

        // 依 order 排序
        const sorted = Object.values(boards).sort((a, b) => (a.order || 0) - (b.order || 0));

        sorted.forEach(board => {
            const item = document.createElement('div');
            item.className = 'sidebar-board-item' + (board.id === activeBoardId ? ' active' : '');
            item.dataset.boardId = board.id;
            item.style.setProperty('--board-color', board.color || '#4A90D9');
            item.title = board.name || '白板';

            item.innerHTML = `
                <span class="sidebar-board-icon">${board.icon || '📋'}</span>
                <span class="sidebar-board-name">${board.name || '白板'}</span>
                <button class="sidebar-board-edit" title="編輯"><i class="fa-solid fa-ellipsis"></i></button>
            `;

            // 點擊切換白板
            item.addEventListener('click', (e) => {
                if (e.target.closest('.sidebar-board-edit')) return;
                if (board.id !== PostIt.BoardModel.getActive()) {
                    PostIt.BoardModel.setActive(board.id);
                }
                
                // 收合手機版側邊欄
                const boardSidebar = document.getElementById('board-sidebar');
                const mobileOverlay = document.getElementById('mobile-sidebar-overlay');
                if (boardSidebar) boardSidebar.classList.remove('mobile-open');
                if (mobileOverlay) mobileOverlay.classList.remove('active');
            });

            // 編輯按鈕
            const editBtn = item.querySelector('.sidebar-board-edit');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openBoardModal(board.id);
            });

            listEl.appendChild(item);
        });
    }

    // ======== 多白板：白板切換 ========
    function onBoardSwitch(boardId) {
        // 1. 清空現有白板
        PostIt.Note.cleanup();
        clearBoard();

        // 2. 清空圖釘連線 SVG
        const svgEl = document.getElementById('connections-svg');
        if (svgEl) {
            svgEl.querySelectorAll('[data-conn-id]').forEach(g => g.remove());
        }

        // 3. 重新訂閱新白板的資料
        PostIt.Note.subscribe(renderNotes);

        // 4. 重新載入圖釘連線
        if (typeof PostIt.Connect !== 'undefined') PostIt.Connect.start();

        // 5. 更新側邊欄 UI
        const boards = PostIt.BoardModel.getAll();
        renderSidebar(boards, boardId);

        // 6. 顯示 Toast
        const board = PostIt.BoardModel.getBoard(boardId);
        if (board) {
            showToast(`已切換至「${board.icon} ${board.name}」`, 'info');
        }
    }

    // ======== 多白板：白板管理 Modal ========
    let editingBoardId = null;

    function openBoardModal(boardId = null) {
        editingBoardId = boardId;
        const modal = document.getElementById('board-modal');
        const overlay = document.getElementById('board-modal-overlay');
        const title = document.getElementById('board-modal-title');
        const nameInput = document.getElementById('board-name-input');
        const deleteBtn = document.getElementById('btn-delete-board');

        if (boardId) {
            // 編輯模式
            const board = PostIt.BoardModel.getBoard(boardId);
            title.innerHTML = '<i class="fa-solid fa-pen"></i> 編輯白板';
            nameInput.value = board ? board.name : '';
            deleteBtn.style.display = (boardId === PostIt.BoardModel.DEFAULT_BOARD_ID) ? 'none' : 'inline-flex';

            // 預選圖示
            document.querySelectorAll('#board-icon-picker .board-icon-option').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.icon === (board?.icon || '📌'));
            });
            // 預選顏色
            document.querySelectorAll('#board-color-picker .board-color-option').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.color === (board?.color || '#4A90D9'));
            });
        } else {
            // 新增模式
            title.innerHTML = '<i class="fa-solid fa-chalkboard"></i> 新增白板';
            nameInput.value = '';
            deleteBtn.style.display = 'none';
            // 重置選擇
            document.querySelectorAll('#board-icon-picker .board-icon-option').forEach((btn, i) => {
                btn.classList.toggle('active', i === 0);
            });
            document.querySelectorAll('#board-color-picker .board-color-option').forEach((btn, i) => {
                btn.classList.toggle('active', i === 0);
            });
        }

        modal.classList.add('visible');
        overlay.classList.add('visible');
        nameInput.focus();
    }

    function closeBoardModal() {
        editingBoardId = null;
        document.getElementById('board-modal').classList.remove('visible');
        document.getElementById('board-modal-overlay').classList.remove('visible');
    }

    // ======== 套用字型樣式到貼紙 ========
    function applyNoteStyle(el, note) {
        const style = PostIt.Settings.getEffective(note);
        const contentEl = el.querySelector('.note-content');
        if (!contentEl) return;

        contentEl.style.fontFamily = `'${style.fontFamily}', cursive`;
        contentEl.style.fontSize = style.fontSize + 'px';
        contentEl.style.color = style.fontColor;
    }

    // ======== 帳號控制台事件 ========
    function bindAccountSettingsEvents() {
        const modal = document.getElementById('account-modal');
        const overlay = document.getElementById('account-modal-overlay');
        const btnOpen = document.getElementById('btn-account-settings');
        const btnClose = document.getElementById('btn-close-account');
        const btnSave = document.getElementById('btn-save-account-settings');
        const btnReset = document.getElementById('btn-reset-account-settings');
        const fontFamily = document.getElementById('account-font-family');
        const fontSize = document.getElementById('account-font-size');
        const fontSizeValue = document.getElementById('account-font-size-value');
        const fontColorCustom = document.getElementById('account-font-color-custom');
        const previewText = document.getElementById('settings-preview-text');
        const previewBg = document.getElementById('settings-preview');

        let selectedFontColor = 'rgba(0,0,0,0.78)';
        let selectedNoteColor = '#FFF176';

        function openAccountModal() {
            const settings = PostIt.Settings.getAccountSettings();

            // 填充當前值
            fontFamily.value = settings.fontFamily || 'Caveat';
            fontSize.value = settings.fontSize || 20;
            fontSizeValue.textContent = (settings.fontSize || 20) + 'px';
            selectedFontColor = settings.fontColor || 'rgba(0,0,0,0.78)';
            selectedNoteColor = settings.defaultNoteColor || 'random';

            // 填充選定的背景
            const bgImageInput = document.getElementById('account-bg-image-url');
            if (bgImageInput) bgImageInput.value = settings.boardBgImage || '';

            // 填充 AI 金鑰 (如果為預設金鑰則不顯示)
            const aiKeyInput = document.getElementById('account-ai-key');
            aiKeyInput.value = PostIt.Settings.getAiKey() === 'AIzaSyA4rngnyQfawDPXU1W2clDtUHbrqHB8DnU' ? '' : PostIt.Settings.getAiKey();

            // 產生字體顏色色票
            renderFontColorSwatches();

            // 更新貼紙顏色選擇
            document.querySelectorAll('#account-note-color .color-swatch').forEach(s => {
                s.classList.toggle('active', s.dataset.color === selectedNoteColor);
            });

            // 更新預覽
            updatePreview();

            // 顯示 Modal
            modal.classList.add('visible');
            overlay.classList.add('visible');
        }

        function closeAccountModal() {
            modal.classList.remove('visible');
            overlay.classList.remove('visible');
            // 還原背景預覽（如果用戶沒按儲存就關閉）
            applyBoardBgImage(PostIt.Settings.getAccountSettings().boardBgImage);
        }

        function renderFontColorSwatches() {
            const container = document.getElementById('font-color-swatches');
            container.innerHTML = '';
            const presets = PostIt.Settings.getFontColorPresets();
            presets.forEach(color => {
                const swatch = document.createElement('button');
                swatch.className = 'font-color-swatch';
                swatch.style.backgroundColor = color;
                swatch.dataset.color = color;
                if (color === selectedFontColor) swatch.classList.add('active');
                swatch.addEventListener('click', () => {
                    selectedFontColor = color;
                    container.querySelectorAll('.font-color-swatch').forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    updatePreview();
                });
                container.appendChild(swatch);
            });
        }

        function updatePreview() {
            previewText.style.fontFamily = `'${fontFamily.value}', cursive`;
            previewText.style.fontSize = fontSize.value + 'px';
            previewText.style.color = selectedFontColor;
            
            if (selectedNoteColor === 'random') {
                // 預覽區遇到隨機時，預設顯示一個混和色彩或黃底作為代表
                previewBg.style.backgroundColor = '#FFF176';
            } else {
                previewBg.style.backgroundColor = selectedNoteColor;
            }
        }

        // 事件綁定
        btnOpen.addEventListener('click', openAccountModal);
        btnClose.addEventListener('click', closeAccountModal);
        overlay.addEventListener('click', closeAccountModal);

        fontFamily.addEventListener('change', updatePreview);
        fontSize.addEventListener('input', () => {
            fontSizeValue.textContent = fontSize.value + 'px';
            updatePreview();
        });

        fontColorCustom.addEventListener('input', (e) => {
            selectedFontColor = e.target.value;
            document.querySelectorAll('#font-color-swatches .font-color-swatch').forEach(s => s.classList.remove('active'));
            updatePreview();
        });

        // 貼紙顏色選擇
        document.querySelectorAll('#account-note-color .color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                selectedNoteColor = swatch.dataset.color;
                document.querySelectorAll('#account-note-color .color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                updatePreview();
            });
        });

        // 背景圖片的即時預覽（手動貼上網址）
        const bgImageInputLocal = document.getElementById('account-bg-image-url');
        if (bgImageInputLocal) {
            bgImageInputLocal.addEventListener('input', (e) => {
                applyBoardBgImage(e.target.value.trim());
            });
        }

        // 白板背景上傳
        const btnUploadBg = document.getElementById('btn-upload-bg-image');
        const bgFileInput = document.getElementById('bg-file-input');
        if (btnUploadBg && bgFileInput) {
            btnUploadBg.addEventListener('click', () => bgFileInput.click());
            bgFileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const uid = PostIt.Auth.getUid();
                if (!uid) return;

                // 檢查檔案大小（最大 5MB）
                if (file.size > 5 * 1024 * 1024) {
                    showToast('圖片太大了，最多 5MB', 'error');
                    return;
                }

                showToast('背景上傳中...⏳');
                try {
                    let ext = 'jpg';
                    if (file.name && file.name.includes('.')) ext = file.name.split('.').pop();
                    else if (file.type) ext = file.type.split('/').pop();

                    const timestamp = Date.now();
                    const storagePath = `users/${uid}/postit/bg_${timestamp}.${ext}`;
                    const storageRef = PostIt.Firebase.getStorage().ref(storagePath);
                    const snapshot = await storageRef.put(file);
                    const downloadURL = await snapshot.ref.getDownloadURL();

                    document.getElementById('account-bg-image-url').value = downloadURL;
                    applyBoardBgImage(downloadURL); // 即時套用預覽

                    // 自動儲存到設定檔
                    await PostIt.Settings.save({ boardBgImage: downloadURL });
                    
                    showToast('背景上傳成功！✅', 'success');
                } catch (error) {
                    console.error('上傳背景失敗:', error);
                    showToast('上傳失敗', 'error');
                }
            });
        }

        // 儲存
        btnSave.addEventListener('click', async () => {
            try {
                // 儲存 AI Key (本地)
                const aiKeyInput = document.getElementById('account-ai-key');
                PostIt.Settings.setAiKey(aiKeyInput.value);

                // 儲存其他設定 (雲端)
                const bgImageUrl = document.getElementById('account-bg-image-url') ? document.getElementById('account-bg-image-url').value.trim() : '';
                await PostIt.Settings.save({
                    fontFamily: fontFamily.value,
                    fontSize: parseInt(fontSize.value),
                    fontColor: selectedFontColor,
                    defaultNoteColor: selectedNoteColor,
                    boardBgImage: bgImageUrl
                });
                
                // 套用到 UI
                applyBoardBgImage(bgImageUrl);
                showToast('帳號設定已儲存 ✅', 'success');
                closeAccountModal();
                // 重新渲染所有貼紙以套用新預設
                renderNotes(PostIt.Note.getCache());
            } catch (err) {
                showToast('儲存失敗，請再試一次', 'error');
            }
        });

        // 重設
        btnReset.addEventListener('click', async () => {
            try {
                await PostIt.Settings.reset();
                showToast('已重設為系統預設 ↩️');
                openAccountModal(); // 重新填充 UI
                applyBoardBgImage('');
                renderNotes(PostIt.Note.getCache());
            } catch (err) {
                showToast('重設失敗', 'error');
            }
        });
    }

    // ======== 單卡樣式設定事件 ========
    function bindCardStyleEvents() {
        const cardFontFamily = document.getElementById('card-font-family');
        const cardFontSize = document.getElementById('card-font-size');
        const cardFontColor = document.getElementById('card-font-color');
        const btnResetCard = document.getElementById('btn-reset-card-style');

        // 字型變更
        cardFontFamily.addEventListener('change', () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                PostIt.Note.updateStyle(noteId, { fontFamily: cardFontFamily.value || null });
            }
        });

        // 字體大小變更
        cardFontSize.addEventListener('change', () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                const val = cardFontSize.value ? parseInt(cardFontSize.value) : null;
                PostIt.Note.updateStyle(noteId, { fontSize: val });
            }
        });

        // 字體顏色變更
        cardFontColor.addEventListener('input', () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                PostIt.Note.updateStyle(noteId, { fontColor: cardFontColor.value });
            }
        });

        // 重設單卡樣式
        btnResetCard.addEventListener('click', () => {
            const noteId = PostIt.Note.getActiveNoteId();
            if (noteId) {
                PostIt.Note.updateStyle(noteId, { fontFamily: null, fontSize: null, fontColor: null });
                // 重設 UI
                cardFontFamily.value = '';
                cardFontSize.value = '';
                cardFontColor.value = rgbaToHex(PostIt.Settings.getAccountSettings().fontColor || 'rgba(0,0,0,0.78)');
                showToast('已重設為帳號預設');
            }
        });
    }

    // ======== rgba 轉 hex 工具 ========
    function rgbaToHex(rgba) {
        if (!rgba) return '#000000';
        if (rgba.startsWith('#')) return rgba;
        // 解析 rgba/rgb
        const match = rgba.match(/[\d.]+/g);
        if (!match || match.length < 3) return '#000000';
        const r = Math.round(parseFloat(match[0]));
        const g = Math.round(parseFloat(match[1]));
        const b = Math.round(parseFloat(match[2]));
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // ======== 歷史歸檔區事件綁定 ========
    function bindArchiveModalEvents() {
        const btnViewArchive = document.getElementById('btn-view-archive');
        const archiveModal = document.getElementById('archive-modal');
        const overlay = document.getElementById('archive-modal-overlay');
        const btnClose = document.getElementById('btn-close-archive');
        const grid = document.getElementById('archive-grid');

        if (!btnViewArchive || !archiveModal) return;

        const openArchive = async () => {
            overlay.classList.remove('hidden');
            archiveModal.classList.add('visible');
            await renderArchiveGrid();
        };

        const closeArchive = () => {
            archiveModal.classList.remove('visible');
            overlay.classList.add('hidden');
        };

        btnViewArchive.addEventListener('click', openArchive);
        btnClose.addEventListener('click', closeArchive);
        overlay.addEventListener('click', closeArchive);

        // 渲染歸檔清單
        async function renderArchiveGrid() {
            grid.innerHTML = '<div class="archive-empty-state">載入中...</div>';
            const notes = await PostIt.Note.getArchivedNotes();

            if (notes.length === 0) {
                grid.innerHTML = '<div class="archive-empty-state">目前沒有任何已完成的歷史紀錄。</div>';
                return;
            }

            grid.innerHTML = '';
            notes.forEach(noteData => {
                const card = document.createElement('div');
                card.className = 'archived-note-card';
                card.style.setProperty('--note-color', noteData.color || '#FFF176');
                
                // 嘗試套用字型設定
                const settings = PostIt.Settings.getAccountSettings();
                const effectiveFont = noteData.fontFamily || settings.fontFamily || 'Caveat';
                const effectiveSize = (noteData.fontSize || settings.fontSize || 20) + 'px';
                const effectiveColor = noteData.fontColor || settings.fontColor || 'rgba(0,0,0,0.78)';
                
                card.style.setProperty('--font-family', `"${effectiveFont}", cursive`);
                card.style.setProperty('--font-size', effectiveSize);
                card.style.setProperty('--font-color', effectiveColor);

                // 日期格式化
                const dateRaw = noteData.completedAt ? noteData.completedAt.toDate() : new Date();
                const dateStr = dateRaw.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                card.innerHTML = `
                    <div class="archived-content">${noteData.content || ''}</div>
                    <div class="archived-footer">
                        <span class="archived-date">${dateStr}</span>
                        <div class="archived-actions">
                            <button class="btn-archive-action btn-archive-restore" data-id="${noteData.archiveId}" title="復原至白板">
                                <i class="fa-solid fa-rotate-left"></i>
                            </button>
                            <button class="btn-archive-action btn-archive-delete" data-id="${noteData.archiveId}" title="永久刪除">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
            });

            // 綁定動態卡片按鈕事件
            grid.querySelectorAll('.btn-archive-restore').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.dataset.id;
                    const card = e.currentTarget.closest('.archived-note-card');
                    card.style.opacity = '0.5';
                    await PostIt.Note.unarchive(id);
                    await renderArchiveGrid(); // 重新渲染
                    showToast('已復原至白板！', 'success');
                });
            });

            grid.querySelectorAll('.btn-archive-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    if (!confirm('確定要永久刪除這筆紀錄嗎？這無法復原喔！')) return;
                    
                    const id = e.currentTarget.dataset.id;
                    const card = e.currentTarget.closest('.archived-note-card');
                    card.style.opacity = '0.5';
                    await PostIt.Note.deleteArchive(id);
                    await renderArchiveGrid(); // 重新渲染
                    showToast('已永久刪除。');
                });
            });
        }
    }

    // ======== 依據設定套用白板背景 ========
    function applyBoardBgImage(url) {
        if (!boardEl) return;
        if (url) {
            // 背景載入機制：避免畫面全白讓使用者誤以為遺失
            const img = new Image();
            img.onload = () => {
                // 加入 35% 的黑色半透明遮罩，壓暗過度鮮豔的圖片與降低紋理噪聲，藉此凸顯前景便利貼
                boardEl.style.setProperty('background-image', `linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35)), url("${url}")`, 'important');
                boardEl.style.setProperty('background-size', 'cover', 'important');
                boardEl.style.setProperty('background-position', 'center', 'important');
                boardEl.style.setProperty('background-repeat', 'no-repeat', 'important');
            };
            img.onerror = () => {
                console.warn('[Board] 背景圖片載入失敗:', url);
                boardEl.style.removeProperty('background-image');
            };
            img.src = url;
            
        } else {
            // 清除，恢復 style.css 中擬真的預設背景設定
            boardEl.style.removeProperty('background-image');
            boardEl.style.removeProperty('background-size');
            boardEl.style.removeProperty('background-position');
            boardEl.style.removeProperty('background-repeat');
        }
    }

    return { init, showToast, handleResize, openBoardModal, closeBoardModal, get _editingBoardId() { return editingBoardId; } };
})();

// ======== 多白板 UI 事件 (在模組外部綁定，等 DOM Ready) ========
document.addEventListener('DOMContentLoaded', () => {
    // 側邊欄展開/收合
    const sidebar = document.getElementById('board-sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('expanded');
        });
    }

    // 新增白板按鈕
    const sidebarAddBtn = document.getElementById('sidebar-add-btn');
    if (sidebarAddBtn) {
        sidebarAddBtn.addEventListener('click', () => {
            // 展開 Modal（openBoardModal 在 Board IIFE 內部，需要透過公開方法）
            if (typeof PostIt.Board.openBoardModal === 'function') {
                PostIt.Board.openBoardModal(null);
            }
        });
    }

    // 白板 Modal 事件
    const btnCloseBoardModal = document.getElementById('btn-close-board-modal');
    const boardModalOverlay = document.getElementById('board-modal-overlay');
    const btnSaveBoard = document.getElementById('btn-save-board');
    const btnDeleteBoard = document.getElementById('btn-delete-board');

    if (btnCloseBoardModal) {
        btnCloseBoardModal.addEventListener('click', () => {
            if (typeof PostIt.Board.closeBoardModal === 'function') PostIt.Board.closeBoardModal();
        });
    }
    if (boardModalOverlay) {
        boardModalOverlay.addEventListener('click', () => {
            if (typeof PostIt.Board.closeBoardModal === 'function') PostIt.Board.closeBoardModal();
        });
    }

    // 圖示選擇器
    document.querySelectorAll('#board-icon-picker .board-icon-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#board-icon-picker .board-icon-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // 顏色選擇器
    document.querySelectorAll('#board-color-picker .board-color-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#board-color-picker .board-color-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // 儲存白板
    if (btnSaveBoard) {
        btnSaveBoard.addEventListener('click', async () => {
            const name = document.getElementById('board-name-input').value.trim();
            if (!name) {
                PostIt.Board.showToast('請輸入白板名稱', 'error');
                return;
            }

            const activeIcon = document.querySelector('#board-icon-picker .board-icon-option.active');
            const activeColor = document.querySelector('#board-color-picker .board-color-option.active');
            const icon = activeIcon ? activeIcon.dataset.icon : '📌';
            const color = activeColor ? activeColor.dataset.color : '#4A90D9';

            if (PostIt.Board._editingBoardId) {
                // 更新
                await PostIt.BoardModel.update(PostIt.Board._editingBoardId, { name, icon, color });
                PostIt.Board.showToast('白板已更新 ✅', 'success');
            } else {
                // 新增
                const newId = await PostIt.BoardModel.create(name, icon, color);
                if (newId) {
                    PostIt.Board.showToast(`白板「${icon} ${name}」已建立 ✅`, 'success');
                    PostIt.BoardModel.setActive(newId);
                }
            }
            PostIt.Board.closeBoardModal();
        });
    }

    // 刪除白板
    if (btnDeleteBoard) {
        btnDeleteBoard.addEventListener('click', async () => {
            if (!PostIt.Board._editingBoardId) return;
            const board = PostIt.BoardModel.getBoard(PostIt.Board._editingBoardId);
            if (!confirm(`確定要刪除「${board?.name || '白板'}」嗎？所有貼紙都會被永久刪除！`)) return;

            await PostIt.BoardModel.remove(PostIt.Board._editingBoardId);
            PostIt.Board.closeBoardModal();
        });
    }
});
