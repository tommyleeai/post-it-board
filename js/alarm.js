// ============================================
// 時效性鬧鐘與提醒管理 (Alarm System)
// ============================================
PostIt.Alarm = (function () {
    'use strict';

    let alarmTimers = {}; // { noteId: setTimeoutId }
    let ringingNotes = new Set(); // 正在響鈴的 noteId
    
    // 播放音效 (Web Audio API 合成器，無需外部 mp3 檔案)
    let audioCtx = null;
    let beepingInterval = null;

    function startBeep() {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();
            
            if (beepingInterval) return; // 已經在響
            
            const playSingleBeep = () => {
                if(audioCtx.state === 'suspended') return;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.type = 'square';
                osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
                
                gain.gain.setValueAtTime(0, audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05); // fadeIn
                gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2); // fadeOut
                
                osc.start(audioCtx.currentTime);
                osc.stop(audioCtx.currentTime + 0.2);
            };

            // 每 0.5 秒逼一聲
            playSingleBeep();
            beepingInterval = setInterval(playSingleBeep, 500);
        } catch (e) {
            console.warn('[Alarm] 無法播放音效，可能是瀏覽器政策阻擋', e);
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

        // 把資料庫的狀態改為 acknowledged
        if (PostIt.Note && PostIt.Note.updateReminderStatus) {
            PostIt.Note.updateReminderStatus(noteId, 'acknowledged');
        }
    }

    // 同步最新的卡片資料（由 board.js 呼叫）
    function sync(notesObj) {
        const currentIds = new Set(Object.keys(notesObj));

        // 1. 清理已經被刪除的卡片的計時器與狀態
        for (const id in alarmTimers) {
            if (!currentIds.has(id)) {
                clearTimeout(alarmTimers[id]);
                delete alarmTimers[id];
                dismissAlarm(id); // 如果它正在響，也停掉
            }
        }

        // 2. 佈署或更新鬧鐘
        const nowMs = Date.now();
        for (const id in notesObj) {
            const note = notesObj[id];
            
            // 清理剛剛被取消的鬧鐘卡片 (使用者修改文字去除了時間意圖)
            if (!note.alertTime || note.reminderStatus === 'acknowledged') {
                 if (alarmTimers[id]) {
                     clearTimeout(alarmTimers[id]);
                     delete alarmTimers[id];
                 }
                 if (ringingNotes.has(id)) {
                     dismissAlarm(id);
                 }
                 continue;
            }

            // 只處理尚未解除且有警告時間的卡片
            if (note.alertTime && note.reminderStatus !== 'acknowledged') {
                const targetTimeMs = new Date(note.alertTime).getTime();
                
                // 如果已經過期但還沒響
                if (targetTimeMs <= nowMs && !ringingNotes.has(id)) {
                    triggerAlarm(id);
                } 
                // 如果在未來，且還沒設定計時器
                else if (targetTimeMs > nowMs && !alarmTimers[id]) {
                    const delay = targetTimeMs - nowMs;
                    // 最大 setTimeout 限制為約 24 天 (2147483647 ms)
                    if (delay < 2147483647) {
                        alarmTimers[id] = setTimeout(() => {
                            triggerAlarm(id);
                            delete alarmTimers[id];
                        }, delay);
                    }
                }
            }
        }
    }

    return { sync, dismissAlarm };
})();
