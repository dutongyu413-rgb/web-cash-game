const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("./game-core.js");

test("同一种子会生成相同随机序列", () => {
  let firstState = core.normalizeSeed("internal-test");
  let secondState = core.normalizeSeed("internal-test");
  const first = [];
  const second = [];
  for (let index = 0; index < 8; index += 1) {
    const a = core.nextSeededRandom(firstState);
    const b = core.nextSeededRandom(secondState);
    firstState = a.state;
    secondState = b.state;
    first.push(a.value);
    second.push(b.value);
  }
  assert.deepEqual(first, second);
});

test("不同种子会生成不同随机序列", () => {
  const first = core.nextSeededRandom(core.normalizeSeed("a"));
  const second = core.nextSeededRandom(core.normalizeSeed("b"));
  assert.notEqual(first.value, second.value);
});

test("市场初始报价可以落在低估、正常和高估区间", () => {
  assert.equal(core.createInitialMarketState(0.1, 0.5, 0.5, 1).valuation, "undervalued");
  assert.equal(core.createInitialMarketState(0.5, 0.5, 0.5, 1).valuation, "normal");
  assert.equal(core.createInitialMarketState(0.95, 0.5, 0.5, 1).valuation, "overvalued");
});

test("同一市场状态既可能上涨也可能下跌", () => {
  const initial = core.createInitialMarketState(0.5, 0.5, 0.5, 1);
  const rising = core.advanceMarketState(initial, { month: 2, regimeRandom: 0.2, trendRandom: 0.1, moveRandom: 0.5 });
  const falling = core.advanceMarketState(initial, { month: 2, regimeRandom: 0.9, trendRandom: 0.9, moveRandom: 0.5 });
  assert.equal(rising.trend, "up");
  assert.ok(rising.nav > initial.nav);
  assert.equal(falling.trend, "down");
  assert.ok(falling.nav < initial.nav);
});

test("连续上涨三个月会触发一次市场报价提醒", () => {
  const market = core.normalizeMarketState({
    nav: 3.3,
    history: [
      { month: 1, nav: 3 },
      { month: 2, nav: 3.1 },
      { month: 3, nav: 3.2 },
      { month: 4, nav: 3.3 },
    ],
  });
  assert.equal(core.countConsecutiveMarketRises(market.history), 3);
  assert.equal(core.getLatestMarketMove(market.history), "up");
  assert.equal(core.shouldTriggerRiseStreakQuote(market), true);

  market.riseStreakQuoteActive = true;
  assert.equal(core.shouldTriggerRiseStreakQuote(market), false);
});

test("市场下跌会打断连续上涨计数", () => {
  const history = [
    { month: 1, nav: 3 },
    { month: 2, nav: 3.1 },
    { month: 3, nav: 3.2 },
    { month: 4, nav: 3.05 },
  ];
  assert.equal(core.countConsecutiveMarketRises(history), 0);
  assert.equal(core.getLatestMarketMove(history), "down");
  assert.equal(core.shouldTriggerRiseStreakQuote({ history, riseStreakQuoteActive: false }), false);
});

test("旧市场存档默认尚未触发连续上涨提醒", () => {
  const market = core.normalizeMarketState({ nav: 3.2, history: [{ month: 1, nav: 3.2 }] });
  assert.equal(market.riseStreakQuoteActive, false);
});

test("加权后续结果按随机值稳定落入对应区间", () => {
  const outcomes = [
    { id: "more", weight: 0.6, amount: 2400 },
    { id: "half", weight: 0.4, amount: 1200 },
  ];
  assert.equal(core.pickWeightedOutcome(outcomes, 0.2).id, "more");
  assert.equal(core.pickWeightedOutcome(outcomes, 0.8).id, "half");
  assert.equal(core.pickWeightedOutcome(outcomes, 0.8).amount, 1200);
});

test("没有有效权重时不生成随机后续结果", () => {
  assert.equal(core.pickWeightedOutcome([], 0.5), null);
  assert.equal(core.pickWeightedOutcome([{ id: "invalid", weight: 0 }], 0.5), null);
});

test("随机后续金额可以按固定金额或收入比例结算", () => {
  assert.equal(core.calculateSavingsOutcomeAmount({ amount: 1800 }, 20000), 1800);
  assert.equal(core.calculateSavingsOutcomeAmount({ incomePercent: 0.5 }, 20000), 10000);
  assert.equal(core.calculateSavingsOutcomeAmount({ amount: -3000, incomePercent: 0.5 }, 20000), 7000);
  assert.equal(core.calculateSavingsOutcomeAmount({ incomeLossPercent: 0.25, savingsCost: 5000 }, 28000), -12000);
});

test("收入中断优先于加薪和课程收入", () => {
  const effects = [
    { target: "income", amount: 1500, sourceEventId: "career_course_echo" },
    {
      target: "income_percent",
      amount: -1,
      sourceEventId: "temporary_unemployment",
      blocksRecurringIncome: true,
    },
  ];
  assert.equal(core.isRecurringIncomeBlocked(effects), true);
  assert.equal(core.calculateRecurringIncome(18000, effects), 0);
  assert.equal(core.calculateRecurringIncome(18000, effects.slice(0, 1)), 19500);
});

test("课程回响在收入恢复前顺延", () => {
  const courseEcho = { id: "career_course_echo", waitForIncomeRecovery: true };
  const unemployment = [{ sourceEventId: "temporary_unemployment", blocksRecurringIncome: true }];
  assert.equal(core.shouldDeferScheduledCard(courseEcho, unemployment), true);
  assert.equal(core.shouldDeferScheduledCard(courseEcho, []), false);
});

test("旧存档按已结算月份迁移", () => {
  const migrated = core.migratePlayerState({ currentMonth: 5, maxMonth: 12, baseExpense: 8000 });
  assert.equal(migrated.completedMonths, 4);
  assert.equal(migrated.stateVersion, core.GAME_STATE_VERSION);
  assert.deepEqual(migrated.cashRescueHistory, []);
  assert.deepEqual(migrated.monthlySnapshots, []);
  assert.equal(migrated.wellbeingPenalty, 0);
  assert.deepEqual(migrated.wellbeingLedger, []);
});

test("生存分同时评估最终安全垫和相对开局的管理表现", () => {
  const base = { completedMonths: 24, maxMonth: 24, initialBuffer: 4, finalBuffer: 6, savings: 100000 };
  const breakdown = core.calculateSurvivalScoreBreakdown(base);
  assert.deepEqual(
    {
      monthScore: breakdown.monthScore,
      finalBufferScore: breakdown.finalBufferScore,
      bufferManagementScore: breakdown.bufferManagementScore,
      savingsScore: breakdown.savingsScore,
      baseScore: breakdown.baseScore,
      total: breakdown.total,
    },
    { monthScore: 45, finalBufferScore: 20, bufferManagementScore: 15, savingsScore: 15, baseScore: 5, total: 100 },
  );
  assert.equal(core.calculateSurvivalScore(base), 100);
  assert.equal(core.calculateSurvivalScore({ ...base, wellbeingPenalty: 7 }), 93);
  assert.equal(core.calculateSurvivalScore({ ...base, wellbeingPenalty: 99 }), 80);
});

test("相同结算安全垫会根据不同开局起点反映管理表现", () => {
  const common = { completedMonths: 24, maxMonth: 24, finalBuffer: 4, savings: 80000 };
  const improved = core.calculateSurvivalScoreBreakdown({ ...common, initialBuffer: 2 });
  const maintained = core.calculateSurvivalScoreBreakdown({ ...common, initialBuffer: 4 });
  const declined = core.calculateSurvivalScoreBreakdown({ ...common, initialBuffer: 8 });
  assert.equal(improved.bufferManagementScore, 15);
  assert.equal(maintained.bufferManagementScore, 10);
  assert.equal(declined.bufferManagementScore, 0);
  assert.ok(improved.total > maintained.total);
  assert.ok(maintained.total > declined.total);
});

test("旧定投已赎回状态迁移为全部卖出", () => {
  const migrated = core.migratePlayerState({
    currentMonth: 3,
    maxMonth: 12,
    baseExpense: 8000,
    longTermPlans: [{ id: "index_dca_001", status: "redeemed", totalInvested: 12000, holdingPrincipal: 0 }],
    activeEffects: [{ sourcePlanId: "index_dca_001", target: "expense", amount: 2000 }],
  });
  assert.equal(migrated.investment.status, "sold_all");
  assert.equal(migrated.investment.holdingStatus, "sold_all");
  assert.equal(migrated.investment.dcaStatus, "paused");
  assert.equal(migrated.investment.totalInvested, 12000);
  assert.equal(migrated.longTermPlans.length, 0);
  assert.equal(migrated.activeEffects.length, 0);
});

test("旧定投持仓迁移为净值和份额账户", () => {
  const migrated = core.migratePlayerState({
    currentMonth: 8,
    maxMonth: 24,
    baseExpense: 12000,
    longTermPlans: [
      {
        id: "index_dca_001",
        status: "active",
        monthlyAmount: 2000,
        holdingPrincipal: 12000,
        totalInvested: 12000,
        currentReturnRate: 0.06,
        marketStage: "recovered",
      },
    ],
  });
  assert.equal(migrated.investment.nav, 3.18);
  assert.equal(migrated.investment.shares, 4000);
  assert.equal(migrated.investment.monthlyDcaAmount, 2000);
  assert.equal(migrated.investment.holdingStatus, "holding");
  assert.equal(migrated.investment.dcaStatus, "active");
  assert.equal(migrated.investment.entryMode, "dca");
  assert.equal(Math.round(migrated.investment.shares * migrated.investment.nav), 12720);
});

test("一次性买入迁移后不会被误判为暂停定投", () => {
  const investment = core.normalizeInvestmentState({
    status: "paused",
    entryNav: 3,
    nav: 3.4,
    holdingPrincipal: 6000,
    shares: 2000,
    monthlyDcaAmount: 0,
    actionHistory: [{ month: 1, action: "initial_buy", amount: 6000, nav: 3 }],
  });
  assert.equal(investment.holdingStatus, "holding");
  assert.equal(investment.dcaStatus, "never_started");
  assert.equal(investment.entryMode, "one_time");
  assert.equal(investment.status, "paused");
});

test("卖出一半后的旧定投会保留暂停状态", () => {
  const investment = core.normalizeInvestmentState({
    status: "paused",
    entryNav: 3,
    nav: 3.6,
    holdingPrincipal: 8000,
    shares: 2200,
    monthlyDcaAmount: 2000,
    actionHistory: [
      { month: 1, action: "start_dca", amount: 2000, nav: 3 },
      { month: 8, action: "sell_half", amount: 4500, nav: 3.6 },
    ],
  });
  assert.equal(investment.holdingStatus, "holding");
  assert.equal(investment.dcaStatus, "paused");
});

test("基金申购按当前净值增加份额", () => {
  const purchase = core.calculateFundPurchase(2000, 2.5);
  assert.deepEqual(purchase, { investedAmount: 2000, purchasedShares: 800 });
});

test("基金卖出按份额和当前净值计算回款与已实现盈亏", () => {
  const sale = core.calculateFundSale({ shares: 4000, holdingPrincipal: 12000, ratio: 0.5, nav: 3.3 });
  assert.deepEqual(sale, {
    soldShares: 2000,
    soldPrincipal: 6000,
    soldAmount: 6600,
    realizedProfit: 600,
    remainingShares: 2000,
    remainingPrincipal: 6000,
    status: "paused",
  });
});

test("定投扣款会造成负现金时跳过本月投入并暂停", () => {
  assert.deepEqual(
    core.calculateAffordableInvestmentContribution({ savingsBeforeContribution: 1500, requestedAmount: 2000 }),
    {
      requestedAmount: 2000,
      contributionAmount: 0,
      skippedAmount: 2000,
      shouldPause: true,
      savingsAfterContribution: 1500,
    },
  );
  assert.equal(
    core.calculateAffordableInvestmentContribution({ savingsBeforeContribution: 3000, requestedAmount: 2000 }).contributionAmount,
    2000,
  );
});

test("基金持仓足够时可以计算覆盖现金缺口的最少卖出份额", () => {
  const rescue = core.calculateCashRescueOptions({
    savings: -8000,
    shares: 10000,
    holdingPrincipal: 24000,
    nav: 2.5,
  });
  assert.equal(rescue.eligible, true);
  assert.equal(rescue.deficit, 8000);
  assert.equal(rescue.holdingValue, 25000);
  assert.ok(rescue.partialRatio > 0 && rescue.partialRatio < 1);
  assert.ok(rescue.partialSale.soldAmount >= 8000);
  assert.ok(rescue.savingsAfterPartial >= 0);
  assert.equal(rescue.savingsAfterFull, 17000);
});

test("基金全部卖出仍不足时不能触发现金救场", () => {
  const rescue = core.calculateCashRescueOptions({
    savings: -30000,
    shares: 6000,
    holdingPrincipal: 18000,
    nav: 3,
  });
  assert.equal(rescue.eligible, false);
  assert.equal(rescue.hasHolding, true);
  assert.equal(rescue.holdingValue, 18000);
  assert.equal(rescue.partialSale, null);
});

test("一次性支出只减少现金储备，不抬高月支出", () => {
  const settlement = core.calculateSettlement({
    savingsAfterEffects: 34000,
    recurringIncome: 18000,
    recurringExpense: 13000,
  });
  assert.equal(settlement.currentExpense, 13000);
  assert.equal(settlement.savingsAfterMonth, 39000);
});

test("单月收入比例变化只进入本月结算", () => {
  const affected = core.calculateSettlement({
    savingsAfterEffects: 40000,
    recurringIncome: 18000,
    recurringExpense: 13000,
    tempIncomeDelta: -4500,
  });
  const nextMonth = core.calculateSettlement({
    savingsAfterEffects: affected.savingsAfterMonth,
    recurringIncome: 18000,
    recurringExpense: 13000,
  });
  assert.equal(affected.currentIncome, 13500);
  assert.equal(nextMonth.currentIncome, 18000);
});

test("保障按比例减少符合条件的损失", () => {
  const result = core.calculateProtectionChange(
    -6500,
    { status: "active", coverageRate: 0.5, maxReduction: 20000, totalReduced: 0 },
    true,
  );
  assert.deepEqual(result, { adjustedAmount: -3250, reduction: 3250, totalReduced: 3250 });
});

test("保障累计减少金额不会超过上限", () => {
  const result = core.calculateProtectionChange(
    -15000,
    { status: "active", coverageRate: 0.5, maxReduction: 20000, totalReduced: 18000 },
    true,
  );
  assert.equal(result.reduction, 2000);
  assert.equal(result.totalReduced, 20000);
});

test("卖出一半会计算回款、盈利并暂停继续定投", () => {
  const sale = core.calculateDcaSale(20000, 0.5, 0.18);
  assert.deepEqual(sale, {
    soldPrincipal: 10000,
    soldAmount: 11800,
    realizedProfit: 1800,
    remainingPrincipal: 10000,
    status: "paused",
  });
});

test("全部卖出后持仓归零", () => {
  const sale = core.calculateDcaSale(20000, 1, 0.06);
  assert.equal(sale.soldAmount, 21200);
  assert.equal(sale.remainingPrincipal, 0);
  assert.equal(sale.status, "sold_all");
});

test("投资净值序列会按月份去重并补上结算月份", () => {
  const series = core.getInvestmentPriceSeries(
    [
      { month: 1, nav: 3, stage: "low" },
      { month: 5, nav: 2.6, stage: "low_drop" },
      { month: 5, nav: 2.7, stage: "low_oscillation" },
    ],
    { startMonth: 1, endMonth: 12, endingNav: 2.7 },
  );
  assert.deepEqual(series, [
    { month: 1, nav: 3, stage: "low" },
    { month: 5, nav: 2.7, stage: "low_oscillation" },
    { month: 12, nav: 2.7, stage: "ending" },
  ]);
});

test("投资操作会合并逐月定投和重复持有记录", () => {
  const actions = core.summarizeInvestmentActions([
    { month: 1, action: "start_dca", amount: 2000, nav: 3 },
    { month: 1, action: "monthly_dca", amount: 2000, nav: 3 },
    { month: 2, action: "monthly_dca", amount: 2000, nav: 2.8 },
    { month: 5, action: "hold", nav: 2.7 },
    { month: 9, action: "hold", nav: 3.4 },
    { month: 12, action: "sell_half", amount: 5200, principal: 4000, nav: 3.9 },
  ]);
  assert.equal(actions.length, 4);
  assert.deepEqual(
    actions.map((item) => item.action),
    ["start_dca", "monthly_dca_summary", "hold_summary", "sell_half"],
  );
  assert.deepEqual(
    { count: actions[1].count, amount: actions[1].amount, endMonth: actions[1].endMonth },
    { count: 2, amount: 4000, endMonth: 2 },
  );
  assert.equal(actions[3].amount - actions[3].principal, 1200);
});

test("同月到期的后续事件会全部进入队列且已触发项不会重复", () => {
  const cards = [
    { id: "a", triggerMonth: 4, triggered: false },
    { id: "b", triggerMonth: 4, triggered: false },
    { id: "c", triggerMonth: 3, triggered: true },
    { id: "d", triggerMonth: 5, triggered: false },
  ];
  assert.deepEqual(core.getDueScheduledCards(cards, 4).map((card) => card.id), ["a", "b"]);
});

test("职业事件只在对应身份和触发月份到达后出现", () => {
  const events = [
    { id: "engineer", careerIdentityIds: ["senior_engineer"] },
    { id: "doctor", careerIdentityIds: ["doctor"] },
  ];
  assert.equal(core.getDueCareerEvent(events, { identityId: "doctor", currentMonth: 3, triggerMonth: 4 }), null);
  assert.equal(core.getDueCareerEvent(events, { identityId: "doctor", currentMonth: 4, triggerMonth: 4 }).id, "doctor");
  assert.equal(core.getDueCareerEvent(events, { identityId: "librarian", currentMonth: 4, triggerMonth: 4 }), null);
});

test("已经触发过的职业事件不会再次出现", () => {
  const events = [{ id: "doctor", careerIdentityIds: ["doctor"] }];
  const due = core.getDueCareerEvent(events, {
    identityId: "doctor",
    currentMonth: 8,
    triggerMonth: 4,
    drawnEventIds: ["doctor"],
  });
  assert.equal(due, null);
});

test("持续三个月的效果只结算三次", () => {
  let remaining = 3;
  let activeMonths = 0;
  while (remaining > 0) {
    activeMonths += 1;
    remaining = core.tickDuration(remaining);
  }
  assert.equal(activeMonths, 3);
  assert.equal(remaining, 0);
});

test("结果曲线读取每个月的实际安全垫", () => {
  const buffers = core.getCurveBuffers(3.1, [{ bufferAfterMonth: 2.7 }, { bufferAfterMonth: 3.4 }], 9.9);
  assert.deepEqual(buffers, [3.1, 2.7, 3.4]);
});
