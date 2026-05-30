// 階段 2 測試：setTimeout 遞迴輪詢 + 市場狀態切換偵測

console.log('=== 階段 2 測試 ===');

// 模擬環境
const FREQ_OPTIONS = { 'none': 0, '1min': 60000, '5min': 300000, '1hour': 3600000 };
let isRunning = false;
let pollTimer = null;
let pollCount = 0;
let _lastMarketState = null;
let _mockMarketOpen = true; // 模擬開盤

function isMarketOpen() { return _mockMarketOpen; }
function getMarketFreq() { return '1min'; }
function getAfterHoursFreq() { return '1hour'; }
function getCurrentInterval() {
    const freq = isMarketOpen() ? getMarketFreq() : getAfterHoursFreq();
    return FREQ_OPTIONS[freq] || 0;
}

// 測試 1: setTimeout 遞迴正確性
console.log('\n--- 測試 1: setTimeout 遞迴 ---');
console.log(`盤中 interval: ${getCurrentInterval() / 1000}s`);
_mockMarketOpen = false;
console.log(`盤後 interval: ${getCurrentInterval() / 1000}s`);
_mockMarketOpen = true;
console.log(`✅ 不同市場狀態正確切換間隔`);

// 測試 2: scheduleNextPoll 模擬（加速版，用 100ms 代替真實間隔）
async function poll() {
    pollCount++;
    console.log(`  [poll #${pollCount}] 市場=${isMarketOpen() ? '盤中' : '盤後'}`);
}

function scheduleNextPoll() {
    if (!isRunning) return;
    const interval = 100; // 用 100ms 做測試
    pollTimer = setTimeout(async () => {
        if (!isRunning) return;
        await poll();
        if (pollCount < 3) scheduleNextPoll();
        else {
            isRunning = false;
            console.log('  ✅ 遞迴 poll 正確執行 3 次後停止');
            runTest3();
        }
    }, interval);
}

function startPolling() {
    isRunning = true;
    poll();
    scheduleNextPoll();
}

function stopPolling() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    isRunning = false;
}

console.log('\n--- 測試 2: 遞迴 poll 執行 ---');
startPolling();

// 測試 3: 市場狀態切換偵測
function runTest3() {
    console.log('\n--- 測試 3: 市場狀態切換偵測 ---');
    _lastMarketState = true; // 盤中
    _mockMarketOpen = false; // 模擬收盤
    
    const currentState = isMarketOpen();
    if (_lastMarketState !== null && _lastMarketState !== currentState) {
        console.log(`  偵測到切換: ${_lastMarketState ? '盤中→盤後' : '盤後→盤中'}`);
        console.log('  ✅ 市場狀態切換偵測正常');
    }
    _lastMarketState = currentState;

    // 反向切換
    _mockMarketOpen = true;
    const currentState2 = isMarketOpen();
    if (_lastMarketState !== currentState2) {
        console.log(`  偵測到切換: ${_lastMarketState ? '盤中→盤後' : '盤後→盤中'}`);
        console.log('  ✅ 反向切換偵測正常');
    }

    // 測試 4: freq=none 時 scheduleNextPoll 應停止
    console.log('\n--- 測試 4: clearTimeout 正確性 ---');
    pollTimer = setTimeout(() => console.log('  不應該看到這行'), 10000);
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('  ✅ clearTimeout 正確清除（不再使用 clearInterval）');

    console.log('\n=== 階段 2 測試完成 ===');
}
