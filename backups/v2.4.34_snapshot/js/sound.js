// ============================================
// 音效引擎 — Web Audio API 程式化生成
// ============================================
// 所有音效皆由程式碼即時合成，零外部音檔依賴
PostIt.Sound = (function () {
    'use strict';

    let ctx = null;       // AudioContext（延遲建立，避免瀏覽器自動播放限制）
    let enabled = true;   // 全域開關
    let volume = 0.25;    // 全域音量 0~1

    // -------- 懶初始化 AudioContext --------
    function getCtx() {
        if (!ctx) {
            try {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (_) {
                enabled = false;
                return null;
            }
        }
        // 若被暫停（瀏覽器自動播放策略），嘗試恢復
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
    }

    // -------- 通用工具：建立增益節點 --------
    function makeGain(audioCtx, vol, fadeOutStart, fadeOutEnd) {
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(vol * volume, audioCtx.currentTime);
        if (fadeOutStart !== undefined) {
            gain.gain.setValueAtTime(vol * volume, audioCtx.currentTime + fadeOutStart);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + fadeOutEnd);
        }
        gain.connect(audioCtx.destination);
        return gain;
    }

    // ================================================================
    // 音效定義
    // ================================================================

    // 🧲 重疊偵測 — 柔合低頻共振「嗡～」
    function groupHover() {
        const c = getCtx(); if (!c) return;
        const osc = c.createOscillator();
        const gain = makeGain(c, 0.15, 0.15, 0.35);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, c.currentTime);
        osc.frequency.linearRampToValueAtTime(180, c.currentTime + 0.3);
        osc.connect(gain);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.35);
    }

    // ✅ 吸附成功 — 清脆「啪嗒」磁鐵聲
    function groupSnap() {
        const c = getCtx(); if (!c) return;
        // 高頻 click
        const osc1 = c.createOscillator();
        const gain1 = makeGain(c, 0.3, 0, 0.08);
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(1800, c.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(400, c.currentTime + 0.06);
        osc1.connect(gain1);
        osc1.start(c.currentTime);
        osc1.stop(c.currentTime + 0.08);

        // 低頻 bounce
        const osc2 = c.createOscillator();
        const gain2 = makeGain(c, 0.2, 0.03, 0.15);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(300, c.currentTime + 0.03);
        osc2.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.12);
        osc2.connect(gain2);
        osc2.start(c.currentTime + 0.03);
        osc2.stop(c.currentTime + 0.15);
    }

    // 📦 降落成組 — 軟著陸「噗」
    function groupLand() {
        const c = getCtx(); if (!c) return;
        // 白噪音 burst + 低通
        const bufferSize = c.sampleRate * 0.15;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // 漸弱
        }
        const noise = c.createBufferSource();
        noise.buffer = buffer;

        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, c.currentTime);
        filter.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.15);

        const gain = makeGain(c, 0.25, 0.05, 0.2);
        noise.connect(filter);
        filter.connect(gain);
        noise.start(c.currentTime);
        noise.stop(c.currentTime + 0.2);

        // 加一個低頻 thud
        const osc = c.createOscillator();
        const gain2 = makeGain(c, 0.2, 0, 0.15);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, c.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.1);
        osc.connect(gain2);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.15);
    }

    // 🃏 撲克牌展開 — 連續短促 click「唰～」
    function groupFan(count) {
        const c = getCtx(); if (!c) return;
        const n = count || 3;
        for (let i = 0; i < n; i++) {
            const delay = i * 0.05; // 每張間隔 50ms
            const osc = c.createOscillator();
            const gain = makeGain(c, 0.12);
            gain.gain.setValueAtTime(0.12 * volume, c.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + 0.04);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(2000 + i * 200, c.currentTime + delay);
            osc.frequency.exponentialRampToValueAtTime(800, c.currentTime + delay + 0.03);
            osc.connect(gain);
            osc.start(c.currentTime + delay);
            osc.stop(c.currentTime + delay + 0.04);
        }
    }

    // 🃏 收合 — 反向 click「刷～」
    function groupCollapse(count) {
        const c = getCtx(); if (!c) return;
        const n = count || 3;
        for (let i = 0; i < n; i++) {
            const delay = i * 0.04;
            const osc = c.createOscillator();
            const gain = makeGain(c, 0.1);
            gain.gain.setValueAtTime(0.1 * volume, c.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + 0.035);
            osc.type = 'triangle';
            // 反向：頻率由低到高
            osc.frequency.setValueAtTime(800 + i * 100, c.currentTime + delay);
            osc.frequency.exponentialRampToValueAtTime(1800, c.currentTime + delay + 0.03);
            osc.connect(gain);
            osc.start(c.currentTime + delay);
            osc.stop(c.currentTime + delay + 0.035);
        }
    }

    // ✂️ 拆出單張 — 短促撕裂 + 彈跳
    function groupDetach() {
        const c = getCtx(); if (!c) return;
        // 噪音 burst（撕裂感）
        const bufferSize = c.sampleRate * 0.08;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = c.createBufferSource();
        noise.buffer = buffer;
        const filter = c.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2000;
        const gain = makeGain(c, 0.2, 0, 0.1);
        noise.connect(filter);
        filter.connect(gain);
        noise.start(c.currentTime);
        noise.stop(c.currentTime + 0.1);

        // 彈跳音
        const osc = c.createOscillator();
        const gain2 = makeGain(c, 0.15, 0.05, 0.18);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, c.currentTime + 0.05);
        osc.frequency.exponentialRampToValueAtTime(200, c.currentTime + 0.15);
        osc.connect(gain2);
        osc.start(c.currentTime + 0.05);
        osc.stop(c.currentTime + 0.18);
    }

    // 💥 解散群組 — 多張紙散落「嘩啦」
    function groupDisband() {
        const c = getCtx(); if (!c) return;
        // 連續散落 clicks + 噪音尾巴
        for (let i = 0; i < 5; i++) {
            const delay = i * 0.06 + Math.random() * 0.03;
            const osc = c.createOscillator();
            const gain = makeGain(c, 0.1);
            gain.gain.setValueAtTime(0.1 * volume, c.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + 0.05);
            osc.type = 'square';
            osc.frequency.setValueAtTime(1200 + Math.random() * 800, c.currentTime + delay);
            osc.frequency.exponentialRampToValueAtTime(300, c.currentTime + delay + 0.04);
            osc.connect(gain);
            osc.start(c.currentTime + delay);
            osc.stop(c.currentTime + delay + 0.05);
        }
        // 噪音尾巴
        const bufferSize = c.sampleRate * 0.2;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
        }
        const noise = c.createBufferSource();
        noise.buffer = buffer;
        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1500;
        filter.Q.value = 0.5;
        const gain = makeGain(c, 0.08, 0.1, 0.3);
        noise.connect(filter);
        filter.connect(gain);
        noise.start(c.currentTime + 0.1);
        noise.stop(c.currentTime + 0.35);
    }

    // 🚫 群組已滿 — 低音負面提示
    function groupFull() {
        const c = getCtx(); if (!c) return;
        const osc = c.createOscillator();
        const gain = makeGain(c, 0.2, 0.15, 0.3);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, c.currentTime);
        osc.frequency.linearRampToValueAtTime(150, c.currentTime + 0.25);
        osc.connect(gain);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + 0.3);
    }

    // ================================================================
    // 公開 API
    // ================================================================
    function play(name, opts) {
        if (!enabled) return;
        const map = {
            group_hover:    groupHover,
            group_snap:     groupSnap,
            group_land:     groupLand,
            group_fan:      groupFan,
            group_collapse: groupCollapse,
            group_detach:   groupDetach,
            group_disband:  groupDisband,
            group_full:     groupFull
        };
        const fn = map[name];
        if (fn) {
            try { fn(opts); } catch (_) {}
        }
    }

    function setEnabled(val) { enabled = !!val; }
    function isEnabled() { return enabled; }
    function setVolume(val) { volume = Math.max(0, Math.min(1, val)); }
    function getVolume() { return volume; }

    return { play, setEnabled, isEnabled, setVolume, getVolume };
})();
