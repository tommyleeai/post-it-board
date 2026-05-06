// ============================================
// Group Interaction Engine
// ============================================
// Merge detection, snap animation, fan-out, detach
PostIt.Group = (function () {
    'use strict';

    // ======== State ========
    let mergeTarget = null;
    let mergeTimer = null;
    let attachedNotes = [];
    let attachedMoved = false;
    let attachOrigin = { x: 0, y: 0 };

    let expandedGroupId = null;
    let expandedOriginalPos = {};
    let longPressTimer = null;
    let longPressStart = { x: 0, y: 0 };
    let longPressNoteEl = null;

    let overlayEl = null;
    let expandAttachTimeout = null;  // handler attach timeout ID

    const MERGE_THRESHOLD = 0.80;
    const MERGE_DWELL = 300;
    const ATTACH_MOVE_THRESHOLD = 50;
    const LONG_PRESS_DURATION = 1200;
    const LONG_PRESS_MOVE_CANCEL = 5;
    const FAN_DETACH_THRESHOLD = 100;

    let lastOverlapCheck = 0;
    const OVERLAP_CHECK_INTERVAL = 50;

    // ======== Init ========
    function init() {
        overlayEl = document.getElementById('group-overlay');
        if (!overlayEl) {
            overlayEl = document.createElement('div');
            overlayEl.id = 'group-overlay';
            overlayEl.className = 'group-overlay';
            document.body.appendChild(overlayEl);
        }
        overlayEl.addEventListener('click', collapseGroup);

        // 初始化群組專屬的懸浮工具列 (Group Action Bar)
        var actionBar = document.getElementById('group-action-bar');
        if (!actionBar) {
            actionBar = document.createElement('div');
            actionBar.id = 'group-action-bar';
            actionBar.style.cssText = 'position: fixed; bottom: -80px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; z-index: 9999999; background: rgba(255,255,255,0.95); padding: 12px 24px; border-radius: 50px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); backdrop-filter: blur(10px); transition: bottom 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); opacity: 0; pointer-events: none;';
            actionBar.innerHTML = 
                '<button id="btn-group-bar-disband" style="background: #f8f9fa; border: 1px solid #ddd; padding: 10px 20px; font-size: 15px; font-weight: bold; border-radius: 25px; cursor: pointer; color: #333; display: flex; align-items: center; gap: 8px; transition: background 0.2s;"><i class="fa-solid fa-object-ungroup"></i> 解散群組</button>' +
                '<button id="btn-group-bar-delete" style="background: #fff0f0; border: 1px solid #ffccd5; padding: 10px 20px; font-size: 15px; font-weight: bold; border-radius: 25px; cursor: pointer; color: #e74c3c; display: flex; align-items: center; gap: 8px; transition: background 0.2s;"><i class="fa-solid fa-trash"></i> 永久刪除</button>';
            document.body.appendChild(actionBar);

            // 事件綁定
            var btnDisband = document.getElementById('btn-group-bar-disband');
            var btnDelete = document.getElementById('btn-group-bar-delete');

            btnDisband.onmouseenter = function() { this.style.background = '#e9ecef'; };
            btnDisband.onmouseleave = function() { this.style.background = '#f8f9fa'; };
            btnDelete.onmouseenter = function() { this.style.background = '#ffe5e5'; };
            btnDelete.onmouseleave = function() { this.style.background = '#fff0f0'; };

            btnDisband.addEventListener('click', function(ev) {
                ev.stopPropagation(); // 阻止冒泡到 `#board` 或 `document` 引發其他行為
                var groupId = expandedGroupId;
                if (!groupId) return;
                collapseGroup();
                PostIt.Note.disbandGroup(groupId);
                if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_disband');
                PostIt.Board.showToast('群組已解散');
            });

            btnDelete.addEventListener('click', function(ev) {
                ev.stopPropagation();
                var groupId = expandedGroupId;
                if (!groupId) return;
                var members = PostIt.Note.getGroupNotes(groupId);
                if (!confirm('確定要刪除整個群組嗎？\n共 ' + members.length + ' 張貼紙將永久刪除，此操作無法復原！')) return;
                collapseGroup();
                // 使用我們在 note.js 新增的批次刪除功能
                if (typeof PostIt.Note.removeGroup === 'function') {
                    PostIt.Note.removeGroup(groupId);
                    if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('note_delete');
                } else {
                    PostIt.Board.showToast('系統版本不匹配，無法執行批次刪除', 'error');
                }
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                // 層級順序：燈箱優先 → 群組其次
                if (typeof PostIt.Board !== 'undefined' && PostIt.Board.isLightboxOpen && PostIt.Board.isLightboxOpen()) {
                    PostIt.Board.closeLightbox();
                } else if (expandedGroupId) {
                    collapseGroup();
                }
            }
        });

        var board = document.getElementById('whiteboard');
        if (board) {
            board.addEventListener('contextmenu', onContextMenu);
        }
    }

    // ================================================================
    // Overlap detection (called from drag.js onPointerMove)
    // ================================================================

    function checkOverlap(dragEl) {
        if (!dragEl) return;
        var now = Date.now();
        if (now - lastOverlapCheck < OVERLAP_CHECK_INTERVAL) return;
        lastOverlapCheck = now;

        var dragRect = dragEl.getBoundingClientRect();
        var dragId = dragEl.dataset.noteId;

        var bestTarget = null;
        var bestIoS = 0;

        // 判斷是否為寬度加倍的橫式純圖片便利貼
        var dragIsLandscape = dragEl.classList.contains('landscape-image') && dragEl.classList.contains('image-only');

        document.querySelectorAll('.sticky-note').forEach(function (el) {
            if (el === dragEl) return;
            // 大小不一致時禁止群組合併（一方橫式加倍、另一方正常寬度）
            var elIsLandscape = el.classList.contains('landscape-image') && el.classList.contains('image-only');
            if (dragIsLandscape !== elIsLandscape) return;
            var elId = el.dataset.noteId;
            var dragNote = PostIt.Note.getNote(dragId);
            var elNote = PostIt.Note.getNote(elId);
            if (dragNote && elNote && dragNote.groupId && dragNote.groupId === elNote.groupId) return;
            if (attachedNotes.includes(elId)) return;
            if (el.classList.contains('group-hidden')) return;

            var elRect = el.getBoundingClientRect();
            var ios = calcIoS(dragRect, elRect);

            if (ios > bestIoS) {
                bestIoS = ios;
                bestTarget = el;
            }
        });

        if (bestTarget && bestIoS >= MERGE_THRESHOLD) {
            if (mergeTarget !== bestTarget) {
                clearMergeState();
                mergeTarget = bestTarget;
                mergeTarget.classList.add('group-merge-target');
                if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_hover');

                mergeTimer = setTimeout(function () {
                    performAttach(dragEl, mergeTarget);
                }, MERGE_DWELL);
            }
        } else {
            if (mergeTarget) {
                clearMergeState();
            }
        }
    }

    function calcIoS(rectA, rectB) {
        var interLeft = Math.max(rectA.left, rectB.left);
        var interTop = Math.max(rectA.top, rectB.top);
        var interRight = Math.min(rectA.right, rectB.right);
        var interBottom = Math.min(rectA.bottom, rectB.bottom);
        var interW = Math.max(0, interRight - interLeft);
        var interH = Math.max(0, interBottom - interTop);
        var interArea = interW * interH;
        if (interArea === 0) return 0;
        var areaA = rectA.width * rectA.height;
        var areaB = rectB.width * rectB.height;
        var smaller = Math.min(areaA, areaB);
        return smaller > 0 ? interArea / smaller : 0;
    }

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
    // Snap animation
    // ================================================================

    function performAttach(dragEl, targetEl) {
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_snap');

        var targetId = targetEl.dataset.noteId;
        var targetNote = PostIt.Note.getNote(targetId);

        var attachIds = [];
        if (targetNote && targetNote.groupId) {
            var members = PostIt.Note.getGroupNotes(targetNote.groupId);
            attachIds = members.map(function (m) { return m.id; });
        } else {
            attachIds = [targetId];
        }

        attachedNotes = attachIds;
        attachedMoved = false;
        attachOrigin = { x: parseFloat(dragEl.style.left), y: parseFloat(dragEl.style.top) };

        attachIds.forEach(function (id) {
            var el = document.querySelector('[data-note-id="' + id + '"]');
            if (!el) return;
            el.classList.add('group-attaching');
            el.style.left = dragEl.style.left;
            el.style.top = dragEl.style.top;
            var offset = (Math.random() - 0.5) * 6;
            el.style.transform = 'rotate(' + offset + 'deg) scale(0.98)';
        });

        setTimeout(function () {
            attachIds.forEach(function (id) {
                var el = document.querySelector('[data-note-id="' + id + '"]');
                if (el) el.classList.remove('group-attaching');
            });
        }, 300);

        targetEl.classList.remove('group-merge-target');
        mergeTarget = null;
    }

    function moveAttached(dragEl) {
        if (attachedNotes.length === 0) return;

        if (!attachedMoved) {
            var dist = Math.sqrt(
                Math.pow(parseFloat(dragEl.style.left) - attachOrigin.x, 2) +
                Math.pow(parseFloat(dragEl.style.top) - attachOrigin.y, 2)
            );
            if (dist < ATTACH_MOVE_THRESHOLD) return;
            attachedMoved = true;
        }

        attachedNotes.forEach(function (id) {
            var el = document.querySelector('[data-note-id="' + id + '"]');
            if (el) {
                var offset = (Math.random() - 0.5) * 4;
                el.style.left = (parseFloat(dragEl.style.left) + offset) + 'px';
                el.style.top = (parseFloat(dragEl.style.top) + offset) + 'px';
            }
        });
    }

    async function finalizeMerge(dragEl) {
        if (attachedNotes.length === 0) return false;
        var dragId = dragEl.dataset.noteId;
        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_land');
        var firstAttachedId = attachedNotes[0];
        var result = await PostIt.Note.mergeToGroup(dragId, firstAttachedId);
        attachedNotes = [];
        attachedMoved = false;
        clearMergeState();
        return !!result;
    }

    function hasAttached() {
        return attachedNotes.length > 0;
    }

    function cancelMerge() {
        clearMergeState();
        attachedNotes = [];
        attachedMoved = false;
    }

    // ================================================================
    // Long press expand
    // ================================================================

    function startLongPress(noteEl, x, y) {
        var noteId = noteEl.dataset.noteId;
        var note = PostIt.Note.getNote(noteId);
        if (!note || !note.groupId) return;
        var members = PostIt.Note.getGroupNotes(note.groupId);
        if (members.length < 2) return;

        longPressNoteEl = noteEl;
        longPressStart = { x: x, y: y };
        longPressTimer = setTimeout(function () {
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
        var dist = Math.sqrt(
            Math.pow(x - longPressStart.x, 2) +
            Math.pow(y - longPressStart.y, 2)
        );
        if (dist > LONG_PRESS_MOVE_CANCEL) {
            cancelLongPress();
        }
    }

    // ================================================================
    // Fan-out (poker card expand)
    // ================================================================

    function expandGroup(groupId) {
        if (expandedGroupId) collapseGroup();
        cancelLongPress();

        var members = PostIt.Note.getGroupNotes(groupId);
        if (members.length < 2) return;

        expandedGroupId = groupId;
        expandedOriginalPos = {};

        // 動態計算 z-index 基準值：確保 overlay 和展開的卡片永遠在所有便利貼之上
        var currentMaxZ = PostIt.Drag.getMaxZIndex();
        var overlayZ = Math.max(450000, currentMaxZ + 100);
        var expandedBaseZ = overlayZ + 1;

        overlayEl.style.zIndex = overlayZ;
        overlayEl.classList.add('active');

        var actionBar = document.getElementById('group-action-bar');
        if (actionBar) {
            actionBar.style.opacity = '1';
            actionBar.style.pointerEvents = 'auto';
            actionBar.style.bottom = '40px';
            
            // 更新按鈕文字上的數字
            document.getElementById('btn-group-bar-delete').innerHTML = '<i class="fa-solid fa-trash"></i> 永久刪除 (' + members.length + ')';
        }

        var board = document.getElementById('whiteboard');
        var boardRect = board.getBoundingClientRect();
        var viewWidth = boardRect.width;
        var viewHeight = boardRect.height;
        var noteW = 320;

        var n = members.length;
        var overlapFactor = Math.max(0.35, 1 - (n - 1) * 0.08);
        var stepX = noteW * overlapFactor;
        var totalW = stepX * (n - 1) + noteW;

        var startX = (viewWidth - totalW) / 2;
        var centerY = (viewHeight - 280) / 2;

        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_fan', n);

        members.forEach(function (member, i) {
            var el = document.querySelector('[data-note-id="' + member.id + '"]');
            if (!el) return;

            expandedOriginalPos[member.id] = {
                left: el.style.left,
                top: el.style.top,
                transform: el.style.transform,
                zIndex: el.style.zIndex
            };

            el.classList.remove('group-hidden', 'group-stacked');
            el.removeAttribute('data-group-count');
            var badges = el.querySelectorAll('.group-count-badge');
            for (var b = 0; b < badges.length; b++) badges[b].remove();

            setTimeout(function () {
                el.classList.add('group-expanded');
                el.style.left = (startX + i * stepX) + 'px';
                el.style.top = centerY + 'px';
                var rotation = (i - (n - 1) / 2) * 2;
                el.style.transform = 'rotate(' + rotation + 'deg)';
                el.style.zIndex = expandedBaseZ + i;
            }, i * 50);
        });

        expandAttachTimeout = setTimeout(function () {
            members.forEach(function (member) {
                var el = document.querySelector('[data-note-id="' + member.id + '"]');
                if (el) {
                    el._groupDragHandler = createFanDragHandler(el, member.id, groupId);
                    el.addEventListener('pointerdown', el._groupDragHandler);
                }
            });
            expandAttachTimeout = null;
        }, members.length * 50 + 400);
    }

    function collapseGroup() {
        if (!expandedGroupId) return;
        var groupId = expandedGroupId;
        var members = PostIt.Note.getGroupNotes(groupId);

        // Cancel pending handler attachment
        if (expandAttachTimeout) {
            clearTimeout(expandAttachTimeout);
            expandAttachTimeout = null;
        }

        if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_collapse', members.length);
        overlayEl.classList.remove('active');

        var actionBar = document.getElementById('group-action-bar');
        if (actionBar) {
            actionBar.style.opacity = '0';
            actionBar.style.pointerEvents = 'none';
            actionBar.style.bottom = '-80px';
        }

        members.forEach(function (member) {
            var el = document.querySelector('[data-note-id="' + member.id + '"]');
            if (!el) return;
            if (el._groupDragHandler) {
                el.removeEventListener('pointerdown', el._groupDragHandler);
                delete el._groupDragHandler;
            }
            el.classList.remove('group-expanded');
            el.classList.remove('group-expanded-lifted');
            el.classList.add('group-collapsing');

            var orig = expandedOriginalPos[member.id];
            if (orig) {
                el.style.left = orig.left;
                el.style.top = orig.top;
                el.style.transform = orig.transform;
                el.style.zIndex = orig.zIndex;
            }
        });

        setTimeout(function () {
            members.forEach(function (member) {
                var el = document.querySelector('[data-note-id="' + member.id + '"]');
                if (el) el.classList.remove('group-collapsing');
            });
            PostIt.Board.renderGroupVisuals(PostIt.Note.getCache());
        }, 350);

        expandedGroupId = null;
        expandedOriginalPos = {};
    }

    function isExpanded() {
        return !!expandedGroupId;
    }

    // ================================================================
    // Fan-out drag detach
    // ================================================================

    function createFanDragHandler(el, noteId, groupId) {
        var startX, startY;

        // 儲存展開後的正確位置與層級，而不是展開前的原始位置
        var fanPos = {
            left: el.style.left,
            top: el.style.top,
            zIndex: el.style.zIndex,
            transform: el.style.transform
        };

        function onDown(e) {
            // 右鍵不走這裡，讓 contextmenu 事件穿透到 onContextMenu 收起群組
            if (e.button === 2) return;
            if (e.target.closest('.note-settings-trigger') || e.target.closest('.note-delete-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;

            document.addEventListener('pointerup', onUp);
        }

        function onUp(e) {
            document.removeEventListener('pointerup', onUp);
            
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            var dist = Math.sqrt(dx * dx + dy * dy);

            // 如果移動超過 10 像素，視為無效點擊（防止誤觸）
            if (dist > 10) return;

            if (!el.classList.contains('group-expanded-lifted')) {
                // 第一下點擊：升起卡片
                document.querySelectorAll('.group-expanded-lifted').forEach(function(node) {
                    node.classList.remove('group-expanded-lifted');
                });
                el.classList.add('group-expanded-lifted');
            } else {
                // 第二下點擊：觸發圖片的 click 事件，開啟燈箱
                var imgEl = el.querySelector('.note-img');
                if (imgEl) {
                    imgEl.click();
                }
            }
            
            // 確保位置維持在原本的展開位置，靠 CSS 的 translateY(-50%) 升起
            el.style.transition = ''; 
            el.style.top = fanPos.top;
            el.style.left = fanPos.left;
            el.style.zIndex = fanPos.zIndex;
            el.style.transform = fanPos.transform;
        }

        return onDown;
    }


    // ================================================================
    // Right-click direct action (no menu)
    // Collapsed -> right-click = expand | Expanded -> right-click = disband
    // ================================================================

    function onContextMenu(e) {
        var noteEl = e.target.closest('.sticky-note');
        if (!noteEl) return;

        var noteId = noteEl.dataset.noteId;
        var note = PostIt.Note.getNote(noteId);
        if (!note || !note.groupId) return;

        e.preventDefault();

        if (expandedGroupId && expandedGroupId === note.groupId) {
            // Expanded -> just collapse it (disband is now handled by the Floating Action Bar)
            collapseGroup();
        } else {
            // Collapsed -> expand
            expandGroup(note.groupId);
        }
    }

    // ================================================================
    // Group drag (called from drag.js)
    // ================================================================

    function moveGroupMembers(groupId, dragEl) {
        if (!groupId) return;
        var members = PostIt.Note.getGroupNotes(groupId);
        members.forEach(function (member) {
            var el = document.querySelector('[data-note-id="' + member.id + '"]');
            if (!el || el === dragEl) return;
            var offsetX = member.groupOffsetX || 0;
            var offsetY = member.groupOffsetY || 0;
            el.style.left = (parseFloat(dragEl.style.left) + offsetX) + 'px';
            el.style.top = (parseFloat(dragEl.style.top) + offsetY) + 'px';
        });
    }

    function saveGroupPositions(groupId) {
        if (!groupId) return;
        var board = document.getElementById('whiteboard');
        var boardRect = board.getBoundingClientRect();
        var members = PostIt.Note.getGroupNotes(groupId);
        members.forEach(function (member) {
            var el = document.querySelector('[data-note-id="' + member.id + '"]');
            if (!el) return;
            var xPercent = (parseFloat(el.style.left) / boardRect.width) * 100;
            var yPercent = (parseFloat(el.style.top) / boardRect.height) * 100;
            PostIt.Note.updatePosition(member.id, xPercent, yPercent, parseInt(el.style.zIndex || 1));
        });
    }

    function saveAttachedPositions() {
        var board = document.getElementById('whiteboard');
        var boardRect = board.getBoundingClientRect();
        attachedNotes.forEach(function (id) {
            var el = document.querySelector('[data-note-id="' + id + '"]');
            if (!el) return;
            var xPercent = (parseFloat(el.style.left) / boardRect.width) * 100;
            var yPercent = (parseFloat(el.style.top) / boardRect.height) * 100;
            PostIt.Note.updatePosition(id, xPercent, yPercent, parseInt(el.style.zIndex || 1));
        });
    }

    // ================================================================
    // Public API
    // ================================================================
    return {
        init: init,
        checkOverlap: checkOverlap,
        clearMergeState: clearMergeState,
        moveAttached: moveAttached,
        finalizeMerge: finalizeMerge,
        hasAttached: hasAttached,
        cancelMerge: cancelMerge,
        startLongPress: startLongPress,
        cancelLongPress: cancelLongPress,
        checkLongPressMove: checkLongPressMove,
        expandGroup: expandGroup,
        collapseGroup: collapseGroup,
        isExpanded: isExpanded,
        getExpandedGroupId: function() { return expandedGroupId; },
        moveGroupMembers: moveGroupMembers,
        saveGroupPositions: saveGroupPositions,
        saveAttachedPositions: saveAttachedPositions
    };
})();
