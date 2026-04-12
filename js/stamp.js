// ============================================
// 印章系統 (Stamp System)
// ============================================
PostIt.Stamp = (function () {
    'use strict';

    // 印章種類定義
    const STAMPS = [
        { id: 'done',      label: '已完成', color: '#22a06b', bg: 'rgba(34,160,107,0.10)'  },
        { id: 'important', label: '重要',   color: '#e53e3e', bg: 'rgba(229,62,62,0.10)'   },
        { id: 'caution',   label: '注意',   color: '#dd6b20', bg: 'rgba(221,107,32,0.10)'  },
        { id: 'read',      label: '閱',     color: '#2b4acb', bg: 'rgba(43,74,203,0.10)'   },
        { id: 'approved',  label: '准奏',   color: '#c0392b', bg: 'rgba(192,57,43,0.10)'   },
    ];

    let activeStamp = null;  // 目前選中的印章
    let cursorEl = null;     // 跟隨滑鼠的游標元素

    // -------- 初始化 --------
    function init() {
        cursorEl = document.getElementById('stamp-cursor');

        const fabStamp = document.getElementById('fab-stamp');
        const stampMenu = document.getElementById('stamp-menu');
        if (!fabStamp || !stampMenu) return;

        // 動態產生印章選單項目
        STAMPS.forEach(stamp => {
            const btn = document.createElement('button');
            btn.className = 'stamp-menu-item';
            btn.title = stamp.label;
            btn.innerHTML = `<span class="stamp-preview" style="color:${stamp.color};border-color:${stamp.color}">${stamp.label}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectStamp(stamp);
                stampMenu.classList.remove('open');
            });
            stampMenu.appendChild(btn);
        });

        // Hover 展開選單
        fabStamp.addEventListener('mouseenter', () => stampMenu.classList.add('open'));
        fabStamp.addEventListener('mouseleave', (e) => {
            if (!stampMenu.contains(e.relatedTarget)) stampMenu.classList.remove('open');
        });
        stampMenu.addEventListener('mouseleave', (e) => {
            if (e.relatedTarget !== fabStamp) stampMenu.classList.remove('open');
        });

        // 游標追蹤
        document.addEventListener('mousemove', onMouseMove);

        // ESC 或點空白處 → 退出蓋章模式
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') exitStampMode();
        });
        document.addEventListener('click', (e) => {
            if (!activeStamp) return;
            if (!e.target.closest('.sticky-note') &&
                !e.target.closest('#fab-stamp') &&
                !e.target.closest('#stamp-menu')) {
                exitStampMode();
            }
        });
    }

    // -------- 進入蓋章模式 --------
    function selectStamp(stamp) {
        activeStamp = stamp;
        document.body.classList.add('stamp-mode');

        // 更新自訂游標
        if (cursorEl) {
            cursorEl.innerHTML = `<span class="stamp-cursor-inner" style="color:${stamp.color};border-color:${stamp.color};background:${stamp.bg}">${stamp.label}</span>`;
            cursorEl.style.display = 'flex';
        }

        // 讓所有便利貼可被蓋章
        document.querySelectorAll('.sticky-note').forEach(el => {
            el.classList.add('stampable');
            el.addEventListener('click', onNoteClick);
        });
    }

    // -------- 退出蓋章模式 --------
    function exitStampMode() {
        activeStamp = null;
        document.body.classList.remove('stamp-mode');
        if (cursorEl) cursorEl.style.display = 'none';

        document.querySelectorAll('.sticky-note').forEach(el => {
            el.classList.remove('stampable');
            el.removeEventListener('click', onNoteClick);
        });
    }

    // -------- 滑鼠位置追蹤 --------
    function onMouseMove(e) {
        if (!activeStamp || !cursorEl) return;
        cursorEl.style.left = (e.clientX + 14) + 'px';
        cursorEl.style.top  = (e.clientY - 44) + 'px';
    }

    // -------- 點擊便利貼 → 蓋章 --------
    function onNoteClick(e) {
        if (!activeStamp) return;
        e.stopPropagation();

        const noteEl = e.currentTarget;
        applyStamp(noteEl, activeStamp);
    }

    // -------- 蓋章 --------
    function applyStamp(noteEl, stamp) {
        // 移除舊的印章（一張卡只能有一個）
        const old = noteEl.querySelector('.stamp-on-note');
        if (old) old.remove();

        // 建立新印章元素（固定在正中間）
        const el = document.createElement('div');
        el.className = 'stamp-on-note';
        el.style.color = stamp.color;
        el.style.borderColor = stamp.color;
        el.style.background = stamp.bg;
        el.textContent = stamp.label;
        noteEl.appendChild(el);

        // 觸發蓋章動畫（下一幀才加 class，讓瀏覽器正常執行過渡）
        requestAnimationFrame(() => el.classList.add('stamp-press'));

        // 音效
        playStampSound();
    }

    // -------- Web Audio API 蓋章音效 --------
    function playStampSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(110, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.14);
            gain.gain.setValueAtTime(0.7, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.2);
        } catch (_) { /* 瀏覽器不支援就靜默跳過 */ }
    }

    return { init, exitStampMode };
})();
