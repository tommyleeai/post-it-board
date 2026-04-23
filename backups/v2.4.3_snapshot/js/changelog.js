// ============================================
// 系統更新日誌與版本宣告模組
// ============================================
PostIt.Changelog = (function () {
    'use strict';

    const CURRENT_VERSION = '2.4.3';
    const STORAGE_KEY = 'postit_last_seen_version';

    function init() {
        // 檢查是否需要自動產生更新便利貼 (放在登入後才檢查比較安全)
        const lastSeen = localStorage.getItem(STORAGE_KEY);
        if (lastSeen !== CURRENT_VERSION) {
            // 僅在預設白板上顯示系統公告
            if (typeof PostIt.BoardModel !== 'undefined' &&
                PostIt.BoardModel.getActive() !== PostIt.BoardModel.getDefaultBoardId()) {
                return;
            }
            // 延遲 2 秒執行，一來營造系統稍後派發的儀式感，
            // 二來確保 Firestore 第一批資料已載入完畢，能取得場上真實的最高 zIndex
            setTimeout(spawnUpdateNote, 2000);
        }
    }

    async function spawnUpdateNote() {
        try {
            // 1. 本地白板防重複檢查：如果畫面上已經有同版本的公告了，直接跳過並同步 localStorage
            if (typeof PostIt.Note !== 'undefined') {
                const cache = PostIt.Note.getCache();
                const isDuplicated = Object.values(cache).some(n => 
                    n.role === 'ai' && n.content && n.content.includes(`v${CURRENT_VERSION}`)
                );
                if (isDuplicated) {
                    console.log('[Changelog] 畫面上已有目前版本的公告，不再重複發佈。');
                    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
                    return;
                }
            }

            // 2. Firestore 多裝置同步檢查：避免在設備 A 建立後，設備 B 又因為 localstorage 為空而重複建立
            let uid = null;
            let userRef = null;
            if (typeof PostIt.Auth !== 'undefined' && typeof PostIt.Firebase !== 'undefined') {
                uid = PostIt.Auth.getUid();
                if (uid) {
                    const db = PostIt.Firebase.getDb();
                    userRef = db.collection('users').doc(uid);
                    try {
                        // 嘗試從伺服器拉取最新狀態
                        const userDoc = await userRef.get({ source: 'server' });
                        if (userDoc.exists && userDoc.data().lastSeenVersion === CURRENT_VERSION) {
                            console.log('[Changelog] 雲端狀態顯示已發佈過此版本公告，跳過產生。');
                            localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
                            return;
                        }
                    } catch (e) {
                        console.warn('[Changelog] 讀取雲端 lastSeenVersion 失敗，繼續執行本地邏輯:', e);
                    }
                }
            }

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
                const board = document.getElementById('whiteboard');
                const boardW = board ? board.clientWidth : window.innerWidth;
                const boardH = board ? board.clientHeight : window.innerHeight;
                
                // 系統公告卡片預估寬度與高度（包含 padding）
                const expectedW = 352; 
                const expectedH = 340; 
                
                const xPx = Math.max(0, boardW - expectedW - 30);
                const yPx = Math.max(0, boardH - expectedH - 30);
                const xPercent = (xPx / boardW) * 100;
                const yPercent = (yPx / boardH) * 100;

                const highestZ = typeof PostIt.Drag !== 'undefined' ? PostIt.Drag.getMaxZIndex() : 10;
                const overridePos = { x: xPercent, y: yPercent, zIndex: highestZ + 100 };

                const noteId = await PostIt.Note.create(content, 'text', null, 'ai', overridePos);
                if (noteId) {
                    if (typeof PostIt.Drag !== 'undefined') PostIt.Drag.setMaxZIndex(overridePos.zIndex);
                    // 同步寫入多設備 Layout
                    await PostIt.Note.updatePosition(noteId, xPercent, yPercent, overridePos.zIndex);

                    // === 自動群組舊公告便利貼 ===
                    // 等待 Firestore snapshot 同步新建立的便利貼到 cache
                    await new Promise(r => setTimeout(r, 500));
                    try {
                        const cache = PostIt.Note.getCache();
                        // 找出所有 role=ai 的舊公告（不含剛建立的這張）
                        const oldAiNotes = Object.values(cache).filter(n =>
                            n.role === 'ai' && n.id !== noteId
                        );
                        if (oldAiNotes.length > 0) {
                            // 找出是否已有既存群組
                            const existingGroupNote = oldAiNotes.find(n => n.groupId);
                            if (existingGroupNote) {
                                // 加入既有群組
                                await PostIt.Note.mergeToGroup(noteId, existingGroupNote.id);
                            } else {
                                // 與第一張舊公告建立新群組，再依序合併其餘
                                await PostIt.Note.mergeToGroup(noteId, oldAiNotes[0].id);
                                // 如果有更多舊公告，也逐一合併進去
                                for (let i = 1; i < oldAiNotes.length; i++) {
                                    await PostIt.Note.mergeToGroup(noteId, oldAiNotes[i].id);
                                }
                            }
                            console.log('[Changelog] 已將系統公告自動群組化，共', oldAiNotes.length + 1, '張');
                        }
                    } catch (groupErr) {
                        console.warn('[Changelog] 自動群組化失敗（不影響公告產生）:', groupErr);
                    }

                    // 成功貼上後，標記為已看過
                    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION);
                    
                    // 同步到 Firestore 避免跨裝置重複產生
                    if (userRef) {
                        try {
                            await userRef.set({ lastSeenVersion: CURRENT_VERSION }, { merge: true });
                        } catch (e) {
                            console.warn('[Changelog] 寫入雲端 lastSeenVersion 失敗:', e);
                        }
                    }
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
        if (window.PostIt.LayerManager) window.PostIt.LayerManager.bringToFront(modal, overlay);
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
        if (modal) {
            modal.classList.remove('visible');
            if (window.PostIt.LayerManager) window.PostIt.LayerManager.remove(modal);
        }
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
