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

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && expandedGroupId) {
                collapseGroup();
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

        document.querySelectorAll('.sticky-note').forEach(function (el) {
            if (el === dragEl) return;
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

        overlayEl.classList.add('active');

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
                el.style.zIndex = 900001 + i;
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

        members.forEach(function (member) {
            var el = document.querySelector('[data-note-id="' + member.id + '"]');
            if (!el) return;
            if (el._groupDragHandler) {
                el.removeEventListener('pointerdown', el._groupDragHandler);
                delete el._groupDragHandler;
            }
            el.classList.remove('group-expanded');
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
        var startX, startY, isDragging = false;
        // 快取值，避免每幀重新查詢 DOM / 觸發 reflow
        var cachedBoard, cachedBoardRect, cachedHalfW, cachedHalfH;

        function onDown(e) {
            if (e.target.closest('.note-settings-trigger') || e.target.closest('.note-delete-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            isDragging = false;

            // 一次性快取：board 元素、board 矩形、元素半寬半高
            cachedBoard = document.getElementById('whiteboard');
            cachedBoardRect = cachedBoard.getBoundingClientRect();
            cachedHalfW = el.offsetWidth / 2;
            cachedHalfH = el.offsetHeight / 2;

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        }

        function onMove(e) {
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) {
                if (!isDragging) {
                    // 首次進入拖曳：設定一次性的視覺效果
                    isDragging = true;
                    // 關閉 CSS transition，否則 left/top 會被動畫延遲，造成嚴重 LAG
                    el.style.transition = 'none';
                    el.style.transform = 'rotate(0deg) scale(1.05)';
                    el.style.filter = 'drop-shadow(10px 18px 20px rgba(0, 0, 0, 0.4))';
                }
                el.style.left = (e.clientX - cachedBoardRect.left - cachedHalfW) + 'px';
                el.style.top = (e.clientY - cachedBoardRect.top - cachedHalfH) + 'px';
            }
        }

        function onUp(e) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            if (!isDragging) return;

            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            var dist = Math.sqrt(dx * dx + dy * dy);
            el.style.filter = '';

            if (dist > FAN_DETACH_THRESHOLD) {
                if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_detach');
                PostIt.Note.removeFromGroup(noteId);
                var xPercent = (parseFloat(el.style.left) / cachedBoardRect.width) * 100;
                var yPercent = (parseFloat(el.style.top) / cachedBoardRect.height) * 100;
                PostIt.Note.updatePosition(noteId, xPercent, yPercent, PostIt.Drag.getMaxZIndex() + 1);
                el.classList.remove('group-expanded');
                collapseGroup();
                PostIt.Board.showToast('已從群組拆出');
            } else {
                var orig = expandedOriginalPos[noteId];
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
            // Expanded -> disband
            collapseGroup();
            PostIt.Note.disbandGroup(note.groupId);
            if (typeof PostIt.Sound !== 'undefined') PostIt.Sound.play('group_disband');
            PostIt.Board.showToast('群組已解散');
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
        moveGroupMembers: moveGroupMembers,
        saveGroupPositions: saveGroupPositions
    };
})();
