const test = require("node:test");
const assert = require("node:assert/strict");

const eventCards = require("./event-cards.js");
const identityCards = require("./identity-cards.js");
const rules = require("./career-event-rules.js");

const eventIds = new Set(eventCards.map((event) => event.id));
const identityIds = new Set(identityCards.map((identity) => identity.id));

test("职业共享事件配置只引用有效卡牌和身份", () => {
  for (const [eventId, eligibleIds] of Object.entries(rules.eligibleIdentityIdsByEvent)) {
    assert.equal(eventIds.has(eventId), true, `未知事件 ${eventId}`);
    assert.equal(eligibleIds.length > 0, true, `${eventId} 缺少适用身份`);
    for (const identityId of eligibleIds) assert.equal(identityIds.has(identityId), true, `${eventId} 引用了未知身份 ${identityId}`);
  }
});

test("运动员不会抽到客户、提成和公司福利语义事件", () => {
  for (const eventId of ["client_budget_cut", "commission_slowdown", "salary_cut", "bonus_cancelled", "year_end_bonus", "shopping_card"]) {
    assert.equal(rules.isEligible(eventId, "athlete"), false, `${eventId} 不应进入运动员卡池`);
  }
  assert.equal(rules.isEligible("sports_injury", "athlete"), true);
  assert.equal(rules.isEligible("athlete_commercial_appearance", "athlete"), true);
  assert.equal(rules.isEligible("athlete_brand_endorsement", "athlete"), true);
  assert.equal(rules.isEligible("athlete_brand_endorsement", "young_worker"), false);
  assert.equal(rules.getWeightMultiplier("side_income", "athlete"), 0.75);
  assert.equal(rules.getWeightMultiplier("freelance_referral", "athlete"), 0.75);
});

test("咖啡店经营事件只进入咖啡主理人卡池", () => {
  for (const eventId of ["cafe_blogger_promotion", "cafe_stray_cat"]) {
    assert.equal(rules.isEligible(eventId, "cafe_owner"), true);
    assert.equal(rules.isEligible(eventId, "small_shop_owner"), false);
    assert.equal(rules.isEligible(eventId, "young_worker"), false);
    assert.equal(rules.isEligible(eventId, "custom"), false);
    assert.equal(rules.getWeightMultiplier(eventId, "cafe_owner"), 1.35);
  }
});

test("普通生活事件对所有预设身份开放", () => {
  for (const eventId of ["rent_up", "phone_replacement", "minor_illness", "family_trip_choice"]) {
    for (const identityId of identityIds) assert.equal(rules.isEligible(eventId, identityId), true);
  }
});

test("职业软权重只改变相关概率而不超过约定范围", () => {
  for (const [identityId, weights] of Object.entries(rules.weightMultipliersByIdentity)) {
    assert.equal(identityIds.has(identityId), true, `未知身份 ${identityId}`);
    for (const [eventId, multiplier] of Object.entries(weights)) {
      assert.equal(eventIds.has(eventId), true, `${identityId} 引用了未知事件 ${eventId}`);
      assert.equal([0.75, 1.2, 1.35].includes(multiplier), true, `${eventId} 使用了未约定倍率 ${multiplier}`);
    }
  }
});
