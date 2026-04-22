const fs = require('fs');
let c = fs.readFileSync('js/board_v2.js', 'utf8');
const searchRegEx = /        \/\/ 位置（只在非拖曳時更新）— 跨裝置獨立座標\r?\n        if \(\!el\.classList\.contains\('dragging'\)\) \{/;
const replacement = `        // 位置（只在非拖曳時更新）— 跨裝置獨立座標
        const isExpandedGroupItem = (typeof PostIt.Group !== 'undefined' && typeof PostIt.Group.getExpandedGroupId === 'function' && PostIt.Group.getExpandedGroupId() && PostIt.Group.getExpandedGroupId() === note.groupId);
        if (!el.classList.contains('dragging') && !isExpandedGroupItem) {`;
c = c.replace(searchRegEx, replacement);
fs.writeFileSync('js/board_v2.js', c, 'utf8');
console.log('Fixed');
