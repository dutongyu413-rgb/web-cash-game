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

test("旧存档按已结算月份迁移", () => {
  const migrated = core.migratePlayerState({ currentMonth: 5, maxMonth: 12, baseExpense: 8000 });
  assert.equal(migrated.completedMonths, 4);
  assert.equal(migrated.stateVersion, core.GAME_STATE_VERSION);
  assert.deepEqual(migrated.monthlySnapshots, []);
  assert.equal(migrated.wellbeingPenalty, 0);
  assert.deepEqual(migrated.wellbeingLedger, []);
});

test("生存分会扣除生活体验分且最多扣20分", () => {
  const base = { completedMonths: 24, maxMonth: 24, finalBuffer: 6, savings: 100000 };
  assert.equal(core.calculateSurvivalScore(base), 100);
  assert.equal(core.calculateSurvivalScore({ ...base, wellbeingPenalty: 7 }), 93);
  assert.equal(core.calculateSurvivalScore({ ...base, wellbeingPenalty: 99 }), 80);
});

test("旧定投已赎回状态迁移为全部卖出", () => {
  const migrated = core.migratePlayerState({
    currentMonth: 3,
    maxMonth: 12,
    baseExpense: 8000,
    longTermPlans: [{ id: "index_dca_001", status: "redeemed" }],
  });
  assert.equal(migrated.longTermPlans[0].status, "sold_all");
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

test("定投市场节点按自然月份推进，不受挑战长度压缩", () => {
  const earliestRecovery = core.getDcaMilestoneMonth(1, core.DCA_TIMING.recoveryDelayMin);
  const earliestOvervalued = core.getDcaMilestoneMonth(earliestRecovery, core.DCA_TIMING.overvaluedDelayMin);
  const laterRecovery = core.getDcaMilestoneMonth(3, 12);
  const laterOvervalued = core.getDcaMilestoneMonth(laterRecovery, 16);
  assert.equal(earliestRecovery, 9);
  assert.equal(earliestOvervalued, 19);
  assert.ok(earliestOvervalued > 12);
  assert.equal(laterRecovery, 15);
  assert.equal(laterOvervalued, 31);
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
