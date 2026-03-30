"use strict";
// Paliers de fidélité Yorgios — constantes métier
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOYALTY_TIERS = void 0;
exports.getNewTier = getNewTier;
exports.getCurrentTier = getCurrentTier;
exports.LOYALTY_TIERS = [
    { minOrders: 10, discountPercent: 5, validityDays: 60, tier: 'bronze' },
    { minOrders: 25, discountPercent: 10, validityDays: 90, tier: 'silver' },
    { minOrders: 50, discountPercent: 15, validityDays: null, tier: 'gold' },
];
/** Retourne le palier atteint exactement par orderCount (pour déclencher la récompense une seule fois) */
function getNewTier(orderCount) {
    var _a;
    return (_a = exports.LOYALTY_TIERS.find(t => t.minOrders === orderCount)) !== null && _a !== void 0 ? _a : null;
}
/** Retourne le palier courant (le plus élevé atteint) */
function getCurrentTier(orderCount) {
    let tier = 'none';
    for (const t of exports.LOYALTY_TIERS) {
        if (orderCount >= t.minOrders)
            tier = t.tier;
    }
    return tier;
}
//# sourceMappingURL=loyalty.js.map