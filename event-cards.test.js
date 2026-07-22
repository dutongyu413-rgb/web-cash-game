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
  "start_fund_investment",
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
      const hasIncomeLossPercent = isFiniteNumber(outcome.incomeLossPercent);
      const hasSavingsCost = isFiniteNumber(outcome.savingsCost);
      const hasActiveEffect = outcome.activeEffect && typeof outcome.activeEffect === "object";
      assert.ok(
        hasFixedAmount || hasIncomePercent || hasIncomeLossPercent || hasSavingsCost || hasActiveEffect,
        `${outcomeLocation} 至少需要一种金额影响`,
      );
      if (outcome.incomePercent !== undefined) {
        assertRate(outcome.incomePercent, `${outcomeLocation}.incomePercent 必须在 0 到 1 之间`);
      }
      if (outcome.incomeLossPercent !== undefined) {
        assertRate(outcome.incomeLossPercent, `${outcomeLocation}.incomeLossPercent 必须在 0 到 1 之间`);
      }
      if (outcome.savingsCost !== undefined) {
        assert.ok(isFiniteNumber(outcome.savingsCost) && outcome.savingsCost >= 0, `${outcomeLocation}.savingsCost 不能小于 0`);
      }
      if (hasActiveEffect) {
        assert.ok(allowedTargets.has(outcome.activeEffect.target), `${outcomeLocation}.activeEffect.target 不合法`);
        assert.ok(isFiniteNumber(outcome.activeEffect.amount), `${outcomeLocation}.activeEffect.amount 必须是有限数字`);
        assertPositiveInteger(outcome.activeEffect.duration, `${outcomeLocation}.activeEffect.duration 必须是正整数`);
      }
      assertOptionalBoolean(outcome.silent, `${outcomeLocation}.silent 必须是布尔值`);
      assert.ok(String(outcome.message || "").trim(), `${outcomeLocation}.message 不能为空`);
    });
    return;
  }

  if (effect.type === "start_dca_plan") {
    assert.ok(isFiniteNumber(effect.monthlyAmount) && effect.monthlyAmount > 0, `${location}.monthlyAmount 必须大于 0`);
    return;
  }

  if (effect.type === "start_fund_investment") {
    assert.ok(isFiniteNumber(effect.initialAmount) && effect.initialAmount > 0, `${location}.initialAmount 必须大于 0`);
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
  assert.equal(eventCards.length, 73, "事件卡数量发生变化时，请同步审查卡池和测试基线");
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
        if (choice.wellbeingCost !== undefined) {
          assert.ok(
            Number.isInteger(choice.wellbeingCost) && choice.wellbeingCost >= 1 && choice.wellbeingCost <= 6,
            `${location}.wellbeingCost 必须是 1 到 6 的整数`,
          );
          assert.ok(String(choice.wellbeingReason || "").trim(), `${location}.wellbeingReason 不能为空`);
        }
        validateEffect(choice.effect, `${location}.effect`);
      });
      return;
    }
    assert.notEqual(card.category, "choice", `${card.id} 属于选择事件，但没有 choices`);
    validateEffect(card.effect, `${card.id}.effect`);
  });
});

test("生活体验只标记有明确精力或生活质量取舍的选项", () => {
  const markedChoices = eventCards.flatMap((card) =>
    (card.choices || [])
      .filter((choice) => choice.wellbeingCost)
      .map((choice) => ({ cardId: card.id, label: choice.label, cost: choice.wellbeingCost })),
  );
  assert.ok(markedChoices.length >= 12, "应覆盖主要的休息透支、长期压缩和生活取舍选项");
  assert.deepEqual(
    markedChoices.find((choice) => choice.cardId === "rent_or_commute_choice" && choice.label === "暂时不搬"),
    { cardId: "rent_or_commute_choice", label: "暂时不搬", cost: 4 },
  );
  assert.equal(
    markedChoices.some((choice) => choice.cardId === "year_end_bonus" && choice.label === "补进现金储备"),
    false,
    "普通储蓄选择不应自动被判定为影响生活体验",
  );
});

test("运动员继续使用旧装备时不剧透，且无影响结果保持静默", () => {
  const event = eventCards.find((card) => card.id === "career_athlete_equipment");
  const keepUsing = event.choices.find((choice) => choice.label === "先继续使用");
  const safeOutcome = keepUsing.effect.outcomes.find((outcome) => outcome.id === "equipment_held_up");
  assert.equal(keepUsing.resultText.includes("训练意外"), false);
  assert.equal(safeOutcome.amount, 0);
  assert.equal(safeOutcome.silent, true);
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
  assert.deepEqual(delayedBonus.choices[0].effect.outcomes.map((outcome) => outcome.incomePercent), [0.45, 0.6]);
  assert.deepEqual(delayedBonus.choices[1].effect, { type: "change_savings_by_income_percent", amount: 0.4 });
});

test("市场先生报价已从普通事件卡池中拆出", () => {
  assert.equal(eventCards.some((card) => card.id === "index_dca_choice"), false);
});

test("运动员继续使用旧装备会触发带收入和储备影响的随机后续", () => {
  const card = eventCards.find((item) => item.id === "career_athlete_equipment");
  const effect = card.choices.find((choice) => choice.label === "先继续使用").effect;
  assert.equal(effect.type, "schedule_random_savings_effect");
  assert.equal(effect.triggerDelay, 3);
  assert.deepEqual(effect.outcomes.map((outcome) => outcome.weight), [0.45, 0.55]);
  assert.equal(effect.outcomes[0].incomeLossPercent, 0.25);
  assert.equal(effect.outcomes[0].savingsCost, 5000);
});

test("运动员正向职业机会保留不同频率和收入取舍", () => {
  const appearance = eventCards.find((card) => card.id === "athlete_commercial_appearance");
  const endorsement = eventCards.find((card) => card.id === "athlete_brand_endorsement");
  assert.equal(appearance.category, "positive");
  assert.equal(endorsement.category, "positive");
  assert.equal(appearance.weight, 0.9);
  assert.equal(endorsement.weight, 0.45);
  assert.equal(appearance.choices[0].effect.effects[0].amount, 0.2);
  assert.equal(endorsement.choices[0].effect.effects[0].amount, 0.45);
});

test("咖啡主理人事件包含客流、宣传和流浪猫后续", () => {
  const byId = (id) => eventCards.find((card) => card.id === id);
  const footfall = byId("career_cafe_footfall");
  const promotion = byId("cafe_blogger_promotion");
  const strayCat = byId("cafe_stray_cat");
  assert.deepEqual(footfall.careerIdentityIds, ["cafe_owner"]);
  assert.equal(footfall.choices[0].effect.duration, 4);
  assert.equal(promotion.choices[0].effect.effects[0].amount, -3000);

  const rescue = strayCat.choices.find((choice) => choice.label === "检查后留在店里");
  assert.equal(rescue.resultText.includes("猫咖"), false, "救助时不应提前剧透后续结果");
  const followUp = rescue.effect.effects[1];
  assert.equal(followUp.triggerDelay, 3);
  assert.deepEqual(followUp.outcomes.map((outcome) => outcome.weight), [0.5, 0.5]);
  assert.deepEqual(followUp.outcomes.map((outcome) => outcome.activeEffect.target), ["income_percent", "expense"]);
  assert.deepEqual(followUp.outcomes.map((outcome) => outcome.activeEffect.duration), [4, 6]);
});

test("教师身份已调整为钢琴老师且专属事件语义一致", () => {
  const teacher = identityCards.find((identity) => identity.id === "stable_employee");
  const careerCard = eventCards.find((card) => card.id === "career_teacher_public_course");
  assert.equal(teacher.name, "钢琴老师");
  assert.equal(careerCard.title, "成人钢琴小班");
  assert.equal(careerCard.description.includes("钢琴"), true);
});

test("十四张职业事件分别绑定一个有效身份且不会混入其他职业", () => {
  const identityIds = new Set(identityCards.map((identity) => identity.id));
  const expectedIdentityIds = [
    "young_worker",
    "freelancer",
    "small_shop_owner",
    "cafe_owner",
    "stable_employee",
    "single_parent",
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
  assert.equal(careerCards.length, 14);
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
