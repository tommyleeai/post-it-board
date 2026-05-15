// ============================================
// 管理員權限（與 admin.html 共用白名單邏輯）
// ============================================
PostIt.AdminAccess = (function () {
    'use strict';

    const FALLBACK_ADMIN_EMAILS = ['tommylee@gmail.com'];
    let adminEmails = [...FALLBACK_ADMIN_EMAILS];

    async function loadAdminEmails(db) {
        if (!db) return adminEmails;
        try {
            const configDoc = await db.collection('config').doc('admin').get();
            if (configDoc.exists && Array.isArray(configDoc.data().emails)) {
                adminEmails = configDoc.data().emails;
            }
        } catch (e) {
            console.warn('[AdminAccess] 無法讀取 Firestore 管理員設定，使用 fallback:', e.message);
        }
        return adminEmails;
    }

    function isAdmin(email) {
        return !!email && adminEmails.includes(email);
    }

    return { loadAdminEmails, isAdmin, FALLBACK_ADMIN_EMAILS };
})();
