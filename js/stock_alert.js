// ============================================
// 股價監控引擎 (Stock Alert Module)
// 從 Yjs 記憶體偵測有 stockAlert 的卡片，
// 透過好物報報 API 代理查詢即時報價，達標時觸發通知。
// ============================================
PostIt.StockAlert = (function () {
    'use strict';

    // --- 設定 ---
    const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://127.0.0.1:8000'
        : 'https://deals.tommylee.ai';
    const STORAGE_KEY_FREQ_MARKET = 'stockAlert_freq_market';   // 開盤輪詢頻率
    const STORAGE_KEY_FREQ_AFTER = 'stockAlert_freq_after';     // 盤後輪詢頻率
    const STORAGE_KEY_TOKEN = 'stockAlert_apiToken';            // API Token

    // 輪詢頻率選項（毫秒）
    const FREQ_OPTIONS = {
        'none': 0,
        '1min': 60 * 1000,
        '5min': 5 * 60 * 1000,
        '1hour': 60 * 60 * 1000
    };

    let pollTimer = null;
    let isRunning = false;

    // --- 設定讀寫 ---
    function getMarketFreq() {
        return localStorage.getItem(STORAGE_KEY_FREQ_MARKET) || '1min';
    }
    function getAfterHoursFreq() {
        return localStorage.getItem(STORAGE_KEY_FREQ_AFTER) || '5min';
    }
    // 內建 token（與 deal_notifier 共用的 external API token）
    const DEFAULT_API_TOKEN = 'y9oBzyD2kDdXaQEKopp-ZQsan2uTXPes3PkFEnvdRfo';

    function getApiToken() {
        // 優先讀使用者自訂 token，否則用內建預設
        return localStorage.getItem(STORAGE_KEY_TOKEN) || DEFAULT_API_TOKEN;
    }
    function setMarketFreq(freq) {
        localStorage.setItem(STORAGE_KEY_FREQ_MARKET, freq);
        restartPolling();
    }
    function setAfterHoursFreq(freq) {
        localStorage.setItem(STORAGE_KEY_FREQ_AFTER, freq);
        restartPolling();
    }
    function setApiToken(token) {
        localStorage.setItem(STORAGE_KEY_TOKEN, token);
    }

    // --- 美股開盤判斷 ---
    // 美東 9:30-16:00（含盤前盤後大概 4:00-20:00）
    // 這裡用簡化版：開盤 = 美東 9:30-16:00
    function isMarketOpen() {
        const now = new Date();
        // 取得美東時間（UTC-5，夏令時 UTC-4）
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        // 簡化：假設夏令時（3月-11月）
        const month = now.getMonth() + 1;
        const isDST = month >= 3 && month <= 11;
        const etOffset = isDST ? -4 : -5;
        const etTime = new Date(utc + etOffset * 3600000);
        const hour = etTime.getHours();
        const minute = etTime.getMinutes();
        const day = etTime.getDay(); // 0=Sun, 6=Sat

        // 週末不開盤
        if (day === 0 || day === 6) return false;
        // 9:30 - 16:00
        if (hour < 9 || (hour === 9 && minute < 30) || hour >= 16) return false;
        return true;
    }

    // --- 取得當前應使用的輪詢間隔 ---
    function getCurrentInterval() {
        const freq = isMarketOpen() ? getMarketFreq() : getAfterHoursFreq();
        return FREQ_OPTIONS[freq] || 0;
    }

    // --- 收集需要監控的 stockAlert ---
    function getActiveAlerts() {
        if (!PostIt.Note || typeof PostIt.Note.getCache !== 'function') return [];
        const cache = PostIt.Note.getCache();
        const alerts = [];
        for (const [id, note] of Object.entries(cache)) {
            if (note.stockAlert && note.stockAlert.status === 'watching' && note.stockAlert.symbol) {
                alerts.push({ noteId: id, ...note.stockAlert });
            }
        }
        return alerts;
    }

    // --- 批次查詢報價 ---
    let _lastErrorToast = 0; // 防止每分鐘重複彈錯誤 Toast
    const ERROR_TOAST_COOLDOWN = 300000; // 5 分鐘只彈一次

    function showErrorOnce(msg) {
        const now = Date.now();
        if (now - _lastErrorToast > ERROR_TOAST_COOLDOWN) {
            _lastErrorToast = now;
            if (typeof PostIt.Board !== 'undefined') {
                PostIt.Board.showToast(msg, 'error', null, 8000);
            }
        }
    }

    async function fetchQuotes(symbols) {
        const token = getApiToken();
        if (!token) {
            console.warn('[StockAlert] 未設定 API Token，無法查詢報價');
            showErrorOnce('📈 股價監控失敗：未設定 API Token。請到設定頁面填入好物報報 API Token。');
            return {};
        }

        try {
            const url = `${API_BASE}/api/stock/batch?symbols=${symbols.join(',')}&token=${encodeURIComponent(token)}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                console.error('[StockAlert] API 回應錯誤:', resp.status);
                if (resp.status === 401) {
                    showErrorOnce('📈 股價監控失敗：API Token 無效，請確認 Token 是否正確。');
                } else if (resp.status === 503) {
                    showErrorOnce('📈 股價監控失敗：伺服器尚未設定 Finnhub API Key。');
                } else {
                    showErrorOnce(`📈 股價監控暫時無法使用（HTTP ${resp.status}），將自動重試。`);
                }
                return {};
            }
            const data = await resp.json();
            return data.quotes || {};
        } catch (e) {
            console.error('[StockAlert] 查詢報價失敗:', e);
            showErrorOnce('📈 股價監控：無法連線到報價伺服器，請確認網路連線。');
            return {};
        }
    }

    // --- 條件檢查 ---
    function checkCondition(alert, currentPrice) {
        switch (alert.condition) {
            case '>=': return currentPrice >= alert.targetPrice;
            case '<=': return currentPrice <= alert.targetPrice;
            default: return false;
        }
    }

    // --- 觸發通知 ---
    function triggerStockNotification(noteId, alert, currentPrice) {
        const direction = alert.condition === '>=' ? '漲到' : '跌到';
        const msg = `📈 ${alert.symbol} 已${direction} $${currentPrice.toFixed(2)}！（目標: $${alert.targetPrice}）`;

        // 更新狀態為 triggered
        if (PostIt.Note && PostIt.Note.updateStockAlertField) {
            PostIt.Note.updateStockAlertField(noteId, 'status', 'triggered');
            PostIt.Note.updateStockAlertField(noteId, 'triggeredAt', new Date().toISOString());
            PostIt.Note.updateStockAlertField(noteId, 'lastPrice', currentPrice);
        }

        // 視覺提示：Toast
        if (typeof PostIt.Board !== 'undefined') {
            PostIt.Board.showToast(msg, 'info', null, 0); // 常駐
        }

        // 聲音提示：借用 alarm 的 beep
        if (typeof PostIt.Alarm !== 'undefined') {
            // 用 alarm 系統的震動+音效
            const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
            if (noteEl) {
                noteEl.classList.add('alarming');
            }
        }

        // TTS 語音播報
        try {
            const utterance = new SpeechSynthesisUtterance(`注意！${alert.symbol} 已達到目標價格 ${currentPrice.toFixed(0)} 美元！`);
            utterance.lang = 'zh-TW';
            utterance.rate = 1.1;
            speechSynthesis.speak(utterance);
        } catch (e) { /* 無語音合成也不影響 */ }

        console.log(`[StockAlert] 🎯 觸發: ${msg}`);
    }

    // --- 主輪詢邏輯 ---
    async function poll() {
        const alerts = getActiveAlerts();
        if (alerts.length === 0) return;

        // 收集不重複的 symbol
        const symbols = [...new Set(alerts.map(a => a.symbol))];
        const quotes = await fetchQuotes(symbols);

        const now = new Date().toISOString();

        for (const alert of alerts) {
            const quote = quotes[alert.symbol];
            if (!quote || !quote.price) continue;

            const currentPrice = quote.price;

            // 更新最新報價和查詢時間
            if (PostIt.Note && PostIt.Note.updateStockAlertField) {
                PostIt.Note.updateStockAlertField(alert.noteId, 'lastPrice', currentPrice);
                PostIt.Note.updateStockAlertField(alert.noteId, 'lastChecked', now);
            }

            // 更新卡片上的即時報價 badge
            updatePriceBadge(alert.noteId, alert, currentPrice);

            // 檢查是否達標
            if (checkCondition(alert, currentPrice)) {
                triggerStockNotification(alert.noteId, alert, currentPrice);
            }
        }
    }

    // --- 卡片報價 badge ---
    function updatePriceBadge(noteId, alert, currentPrice) {
        const noteEl = document.querySelector(`.sticky-note[data-note-id="${noteId}"]`);
        if (!noteEl) return;

        let badge = noteEl.querySelector('.stock-price-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'stock-price-badge';
            noteEl.appendChild(badge);
        }

        const diff = currentPrice - (alert.targetPrice || 0);
        const isUp = diff >= 0;
        const arrow = isUp ? '▲' : '▼';
        const colorClass = isUp ? 'stock-up' : 'stock-down';

        badge.className = `stock-price-badge ${colorClass}`;
        badge.innerHTML = `<span class="stock-symbol">${alert.symbol}</span> <span class="stock-price">$${currentPrice.toFixed(2)}</span> <span class="stock-arrow">${arrow}</span>`;
        badge.title = `目標: $${alert.targetPrice} | 條件: ${alert.condition}`;
    }

    // --- 啟動/停止 ---
    function startPolling() {
        stopPolling();
        const interval = getCurrentInterval();
        if (interval <= 0) {
            console.log('[StockAlert] 輪詢已關閉 (freq=none)');
            return;
        }

        isRunning = true;
        // 立即查一次
        poll();
        // 設定定期輪詢
        pollTimer = setInterval(() => {
            // 動態切換開盤/盤後頻率
            const newInterval = getCurrentInterval();
            if (newInterval <= 0) {
                stopPolling();
                return;
            }
            poll();
        }, interval);

        const freqLabel = isMarketOpen() ? getMarketFreq() : getAfterHoursFreq();
        console.log(`[StockAlert] 輪詢啟動，頻率: ${freqLabel}，間隔: ${interval / 1000}s`);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        isRunning = false;
    }

    function restartPolling() {
        if (getActiveAlerts().length > 0) {
            startPolling();
        } else {
            stopPolling();
        }
    }

    // --- 初始化（由 board_v2.js 呼叫）---
    function init() {
        console.log('[StockAlert] 初始化股價監控引擎');
        // 每 30 秒檢查是否有新的 alert 需要監控
        setInterval(() => {
            const alerts = getActiveAlerts();
            if (alerts.length > 0 && !isRunning) {
                startPolling();
            } else if (alerts.length === 0 && isRunning) {
                stopPolling();
            }
        }, 30000);

        // 初始啟動
        if (getActiveAlerts().length > 0) {
            startPolling();
        }
    }

    // --- 除錯 ---
    function debug() {
        const alerts = getActiveAlerts();
        console.log(`[StockAlert] 監控中: ${alerts.length} 支股票`);
        if (alerts.length > 0) {
            console.table(alerts.map(a => ({
                '卡片ID': a.noteId.substring(0, 8) + '...',
                '代碼': a.symbol,
                '目標': `${a.condition} $${a.targetPrice}`,
                '最新報價': a.lastPrice ? `$${a.lastPrice}` : '未查詢',
                '上次查詢': a.lastChecked || '未查詢'
            })));
        }
        console.log(`[StockAlert] 輪詢狀態: ${isRunning ? '運行中' : '停止'}`);
        console.log(`[StockAlert] 開盤頻率: ${getMarketFreq()}, 盤後頻率: ${getAfterHoursFreq()}`);
        console.log(`[StockAlert] 當前市場: ${isMarketOpen() ? '開盤中' : '已收盤'}`);
        return { alerts, isRunning, marketOpen: isMarketOpen() };
    }

    function cleanup() {
        stopPolling();
    }

    return {
        init, cleanup, debug, poll,
        startPolling, stopPolling,
        setMarketFreq, setAfterHoursFreq, setApiToken,
        getMarketFreq, getAfterHoursFreq, getApiToken,
        getActiveAlerts, isMarketOpen,
        FREQ_OPTIONS
    };
})();

// 頁面載入後延遲 5 秒自動初始化（等 Yjs 同步完成）
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        setTimeout(() => {
            if (PostIt.StockAlert) PostIt.StockAlert.init();
        }, 5000);
    });
}
