const fs = require('fs');

function fixMenuAndAlt() {
    // 1. Update index.html
    let html = fs.readFileSync('index.html', 'utf8');
    html = html.replace(/<img id="lightbox-image" class="lightbox-image" src="" alt="放大圖片">/, 
        `<img id="lightbox-image" class="lightbox-image" src="" alt="">
            <!-- 燈箱專用右鍵選單 -->
            <div id="lightbox-context-menu" class="lightbox-context-menu hidden">
                <button id="btn-copy-lightbox-image"><i class="fa-solid fa-copy"></i> 複製圖片</button>
            </div>`);
    fs.writeFileSync('index.html', html, 'utf8');
    console.log('Fixed index.html');

    // 2. Update css/style.css
    let css = fs.readFileSync('css/style.css', 'utf8');
    const cssAppend = `\n/* === 燈箱右鍵選單 START === */
.lightbox-context-menu {
    position: absolute;
    z-index: 9999999;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    padding: 6px;
    display: flex;
    flex-direction: column;
    min-width: 140px;
    border: 1px solid rgba(0,0,0,0.1);
}
.lightbox-context-menu.hidden {
    display: none;
}
.lightbox-context-menu button {
    background: none;
    border: none;
    padding: 10px 14px;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.2s;
    font-family: var(--font-ui);
    display: flex;
    align-items: center;
    gap: 8px;
    color: #333;
}
.lightbox-context-menu button:hover {
    background: #f0f0f0;
}
/* === END === */\n`;

    if (!css.includes('.lightbox-context-menu')) {
        css += cssAppend;
        fs.writeFileSync('css/style.css', css, 'utf8');
        console.log('Fixed css/style.css');
    }

    // 3. Update js/board_v2.js
    let js = fs.readFileSync('js/board_v2.js', 'utf8');
    
    // We need to inject the context menu logic. The best place is in `init()` where we bind lightbox events.
    // The previous logic was:
    // btnCloseLightbox.addEventListener('click', closeLightbox);
    // lightbox.addEventListener('click', closeLightbox);
    
    const replacementJS = `        const lightbox = document.getElementById('lightbox-overlay');
        const btnCloseLightbox = document.getElementById('btn-close-lightbox');
        const lightboxImg = document.getElementById('lightbox-image');
        const contextMenu = document.getElementById('lightbox-context-menu');
        const btnCopyImg = document.getElementById('btn-copy-lightbox-image');

        if (lightbox && btnCloseLightbox && lightboxImg && contextMenu) {
            btnCloseLightbox.addEventListener('click', closeLightbox);
            
            // 點擊燈箱任意處或圖片本身時關閉（但要排除右鍵選單的點擊）
            lightbox.addEventListener('click', (e) => {
                if (!e.target.closest('#lightbox-context-menu')) {
                    closeLightbox();
                }
            });

            // 確保每次顯示前先隱藏選單
            const hideMenu = () => contextMenu.classList.add('hidden');
            
            // 右鍵喚出選單
            lightboxImg.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // 計算適當位置，避免超出視窗
                // 先讓它顯示以便取得寬高
                contextMenu.style.visibility = 'hidden';
                contextMenu.classList.remove('hidden');
                
                const menuRect = contextMenu.getBoundingClientRect();
                let x = e.clientX;
                let y = e.clientY;
                
                if (x + menuRect.width > window.innerWidth) x = window.innerWidth - menuRect.width - 10;
                if (y + menuRect.height > window.innerHeight) y = window.innerHeight - menuRect.height - 10;
                
                contextMenu.style.left = x + 'px';
                contextMenu.style.top = y + 'px';
                contextMenu.style.visibility = 'visible';
            });
            
            // 點擊複製按鈕
            if (btnCopyImg) {
                btnCopyImg.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const src = lightboxImg.src;
                    try {
                        const response = await fetch(src);
                        const blob = await response.blob();
                        await navigator.clipboard.write([
                            new ClipboardItem({
                                [blob.type]: blob
                            })
                        ]);
                        if(window.showToast) window.showToast('已複製圖片', 'success');
                    } catch(err) {
                        console.error('複製圖片失敗:', err);
                        
                        // Fallback: 如果因為跨域導致 fetch 失敗，我們可以使用 canvas
                        try {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');
                            // 確保圖片具有 crossOrigin
                            const tempImg = new Image();
                            tempImg.crossOrigin = 'Anonymous';
                            tempImg.onload = async () => {
                                canvas.width = tempImg.width;
                                canvas.height = tempImg.height;
                                ctx.drawImage(tempImg, 0, 0);
                                canvas.toBlob(async (cblob) => {
                                    try {
                                        await navigator.clipboard.write([
                                            new ClipboardItem({ [cblob.type]: cblob })
                                        ]);
                                        if(window.showToast) window.showToast('已複製圖片', 'success');
                                    } catch (err3) {
                                        if(window.showToast) window.showToast('無法存取剪貼簿', 'error');
                                    }
                                });
                            };
                            tempImg.onerror = () => {
                                if(window.showToast) window.showToast('圖片包含跨域限制，無法直接複製', 'error');
                            };
                            tempImg.src = src;
                        } catch(err2) {
                            if(window.showToast) window.showToast('無法複製此圖片', 'error');
                        }
                    }
                    hideMenu();
                });
            }
        }`;

    const searchJS = /        const lightbox = document\.getElementById\('lightbox-overlay'\);\r?\n        const btnCloseLightbox = document\.getElementById\('btn-close-lightbox'\);\r?\n        if \(lightbox && btnCloseLightbox\) \{\r?\n            btnCloseLightbox\.addEventListener\('click', closeLightbox\);\r?\n            lightbox\.addEventListener\('click', closeLightbox\);\r?\n        \}/;

    js = js.replace(searchJS, replacementJS);
    fs.writeFileSync('js/board_v2.js', js, 'utf8');
    console.log('Fixed js/board_v2.js');
}

try {
    fixMenuAndAlt();
} catch(e) {
    console.error(e);
}
