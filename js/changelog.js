// ============================================
// 系統更新日誌與版本宣告模組
// ============================================
PostIt.Changelog = (function () {
    'use strict';

    const CURRENT_VERSION = '1.3.3';
    const STORAGE_KEY = 'postit_last_seen_version';

    function init() {
        // 檢查是否需要自動產生更新便利貼 (放在登入後才檢查比較安全)
        const lastSeen = localStorage.getItem(STORAGE_KEY);
        if (lastSeen !== CURRENT_VERSION) {
            spawnUpdateNote();
        }
    }

    async function spawnUpdateNote() {
        try {
            // 加入時間戳記避免 markdown 檔案被瀏覽器死牢快取 (但本地 file:/// 協議不支援帶參數的檔名)
            let fetchUrl = 'docs/CHANGELOG.md';
            if (window.location.protocol.startsWith('http')) {
                fetchUrl += '?v=' + Date.now();
            }
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error('Network response was not ok');
            const markdown = await response.text();

            const lines = markdown.split('\n');
            let content = `System Update\n✨ 【系統公告】\n版本已更新至 v${CURRENT_VERSION}\n\n`;
            let inCurrentVersion = false;
            let bullets = [];

            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line.startsWith(`## [${CURRENT_VERSION}]`)) {
                    inCurrentVersion = true;
                    continue;
                }
                // Stop if we hit the next version section
                if (inCurrentVersion && line.startsWith('## [')) {
                    break;
                }
                if (inCurrentVersion && (line.startsWith('* ') || line.startsWith('- '))) {
                    // 移除 Markdown 符號
                    let bullet = line.substring(2).replace(/\*\*/g, '').replace(/`/g, '');
                    // 擷取前幾個字避免太長
                    if (bullet.indexOf('：') !== -1) {
                        bullet = bullet.split('：')[0]; // 如果有冒號，只拿冒號前面的項目名稱
                    } else if (bullet.length > 25) {
                        bullet = bullet.substring(0, 25) + '...';
                    }
                    bullets.push('• ' + bullet);
                }
            }

            // 最多只顯示 4 條更新摘要
            if (bullets.length > 4) {
                bullets = bullets.slice(0, 4);
                bullets.push('...');
            }

            content += bullets.join('\n');
            content += '\n\n(點擊左上角版號查看完整說明)';

            // 在白板上寫下一張由 AI/System 發布的實體便利貼
            if (typeof PostIt.Note !== 'undefined') {
                const noteId = await PostIt.Note.create(content, 'text', null, 'ai');
                if (noteId) {
                    // 成功貼上後，標記為已看過
                    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
                }
            }
        } catch (error) {
            console.error('[Changelog] 無法產生公告便利貼:', error);
        }
    }

    // 自動執行 UI 綁定 (不需等待登入)
    function autoBindUIEvents() {
        // 設定目前的版號到 UI 上
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.textContent = 'v' + CURRENT_VERSION;
            versionEl.addEventListener('click', () => showModal(false));
            versionEl.style.cursor = 'pointer'; // Ensure cursor style
        }

        const btnClose = document.getElementById('btn-close-changelog');
        const overlay = document.getElementById('changelog-modal-overlay');

        if (btnClose) btnClose.addEventListener('click', closeModal);
        if (overlay) overlay.addEventListener('click', closeModal);
    }
    
    // 立即綁定
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoBindUIEvents);
    } else {
        autoBindUIEvents();
    }

    async function showModal(isAuto = false) {
        const modal = document.getElementById('changelog-modal');
        const overlay = document.getElementById('changelog-modal-overlay');
        const contentEl = document.getElementById('changelog-content');

        if (!modal || !overlay || !contentEl) return;

        // 顯示視窗
        modal.classList.add('visible');
        overlay.classList.add('visible');
        contentEl.innerHTML = '<div class="loading-cell">載入中...</div>';

        try {
            // 抓取 Markdown
            const response = await fetch('docs/CHANGELOG.md');
            if (!response.ok) throw new Error('Network response was not ok');
            const markdown = await response.text();

            // 簡易解析 Markdown 為 HTML
            contentEl.innerHTML = parseMarkdownToHTML(markdown);

            if (isAuto) {
                localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
            }
        } catch (error) {
            console.error('[Changelog] 無法載入更新日誌:', error);
            contentEl.innerHTML = '<div class="changelog-error">無法載入更新日誌，請稍後再試。</div>';
        }
    }

    function closeModal() {
        const modal = document.getElementById('changelog-modal');
        const overlay = document.getElementById('changelog-modal-overlay');
        if (modal) modal.classList.remove('visible');
        if (overlay) overlay.classList.remove('visible');
    }

    // 簡易 Markdown parser，處理標題、清單、粗體、分隔線
    function parseMarkdownToHTML(markdown) {
        const lines = markdown.split('\n');
        let html = '';
        let inList = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();

            if (line === '') continue;

            // 分隔線
            if (line === '---') {
                if (inList) { html += '</ul>'; inList = false; }
                html += '<hr>';
                continue;
            }

            // H2: ## [1.3.1] - 2026-04-13
            if (line.startsWith('## ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h2>${escapeHtml(line.substring(3))}</h2>`;
                continue;
            }

            // H3: ### ✨ 新增 (Added)
            if (line.startsWith('### ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += `<h3>${escapeHtml(line.substring(4))}</h3>`;
                continue;
            }

            // H1: # Changelog
            if (line.startsWith('# ')) {
                // 忽略 H1，通常我們不需要在視窗內顯示最大標題
                continue;
            }

            // List item: * 內容 或 - 內容
            if (line.startsWith('* ') || line.startsWith('- ')) {
                if (!inList) { html += '<ul>'; inList = true; }
                
                // 處理行內粗體與反引號 (code)
                let text = line.substring(2);
                text = processInlineFormatting(text);
                
                html += `<li>${text}</li>`;
                continue;
            }

            // 段落 Quote
            if (line.startsWith('> ')) {
                if (inList) { html += '</ul>'; inList = false; }
                let text = line.substring(2);
                text = processInlineFormatting(text);
                html += `<p style="color: #666; font-style: italic;">${text}</p>`;
                continue;
            }

            // 一般段落
            if (inList) { html += '</ul>'; inList = false; }
            let text = processInlineFormatting(line);
            html += `<p>${text}</p>`;
        }

        if (inList) html += '</ul>';

        return html;
    }

    function processInlineFormatting(text) {
        let result = escapeHtml(text);
        
        // 粗體 **text**
        result = result.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // 單星號斜體 *text*
        result = result.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // code `text`
        result = result.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.05);padding:2px 4px;border-radius:4px;color:#d32f2f;">$1</code>');
        // 連結 [text](url)
        result = result.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:#1565C0;">$1</a>');
        
        return result;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    return { init, showModal };
})();
