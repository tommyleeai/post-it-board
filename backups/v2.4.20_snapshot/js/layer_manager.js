/**
 * PostIt LayerManager
 * 負責統一管理系統中所有對話框(Modal)與其專屬遮罩(Overlay)的 Z-Index 層級。
 * 確保「最後點擊/最後開啟的視窗」永遠置頂。
 */
window.PostIt = window.PostIt || {};

class LayerManager {
    constructor() {
        // 從 CSS 讀取基礎設定
        this.baseZ = 900000; 
        this.currentZ = this.baseZ;
        this.activeModals = []; // 存放 { modal, overlay, zIndex }
    }

    /**
     * 將指定的 Modal 推至最上層
     * @param {HTMLElement} modalEl - 主對話框元素
     * @param {HTMLElement} overlayEl - 背景遮罩元素
     */
    bringToFront(modalEl, overlayEl) {
        if (!modalEl || !overlayEl) return;

        // 如果這個 modal 已經在陣列中，先移除
        this.activeModals = this.activeModals.filter(m => m.modal !== modalEl);

        // 分配新的層級 (每一次推上來都加 10，確保永遠在舊的上面)
        this.currentZ += 10;
        
        // 設定 z-index
        overlayEl.style.zIndex = this.currentZ;
        modalEl.style.zIndex = this.currentZ + 1;

        // 存入陣列尾端 (代表目前最前面)
        this.activeModals.push({
            modal: modalEl,
            overlay: overlayEl,
            zIndex: this.currentZ
        });

        // 取消其他底層 modal 的 blur 避免效能疊加，只讓最頂層 blur
        this._updateBlurs();
    }

    /**
     * 關閉一個 Modal 時，從層級列表中移除
     * @param {HTMLElement} modalEl 
     */
    remove(modalEl) {
        if (!modalEl) return;
        this.activeModals = this.activeModals.filter(m => m.modal !== modalEl);
        
        // 如果全部關閉，重置基準線避免無限增長
        if (this.activeModals.length === 0) {
            this.currentZ = this.baseZ;
        }

        this._updateBlurs();
    }

    /**
     * 更新所有活躍遮罩的 Blur 狀態
     * （避免多層 blur 導致卡頓，或者互相干擾）
     */
    _updateBlurs() {
        this.activeModals.forEach((m, index) => {
            const isTop = index === this.activeModals.length - 1;
            // 如果是最頂層的，確保 backdrop-filter 存在
            if (isTop) {
                m.overlay.style.backdropFilter = 'blur(8px)';
                m.overlay.style.webkitBackdropFilter = 'blur(8px)';
            } else {
                // 底層的只給暗色，不要 blur
                m.overlay.style.backdropFilter = 'none';
                m.overlay.style.webkitBackdropFilter = 'none';
            }
        });
    }
}

window.PostIt.LayerManager = new LayerManager();
