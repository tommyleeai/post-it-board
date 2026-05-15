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
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            
            // 設定一個 timeout 以防長時間等待
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            // 1. 優先使用 microlink API (專業 Metadata 解析服務，能繞過 Amazon 等多數防爬機制)
            try {
                // 加上自訂選擇器，針對 Amazon 抓取真實的產品圖片（#landingImage, #imgBlkFront），覆蓋掉預設的 Prime Logo
                const microUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&data.amazonImage.selector=%23landingImage,%23imgBlkFront,%23main-image&data.amazonImage.attr=src`;
                const microResponse = await fetch(microUrl, { signal: controller.signal });
                if (microResponse.ok) {
                    const json = await microResponse.json();
                    if (json && json.data && (json.data.title || json.data.image || json.data.amazonImage)) {
                        clearTimeout(timeoutId);
                        const d = json.data;
                        return {
                            url: url,
                            title: (d.title || '').trim(),
                            description: (d.description || '').trim(),
                            image: (d.amazonImage || d.image?.url || '').trim(),
                            favicon: (d.logo?.url || `https://www.google.com/s2/favicons?domain=${domain}&sz=64`).trim(),
                            domain: domain
                        };
                    }
                }
            } catch (err) {
                console.warn('[LinkPreview] Microlink API 失敗，嘗試降級使用 allorigins proxy...', err);
            }

            // 2. 如果 microlink 失敗，降級使用 api.allorigins.win 作為 CORS Proxy 來獲取原始 HTML
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.warn('[LinkPreview] Fallback fetch failed:', response.status);
                return null;
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            const getMeta = (propName) => {
                const el = doc.querySelector(`meta[property="${propName}"], meta[name="${propName}"]`);
                return el ? el.getAttribute('content') : null;
            };

            let title = getMeta('og:title') || getMeta('twitter:title') || doc.querySelector('title')?.innerText || '';
            let description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description') || '';
            let image = getMeta('og:image') || getMeta('twitter:image') || '';
            
            if (image && image.startsWith('/')) {
                image = `${urlObj.protocol}//${urlObj.host}${image}`;
            }

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
                favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            }

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
