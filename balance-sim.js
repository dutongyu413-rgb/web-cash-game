const fs = require("node:fs");
const path = require("node:path");

const core = require("./game-core.js");
const eventCards = require("./event-cards.js");
const identityCards = require("./identity-cards.js");

const RUNS_PER_COMBINATION = 120;
const CHALLENGE_LENGTHS = [12, 24, 36];
const STRATEGIES = ["random", "reserve", "participate"];
const STRATEGY_LABELS = { random: "随机选择", reserve: "储备优先", participate: "积极参与" };
const MAP_CELLS = [
  ["expense_up", "one_time_cost"],
  ["income_down"],
  ["positive", "income_down", "expense_up"],
  ["choice"],
  ["health_risk"],
  ["positive"],
  ["expense_up"],
  ["income_down", "positive"],
  ["choice"],
  ["health_risk", "one_time_cost"],
  ["expense_up", "positive"],
  ["income_down"],
  ["one_time_cost", "expense_up"],
  ["positive"],
  ["choice"],
  ["health_risk"],
];
const ONCE_IDS = new Set([
  "home_appliance",
  "moving_cost",
  "pipe_leak",
  "elder_hospital",
  "insurance_gap",
  "temporary_unemployment",
  "index_dca_choice",
  "career_course",
  "buy_car_choice",
  "emergency_fund_choice",
  "insurance_review_choice",
  "rent_or_commute_choice",
  "childcare_cost",
  "rent_up",
  "sell_unused",
  "subscription_cleanup",
  "deposit_return",
]);
const HEALTH_IDS = new Set([
  "elder_hospital",
  "insurance_gap",
  "minor_illness",
  "dental_cost",
  "child_fever",
  "sports_injury",
]);

function createRandom(seed) {
  let state = core.normalizeSeed(seed);
  return () => {
    const next = core.nextSeededRandom(state);
    state = next.state;
    return next.value;
  };
}

function randomInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function weightedPick(random, items, weightFor) {
  const total = items.reduce((sum, item) => sum + weightFor(item), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= weightFor(item);
    if (roll <= 0) return item;
  }
  return items.at(-1);
}

function eventCooldown(event) {
  if (event.group === "interest") return 9;
  if (["salary_cut", "client_budget_cut", "temporary_unemployment", "elder_hospital", "insurance_gap", "emergency_fund_choice"].includes(event.id)) return 8;
  if (Array.isArray(event.choices)) return 7;
  if (event.category === "one_time_cost") return 5;
  return 4;
}

function eventMaxCount(event) {
  if (event.group === "interest") return 2;
  if (ONCE_IDS.has(event.id) || Array.isArray(event.choices)) return 1;
  if (["one_time_cost", "health_risk"].includes(event.category)) return 2;
  return Infinity;
}

function defaultWeight(event, month) {
  if (event.id === "index_dca_choice" && month <= 10) return 2.6;
  if (event.group === "interest") return 0.7;
  if (["temporary_unemployment", "elder_hospital"].includes(event.id)) return 0.6;
  if (["salary_cut", "insurance_gap"].includes(event.id)) return 0.8;
  if (event.category === "positive") return 1.2;
  return 1;
}

function eventCount(state, eventId) {
  return state.draws.filter((draw) => draw.id === eventId).length;
}

function eventAllowed(state, event) {
  if (Array.isArray(event.careerIdentityIds) && !event.careerIdentityIds.includes(state.identityId)) return false;
  if (event.group === "interest") {
    const interestIds = new Set(eventCards.filter((card) => card.group === "interest").map((card) => card.id));
    if (state.draws.filter((draw) => interestIds.has(draw.id)).length >= 2) return false;
  }
  if (eventCount(state, event.id) >= eventMaxCount(event)) return false;
  if (state.activeEffects.some((effect) => effect.sourceEventId === event.id)) return false;
  if (event.id === "index_dca_choice" && (state.dca || state.month > 10)) return false;
  return true;
}

function drawEvent(state, random) {
  const careerEvent = core.getDueCareerEvent(eventCards, {
    identityId: state.identityId,
    currentMonth: state.month,
    triggerMonth: state.careerEventMonth,
    drawnEventIds: state.draws.map((draw) => draw.id),
  });
  if (careerEvent) return careerEvent;
  const dcaEvent = eventCards.find((event) => event.id === "index_dca_choice");
  const dcaAvailable = dcaEvent && eventAllowed(state, dcaEvent);
  if (dcaAvailable && state.month === Math.min(10, state.maxMonth)) return dcaEvent;

  const categories = MAP_CELLS[state.position];
  const pool = categories.flatMap((category) =>
    eventCards.filter((event) => event.category === category && !Array.isArray(event.careerIdentityIds)),
  );
  const eligible = pool.filter((event) => eventAllowed(state, event));
  const cooled = eligible.filter((event) => {
    const last = [...state.draws].reverse().find((draw) => draw.id === event.id);
    return !last || state.month - last.month >= eventCooldown(event);
  });
  const fallback = eventCards.filter((event) => !Array.isArray(event.careerIdentityIds) && eventAllowed(state, event));
  if (dcaAvailable && state.month >= 6 && random() < 0.35) return dcaEvent;
  const candidates = cooled.length ? cooled : eligible.length ? eligible : fallback;
  return weightedPick(random, candidates, (event) => event.weight || defaultWeight(event, state.month));
}

function recurringIncome(state) {
  return Math.max(
    0,
    Math.round(
      state.baseIncome +
        state.activeEffects.reduce((sum, effect) => {
          if (effect.target === "income") return sum + effect.amount;
          if (effect.target === "income_percent") return sum + state.baseIncome * effect.amount;
          return sum;
        }, 0),
    ),
  );
}

function recurringExpense(state) {
  return Math.max(
    0,
    Math.round(
      state.baseExpense +
        state.activeEffects.reduce((sum, effect) => {
          if (effect.target === "expense") return sum + effect.amount;
          if (effect.target === "expense_percent") return sum + state.baseExpense * effect.amount;
          return sum;
        }, 0),
    ),
  );
}

function estimateEffectValue(effect, state, monthsLeft) {
  if (!effect || effect.type === "none") return 0;
  if (effect.type === "change_savings") return effect.amount;
  if (effect.type === "change_savings_by_income_percent") return state.baseIncome * effect.amount;
  if (effect.type === "one_month_income_change") return effect.amount;
  if (effect.type === "one_month_income_percent") return state.baseIncome * effect.amount;
  if (effect.type === "one_month_expense_change") return -effect.amount;
  if (effect.type === "one_month_expense_percent") return -state.baseExpense * effect.amount;
  if (effect.type === "add_active_effect") {
    const duration = Math.min(effect.duration, monthsLeft);
    const base = effect.target.includes("income") ? state.baseIncome : state.baseExpense;
    const amount = effect.target.includes("percent") ? base * effect.amount : effect.amount;
    return (effect.target.startsWith("income") ? amount : -amount) * duration;
  }
  if (effect.type === "add_uncertain_active_effect") {
    const duration = Math.min(effect.maxMonths, monthsLeft);
    const base = effect.target.includes("percent") ? state.baseIncome : 1;
    return base * effect.amount * duration;
  }
  if (effect.type === "schedule_savings_effect") return effect.amount;
  if (effect.type === "schedule_savings_by_income_percent") return state.baseIncome * effect.amount;
  if (effect.type === "schedule_random_savings_effect") {
    const totalWeight = effect.outcomes.reduce((sum, outcome) => sum + outcome.weight, 0);
    return (
      effect.outcomes.reduce(
        (sum, outcome) => sum + core.calculateSavingsOutcomeAmount(outcome, state.baseIncome) * outcome.weight,
        0,
      ) / totalWeight
    );
  }
  if (effect.type === "schedule_active_effect") {
    const duration = Math.min(effect.duration, Math.max(0, monthsLeft - effect.triggerDelay));
    const base = effect.target.includes("income") ? state.baseIncome : state.baseExpense;
    const amount = effect.target.includes("percent") ? base * effect.amount : effect.amount;
    return (effect.target.startsWith("income") ? amount : -amount) * duration;
  }
  if (effect.type === "career_course_plan") return -effect.cost + 0.7 * 1500 * Math.min(12, monthsLeft);
  if (effect.type === "start_protection_plan") return -effect.monthlyAmount * Math.min(effect.duration, monthsLeft) + effect.maxReduction * 0.2;
  if (effect.type === "start_dca_plan") return -effect.monthlyAmount * Math.min(6, monthsLeft) * 0.15;
  if (effect.type === "buy_car") return -50000 - 2500 * Math.min(12, monthsLeft);
  if (effect.type === "invest_or_reserve") return effect.amount;
  if (effect.type === "bonus_invest_or_reserve") return state.baseIncome;
  if (effect.type === "compound") return effect.effects.reduce((sum, item) => sum + estimateEffectValue(item, state, monthsLeft), 0);
  return 0;
}

function chooseOption(card, state, strategy, random) {
  if (!card.choices) return null;
  if (strategy === "participate") return card.choices[0];
  if (strategy === "random") return card.choices[Math.floor(random() * card.choices.length)];
  const monthsLeft = state.maxMonth - state.month + 1;
  return [...card.choices].sort(
    (first, second) => estimateEffectValue(second.effect, state, monthsLeft) - estimateEffectValue(first.effect, state, monthsLeft),
  )[0];
}

function addActiveEffect(state, effect, eventId, extra = {}) {
  state.activeEffects.push({
    target: effect.target,
    amount: effect.amount,
    remainingMonths: effect.duration,
    sourceEventId: eventId,
    ...extra,
  });
}

function scheduledTriggerMonth(state, effect) {
  const triggerMonth = state.month + effect.triggerDelay;
  return effect.preserveDelay ? triggerMonth : Math.min(state.maxMonth, triggerMonth);
}

function applySavingsChange(state, amount, card) {
  let adjusted = amount;
  if (amount < 0 && state.protection?.status === "active" && (card.category === "health_risk" || HEALTH_IDS.has(card.id))) {
    const result = core.calculateProtectionChange(amount, state.protection, true);
    adjusted = result.adjustedAmount;
    state.protection.totalReduced = result.totalReduced;
  }
  state.savings += adjusted;
}

function applyEffect(state, effect, card, random) {
  if (!effect || effect.type === "none") return;
  if (effect.type === "change_savings") return applySavingsChange(state, effect.amount, card);
  if (effect.type === "change_savings_by_income_percent") {
    state.savings += Math.round(state.baseIncome * effect.amount);
    return;
  }
  if (effect.type === "one_month_income_change") state.tempIncome += effect.amount;
  if (effect.type === "one_month_income_percent") state.tempIncome += state.baseIncome * effect.amount;
  if (effect.type === "one_month_expense_change") state.tempExpense += effect.amount;
  if (effect.type === "one_month_expense_percent") state.tempExpense += state.baseExpense * effect.amount;
  if (["one_month_income_change", "one_month_income_percent", "one_month_expense_change", "one_month_expense_percent"].includes(effect.type)) return;

  if (effect.type === "add_active_effect") return addActiveEffect(state, effect, card.id);
  if (effect.type === "add_uncertain_active_effect") {
    return addActiveEffect(state, { ...effect, duration: null }, card.id, {
      uncertain: true,
      elapsedMonths: 0,
      minMonths: effect.minMonths,
      maxMonths: effect.maxMonths,
      recoveryChance: effect.recoveryChance,
    });
  }
  if (effect.type === "schedule_active_effect") {
    state.scheduled.push({
      id: effect.id || `${card.id}_scheduled`,
      type: "active_effect",
      triggerMonth: scheduledTriggerMonth(state, effect),
      target: effect.target,
      amount: effect.amount,
      duration: effect.duration,
      sourceEventId: effect.id || card.id,
    });
    return;
  }
  if (effect.type === "schedule_savings_effect") {
    state.scheduled.push({
      id: effect.id || `${card.id}_scheduled`,
      type: "savings_effect",
      triggerMonth: scheduledTriggerMonth(state, effect),
      amount: effect.amount,
    });
    return;
  }
  if (effect.type === "schedule_savings_by_income_percent") {
    state.scheduled.push({
      id: effect.id || `${card.id}_scheduled`,
      type: "savings_effect",
      triggerMonth: scheduledTriggerMonth(state, effect),
      amount: Math.round(state.baseIncome * effect.amount),
    });
    return;
  }
  if (effect.type === "schedule_random_savings_effect") {
    state.scheduled.push({
      id: effect.id || `${card.id}_scheduled`,
      type: "random_savings_effect",
      triggerMonth: scheduledTriggerMonth(state, effect),
      outcomes: effect.outcomes.map((outcome) => ({ ...outcome })),
    });
    return;
  }
  if (effect.type === "start_dca_plan" && !state.dca) {
    state.dca = {
      status: "active",
      monthlyAmount: effect.monthlyAmount,
      holdingPrincipal: 0,
      recoveryMonth: Math.min(state.month + randomInt(random, 3, 5), Math.max(state.month + 1, state.maxMonth - 1)),
      overvaluedMonth: null,
      recoveryTriggered: false,
      overvaluedTriggered: false,
    };
    addActiveEffect(state, { target: "expense", amount: effect.monthlyAmount, duration: 999 }, card.id, { sourcePlanId: "dca" });
    return;
  }
  if (effect.type === "start_protection_plan" && !state.protection) {
    state.protection = { ...effect, status: "active", remainingMonths: effect.duration, totalReduced: 0 };
    addActiveEffect(state, { target: "expense", amount: effect.monthlyAmount, duration: effect.duration }, card.id, { sourcePlanId: "protection" });
    return;
  }
  if (effect.type === "career_course_plan") {
    state.savings -= effect.cost;
    state.scheduled.push({ id: "career_course_echo", type: "career", triggerMonth: Math.min(state.maxMonth, state.month + randomInt(random, 3, 5)) });
    return;
  }
  if (effect.type === "buy_car") {
    state.savings -= 50000;
    addActiveEffect(state, { target: "expense", amount: 2500, duration: 36 }, card.id);
    state.scheduled.push({ id: "car_maintenance", type: "savings_effect", triggerMonth: Math.min(state.maxMonth, state.month + randomInt(random, 3, 5)), amount: -1200 });
    state.scheduled.push({ id: "car_parking_fee", type: "active_effect", triggerMonth: Math.min(state.maxMonth, state.month + randomInt(random, 2, 4)), target: "expense", amount: 500, duration: 6, sourceEventId: "car_parking_fee" });
    state.scheduled.push({ id: "car_commute_efficiency", type: "active_effect", triggerMonth: Math.min(state.maxMonth, state.month + randomInt(random, 3, 6)), target: "income", amount: 800, duration: 6, sourceEventId: "car_commute_efficiency" });
    return;
  }
  if (["invest_or_reserve", "bonus_invest_or_reserve"].includes(effect.type)) {
    const amount = effect.type === "bonus_invest_or_reserve" ? state.baseIncome : effect.amount;
    const investAmount = Math.round(amount * (effect.investPercent || 0.5));
    if (state.dca && state.dca.status !== "sold_all") {
      state.dca.holdingPrincipal += investAmount;
      state.savings += amount - investAmount;
    } else {
      state.savings += amount;
    }
    return;
  }
  if (effect.type === "compound") effect.effects.forEach((item) => applyEffect(state, item, card, random));
}

function removePlanExpense(state, planId) {
  state.activeEffects = state.activeEffects.filter((effect) => effect.sourcePlanId !== planId);
}

function processDcaMarket(state, strategy, random) {
  const plan = state.dca;
  if (!plan || plan.status === "sold_all" || plan.holdingPrincipal <= 0) return;
  let stage = null;
  if (!plan.recoveryTriggered && state.month >= plan.recoveryMonth) {
    plan.recoveryTriggered = true;
    plan.overvaluedMonth = Math.min(state.maxMonth, state.month + randomInt(random, 3, 5));
    stage = "recovered";
  } else if (plan.recoveryTriggered && !plan.overvaluedTriggered && state.month >= plan.overvaluedMonth) {
    plan.overvaluedTriggered = true;
    stage = "overvalued";
  }
  if (!stage) return;

  const randomChoices = stage === "recovered" ? ["sell_half", "hold", "stop"] : ["sell_half", "sell_all", "hold"];
  const action =
    strategy === "random"
      ? randomChoices[Math.floor(random() * randomChoices.length)]
      : strategy === "reserve"
        ? stage === "recovered" ? "sell_half" : "sell_all"
        : stage === "recovered" ? "hold" : "sell_half";
  if (action === "hold") return;
  if (action === "stop") {
    plan.status = "paused";
    removePlanExpense(state, "dca");
    return;
  }
  const sale = core.calculateDcaSale(plan.holdingPrincipal, action === "sell_all" ? 1 : 0.5, stage === "overvalued" ? 0.18 : 0.06);
  state.savings += sale.soldAmount;
  plan.holdingPrincipal = sale.remainingPrincipal;
  plan.status = sale.status;
  removePlanExpense(state, "dca");
}

function processEndOfMonth(state, random) {
  if (state.dca?.status === "active") state.dca.holdingPrincipal += state.dca.monthlyAmount;
  if (state.protection?.status === "active") {
    state.protection.remainingMonths -= 1;
    if (state.protection.remainingMonths <= 0) {
      state.protection.status = "expired";
      removePlanExpense(state, "protection");
    }
  }

  state.activeEffects = state.activeEffects
    .map((effect) => {
      if (!effect.uncertain) return { ...effect, remainingMonths: core.tickDuration(effect.remainingMonths) };
      const elapsedMonths = effect.elapsedMonths + 1;
      const recovered = elapsedMonths >= effect.minMonths && (elapsedMonths >= effect.maxMonths || random() < effect.recoveryChance);
      return { ...effect, elapsedMonths, recovered };
    })
    .filter((effect) => (effect.uncertain ? !effect.recovered : effect.remainingMonths > 0));

  state.scheduled.filter((item) => !item.triggered && item.triggerMonth <= state.month).forEach((item) => {
    item.triggered = true;
    if (item.type === "savings_effect") state.savings += item.amount;
    if (item.type === "random_savings_effect") {
      const outcome = core.pickWeightedOutcome(item.outcomes, random());
      if (outcome) state.savings += core.calculateSavingsOutcomeAmount(outcome, state.baseIncome);
    }
    if (item.type === "active_effect") addActiveEffect(state, { target: item.target, amount: item.amount, duration: item.duration }, item.sourceEventId || item.id);
    if (item.type === "career" && random() < 0.7) addActiveEffect(state, { target: "income", amount: 1500, duration: 12 }, item.id);
  });
}

function simulateGame(identity, maxMonth, strategy, seed) {
  const random = createRandom(seed);
  const state = {
    identityId: identity.id,
    baseIncome: identity.income,
    baseExpense: identity.expense,
    savings: identity.savings,
    month: 1,
    maxMonth,
    position: 0,
    activeEffects: [],
    scheduled: [],
    protection: null,
    dca: null,
    draws: [],
    choices: [],
    tempIncome: 0,
    tempExpense: 0,
    eventStress: {},
    repeatedAdjacent: 0,
    careerEventMonth: randomInt(random, 2, Math.max(2, Math.min(5, maxMonth - 2))),
  };

  let completedMonths = 0;
  let failureSource = null;
  while (state.month <= maxMonth && state.savings >= 0) {
    processDcaMarket(state, strategy, random);
    const beforeSavings = state.savings;
    const beforeIncome = recurringIncome(state);
    const beforeExpense = recurringExpense(state);
    state.tempIncome = 0;
    state.tempExpense = 0;
    state.position = (state.position + randomInt(random, 1, 3)) % MAP_CELLS.length;
    const card = drawEvent(state, random);
    const previous = state.draws.at(-1);
    if (previous?.id === card.id) state.repeatedAdjacent += 1;
    state.draws.push({ id: card.id, month: state.month });
    const choice = chooseOption(card, state, strategy, random);
    if (choice) state.choices.push({ cardId: card.id, label: choice.label });
    applyEffect(state, choice?.effect || card.effect, card, random);

    const income = Math.max(0, Math.round(recurringIncome(state) + state.tempIncome));
    const expense = Math.max(0, Math.round(recurringExpense(state) + state.tempExpense));
    state.savings += income - expense;
    const baselineSavings = beforeSavings + beforeIncome - beforeExpense;
    const stress = Math.max(0, baselineSavings - state.savings);
    state.eventStress[card.id] = (state.eventStress[card.id] || 0) + stress;
    failureSource = card.id;
    processEndOfMonth(state, random);
    completedMonths += 1;
    if (state.savings < 0) break;
    state.month += 1;
  }

  const finalExpense = recurringExpense(state);
  return {
    identityId: identity.id,
    maxMonth,
    strategy,
    completed: completedMonths >= maxMonth && state.savings >= 0,
    completedMonths,
    finalSavings: Math.round(state.savings),
    finalBuffer: finalExpense > 0 ? state.savings / finalExpense : 999,
    failureSource: state.savings < 0 ? failureSource : null,
    draws: state.draws,
    choices: state.choices,
    eventStress: state.eventStress,
    repeatedAdjacent: state.repeatedAdjacent,
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatNumber(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function aggregate(results) {
  const rows = [];
  for (const maxMonth of CHALLENGE_LENGTHS) {
    for (const strategy of STRATEGIES) {
      const list = results.filter((result) => result.maxMonth === maxMonth && result.strategy === strategy);
      rows.push({
        maxMonth,
        strategy,
        runs: list.length,
        completionRate: list.filter((result) => result.completed).length / list.length,
        averageMonths: average(list.map((result) => result.completedMonths)),
        averageBuffer: average(list.map((result) => result.finalBuffer)),
      });
    }
  }
  return rows;
}

function buildReport(results) {
  const summary = aggregate(results);
  const random36 = results.filter((result) => result.maxMonth === 36 && result.strategy === "random");
  const identityRows = identityCards
    .map((identity) => {
      const list = random36.filter((result) => result.identityId === identity.id);
      return {
        name: identity.name,
        completionRate: list.filter((result) => result.completed).length / list.length,
        averageMonths: average(list.map((result) => result.completedMonths)),
        averageBuffer: average(list.map((result) => result.finalBuffer)),
      };
    })
    .sort((first, second) => first.completionRate - second.completionRate);

  const failures = new Map();
  const draws = new Map();
  const stress = new Map();
  let adjacentRepeats = 0;
  let totalTransitions = 0;
  results.forEach((result) => {
    if (result.failureSource) failures.set(result.failureSource, (failures.get(result.failureSource) || 0) + 1);
    result.draws.forEach((draw) => draws.set(draw.id, (draws.get(draw.id) || 0) + 1));
    Object.entries(result.eventStress).forEach(([id, amount]) => stress.set(id, (stress.get(id) || 0) + amount));
    adjacentRepeats += result.repeatedAdjacent;
    totalTransitions += Math.max(0, result.draws.length - 1);
  });
  const cardById = new Map(eventCards.map((card) => [card.id, card]));
  const failureRows = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const stressRows = [...stress.entries()]
    .map(([id, total]) => ({ id, average: total / (draws.get(id) || 1), draws: draws.get(id) || 0 }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 10);

  return `# 数值模拟基线\n\n生成时间：${new Date().toISOString()}\n版本：0.3.4-internal\n总模拟局数：${results.length.toLocaleString("zh-CN")}\n每个“身份 × 挑战长度 × 选择倾向”组合：${RUNS_PER_COMBINATION} 局\n\n> 这份报告用于发现异常，不是玩家结果预测。模拟不会改变正式游戏的随机抽卡，也不会自动调整卡池。复杂后续事件按当前规则做了等价计算，最终仍需结合真人试玩判断。\n\n## 总体结果\n\n| 挑战长度 | 选择倾向 | 局数 | 完成率 | 平均完成月份 | 平均最终安全垫 |\n| --- | --- | ---: | ---: | ---: | ---: |\n${summary.map((row) => `| ${row.maxMonth}个月 | ${STRATEGY_LABELS[row.strategy]} | ${row.runs} | ${percent(row.completionRate)} | ${formatNumber(row.averageMonths)} | ${formatNumber(row.averageBuffer)}个月 |`).join("\n")}\n\n## 36个月随机选择：身份差异\n\n| 身份 | 完成率 | 平均完成月份 | 平均最终安全垫 |\n| --- | ---: | ---: | ---: |\n${identityRows.map((row) => `| ${row.name} | ${percent(row.completionRate)} | ${formatNumber(row.averageMonths)} | ${formatNumber(row.averageBuffer)}个月 |`).join("\n")}\n\n## 现金储备被击穿时的最后事件\n\n| 事件 | 次数 |\n| --- | ---: |\n${failureRows.map(([id, count]) => `| ${cardById.get(id)?.title || id} | ${count} |`).join("\n") || "| 暂无 | 0 |"}\n\n“最后事件”不等于唯一原因，它只表示现金储备跌破0时所在的回合。\n\n## 单次抽到的平均负向影响\n\n| 事件 | 平均影响 | 抽到次数 |\n| --- | ---: | ---: |\n${stressRows.map((row) => `| ${cardById.get(row.id)?.title || row.id} | ${Math.round(row.average).toLocaleString("zh-CN")}元 | ${row.draws} |`).join("\n")}\n\n这里比较的是相对于该回合原有现金流的额外影响，不按最坏情况估算。\n\n## 随机性观察\n\n- 相邻两个月抽到同一卡牌的比例：${percent(totalTransitions ? adjacentRepeats / totalTransitions : 0)}。\n- 该数值只做观察，不用于给正式卡池增加强制限制。\n\n## 使用方式\n\n- 重新生成：\`npm run simulate\`\n- 修改身份或卡牌后应重新生成，并比较完成率、失败月份和高冲击事件是否发生异常跳变。\n- 是否调数值，必须同时参考真人测试反馈。\n`;
}

function main() {
  const results = [];
  for (const identity of identityCards) {
    for (const maxMonth of CHALLENGE_LENGTHS) {
      for (const strategy of STRATEGIES) {
        for (let run = 0; run < RUNS_PER_COMBINATION; run += 1) {
          results.push(simulateGame(identity, maxMonth, strategy, `${identity.id}-${maxMonth}-${strategy}-${run}`));
        }
      }
    }
  }
  const report = buildReport(results);
  if (process.argv.includes("--write")) {
    const outputPath = path.join(__dirname, "BALANCE_BASELINE.md");
    fs.writeFileSync(outputPath, report);
    console.log(`已生成 ${outputPath}`);
  } else {
    console.log(report);
  }
}

if (require.main === module) main();

module.exports = { simulateGame, buildReport };
