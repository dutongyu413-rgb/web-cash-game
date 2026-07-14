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
