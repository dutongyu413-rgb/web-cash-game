const test = require("node:test");
const assert = require("node:assert/strict");

const identities = require("./identity-cards.js");
const { simulateGame } = require("./balance-sim.js");

test("相同身份、策略和种子会生成相同模拟结果", () => {
  const first = simulateGame(identities[0], 12, "random", "repeatable-baseline");
  const second = simulateGame(identities[0], 12, "random", "repeatable-baseline");
  assert.deepEqual(first, second);
});

test("三种选择倾向都能完成有限且可解释的模拟", () => {
  ["random", "reserve", "participate"].forEach((strategy) => {
    const result = simulateGame(identities[1], 24, strategy, `strategy-${strategy}`);
    assert.ok(result.completedMonths >= 1 && result.completedMonths <= 24);
    assert.ok(Number.isFinite(result.finalSavings));
    assert.ok(Number.isFinite(result.finalBuffer));
    assert.ok(result.draws.length === result.completedMonths);
  });
});

test("同一局不会重复抽到同一张主事件卡", () => {
  const identity = { ...identities[0], savings: 1000000 };
  const result = simulateGame(identity, 36, "random", "no-duplicate-events");
  const eventIds = result.draws.map((draw) => draw.id);
  assert.equal(eventIds.length, 36);
  assert.equal(new Set(eventIds).size, eventIds.length);
});

test("十三种职业身份只会强制触发自己的职业事件", () => {
  const careerEventByIdentity = {
    young_worker: "career_white_collar_project",
    freelancer: "career_creator_brand_deal",
    small_shop_owner: "career_restaurant_equipment",
    stable_employee: "career_teacher_public_course",
    single_parent: "career_sales_major_client",
    senior_engineer: "career_senior_engineer_upgrade",
    data_analyst: "career_data_analyst_model",
    architect: "career_architect_bid",
    doctor: "career_doctor_training",
    athlete: "career_athlete_equipment",
    programmer: "career_programmer_on_call",
    home_organizer: "career_home_organizer_order",
    librarian: "career_librarian_weekend_event",
  };
  const allCareerEventIds = new Set(Object.values(careerEventByIdentity));

  Object.entries(careerEventByIdentity).forEach(([identityId, expectedEventId]) => {
    const identity = identities.find((item) => item.id === identityId);
    const result = simulateGame({ ...identity, savings: 1000000 }, 12, "random", `career-${identityId}`);
    const careerDraws = result.draws.filter((draw) => allCareerEventIds.has(draw.id));
    assert.deepEqual(careerDraws.map((draw) => draw.id), [expectedEventId]);
    assert.ok(careerDraws[0].month >= 2 && careerDraws[0].month <= 5);
  });
});

test("运动员正式模拟不会抽到不符合职业语义的共享事件", () => {
  const athlete = identities.find((identity) => identity.id === "athlete");
  const forbiddenIds = new Set([
    "client_budget_cut",
    "commission_slowdown",
    "salary_cut",
    "bonus_cancelled",
    "year_end_bonus",
    "shopping_card",
  ]);

  for (let run = 0; run < 40; run += 1) {
    const result = simulateGame({ ...athlete, savings: 1000000 }, 36, "random", `athlete-pool-${run}`);
    assert.equal(result.draws.some((draw) => forbiddenIds.has(draw.id)), false);
  }
});
