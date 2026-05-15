/**
 * Post-It Board - Link Preview Module
 * 負責解析一般網址的 OpenGraph Metadata 以產生預覽卡片資料
 */
window.PostIt = window.PostIt || {};

PostIt.LinkPreview = {
    /**
     * 嘗試從指定的 URL 抓取網頁的 metadata (透過 public CORS proxy)
     * @param {string} url 
     * @returns {Promise<Object|null>}
     */
    fetchMetadata: async function(url) {
        try {
            // 使用 api.allorigins.win 作為 CORS Proxy 來獲取原始 HTML
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            
            // 設定一個 timeout 以防長時間等待
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.warn('[LinkPreview] Fetch failed:', response.status);
                return null;
            }

            const html = await response.text();
            
            // 使用 DOMParser 解析 HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // 提取 metadata 的輔助函式
            const getMeta = (propName) => {
                const el = doc.querySelector(`meta[property="${propName}"], meta[name="${propName}"]`);
                return el ? el.getAttribute('content') : null;
            };

            let title = getMeta('og:title') || getMeta('twitter:title') || doc.querySelector('title')?.innerText || '';
            let description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
            let image = getMeta('og:image') || getMeta('twitter:image') || '';
            
            // 整理與解析 URL 確保相對路徑能轉換為絕對路徑
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            if (image && image.startsWith('/')) {
                // 處理相對路徑圖片
                image = `${urlObj.protocol}//${urlObj.host}${image}`;
            }

            // 尋找 Favicon
            let favicon = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')?.getAttribute('href');
            if (favicon) {
                if (favicon.startsWith('//')) {
                    favicon = `${urlObj.protocol}${favicon}`;
                } else if (favicon.startsWith('/')) {
                    favicon = `${urlObj.protocol}//${urlObj.host}${favicon}`;
                } else if (!favicon.startsWith('http')) {
                    favicon = `${urlObj.protocol}//${urlObj.host}/${favicon}`;
                }
            } else {
                // 如果找不到，使用 Google S2 的 Favicon 服務作為備用方案
                favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            }

            // 如果全部為空，則代表無效的預覽
            if (!title && !description && !image) return null;

            return {
                url: url,
                title: title.trim(),
                description: description.trim(),
                image: image.trim(),
                favicon: favicon.trim(),
                domain: domain
            };

        } catch (e) {
            console.warn('[LinkPreview] 無法解析連結:', url, e);
            return null;
        }
    }
};
