window.PostIt = window.PostIt || {};

PostIt.DealNotifier = (function () {
    'use strict';

    const API_BASE = 'https://smart.tdeals.cc/api/external/deal_radar';
    const STORAGE_KEY_TOKEN = 'stockAlert_apiToken';
    const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
    const STORAGE_KEY = 'postit_last_super_deal_id';
    let timer = null;

    function getApiToken() {
        if (PostIt.StockAlert && typeof PostIt.StockAlert.getApiToken === 'function') {
            return PostIt.StockAlert.getApiToken();
        }
        const token = localStorage.getItem(STORAGE_KEY_TOKEN);
        return token ? token.trim() : '';
    }

    function buildApiUrl(extraParams) {
        const token = getApiToken();
        if (!token) return null;
        const suffix = extraParams ? `&${extraParams}` : '';
        return `${API_BASE}?token=${encodeURIComponent(token)}${suffix}`;
    }

    /**
     * 檢查授權與開關狀態，回傳是否可以啟用雷達
     */
    function canActivateRadar() {
        if (typeof PostIt.Settings === 'undefined') return false;
        // 雙重檢查：管理員授權 + 使用者開關
        return PostIt.Settings.isDealRadarAuthorized() && PostIt.Settings.getDealRadarEnabled();
    }

    /**
     * 更新浮動按鈕的可見性
     */
    function updateButtonVisibility() {
        const btn = document.getElementById('btn-deal-radar-float');
        if (!btn) return;
        const show = canActivateRadar() && getApiToken();
        btn.style.display = show ? '' : 'none';
    }

    /**
     * 啟動輪詢排程器
     */
    function start() {
        if (timer) clearInterval(timer);

        updateButtonVisibility();

        if (!canActivateRadar()) {
            console.log('[DealNotifier] ⛔ 雷達未授權或已關閉，不啟動輪詢。');
            return;
        }
        
        timer = setInterval(checkDeals, POLL_INTERVAL_MS);
        console.log('[DealNotifier] 📡 超級好物雷達已啟動，每10分鐘掃描一次。');
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    /**
     * 去你的後端拉取最新 Super Deal
     */
    async function checkDeals() {
        try {
            const apiUrl = buildApiUrl();
            if (!apiUrl) return;

            const response = await fetch(apiUrl);
            if (!response.ok) return;
            const data = await response.json();
            
            if (!data.success || !data.deal) return;
            const deal = data.deal;

            if (!deal || !deal.id) return;

            const lastId = localStorage.getItem(STORAGE_KEY);
            if (lastId === deal.id.toString()) {
                // 已經播報過這個 Deal 了
                return;
            }

            // 更新快取，這樣其他平行分頁 (Tabs) 就算在慢幾秒後去 Check，也會因為讀到快取而放棄播報
            localStorage.setItem(STORAGE_KEY, deal.id.toString());
            
            // 觸發誕生與聲光特效
            triggerAlert(deal);

        } catch (err) {
            console.error('[DealNotifier] 📡 掃描好物失敗 (正常現象，代表未連上伺服器)', err);
        }
    }

    /**
     * 觸發好物的誕生廣播
     */
    async function triggerAlert(deal) {
        console.log('🎉 [DealNotifier] 發現超級好物:', deal);

        // 1. 語音廣播 (Web Speech API)
        announceViaAudio();

        // 2. 決定放置策略：找場上所有 super_deal 卡片，判斷是否有可合併的群組
        // 白板中央座標（百分比）— 稍微偏上以避免卡片往下展開時超出畫面
        const CENTER_POS = { x: 40, y: 30 };
        const MAX_GROUP_CARDS = 10;

        let spawnPos = { ...CENTER_POS };
        let mergeTarget = null; // 要合併進去的現有卡片（群組代表）

        if (window.PostIt && window.PostIt.Note && typeof window.PostIt.Note.getCache === 'function') {
            const allNotes = Object.values(window.PostIt.Note.getCache());
            const superDeals = allNotes.filter(n => n.type === 'super_deal');

            if (superDeals.length > 0) {
                // 找到最新的（有群組的）super_deal 群組，檢查成員數量
                // 優先找有 groupId 的，代表已經有群組存在
                const grouped = superDeals.filter(n => n.groupId);
                const ungrouped = superDeals.filter(n => !n.groupId);

                if (grouped.length > 0) {
                    // 找出最新的群組（以 groupId 分群，取成員數最多或最新的）
                    const groupMap = {};
                    grouped.forEach(n => {
                        if (!groupMap[n.groupId]) groupMap[n.groupId] = [];
                        groupMap[n.groupId].push(n);
                    });

                    // 取最後一個活躍群組（最大 groupOrder 或最新建立的）
                    let latestGroupId = null;
                    let latestGroupCards = [];
                    for (const [gid, members] of Object.entries(groupMap)) {
                        // 使用 getGroupNotes 取得精確成員數（包含非 super_deal 的成員）
                        const fullMembers = (typeof PostIt.Note.getGroupNotes === 'function')
                            ? PostIt.Note.getGroupNotes(gid)
                            : members;
                        if (!latestGroupId || fullMembers.length > latestGroupCards.length) {
                            latestGroupId = gid;
                            latestGroupCards = fullMembers;
                        }
                    }

                    if (latestGroupId && latestGroupCards.length < MAX_GROUP_CARDS) {
                        // 群組未滿 → 合併進此群組
                        mergeTarget = grouped.find(n => n.groupId === latestGroupId);
                    }
                    // 群組已滿 → 往下 fallback 檢查散落卡片
                }

                // 所有群組都滿了（或沒有群組），但有散落的單張 super_deal → 合併它
                if (!mergeTarget && ungrouped.length > 0) {
                    mergeTarget = ungrouped[0];
                }
            }

            // 如果有合併目標，繼承其座標
            if (mergeTarget) {
                const mode = (window.PostIt && PostIt.getDeviceMode) ? PostIt.getDeviceMode() : 'desktop';
                const layoutData = (mergeTarget.layouts && mergeTarget.layouts[mode]) ? mergeTarget.layouts[mode] : mergeTarget;

                let targetX = typeof layoutData.x === 'number' && !isNaN(layoutData.x) ? layoutData.x : mergeTarget.x;
                let targetY = typeof layoutData.y === 'number' && !isNaN(layoutData.y) ? layoutData.y : mergeTarget.y;

                spawnPos = {
                    x: typeof targetX === 'number' && !isNaN(targetX) ? targetX : CENTER_POS.x,
                    y: typeof targetY === 'number' && !isNaN(targetY) ? targetY : CENTER_POS.y
                };
            }
            // 沒有合併目標 → spawnPos 維持白板中央
        }

        // 3. 建立專屬便利貼
        const payloadStr = JSON.stringify(deal);
        const newNoteId = await PostIt.Note.create(payloadStr, 'super_deal', '#FFFFFF', 'system', spawnPos);

        if (newNoteId) {
            // 4. 群組合併邏輯
            if (mergeTarget) {
                setTimeout(async () => {
                    // mergeToGroup(A, B)：A 疊在 B 上面
                    // 我們要新卡片在最上方，所以新卡片是 A (dragged)，舊卡片是 B (target)
                    await window.PostIt.Note.mergeToGroup(newNoteId, mergeTarget.id);
                    console.log('🔗 [DealNotifier] 已自動將新好物加入群組（新卡片在最上方）');
                }, 600);
            } else {
                console.log('📍 [DealNotifier] 新好物放置於白板中央（新群組起點）');
            }

            // 5. 過場動畫
            setTimeout(() => {
                const noteEl = document.querySelector(`[data-note-id="${newNoteId}"]`);
                if (noteEl) {
                    noteEl.classList.add('super-deal-entrance');
                    setTimeout(() => {
                        noteEl.classList.remove('super-deal-entrance');
                    }, 4000);
                }
            }, 300);
        }
    }

    /**
     * 合成激動語音
     */
    function announceViaAudio() {
        if (!('speechSynthesis' in window)) return;
        
        const synth = window.speechSynthesis;
        const text = '警報！超級好物出現啦！';
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-TW';
        utterance.pitch = 1.3; // 高音表示興奮
        utterance.rate = 1.1;  // 稍微快一點
        
        // 若有內建音效，可以在這裡搭配 Sound.js 播放「登登登」
        if (typeof PostIt.Sound !== 'undefined' && PostIt.Sound.play) {
            PostIt.Sound.play('system_msg'); 
        }

        synth.speak(utterance);
    }

    let manualOffsetCount = 0;

    /**
     * 手動強制呼叫好物雷達，獲取過去 1 小時最高分
     */
    async function triggerRadarManual() {
        // 前置授權檢查
        if (!canActivateRadar()) {
            if (window.PostIt && window.PostIt.Board) {
                window.PostIt.Board.showToast('您的帳號尚未取得好物雷達授權，請聯繫管理員', 'error');
            }
            return;
        }
        console.log('[DealNotifier] 手動偵測雷達啟動...');
        const apiUrl = buildApiUrl(`hours=1&offset=${manualOffsetCount}`);
        if (!apiUrl) {
            if (window.PostIt && window.PostIt.Board) {
                window.PostIt.Board.showToast('請先在「帳號設定」填入好物報報 API Token', 'error');
            }
            return;
        }

        try {
            const tempBtn = document.getElementById('btn-test-radar');
            if (tempBtn) tempBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 掃描中';

            // 改用獨立的變數來計算，避免算到舊的或昨天的超級好物卡片
            // 放回 hours=1 取得排名，並透過 offset 來循序拿下一張
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error('API fetch failed');
            const data = await response.json();
            
            if (tempBtn) tempBtn.innerHTML = '🚨 好物雷達';

            if (!data.success || !data.deal) {
                if (window.PostIt && window.PostIt.Board) {
                    window.PostIt.Board.showToast(manualOffsetCount > 0 ? '過去 1 小時內沒有更多好物了！' : '過去 1 小時內沒有夠強的好物！', 'error');
                }
                return;
            }
            
            // 成功拉到資料後，計數加 1，下次就會拉下一筆
            manualOffsetCount++;
            
            // 手動觸發不檢查 localStorage 快取，直接顯示
            triggerAlert(data.deal);

        } catch (err) {
            console.error('[DealNotifier] 手動掃描失敗:', err);
            const tempBtn = document.getElementById('btn-test-radar');
            if (tempBtn) tempBtn.innerHTML = '🚨 好物雷達';

            if (window.PostIt && window.PostIt.Board) {
                window.PostIt.Board.showToast('伺服器連線失敗，自動載入測試資料供排版檢查', 'error');
            }
            // 若伺服器沒開，為了展示 UI 或測試樣式，塞入假資料
            const mockDeals = [
                {
                    id: "test_" + Date.now() + "_1",
                    title: "[Mock] 🏆 第一高分好物 | Orgain Organic Vegan Protein",
                    image: "https://picsum.photos/seed/deal1/400/400",
                    price: "$13.00",
                    originalPrice: "$30.00",
                    promoCode: "BESTSCORE",
                    url: "https://amazon.com",
                    score: 180
                },
                {
                    id: "test_" + Date.now() + "_2",
                    title: "[Mock] 🥈 第二高分好物 | AirPods Pro 2nd Gen",
                    image: "https://picsum.photos/seed/deal2/400/400",
                    price: "$189.00",
                    originalPrice: "$249.00",
                    promoCode: "nocode",
                    url: "https://amazon.com",
                    score: 156
                },
                {
                    id: "test_" + Date.now() + "_3",
                    title: "[Mock] 🥉 第三高分好物 | Ninja Air Fryer",
                    image: "https://picsum.photos/seed/deal3/400/400",
                    price: "$89.99",
                    originalPrice: "$129.99",
                    promoCode: "NINJA20",
                    url: "https://amazon.com",
                    score: 142
                }
            ];

            // 根據畫面的卡片數量給予對應的降冪測試資料
            const existingCount = document.querySelectorAll('.super-deal-note').length;
            const mockDeal = mockDeals[existingCount % mockDeals.length];
            triggerAlert(mockDeal);
        }
    }

    /**
     * 初始設定雷達按鈕上下拖曳功能
     */
    function initDraggableButton() {
        const btn = document.getElementById('btn-deal-radar-float');
        if (!btn) return;

        // 嘗試從 localStorage 讀取上次的 Y 座標
        const savedTop = localStorage.getItem('postit_radar_btn_top');
        if (savedTop) {
            btn.style.bottom = 'auto'; // 取消 bottom
            let parsedTop = parseFloat(savedTop);
            if (!isNaN(parsedTop)) {
                // 確保讀取的座標不會被卡在上方工具列內 (工具列 52px)
                parsedTop = Math.max(65, parsedTop);
                // 避免視窗縮小時卡在下方視窗外
                const maxY = window.innerHeight - 50; 
                parsedTop = Math.min(parsedTop, maxY);
                btn.style.top = parsedTop + 'px';
            } else {
                btn.style.top = savedTop;
            }
        }

        let isDragging = false;
        let startY = 0;
        let startTop = 0;
        let hasMoved = false;

        btn.addEventListener('pointerdown', (e) => {
            // 只接受滑鼠左鍵或觸控
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            
            isDragging = true;
            hasMoved = false;
            startY = e.clientY;
            
            const rect = btn.getBoundingClientRect();
            // 切換為由 top 定位，以便拖曳
            btn.style.bottom = 'auto';
            btn.style.top = rect.top + 'px';
            startTop = rect.top;
            
            btn.setPointerCapture(e.pointerId);
            btn.style.transition = 'none'; // 拖曳時取消動畫
            btn.style.cursor = 'grabbing';
        });

        btn.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            const deltaY = e.clientY - startY;
            if (Math.abs(deltaY) > 5) {
                hasMoved = true;
            }
            
            let newTop = startTop + deltaY;
            // 限制在畫面內
            // 頂部必須避開 52px 的 Toolbar，預留一點緩衝，設為 65px
            const minY = 65;
            // 底部可以完美貼齊邊緣
            const maxY = window.innerHeight - btn.offsetHeight;
            newTop = Math.max(minY, Math.min(newTop, maxY));
            
            btn.style.top = newTop + 'px';
        });

        btn.addEventListener('pointerup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            btn.releasePointerCapture(e.pointerId);
            btn.style.transition = 'transform 0.2s';
            btn.style.cursor = 'grab';
            
            if (hasMoved) {
                // 有移動過，儲存新位置
                localStorage.setItem('postit_radar_btn_top', btn.style.top);
            } else {
                // 沒移動，當作點擊
                triggerRadarManual();
            }
        });
    }

    return {
        init: function() {
            initDraggableButton();
            updateButtonVisibility();
        },
        start,
        stop,
        triggerRadarManual,
        refreshVisibility: function() {
            updateButtonVisibility();
            // 如果當前狀態不允許，即刻停止輪詢
            if (!canActivateRadar()) {
                stop();
            }
        }
    };
})();

// 頁面載入後，初始化拖曳按鈕，並延遲5秒自動啟動雷達
window.addEventListener('load', () => {
    PostIt.DealNotifier.init();

    setTimeout(() => {
        if (PostIt.Auth && PostIt.Auth.getUid()) {
            PostIt.DealNotifier.start();
        }
    }, 5000);
});
