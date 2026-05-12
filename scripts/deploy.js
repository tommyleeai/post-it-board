const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// 自動化部署與版本管理工具
// ============================================

const rootDir = path.join(__dirname, '..');
const paths = {
    changelogJs: path.join(rootDir, 'js', 'changelog.js'),
    indexHtml: path.join(rootDir, 'index.html'),
    adminHtml: path.join(rootDir, 'admin.html'),
    packageJson: path.join(rootDir, 'package.json'),
    changelogMd: path.join(rootDir, 'docs', 'CHANGELOG.md'),
    backups: path.join(rootDir, 'backups')
};

function log(msg) { console.log(`[Deploy] ${msg}`); }
function error(msg) { console.error(`[Deploy] ERROR: ${msg}`); process.exit(1); }

// 1. 取得目前版本
let packageData = JSON.parse(fs.readFileSync(paths.packageJson, 'utf8'));
let currentVer = packageData.version; 

// 檢查 changelog.js 的版本 (通常這裡才是真實顯示的版號)
const changelogJsContent = fs.readFileSync(paths.changelogJs, 'utf8');
const verMatch = changelogJsContent.match(/const CURRENT_VERSION = '(.+?)';/);
if (verMatch) {
    currentVer = verMatch[1];
}

log(`目前版本: ${currentVer}`);

// 2. 解析新版本與訊息
let newVer = process.argv[2];
let message = process.argv[3];

if (!newVer || newVer === 'patch') {
    const parts = currentVer.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        log(`⚠️ 警告：目前版本 "${currentVer}" 不符合 X.Y.Z 格式，無法自動遞增。請手動指定目標版本號，例如: node scripts/deploy.js 2.1.0 "更新說明"`);
        process.exit(1);
    }
    parts[2]++;
    newVer = parts.join('.');
} else if (newVer === 'minor') {
    const parts = currentVer.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        log(`⚠️ 警告：目前版本 "${currentVer}" 不符合 X.Y.Z 格式，無法自動遞增。請手動指定目標版本號。`);
        process.exit(1);
    }
    parts[1]++;
    parts[2] = 0;
    newVer = parts.join('.');
} else if (newVer === 'major') {
    const parts = currentVer.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        log(`⚠️ 警告：目前版本 "${currentVer}" 不符合 X.Y.Z 格式，無法自動遞增。請手動指定目標版本號。`);
        process.exit(1);
    }
    parts[0]++;
    parts[1] = 0;
    parts[2] = 0;
    newVer = parts.join('.');
}

// 最終驗證：確保 newVer 是合法的 semver 格式
const finalParts = newVer.split('.').map(Number);
if (finalParts.length !== 3 || finalParts.some(isNaN)) {
    error(`目標版本 "${newVer}" 不符合 X.Y.Z 格式（例如 2.0.15）。請修正後重試。`);
}

if (!message || message.trim() === '' || message.trim() === '\\' || message.length < 2) {
    // 自動偵測修改的檔案來產生有意義的更新描述
    message = '';
    try {
        const diffFiles = execSync('git diff --name-only HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
        if (diffFiles) {
            const files = diffFiles.split('\n')
                .filter(f => !f.startsWith('backups/') && !f.includes('changelog') && !f.includes('package.json'))
                .map(f => path.basename(f, path.extname(f)));
            const unique = [...new Set(files)].slice(0, 3);
            if (unique.length > 0) {
                message = `更新 ${unique.join('、')} 模組`;
            }
        }
    } catch (e) { /* ignore */ }
    if (!message) {
        message = `v${newVer} 維護更新`;
    }
    log(`⚠️ 未指定或無效的更新訊息，已自動產生：「${message}」`);
    log(`   建議使用: node scripts/deploy.js [版本] "詳細的更新描述"`);
}

log(`即將更新至版本: ${newVer}`);
log(`更新訊息: ${message}`);

// 3. 更新各個檔案
try {
    // A. Update package.json
    packageData.version = newVer;
    fs.writeFileSync(paths.packageJson, JSON.stringify(packageData, null, 2) + '\n', 'utf8');
    log('已更新 package.json');

    // B. Update js/changelog.js
    let newChangelogJs = changelogJsContent.replace(
        /const CURRENT_VERSION = '.+?';/,
        `const CURRENT_VERSION = '${newVer}';`
    );
    fs.writeFileSync(paths.changelogJs, newChangelogJs, 'utf8');
    log('已更新 js/changelog.js');

    // C. Update index.html
    let indexHtml = fs.readFileSync(paths.indexHtml, 'utf8');
    // 更新版號文字
    indexHtml = indexHtml.replace(
        /id="app-version" class="app-version" title=".*?">v.*?<\/span>/,
        `id="app-version" class="app-version" title="查看系統更新與版本紀錄">v${newVer}</span>`
    );
    // 更新 CSS 版本快取參數 (隨機產生或累加)
    const cssVerMatch = indexHtml.match(/href="css\/style\.css\?v=(.*?)"/);
    if (cssVerMatch) {
        const oldCssVer = parseFloat(cssVerMatch[1]);
        const newCssVer = (oldCssVer + 0.01).toFixed(2);
        indexHtml = indexHtml.replace(`css/style.css?v=${cssVerMatch[1]}`, `css/style.css?v=${newCssVer}`);
        log(`已更新 CSS 快取版本至 v${newCssVer}`);
    }

    // 更新所有 JS 檔案的快取參數
    indexHtml = indexHtml.replace(/src="js\/([^"]+)\.js(\?v=[0-9.]+)?"/g, `src="js/$1.js?v=${newVer}"`);
    log('已更新 JS 檔案快取版本');

    fs.writeFileSync(paths.indexHtml, indexHtml, 'utf8');
    log('已更新 index.html');

    // E. Update admin.html
    if (fs.existsSync(paths.adminHtml)) {
        let adminHtml = fs.readFileSync(paths.adminHtml, 'utf8');
        adminHtml = adminHtml.replace(/href="css\/([^"]+)\.css(\?v=[0-9.]+)?"/g, `href="css/$1.css?v=${newVer}"`);
        adminHtml = adminHtml.replace(/src="js\/([^"]+)\.js(\?v=[0-9.]+)?"/g, `src="js/$1.js?v=${newVer}"`);
        fs.writeFileSync(paths.adminHtml, adminHtml, 'utf8');
        log('已更新 admin.html');
    }

    // D. Update docs/CHANGELOG.md
    const today = new Date().toISOString().split('T')[0];
    const changelogMd = fs.readFileSync(paths.changelogMd, 'utf8');
    const newEntry = `\n## [${newVer}] - ${today}\n\n### 🔧 優化與修正 (Improved & Fixed)\n*   ${message}\n`;
    
    // 尋找第一個 ## [ 版號 ] 之前插入
    const firstVerIndex = changelogMd.indexOf('## [');
    let updatedMd = changelogMd;
    if (firstVerIndex !== -1) {
        updatedMd = changelogMd.slice(0, firstVerIndex) + newEntry + changelogMd.slice(firstVerIndex);
    } else {
        updatedMd += newEntry;
    }
    fs.writeFileSync(paths.changelogMd, updatedMd, 'utf8');
    log('已更新 docs/CHANGELOG.md');

} catch (err) {
    error(`檔案修法失敗: ${err.message}`);
}

// 4. 建立備份快照
const snapshotDir = path.join(paths.backups, `v${newVer}_snapshot`);
try {
    if (!fs.existsSync(paths.backups)) fs.mkdirSync(paths.backups);
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir);
    
    log(`正在建立備份快照: ${snapshotDir}`);
    // 使用 git archive 或簡單複製 (避開 .git, node_modules, backups)
    // 這裡採用簡單 PowerShell 命令 (如果是 Windows)
    const excludeList = ['.git', 'node_modules', 'backups'];
    const excludeStr = excludeList.map(e => `'${e}'`).join(',');
    
    // 使用單引號包裹路徑以避免空白字元問題
    const cpCmd = `Get-ChildItem -Path '${rootDir}' -Exclude ${excludeStr} | Copy-Item -Destination '${snapshotDir}' -Recurse -Force`;
    execSync(`powershell -Command "& { ${cpCmd} }"`);
    log('備份快照完成');
} catch (err) {
    log(`警告: 備份建立失敗 (${err.message})，但部署將繼續。`);
}

// 5. Git 自動化
try {
    log('執行 Git Commit & Push...');
    execSync('git add -A', { cwd: rootDir });
    execSync(`git commit -m "chore(release): update to v${newVer} - ${message}"`, { cwd: rootDir });
    execSync('git push', { cwd: rootDir });
    log('Git 推送成功！');
} catch (err) {
    log(`警告: Git 指令執行失敗 (${err.message})。可能是目前無變更或連線問題。`);
}

log(`\n✅ 部署完成！版本已提升至 v${newVer}`);
log(`🌐 線上網址應會在 1-2 分鐘內自動更新：https://post.tommylee.ai`);
