// 普通事件的职业资格与软权重。
// 硬资格只处理职业语义明显冲突的事件；其余事件继续保留随机性。

var careerEventRules = {
  sharedCareerEventIds: [
    "salary_cut",
    "bonus_cancelled",
    "project_delay",
    "commission_slowdown",
    "unpaid_leave",
    "client_budget_cut",
    "year_end_bonus",
    "shopping_card",
    "athlete_commercial_appearance",
    "athlete_brand_endorsement",
  ],
  eligibleIdentityIdsByEvent: {
    salary_cut: [
      "young_worker",
      "stable_employee",
      "senior_engineer",
      "data_analyst",
      "architect",
      "doctor",
      "programmer",
      "librarian",
    ],
    bonus_cancelled: [
      "young_worker",
      "stable_employee",
      "single_parent",
      "senior_engineer",
      "data_analyst",
      "architect",
      "doctor",
      "programmer",
      "librarian",
    ],
    project_delay: [
      "young_worker",
      "freelancer",
      "single_parent",
      "senior_engineer",
      "data_analyst",
      "architect",
      "programmer",
      "home_organizer",
    ],
    commission_slowdown: ["single_parent"],
    unpaid_leave: [
      "young_worker",
      "stable_employee",
      "single_parent",
      "senior_engineer",
      "data_analyst",
      "architect",
      "doctor",
      "athlete",
      "programmer",
      "librarian",
    ],
    client_budget_cut: ["freelancer", "single_parent", "architect", "home_organizer"],
    year_end_bonus: [
      "young_worker",
      "stable_employee",
      "single_parent",
      "senior_engineer",
      "data_analyst",
      "architect",
      "doctor",
      "programmer",
      "librarian",
    ],
    shopping_card: [
      "young_worker",
      "stable_employee",
      "single_parent",
      "senior_engineer",
      "data_analyst",
      "architect",
      "doctor",
      "programmer",
      "librarian",
    ],
    athlete_commercial_appearance: ["athlete"],
    athlete_brand_endorsement: ["athlete"],
  },
  weightMultipliersByIdentity: {
    young_worker: { salary_cut: 1.35, year_end_bonus: 1.2, career_course: 1.2, commute_cost_up: 1.2 },
    freelancer: { client_budget_cut: 1.35, project_delay: 1.35, side_income: 1.2, freelance_referral: 1.2, laptop_repair: 1.2 },
    small_shop_owner: { car_repair: 1.2, temporary_unemployment: 0.75, career_course: 0.75 },
    stable_employee: { career_course: 1.2, shopping_card: 1.2, salary_cut: 0.75, year_end_bonus: 0.75 },
    single_parent: { commission_slowdown: 1.35, client_budget_cut: 1.2, commute_cost_up: 1.2, year_end_bonus: 1.2 },
    senior_engineer: { career_course: 1.2, laptop_repair: 1.2, salary_cut: 1.2, year_end_bonus: 1.2 },
    data_analyst: { career_course: 1.2, laptop_repair: 1.2, project_delay: 1.2 },
    architect: { project_delay: 1.35, client_budget_cut: 1.2, laptop_repair: 1.2, freelance_referral: 1.2 },
    doctor: { career_course: 1.2, unpaid_leave: 1.2 },
    athlete: {
      sports_injury: 1.35,
      unpaid_leave: 1.2,
      temporary_unemployment: 1.2,
      career_course: 0.75,
      side_income: 0.75,
      freelance_referral: 0.75,
    },
    programmer: { laptop_repair: 1.2, career_course: 1.2, salary_cut: 1.2, side_income: 1.2 },
    home_organizer: { project_delay: 1.2, client_budget_cut: 1.2, commute_cost_up: 1.2, side_income: 1.2 },
    librarian: { career_course: 1.2, shopping_card: 1.2, salary_cut: 0.75, year_end_bonus: 0.75 },
  },
};

careerEventRules.isEligible = function isEligible(eventId, identityId) {
  const eligibleIds = careerEventRules.eligibleIdentityIdsByEvent[eventId];
  if (!eligibleIds || identityId === "custom") return true;
  return eligibleIds.includes(identityId);
};

careerEventRules.getWeightMultiplier = function getWeightMultiplier(eventId, identityId) {
  return careerEventRules.weightMultipliersByIdentity[identityId]?.[eventId] || 1;
};

if (typeof window !== "undefined") window.CareerEventRules = careerEventRules;
if (typeof module !== "undefined" && module.exports) module.exports = careerEventRules;
