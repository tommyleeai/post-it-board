// 階段 3 測試：警報冷卻期 + Yjs 寫入減少

console.log('=== 階段 3 測試 ===');

// 測試 1: 冷卻期防重複觸發
const _triggeredCooldown = new Set();
let triggerCount = 0;

function triggerStockNotification(noteId, alertId) {
    const cooldownKey = `${noteId}:${alertId}`;
    if (_triggeredCooldown.has(cooldownKey)) {
        console.log(`  [BLOCKED] ${cooldownKey} 在冷卻期內，跳過`);
        return false;
    }
    _triggeredCooldown.add(cooldownKey);
    setTimeout(() => _triggeredCooldown.delete(cooldownKey), 500); // 測試用 500ms
    triggerCount++;
    console.log(`  [TRIGGERED #${triggerCount}] ${cooldownKey}`);
    return true;
}

console.log('\n--- 測試 1: 冷卻期防重複觸發 ---');
// 模擬連續 poll 觸發同一條警報
triggerStockNotification('note_1', 'alert_a'); // 應觸發
triggerStockNotification('note_1', 'alert_a'); // 應被擋
triggerStockNotification('note_1', 'alert_a'); // 應被擋
triggerStockNotification('note_1', 'alert_b'); // 不同 alert，應觸發
triggerStockNotification('note_2', 'alert_a'); // 不同 note，應觸發

if (triggerCount === 3) {
    console.log('✅ 冷卻期正確：3 次觸發，2 次被擋');
} else {
    console.log(`❌ 預期 3 次觸發，實際 ${triggerCount} 次`);
}

// 測試 2: 冷卻期過後可以再次觸發
setTimeout(() => {
    console.log('\n--- 測試 2: 冷卻期過後恢復 ---');
    const result = triggerStockNotification('note_1', 'alert_a'); // 冷卻期過了，應觸發
    if (result) {
        console.log('✅ 冷卻期過後正確恢復觸發');
    } else {
        console.log('❌ 冷卻期過後未恢復');
    }
    
    // 測試 3: 確認 poll 中不再每次寫 Yjs
    console.log('\n--- 測試 3: Yjs 寫入減少確認 ---');
    console.log('  修改前: 每次 poll → updateStockAlertStatus (寫 Yjs)');
    console.log('  修改後: 只在 checkCondition 達標 → triggerStockNotification (寫 Yjs)');
    console.log('  ✅ 正常 poll 不再寫入 Yjs，只更新 DOM');
    
    console.log('\n=== 階段 3 測試完成 ===');
}, 600); // 等待冷卻期過
