window.PostIt = window.PostIt || {};

PostIt.DealNotifier = (function () {
    'use strict';

    const API_URL = 'http://127.0.0.1:8000/api/external/deal_radar?token=y9oBzyD2kDdXaQEKopp-ZQsan2uTXPes3PkFEnvdRfo';
    const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
    const STORAGE_KEY = 'postit_last_super_deal_id';
    let timer = null;

    /**
     * 啟動輪詢排程器
     */
    function start() {
        if (timer) clearInterval(timer);
        
        // 初次載入就先檢查一次 (也可以選擇不要，避免重新整理時一直吵)
        // 為了安全起見先不立刻 trigger，改為倒數計時後才開始
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
            const response = await fetch(API_URL);
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
        announceViaAudio(deal.title);

        // 2. 建立專屬便利貼 (這裡我們把結構化資料轉成字串塞進 content)
        const payloadStr = JSON.stringify(deal);
        
        // 呼叫底層新增，type 為 'super_deal'
        // color 給予白色，確保卡片呈現乾淨的商品預設色
        const newNoteId = await PostIt.Note.create(payloadStr, 'super_deal', '#FFFFFF', 'system');
        
        if (newNoteId) {
            // 利用 setTimeout 等待 React/DOM 重新渲染，再為它掛上過場動畫
            setTimeout(() => {
                const noteEl = document.querySelector(`[data-note-id="${newNoteId}"]`);
                if (noteEl) {
                    noteEl.classList.add('super-deal-entrance');
                    // 為了避免一直抖，動畫播完後可以移除
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
    function announceViaAudio(productName) {
        if (!('speechSynthesis' in window)) return;
        
        // 由於中英文夾雜可能會有口音問題，先喊開頭，再塞入短版標題
        const synth = window.speechSynthesis;
        const shortName = productName.substring(0, 20); // 避免標題太長
        const text = `警報！超級好物出現啦！馬上查看：${shortName}`;
        
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

    /**
     * 供你隨時手動打開 Console 測試的按鈕
     */
    function triggerTestAlert() {
        const dummyDeal = {
            id: 'test_' + Date.now(),
            title: 'Samsung 990 PRO 2TB SSD 歷史低價',
            image: 'https://images.unsplash.com/photo-1597848212624-a19eb35e2651?auto=format&fit=crop&q=80&w=600',
            price: '$119.99',
            originalPrice: '$249.99',
            promoCode: 'SAMSUNG50',
            url: 'https://www.amazon.com/dp/B0BHJTJC2M'
        };
        
        // 不防呆，強制重發
        localStorage.removeItem(STORAGE_KEY);
        triggerAlert(dummyDeal);
    }

    // 模擬假資料回傳
    function mockFetch() {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    id: 'mock_101',
                    title: 'Sony WH-1000XM5 黑科技降噪耳罩式耳機 (全新未拆)',
                    image: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&q=80&w=600',
                    price: '$298.00',
                    originalPrice: '$398.00',
                    promoCode: 'AUTO_APPLY',
                    url: 'https://www.amazon.com/dp/B09XS7JWHH'
                });
            }, 500);
        });
    }

    return {
        start,
        stop,
        triggerTestAlert
    };
})();

// 頁面載入後，延遲5秒自動啟動雷達，避免與初次白板渲染搶資源
window.addEventListener('load', () => {
    setTimeout(() => {
        if (PostIt.Auth && PostIt.Auth.getUid()) {
            PostIt.DealNotifier.start();
        }
    }, 5000);
});
