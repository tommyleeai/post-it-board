// ============================================
// 時效性鬧鐘與提醒管理 (Alarm System)
// ============================================
PostIt.Alarm = (function () {
    'use strict';

    let activeNotes = {}; // { id: targetTimeMs }
    let ringingNotes = new Set(); // 正在響鈴的 noteId
    
    // 播放音效 (Web Audio API 合成器)
    let audioCtx = null;
    let beepingInterval = null;
    let audioUnlocked = false;

    // 用戶首次點擊時解鎖 AudioContext
    document.addEventListener('pointerdown', () => {
        if (!audioUnlocked) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                
                // 播放一個靜音來強制解鎖
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                gain.gain.value = 0;
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime);
                osc.stop(audioCtx.currentTime + 0.001);
                
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                audioUnlocked = true;
                console.log('[Alarm] Web Audio API 已由使用者手勢解鎖');
            } catch (e) {
                console.warn('[Alarm] AudioContext 解鎖失敗', e);
            }
        }
    }, { once: true });

    function startBeep() {
        try {
            if (!audioCtx) return;
            if (audioCtx.state === 'suspended') audioCtx.resume();
            
            if (beepingInterval) return; // 已經在響
            
            const playSingleBeep = () => {
                if(audioCtx.state === 'suspended') return;
                
                const t = audioCtx.currentTime;
                
                // 第一聲 (柔和的 E5)
                const osc1 = audioCtx.createOscillator();
                const gain1 = audioCtx.createGain();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(659.25, t); 
                osc1.connect(gain1);
                gain1.connect(audioCtx.destination);
                
                gain1.gain.setValueAtTime(0, t);
                gain1.gain.linearRampToValueAtTime(0.2, t + 0.02);
                gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
                
                osc1.start(t);
                osc1.stop(t + 0.3);

                // 第二聲 (清脆的 C6)
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1046.50, t + 0.15);
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                
                gain2.gain.setValueAtTime(0, t + 0.15);
                gain2.gain.linearRampToValueAtTime(0.3, t + 0.17);
                gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
                
                osc2.start(t + 0.15);
                osc2.stop(t + 0.5);
            };

            // 每 1.5 秒敲擊一次雙音叮咚
            playSingleBeep();
            beepingInterval = setInterval(playSingleBeep, 1500);
        } catch (e) {
            console.warn('[Alarm] 無法播放音效', e);
        }
    }

    function stopBeep() {
        if (beepingInterval) {
            clearInterval(beepingInterval);
            beepingInterval = null;
        }
    }

    // 觸發鬧鐘
    function triggerAlarm(noteId) {
        if (ringingNotes.has(noteId)) return;
        ringingNotes.add(noteId);
        
        // 視覺震動
        const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
        if (noteEl) noteEl.classList.add('alarming');
        
        // 聲音
        startBeep();
    }

    // 解除鬧鐘
    function dismissAlarm(noteId) {
        if (!ringingNotes.has(noteId)) return;
        ringingNotes.delete(noteId);
        
        const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
        // 移除震動
        if (noteEl) noteEl.classList.remove('alarming');

        if (ringingNotes.size === 0) {
            stopBeep();
        }

        // 移除監控
        delete activeNotes[noteId];

        // 把資料庫的狀態改為 acknowledged
        if (typeof PostIt !== 'undefined' && PostIt.Note && PostIt.Note.updateReminderStatus) {
            PostIt.Note.updateReminderStatus(noteId, 'acknowledged');
        }
    }

    // 主巡迴邏輯 (每秒檢查一次，完全避免 setInterval 漂移或漏掉)
    setInterval(() => {
        const nowMs = Date.now();
        for (const [id, targetTimeMs] of Object.entries(activeNotes)) {
            if (nowMs >= targetTimeMs && !ringingNotes.has(id)) {
                triggerAlarm(id);
            }
        }
        
        // 保底：如果有響鈴，但 UI 丟失了 .alarming，補回去
        for (const id of ringingNotes) {
            const noteEl = document.querySelector(`.sticky-note[data-note-id="${id}"]`);
            if (noteEl && !noteEl.classList.contains('alarming')) {
                noteEl.classList.add('alarming');
            }
        }
    }, 1000);

    // 同步最新的卡片資料（由 board.js 呼叫）
    function sync(notesObj) {
        const currentIds = new Set(Object.keys(notesObj));

        // 1. 清理已經被刪除或改掉時間的卡片
        for (const id in activeNotes) {
            if (!currentIds.has(id)) {
                delete activeNotes[id];
                dismissAlarm(id);
            }
        }

        // 2. 佈署或更新鬧鐘
        for (const id in notesObj) {
            const note = notesObj[id];
            
            // 如果這張卡片從來沒有設定鬧鐘，或已經解決過了
            if (!note.alertTime || note.reminderStatus === 'acknowledged') {
                 if (activeNotes[id]) delete activeNotes[id];
                 if (ringingNotes.has(id)) dismissAlarm(id);
                 continue;
            }

            // 更新預定時間到巡邏站
            const targetTimeMs = new Date(note.alertTime).getTime();
            activeNotes[id] = targetTimeMs;
            
            // 立即檢查是否需要立刻觸發（防呆）
            if (Date.now() >= targetTimeMs && !ringingNotes.has(id)) {
                triggerAlarm(id);
            }
        }
    }

    return { sync, dismissAlarm };
})();
