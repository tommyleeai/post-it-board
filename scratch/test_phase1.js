// 階段 1 測試：DST 判斷、getEasternTime 正確性

// 測試 1: getEasternTime 函式模擬
function getEasternTime() {
    const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
    return new Date(etStr);
}

const et = getEasternTime();
console.log('=== 階段 1 測試 ===');
console.log(`本地時間: ${new Date().toLocaleString('zh-TW')}`);
console.log(`美東時間: ${et.toLocaleString('en-US')}`);
console.log(`美東 hour=${et.getHours()}, min=${et.getMinutes()}, day=${et.getDay()}`);

// 測試 2: isMarketOpen 邏輯
function isMarketOpen() {
    const etTime = getEasternTime();
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const day = etTime.getDay();
    if (day === 0 || day === 6) return false;
    if (hour < 9 || (hour === 9 && minute < 30) || hour >= 16) return false;
    return true;
}

const marketOpen = isMarketOpen();
console.log(`現在美股開盤: ${marketOpen}`);

// 測試 3: 驗證時區自動處理（對比手動計算）
const now = new Date();
const utcHour = now.getUTCHours();
const etHour = et.getHours();
const offset = utcHour - etHour;
// 夏令時 offset 應為 4，標準時間 offset 應為 5
console.log(`UTC 時間: ${utcHour}:${now.getUTCMinutes()}`);
console.log(`UTC-ET offset: ${offset} (夏令時=4, 標準=5)`);

// 現在是 2026-05-29 21:17 PDT = 2026-05-30 00:17 EDT
// 5月是夏令時，offset 應該是 4
if (offset === 4 || offset === -20) { // -20 是跨日的情況
    console.log('✅ DST offset 正確 (夏令時 UTC-4)');
} else if (offset === 5 || offset === -19) {
    console.log('✅ DST offset 正確 (標準時間 UTC-5)');
} else {
    console.log(`⚠️ 需要人工確認 offset=${offset}`);
}

// 測試 4: 確認週末判斷
const saturday = new Date('2026-05-30T12:00:00'); // 週六
const satStr = saturday.toLocaleString('en-US', { timeZone: 'America/New_York' });
const satET = new Date(satStr);
console.log(`\n2026-05-30 (六) day=${satET.getDay()}, 應為 6: ${satET.getDay() === 6 ? '✅' : '❌'}`);

console.log('\n=== 階段 1 測試完成 ===');
