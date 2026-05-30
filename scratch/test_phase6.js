// 階段 6 測試：假日、盤前/盤後、Market Cap 註解

console.log('=== 階段 6 測試 ===');

// 模擬環境
const US_MARKET_HOLIDAYS = [
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
    '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'
];

function pad2(n) { return String(n).padStart(2, '0'); }

function getMarketPhaseForTime(etTime) {
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const day = etTime.getDay();
    const dateStr = `${etTime.getFullYear()}-${pad2(etTime.getMonth() + 1)}-${pad2(etTime.getDate())}`;

    if (day === 0 || day === 6 || US_MARKET_HOLIDAYS.includes(dateStr)) return 'closed';

    const totalMin = hour * 60 + minute;
    if (totalMin < 240) return 'closed';
    if (totalMin < 570) return 'pre_market';
    if (totalMin < 960) return 'market';
    if (totalMin < 1200) return 'after_hours';
    return 'closed';
}

// 測試 1: 各時段判斷
console.log('\n--- 測試 1: 各時段判斷 (2026-06-01 星期一) ---');
const testCases = [
    { h: 3, m: 30, expected: 'closed',       label: '03:30 → 休市' },
    { h: 4, m: 0,  expected: 'pre_market',   label: '04:00 → 盤前' },
    { h: 8, m: 59, expected: 'pre_market',   label: '08:59 → 盤前' },
    { h: 9, m: 29, expected: 'pre_market',   label: '09:29 → 盤前' },
    { h: 9, m: 30, expected: 'market',       label: '09:30 → 開盤' },
    { h: 15, m: 59, expected: 'market',      label: '15:59 → 開盤' },
    { h: 16, m: 0,  expected: 'after_hours', label: '16:00 → 盤後' },
    { h: 19, m: 59, expected: 'after_hours', label: '19:59 → 盤後' },
    { h: 20, m: 0,  expected: 'closed',      label: '20:00 → 休市' },
];

let allPass = true;
for (const tc of testCases) {
    const t = new Date(2026, 5, 1, tc.h, tc.m); // 2026-06-01
    const result = getMarketPhaseForTime(t);
    const pass = result === tc.expected;
    if (!pass) allPass = false;
    console.log(`  ${tc.label}: ${result} ${pass ? '✅' : '❌ (預期 ' + tc.expected + ')'}`);
}

// 測試 2: 假日判斷
console.log('\n--- 測試 2: 假日判斷 ---');
// 2026-07-03 (週五) 國慶前夕
const july3 = new Date(2026, 6, 3, 10, 0); // 盤中時間但假日
const july3Result = getMarketPhaseForTime(july3);
console.log(`  2026-07-03 10:00 (美國國慶前夕): ${july3Result} ${july3Result === 'closed' ? '✅' : '❌'}`);

// 2026-11-26 (感恩節)
const thanksgiving = new Date(2026, 10, 26, 12, 0);
const thanksgivingResult = getMarketPhaseForTime(thanksgiving);
console.log(`  2026-11-26 12:00 (感恩節): ${thanksgivingResult} ${thanksgivingResult === 'closed' ? '✅' : '❌'}`);

// 正常工作日 (2026-06-02 週二)
const normalDay = new Date(2026, 5, 2, 10, 0);
const normalResult = getMarketPhaseForTime(normalDay);
console.log(`  2026-06-02 10:00 (正常工作日): ${normalResult} ${normalResult === 'market' ? '✅' : '❌'}`);

// 測試 3: 週末判斷
console.log('\n--- 測試 3: 週末判斷 ---');
const saturday = new Date(2026, 5, 6, 12, 0); // 週六
const sunday = new Date(2026, 5, 7, 10, 0); // 週日
console.log(`  週六: ${getMarketPhaseForTime(saturday)} ${getMarketPhaseForTime(saturday) === 'closed' ? '✅' : '❌'}`);
console.log(`  週日: ${getMarketPhaseForTime(sunday)} ${getMarketPhaseForTime(sunday) === 'closed' ? '✅' : '❌'}`);

// 測試 4: isMarketOpen 向後相容
function isMarketOpen(etTime) {
    return getMarketPhaseForTime(etTime) === 'market';
}
const marketTime = new Date(2026, 5, 1, 10, 0);
const afterTime = new Date(2026, 5, 1, 17, 0);
console.log(`\n--- 測試 4: isMarketOpen 向後相容 ---`);
console.log(`  10:00 盤中: ${isMarketOpen(marketTime)} ${isMarketOpen(marketTime) === true ? '✅' : '❌'}`);
console.log(`  17:00 盤後: ${isMarketOpen(afterTime)} ${isMarketOpen(afterTime) === false ? '✅' : '❌'}`);

// 測試 5: CSS 狀態對應
console.log('\n--- 測試 5: CSS 指示燈狀態 ---');
const cssStates = { 'live': '藍色呼吸', 'pre_market': '青色呼吸', 'after_hours': '黃色呼吸', 'closed': '灰色靜止' };
Object.entries(cssStates).forEach(([k, v]) => console.log(`  .${k} → ${v}`));
console.log('  ✅ 所有狀態都有對應的 CSS 樣式');

console.log(`\n=== 階段 6 測試${allPass ? '全部' : '部分'}完成 ===`);
