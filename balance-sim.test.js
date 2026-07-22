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

test("短局市场报价仍保留随机性且不占用主事件", () => {
  const identity = { ...identities[0], savings: 1000000 };
  const results = Array.from({ length: 60 }, (_, run) =>
    simulateGame(identity, 12, "random", `dca-natural-${run}`),
  );
  const quoted = results.filter((result) => result.investmentMarketHistory.length > 0).length;
  assert.ok(quoted > 0, "应有部分短局随机出现市场报价");
  assert.ok(quoted < results.length, "短局不应保证出现市场报价");
  results.forEach((result) => assert.equal(result.draws.length, result.completedMonths));
});

test("连续上涨三个月会强制出现报价且下跌月份不会自动报价", () => {
  const identity = { ...identities[0], savings: 1000000 };
  const riseResult = simulateGame(identity, 36, "random", "rise-trigger-0");
  assert.ok(
    riseResult.investmentMarketHistory.some((quote) => quote.month === 13),
    "固定行情在第13个月达到连续上涨三个月，应出现报价",
  );

  for (let run = 0; run < 80; run += 1) {
    const result = simulateGame(identity, 36, "random", `no-down-quote-${run}`);
    const marketByMonth = new Map(result.marketHistory.map((item, index, history) => [
      item.month,
      { currentNav: item.nav, previousNav: history[index - 1]?.nav ?? item.nav },
    ]));
    result.investmentMarketHistory.forEach((quote) => {
      const movement = marketByMonth.get(quote.month);
      assert.ok(movement.currentNav >= movement.previousNav, "净值实际下跌的月份不应自动弹出报价");
    });
  }
});

test("市场初始估值和后续方向都有双向随机性", () => {
  const identity = { ...identities[0], savings: 1000000 };
  const results = Array.from({ length: 120 }, (_, run) =>
    simulateGame(identity, 36, "participate", `investment-market-${run}`),
  );
  const initialValuations = new Set(results.map((result) => result.marketHistory[0].valuation));
  assert.deepEqual(initialValuations, new Set(["undervalued", "normal", "overvalued"]));
  assert.ok(results.some((result) => result.marketHistory.some((item) => item.trend === "up")));
  assert.ok(results.some((result) => result.marketHistory.some((item) => item.trend === "down")));
  assert.ok(results.some((result) => result.marketHistory.at(-1).nav > result.marketHistory[0].nav));
  assert.ok(results.some((result) => result.marketHistory.at(-1).nav < result.marketHistory[0].nav));
});

test("十四种职业身份只会强制触发自己的职业事件", () => {
  const careerEventByIdentity = {
    young_worker: "career_white_collar_project",
    freelancer: "career_creator_brand_deal",
    small_shop_owner: "career_restaurant_equipment",
    cafe_owner: "career_cafe_footfall",
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
