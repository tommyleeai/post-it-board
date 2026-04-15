// ============================================
// 拖曳引擎 — Pointer Events
// ============================================
PostIt.Drag = (function () {
    'use strict';

    let isDragging = false;
    let dragTarget = null;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;
    let maxZIndex = 10;
    let justDragged = false;

    // 拖曳開始的最小距離（避免誤觸）
    const DRAG_THRESHOLD = 5;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let touchTarget = null;
    function init() {
        const board = document.getElementById('whiteboard');
        if (!board) return;

        board.addEventListener('pointerdown', onPointerDown, { passive: false });
        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerUp);

        board.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
            touchTarget = e.target.closest('.sticky-note');
        }, {passive: true});

        board.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            handleSwipeGesture();
        }, {passive: true});
    }

    let pointerId = null;
    let clickedOnContent = false;

    function onPointerDown(e) {
        // [行動端防護] 手機瀑布流模式下不允許自由拖曳，以保證預設的上下滑動體驗
        if (window.innerWidth <= 768) return;

        // 只處理貼紙本體（排除設定按鈕和編輯中的內容）
        const note = e.target.closest('.sticky-note');
        if (!note) return;

        // 如果點的是設定按鈕或垃圾桶，不拖曳
        if (e.target.closest('.note-settings-trigger')) return;
        if (e.target.closest('.note-delete-btn')) return;

        // 如果正在編輯（contenteditable），不啟動拖曳
        const content = note.querySelector('.note-content');
        if (content && content.getAttribute('contenteditable') === 'true') {
            if (e.target.closest('.note-content')) return;
        }

        // 判斷是否點擊在內容區域（需要讓雙擊編輯能運作）
        clickedOnContent = !!e.target.closest('.note-content');

        // 如果不是點在內容區域，立即阻止預設行為
        if (!clickedOnContent) {
            e.preventDefault();
        }

        const noteRect = note.getBoundingClientRect();

        // 記錄起點
        startX = e.clientX;
        startY = e.clientY;
        hasMoved = false;
        pointerId = e.pointerId;

        // 計算滑鼠在貼紙內的偏移
        offsetX = e.clientX - noteRect.left;
        offsetY = e.clientY - noteRect.top;

        dragTarget = note;

        // 點下瞬間立刻飄起來（不等移動門檻）
        maxZIndex++;
        note.style.zIndex = maxZIndex;
        note.classList.add('dragging');

        // 群組長按偵測
        if (typeof PostIt.Group !== 'undefined') {
            PostIt.Group.startLongPress(note, e.clientX, e.clientY);
        }

        // 不在這裡 setPointerCapture — 等超過門檻再捕獲
    }

    function onPointerMove(e) {
        if (!dragTarget) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        // 判斷是否超過拖曳門檻
        if (!hasMoved) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
            hasMoved = true;
            isDragging = true;

            // 超過門檻才捕獲 pointer 和阻止預設行為
            if (pointerId !== null) {
                try { dragTarget.setPointerCapture(pointerId); } catch (_) {}
            }

            // 如果是從內容區域開始拖曳，取消編輯焦點
            if (clickedOnContent) {
                const content = dragTarget.querySelector('.note-content');
                if (content) content.blur();
            }

            // 提升 z-index（已在 pointerdown 做了，這裡不重複）
        }

        e.preventDefault();

        // 群組長按移動取消判定
        if (typeof PostIt.Group !== 'undefined') {
            PostIt.Group.checkLongPressMove(e.clientX, e.clientY);
        }

        const board = document.getElementById('whiteboard');
        const boardRect = board.getBoundingClientRect();

        // 計算新位置（相對於白板）
        let newX = e.clientX - boardRect.left - offsetX;
        let newY = e.clientY - boardRect.top - offsetY;

        // 邊界限制
        const noteW = dragTarget.offsetWidth;
        const noteH = dragTarget.offsetHeight;
        newX = Math.max(0, Math.min(newX, boardRect.width - noteW));
        newY = Math.max(0, Math.min(newY, boardRect.height - noteH));

        dragTarget.style.left = newX + 'px';
        dragTarget.style.top = newY + 'px';

        // 群組重疊偵測 + 吸附跟隨
        if (typeof PostIt.Group !== 'undefined') {
            // 檢查是否有可合併的便利貼
            PostIt.Group.checkOverlap(dragTarget);
            // 如果有已吸附的便利貼，跟隨拖曳
            if (PostIt.Group.hasAttached()) {
                PostIt.Group.moveAttached(dragTarget);
            }
            // 如果拖曳的是群組頂層，整組跟隨
            const noteId = dragTarget.dataset.noteId;
            const noteData = PostIt.Note.getNote(noteId);
            if (noteData && noteData.groupId && !PostIt.Group.hasAttached()) {
                PostIt.Group.moveGroupMembers(noteData.groupId, dragTarget);
            }
        }
    }

    async function onPointerUp(e) {
        if (!dragTarget) return;

        const note = dragTarget;
        const wasDragging = hasMoved;

        // 取消長按計時器
        if (typeof PostIt.Group !== 'undefined') {
            PostIt.Group.cancelLongPress();
        }

        note.classList.remove('dragging');
        isDragging = false;
        dragTarget = null;
        hasMoved = false;

        // 群組合併完成
        if (typeof PostIt.Group !== 'undefined' && PostIt.Group.hasAttached()) {
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 100);
            await PostIt.Group.finalizeMerge(note);
            PostIt.Group.clearMergeState();
            return;
        }

        // 如果有移動，儲存位置
        if (wasDragging) {
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 100);
            saveNotePosition(note);

            // 如果是群組的拖曳，儲存整組位置
            const noteId = note.dataset.noteId;
            const noteData = PostIt.Note.getNote(noteId);
            if (noteData && noteData.groupId && typeof PostIt.Group !== 'undefined') {
                PostIt.Group.saveGroupPositions(noteData.groupId, note);
            }
        }
    }

    function saveNotePosition(noteEl) {
        const noteId = noteEl.dataset.noteId;
        if (!noteId) return;

        const board = document.getElementById('whiteboard');
        const boardRect = board.getBoundingClientRect();

        // 轉換為百分比
        const xPercent = (parseFloat(noteEl.style.left) / boardRect.width) * 100;
        const yPercent = (parseFloat(noteEl.style.top) / boardRect.height) * 100;

        // 儲存到 Firestore
        PostIt.Note.updatePosition(noteId, xPercent, yPercent, maxZIndex);
    }

    function getMaxZIndex() {
        return maxZIndex;
    }

    function setMaxZIndex(val) {
        if (val > maxZIndex) maxZIndex = val;
    }

    function getIsDragging() {
        return isDragging || justDragged;
    }

    function handleSwipeGesture() {
        if (window.innerWidth > 768 || !touchTarget) return;
        
        const dx = touchEndX - touchStartX;
        const dy = Math.abs(touchEndY - touchStartY);
        
        // 確保是純粹的水平滑動 (X軸位移大於Y軸，且X軸滑動距離超過100px)
        if (Math.abs(dx) > 100 && dy < 50) {
            if (dx < -100) {
                // Swipe Left: 蓋上完成印章並歸檔
                const noteId = touchTarget.dataset.noteId;
                const noteEl = touchTarget;
                if (!noteId || !PostIt.Note) return;

                if (typeof window.showToast === 'function') window.showToast('🔥 偵測到向左滑動：觸發歸檔！', 'success');
                
                // 建立印章 DOM 與動畫
                const overlay = document.createElement('div');
                overlay.className = 'note-stamp-overlay';
                const stamp = document.createElement('div');
                stamp.className = 'note-stamp';
                stamp.textContent = '已完成';
                overlay.appendChild(stamp);
                noteEl.appendChild(overlay);

                requestAnimationFrame(() => stamp.classList.add('stamping'));

                // 配合原本的 CSS 動畫節奏（board_v2.js）
                setTimeout(() => noteEl.classList.add('stamped-archiving'), 600);
                setTimeout(async () => {
                    const archiveId = await PostIt.Note.archive(noteId);
                    if (archiveId && typeof window.showToast === 'function') {
                        window.showToast('已完成！貼紙已歸檔 ✅', 'success', {
                            label: '復原',
                            onClick: async () => {
                                await PostIt.Note.unarchive(archiveId);
                                window.showToast('已復原歸檔貼紙', 'info');
                            }
                        });
                    }
                }, 2400);

            } else if (dx > 100) {
                // Swipe Right: 切換 Tab
                if (typeof window.showToast === 'function') window.showToast('✨ 偵測到向右滑動：切換標籤！', 'info');
                
                // 自動循環切換 .mobile-tab-btn
                const tabs = Array.from(document.querySelectorAll('.mobile-tab-btn'));
                if (tabs.length > 0) {
                    const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
                    if (activeIdx !== -1) {
                        const nextIdx = (activeIdx + 1) % tabs.length;
                        tabs[nextIdx].click();
                    } else {
                        tabs[0].click();
                    }
                }
            }
        }
    }

    return { init, getMaxZIndex, setMaxZIndex, getIsDragging, getDragTarget: () => dragTarget };
})();
