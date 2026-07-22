(function initCashGameCore(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CashGameCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCashGameCore() {
  const GAME_STATE_VERSION = 8;
  const DEFAULT_FUND_NAV = 3;
  const INVESTMENT_TIMING = Object.freeze({
    quoteChance: 0.2,
    riseStreakMonths: 3,
  });

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

  function pickWeightedOutcome(outcomes, randomValue) {
    const available = (Array.isArray(outcomes) ? outcomes : []).filter(
      (outcome) => Number.isFinite(Number(outcome?.weight)) && Number(outcome.weight) > 0,
    );
    if (!available.length) return null;
    const totalWeight = available.reduce((sum, outcome) => sum + Number(outcome.weight), 0);
    const normalizedRandom = Math.max(0, Math.min(0.999999999, Number(randomValue) || 0));
    let cursor = normalizedRandom * totalWeight;
    for (const outcome of available) {
      cursor -= Number(outcome.weight);
      if (cursor < 0) return outcome;
    }
    return available[available.length - 1];
  }

  function calculateSavingsOutcomeAmount(outcome, baseIncome) {
    const income = Number(baseIncome) || 0;
    return Math.round(
      (Number(outcome?.amount) || 0) +
        income * (Number(outcome?.incomePercent) || 0) -
        income * (Number(outcome?.incomeLossPercent) || 0) -
        (Number(outcome?.savingsCost) || 0),
    );
  }

  function inferCompletedMonths(saved) {
    if (Number.isFinite(saved.completedMonths)) return saved.completedMonths;
    if (Array.isArray(saved.monthlySnapshots) && saved.monthlySnapshots.length) return saved.monthlySnapshots.length;
    if (saved.gameEnded && Number.isFinite(saved.endedMonth)) return saved.endedMonth;
    return Math.max(0, (Number(saved.currentMonth) || 1) - 1);
  }

  function normalizeInvestmentState(investment, legacyPlan = null) {
    const source = investment && typeof investment === "object" ? investment : legacyPlan;
    if (!source || typeof source !== "object") return null;
    const entryNav = Math.max(0.01, Number(source.entryNav) || DEFAULT_FUND_NAV);
    const currentReturnRate = Number(source.currentReturnRate) || 0;
    const nav = Math.max(0.01, Number(source.nav) || entryNav * (1 + currentReturnRate));
    const holdingPrincipal = Math.max(0, Number(source.holdingPrincipal) || 0);
    const shares = Math.max(0, Number(source.shares) || (holdingPrincipal ? holdingPrincipal / entryNav : 0));
    const monthlyDcaAmount = Math.max(0, Math.round(Number(source.monthlyDcaAmount ?? source.monthlyAmount) || 0));
    const legacyStatus = source.status === "redeemed" ? "sold_all" : source.status || "not_started";
    const actionHistory = Array.isArray(source.actionHistory) ? source.actionHistory : [];
    const actionNames = new Set(actionHistory.map((item) => item?.action));
    const hadDca =
      source.id === "index_dca_001" ||
      monthlyDcaAmount > 0 ||
      ["start_dca", "monthly_dca", "pause_dca", "resume_dca"].some((action) => actionNames.has(action));
    const holdingStatus =
      source.holdingStatus === "sold_all" || legacyStatus === "sold_all" ? "sold_all" : "holding";
    const validDcaStatuses = new Set(["never_started", "active", "paused"]);
    let dcaStatus = validDcaStatuses.has(source.dcaStatus) ? source.dcaStatus : null;
    if (!dcaStatus) {
      if (legacyStatus === "active") dcaStatus = "active";
      else if (legacyStatus === "paused" && hadDca) dcaStatus = "paused";
      else dcaStatus = hadDca ? "paused" : "never_started";
    }
    if (holdingStatus === "sold_all" && dcaStatus === "active") dcaStatus = "paused";
    const entryMode = source.entryMode || (actionNames.has("initial_buy") && !actionNames.has("start_dca") ? "one_time" : hadDca ? "dca" : "one_time");
    const status = holdingStatus === "sold_all" ? "sold_all" : dcaStatus === "active" ? "active" : "paused";

    return {
      ...source,
      id: "index_fund_001",
      fundName: source.fundName || source.name || "宽基指数基金",
      name: source.name || "宽基指数基金",
      entryNav,
      nav,
      valuation: source.valuation || (source.marketStage === "overvalued" ? "overvalued" : source.marketStage === "recovered" ? "normal" : "undervalued"),
      shares,
      monthlyDcaAmount,
      monthlyAmount: monthlyDcaAmount,
      holdingStatus,
      dcaStatus,
      entryMode,
      holdingPrincipal,
      totalInvested: Math.max(0, Math.round(Number(source.totalInvested) || 0)),
      soldPrincipal: Math.max(0, Math.round(Number(source.soldPrincipal) || 0)),
      realizedAmount: Math.max(0, Math.round(Number(source.realizedAmount) || 0)),
      realizedProfit: Math.round(Number(source.realizedProfit) || 0),
      currentReturnRate: nav / entryNav - 1,
      status,
      priceHistory: Array.isArray(source.priceHistory)
        ? source.priceHistory
        : [{ month: Number(source.startMonth) || 1, nav, stage: source.marketStage || "low" }],
      actionHistory,
    };
  }

  function getMarketValuation(nav) {
    const normalizedNav = Math.max(0.01, Number(nav) || DEFAULT_FUND_NAV);
    if (normalizedNav < 2.9) return "undervalued";
    if (normalizedNav > 4.2) return "overvalued";
    return "normal";
  }

  function createInitialMarketState(valuationRandom = 0, navRandom = 0.5, regimeRandom = 0.5, month = 1) {
    const valuationRoll = Math.max(0, Math.min(0.999999999, Number(valuationRandom) || 0));
    const navRoll = Math.max(0, Math.min(0.999999999, Number(navRandom) || 0));
    const valuation = valuationRoll < 0.4 ? "undervalued" : valuationRoll < 0.85 ? "normal" : "overvalued";
    const ranges = {
      undervalued: [2.3, 2.9],
      normal: [3, 4.1],
      overvalued: [4.2, 5],
    };
    const [minNav, maxNav] = ranges[valuation];
    const nav = Number((minNav + (maxNav - minNav) * navRoll).toFixed(4));
    const regimeRoll = Math.max(0, Math.min(0.999999999, Number(regimeRandom) || 0));
    const regime = regimeRoll < 1 / 3 ? "falling" : regimeRoll < 2 / 3 ? "sideways" : "rising";
    const normalizedMonth = Math.max(1, Math.round(Number(month) || 1));
    return {
      fundName: "宽基指数基金",
      nav,
      previousNav: nav,
      previousQuoteNav: null,
      valuation,
      regime,
      trend: "flat",
      lastUpdatedMonth: normalizedMonth,
      lastQuoteMonth: null,
      lastViewedMonth: null,
      tradedMonth: null,
      riseStreakQuoteActive: false,
      history: [{ month: normalizedMonth, nav, valuation, regime, trend: "flat" }],
    };
  }

  function normalizeMarketState(market, investment = null, currentMonth = 1) {
    if (!market && !investment) return null;
    const source = market && typeof market === "object" ? market : {};
    const investmentHistory = Array.isArray(investment?.priceHistory) ? investment.priceHistory : [];
    const sourceHistory = Array.isArray(source.history) ? source.history : investmentHistory;
    const fallbackNav = Math.max(0.01, Number(investment?.nav) || DEFAULT_FUND_NAV);
    const nav = Math.max(0.01, Number(source.nav) || fallbackNav);
    const normalizedMonth = Math.max(1, Math.round(Number(currentMonth) || 1));
    const history = sourceHistory.length
      ? sourceHistory.map((item) => ({
          month: Math.max(1, Math.round(Number(item.month) || 1)),
          nav: Math.max(0.01, Number(item.nav) || nav),
          valuation: item.valuation || getMarketValuation(item.nav),
          regime: item.regime || source.regime || "sideways",
          trend: item.trend || stageToTrend(item.stage),
        }))
      : [{ month: normalizedMonth, nav, valuation: getMarketValuation(nav), regime: "sideways", trend: "flat" }];
    const lastHistory = history[history.length - 1];
    return {
      fundName: source.fundName || investment?.fundName || "宽基指数基金",
      nav,
      previousNav: Math.max(0.01, Number(source.previousNav) || nav),
      previousQuoteNav:
        source.previousQuoteNav !== null && source.previousQuoteNav !== undefined && Number.isFinite(Number(source.previousQuoteNav))
          ? Number(source.previousQuoteNav)
          : null,
      valuation: source.valuation || getMarketValuation(nav),
      regime: ["rising", "sideways", "falling"].includes(source.regime) ? source.regime : lastHistory.regime,
      trend: ["up", "flat", "down"].includes(source.trend) ? source.trend : lastHistory.trend,
      lastUpdatedMonth: Math.max(1, Math.round(Number(source.lastUpdatedMonth) || lastHistory.month || normalizedMonth)),
      lastQuoteMonth:
        source.lastQuoteMonth !== null && source.lastQuoteMonth !== undefined && Number.isFinite(Number(source.lastQuoteMonth))
          ? Number(source.lastQuoteMonth)
          : null,
      lastViewedMonth:
        source.lastViewedMonth !== null && source.lastViewedMonth !== undefined && Number.isFinite(Number(source.lastViewedMonth))
          ? Number(source.lastViewedMonth)
          : null,
      tradedMonth:
        source.tradedMonth !== null && source.tradedMonth !== undefined && Number.isFinite(Number(source.tradedMonth))
          ? Number(source.tradedMonth)
          : null,
      riseStreakQuoteActive: Boolean(source.riseStreakQuoteActive),
      history,
    };
  }

  function getLatestMarketMove(history) {
    const rows = (Array.isArray(history) ? history : [])
      .filter((item) => Number.isFinite(Number(item?.nav)))
      .sort((first, second) => Number(first.month) - Number(second.month));
    if (rows.length < 2) return "flat";
    const latestNav = Number(rows[rows.length - 1].nav);
    const previousNav = Number(rows[rows.length - 2].nav);
    if (latestNav > previousNav) return "up";
    if (latestNav < previousNav) return "down";
    return "flat";
  }

  function countConsecutiveMarketRises(history) {
    const rows = (Array.isArray(history) ? history : [])
      .filter((item) => Number.isFinite(Number(item?.nav)))
      .sort((first, second) => Number(first.month) - Number(second.month));
    let rises = 0;
    for (let index = rows.length - 1; index > 0; index -= 1) {
      if (Number(rows[index].nav) <= Number(rows[index - 1].nav)) break;
      rises += 1;
    }
    return rises;
  }

  function shouldTriggerRiseStreakQuote(market, requiredMonths = INVESTMENT_TIMING.riseStreakMonths) {
    const threshold = Math.max(1, Math.round(Number(requiredMonths) || INVESTMENT_TIMING.riseStreakMonths));
    return countConsecutiveMarketRises(market?.history) >= threshold && !market?.riseStreakQuoteActive;
  }

  function stageToTrend(stage) {
    if (["low_drop", "pullback", "market_drop"].includes(stage)) return "down";
    if (["recovered", "overvalued", "market_rise"].includes(stage)) return "up";
    return "flat";
  }

  function getMarketRegimeOutcomes(regime = "sideways") {
    if (regime === "rising") {
      return [
        { regime: "rising", weight: 60 },
        { regime: "sideways", weight: 25 },
        { regime: "falling", weight: 15 },
      ];
    }
    if (regime === "falling") {
      return [
        { regime: "rising", weight: 15 },
        { regime: "sideways", weight: 25 },
        { regime: "falling", weight: 60 },
      ];
    }
    return [
      { regime: "rising", weight: 30 },
      { regime: "sideways", weight: 40 },
      { regime: "falling", weight: 30 },
    ];
  }

  function getMarketTrendOutcomes(regime = "sideways") {
    if (regime === "rising") {
      return [
        { trend: "up", weight: 50 },
        { trend: "flat", weight: 25 },
        { trend: "down", weight: 25 },
      ];
    }
    if (regime === "falling") {
      return [
        { trend: "up", weight: 15 },
        { trend: "flat", weight: 30 },
        { trend: "down", weight: 55 },
      ];
    }
    return [
      { trend: "up", weight: 35 },
      { trend: "flat", weight: 30 },
      { trend: "down", weight: 35 },
    ];
  }

  function advanceMarketState(market, { month, regimeRandom, trendRandom, moveRandom } = {}) {
    const current = normalizeMarketState(market, null, month) || createInitialMarketState(0.5, 0.5, 0.5, month);
    const nextRegime = pickWeightedOutcome(getMarketRegimeOutcomes(current.regime), regimeRandom)?.regime || "sideways";
    const trend = pickWeightedOutcome(getMarketTrendOutcomes(nextRegime), trendRandom)?.trend || "flat";
    const moveRoll = Math.max(0, Math.min(0.999999999, Number(moveRandom) || 0));
    const rate = trend === "up" ? 0.02 + moveRoll * 0.06 : trend === "down" ? -(0.02 + moveRoll * 0.06) : -0.02 + moveRoll * 0.04;
    const nextNav = Number(Math.max(1.5, Math.min(6, current.nav * (1 + rate))).toFixed(4));
    const normalizedMonth = Math.max(current.lastUpdatedMonth + 1, Math.round(Number(month) || current.lastUpdatedMonth + 1));
    const next = {
      ...current,
      previousNav: current.nav,
      nav: nextNav,
      valuation: getMarketValuation(nextNav),
      regime: nextRegime,
      trend,
      lastUpdatedMonth: normalizedMonth,
    };
    next.history = [...current.history.filter((item) => item.month !== normalizedMonth), {
      month: normalizedMonth,
      nav: nextNav,
      valuation: next.valuation,
      regime: nextRegime,
      trend,
    }].sort((first, second) => first.month - second.month);
    return next;
  }

  function migratePlayerState(saved) {
    if (!saved || typeof saved !== "object") return null;
    const maxMonth = Math.max(1, Number(saved.maxMonth) || 36);
    const completedMonths = Math.min(maxMonth, Math.max(0, inferCompletedMonths(saved)));
    const savedPlans = Array.isArray(saved.longTermPlans) ? saved.longTermPlans : [];
    const legacyDcaPlan = savedPlans.find((plan) => plan.id === "index_dca_001");
    const investment = normalizeInvestmentState(saved.investment, legacyDcaPlan);
    const market = normalizeMarketState(saved.market, investment, saved.currentMonth);
    const longTermPlans = savedPlans
      .filter((plan) => plan.id !== "index_dca_001")
      .map((plan) => ({ ...plan, status: plan.status === "redeemed" ? "sold_all" : plan.status }));
    const activeEffects = (Array.isArray(saved.activeEffects) ? saved.activeEffects : []).filter(
      (effect) => effect.sourcePlanId !== "index_dca_001" && effect.sourcePlanId !== "index_fund_001",
    );
    return {
      ...saved,
      stateVersion: GAME_STATE_VERSION,
      currentMonth: Math.min(maxMonth, Math.max(1, Number(saved.currentMonth) || completedMonths + 1)),
      completedMonths,
      endedMonth: saved.gameEnded ? Math.min(maxMonth, Number(saved.endedMonth) || completedMonths) : null,
      monthlySnapshots: Array.isArray(saved.monthlySnapshots) ? saved.monthlySnapshots : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      cashRescueHistory: Array.isArray(saved.cashRescueHistory) ? saved.cashRescueHistory : [],
      pendingEchoes: Array.isArray(saved.pendingEchoes) ? saved.pendingEchoes : [],
      pendingTransition: saved.pendingTransition || null,
      pendingMonthlySummary: saved.pendingMonthlySummary || null,
      scheduledCards: Array.isArray(saved.scheduledCards) ? saved.scheduledCards : [],
      activeEffects,
      longTermPlans,
      investment,
      market,
      eventDrawHistory: Array.isArray(saved.eventDrawHistory) ? saved.eventDrawHistory : [],
      wellbeingPenalty: Math.max(0, Number(saved.wellbeingPenalty) || 0),
      wellbeingLedger: Array.isArray(saved.wellbeingLedger) ? saved.wellbeingLedger : [],
    };
  }

  function calculateSurvivalScoreBreakdown({
    completedMonths,
    maxMonth,
    initialBuffer,
    finalBuffer,
    savings,
    wellbeingPenalty = 0,
  }) {
    const normalizedMaxMonth = Math.max(1, Number(maxMonth) || 1);
    const normalizedFinalBuffer = Math.max(0, Number(finalBuffer) || 0);
    const parsedInitialBuffer = Number(initialBuffer);
    const normalizedInitialBuffer = Number.isFinite(parsedInitialBuffer)
      ? Math.max(0, parsedInitialBuffer)
      : normalizedFinalBuffer;
    const monthScore = Math.round(
      Math.max(0, Math.min(45, (Math.max(0, Number(completedMonths) || 0) / normalizedMaxMonth) * 45)),
    );
    const finalBufferScore = Math.round(Math.max(0, Math.min(20, normalizedFinalBuffer * 4)));
    const bufferDelta = normalizedFinalBuffer - normalizedInitialBuffer;
    const bufferManagementScore = Math.round(Math.max(0, Math.min(15, 10 + bufferDelta * 2.5)));
    const savingsScore = Number(savings) > 0 ? 15 : 0;
    const lifeCost = Math.max(0, Math.min(20, Number(wellbeingPenalty) || 0));
    const baseScore = 5;
    const total = Math.round(
      Math.max(
        0,
        Math.min(100, monthScore + finalBufferScore + bufferManagementScore + savingsScore + baseScore - lifeCost),
      ),
    );

    return {
      total,
      monthScore,
      finalBufferScore,
      bufferManagementScore,
      savingsScore,
      baseScore,
      wellbeingPenalty: lifeCost,
      initialBuffer: normalizedInitialBuffer,
      finalBuffer: normalizedFinalBuffer,
      bufferDelta,
    };
  }

  function calculateSurvivalScore(input) {
    return calculateSurvivalScoreBreakdown(input).total;
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

  function isRecurringIncomeBlocked(activeEffects) {
    return (Array.isArray(activeEffects) ? activeEffects : []).some(
      (effect) => effect?.blocksRecurringIncome === true || effect?.sourceEventId === "temporary_unemployment",
    );
  }

  function calculateRecurringIncome(baseIncome, activeEffects) {
    if (isRecurringIncomeBlocked(activeEffects)) return 0;
    const income = (Array.isArray(activeEffects) ? activeEffects : []).reduce((total, effect) => {
      if (effect?.target === "income") return total + (Number(effect.amount) || 0);
      if (effect?.target === "income_percent") return total + (Number(baseIncome) || 0) * (Number(effect.amount) || 0);
      return total;
    }, Number(baseIncome) || 0);
    return Math.max(0, Math.round(income));
  }

  function shouldDeferScheduledCard(card, activeEffects) {
    const waitsForIncomeRecovery = card?.waitForIncomeRecovery === true || card?.id === "career_course_echo";
    return waitsForIncomeRecovery && isRecurringIncomeBlocked(activeEffects);
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

  function calculateFundPurchase(amount, nav) {
    const investedAmount = Math.max(0, Math.round(Number(amount) || 0));
    const normalizedNav = Math.max(0.01, Number(nav) || DEFAULT_FUND_NAV);
    return {
      investedAmount,
      purchasedShares: investedAmount / normalizedNav,
    };
  }

  function calculateFundSale({ shares, holdingPrincipal, ratio, nav }) {
    const availableShares = Math.max(0, Number(shares) || 0);
    const principal = Math.max(0, Math.round(Number(holdingPrincipal) || 0));
    const normalizedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const normalizedNav = Math.max(0.01, Number(nav) || DEFAULT_FUND_NAV);
    const soldShares = availableShares * normalizedRatio;
    const soldPrincipal = Math.min(principal, Math.round(principal * normalizedRatio));
    const soldAmount = Math.max(0, Math.round(soldShares * normalizedNav));
    const remainingShares = Math.max(0, availableShares - soldShares);
    const remainingPrincipal = Math.max(0, principal - soldPrincipal);
    return {
      soldShares,
      soldPrincipal,
      soldAmount,
      realizedProfit: soldAmount - soldPrincipal,
      remainingShares,
      remainingPrincipal,
      status: remainingShares <= 0.000001 || remainingPrincipal <= 0 ? "sold_all" : "paused",
    };
  }

  function calculateAffordableInvestmentContribution({ savingsBeforeContribution, requestedAmount }) {
    const savings = Math.round(Number(savingsBeforeContribution) || 0);
    const requested = Math.max(0, Math.round(Number(requestedAmount) || 0));
    const canExecute = requested > 0 && savings - requested >= 0;
    return {
      requestedAmount: requested,
      contributionAmount: canExecute ? requested : 0,
      skippedAmount: requested > 0 && !canExecute ? requested : 0,
      shouldPause: requested > 0 && !canExecute,
      savingsAfterContribution: canExecute ? savings - requested : savings,
    };
  }

  function calculateCashRescueOptions({ savings, shares, holdingPrincipal, nav }) {
    const currentSavings = Math.round(Number(savings) || 0);
    const deficit = Math.max(0, -currentSavings);
    const normalizedShares = Math.max(0, Number(shares) || 0);
    const normalizedPrincipal = Math.max(0, Math.round(Number(holdingPrincipal) || 0));
    const normalizedNav = Math.max(0.01, Number(nav) || DEFAULT_FUND_NAV);
    const fullSale = calculateFundSale({
      shares: normalizedShares,
      holdingPrincipal: normalizedPrincipal,
      ratio: 1,
      nav: normalizedNav,
    });
    const hasHolding = normalizedShares > 0.000001 && normalizedPrincipal > 0 && fullSale.soldAmount > 0;
    const canCover = deficit > 0 && hasHolding && fullSale.soldAmount >= deficit;

    if (!canCover) {
      return {
        eligible: false,
        hasHolding,
        deficit,
        holdingValue: fullSale.soldAmount,
        partialRatio: 0,
        partialSale: null,
        fullSale,
        savingsAfterPartial: currentSavings,
        savingsAfterFull: currentSavings + fullSale.soldAmount,
      };
    }

    const rawHoldingValue = Math.max(0.01, normalizedShares * normalizedNav);
    let partialRatio = Math.min(1, deficit / rawHoldingValue);
    let partialSale = calculateFundSale({
      shares: normalizedShares,
      holdingPrincipal: normalizedPrincipal,
      ratio: partialRatio,
      nav: normalizedNav,
    });
    if (partialSale.soldAmount < deficit) {
      partialRatio = Math.min(1, partialRatio + (deficit - partialSale.soldAmount + 0.51) / rawHoldingValue);
      partialSale = calculateFundSale({
        shares: normalizedShares,
        holdingPrincipal: normalizedPrincipal,
        ratio: partialRatio,
        nav: normalizedNav,
      });
    }

    return {
      eligible: partialSale.soldAmount >= deficit,
      hasHolding,
      deficit,
      holdingValue: fullSale.soldAmount,
      partialRatio,
      partialSale,
      fullSale,
      savingsAfterPartial: currentSavings + partialSale.soldAmount,
      savingsAfterFull: currentSavings + fullSale.soldAmount,
    };
  }

  function getInvestmentPriceSeries(priceHistory, { startMonth = 1, endMonth, endingNav = DEFAULT_FUND_NAV } = {}) {
    const records = (Array.isArray(priceHistory) ? priceHistory : [])
      .filter((item) => Number.isFinite(Number(item?.month)) && Number(item?.nav) > 0)
      .map((item) => ({
        month: Math.max(1, Math.round(Number(item.month))),
        nav: Number(item.nav),
        stage: item.stage || "unknown",
      }))
      .sort((first, second) => first.month - second.month);
    const byMonth = new Map();
    records.forEach((item) => byMonth.set(item.month, item));
    const series = [...byMonth.values()].sort((first, second) => first.month - second.month);
    const normalizedStartMonth = Math.max(1, Math.round(Number(startMonth) || 1));
    const normalizedEndingNav = Math.max(0.01, Number(endingNav) || DEFAULT_FUND_NAV);

    if (!series.length) {
      series.push({ month: normalizedStartMonth, nav: normalizedEndingNav, stage: "entry" });
    }

    const normalizedEndMonth = Number.isFinite(Number(endMonth))
      ? Math.max(normalizedStartMonth, Math.round(Number(endMonth)))
      : null;
    if (normalizedEndMonth && series[series.length - 1].month < normalizedEndMonth) {
      series.push({ month: normalizedEndMonth, nav: normalizedEndingNav, stage: "ending" });
    }
    return series;
  }

  function summarizeInvestmentActions(actionHistory) {
    const records = (Array.isArray(actionHistory) ? actionHistory : [])
      .filter((item) => item && typeof item.action === "string" && Number.isFinite(Number(item.month)))
      .map((item, index) => ({
        ...item,
        month: Math.max(1, Math.round(Number(item.month))),
        amount: Math.round(Number(item.amount) || 0),
        principal: Math.round(Number(item.principal) || 0),
        nav: Number(item.nav) || null,
        sequence: index,
      }));
    const monthly = records.filter((item) => item.action === "monthly_dca");
    const holds = records.filter((item) => item.action === "hold");
    const summary = records.filter((item) => !["monthly_dca", "hold"].includes(item.action));

    if (monthly.length) {
      summary.push({
        action: "monthly_dca_summary",
        month: monthly[0].month,
        endMonth: monthly[monthly.length - 1].month,
        count: monthly.length,
        amount: monthly.reduce((sum, item) => sum + item.amount, 0),
        sequence: monthly[0].sequence + 0.1,
      });
    }
    if (holds.length) {
      summary.push({
        action: "hold_summary",
        month: holds[0].month,
        endMonth: holds[holds.length - 1].month,
        count: holds.length,
        amount: 0,
        sequence: holds[0].sequence + 0.1,
      });
    }

    return summary.sort((first, second) => first.month - second.month || first.sequence - second.sequence);
  }

  function getInvestmentReturnBand(returnRate) {
    const normalizedRate = Number(returnRate);
    if (!Number.isFinite(normalizedRate)) return "unknown";
    if (normalizedRate < -0.05) return "loss_over_5pct";
    if (normalizedRate < 0) return "slight_loss";
    if (normalizedRate <= 0.05) return "flat";
    if (normalizedRate <= 0.2) return "gain_under_20pct";
    return "gain_over_20pct";
  }

  function getViewDurationBand(seconds) {
    const normalizedSeconds = Math.max(0, Number(seconds) || 0);
    if (normalizedSeconds < 5) return "under_5_seconds";
    if (normalizedSeconds < 15) return "5_to_15_seconds";
    return "over_15_seconds";
  }

  function getDueScheduledCards(cards, currentMonth) {
    return (Array.isArray(cards) ? cards : []).filter(
      (card) => !card.triggered && Number(card.triggerMonth) <= Number(currentMonth),
    );
  }

  function getDueCareerEvent(events, { identityId, currentMonth, triggerMonth, drawnEventIds = [] } = {}) {
    if (!identityId || !Number.isFinite(Number(triggerMonth)) || Number(currentMonth) < Number(triggerMonth)) return null;
    const drawnIds = new Set(Array.isArray(drawnEventIds) ? drawnEventIds : []);
    return (
      (Array.isArray(events) ? events : []).find(
        (event) =>
          Array.isArray(event?.careerIdentityIds) &&
          event.careerIdentityIds.includes(identityId) &&
          !drawnIds.has(event.id),
      ) || null
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
    INVESTMENT_TIMING,
    DEFAULT_FUND_NAV,
    normalizeSeed,
    nextSeededRandom,
    pickWeightedOutcome,
    calculateSavingsOutcomeAmount,
    migratePlayerState,
    calculateSurvivalScore,
    calculateSurvivalScoreBreakdown,
    calculateSettlement,
    isRecurringIncomeBlocked,
    calculateRecurringIncome,
    shouldDeferScheduledCard,
    calculateProtectionChange,
    calculateDcaSale,
    calculateFundPurchase,
    calculateFundSale,
    calculateAffordableInvestmentContribution,
    calculateCashRescueOptions,
    getInvestmentPriceSeries,
    summarizeInvestmentActions,
    getInvestmentReturnBand,
    getViewDurationBand,
    normalizeInvestmentState,
    getMarketValuation,
    createInitialMarketState,
    normalizeMarketState,
    getLatestMarketMove,
    countConsecutiveMarketRises,
    shouldTriggerRiseStreakQuote,
    getMarketRegimeOutcomes,
    getMarketTrendOutcomes,
    advanceMarketState,
    getDueScheduledCards,
    getDueCareerEvent,
    tickDuration,
    getCurveBuffers,
  };
});
