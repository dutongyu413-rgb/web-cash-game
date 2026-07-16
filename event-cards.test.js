const test = require("node:test");
const assert = require("node:assert/strict");

const eventCards = require("./event-cards.js");
const identityCards = require("./identity-cards.js");

const allowedCategories = new Set(["choice", "expense_up", "health_risk", "income_down", "one_time_cost", "positive"]);
const allowedTargets = new Set(["income", "income_percent", "expense", "expense_percent"]);
const allowedEffectTypes = new Set([
  "none",
  "change_savings",
  "change_savings_by_income_percent",
  "bonus_invest_or_reserve",
  "invest_or_reserve",
  "one_month_income_change",
  "one_month_income_percent",
  "one_month_expense_change",
  "one_month_expense_percent",
  "add_active_effect",
  "add_uncertain_active_effect",
  "schedule_active_effect",
  "schedule_savings_effect",
  "schedule_savings_by_income_percent",
  "schedule_random_savings_effect",
  "start_dca_plan",
  "start_protection_plan",
  "career_course_plan",
  "buy_car",
  "compound",
]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertPositiveInteger(value, message) {
  assert.ok(Number.isInteger(value) && value > 0, message);
}

function assertRate(value, message, { allowNegative = false } = {}) {
  assert.ok(isFiniteNumber(value), message);
  assert.ok(allowNegative ? value >= -1 && value <= 2 : value >= 0 && value <= 1, message);
}

function assertOptionalBoolean(value, message) {
  assert.ok(value === undefined || typeof value === "boolean", message);
}

function validateEffect(effect, location) {
  assert.ok(effect && typeof effect === "object", `${location} 缺少 effect`);
  assert.ok(allowedEffectTypes.has(effect.type), `${location} 使用了未支持的 effect.type: ${effect.type}`);

  if (["none", "buy_car"].includes(effect.type)) return;

  if (["change_savings", "one_month_income_change", "one_month_expense_change"].includes(effect.type)) {
    assert.ok(isFiniteNumber(effect.amount), `${location}.amount 必须是有限数字`);
    return;
  }

  if (["change_savings_by_income_percent", "one_month_income_percent", "one_month_expense_percent"].includes(effect.type)) {
    assertRate(effect.amount, `${location}.amount 必须是 -100% 到 200% 的比例`, { allowNegative: true });
    return;
  }

  if (effect.type === "bonus_invest_or_reserve") {
    assertRate(effect.investPercent ?? 0.5, `${location}.investPercent 必须在 0 到 1 之间`);
    return;
  }

  if (effect.type === "invest_or_reserve") {
    assert.ok(isFiniteNumber(effect.amount) && effect.amount >= 0, `${location}.amount 必须大于等于 0`);
    assertRate(effect.investPercent ?? 0.5, `${location}.investPercent 必须在 0 到 1 之间`);
    return;
  }

  if (effect.type === "add_active_effect") {
    assert.ok(allowedTargets.has(effect.target), `${location}.target 不合法`);
    assert.ok(isFiniteNumber(effect.amount), `${location}.amount 必须是有限数字`);
    assertPositiveInteger(effect.duration, `${location}.duration 必须是正整数`);
    return;
  }

  if (effect.type === "add_uncertain_active_effect") {
    assert.ok(allowedTargets.has(effect.target), `${location}.target 不合法`);
    assert.ok(isFiniteNumber(effect.amount), `${location}.amount 必须是有限数字`);
    assertPositiveInteger(effect.minMonths, `${location}.minMonths 必须是正整数`);
    assertPositiveInteger(effect.maxMonths, `${location}.maxMonths 必须是正整数`);
    assert.ok(effect.maxMonths >= effect.minMonths, `${location}.maxMonths 不能小于 minMonths`);
    assert.ok(effect.recoveryChance > 0 && effect.recoveryChance <= 1, `${location}.recoveryChance 必须在 0 到 1 之间`);
    assert.ok(String(effect.recoveryText || "").trim(), `${location}.recoveryText 不能为空`);
    return;
  }

  if (effect.type === "schedule_active_effect") {
    assertPositiveInteger(effect.triggerDelay, `${location}.triggerDelay 必须是正整数`);
    assertOptionalBoolean(effect.preserveDelay, `${location}.preserveDelay 必须是布尔值`);
    assert.ok(allowedTargets.has(effect.target), `${location}.target 不合法`);
    assert.ok(isFiniteNumber(effect.amount), `${location}.amount 必须是有限数字`);
    assertPositiveInteger(effect.duration, `${location}.duration 必须是正整数`);
    return;
  }

  if (effect.type === "schedule_savings_effect") {
    assertPositiveInteger(effect.triggerDelay, `${location}.triggerDelay 必须是正整数`);
    assertOptionalBoolean(effect.preserveDelay, `${location}.preserveDelay 必须是布尔值`);
    assert.ok(isFiniteNumber(effect.amount), `${location}.amount 必须是有限数字`);
    return;
  }

  if (effect.type === "schedule_savings_by_income_percent") {
    assertPositiveInteger(effect.triggerDelay, `${location}.triggerDelay 必须是正整数`);
    assertOptionalBoolean(effect.preserveDelay, `${location}.preserveDelay 必须是布尔值`);
    assertRate(effect.amount, `${location}.amount 必须在 0 到 1 之间`);
    return;
  }

  if (effect.type === "schedule_random_savings_effect") {
    assertPositiveInteger(effect.triggerDelay, `${location}.triggerDelay 必须是正整数`);
    assertOptionalBoolean(effect.preserveDelay, `${location}.preserveDelay 必须是布尔值`);
    assert.ok(Array.isArray(effect.outcomes) && effect.outcomes.length >= 2, `${location}.outcomes 至少需要两个结果`);
    effect.outcomes.forEach((outcome, index) => {
      const outcomeLocation = `${location}.outcomes[${index}]`;
      assert.ok(isFiniteNumber(outcome.weight) && outcome.weight > 0, `${outcomeLocation}.weight 必须大于 0`);
      const hasFixedAmount = isFiniteNumber(outcome.amount);
      const hasIncomePercent = isFiniteNumber(outcome.incomePercent);
      assert.ok(hasFixedAmount || hasIncomePercent, `${outcomeLocation} 至少需要 amount 或 incomePercent`);
      if (outcome.incomePercent !== undefined) {
        assertRate(outcome.incomePercent, `${outcomeLocation}.incomePercent 必须在 0 到 1 之间`);
      }
      assert.ok(String(outcome.message || "").trim(), `${outcomeLocation}.message 不能为空`);
    });
    return;
  }

  if (effect.type === "start_dca_plan") {
    assert.ok(isFiniteNumber(effect.monthlyAmount) && effect.monthlyAmount > 0, `${location}.monthlyAmount 必须大于 0`);
    return;
  }

  if (effect.type === "start_protection_plan") {
    assert.ok(isFiniteNumber(effect.monthlyAmount) && effect.monthlyAmount > 0, `${location}.monthlyAmount 必须大于 0`);
    assertRate(effect.coverageRate, `${location}.coverageRate 必须在 0 到 1 之间`);
    assert.ok(isFiniteNumber(effect.maxReduction) && effect.maxReduction > 0, `${location}.maxReduction 必须大于 0`);
    assertPositiveInteger(effect.duration, `${location}.duration 必须是正整数`);
    return;
  }

  if (effect.type === "career_course_plan") {
    assert.ok(isFiniteNumber(effect.cost) && effect.cost > 0, `${location}.cost 必须大于 0`);
    return;
  }

  if (effect.type === "compound") {
    assert.ok(Array.isArray(effect.effects) && effect.effects.length > 0, `${location}.effects 不能为空`);
    effect.effects.forEach((item, index) => validateEffect(item, `${location}.effects[${index}]`));
  }
}

test("事件卡 ID 唯一且基础字段完整", () => {
  assert.equal(eventCards.length, 64, "事件卡数量发生变化时，请同步审查卡池和测试基线");
  const ids = new Set();
  eventCards.forEach((card, index) => {
    const location = `eventCards[${index}]`;
    assert.match(card.id, /^[a-z0-9_]+$/, `${location}.id 只能使用小写字母、数字和下划线`);
    assert.ok(!ids.has(card.id), `事件卡 ID 重复: ${card.id}`);
    ids.add(card.id);
    assert.ok(String(card.title || "").trim(), `${card.id}.title 不能为空`);
    assert.ok(String(card.description || "").trim(), `${card.id}.description 不能为空`);
    assert.ok(allowedCategories.has(card.category), `${card.id}.category 不合法`);
  });
});

test("所有事件卡选项和效果都可以被当前规则处理", () => {
  eventCards.forEach((card) => {
    if (Array.isArray(card.choices)) {
      assert.ok(Array.isArray(card.choices) && card.choices.length >= 2, `${card.id} 至少需要两个选项`);
      card.choices.forEach((choice, index) => {
        const location = `${card.id}.choices[${index}]`;
        assert.ok(String(choice.label || "").trim(), `${location}.label 不能为空`);
        assert.ok(String(choice.resultText || "").trim(), `${location}.resultText 不能为空`);
        assertOptionalBoolean(choice.hideImpact, `${location}.hideImpact 必须是布尔值`);
        validateEffect(choice.effect, `${location}.effect`);
      });
      return;
    }
    assert.notEqual(card.category, "choice", `${card.id} 属于选择事件，但没有 choices`);
    validateEffect(card.effect, `${card.id}.effect`);
  });
});

test("第一批普通事件选择卡保留约定的金额和后续月份", () => {
  const byId = (id) => eventCards.find((card) => card.id === id);
  const convertedIds = ["rent_up", "car_repair", "home_appliance", "project_delay", "sell_unused", "dental_cost"];
  convertedIds.forEach((id) => assert.equal(byId(id).choices.length >= 2, true, `${id} 应为选择卡`));

  const appliance = byId("home_appliance");
  assert.equal(appliance.title, "某个家电出现故障");
  assert.equal(appliance.choices[0].effect.effects[0].amount, -1000);
  assert.equal(appliance.choices[0].effect.effects[1].triggerDelay, 3);
  assert.equal(appliance.choices[0].effect.effects[1].amount, -5000);
  assert.equal(appliance.choices[1].effect.amount, -4000);

  const dental = byId("dental_cost");
  assert.equal(dental.choices[0].effect.amount, -20000);
  assert.deepEqual(dental.choices[1].effect, { type: "add_active_effect", target: "expense", amount: 2500, duration: 12 });

  const resale = byId("sell_unused");
  assert.equal(resale.choices[1].resultText, "两个月后可能收入更多。");
  assert.equal(resale.choices[1].hideImpact, true);
  assert.equal(resale.choices[1].effect.triggerDelay, 2);
  assert.deepEqual(resale.choices[1].effect.outcomes.map((outcome) => outcome.amount), [1800, 600]);

  const rent = byId("rent_up");
  assert.deepEqual(rent.choices[0].effect, { type: "add_active_effect", target: "expense_percent", amount: 0.05, duration: 999 });

  const delayedBonus = byId("project_delay");
  assert.equal(delayedBonus.choices[0].effect.triggerDelay, 2);
  assert.deepEqual(delayedBonus.choices[0].effect.outcomes.map((outcome) => outcome.weight), [0.5, 0.5]);
  assert.deepEqual(delayedBonus.choices[0].effect.outcomes.map((outcome) => outcome.incomePercent), [0.5, 0.35]);
  assert.deepEqual(delayedBonus.choices[1].effect, { type: "change_savings_by_income_percent", amount: 0.4 });
});

test("八张职业事件分别绑定一个有效身份且不会混入其他职业", () => {
  const identityIds = new Set(identityCards.map((identity) => identity.id));
  const expectedIdentityIds = [
    "senior_engineer",
    "data_analyst",
    "architect",
    "doctor",
    "athlete",
    "programmer",
    "home_organizer",
    "librarian",
  ];
  const careerCards = eventCards.filter((card) => Array.isArray(card.careerIdentityIds));
  assert.equal(careerCards.length, 8);
  careerCards.forEach((card) => {
    assert.equal(card.careerIdentityIds.length, 1, `${card.id} 当前只能绑定一个职业身份`);
    assert.ok(identityIds.has(card.careerIdentityIds[0]), `${card.id} 绑定了不存在的身份`);
    assert.equal(card.eventLabel, "职业事件");
    assert.ok(Array.isArray(card.choices) && card.choices.length >= 2, `${card.id} 应提供至少两个选项`);
  });
  assert.deepEqual(careerCards.map((card) => card.careerIdentityIds[0]).sort(), expectedIdentityIds.sort());
});

test("身份卡 ID 唯一且财务字段可用于开局", () => {
  const ids = new Set();
  identityCards.forEach((identity) => {
    assert.match(identity.id, /^[a-z0-9_]+$/, `${identity.name}.id 不合法`);
    assert.ok(!ids.has(identity.id), `身份卡 ID 重复: ${identity.id}`);
    ids.add(identity.id);
    assert.ok(String(identity.name || "").trim(), `${identity.id}.name 不能为空`);
    assert.ok(isFiniteNumber(identity.income) && identity.income >= 0, `${identity.id}.income 不合法`);
    assert.ok(isFiniteNumber(identity.expense) && identity.expense > 0, `${identity.id}.expense 不合法`);
    assert.ok(isFiniteNumber(identity.savings) && identity.savings >= 0, `${identity.id}.savings 不合法`);
  });
});
