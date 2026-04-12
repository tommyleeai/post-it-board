// ============================================
// 圖釘連線系統 (Pin & Connect)
// ============================================
PostIt.Connect = (function () {
    'use strict';

    const CONN_COLOR = '#e74c3c';

    let pairs = [];          // { id, from, to }
    let pinModeActive = false;
    let firstNote = null;    // 第一張選中的便利貼元素
    let svgEl = null;
    let boardEl = null;
    let previewLineEl = null;
    let cursorEl = null;
    let fabPin = null;
    let cursorPos = { x: 0, y: 0 }; // viewport 座標

    // -------- 初始化（頁面載入時呼叫）--------
    function init() {
        svgEl    = document.getElementById('connections-svg');
        boardEl  = document.getElementById('whiteboard');
        cursorEl = document.getElementById('pin-cursor');
        fabPin   = document.getElementById('fab-pin');
        if (!svgEl || !fabPin) return;

        // Fab 按鈕點擊 → 切換 pin 模式
        fabPin.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pinModeActive) exitPinMode();
            else enterPinMode();
        });

        // ESC 退出
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && pinModeActive) exitPinMode();
        });

        // 追蹤游標位置
        document.addEventListener('pointermove', (e) => {
            cursorPos = { x: e.clientX, y: e.clientY };
            if (cursorEl && pinModeActive) {
                cursorEl.style.left = (e.clientX - 10) + 'px';
                cursorEl.style.top  = (e.clientY - 32) + 'px';
            }
        });

        // 事件委派：在 board 上監聽所有便利貼點擊（包括後來動態新增的）
        boardEl.addEventListener('click', onBoardClick);

        // 啟動渲染迴圈
        renderLoop();
    }

    // -------- 登入後呼叫：訂閱 Firestore 連線資料 --------
    function start() {
        loadConnections();
    }

    // -------- 進入圖釘模式 --------
    function enterPinMode() {
        pinModeActive = true;
        fabPin.classList.add('active');
        document.body.classList.add('pin-mode');
        if (cursorEl) cursorEl.style.display = 'flex';
    }

    // -------- 退出圖釘模式 --------
    function exitPinMode() {
        pinModeActive = false;
        fabPin.classList.remove('active');
        document.body.classList.remove('pin-mode');
        if (cursorEl) cursorEl.style.display = 'none';

        // 清除第一張選中的卡片
        if (firstNote) {
            firstNote.classList.remove('pin-selected');
            firstNote = null;
        }
        // 隱藏預覽線
        if (previewLineEl) previewLineEl.setAttribute('stroke-opacity', '0');
    }

    // -------- 點擊 board 委派處理 --------
    function onBoardClick(e) {
        if (!pinModeActive) return;

        const noteEl = e.target.closest('.sticky-note');
        if (!noteEl) {
            // 點到空白處 → 如果有第一張卡，取消選取
            if (firstNote) {
                firstNote.classList.remove('pin-selected');
                firstNote = null;
                if (previewLineEl) previewLineEl.setAttribute('stroke-opacity', '0');
            }
            return;
        }

        e.stopPropagation();
        handleNotePin(noteEl);
    }

    // -------- 圖釘邏輯 --------
    function handleNotePin(noteEl) {
        if (!firstNote) {
            // === 第一張 ===
            firstNote = noteEl;
            noteEl.classList.add('pin-selected');
            playPinSound();
            animatePinDrop(noteEl);
            ensurePreviewLine();
        } else {
            // === 第二張 ===
            if (firstNote === noteEl) {
                // 點同一張 → 取消
                firstNote.classList.remove('pin-selected');
                firstNote = null;
                if (previewLineEl) previewLineEl.setAttribute('stroke-opacity', '0');
                return;
            }

            const fromId = firstNote.dataset.noteId;
            const toId   = noteEl.dataset.noteId;

            // 避免重複連線
            const exists = pairs.some(p =>
                (p.from === fromId && p.to === toId) ||
                (p.from === toId   && p.to === fromId)
            );

            if (!exists) {
                pairs.push({ id: generateId(), from: fromId, to: toId });
                saveConnections();
                animatePinDrop(noteEl);
                playPinSound();
            }

            firstNote.classList.remove('pin-selected');
            firstNote = null;
            if (previewLineEl) previewLineEl.setAttribute('stroke-opacity', '0');
        }
    }

    // -------- 建立/確保預覽線存在 --------
    function ensurePreviewLine() {
        if (!previewLineEl) {
            previewLineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            previewLineEl.setAttribute('stroke', CONN_COLOR);
            previewLineEl.setAttribute('stroke-width', '3.5');
            previewLineEl.setAttribute('stroke-dasharray', '8 4');
            previewLineEl.setAttribute('stroke-linecap', 'round');
            previewLineEl.style.filter = 'drop-shadow(2px 3px 3px rgba(0,0,0,0.4))';
            svgEl.insertBefore(previewLineEl, svgEl.firstChild); // 放最底層
        }
        previewLineEl.setAttribute('stroke-opacity', '0.5');
    }

    // -------- rAF 渲染迴圈：每幀更新所有連線位置 --------
    function renderLoop() {
        const boardRect = svgEl.getBoundingClientRect();

        // 分析需要有「圖釘」的便利貼 IDs
        const pinnedIds = new Set();
        if (firstNote) pinnedIds.add(firstNote.dataset.noteId);
        pairs.forEach(p => {
            pinnedIds.add(p.from);
            pinnedIds.add(p.to);
        });

        // 動態賦予/移除實體圖釘
        document.querySelectorAll('.sticky-note').forEach(noteEl => {
            const hasPin = pinnedIds.has(noteEl.dataset.noteId);
            let pinEl = noteEl.querySelector('.persistent-pin');
            if (hasPin) {
                if (!pinEl) {
                    pinEl = document.createElement('div');
                    pinEl.className = 'persistent-pin';
                    pinEl.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
                    noteEl.appendChild(pinEl);
                }
            } else {
                if (pinEl) pinEl.remove();
            }
        });

        // 更新已儲存的連線
        pairs.forEach(pair => {
            const fromEl = document.querySelector(`.sticky-note[data-note-id="${pair.from}"]`);
            const toEl   = document.querySelector(`.sticky-note[data-note-id="${pair.to}"]`);

            let g = svgEl.querySelector(`[data-conn-id="${pair.id}"]`);
            if (!g) {
                g = createConnectionGroup(pair.id);
                svgEl.appendChild(g);
            }

            if (!fromEl || !toEl) {
                // 其中一張卡片已被刪除，隱藏連線（不刪資料，避免同步問題）
                g.style.opacity = '0';
                return;
            }
            g.style.opacity = '1';

            const from = getNoteCenter(fromEl, boardRect);
            const to   = getNoteCenter(toEl,   boardRect);

            g.querySelector('.conn-hit') ?.setAttribute('x1', from.x);
            g.querySelector('.conn-hit') ?.setAttribute('y1', from.y);
            g.querySelector('.conn-hit') ?.setAttribute('x2', to.x);
            g.querySelector('.conn-hit') ?.setAttribute('y2', to.y);
            g.querySelector('.conn-line')?.setAttribute('x1', from.x);
            g.querySelector('.conn-line')?.setAttribute('y1', from.y);
            g.querySelector('.conn-line')?.setAttribute('x2', to.x);
            g.querySelector('.conn-line')?.setAttribute('y2', to.y);
            g.querySelector('.pin-head-from')?.setAttribute('cx', from.x);
            g.querySelector('.pin-head-from')?.setAttribute('cy', from.y);
            g.querySelector('.pin-head-to')  ?.setAttribute('cx', to.x);
            g.querySelector('.pin-head-to')  ?.setAttribute('cy', to.y);
        });

        // 移除孤兒 group（已從 pairs 移除的）
        svgEl.querySelectorAll('[data-conn-id]').forEach(g => {
            if (!pairs.some(p => p.id === g.dataset.connId)) g.remove();
        });

        // 更新預覽線
        if (firstNote && previewLineEl && pinModeActive) {
            const from = getNoteCenter(firstNote, boardRect);
            previewLineEl.setAttribute('x1', from.x);
            previewLineEl.setAttribute('y1', from.y);
            previewLineEl.setAttribute('x2', cursorPos.x - boardRect.left);
            previewLineEl.setAttribute('y2', cursorPos.y - boardRect.top);
        }

        requestAnimationFrame(renderLoop);
    }

    // -------- 建立連線 SVG group --------
    function createConnectionGroup(connId) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.dataset.connId = connId;

        // 不可見的寬點擊區
        const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hitLine.setAttribute('stroke', 'transparent');
        hitLine.setAttribute('stroke-width', '16');
        hitLine.style.cursor = 'pointer';
        hitLine.style.pointerEvents = 'stroke';
        hitLine.classList.add('conn-hit');
        hitLine.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConnection(connId);
        });

        // 可見線段
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('stroke', CONN_COLOR);
        line.setAttribute('stroke-width', '3.5');
        line.setAttribute('stroke-dasharray', '6 4');
        line.setAttribute('stroke-linecap', 'round');
        line.style.pointerEvents = 'none';
        line.style.filter = 'drop-shadow(2px 3px 3px rgba(0,0,0,0.5))';
        line.classList.add('conn-line');

        // 兩端圖釘頭（小圓點）
        const c1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c1.setAttribute('r', '5');
        c1.setAttribute('fill', CONN_COLOR);
        c1.style.pointerEvents = 'none';
        c1.classList.add('pin-head-from');

        const c2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c2.setAttribute('r', '5');
        c2.setAttribute('fill', CONN_COLOR);
        c2.style.pointerEvents = 'none';
        c2.classList.add('pin-head-to');

        g.appendChild(hitLine);
        g.appendChild(line);
        g.appendChild(c1);
        g.appendChild(c2);

        return g;
    }

    // -------- 便利貼連線錨點座標（原中央，現改為正上方圖釘處）--------
    function getNoteCenter(noteEl, boardRect) {
        const r = noteEl.getBoundingClientRect();
        return {
            x: r.left - boardRect.left + r.width  / 2,
            y: r.top  - boardRect.top  - 2 // 線連接在圖釘尖端附近（靠近便利貼上緣）
        };
    }

    // -------- 釘入動畫：圖釘從上方落下 --------
    function animatePinDrop(noteEl) {
        const dot = document.createElement('div');
        dot.className = 'pin-drop-anim';
        const boardRect = boardEl.getBoundingClientRect();
        const noteRect  = noteEl.getBoundingClientRect();
        dot.style.left = (noteRect.left - boardRect.left + noteRect.width / 2) + 'px';
        dot.style.top  = (noteRect.top  - boardRect.top) + 'px';
        dot.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        boardEl.appendChild(dot);
        setTimeout(() => dot.remove(), 650);
    }

    // -------- 音效 --------
    function playPinSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1100, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.25, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
        } catch(_) {}
    }

    // -------- 刪除連線 --------
    function deleteConnection(connId) {
        pairs = pairs.filter(p => p.id !== connId);
        saveConnections();
    }

    // -------- Firestore --------
    function saveConnections() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return;
        PostIt.Firebase.getDb()
            .collection('users').doc(uid)
            .collection('postit_meta').doc('connections')
            .set({ pairs })
            .catch(e => console.error('[Connect] save failed', e));
    }

    function loadConnections() {
        const uid = PostIt.Auth.getUid();
        if (!uid) return;
        PostIt.Firebase.getDb()
            .collection('users').doc(uid)
            .collection('postit_meta').doc('connections')
            .onSnapshot(doc => {
                pairs = doc.exists ? (doc.data().pairs || []) : [];
            });
    }

    // -------- 工具 --------
    function generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    // -------- Getters --------
    function isPinModeActive() { return pinModeActive; }

    return { init, start, exitPinMode, isPinModeActive, handleNotePin };
})();
