// ============================================
// 時效性鬧鐘與提醒管理 (Alarm System)
// ============================================
PostIt.Alarm = (function () {
    'use strict';

    let activeNotes = {}; // { id: targetTimeMs }
    let ringingNotes = new Set(); // 正在響鈴的 noteId

    // 安全解析不帶時區的 ISO 日期字串，強制當作本地時間
    // new Date("2026-04-15T01:56:11") 在某些瀏覽器會被當 UTC 解析
    function parseLocalTime(timeStr) {
        if (!timeStr) return 0;
        // 格式：YYYY-MM-DDTHH:mm:ss 或 YYYY-MM-DD HH:mm:ss
        var parts = timeStr.replace('T', '-').replace(/:/g, '-').split('-');
        if (parts.length >= 5) {
            return new Date(
                parseInt(parts[0]),     // year
                parseInt(parts[1]) - 1, // month (0-indexed)
                parseInt(parts[2]),     // day
                parseInt(parts[3]),     // hour
                parseInt(parts[4]),     // minute
                parseInt(parts[5] || 0) // second
            ).getTime();
        }
        // 降級：直接解析
        return new Date(timeStr).getTime();
    }
    
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
        
        // 視覺震動（如果便利貼在當前白板的畫面上）
        const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
        if (noteEl) {
            noteEl.dataset.savedTransform = noteEl.style.transform || '';
            noteEl.style.transform = '';
            noteEl.classList.add('alarming');
        } else {
            // 便利貼不在當前畫面上，彈出 Toast
            const noteData = PostIt.Note ? PostIt.Note.getNote(noteId) : null;
            if (noteData && typeof PostIt.Board !== 'undefined') {
                const txt = String(noteData.content || '提醒').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const snippet = txt.length > 15 ? txt.substring(0, 15) + '...' : txt;
                PostIt.Board.showToast(`⏱️ 時間到！\n${snippet}`, 'info', null, 0);
            }
        }
        
        // 聲音
        startBeep();
    }

    // 計算重複提醒的下一次觸發時間
    function calculateNextAlertTime(currentAlertTime, repeatRule) {
        var d = new Date(parseLocalTime(currentAlertTime));
        switch (repeatRule) {
            case 'minutely':
                d.setMinutes(d.getMinutes() + 1);
                break;
            case 'daily':
                d.setDate(d.getDate() + 1);
                break;
            case 'weekdays':
                do { d.setDate(d.getDate() + 1); }
                while (d.getDay() === 0 || d.getDay() === 6); // 跳過週末
                break;
            case 'weekly':
                d.setDate(d.getDate() + 7);
                break;
            case 'monthly':
                d.setMonth(d.getMonth() + 1);
                break;
            case 'yearly':
                d.setFullYear(d.getFullYear() + 1);
                break;
            default:
                return null;
        }
        // 回傳不帶時區的 ISO 字串
        var yyyy = d.getFullYear();
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        var hh = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        var ss = String(d.getSeconds()).padStart(2, '0');
        return yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':' + ss;
    }

    // 解除鬧鐘
    function dismissAlarm(noteId) {
        if (!ringingNotes.has(noteId)) return;
        ringingNotes.delete(noteId);
        
        const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
        if (noteEl) {
            // 移除震動並還原原本的旋轉角度
            noteEl.classList.remove('alarming');
            noteEl.style.transform = noteEl.dataset.savedTransform || '';
            delete noteEl.dataset.savedTransform;
        }

        if (ringingNotes.size === 0) {
            stopBeep();
        }

        // 移除監控
        delete activeNotes[noteId];

        // 檢查是否為重複提醒
        if (typeof PostIt !== 'undefined' && PostIt.Note) {
            var noteData = PostIt.Note.getNote(noteId);
            if (noteData && noteData.repeatRule && noteData.repeatRule !== 'none') {
                // 計算下一次觸發時間
                var nextAlert = calculateNextAlertTime(noteData.alertTime, noteData.repeatRule);
                if (nextAlert) {
                    // 計算 eventTime 差值並同步推進
                    var nextEvent = nextAlert;
                    if (noteData.eventTime) {
                        var alertMs = parseLocalTime(noteData.alertTime);
                        var eventMs = parseLocalTime(noteData.eventTime);
                        var diffMs = eventMs - alertMs;
                        var nextAlertMs = parseLocalTime(nextAlert);
                        var nd = new Date(nextAlertMs + diffMs);
                        var yyyy = nd.getFullYear();
                        var mm = String(nd.getMonth() + 1).padStart(2, '0');
                        var dd = String(nd.getDate()).padStart(2, '0');
                        var hh = String(nd.getHours()).padStart(2, '0');
                        var mi = String(nd.getMinutes()).padStart(2, '0');
                        var ss = String(nd.getSeconds()).padStart(2, '0');
                        nextEvent = yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + mi + ':' + ss;
                    }
                    // V3: 透過 Yjs 寫入下一次觸發時間
                    PostIt.Note.updateReminderLogic(noteId, {
                        alertTime: nextAlert,
                        eventTime: nextEvent,
                        reason: noteData.aiReason || '',
                        repeatRule: noteData.repeatRule,
                        needsClarification: false,
                        clarificationQuestion: ''
                    });
                    console.log('[Alarm] 重複提醒已排程下一次:', nextAlert);
                    if (typeof PostIt.Board !== 'undefined') {
                        PostIt.Board.showToast('⏰ 下次提醒：' + nextAlert.replace('T', ' '), 'info');
                    }
                    return; // 不標記 acknowledged
                }
            }
            // 非重複 → 標記已解除
            if (PostIt.Note.updateReminderStatus) {
                PostIt.Note.updateReminderStatus(noteId, 'acknowledged');
            }
        }
    }

    // V3: 從 Yjs notesCache 同步鬧鐘資料（取代已廢棄的 Firestore onSnapshot）
    function syncFromCache() {
        if (!PostIt.Note || typeof PostIt.Note.getCache !== 'function') return;
        const cache = PostIt.Note.getCache();
        const currentIds = new Set(Object.keys(cache));

        // 掃描所有 note，註冊/更新有 alertTime 的
        for (const [id, note] of Object.entries(cache)) {
            if (!note.alertTime || note.reminderStatus === 'acknowledged') {
                if (activeNotes[id]) delete activeNotes[id];
                if (ringingNotes.has(id)) dismissAlarm(id);
                continue;
            }
            const targetTimeMs = parseLocalTime(note.alertTime);
            activeNotes[id] = targetTimeMs;

            // 即將到期（60分鐘內），加上 urgent-note class
            const noteEl = document.querySelector(`.sticky-note[data-note-id="${id}"]`);
            if (noteEl) {
                const msLeft = targetTimeMs - Date.now();
                const isUrgent = msLeft > 0 && msLeft <= 60 * 60 * 1000;
                noteEl.classList.toggle('urgent-note', isUrgent);
            }
        }

        // 清理已被刪除的 note
        for (const id of Object.keys(activeNotes)) {
            if (!currentIds.has(id)) {
                delete activeNotes[id];
                if (ringingNotes.has(id)) dismissAlarm(id);
            }
        }
    }

    // 主巡迴邏輯 (每秒檢查一次)
    setInterval(() => {
        // V3: 每秒從 Yjs 記憶體同步鬧鐘資料
        syncFromCache();

        const nowMs = Date.now();
        for (const [id, targetTimeMs] of Object.entries(activeNotes)) {
            if (nowMs >= targetTimeMs && !ringingNotes.has(id)) {
                triggerAlarm(id);
            }
        }
        
        // 保底：如果有響鈴，且卡片在此畫面上，但 UI 丟失了 .alarming，補回去
        for (const id of ringingNotes) {
            const noteEl = document.querySelector(`.sticky-note[data-note-id="${id}"]`);
            if (noteEl && !noteEl.classList.contains('alarming')) {
                noteEl.classList.add('alarming');
            }
        }
    }, 1000);

    // 初始化（保留原介面供 board_v2.js 呼叫，但不再需要 Firestore 監聽）
    function initGlobalListeners(/* boardsCache - 不再需要 */) {
        // V3: 鬧鐘資料完全由 setInterval + syncFromCache() 驅動
        // 此函數保留介面以避免呼叫端報錯
        console.log('[Alarm] V3 模式：鬧鐘已由 Yjs 記憶體驅動，無需 Firestore 監聽');
    }

    // 登出時清空
    function cleanup() {
        activeNotes = {};
        for (const id of ringingNotes) dismissAlarm(id);
        ringingNotes.clear();
        stopBeep();
    }

    // 供除錯用：查看目前運行中的計時器
    function debug() {
        const count = Object.keys(activeNotes).length;
        console.log(`[Alarm] 目前共有 ${count} 個計時器在背景運行中。`);
        
        const tableData = Object.keys(activeNotes).map(id => {
            const note = PostIt.Note ? PostIt.Note.getNote(id) : null;
            const content = note ? String(note.content || '').replace(/\n/g, ' ') : '找不到卡片內容';
            const alertTime = new Date(activeNotes[id]).toLocaleString();
            return {
                '卡片內容': content.length > 15 ? content.substring(0, 15) + '...' : content,
                '鬧鐘觸發時間': alertTime,
                '狀態': ringingNotes.has(id) ? '❗響鈴中' : '⏳等待中'
            };
        });
        
        if (count > 0) {
            console.table(tableData);
        }
        return activeNotes;
    }

    return { initGlobalListeners, triggerAlarm, dismissAlarm, debug, cleanup };
})();

