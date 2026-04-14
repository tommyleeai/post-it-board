// ============================================
// 群組互動引擎 (Group Interaction Engine)
// ============================================
// 管理便利貼的合併偵測、吸附動畫、撲克牌展開、拆分
PostIt.Group = (function () {
    'use strict';

    // ======== 狀態變數 ========
    let mergeTarget = null;          // 目前被偵測到可合併的便利貼 DOM
    let mergeTimer = null;           // 合併意圖計時器（0.3s）
    let attachedNotes = [];          // 已吸附在拖曳目標上的便利貼 IDs
    let attachedMoved = false;       // 吸附後是否已移動超過 50px
    let attachOrigin = { x: 0, y: 0 }; // 吸附時的起點位置

    let expandedGroupId = null;      // 目前展開中的群組 ID
    let expandedOriginalPos = {};    // 展開前各便利貼的原始位置
    let longPressTimer = null;       // 長按計時器（1.2s）
    let longPressStart = { x: 0, y: 0 }; // 長按起點
    let longPressNoteEl = null;      // 長按的便利貼 DOM

    let contextMenuEl = null;        // 右鍵選單 DOM
    let overlayEl = null;            // 暗幕 DOM

    const MERGE_THRESHOLD = 0.65;    // 重疊度門檻 (65%)
    const MERGE_DWELL = 300;         // 停留時間 (ms)
    const ATTACH_MOVE_THRESHOLD = 50; // 吸附後移動門檻 (px)
    const LONG_PRESS_DURATION = 1200; // 長按展開時間 (ms)
    const LONG_PRESS_MOVE_CANCEL = 5; // 長按移動取消門檻 (px)
    const FAN_DETACH_THRESHOLD = 100; // 展開後拖出拆分門檻 (px)

    let lastOverlapCheck = 0;        // 節流：上次重疊檢查時間
    const OVERLAP_CHECK_INTERVAL = 50; // 節流間隔 (ms)

    // ======== 初始化 ========
    function init() {
        // 建立暗幕 DOM
        overlayEl = document.getElementById('group-overlay');
        if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.id = 'group-overlay';
            overlayEl.className = 'group-overlay';
            document.body.appendChild(overlayEl);
        }
        overlayEl.addEventListener('click', collapseGroup);

        // 建立右鍵選單 DOM
        contextMenuEl = document.createElement('div');
        contextMenuEl.className = 'group-context-menu';
        contextMenuEl.innerHTML = `
            <button class="group-context-menu-item" data-action="expand">
                <i class="fa-solid fa-layer-group"></i> 展開群組
            </button>
            <div class="group-context-menu-divider"></div>
            <button class="group-context-menu-item" data-action="disband">
                <i class="fa-solid fa-object-ungroup"></i> 解散群組
            </button>
        `;
        document.body.appendChild(contextMenuEl);

        // 右鍵選單事件
        contextMenuEl.querySelectorAll('.group-context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                const groupId = contextMenuEl.dataset.groupId;
                hideContextMenu();
                if (action === 'expand' && groupId) expandGroup(groupId);
                if (action === 'disband' && groupId) {
                    PostIt.Note.disbandGroup(groupId);
                    if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_disband');
                    PostIt.Board.showToast('群組已解散');
                }
            });
        });

        // 全域點擊隱藏右鍵選單
        document.addEventListener('click', hideContextMenu);

        // ESC 關閉展開/右鍵選單
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (expandedGroupId) collapseGroup();
                hideContextMenu();
            }
        });

        // 右鍵選單（在 whiteboard 上監聽）
        const board = document.getElementById('whiteboard');
        if (board) {
            board.addEventListener('contextmenu', onContextMenu);
        }
    }

    // ================================================================
    // 合併偵測（在 drag.js 的 onPointerMove 中被呼叫）
    // ================================================================

    function checkOverlap(dragEl) {
        if (!dragEl) return;

        // 節流
        const now = Date.now();
        if (now - lastOverlapCheck < OVERLAP_CHECK_INTERVAL) return;
        lastOverlapCheck = now;

        const dragRect = dragEl.getBoundingClientRect();
        const dragId = dragEl.dataset.noteId;

        let bestTarget = null;
        let bestIoS = 0;

        // 找最佳重疊目標
        document.querySelectorAll('.sticky-note').forEach(el => {
            if (el === dragEl) return;
            const elId = el.dataset.noteId;
            // 如果已經在同一群組，跳過
            const dragNote = PostIt.Note.getNote(dragId);
            const elNote = PostIt.Note.getNote(elId);
            if (dragNote && elNote && dragNote.groupId && dragNote.groupId === elNote.groupId) return;
            // 已吸附的跳過
            if (attachedNotes.includes(elId)) return;
            // 被隱藏的群組成員跳過（group-hidden class 的便利貼不覆蓋在上面）
            if (el.classList.contains('group-hidden')) return;

            const elRect = el.getBoundingClientRect();
            const ios = calcIoS(dragRect, elRect);

            if (ios > bestIoS) {
                bestIoS = ios;
                bestTarget = el;
            }
        });

        // 判斷是否達到門檻
        if (bestTarget && bestIoS >= MERGE_THRESHOLD) {
            if (mergeTarget !== bestTarget) {
                // 切換目標
                clearMergeState();
                mergeTarget = bestTarget;
                mergeTarget.classList.add('group-merge-target');
                if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_hover');

                // 啟動停留計時器
                mergeTimer = setTimeout(() => {
                    // 0.3s 到期 → 吸附！
                    performAttach(dragEl, mergeTarget);
                }, MERGE_DWELL);
            }
            // 如果目標沒變，計時器繼續跑
        } else {
            // 離開重疊區
            if (mergeTarget) {
                clearMergeState();
            }
        }
    }

    // 計算 Intersection over Smaller area
    function calcIoS(rectA, rectB) {
        const interLeft = Math.max(rectA.left, rectB.left);
        const interTop = Math.max(rectA.top, rectB.top);
        const interRight = Math.min(rectA.right, rectB.right);
        const interBottom = Math.min(rectA.bottom, rectB.bottom);

        const interW = Math.max(0, interRight - interLeft);
        const interH = Math.max(0, interBottom - interTop);
        const interArea = interW * interH;

        if (interArea === 0) return 0;

        const areaA = rectA.width * rectA.height;
        const areaB = rectB.width * rectB.height;
        const smaller = Math.min(areaA, areaB);

        return smaller > 0 ? interArea / smaller : 0;
    }

    // 清除合併偵測狀態
    function clearMergeState() {
        if (mergeTimer) {
            clearTimeout(mergeTimer);
            mergeTimer = null;
        }
        if (mergeTarget) {
            mergeTarget.classList.remove('group-merge-target');
            mergeTarget = null;
        }
    }

    // ================================================================
    // 吸附動畫
    // ================================================================

    function performAttach(dragEl, targetEl) {
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_snap');

        const targetId = targetEl.dataset.noteId;
        const targetNote = PostIt.Note.getNote(targetId);

        // 如果目標是群組，收集所有群組成員
        let attachIds = [];
        if (targetNote && targetNote.groupId) {
            const members = PostIt.Note.getGroupNotes(targetNote.groupId);
            attachIds = members.map(m => m.id);
        } else {
            attachIds = [targetId];
        }

        attachedNotes = attachIds;
        attachedMoved = false;
        attachOrigin = { x: parseFloat(dragEl.style.left), y: parseFloat(dragEl.style.top) };

        // 吸附動畫：目標便利貼飛向拖曳中的便利貼
        attachIds.forEach(id => {
            const el = document.querySelector(`[data-note-id="${id}"]`);
            if (!el) return;
            el.classList.add('group-attaching');
            el.style.left = dragEl.style.left;
            el.style.top = dragEl.style.top;
            // 微偏移
            const offset = (Math.random() - 0.5) * 6;
            el.style.transform = `rotate(${offset}deg) scale(0.98)`;
        });

        // 動畫完成後移除 transition class
        setTimeout(() => {
            attachIds.forEach(id => {
                const el = document.querySelector(`[data-note-id="${id}"]`);
                if (el) el.classList.remove('group-attaching');
            });
        }, 300);

        // 清除合併目標發光
        targetEl.classList.remove('group-merge-target');
        mergeTarget = null;
    }

    // 整組跟隨拖曳
    function moveAttached(dragEl, dx, dy) {
        if (attachedNotes.length === 0) return;

        if (!attachedMoved) {
            const dist = Math.sqrt(
                Math.pow(parseFloat(dragEl.style.left) - attachOrigin.x, 2) +
                Math.pow(parseFloat(dragEl.style.top) - attachOrigin.y, 2)
            );
            if (dist < ATTACH_MOVE_THRESHOLD) return;
            attachedMoved = true;
        }

        // 所有已吸附的跟隨拖曳目標
        attachedNotes.forEach(id => {
            const el = document.querySelector(`[data-note-id="${id}"]`);
            if (el) {
                const offset = (Math.random() - 0.5) * 4;
                el.style.left = (parseFloat(dragEl.style.left) + offset) + 'px';
                el.style.top = (parseFloat(dragEl.style.top) + offset) + 'px';
            }
        });
    }

    // 完成合併（pointerup 時呼叫）
    async function finalizeMerge(dragEl) {
        if (attachedNotes.length === 0) return false;

        const dragId = dragEl.dataset.noteId;
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_land');

        // 呼叫資料層合併
        // 先取第一個吸附的便利貼作為合併對象
        const firstAttachedId = attachedNotes[0];
        const result = await PostIt.Note.mergeToGroup(dragId, firstAttachedId);

        // 清除吸附狀態
        attachedNotes = [];
        attachedMoved = false;
        clearMergeState();

        return !!result;
    }

    // 是否有吸附中的便利貼
    function hasAttached() {
        return attachedNotes.length > 0;
    }

    // 取消合併（拖曳過程中按 ESC 等）
    function cancelMerge() {
        clearMergeState();
        attachedNotes = [];
        attachedMoved = false;
    }

    // ================================================================
    // 長按展開
    // ================================================================

    function startLongPress(noteEl, x, y) {
        // 只對群組便利貼生效
        const noteId = noteEl.dataset.noteId;
        const note = PostIt.Note.getNote(noteId);
        if (!note || !note.groupId) return;

        // 如果群組只有 1 張（不應出現但防呆），不展開
        const members = PostIt.Note.getGroupNotes(note.groupId);
        if (members.length < 2) return;

        longPressNoteEl = noteEl;
        longPressStart = { x, y };

        longPressTimer = setTimeout(() => {
            expandGroup(note.groupId);
        }, LONG_PRESS_DURATION);
    }

    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        longPressNoteEl = null;
    }

    function checkLongPressMove(x, y) {
        if (!longPressTimer) return;
        const dist = Math.sqrt(
            Math.pow(x - longPressStart.x, 2) +
            Math.pow(y - longPressStart.y, 2)
        );
        if (dist > LONG_PRESS_MOVE_CANCEL) {
            cancelLongPress();
        }
    }

    // ================================================================
    // 撲克牌展開
    // ================================================================

    function expandGroup(groupId) {
        if (expandedGroupId) collapseGroup(); // 先收合之前的
        cancelLongPress();

        const members = PostIt.Note.getGroupNotes(groupId);
        if (members.length < 2) return;

        expandedGroupId = groupId;
        expandedOriginalPos = {};

        // 啟動暗幕
        overlayEl.classList.add('active');

        // 計算撲克牌展開位置
        const board = document.getElementById('whiteboard');
        const boardRect = board.getBoundingClientRect();
        const viewWidth = boardRect.width;
        const viewHeight = boardRect.height;
        const noteW = 320; // var(--note-min-w) 的值

        // overlapFactor：越多越密
        const n = members.length;
        const overlapFactor = Math.max(0.35, 1 - (n - 1) * 0.08);
        const stepX = noteW * overlapFactor;
        const totalW = stepX * (n - 1) + noteW;

        // 置中
        const startX = (viewWidth - totalW) / 2;
        const centerY = (viewHeight - 280) / 2; // 280 ≈ 便利貼高度

        // 播放展開音效
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_fan', n);

        members.forEach((member, i) => {
            const el = document.querySelector(`[data-note-id="${member.id}"]`);
            if (!el) return;

            // 儲存原始位置
            expandedOriginalPos[member.id] = {
                left: el.style.left,
                top: el.style.top,
                transform: el.style.transform,
                zIndex: el.style.zIndex
            };

            // 移除群組隱藏狀態
            el.classList.remove('group-hidden', 'group-stacked');
            el.removeAttribute('data-group-count');
            el.querySelectorAll('.group-count-badge').forEach(b => b.remove());

            // 延遲動畫（staggered）
            setTimeout(() => {
                el.classList.add('group-expanded');
                el.style.left = (startX + i * stepX) + 'px';
                el.style.top = centerY + 'px';
                // 微旋轉
                const rotation = (i - (n - 1) / 2) * 2; // -4° ~ +4°
                el.style.transform = `rotate(${rotation}deg)`;
                el.style.zIndex = 900001 + i;
            }, i * 50);
        });

        // 展開狀態下綁定便利貼拖出拆分事件
        setTimeout(() => {
            members.forEach(member => {
                const el = document.querySelector(`[data-note-id="${member.id}"]`);
                if (el) {
                    el._groupDragHandler = createFanDragHandler(el, member.id, groupId);
                    el.addEventListener('pointerdown', el._groupDragHandler);
                }
            });
        }, members.length * 50 + 400);
    }

    // 收合群組
    function collapseGroup() {
        if (!expandedGroupId) return;

        const groupId = expandedGroupId;
        const members = PostIt.Note.getGroupNotes(groupId);

        // 播放收合音效
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_collapse', members.length);

        // 暗幕消失
        overlayEl.classList.remove('active');

        // 收合動畫
        members.forEach(member => {
            const el = document.querySelector(`[data-note-id="${member.id}"]`);
            if (!el) return;

            // 清除展開事件
            if (el._groupDragHandler) {
                el.removeEventListener('pointerdown', el._groupDragHandler);
                delete el._groupDragHandler;
            }

            el.classList.remove('group-expanded');
            el.classList.add('group-collapsing');

            // 恢復原始位置
            const orig = expandedOriginalPos[member.id];
            if (orig) {
                el.style.left = orig.left;
                el.style.top = orig.top;
                el.style.transform = orig.transform;
                el.style.zIndex = orig.zIndex;
            }
        });

        // 動畫結束後清理
        setTimeout(() => {
            members.forEach(member => {
                const el = document.querySelector(`[data-note-id="${member.id}"]`);
                if (el) el.classList.remove('group-collapsing');
            });
            // 重新渲染群組視覺
            PostIt.Board.renderGroupVisuals(PostIt.Note.getCache());
        }, 350);

        expandedGroupId = null;
        expandedOriginalPos = {};
    }

    function isExpanded() {
        return !!expandedGroupId;
    }

    // ================================================================
    // 展開後拖出拆分
    // ================================================================

    function createFanDragHandler(el, noteId, groupId) {
        let startX, startY, isDragging = false;

        function onDown(e) {
            if (e.target.closest('.note-settings-trigger') || e.target.closest('.note-delete-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            isDragging = false;

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        }

        function onMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 5) {
                isDragging = true;
                const board = document.getElementById('whiteboard');
                const boardRect = board.getBoundingClientRect();
                el.style.left = (e.clientX - boardRect.left - el.offsetWidth / 2) + 'px';
                el.style.top = (e.clientY - boardRect.top - el.offsetHeight / 2) + 'px';
                el.style.transform = 'rotate(0deg) scale(1.05)';
                el.style.filter = 'drop-shadow(10px 18px 20px rgba(0, 0, 0, 0.4))';
            }
        }

        function onUp(e) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);

            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            el.style.filter = '';

            if (dist > FAN_DETACH_THRESHOLD) {
                // 拆分！
                if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_detach');
                PostIt.Note.removeFromGroup(noteId);

                // 儲存新位置
                const board = document.getElementById('whiteboard');
                const boardRect = board.getBoundingClientRect();
                const xPercent = (parseFloat(el.style.left) / boardRect.width) * 100;
                const yPercent = (parseFloat(el.style.top) / boardRect.height) * 100;
                PostIt.Note.updatePosition(noteId, xPercent, yPercent, PostIt.Drag.getMaxZIndex() + 1);

                // 收合剩餘群組
                el.classList.remove('group-expanded');
                collapseGroup();

                PostIt.Board.showToast('已從群組拆出');
            } else {
                // 沒拖出足夠距離，恢復位置
                const orig = expandedOriginalPos[noteId];
                if (orig) {
                    el.style.left = orig.left;
                    el.style.top = orig.top;
                    el.style.transform = orig.transform;
                }
            }
        }

        return onDown;
    }

    // ================================================================
    // 右鍵選單
    // ================================================================

    function onContextMenu(e) {
        const noteEl = e.target.closest('.sticky-note');
        if (!noteEl) return;

        const noteId = noteEl.dataset.noteId;
        const note = PostIt.Note.getNote(noteId);
        if (!note || !note.groupId) return;

        e.preventDefault();

        contextMenuEl.dataset.groupId = note.groupId;
        contextMenuEl.style.left = e.clientX + 'px';
        contextMenuEl.style.top = e.clientY + 'px';

        requestAnimationFrame(() => {
            contextMenuEl.classList.add('visible');
        });
    }

    function hideContextMenu() {
        if (contextMenuEl) contextMenuEl.classList.remove('visible');
    }

    // ================================================================
    // 整組拖曳（在 drag.js 中呼叫）
    // ================================================================

    function moveGroupMembers(groupId, dragEl) {
        if (!groupId) return;
        const members = PostIt.Note.getGroupNotes(groupId);
        members.forEach(member => {
            const el = document.querySelector(`[data-note-id="${member.id}"]`);
            if (!el || el === dragEl) return;
            // 跟隨頂層便利貼的位置（加上微偏移）
            const offsetX = member.groupOffsetX || 0;
            const offsetY = member.groupOffsetY || 0;
            el.style.left = (parseFloat(dragEl.style.left) + offsetX) + 'px';
            el.style.top = (parseFloat(dragEl.style.top) + offsetY) + 'px';
        });
    }

    // 儲存整組位置
    function saveGroupPositions(groupId, dragEl) {
        if (!groupId) return;
        const board = document.getElementById('whiteboard');
        const boardRect = board.getBoundingClientRect();
        const members = PostIt.Note.getGroupNotes(groupId);

        members.forEach(member => {
            const el = document.querySelector(`[data-note-id="${member.id}"]`);
            if (!el) return;
            const xPercent = (parseFloat(el.style.left) / boardRect.width) * 100;
            const yPercent = (parseFloat(el.style.top) / boardRect.height) * 100;
            PostIt.Note.updatePosition(member.id, xPercent, yPercent, parseInt(el.style.zIndex || 1));
        });
    }

    // ================================================================
    // 公開 API
    // ================================================================
    return {
        init,
        // 合併偵測
        checkOverlap,
        clearMergeState,
        moveAttached,
        finalizeMerge,
        hasAttached,
        cancelMerge,
        // 長按展開
        startLongPress,
        cancelLongPress,
        checkLongPressMove,
        // 撲克牌展開
        expandGroup,
        collapseGroup,
        isExpanded,
        // 整組移動
        moveGroupMembers,
        saveGroupPositions
    };
})();
