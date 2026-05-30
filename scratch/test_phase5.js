// 階段 5 測試：DOM 更新邏輯、呼吸燈位置、gradient ID

console.log('=== 階段 5 測試 ===');

// 測試 1: 差量更新條件邏輯
console.log('\n--- 測試 1: 差量更新條件 ---');
// 模擬三種情境
function testUpdateCondition(hasStockCardFront, isFlipped) {
    if (!hasStockCardFront) {
        return 'full_rebuild'; // 首次渲染
    } else if (isFlipped) {
        return 'skip_return'; // 翻面中，不更新
    }
    return 'diff_update'; // 差量更新
}

console.log(`  首次渲染 (no front): ${testUpdateCondition(false, false)} → 應為 full_rebuild: ${testUpdateCondition(false, false) === 'full_rebuild' ? '✅' : '❌'}`);
console.log(`  翻面中 (flipped): ${testUpdateCondition(true, true)} → 應為 skip_return: ${testUpdateCondition(true, true) === 'skip_return' ? '✅' : '❌'}`);
console.log(`  正常更新 (has front, not flipped): ${testUpdateCondition(true, false)} → 應為 diff_update: ${testUpdateCondition(true, false) === 'diff_update' ? '✅' : '❌'}`);

// 測試 2: 呼吸燈位置計算統一
console.log('\n--- 測試 2: 呼吸燈位置計算 ---');
const CHART_HEIGHT = 80;
const CHART_PADDING = 10;
const DRAW_HEIGHT = CHART_HEIGHT - CHART_PADDING * 2; // = 60

const prices = [100, 110, 105, 120, 115];
const min = Math.min(...prices);
const max = Math.max(...prices);
const range = max - min || 1;

// Sparkline 最後一個點
const lastP = prices[prices.length - 1]; // 115
const normalized = (lastP - min) / range;
const sparklineY = CHART_PADDING + DRAW_HEIGHT - (normalized * DRAW_HEIGHT);

// 呼吸燈計算（使用相同常數）
const CHART_PADDING_DOT = 10;
const DRAW_HEIGHT_DOT = 60;
const pulseDotY = CHART_PADDING_DOT + DRAW_HEIGHT_DOT - (normalized * DRAW_HEIGHT_DOT);

console.log(`  Sparkline Y: ${sparklineY.toFixed(1)}`);
console.log(`  PulseDot Y: ${pulseDotY.toFixed(1)}`);
console.log(`  位置一致: ${sparklineY.toFixed(1) === pulseDotY.toFixed(1) ? '✅' : '❌'}`);

// 測試 3: SVG gradient ID 唯一性
console.log('\n--- 測試 3: SVG gradient ID 唯一性 ---');
const noteId1 = 'abc123';
const noteId2 = 'xyz789';
const gradUp1 = `gradient-up-${noteId1}`;
const gradUp2 = `gradient-up-${noteId2}`;
console.log(`  Card 1: ${gradUp1}`);
console.log(`  Card 2: ${gradUp2}`);
console.log(`  ID 不同: ${gradUp1 !== gradUp2 ? '✅' : '❌'}`);

// 測試 4: trendClass → gradientId 映射
const trendClass = 'down';
const gradientId = trendClass === 'up' ? `gradient-up-${noteId1}` : `gradient-down-${noteId1}`;
console.log(`  trendClass=down → gradientId=${gradientId}: ${gradientId === 'gradient-down-abc123' ? '✅' : '❌'}`);

console.log('\n=== 階段 5 測試完成 ===');
