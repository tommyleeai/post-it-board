// ============================================
// 系統更新日誌與版本宣告模組
// ============================================
PostIt.Changelog = (function () {
    'use strict';

    const CURRENT_VERSION = '1.3.1';
    const STORAGE_KEY = 'postit_last_seen_version';

    function init() {
        // 檢查是否需要自動跳出更新日誌 (放在登入後才檢查比較安全)
        const lastSeen = localStorage.getItem(STORAGE_KEY);
        if (lastSeen !== CURRENT_VERSION) {
            // 是新版本，自動彈出
            showModal(true);
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
                // 如果是自動彈出，代表看過了，儲存到 local storage
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
