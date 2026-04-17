const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '../css/style.css');
let css = fs.readFileSync(cssPath, 'utf8');

const rootVars = `
/* === 統一的 Z-Index 階層表 === */
:root {
    --z-background: -1;          /* 網格背景/底層 UI */
    --z-base: 0;                 /* 最底層 */

    /* 1. 白板圖釘與便利貼層 100 ~ 499,999 */
    --z-connections: 50;         /* 畫線連線 */
    --z-note-base: 100;          /* 便利貼底層起點 */
    --z-note-max: 499999;        /* 便利貼最高層級（再高就會被重置） */

    /* 2. 主 UI 層 500,000 ~ 799,999 */
    --z-ui-base: 500000;         /* Toolbar, 側邊欄等白板基礎 UI */

    /* 3. 浮動操作層 800,000 ~ 899,999 */
    --z-fab: 800000;             /* 右下角 FAB 浮動按鈕群 */

    /* 4. 全域遮罩與焦點視窗層 900,000 ~ 9,000,000 */
    /* 這裡使用動態分配的主力交給 LayerManager */
    --z-overlay-base: 900000;    /* 暗幕的起始層級 */
    --z-modal-base: 900010;      /* 對話框起始層級 (由層級管理器動態上升) */

    /* 5. 系統最頂層 (不接受視窗覆蓋) */
    --z-toast: 9900000;          /* 系統通知 Toast (永遠在最上面) */
    --z-spinner: 9991000;        /* Loading 轉圈遮罩 */
    --z-cursor: 9999999;         /* 自訂游標 (印章/圖釘) */
}
`;

// Insert after :root if exists, or at the top
if (css.includes(':root {')) {
    css = css.replace(/:root\s*\{/, rootVars + '\n:root {');
} else {
    css = rootVars + '\n' + css;
}

// Global replacements
css = css.replace(/\.login-screen\s*\{[^}]*z-index:\s*9999;/, (match) => match.replace('z-index: 9999;', 'z-index: var(--z-modal-base);'));
css = css.replace(/\.board-sidebar\s*\{[^}]*z-index:\s*100;/, (match) => match.replace('z-index: 100;', 'z-index: var(--z-ui-base);'));
css = css.replace(/\.toolbar\s*\{[^}]*z-index:\s*800000;/, (match) => match.replace('z-index: 800000;', 'z-index: var(--z-ui-base);'));
css = css.replace(/\.mobile-tab-bar\s*\{[^}]*z-index:\s*50;/, (match) => match.replace('z-index: 50;', 'z-index: var(--z-ui-base);'));
css = css.replace(/svg#connections-svg\s*\{[^}]*z-index:\s*-1;/, (match) => match.replace('z-index: -1;', 'z-index: var(--z-background);'));
css = css.replace(/\.empty-hint\s*\{[^}]*z-index:\s*10;/, (match) => match.replace('z-index: 10;', 'z-index: var(--z-base);'));
css = css.replace(/\.fab-group\s*\{[^}]*z-index:\s*899999;\s*\/\*.*?\*\//, (match) => match.replace(/z-index:\s*899999;\s*\/\*.*?\*\//, 'z-index: var(--z-fab); /* 提升至最高級層級，確保永遠不會被便利貼遮擋 */'));
css = css.replace(/\.stamp-cursor\s*\{[^}]*z-index:\s*9000000;/, (match) => match.replace('z-index: 9000000;', 'z-index: var(--z-cursor);'));
css = css.replace(/\.account-modal-overlay\s*\{[^}]*z-index:\s*900000;/, (match) => match.replace('z-index: 900000;', 'z-index: var(--z-overlay-base);'));
css = css.replace(/\.account-modal\s*\{[^}]*z-index:\s*900001;/, (match) => match.replace('z-index: 900001;', 'z-index: var(--z-modal-base);'));
css = css.replace(/\.note-settings\s*\{[^}]*z-index:\s*9999999;\s*\/\*.*?\*\//, (match) => match.replace(/z-index:\s*9999999;\s*\/\*.*?\*\//, 'z-index: var(--z-modal-base); /* 由 LayerManager 動態提昇 */'));
css = css.replace(/\.settings-overlay\s*\{[^}]*z-index:\s*9999998;\s*\/\*.*?\*\//, (match) => match.replace(/z-index:\s*9999998;\s*\/\*.*?\*\//, 'z-index: var(--z-overlay-base); /* 由 LayerManager 動態提昇 */'));
css = css.replace(/\.spinner-overlay\s*\{[^}]*z-index:\s*9999;/, (match) => match.replace('z-index: 9999;', 'z-index: var(--z-spinner);'));
css = css.replace(/\.toast\s*\{[^}]*z-index:\s*9999999;/, (match) => match.replace('z-index: 9999999;', 'z-index: var(--z-toast);'));

// group-overlay in style.css:
css = css.replace(/\.group-overlay\s*\{[^}]*z-index:\s*900000;/, (match) => match.replace('z-index: 900000;', 'z-index: var(--z-overlay-base);'));

// Add unified-overlay class definition
const unifiedOverlay = `
/* === 統一背景模糊遮罩 === */
.unified-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: var(--z-overlay-base);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.35s ease;
}

.unified-overlay.visible {
    opacity: 1;
    pointer-events: auto;
}
`;

css += '\n' + unifiedOverlay;

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS updated successfully.');
