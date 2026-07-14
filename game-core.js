(function initCashGameCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CashGameCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCashGameCore() {
  const GAME_STATE_VERSION = 2;

  function normalizeSeed(seed) {
    const text = String(seed ?? "cash-game");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 0x6d2b79f5;
  }

  function nextSeededRandom(state) {
    let nextState = (Number(state) >>> 0) || 0x6d2b79f5;
    nextState ^= nextState << 13;
    nextState ^= nextState >>> 17;
    nextState ^= nextState << 5;
    nextState >>>= 0;
    return { state: nextState, value: nextState / 4294967296 };
  }

  function inferCompletedMonths(saved) {
    if (Number.isFinite(saved.completedMonths)) return saved.completedMonths;
    if (Array.isArray(saved.monthlySnapshots) && saved.monthlySnapshots.length) return saved.monthlySnapshots.length;
    if (saved.gameEnded && Number.isFinite(saved.endedMonth)) return saved.endedMonth;
    return Math.max(0, (Number(saved.currentMonth) || 1) - 1);
  }

  function migratePlayerState(saved) {
    if (!saved || typeof saved !== "object") return null;
    const maxMonth = Math.max(1, Number(saved.maxMonth) || 36);
    const completedMonths = Math.min(maxMonth, Math.max(0, inferCompletedMonths(saved)));
    const longTermPlans = Array.isArray(saved.longTermPlans)
      ? saved.longTermPlans.map((plan) => ({ ...plan, status: plan.status === "redeemed" ? "sold_all" : plan.status }))
      : [];
    return {
      ...saved,
      stateVersion: GAME_STATE_VERSION,
      currentMonth: Math.min(maxMonth, Math.max(1, Number(saved.currentMonth) || completedMonths + 1)),
      completedMonths,
      endedMonth: saved.gameEnded ? Math.min(maxMonth, Number(saved.endedMonth) || completedMonths) : null,
      monthlySnapshots: Array.isArray(saved.monthlySnapshots) ? saved.monthlySnapshots : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      pendingEchoes: Array.isArray(saved.pendingEchoes) ? saved.pendingEchoes : [],
      pendingTransition: saved.pendingTransition || null,
      pendingMonthlySummary: saved.pendingMonthlySummary || null,
      scheduledCards: Array.isArray(saved.scheduledCards) ? saved.scheduledCards : [],
      activeEffects: Array.isArray(saved.activeEffects) ? saved.activeEffects : [],
      longTermPlans,
      eventDrawHistory: Array.isArray(saved.eventDrawHistory) ? saved.eventDrawHistory : [],
    };
  }

  function calculateProtectionChange(amount, plan, eligible) {
    if (amount >= 0 || !eligible || !plan || plan.status !== "active") {
      return { adjustedAmount: amount, reduction: 0, totalReduced: plan?.totalReduced || 0 };
    }
    const coverageRate = Number(plan.coverageRate) || 0;
    const maxReduction = Math.max(0, Number(plan.maxReduction) || 0);
    const totalReduced = Math.max(0, Number(plan.totalReduced) || 0);
    const reduction = Math.min(Math.round(Math.abs(amount) * coverageRate), Math.max(0, maxReduction - totalReduced));
    return {
      adjustedAmount: amount + reduction,
      reduction,
      totalReduced: totalReduced + reduction,
    };
  }

  function calculateSettlement({ savingsAfterEffects, recurringIncome, recurringExpense, tempIncomeDelta = 0, tempExpenseDelta = 0 }) {
    const currentIncome = Math.max(0, Math.round((Number(recurringIncome) || 0) + (Number(tempIncomeDelta) || 0)));
    const currentExpense = Math.max(0, Math.round((Number(recurringExpense) || 0) + (Number(tempExpenseDelta) || 0)));
    const monthlyNetCashflow = currentIncome - currentExpense;
    return {
      currentIncome,
      currentExpense,
      monthlyNetCashflow,
      savingsAfterMonth: (Number(savingsAfterEffects) || 0) + monthlyNetCashflow,
    };
  }

  function calculateDcaSale(holdingPrincipal, ratio, returnRate) {
    const principal = Math.max(0, Math.round(Number(holdingPrincipal) || 0));
    const normalizedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const soldPrincipal = Math.min(principal, Math.round(principal * normalizedRatio));
    const soldAmount = Math.max(0, Math.round(soldPrincipal * (1 + (Number(returnRate) || 0))));
    return {
      soldPrincipal,
      soldAmount,
      realizedProfit: soldAmount - soldPrincipal,
      remainingPrincipal: Math.max(0, principal - soldPrincipal),
      status: principal - soldPrincipal <= 0 ? "sold_all" : "paused",
    };
  }

  function getDueScheduledCards(cards, currentMonth) {
    return (Array.isArray(cards) ? cards : []).filter(
      (card) => !card.triggered && Number(card.triggerMonth) <= Number(currentMonth),
    );
  }

  function tickDuration(remainingMonths) {
    if (!Number.isFinite(remainingMonths)) return remainingMonths;
    return Math.max(0, remainingMonths - 1);
  }

  function getCurveBuffers(initialBuffer, snapshots, finalBuffer) {
    const values = [Number(initialBuffer) || 0];
    (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
      if (Number.isFinite(snapshot.bufferAfterMonth)) values.push(snapshot.bufferAfterMonth);
    });
    if (values.length === 1 && Number.isFinite(finalBuffer)) values.push(finalBuffer);
    return values;
  }

  return {
    GAME_STATE_VERSION,
    normalizeSeed,
    nextSeededRandom,
    migratePlayerState,
    calculateSettlement,
    calculateProtectionChange,
    calculateDcaSale,
    getDueScheduledCards,
    tickDuration,
    getCurveBuffers,
  };
});
