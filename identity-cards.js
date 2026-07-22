// 身份卡配置
//
// 这里只保留会直接影响游戏计算的字段，供浏览器游戏与内部数值测试共用。

var identityCards = [
  { id: "young_worker", name: "企业白领", income: 18000, expense: 13000, savings: 40000 },
  { id: "freelancer", name: "自媒体博主", income: 22000, expense: 12000, savings: 70000 },
  { id: "small_shop_owner", name: "餐饮老板", income: 30000, expense: 25000, savings: 100000 },
  { id: "cafe_owner", name: "咖啡主理人", income: 22000, expense: 18000, savings: 70000 },
  { id: "stable_employee", name: "钢琴老师", income: 13000, expense: 8000, savings: 90000 },
  { id: "single_parent", name: "销售", income: 20000, expense: 17000, savings: 50000 },
  { id: "senior_engineer", name: "高级工程师", income: 40000, expense: 26000, savings: 160000 },
  { id: "data_analyst", name: "数据分析师", income: 24000, expense: 15000, savings: 80000 },
  { id: "architect", name: "建筑师", income: 30000, expense: 21000, savings: 100000 },
  { id: "doctor", name: "医生", income: 35000, expense: 24000, savings: 120000 },
  { id: "athlete", name: "运动员", income: 28000, expense: 22000, savings: 60000 },
  { id: "programmer", name: "程序员", income: 30000, expense: 18000, savings: 100000 },
  { id: "home_organizer", name: "收纳师", income: 16000, expense: 9000, savings: 50000 },
  { id: "librarian", name: "图书管理员", income: 9000, expense: 6000, savings: 40000 },
];

if (typeof module !== "undefined" && module.exports) module.exports = identityCards;
