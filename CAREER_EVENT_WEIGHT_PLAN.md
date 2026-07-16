# 职业与普通事件权重方案

本文档用于设计“不同职业更容易遇到与工作方式相关的普通事件”。本方案暂不修改正式卡池，先作为下一轮实现依据。

## 目标与边界

- 保留随机抽卡，不按固定剧本安排普通事件。
- 现有职业专属卡仍按当前规则在第 2 至第 5 个月强制出现一次，和普通卡权重分开处理。
- 权重只改变同类卡牌被抽中的相对概率，不改变路径节点类型、正负事件总比例和挑战长度。
- 不根据收入高低判断职业，只使用身份 `id`。
- 家庭、年龄、婚育等没有身份数据支持的条件，不参与职业权重。

## 两层规则

### 1. 语义资格

只有事件前提和职业明显冲突时才排除，避免出现无法解释的组合。

| 事件 | 适用范围 | 处理方式 |
|---|---|---|
| `commission_slowdown` 提成到账变慢 | 销售 | 其他职业不进入该卡的候选池 |
| `salary_cut` 公司业务调整 | 领取工资的职业 | 餐饮老板、自媒体博主、收纳师不进入候选池 |
| `bonus_cancelled` 绩效奖金缩水 | 领取工资或提成的职业 | 餐饮老板、自媒体博主不进入候选池 |
| `year_end_bonus` 年终奖到账 | 领取工资的职业 | 餐饮老板、自媒体博主、收纳师不进入候选池 |
| `shopping_card` 公司发放购物卡 | 领取工资的职业 | 餐饮老板、自媒体博主、收纳师不进入候选池 |

除上述明显冲突外，不使用硬排除。比如电脑维修、通勤变化、职业课程仍可能发生在多个职业中。

### 2. 软权重

候选卡的最终权重：

```text
最终权重 = 卡牌基础权重 x 职业倍率
```

倍率只使用四档：

| 倍率 | 含义 |
|---:|---|
| `1.35` | 和职业高度相关 |
| `1.20` | 比普通职业更常见 |
| `1.00` | 保持原概率 |
| `0.75` | 可以发生，但相对少见 |

单张普通卡不超过 `1.35`，防止职业差异演变成固定剧本。没有配置的卡默认 `1.00`。

## 第一批建议配置

| 身份 | 提高到 1.35 | 提高到 1.20 | 降低到 0.75 |
|---|---|---|---|
| 企业白领 | `salary_cut` | `year_end_bonus`、`career_course`、`commute_cost_up` | `project_delay` |
| 自媒体博主 | `client_budget_cut`、`project_delay` | `side_income`、`freelance_referral`、`laptop_repair` | `year_end_bonus` |
| 餐饮老板 | 暂无足够贴合的现有卡 | `project_delay`、`car_repair` | `career_course` |
| 教师 | 暂无 | `career_course`、`shopping_card` | `salary_cut`、`year_end_bonus` |
| 销售 | `commission_slowdown` | `client_budget_cut`、`commute_cost_up`、`year_end_bonus` | `laptop_repair` |
| 高级工程师 | 暂无 | `career_course`、`laptop_repair`、`salary_cut`、`year_end_bonus` | `commission_slowdown` |
| 数据分析师 | 暂无 | `career_course`、`laptop_repair`、`project_delay` | `commission_slowdown` |
| 建筑师 | `project_delay` | `client_budget_cut`、`laptop_repair`、`freelance_referral` | `year_end_bonus` |
| 医生 | 暂无 | `career_course`、`unpaid_leave` | `salary_cut`、`client_budget_cut` |
| 运动员 | `sports_injury` | `unpaid_leave`、`temporary_unemployment` | `career_course` |
| 程序员 | 暂无 | `laptop_repair`、`career_course`、`salary_cut`、`side_income` | `commission_slowdown` |
| 收纳师 | 暂无 | `project_delay`、`client_budget_cut`、`commute_cost_up`、`side_income` | `year_end_bonus` |
| 图书管理员 | 暂无 | `career_course`、`shopping_card` | `salary_cut`、`year_end_bonus` |

餐饮老板当前缺少真正贴合经营场景的普通卡。与其把家庭家电卡硬解释成经营设备，更合适的后续做法是新增“设备临时维修”“平台活动抽成”“节假日备货”等经营事件，再配置权重。

## 实现方式

建议新建 `career-event-weights.js`，避免把职业配置塞进事件卡文件：

```js
var careerEventWeights = {
  young_worker: {
    salary_cut: 1.35,
    year_end_bonus: 1.2,
    career_course: 1.2,
    commute_cost_up: 1.2,
    project_delay: 0.75,
  },
};
```

抽卡时按以下顺序执行：

1. 根据路径节点类型生成原候选池。
2. 移除职业语义不成立的卡。
3. 应用现有冷却期、次数上限、长期计划资格等规则。
4. 用 `基础权重 x 职业倍率` 做一次加权随机。
5. 不做保底、不指定某月出现、不在失败后补发。

## 数值验证

每个身份、每种挑战长度至少模拟 10,000 局，验收以下指标：

- 职业高相关卡的出现率比默认职业高约 15% 至 35%，不要求每局出现。
- 任意普通卡的实际出现率不超过未加权版本的 1.5 倍。
- 各路径事件大类的占比变化不超过 3 个百分点。
- 单一职业的完成率变化不超过 5 个百分点；超过时先检查卡牌本身强度，不直接继续调权重。
- 语义排除组合出现次数必须为 0。
- 相同种子、身份和规则仍能复现同一抽卡结果。

## 人工验收

至少让每个职业完成 3 局 12 个月挑战，重点询问：

- 事件是否偶尔让人觉得“这确实像我的工作会遇到的事”。
- 是否感觉卡牌被职业写死、缺少随机性。
- 是否出现职业与卡牌前提明显矛盾的情况。
- 更换身份后，普通事件体验是否有轻微差异，但仍属于同一个游戏。

本方案通过标准不是“玩家能猜中下一张牌”，而是“随机结果成立，职业差异隐约可感”。
