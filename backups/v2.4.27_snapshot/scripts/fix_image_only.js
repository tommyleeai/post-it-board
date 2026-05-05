const fs = require('fs');

function fixContent() {
    let boardContent = fs.readFileSync('js/board_v2.js', 'utf8');

    // 1. Fix Lightbox click outside bounds
    boardContent = boardContent.replace(/if \(e\.target === lightbox\) closeLightbox\(\);/g, 'closeLightbox();');

    // 2. Fix createNoteElement image-only logic
    boardContent = boardContent.replace(
        /        const contentEl = document\.createElement\('div'\);\r?\n        contentEl\.className = 'note-content';\r?\n        contentEl\.innerHTML = renderContentText\(note, parsedImageUrl\);\r?\n        el\.appendChild\(contentEl\);/,
        `        const contentEl = document.createElement('div');
        contentEl.className = 'note-content';
        const textHTML = renderContentText(note, parsedImageUrl);
        contentEl.innerHTML = textHTML;
        if (parsedImageUrl && !String(textHTML).replace(/<[^>]*>?/gm, '').trim()) {
            el.classList.add('image-only');
        } else {
            el.classList.remove('image-only');
        }
        el.appendChild(contentEl);`
    );

    // 3. Fix updateNoteElement image-only logic
    boardContent = boardContent.replace(
        /            contentEl\.innerHTML = renderContentText\(note, parsedImageUrl\);\r?\n        \}/,
        `            const textHTML = renderContentText(note, parsedImageUrl);
            contentEl.innerHTML = textHTML;
            if (parsedImageUrl && !String(textHTML).replace(/<[^>]*>?/gm, '').trim()) {
                el.classList.add('image-only');
            } else {
                el.classList.remove('image-only');
            }
        }`
    );

    fs.writeFileSync('js/board_v2.js', boardContent, 'utf8');
    console.log('Board JS fixed');

    // 4. Update CSS for .image-only and lightbox improvements
    let cssContent = fs.readFileSync('css/style.css', 'utf8');
    
    const cssAppend = `\n/* === 無文字圖片放大填充設計 START === */
.sticky-note.image-only {
    padding: 0;
    overflow: hidden; /* 防止圖片超出圓角 */
}

/* 確保設定按鈕不會因為 padding 0 而貼齊邊緣 */
.sticky-note.image-only .note-settings-trigger {
    bottom: 8px;
    right: 8px;
    background: rgba(255, 255, 255, 0.45);
    border-radius: 50%;
    /* 加深圖示顏色讓背景更明顯 */
    color: #222;
}

.sticky-note.image-only .note-settings-trigger:hover {
    background: rgba(255, 255, 255, 0.85);
}

.sticky-note.image-only .note-image-container {
    margin-bottom: 0;
    width: 100%;
    height: 100%;
}

.sticky-note.image-only .note-img {
    max-height: none;
    width: 100%;
    height: 100%;
    object-fit: cover; /* 讓圖片填滿整個便利貼，不會有留白 */
    border-radius: 2px;
}

.sticky-note.image-only .note-content {
    display: none; /* 隱藏無文字區域 */
}
/* === END === */\n`;

    // Only append if not already there
    if (!cssContent.includes('.sticky-note.image-only')) {
        cssContent += cssAppend;
        fs.writeFileSync('css/style.css', cssContent, 'utf8');
        console.log('CSS fixed');
    }
}

try {
    fixContent();
} catch (e) {
    console.error(e);
}
