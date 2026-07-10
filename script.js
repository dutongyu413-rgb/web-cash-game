const STORAGE_KEY = "cashflowLifeMapGame";
const app = document.getElementById("app");
const toast = document.getElementById("toast");
const TRACKING_PROJECT = "cash_game";
const TRACKING_SCRIPT_SRC = "https://cloud.umami.is/script.js";

let player = null;
let savedGameAvailable = false;
let lastDice = null;
let pendingMonthlySummary = null;
let selectedMaxMonth = 36;
let mapMotion = null;
let pendingTrackingEvents = [];

const challengeLengths = [12, 24, 36];

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

const identityCards = [
  {
    id: "young_worker",
    name: "企业白领",
    income: 18000,
    expense: 13000,
    savings: 40000,
  },
  {
    id: "freelancer",
    name: "自媒体博主",
    income: 22000,
    expense: 12000,
    savings: 70000,
  },
  {
    id: "small_shop_owner",
    name: "餐饮老板",
    income: 30000,
    expense: 25000,
    savings: 100000,
  },
  {
    id: "stable_employee",
    name: "教师",
    income: 13000,
    expense: 8000,
    savings: 90000,
  },
  {
    id: "single_parent",
    name: "销售",
    income: 20000,
    expense: 17000,
    savings: 50000,
  },
  {
    id: "senior_engineer",
    name: "高级工程师",
    income: 40000,
    expense: 26000,
    savings: 160000,
  },
  {
    id: "data_analyst",
    name: "数据分析师",
    income: 24000,
    expense: 15000,
    savings: 80000,
  },
  {
    id: "architect",
    name: "建筑师",
    income: 30000,
    expense: 21000,
    savings: 100000,
  },
  {
    id: "doctor",
    name: "医生",
    income: 35000,
    expense: 24000,
    savings: 120000,
  },
  {
    id: "athlete",
    name: "运动员",
    income: 28000,
    expense: 22000,
    savings: 60000,
  },
  {
    id: "programmer",
    name: "程序员",
    income: 30000,
    expense: 18000,
    savings: 100000,
  },
  {
    id: "home_organizer",
    name: "收纳师",
    income: 16000,
    expense: 9000,
    savings: 50000,
  },
  {
    id: "librarian",
    name: "图书管理员",
    income: 9000,
    expense: 6000,
    savings: 40000,
  },
];

const mapCells = [
  { label: "家庭", type: "family", categories: ["expense_up", "one_time_cost"] },
  { label: "收入", type: "income", categories: ["income_down"] },
  { label: "普通", type: "normal", categories: ["positive", "income_down", "expense_up"] },
  { label: "选择", type: "choice", categories: ["choice"] },
  { label: "健康", type: "health", categories: ["health_risk"] },
  { label: "正向", type: "positive", categories: ["positive"] },
  { label: "家庭", type: "family", categories: ["expense_up"] },
  { label: "收入", type: "income", categories: ["income_down", "positive"] },
  { label: "选择", type: "choice", categories: ["choice"] },
  { label: "风险", type: "health", categories: ["health_risk", "one_time_cost"] },
  { label: "普通", type: "normal", categories: ["expense_up", "positive"] },
  { label: "收入", type: "income", categories: ["income_down"] },
  { label: "家庭", type: "family", categories: ["one_time_cost", "expense_up"] },
  { label: "正向", type: "positive", categories: ["positive"] },
  { label: "选择", type: "choice", categories: ["choice"] },
  { label: "健康", type: "health", categories: ["health_risk"] },
];

function init() {
  initTracking();
  savedGameAvailable = Boolean(loadSavedGame(false));
  player = null;
  renderHome();
}

function initTracking() {
  const websiteId = String(window.CASH_GAME_UMAMI_WEBSITE_ID || "").trim();
  if (!websiteId) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = TRACKING_SCRIPT_SRC;
  script.dataset.websiteId = websiteId;
  script.addEventListener("load", flushTrackingEvents);
  document.head.appendChild(script);
}

function flushTrackingEvents() {
  const events = pendingTrackingEvents;
  pendingTrackingEvents = [];
  events.forEach(({ name, data }) => trackEvent(name, data));
}

function trackEvent(name, data = {}) {
  // Umami 自定义事件：统一加项目标识，便于和其他 GitHub Pages 项目区分。
  const payload = {
    project: TRACKING_PROJECT,
    ...data,
  };

  if (typeof window.umami?.track === "function") {
    window.umami.track(name, payload);
    return;
  }

  if (window.CASH_GAME_UMAMI_WEBSITE_ID) {
    pendingTrackingEvents.push({ name, data: payload });
  }
}

function bufferBand(buffer) {
  // 只记录安全垫区间，不上传具体收入、支出、储蓄或安全垫数值。
  if (buffer < 0) return "negative";
  if (buffer < 1) return "under_1_month";
  if (buffer < 3) return "1_to_3_months";
  if (buffer < 6) return "3_to_6_months";
  return "over_6_months";
}

function renderHome() {
  const savedActions = savedGameAvailable
    ? `
      <button class="button primary" data-action="continue">继续上次游戏</button>
      <button class="button secondary" data-action="restart">重新开始</button>
    `
    : `
      <button class="button primary" data-action="random">随机抽身份</button>
      <button class="button secondary" data-action="custom">输入我的情况</button>
    `;

  app.innerHTML = `
    <section class="screen">
      <div class="game-hero">
        <div class="top-kicker"><span class="brand-mark"></span>现金流人生地图</div>
        <div class="hero">
          <h1>36 个月现金流生存挑战</h1>
        </div>
        <div class="hero-board" aria-hidden="true">
          <div class="hero-route">
            <span class="route-node hot"></span>
            <span class="route-node calm"></span>
            <span class="route-node risk"></span>
            <span class="route-node choice"></span>
            <span class="route-token"></span>
          </div>
          <div class="hero-dice" aria-label="骰子：每次前进 1 到 3 步">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </div>
        </div>
      </div>
      <div class="mission-card">
        <div class="mission-title">
          <span>本局目标</span>
          <strong>别让现金储备跌破 0</strong>
        </div>
        <div class="mission-steps">
          <span>抽身份</span>
          <i></i>
          <span>掷骰前进</span>
          <i></i>
          <span>翻事件卡</span>
        </div>
      </div>
      <p class="lead home-lead">你现在的生活，看起来很稳定。<br>但地图不会只发好牌。<br>连续几个月之后，<br>真正能救场的，是现金储备还剩多少。</p>
      <div class="actions">${savedActions}</div>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。</p>
    </section>
  `;
}

function renderRandomIdentity(identity = randomItem(identityCards)) {
  app.innerHTML = `
    <section class="screen">
      <div class="page-head">
        <div class="page-head-row">
          <h1 class="page-title">抽到的身份</h1>
          <button class="button ghost small" data-action="home">返回</button>
        </div>
      </div>
      ${identityCardHtml(identity)}
      ${challengeLengthHtml()}
      <div class="actions">
        <button class="button primary" data-action="start-random" data-id="${identity.id}">使用这个身份开始游戏</button>
        <button class="button secondary" data-action="random">重新抽一张</button>
      </div>
    </section>
  `;
}

function identityCardHtml(identity) {
  return `
    <article class="identity-card character-card">
      <div class="character-frame">
        <span></span>
        <span></span>
      </div>
      <div class="character-card-kicker">PLAYER CARD</div>
      <div class="character-title">
        <h2>${escapeHtml(identity.name)}</h2>
      </div>
      <div class="character-stats">
        <div class="character-stat reserve"><span>现金储备</span><strong>${formatMoney(identity.savings)}</strong></div>
        <div class="character-stat income"><span>月收入</span><strong>${formatMoney(identity.income)}</strong></div>
        <div class="character-stat expense"><span>月支出</span><strong>${formatMoney(identity.expense)}</strong></div>
      </div>
      <div class="character-dots" aria-hidden="true">
        <span class="hot"></span>
        <span class="calm"></span>
        <span class="choice"></span>
      </div>
    </article>
  `;
}

function renderCustomIdentity() {
  app.innerHTML = `
    <section class="screen">
      <div class="page-head">
        <div class="page-head-row">
          <h1 class="page-title">输入我的情况</h1>
          <button class="button ghost small" data-action="home">返回</button>
        </div>
        <p class="compact-lead">只需要三个数字，就可以生成你的现金流起点。</p>
      </div>
      <form class="identity-card form" id="customForm" novalidate>
        <div class="field">
          <label for="income">月收入</label>
          <input id="income" name="income" inputmode="numeric" placeholder="例如 18000" />
        </div>
        <div class="field">
          <label for="expense">月支出</label>
          <input id="expense" name="expense" inputmode="numeric" placeholder="例如 13000" />
        </div>
        <div class="field">
          <label for="savings">当前现金储备</label>
          <input id="savings" name="savings" inputmode="numeric" placeholder="例如 40000" />
        </div>
        <div class="field">
          <label for="maxMonth">挑战长度</label>
          <select id="maxMonth" name="maxMonth">
            ${challengeLengths
              .map((months) => `<option value="${months}" ${months === selectedMaxMonth ? "selected" : ""}>${months} 个月</option>`)
              .join("")}
          </select>
        </div>
        <div class="error-text" id="formError"></div>
        <button class="button primary" type="submit">开始游戏</button>
      </form>
    </section>
  `;
}

function challengeLengthHtml() {
  return `
    <div class="panel challenge-panel">
      <span>挑战长度</span>
      <div class="segmented" role="group" aria-label="挑战长度">
        ${challengeLengths
          .map(
            (months) => `
              <button class="segment ${months === selectedMaxMonth ? "active" : ""}" data-action="set-length" data-months="${months}">
                ${months} 个月
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderGamePage(message = "点击掷骰子，在人生地图上前进。", options = {}) {
  if (!player) {
    renderHome();
    return;
  }

  const currentIncome = calculateRecurringIncome();
  const currentExpense = calculateRecurringExpense();
  const buffer = calculateBuffer();
  const bufferStatus = getBufferStatus(buffer);
  const monthProgress = Math.round((player.currentMonth / player.maxMonth) * 100);
  const dcaPlan = getDcaPlan();
  const protectionPlan = getProtectionPlan();
  const temporaryExpenseEffects = getTemporaryExpenseEffects();
  const pendingStatuses = getPendingScheduledStatuses();
  const moveBannerHtml = mapMotion
    ? `
      <div class="move-banner">
        <span class="move-dice">${lastDice}</span>
        <strong>前进 ${lastDice} 步</strong>
      </div>
    `
    : "";
  const activePlanCards = [
    dcaPlan && shouldShowDcaPlanCard(dcaPlan)
      ? {
          title: dcaPlanCardTitle(dcaPlan),
          meta: dcaPlanStatusLine(dcaPlan),
          tone: dcaPlan.status === "paused" ? "pending" : "",
        }
      : null,
    protectionPlan
      ? {
          title: `正在生效的保障：${protectionPlan.name}`,
          meta: `每月支出：${formatMoney(protectionPlan.monthlyAmount)} · 剩余 ${protectionPlan.remainingMonths} 个月 · 已减少损失：${formatMoney(protectionPlan.totalReduced || 0)}`,
        }
      : null,
    ...temporaryExpenseEffects.map((effect) => ({
      title: `临时支出：${effect.name || "持续支出"}`,
      meta: `每月增加：${formatEffectMonthlyAmount(effect)} · 剩余 ${effect.remainingMonths} 个月`,
      tone: "expense",
    })),
    ...pendingStatuses.map((status) => ({
      title: `待生效：${status.title}`,
      meta: status.meta,
      tone: "pending",
    })),
  ].filter(Boolean);
  const planHtml = activePlanCards.length
    ? `
      <div class="plan-strip">
        ${activePlanCards
          .map(
            (plan) => `
              <div class="plan-item ${plan.tone ? `plan-${plan.tone}` : ""}">
                <strong>${escapeHtml(plan.title)}</strong>
                <span>${escapeHtml(plan.meta)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    `
    : "";

  app.innerHTML = `
    <section class="screen game-screen">
      <div class="status-bar">
        <div class="month-row">
          <div>
            <span class="hud-label">当前进度</span>
            <strong>第 ${player.currentMonth} / ${player.maxMonth} 个月</strong>
          </div>
          ${bufferPill(buffer)}
        </div>
        <div class="progress-track" aria-label="挑战进度"><i style="width:${monthProgress}%"></i></div>
        <div class="shield-meter compact">
          <div class="meter-head"><span>现金流安全垫</span><strong>${bufferStatus.text}</strong></div>
          <div class="meter-track"><i class="${bufferStatus.className}" style="width:${getShieldPercent(buffer)}%"></i></div>
        </div>
        <div class="mini-stats">
          <div class="mini-stat"><span>常规月收入</span><strong>${formatMoney(currentIncome)}</strong></div>
          <div class="mini-stat"><span>常规月支出</span><strong>${formatMoney(currentExpense)}</strong></div>
          <div class="mini-stat"><span>现金储备</span><strong>${formatMoney(player.savings)}</strong></div>
          <div class="mini-stat"><span>安全垫</span><strong>${formatBuffer(buffer)} 个月</strong></div>
        </div>
      </div>
      <div class="map-panel">
        <div class="map-title">
          <div>
            <span>${escapeHtml(player.identityName)}的人生地图</span>
            <small>路在往前延伸，事件停下后才揭晓</small>
          </div>
        </div>
        <div class="journey-map ${mapMotion ? "is-moving" : ""}" style="${mapMotion ? `--drift-x:${mapMotion.driftX}px; --drift-y:${mapMotion.driftY}px;` : ""}">
          ${moveBannerHtml}
          <div class="map-depth" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="map-card-stack" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </div>
          <div class="journey-world">
            <svg class="journey-road" viewBox="0 0 620 260" aria-hidden="true">
              <path class="road-shadow" d="M20 218 C105 166 122 220 202 158 S326 72 418 112 S512 154 600 30" />
              <path class="road-base" d="M20 218 C105 166 122 220 202 158 S326 72 418 112 S512 154 600 30" />
              <path class="road-dash" d="M20 218 C105 166 122 220 202 158 S326 72 418 112 S512 154 600 30" />
            </svg>
            ${journeyNodesHtml()}
          </div>
          <div class="player-token" aria-label="当前位置">
            <span></span>
          </div>
        </div>
      </div>
      ${planHtml}
      <div class="bottom-bar">
        <button class="button primary roll-button" data-action="roll" ${player.gameEnded || mapMotion ? "disabled" : ""}>
          <span class="dice-face">${lastDice || "?"}</span>
          掷骰前进
        </button>
        <button class="button secondary" data-action="history">查看历史</button>
        <button class="button secondary" data-action="end-now">查看报告</button>
        <button class="button danger" data-action="restart">重新开始</button>
      </div>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。</p>
    </section>
  `;

  if (!options.skipEcho) maybeTriggerDcaMarketEvent();
}

function rollDice() {
  if (!player || player.gameEnded) return;
  lastDice = randomInt(1, 3);
  trackEvent("cash_game_dice_rolled", {
    // 记录：玩家掷骰前进，用于判断玩家是否真正进入游玩循环。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
  });
  mapMotion = {
    driftX: -lastDice * 34,
    driftY: lastDice * 18,
  };
  player.position = (player.position + lastDice) % mapCells.length;
  const event = getEventForCurrentPosition();
  renderGamePage(`你掷出了 ${lastDice} 点，地图正在向前滑动。`);
  window.setTimeout(() => {
    mapMotion = null;
    renderGamePage(`你停在新的节点上，事件即将揭晓。`, { skipEcho: true });
    window.setTimeout(() => showEventCard(event), 120);
  }, 760);
}

function showEventCard(event) {
  if (!event) return;
  const isChoice = Array.isArray(event.choices);
  const protectionPreview = getProtectionPreview(event, event.effect);
  openModal(`
    <div class="event-modal-card ${categoryClass(event.category)}">
      <div class="event-draw-strip">
        <span>抽到事件</span>
        <strong>第 ${player.currentMonth} 个月</strong>
      </div>
      <div class="event-card-head ${categoryClass(event.category)}">
        <span>${escapeHtml(categoryLabel(event.category))}</span>
        <i>${escapeHtml(categoryMark(event.category))}</i>
      </div>
      <div class="event-card-body">
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.description)}</p>
        ${
          protectionPreview
            ? `
              <div class="protection-preview">
                <strong>基础保障可用</strong>
                <span>预计可减少 ${formatPercent(protectionPreview.coverageRate)} 的自付损失，本次约少花 ${formatMoney(protectionPreview.reduction)}。</span>
              </div>
            `
            : ""
        }
        ${
          isChoice
            ? `
              <div class="choice-list">
                ${event.choices
                  .map(
                    (choice, index) => `
                      <button class="choice-button ${choiceEffectTone(choice.effect)}" data-action="choose-event" data-event-id="${event.id}" data-choice-index="${index}">
                        <strong class="choice-title">${escapeHtml(choice.label)}</strong>
                        <span class="choice-impact">${escapeHtml(choiceEffectLine(choice.effect))}</span>
                        <span class="choice-note">${escapeHtml(choice.resultText)}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="effect-box">
                <strong>财务影响</strong>
                <span>${effectText(event.effect)}</span>
              </div>
            `
        }
      </div>
      ${
        isChoice
          ? ""
          : `
            <div class="modal-actions">
              <button class="button primary" data-action="confirm-event" data-event-id="${event.id}">确认影响</button>
            </div>
          `
      }
    </div>
  `);
}

function confirmEvent(eventId, choiceIndex = null) {
  const event = eventCards.find((item) => item.id === eventId);
  if (!event) return;
  const choice = choiceIndex === null ? null : event.choices[Number(choiceIndex)];
  const effect = choice ? choice.effect : event.effect;
  const before = captureMonthState();

  applyEffect(effect, event);
  const afterEffect = captureMonthState();
  pendingMonthlySummary = buildMonthlySummary(event, choice, before, afterEffect);
  addToHistory(event, choice, afterEffect);
  recordEventDraw(event.id);
  trackEvent("cash_game_card_resolved", {
    // 记录：玩家处理了一张事件卡，用于分析哪些卡牌和选择被触发。
    event_id: event.id,
    event_category: event.category,
    has_choice: Boolean(choice),
    choice_index: choice ? Number(choiceIndex) : null,
    month: player.currentMonth,
  });
  closeModal();
  renderGamePage(`「${event.title}」已经生效，本月结算如下。`, { skipEcho: true });
  showMonthlySummary();
}

function showMonthlySummary() {
  if (!pendingMonthlySummary) return;
  const summary = pendingMonthlySummary;
  const settlementClass = summary.bufferAfterMonth >= summary.bufferBefore ? "is-up" : "is-down";
  const verdict = getSettlementVerdict(summary);
  const detailRows = [
    summary.tempIncomeDelta ? ["临时收入影响", formatSignedMoney(summary.tempIncomeDelta), ""] : null,
    summary.tempExpenseDelta ? ["临时支出影响", formatSignedMoney(summary.tempExpenseDelta), ""] : null,
    summary.protectionReduction ? ["保障减少损失", `+${formatMoney(summary.protectionReduction)}`, "good"] : null,
    summary.reserveDelta ? ["一次性储备变动", formatSignedMoney(summary.reserveDelta), ""] : null,
  ].filter(Boolean);
  const detailRowsHtml = detailRows.length
    ? `
      <div class="settlement-details">
        ${detailRows.map(([label, value, className]) => `<div class="detail-row ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
    `
    : "";
  openModal(`
    <div class="settlement-card ${settlementClass}">
      <div class="settlement-verdict ${verdict.className}">
        <span>本回合结果</span>
        <strong>${escapeHtml(verdict.title)}</strong>
        <small>${escapeHtml(verdict.text)}</small>
      </div>
      <div class="settlement-head">
        <h2>本月结算</h2>
        <span class="round-badge">${escapeHtml(summary.roundLabel)}</span>
        <p>${escapeHtml(summary.eventTitle)}${summary.choiceLabel ? ` · 选择「${escapeHtml(summary.choiceLabel)}」` : ""}</p>
      </div>
      <div class="buffer-shift">
        <div class="buffer-shift-head">
          <span>安全垫变化</span>
          <strong>${formatBuffer(summary.bufferBefore)} → ${formatBuffer(summary.bufferAfterMonth)} 个月</strong>
        </div>
        <div class="buffer-shift-track">
          <i class="before" style="width:${getShieldPercent(summary.bufferBefore)}%"></i>
          <i class="after ${settlementClass}" style="width:${getShieldPercent(summary.bufferAfterMonth)}%"></i>
        </div>
      </div>
      <div class="settlement-core">
        <div class="settlement-main-card cashflow-card">
          <span>现金流入流出</span>
          <strong>${formatSignedMoney(summary.monthlyNetCashflow)}</strong>
          <small>收入 ${formatMoney(summary.currentIncome)} · 支出 ${formatMoney(summary.currentExpense)}</small>
        </div>
        <div class="settlement-main-card savings-card">
          <span>当前储蓄</span>
          <strong>${formatMoney(summary.savingsAfterMonth)}</strong>
          <small>本月变化 ${formatSignedMoney(summary.savingsDelta)} · 安全垫 ${formatBuffer(summary.bufferAfterMonth)} 个月</small>
        </div>
      </div>
      ${
        summary.protectionReduction
          ? `
            <div class="settlement-special protection-hit">
              <span>基础保障生效</span>
              <strong>这次少花 ${formatMoney(summary.protectionReduction)}</strong>
              <small>原本会直接扣现金储备的损失，被保障挡下了一部分。</small>
            </div>
          `
          : ""
      }
      ${detailRowsHtml}
    </div>
    <div class="insight">
      <strong>本月分析</strong>
      <span>${escapeHtml(summary.narrative)}</span>
      <span>${escapeHtml(summary.analysis)}</span>
      ${summary.recoveryPreview ? `<span>${escapeHtml(summary.recoveryPreview)}</span>` : ""}
    </div>
    <div class="modal-actions">
      <button class="button primary" data-action="end-month">进入下个月</button>
    </div>
  `);
}

function endGameNow() {
  if (!player) return;
  trackEvent("cash_game_report_requested", {
    // 记录：玩家主动查看报告，用于判断是否有人提前结束并查看结果。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
  });
  player.gameEnded = true;
  player.endReason = "manual";
  player.endedMonth = player.currentMonth;
  saveGame();
  closeModal();
  renderResultPage();
}

function endMonth() {
  if (!pendingMonthlySummary) return;
  const settledSummary = pendingMonthlySummary;
  recordActualMonthStress(settledSummary);
  player.savings = pendingMonthlySummary.savingsAfterMonth;
  processLongTermPlans();
  const recoveryMessages = processActiveEffects();
  player.recoveryMessages = recoveryMessages;
  const scheduledEchoes = processScheduledCards();
  updateLowestSavingsAndBuffer();
  player.tempIncomeChange = 0;
  player.tempIncomePercent = 0;
  player.tempExpenseChange = 0;
  player.tempExpensePercent = 0;
  player.tempProtectionReduction = 0;
  pendingMonthlySummary = null;
  trackEvent("cash_game_month_settled", {
    // 记录：玩家完成一次月度结算，用于观察实际推进到第几个月。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    round_label: settledSummary.roundLabel,
    buffer_band_after: bufferBand(settledSummary.bufferAfterMonth),
  });

  if (player.savings < 0 || player.currentMonth >= player.maxMonth) {
    player.gameEnded = true;
    player.endReason = player.savings < 0 ? "cash_broken" : "completed";
    player.endedMonth = player.currentMonth;
    saveGame();
    closeModal();
    renderResultPage();
    return;
  }

  player.currentMonth += 1;
  saveGame();
  closeModal();
  renderGamePage(nextMonthMessage(recoveryMessages));
  maybeShowScheduledEcho(scheduledEchoes);
}

function renderHistory() {
  trackEvent("cash_game_history_opened", {
    // 记录：玩家打开人生日志，用于判断历史回放是否有人使用。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
  });
  const rows = player.history.length
    ? player.history
        .map(
          (item) => `
            <div class="history-row ${getHistoryTone(item)}">
              <span class="history-dot"></span>
              <div class="history-main">
                <strong>第 ${item.month} 个月 · ${escapeHtml(item.eventTitle)}</strong>
                <span>${escapeHtml(getHistorySummary(item))}</span>
              </div>
              <div class="history-meta">
                ${formatMoney(item.savingsAfter)}<br>${formatBuffer(item.bufferAfter)} 个月
              </div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">还没有历史事件。掷一次骰子，人生地图就会开始记录。</div>`;

  openModal(`
    <h2>人生日志</h2>
    <div class="history-list">${rows}</div>
    <div class="modal-actions">
      <button class="button secondary" data-action="close-modal">关闭</button>
    </div>
  `);
}

function renderResultPage() {
  if (!player) return;
  const result = getResultType();
  const score = getSurvivalScore();
  const grade = getResultGrade(score);
  const finalBuffer = calculateBuffer();
  const biggestStressTitle = player.biggestStressEvent?.title || "暂无";
  const biggestStressAmount = player.biggestStressEvent?.stress || 0;
  const protectionResult = getProtectionResult();
  const dcaResult = getDcaResult();
  const careerResult = getCareerCourseResult();
  trackEvent(player.endReason === "cash_broken" ? "cash_game_failed" : "cash_game_completed", {
    // 记录：一局游戏结束。只上传结果类型和安全垫区间，不上传具体分数或金额。
    end_reason: player.endReason || "completed",
    ended_month: player.endedMonth || player.currentMonth,
    challenge_length: player.maxMonth,
    result_type: result.type,
    grade: grade.grade,
    final_buffer_band: bufferBand(finalBuffer),
    lowest_buffer_band: bufferBand(player.lowestBuffer),
    had_protection: Boolean(getAnyProtectionPlan()),
    had_dca: Boolean(getDcaPlan()),
  });
  clearSavedGame();
  savedGameAvailable = false;
  app.innerHTML = `
    <section class="screen result-screen">
      <div class="result-hero">
        <div class="result-rank">
          <strong>${escapeHtml(grade.grade)}</strong>
          <span>等级</span>
        </div>
        <div class="result-score-copy">
          <span class="result-type">${escapeHtml(result.type)}</span>
          <h1>${score}<small>分</small></h1>
          <p>${escapeHtml(result.summary)}</p>
        </div>
      </div>
      ${resultJourneyHtml(finalBuffer)}
      <div class="result-card result-replay-card">
        <div class="replay-event-head">
          <div>
            <span>最重一击</span>
            <strong>${escapeHtml(biggestStressTitle)}</strong>
          </div>
          <div class="stress-amount">
            <span>累计冲击</span>
            <strong>${formatMoney(biggestStressAmount)}</strong>
          </div>
        </div>
        <p>${escapeHtml(getBiggestStressExplanation(biggestStressTitle, biggestStressAmount))}</p>
      </div>
      ${protectionResult ? resultProtectionHtml(protectionResult) : ""}
      ${dcaResult ? resultDcaHtml(dcaResult) : ""}
      ${careerResult ? resultCareerCourseHtml(careerResult) : ""}
      <div class="actions">
        <button class="button primary" data-action="restart">再玩一次</button>
        <button class="button ghost" data-action="random">换一个身份</button>
      </div>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。游戏中的收入、支出、市场表现和事件结果均为简化模拟。</p>
    </section>
  `;
}

function resultJourneyHtml(finalBuffer) {
  const endedMonth = player.endedMonth || player.currentMonth;
  return `
    <div class="result-card result-journey-card">
      <div class="section-title">
        <span>进程与安全垫轨迹</span>
        <strong>第 ${endedMonth} / ${player.maxMonth} 个月 · 最终安全垫 ${formatBuffer(finalBuffer)} 个月</strong>
      </div>
      ${resultBufferCurveHtml(finalBuffer)}
    </div>
  `;
}

function resultBufferCurveHtml(finalBuffer) {
  const points = getResultCurvePoints([player.initialBuffer, player.lowestBuffer, finalBuffer]);
  const path = `M ${points[0].x} ${points[0].y} C 76 ${points[0].y}, 92 ${points[1].y}, ${points[1].x} ${points[1].y} S 224 ${points[2].y}, ${points[2].x} ${points[2].y}`;
  const areaPath = `${path} L ${points[2].x} 104 L ${points[0].x} 104 Z`;
  const labels = [
    { label: "开局", buffer: player.initialBuffer, savings: player.initialSavings, point: points[0] },
    { label: "最低点", buffer: player.lowestBuffer, savings: player.lowestSavings, point: points[1] },
    { label: "结算", buffer: finalBuffer, savings: player.savings, point: points[2] },
  ];

  return `
    <div class="buffer-curve">
      <svg viewBox="0 0 300 112" role="img" aria-label="安全垫曲线">
        <path class="curve-grid" d="M 24 28 H 276 M 24 56 H 276 M 24 84 H 276" />
        <path class="curve-area" d="${areaPath}" />
        <path class="curve-line" d="${path}" />
        ${labels
          .map(
            (item, index) => `
              <g class="curve-point point-${index}">
                <circle cx="${item.point.x}" cy="${item.point.y}" r="5" />
              </g>
            `,
          )
          .join("")}
      </svg>
      <div class="curve-labels">
        ${labels
          .map(
            (item) => `
              <div>
                <span>${escapeHtml(item.label)}</span>
                <strong>${formatBuffer(item.buffer)} 个月</strong>
                <small>${formatMoney(item.savings)}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function getResultCurvePoints(buffers) {
  const finite = buffers.map((value) => (Number.isFinite(value) ? value : 8));
  const min = Math.min(...finite, 0);
  const max = Math.max(...finite, 6);
  const range = Math.max(1, max - min);
  const xs = [28, 150, 272];
  return finite.map((value, index) => ({
    x: xs[index],
    y: Math.round(92 - ((value - min) / range) * 64),
  }));
}

function getBiggestStressExplanation(title, stressAmount) {
  if (!title || title === "暂无") return "这一局没有出现明显的单次压力事件。";
  const count = player?.stressCounts?.[title] || 1;
  const unit = player?.stressUnits?.[title] || "次";
  if (count > 1) {
    return `这个事件在本局实际影响了 ${count} ${unit}，累计造成 ${formatMoney(stressAmount)} 的现金流冲击。`;
  }
  return `这个事件在本局实际造成 ${formatMoney(stressAmount)} 的现金流冲击。`;
}

function getProtectionResult() {
  const plan = getAnyProtectionPlan();
  if (!plan || !(plan.totalReduced > 0)) return null;
  return {
    totalReduced: plan.totalReduced,
    coverageRate: plan.coverageRate || 0,
  };
}

function resultProtectionHtml(result) {
  return `
    <div class="result-special-card protection-result-card">
      <span>基础保障发挥作用</span>
      <strong>累计少花 ${formatMoney(result.totalReduced)}</strong>
      <p>遇到健康风险时，保障替你挡下了约 ${formatPercent(result.coverageRate)} 的可覆盖损失。这笔配置在这一局里产生了实际作用。</p>
    </div>
  `;
}

function getDcaResult() {
  const plan = getDcaPlan();
  if (!plan) return null;
  const invested = plan.totalInvested || 0;
  const holdingPrincipal = getDcaHoldingPrincipal(plan);
  const returnRate = getDcaCurrentReturnRate(plan);
  const holdingValue = getDcaHoldingValue(plan, returnRate);
  const realizedAmount = plan.realizedAmount || 0;
  const soldPrincipal = plan.soldPrincipal || 0;
  const realizedProfit = Number.isFinite(plan.realizedProfit) ? plan.realizedProfit : realizedAmount - soldPrincipal;
  const unrealizedProfit = holdingValue - holdingPrincipal;
  const totalValue = holdingValue + realizedAmount;
  const totalReturnRate = invested > 0 ? (totalValue - invested) / invested : 0;

  if (invested <= 0) {
    return {
      label: "刚刚开始",
      shortText: "刚开始",
      invested: 0,
      estimatedValue: 0,
      realizedAmount: 0,
      soldPrincipal: 0,
      realizedProfit: 0,
      holdingValue: 0,
      holdingPrincipal: 0,
      unrealizedProfit: 0,
      returnAmount: 0,
      returnRate: 0,
      summary: "定投计划已经开启，暂时还没有形成阶段结果。",
    };
  }

  const label = getDcaResultLabel(plan);
  const summaryParts = [];
  if (realizedAmount > 0) summaryParts.push("已卖出部分已计入现金储备");
  if (holdingPrincipal > 0) summaryParts.push(`期末持仓估算 ${formatMoney(holdingValue)}`);
  if (!summaryParts.length) summaryParts.push("期末没有剩余持仓");

  return {
    label,
    shortText: `${label}，收益率${formatPercent(totalReturnRate)}`,
    invested,
    estimatedValue: totalValue,
    realizedAmount,
    soldPrincipal,
    realizedProfit,
    holdingValue,
    holdingPrincipal,
    unrealizedProfit,
    returnAmount: totalValue - invested,
    returnRate: totalReturnRate,
    summary: summaryParts.join("，") + "。",
  };
}

function resultDcaHtml(result) {
  const metrics = getDcaResultMetrics(result);
  return `
    <div class="result-special-card dca-result-card">
      <span>定投阶段结论</span>
      <strong>${escapeHtml(result.label)}</strong>
      <div class="dca-result-metrics">
        ${metrics
          .map(
            (item) => `
              <div>
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <p>累计投入 ${formatMoney(result.invested)}。${escapeHtml(result.summary)}</p>
    </div>
  `;
}

function getDcaResultMetrics(result) {
  const metrics = [
    {
      label: "阶段收益率",
      value: result.invested > 0 ? formatPercent(result.returnRate) : "暂无",
    },
  ];

  if (result.realizedAmount > 0) {
    metrics.push(profitMetric("已实现", result.realizedProfit));
  }

  if (result.holdingPrincipal > 0) {
    metrics.push({
      label: "期末持仓估算",
      value: formatMoney(result.holdingValue),
    });
    metrics.push(profitMetric("未实现", result.unrealizedProfit));
  }

  if (result.realizedAmount <= 0 && result.holdingPrincipal <= 0) {
    metrics.push({
      label: "期末估算",
      value: formatMoney(result.estimatedValue),
    });
  }

  return metrics;
}

function profitMetric(prefix, amount) {
  if (amount > 0) {
    return { label: `${prefix}盈利`, value: formatMoney(amount) };
  }
  if (amount < 0) {
    return { label: `${prefix}亏损`, value: formatMoney(Math.abs(amount)) };
  }
  return { label: `${prefix}盈亏`, value: formatMoney(0) };
}

function getCareerCourseResult() {
  const scheduled = (player.scheduledCards || []).find((card) => card.id === "career_course_echo");
  const incomeEffect = (player.activeEffects || []).find((effect) => effect.sourceEventId === "career_course_echo");
  if (incomeEffect || scheduled?.outcome === "success") {
    const amount = incomeEffect?.amount || scheduled?.incomeBoost || 1500;
    return {
      label: "课程开始回本",
      text: `职业提升课程已经带来收入机会，常规月收入增加 ${formatMoney(amount)}。`,
      tone: "success",
    };
  }
  if (!scheduled) return null;
  if (!scheduled.triggered) {
    const endedMonth = player.endedMonth || player.currentMonth;
    const remaining = Math.max(1, scheduled.triggerMonth - endedMonth);
    return {
      label: "课程还没到兑现期",
      text: `你报名了职业提升课程，但游戏在回响出现前结束了；原本预计还要约 ${remaining} 个月才可能看到后续机会。`,
      tone: "pending",
    };
  }
  return {
    label: "课程还在发酵",
    text: "课程已经触发过后续判断，但这次没有立刻带来收入变化。",
    tone: "neutral",
  };
}

function resultCareerCourseHtml(result) {
  return `
    <div class="result-special-card career-result-card result-${result.tone}">
      <span>职业提升课程</span>
      <strong>${escapeHtml(result.label)}</strong>
      <p>${escapeHtml(result.text)}</p>
    </div>
  `;
}

function renderDcaMarketCard(plan, stage) {
  const state = getDcaMarketState(stage, plan);
  const holdingValue = getDcaHoldingValue(plan, state.returnRate);

  openModal(`
    <h2>${escapeHtml(state.title)}</h2>
    <p>${escapeHtml(state.description)}</p>
    <div class="investment-snapshot">
      <div>
        <span>累计投入</span>
        <strong>${formatMoney(plan.totalInvested || 0)}</strong>
      </div>
      <div>
        <span>当前估算市值</span>
        <strong>${formatMoney(holdingValue)}</strong>
      </div>
      <div>
        <span>阶段收益率</span>
        <strong>${formatPercent(state.returnRate)}</strong>
      </div>
    </div>
    <div class="choice-list">
      ${state.choices
        .map(
          (choice) => `
            <button class="choice-button" data-action="dca-market-choice" data-stage="${stage}" data-choice="${choice.id}">
              <strong>${escapeHtml(choice.label)}</strong>
              <span>${escapeHtml(choice.text)}</span>
            </button>
          `,
        )
        .join("")}
    </div>
  `);
}

function handleDcaMarketChoice(choice, stage) {
  const plan = getDcaPlan();
  if (!plan) return;

  const state = getDcaMarketState(stage || plan.pendingMarketStage, plan);
  const holdingBefore = getDcaHoldingPrincipal(plan);

  if (choice === "sell_half") {
    sellDcaHolding(plan, 0.5, state.returnRate);
    plan.lastAction = `${state.stage}_sell_half`;
  }

  if (choice === "sell_all") {
    sellDcaHolding(plan, 1, state.returnRate);
    plan.lastAction = `${state.stage}_sell_all`;
  }

  if (choice === "hold") {
    plan.lastAction = `${state.stage}_hold`;
  }

  if (choice === "stop_dca") {
    plan.status = "paused";
    plan.pauseCount += 1;
    plan.lastAction = `${state.stage}_stop_dca`;
    removeDcaMonthlyEffect();
  }

  plan.pendingMarketStage = null;
  trackEvent("cash_game_investment_choice_made", {
    // 记录：玩家在估值修复或阶段高估时做出的投资选择。
    market_stage: state.stage,
    choice_type: choice,
    month: player.currentMonth,
  });
  if (choice === "sell_half" || choice === "sell_all") {
    trackEvent("cash_game_investment_sold", {
      // 记录：玩家发生卖出行为，只记录卖出类型，不上传卖出金额。
      market_stage: state.stage,
      sell_type: choice,
      sold_all: getDcaHoldingPrincipal(plan) <= 0,
      holding_before_band: holdingBefore > 0 ? "has_holding" : "no_holding",
    });
  }
  saveGame();
  closeModal();
  renderGamePage("投资状态已更新。");
}

function startGame(identity, maxMonth = selectedMaxMonth) {
  const initialBuffer = getBuffer(identity.savings, identity.expense);
  const normalizedMaxMonth = challengeLengths.includes(Number(maxMonth)) ? Number(maxMonth) : selectedMaxMonth;
  player = {
    identityName: identity.name,
    baseIncome: Number(identity.income) || 0,
    baseExpense: Number(identity.expense) || 0,
    savings: Number(identity.savings) || 0,
    currentMonth: 1,
    maxMonth: normalizedMaxMonth,
    position: 0,
    initialSavings: Number(identity.savings) || 0,
    initialBuffer,
    lowestSavings: Number(identity.savings) || 0,
    lowestBuffer: initialBuffer,
    biggestStressEvent: null,
    stressLedger: {},
    stressCounts: {},
    stressUnits: {},
    tempIncomeChange: 0,
    tempIncomePercent: 0,
    tempExpenseChange: 0,
    tempExpensePercent: 0,
    activeEffects: [],
    longTermPlans: [],
    scheduledCards: [],
    eventDrawHistory: [],
    recoveryMessages: [],
    tempProtectionReduction: 0,
    endReason: null,
    endedMonth: null,
    history: [],
    gameEnded: false,
  };
  lastDice = null;
  pendingMonthlySummary = null;
  saveGame();
  savedGameAvailable = true;
  trackEvent("cash_game_started", {
    // 记录：玩家正式开始一局游戏，用于计算从访问到开局的转化。
    identity_id: identity.id || "custom",
    identity_type: identity.id === "custom" ? "custom" : "preset",
    challenge_length: normalizedMaxMonth,
    initial_buffer_band: bufferBand(initialBuffer),
  });
  renderGamePage();
}

function applyEffect(effect, event = null) {
  if (!effect || effect.type === "none") return;

  if (effect.type === "change_savings") {
    player.savings += applyProtectionToSavingsChange(effect.amount, event);
    return;
  }

  if (effect.type === "change_savings_by_income_percent") {
    player.savings += Math.round(player.baseIncome * effect.amount);
    return;
  }

  if (effect.type === "bonus_invest_or_reserve") {
    const bonusAmount = Math.round(player.baseIncome);
    applyInvestOrReserve(bonusAmount, effect.investPercent || 0.5);
    return;
  }

  if (effect.type === "invest_or_reserve") {
    applyInvestOrReserve(effect.amount || 0, effect.investPercent || 0.5);
    return;
  }

  if (effect.type === "one_month_income_change") {
    player.tempIncomeChange += effect.amount;
    return;
  }

  if (effect.type === "one_month_income_percent") {
    player.tempIncomePercent += effect.amount;
    return;
  }

  if (effect.type === "one_month_expense_change") {
    player.tempExpenseChange += effect.amount;
    return;
  }

  if (effect.type === "one_month_expense_percent") {
    player.tempExpensePercent = (player.tempExpensePercent || 0) + effect.amount;
    return;
  }

  if (effect.type === "add_active_effect") {
    player.activeEffects.push({
      id: generateId("effect"),
      name: event?.title || "持续影响",
      target: effect.target,
      amount: effect.amount,
      remainingMonths: effect.duration,
      sourceEventId: event?.id || null,
    });
    return;
  }

  if (effect.type === "add_uncertain_active_effect") {
    player.activeEffects.push({
      id: generateId("uncertain"),
      name: "公司业务调整",
      target: effect.target,
      amount: effect.amount,
      remainingMonths: null,
      uncertain: true,
      elapsedMonths: 0,
      minMonths: effect.minMonths || 1,
      recoveryChance: effect.recoveryChance || 0.2,
      maxMonths: effect.maxMonths || 12,
      recoveryText: effect.recoveryText || "一项不确定影响已经解除。",
      sourceEventId: event?.id || "salary_cut",
    });
    return;
  }

  if (effect.type === "schedule_active_effect") {
    player.scheduledCards.push({
      id: effect.id || generateId("scheduled_effect"),
      type: "active_effect",
      title: effect.title || event?.title || "待生效影响",
      message: effect.message || "之前的选择开始产生后续影响。",
      triggerMonth: Math.min(player.maxMonth, player.currentMonth + (effect.triggerDelay || 1)),
      triggered: false,
      activeEffect: {
        name: effect.title || event?.title || "后续影响",
        target: effect.target,
        amount: effect.amount,
        duration: effect.duration,
        sourceEventId: effect.id || event?.id || null,
      },
    });
    return;
  }

  if (effect.type === "schedule_savings_effect") {
    player.scheduledCards.push({
      id: effect.id || generateId("scheduled_savings"),
      type: "savings_effect",
      title: effect.title || event?.title || "后续事件",
      message: effect.message || "之前的选择产生了后续影响。",
      triggerMonth: Math.min(player.maxMonth, player.currentMonth + (effect.triggerDelay || 1)),
      triggered: false,
      amount: effect.amount,
    });
    return;
  }

  if (effect.type === "start_dca_plan") {
    if (getDcaPlan()) {
      showToast("你已经有一个定投计划，不能重复开启。");
      return;
    }

    player.longTermPlans.push({
      id: "index_dca_001",
      name: "低估指数定投计划",
      status: "active",
      monthlyAmount: effect.monthlyAmount,
      totalInvested: 0,
      holdingPrincipal: 0,
      realizedAmount: 0,
      realizedProfit: 0,
      currentReturnRate: 0,
      marketStage: "low",
      startMonth: player.currentMonth,
      recoveryMonth: getDcaRecoveryMonth(),
      overvaluedMonth: null,
      pauseCount: 0,
      redeemed: false,
      recoveryTriggered: false,
      overvaluedTriggered: false,
      lastAction: null,
    });

    player.activeEffects.push({
      id: "dca_monthly",
      target: "expense",
      amount: effect.monthlyAmount,
      remainingMonths: 999,
      sourcePlanId: "index_dca_001",
    });
    trackEvent("cash_game_dca_started", {
      // 记录：玩家开启定投计划，用于观察投资相关玩法是否被使用。
      month: player.currentMonth,
      challenge_length: player.maxMonth,
    });
    return;
  }

  if (effect.type === "start_protection_plan") {
    if (getProtectionPlan()) {
      showToast("基础保障已经在生效中。");
      return;
    }

    player.longTermPlans.push({
      id: "basic_protection_001",
      name: "基础保障配置",
      status: "active",
      monthlyAmount: effect.monthlyAmount,
      coverageRate: effect.coverageRate,
      maxReduction: effect.maxReduction,
      remainingMonths: effect.duration,
      startMonth: player.currentMonth,
      totalReduced: 0,
    });

    player.activeEffects.push({
      id: "basic_protection_monthly",
      name: "基础保障配置",
      target: "expense",
      amount: effect.monthlyAmount,
      remainingMonths: effect.duration,
      sourcePlanId: "basic_protection_001",
      sourceEventId: event?.id || null,
    });
    trackEvent("cash_game_protection_started", {
      // 记录：玩家配置基础保障，用于观察保障玩法是否被使用。
      month: player.currentMonth,
      challenge_length: player.maxMonth,
    });
    return;
  }

  if (effect.type === "career_course_plan") {
    player.savings -= effect.cost;
    player.scheduledCards.push({
      id: "career_course_echo",
      triggerMonth: Math.min(player.maxMonth, player.currentMonth + randomInt(3, 5)),
      triggered: false,
    });
    return;
  }

  if (effect.type === "buy_car") {
    player.savings -= 50000;
    player.activeEffects.push({
      id: "car_loan",
      name: "换车月供",
      target: "expense",
      amount: 2500,
      remainingMonths: 36,
      sourceEventId: event?.id || "buy_car_choice",
    });
    scheduleCarFollowUps();
    return;
  }

  if (effect.type === "compound") {
    effect.effects.forEach((item) => applyEffect(item, event));
  }
}

function buildMonthlySummary(event, choice, before, afterEffect) {
  const recurringIncome = calculateRecurringIncome();
  const recurringExpense = calculateRecurringExpense();
  const currentIncome = calculateSettlementIncome();
  const currentExpense = calculateSettlementExpense();
  const tempIncomeDelta = currentIncome - recurringIncome;
  const tempExpenseDelta = currentExpense - recurringExpense;
  const reserveDelta = afterEffect.savings - before.savings;
  const protectionReduction = player.tempProtectionReduction || 0;
  const monthlyNetCashflow = currentIncome - currentExpense;
  const savingsAfterMonth = player.savings + monthlyNetCashflow;
  const savingsDelta = savingsAfterMonth - before.savings;
  const bufferAfterMonth = getBuffer(savingsAfterMonth, recurringExpense);
  const beforeBuffer = before.buffer;
  const afterBuffer = bufferAfterMonth;
  const direction = monthlyNetCashflow >= 0 ? "仍然保持正现金流" : "出现了负现金流";
  const bufferDelta = afterBuffer - beforeBuffer;

  return {
    eventTitle: event.title,
    choiceLabel: choice ? choice.label : null,
    bufferBefore: beforeBuffer,
    recurringIncome,
    recurringExpense,
    currentIncome,
    currentExpense,
    tempIncomeDelta,
    tempExpenseDelta,
    reserveDelta,
    protectionReduction,
    monthlyNetCashflow,
    savingsAfterMonth,
    savingsDelta,
    bufferAfterMonth,
    bufferDelta,
    roundLabel: getRoundLabel(monthlyNetCashflow, beforeBuffer, afterBuffer),
    narrative: `这个月你${direction}，安全垫从 ${formatBuffer(beforeBuffer)} 个月变成了 ${formatBuffer(afterBuffer)} 个月。`,
    analysis: event.insight,
    recoveryPreview: getUncertainEffectHint(),
    effectSavingsDelta: afterEffect.savings - before.savings,
  };
}

function calculateCurrentIncome() {
  return calculateSettlementIncome();
}

function calculateSettlementIncome() {
  if (!player) return 0;
  let income = calculateRecurringIncome();

  income += player.tempIncomeChange || 0;
  if (player.tempIncomePercent) income += player.baseIncome * player.tempIncomePercent;

  return Math.max(0, Math.round(income));
}

function calculateCurrentExpense() {
  return calculateSettlementExpense();
}

function calculateSettlementExpense() {
  if (!player) return 0;
  let expense = calculateRecurringExpense();

  expense += player.tempExpenseChange || 0;
  if (player.tempExpensePercent) expense += player.baseExpense * player.tempExpensePercent;
  return Math.max(0, Math.round(expense));
}

function calculateRecurringIncome() {
  if (!player) return 0;
  let income = player.baseIncome;

  player.activeEffects.forEach((effect) => {
    if (effect.target === "income") income += effect.amount;
    if (effect.target === "income_percent") income += player.baseIncome * effect.amount;
  });

  return Math.max(0, Math.round(income));
}

function calculateRecurringExpense() {
  if (!player) return 0;
  let expense = player.baseExpense;

  player.activeEffects.forEach((effect) => {
    if (effect.target === "expense") expense += effect.amount;
    if (effect.target === "expense_percent") expense += player.baseExpense * effect.amount;
  });

  return Math.max(0, Math.round(expense));
}

function calculateBuffer() {
  if (!player) return 0;
  return getBuffer(player.savings, calculateRecurringExpense());
}

function processLongTermPlans() {
  player.longTermPlans.forEach((plan) => {
    if (plan.id === "index_dca_001" && plan.status === "active") {
      plan.totalInvested += plan.monthlyAmount;
      plan.holdingPrincipal = getDcaHoldingPrincipal(plan) + plan.monthlyAmount;
    }

    if (plan.id === "basic_protection_001" && plan.status === "active") {
      plan.remainingMonths -= 1;
      if (plan.remainingMonths <= 0) {
        plan.status = "expired";
        removeProtectionMonthlyEffect();
      }
    }
  });
}

function processActiveEffects() {
  const recoveryMessages = [];

  player.activeEffects = player.activeEffects
    .map((effect) => {
      if (!effect.uncertain) {
        return { ...effect, remainingMonths: effect.remainingMonths - 1 };
      }

      const elapsedMonths = (effect.elapsedMonths || 0) + 1;
      const canRecover = elapsedMonths >= effect.minMonths;
      const forcedRecovery = elapsedMonths >= effect.maxMonths;
      const recovered = canRecover && (forcedRecovery || Math.random() < effect.recoveryChance);

      if (recovered) {
        recoveryMessages.push(effect.recoveryText);
        return { ...effect, elapsedMonths, recovered: true };
      }

      return { ...effect, elapsedMonths };
    })
    .filter((effect) => {
      if (effect.recovered) return false;
      if (effect.uncertain) return true;
      return effect.remainingMonths > 0;
    });

  return recoveryMessages;
}

function processScheduledCards() {
  const echoes = [];
  player.scheduledCards.forEach((card) => {
    if (!card.triggered && card.triggerMonth <= player.currentMonth) {
      card.triggered = true;
      const echo = resolveScheduledCard(card);
      if (echo) echoes.push(echo);
    }
  });
  return echoes;
}

function resolveScheduledCard(card) {
  if (card.type === "active_effect" && card.activeEffect) {
    player.activeEffects.push({
      id: generateId("scheduled_active"),
      name: card.activeEffect.name,
      target: card.activeEffect.target,
      amount: card.activeEffect.amount,
      remainingMonths: card.activeEffect.duration,
      sourceEventId: card.activeEffect.sourceEventId || card.id,
    });

    return {
      title: card.title,
      message: card.message,
      effectLine: `${card.activeEffect.target === "expense" ? "常规月支出" : "常规月收入"} ${formatSignedMoney(card.activeEffect.amount)}${durationSuffix(card.activeEffect.duration)}。`,
    };
  }

  if (card.type === "savings_effect") {
    player.savings += card.amount;
    recordStress(card.title || "后续事件", Math.max(0, -(card.amount || 0)), "次");

    return {
      title: card.title,
      message: card.message,
      effectLine: `现金储备 ${formatSignedMoney(card.amount)}。`,
    };
  }

  if (card.id !== "career_course_echo") return null;
  const success = Math.random() < 0.7;

  if (success) {
    card.outcome = "success";
    card.incomeBoost = 1500;
    player.activeEffects.push({
      id: generateId("career_income"),
      name: "职业提升课程回响",
      target: "income",
      amount: 1500,
      remainingMonths: 12,
      sourceEventId: "career_course_echo",
    });

    return {
      title: "课程开始回本",
      message: "之前报名的职业提升课程帮你拿到了更好的项目机会。",
      effectLine: "常规月收入 +1,500 元，持续 12 个月。",
    };
  }

  card.outcome = "neutral";
  return {
    title: "课程还在发酵",
    message: "课程没有立刻带来收入变化，但你补上了一块能力短板。",
    effectLine: "本月现金流暂时不变。",
  };
}

function maybeShowScheduledEcho(echoes = []) {
  if (!echoes.length) return;
  window.setTimeout(() => renderScheduledEchoCard(echoes[0]), 350);
}

function renderScheduledEchoCard(echo) {
  openModal(`
    <h2>${escapeHtml(echo.title)}</h2>
    <p>${escapeHtml(echo.message)}</p>
    <div class="effect-box">
      <strong>后续影响</strong>
      <span>${escapeHtml(echo.effectLine)}</span>
    </div>
    <div class="modal-actions">
      <button class="button primary" data-action="close-modal">继续前进</button>
    </div>
  `);
}

function scheduleCarFollowUps() {
  player.scheduledCards.push({
    id: generateId("car_maintenance"),
    type: "savings_effect",
    title: "第一次保养",
    message: "换车后的第一次保养到了。",
    triggerMonth: Math.min(player.maxMonth, player.currentMonth + randomInt(3, 5)),
    triggered: false,
    amount: -1200,
  });

  player.scheduledCards.push({
    id: generateId("car_parking_fee"),
    type: "active_effect",
    title: "停车费上涨",
    message: "新的通勤路线增加了停车支出。",
    triggerMonth: Math.min(player.maxMonth, player.currentMonth + randomInt(2, 4)),
    triggered: false,
    activeEffect: {
      name: "停车费上涨",
      target: "expense",
      amount: 500,
      duration: 6,
      sourceEventId: "car_parking_fee",
    },
  });

  player.scheduledCards.push({
    id: generateId("car_commute_efficiency"),
    type: "active_effect",
    title: "通勤效率提升",
    message: "通勤更稳定后，你接下了一些更顺手的工作安排。",
    triggerMonth: Math.min(player.maxMonth, player.currentMonth + randomInt(3, 6)),
    triggered: false,
    activeEffect: {
      name: "通勤效率提升",
      target: "income",
      amount: 800,
      duration: 6,
      sourceEventId: "car_commute_efficiency",
    },
  });
}

function maybeTriggerDcaMarketEvent() {
  const plan = getDcaPlan();
  if (!plan || ["redeemed", "sold_all"].includes(plan.status)) return;
  if (getDcaHoldingPrincipal(plan) <= 0) return;

  if (!plan.recoveryTriggered && player.currentMonth >= (plan.recoveryMonth || player.maxMonth)) {
    plan.recoveryTriggered = true;
    plan.marketStage = "recovered";
    plan.currentReturnRate = getDcaMarketState("recovered").returnRate;
    plan.pendingMarketStage = "recovered";
    plan.overvaluedMonth = getDcaOvervaluedMonth();
    saveGame();
    window.setTimeout(() => renderDcaMarketCard(plan, "recovered"), 350);
    return;
  }

  if (
    plan.recoveryTriggered &&
    !plan.overvaluedTriggered &&
    player.currentMonth >= (plan.overvaluedMonth || player.maxMonth) &&
    getDcaHoldingPrincipal(plan) > 0
  ) {
    plan.overvaluedTriggered = true;
    plan.marketStage = "overvalued";
    plan.currentReturnRate = getDcaMarketState("overvalued").returnRate;
    plan.pendingMarketStage = "overvalued";
    saveGame();
    window.setTimeout(() => renderDcaMarketCard(plan, "overvalued"), 350);
  }
}

function updateLowestSavingsAndBuffer() {
  const buffer = calculateBuffer();
  player.lowestSavings = Math.min(player.lowestSavings, player.savings);
  player.lowestBuffer = Math.min(player.lowestBuffer, buffer);
}

function recordActualMonthStress(summary) {
  if (!summary) return;
  const eventStress =
    Math.max(0, -(summary.reserveDelta || 0)) +
    Math.max(0, -(summary.tempIncomeDelta || 0)) +
    Math.max(0, summary.tempExpenseDelta || 0);
  recordStress(summary.eventTitle, eventStress, "次");

  player.activeEffects.forEach((effect) => {
    if (effect.sourcePlanId) return;
    recordStress(effect.name || "持续影响", getActiveEffectMonthlyStress(effect), "个月");
  });
}

function getActiveEffectMonthlyStress(effect) {
  if (!effect) return 0;
  if (effect.target === "income") return Math.max(0, -(effect.amount || 0));
  if (effect.target === "income_percent") return Math.max(0, -player.baseIncome * (effect.amount || 0));
  if (effect.target === "expense") return Math.max(0, effect.amount || 0);
  if (effect.target === "expense_percent") return Math.max(0, player.baseExpense * (effect.amount || 0));
  return 0;
}

function recordStress(title, amount, unit = "次") {
  const stress = Math.max(0, Math.round(amount || 0));
  if (!stress) return;
  const stressTitle = title || "未命名事件";
  if (!player.stressLedger) player.stressLedger = {};
  if (!player.stressCounts) player.stressCounts = {};
  if (!player.stressUnits) player.stressUnits = {};
  player.stressLedger[stressTitle] = (player.stressLedger[stressTitle] || 0) + stress;
  player.stressCounts[stressTitle] = (player.stressCounts[stressTitle] || 0) + 1;
  player.stressUnits[stressTitle] = unit;

  if (!player.biggestStressEvent || player.stressLedger[stressTitle] > player.biggestStressEvent.stress) {
    player.biggestStressEvent = {
      title: stressTitle,
      stress: player.stressLedger[stressTitle],
    };
  }
}

function addToHistory(event, choice, afterEffect) {
  const protectionReduction = player.tempProtectionReduction || 0;
  player.history.push({
    month: player.currentMonth,
    eventTitle: event.title,
    category: event.category,
    choice: choice ? choice.label : null,
    protectionReduction,
    savingsAfter: afterEffect.savings,
    bufferAfter: afterEffect.buffer,
  });
}

function getHistorySummary(item) {
  const parts = [];
  if (item.choice) parts.push(`选择：${item.choice}`);
  else parts.push(categoryLabel(item.category));
  if (item.protectionReduction) parts.push(`保障少花 ${formatMoney(item.protectionReduction)}`);
  if (item.bufferAfter < 1) parts.push("安全垫进入高压区");
  return parts.join(" · ");
}

function getHistoryTone(item) {
  if (item.protectionReduction) return "is-protected";
  if (item.bufferAfter < 1) return "is-danger";
  if (item.choice) return "is-choice";
  if (item.category === "positive") return "is-good";
  return "";
}

function recordEventDraw(eventId) {
  player.eventDrawHistory = player.eventDrawHistory || [];
  player.eventDrawHistory.push({ id: eventId, month: player.currentMonth });
  player.eventDrawHistory = player.eventDrawHistory.slice(-80);
}

function filterRecentEvents(events) {
  const history = player.eventDrawHistory || [];
  return events.filter((event) => {
    const cooldown = getEventCooldown(event);
    const lastDraw = [...history].reverse().find((item) => item.id === event.id);
    if (!lastDraw) return true;
    return player.currentMonth - lastDraw.month >= cooldown;
  });
}

function getEventCooldown(event) {
  const longCooldownIds = [
    "salary_cut",
    "client_budget_cut",
    "temporary_unemployment",
    "elder_hospital",
    "insurance_gap",
    "emergency_fund_choice",
  ];
  if (event.group === "interest") return 9;
  if (longCooldownIds.includes(event.id)) return 8;
  if (event.category === "choice") return 7;
  if (event.category === "one_time_cost") return 5;
  return 4;
}

function isEventAllowedByFrequency(event) {
  if (event.group === "interest" && getEventGroupOccurrenceCount("interest") >= 2) return false;
  const maxCount = getEventMaxCount(event);
  if (!Number.isFinite(maxCount)) return true;
  return getEventOccurrenceCount(event.id) < maxCount;
}

function getEventGroupOccurrenceCount(group) {
  const groupIds = new Set(eventCards.filter((event) => event.group === group).map((event) => event.id));
  return (player.eventDrawHistory || []).filter((item) => groupIds.has(item.id)).length;
}

function getEventOccurrenceCount(eventId) {
  return (player.eventDrawHistory || []).filter((item) => item.id === eventId).length;
}

function getEventMaxCount(event) {
  const onceIds = new Set([
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

  if (onceIds.has(event.id)) return 1;
  if (event.category === "choice") return 1;
  if (event.category === "one_time_cost") return 2;
  if (event.category === "health_risk") return 2;
  return Infinity;
}

function weightedRandomItem(items) {
  if (!items.length) return randomItem(eventCards);
  const total = items.reduce((sum, item) => sum + (item.weight || getDefaultWeight(item)), 0);
  let roll = Math.random() * total;

  for (const item of items) {
    roll -= item.weight || getDefaultWeight(item);
    if (roll <= 0) return item;
  }

  return items[items.length - 1];
}

function getDefaultWeight(event) {
  if (event.id === "index_dca_choice" && player?.currentMonth <= 10) return 2.6;
  if (event.group === "interest") return 0.7;
  if (["temporary_unemployment", "elder_hospital"].includes(event.id)) return 0.6;
  if (["salary_cut", "insurance_gap"].includes(event.id)) return 0.8;
  if (event.category === "positive") return 1.2;
  if (event.category === "choice") return 1;
  return 1;
}

function hasActiveEvent(eventId) {
  return player.activeEffects.some((effect) => effect.sourceEventId === eventId);
}

function getEventForCurrentPosition() {
  const cell = mapCells[player.position];
  const earlyDcaEvent = getEarlyDcaEvent();
  if (earlyDcaEvent && player.currentMonth === Math.min(10, player.maxMonth)) return earlyDcaEvent;
  const pools = cell.categories.flatMap((category) => eventCards.filter((event) => event.category === category));
  const eligiblePool = pools.filter((event) => {
    if (!isDcaEventAllowed(event)) return false;
    if (!isEventAllowedByFrequency(event)) return false;
    if (hasActiveEvent(event.id)) return false;
    return true;
  });
  const cooledPool = filterRecentEvents(eligiblePool);
  const fallbackPool = eventCards.filter((event) => {
    if (!isDcaEventAllowed(event)) return false;
    return isEventAllowedByFrequency(event) && !hasActiveEvent(event.id);
  });
  if (earlyDcaEvent && player.currentMonth >= 6 && Math.random() < 0.35) return earlyDcaEvent;
  return weightedRandomItem(cooledPool.length ? cooledPool : eligiblePool.length ? eligiblePool : fallbackPool);
}

function getEarlyDcaEvent() {
  const event = eventCards.find((item) => item.id === "index_dca_choice");
  if (!event || getDcaPlan() || player.currentMonth > 10 || !isEventAllowedByFrequency(event) || hasActiveEvent(event.id)) return null;
  return event;
}

function isDcaEventAllowed(event) {
  if (event.id !== "index_dca_choice") return true;
  return Boolean(getEarlyDcaEvent());
}

function nextMonthMessage(recoveryMessages = []) {
  if (recoveryMessages.length) {
    return `新的月份开始了。${recoveryMessages.join(" ")}`;
  }

  return "新的月份开始了。下一步可能是机会，也可能是压力。";
}

function getRoundLabel(monthlyNetCashflow, beforeBuffer, afterBuffer) {
  if (afterBuffer < 0) return "现金流击穿";
  if (afterBuffer < 1) return "高压回合";
  if (monthlyNetCashflow < 0 && afterBuffer < beforeBuffer) return "失血回合";
  if (monthlyNetCashflow > 0 && afterBuffer >= beforeBuffer) return "回血回合";
  return "平稳回合";
}

function getSettlementVerdict(summary) {
  if (summary.bufferAfterMonth < 0) {
    return { className: "danger", title: "现金流被击穿", text: "这个月之后现金储备已经低于 0。" };
  }
  if (summary.protectionReduction) {
    return { className: "protected", title: "保障挡下一击", text: `这次少花 ${formatMoney(summary.protectionReduction)}。` };
  }
  if (summary.bufferAfterMonth < 1) {
    return { className: "danger", title: "进入高压区", text: "安全垫已经不足 1 个月，下一步要谨慎。" };
  }
  if (summary.monthlyNetCashflow < 0 && summary.bufferDelta < -0.1) {
    return { className: "warn", title: "本月失血", text: `安全垫${formatSignedBuffer(summary.bufferDelta)}。` };
  }
  if (summary.monthlyNetCashflow > 0 && summary.bufferDelta > 0.05) {
    return { className: "good", title: "本月回血", text: `安全垫${formatSignedBuffer(summary.bufferDelta)}。` };
  }
  return { className: "stable", title: "平稳通过", text: "现金流没有出现明显恶化。" };
}

function getBufferShiftWidth(buffer) {
  return Math.max(4, Math.min(100, (Math.max(0, buffer) / 6) * 100));
}

function getUncertainEffectHint() {
  const uncertainEffects = player.activeEffects.filter((effect) => effect.uncertain);
  if (!uncertainEffects.length) return "";
  const names = uncertainEffects.map((effect) => effect.name || "不确定影响").join("、");
  return `仍在持续的不确定状态：${names}。恢复时间未知，之后每个月都有机会解除。`;
}

function getEndStatus() {
  const endedMonth = player.endedMonth || player.currentMonth;
  if (player.endReason === "cash_broken") {
    return {
      label: "提前击穿",
      text: `你在第 ${endedMonth} / ${player.maxMonth} 个月提前结束，原因是现金储备低于 0。`,
    };
  }

  if (player.endReason === "manual") {
    return {
      label: "主动结算",
      text: `你在第 ${endedMonth} / ${player.maxMonth} 个月主动结束并查看报告。`,
    };
  }

  return {
    label: "完成挑战",
    text: `你完成了 ${player.maxMonth} 个月现金流挑战。`,
  };
}

function getShieldPercent(buffer) {
  return Math.max(3, Math.min(100, (Math.max(0, buffer) / 8) * 100));
}

function getCellIcon(type) {
  const icons = {
    family: "家",
    income: "收",
    health: "险",
    positive: "补",
    normal: "路",
    choice: "选",
  };
  return icons[type] || "格";
}

function journeyNodesHtml() {
  const offsets = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return offsets
    .map((offset) => {
      const wrappedIndex = (player.position + offset + mapCells.length) % mapCells.length;
      const isCurrent = offset === 0;
      const isPast = offset < 0;
      const depth = Math.abs(offset);
      const point = getJourneyPoint(offset);
      const tone = getNodeTone(wrappedIndex);

      return `
        <span
          class="journey-node tone-${tone} ${isCurrent ? "current" : ""} ${isPast ? "past" : "future"}"
          style="--x:${point.x}px; --y:${point.y}px; --scale:${Math.max(0.62, 1 - depth * 0.035)};"
          aria-label="地图节点 ${wrappedIndex + 1}"
        ></span>
      `;
    })
    .join("");
}

function getJourneyPoint(offset) {
  const t = Math.max(0.04, Math.min(0.98, 0.5 + offset * 0.055));
  const point = getRoutePoint(t);
  return {
    x: point.x - 310,
    y: point.y - 112,
  };
}

function getRoutePoint(t) {
  const segments = [
    [
      { x: 20, y: 218 },
      { x: 105, y: 166 },
      { x: 122, y: 220 },
      { x: 202, y: 158 },
    ],
    [
      { x: 202, y: 158 },
      { x: 282, y: 96 },
      { x: 326, y: 72 },
      { x: 418, y: 112 },
    ],
    [
      { x: 418, y: 112 },
      { x: 510, y: 152 },
      { x: 512, y: 154 },
      { x: 600, y: 30 },
    ],
  ];
  const scaled = Math.max(0, Math.min(0.999, t)) * segments.length;
  const segmentIndex = Math.min(segments.length - 1, Math.floor(scaled));
  const localT = scaled - segmentIndex;
  return cubicPoint(...segments[segmentIndex], localT);
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function getNodeTone(index) {
  const tones = ["hot", "calm", "risk", "choice", "sky", "stone"];
  return tones[index % tones.length];
}

function categoryLabel(category) {
  const labels = {
    expense_up: "家庭支出",
    one_time_cost: "突发支出",
    income_down: "收入变化",
    positive: "补给事件",
    health_risk: "健康风险",
    choice: "选择事件",
  };
  return labels[category] || "人生事件";
}

function categoryClass(category) {
  const classes = {
    expense_up: "cat-family",
    one_time_cost: "cat-cost",
    income_down: "cat-income",
    positive: "cat-positive",
    health_risk: "cat-health",
    choice: "cat-choice",
  };
  return classes[category] || "cat-normal";
}

function categoryMark(category) {
  const marks = {
    expense_up: "FAMILY",
    one_time_cost: "COST",
    income_down: "INCOME",
    positive: "SUPPLY",
    health_risk: "RISK",
    choice: "CHOICE",
  };
  return marks[category] || "EVENT";
}

function categoryGlyph(category) {
  const glyphs = {
    expense_up: "支",
    one_time_cost: "突",
    income_down: "收",
    positive: "补",
    health_risk: "险",
    choice: "选",
  };
  return glyphs[category] || "事";
}

function getSurvivalScore() {
  const finalBuffer = calculateBuffer();
  const monthScore = ((player.endedMonth || player.currentMonth) / player.maxMonth) * 45;
  const bufferScore = Math.max(0, Math.min(35, finalBuffer * 6));
  const savingsScore = player.savings > 0 ? 15 : 0;
  const planPenalty = getDcaPlan()?.status === "redeemed" ? -5 : 0;
  return Math.round(Math.max(0, Math.min(100, monthScore + bufferScore + savingsScore + planPenalty + 5)));
}

function getResultGrade(score) {
  if (score >= 88) return { grade: "S", label: "漂亮通关" };
  if (score >= 72) return { grade: "A", label: "稳住现金流" };
  if (score >= 55) return { grade: "B", label: "有惊无险" };
  if (score >= 35) return { grade: "C", label: "高压生存" };
  return { grade: "D", label: "储备告急" };
}

function getResultType() {
  const finalBuffer = calculateBuffer();
  const dcaPlan = getDcaPlan();
  const incomeHigh = player.baseIncome >= 30000;
  const bufferDrop = player.initialBuffer - finalBuffer;

  if (dcaPlan && ["paused", "redeemed"].includes(dcaPlan.status)) {
    return {
      type: "长期计划被打断型",
      headline: "现金流没撑到长期结果出现",
      summary: "你不是没有做长期计划，而是现金流没有撑到长期计划兑现的那一天。",
      oneLine: "长期选择需要先被现金流保护起来。",
    };
  }

  if (player.lowestSavings <= 0 || player.lowestBuffer < 1) {
    return {
      type: "连续事件压力型",
      headline: "几个普通事件，连续消耗了安全垫",
      summary: "你不是被一次危机击穿的，而是被几个普通事件连续消耗了现金流。",
      oneLine: "现金流储备的意义，是让你在不确定的人生地图上继续往前走。",
    };
  }

  if (incomeHigh && finalBuffer < 3) {
    return {
      type: "高收入低缓冲型",
      headline: "收入不低，但安全垫偏薄",
      summary: "你的收入并不低，但支出和长期承诺占用了太多现金流。高收入不等于高安全垫。",
      oneLine: "真正稳定的不是收入数字，而是留得住的现金流。",
    };
  }

  if (finalBuffer > 6) {
    return {
      type: "储备充足型",
      headline: "你的现金流缓冲比较充分",
      summary: "你的现金流缓冲较充分，面对突发事件时有更多选择空间。",
      oneLine: "储备不是闲置的钱，而是选择空间。",
    };
  }

  if (finalBuffer >= 3 && finalBuffer <= 6) {
    return {
      type: "稳健现金流管理型",
      headline: "你守住了相对稳健的平衡",
      summary: "你在支出、储备和长期计划之间保持了相对稳健的平衡。",
      oneLine: "现金流稳住，人生地图才走得更从容。",
    };
  }

  if (bufferDrop > 1.5) {
    return {
      type: "稳定但弹性不足型",
      headline: "生活看起来稳定，但弹性被压缩",
      summary: "你的生活看起来稳定，但连续事件会迅速压缩现金流弹性。",
      oneLine: "稳定不只是收入稳定，也包括支出可调整。",
    };
  }

  return {
    type: "脆弱缓冲型",
      headline: `你撑过了 ${player.maxMonth} 个月，但空间不多`,
    summary: "你可以应对短期波动，但连续事件会带来明显压力。",
    oneLine: "先把安全垫变厚，再谈更远的计划。",
  };
}

function saveGame() {
  if (!player) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  } catch {
    showToast("当前浏览器无法保存进度。");
  }
}

function loadSavedGame(apply = true) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Number.isFinite(parsed.baseExpense)) {
      clearSavedGame();
      return null;
    }
    if (apply) player = parsed;
    return parsed;
  } catch {
    clearSavedGame();
    return null;
  }
}

function clearSavedGame() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function captureMonthState() {
  return {
    savings: player.savings,
    income: calculateRecurringIncome(),
    expense: calculateRecurringExpense(),
    buffer: calculateBuffer(),
  };
}

function getDcaPlan() {
  return player?.longTermPlans?.find((plan) => plan.id === "index_dca_001");
}

function shouldShowDcaPlanCard(plan) {
  if (!plan || ["sold_all", "redeemed"].includes(plan.status)) return false;
  return getDcaHoldingPrincipal(plan) > 0 || plan.status === "active";
}

function dcaPlanCardTitle(plan) {
  if (plan.status === "paused") return `投资持仓：${plan.name}`;
  return `正在进行的长期计划：${plan.name}`;
}

function getDcaRecoveryMonth() {
  const latest = Math.max(player.currentMonth + 1, player.maxMonth - 1);
  return Math.min(player.currentMonth + randomInt(3, 5), latest);
}

function getDcaOvervaluedMonth() {
  return Math.min(player.currentMonth + randomInt(3, 5), player.maxMonth);
}

function getDcaHoldingPrincipal(plan) {
  if (!plan) return 0;
  if (Number.isFinite(plan.holdingPrincipal)) return Math.max(0, Math.round(plan.holdingPrincipal));
  return Math.max(0, Math.round(plan.totalInvested || 0));
}

function getDcaCurrentReturnRate(plan) {
  if (!plan) return 0;
  if (Number.isFinite(plan.currentReturnRate)) return plan.currentReturnRate;

  const endedMonth = player.endedMonth || player.currentMonth;
  const heldMonths = Math.max(1, endedMonth - (plan.startMonth || 1) + 1);
  const scenarioIndex = Math.abs(Math.round((plan.startMonth || 1) * 17 + heldMonths * 11 + player.initialSavings / 1000)) % 3;
  return [-0.02, 0.06, 0.18][scenarioIndex];
}

function getDcaHoldingValue(plan, returnRate = getDcaCurrentReturnRate(plan)) {
  return Math.max(0, Math.round(getDcaHoldingPrincipal(plan) * (1 + returnRate)));
}

function getDcaMarketState(stage, plan = null) {
  const continueChoice =
    plan?.status === "active"
      ? { id: "hold", label: "继续定投", text: "保持每月投入和当前持仓。" }
      : { id: "hold", label: "继续持有", text: "保持当前持仓。" };

  if (stage === "overvalued") {
    return {
      stage: "overvalued",
      title: "阶段高估",
      description: "市场进入阶段性高估区域。",
      returnRate: 0.18,
      choices: [
        { id: "sell_half", label: "卖出一半", text: "卖出约 50% 持仓，回收现金。" },
        { id: "sell_all", label: "全部卖出", text: "卖出全部持仓，回收现金。" },
        continueChoice,
      ],
    };
  }

  return {
    stage: "recovered",
    title: "估值修复",
    description: "市场从低估区域回到正常估值附近。",
    returnRate: 0.06,
    choices: [
      { id: "sell_half", label: "卖出一半", text: "卖出约 50% 持仓，回收现金。" },
      continueChoice,
      { id: "stop_dca", label: "停止定投", text: "停止后续投入，保留已有持仓。" },
    ],
  };
}

function sellDcaHolding(plan, ratio, returnRate) {
  const holdingPrincipal = getDcaHoldingPrincipal(plan);
  const soldPrincipal = Math.min(holdingPrincipal, Math.round(holdingPrincipal * ratio));
  const soldAmount = Math.max(0, Math.round(soldPrincipal * (1 + returnRate)));

  plan.holdingPrincipal = Math.max(0, holdingPrincipal - soldPrincipal);
  plan.soldPrincipal = (plan.soldPrincipal || 0) + soldPrincipal;
  plan.realizedAmount = (plan.realizedAmount || 0) + soldAmount;
  plan.realizedProfit = (plan.realizedProfit || 0) + soldAmount - soldPrincipal;
  plan.lastSoldAmount = soldAmount;
  player.savings += soldAmount;
  removeDcaMonthlyEffect();

  if (plan.holdingPrincipal <= 0) {
    plan.holdingPrincipal = 0;
    plan.status = "sold_all";
    plan.redeemed = true;
  } else {
    plan.status = "paused";
    plan.pauseCount = (plan.pauseCount || 0) + 1;
  }

  updateLowestSavingsAndBuffer();
  return soldAmount;
}

function getDcaResultLabel(plan) {
  if (plan.status === "sold_all") return "已卖出";
  if (plan.marketStage === "overvalued") return "阶段高估";
  if (plan.marketStage === "recovered") return "估值修复";
  if (plan.status === "paused") return "暂停后持有";
  return "仍在持有";
}

function dcaPlanStatusLine(plan) {
  const parts = [
    `每月投入：${formatMoney(plan.monthlyAmount)}`,
    `累计投入：${formatMoney(plan.totalInvested || 0)}`,
    `当前状态：${planStatusText(plan.status)}`,
  ];

  if ((plan.realizedAmount || 0) > 0) parts.push(`卖出回款：${formatMoney(plan.realizedAmount)}`);
  if ((plan.totalInvested || 0) > 0) parts.push(`阶段收益率：${formatPercent(getDcaCurrentReturnRate(plan))}`);
  return parts.join(" · ");
}

function getProtectionPlan() {
  return player?.longTermPlans?.find((plan) => plan.id === "basic_protection_001" && plan.status === "active");
}

function getAnyProtectionPlan() {
  return player?.longTermPlans?.find((plan) => plan.id === "basic_protection_001");
}

function getTemporaryExpenseEffects() {
  if (!player) return [];
  return player.activeEffects.filter((effect) => {
    if (!["expense", "expense_percent"].includes(effect.target) || effect.amount <= 0) return false;
    if (effect.sourcePlanId) return false;
    return Number.isFinite(effect.remainingMonths) && effect.remainingMonths > 0 && effect.remainingMonths <= 12;
  });
}

function formatEffectMonthlyAmount(effect) {
  if (effect.target === "expense_percent") return formatPercent(effect.amount);
  return formatMoney(effect.amount);
}

function getPendingScheduledStatuses() {
  if (!player) return [];
  return (player.scheduledCards || [])
    .filter((card) => !card.triggered && card.showPendingStatus)
    .map((card) => {
      const remaining = Math.max(1, card.triggerMonth - player.currentMonth);
      if (card.id === "career_course_echo") {
        return {
          title: "职业提升课程",
          meta: `${remaining} 个月后可能出现收入提升机会`,
        };
      }
      if (card.type === "savings_effect") {
        return {
          title: card.title || "后续事件",
          meta: `${remaining} 个月后生效 · 现金储备 ${formatSignedMoney(card.amount || 0)}`,
        };
      }
      const target = card.activeEffect?.target === "expense" ? "常规月支出" : "常规月收入";
      return {
        title: card.title || "待生效影响",
        meta: `${remaining} 个月后生效 · ${target} ${formatSignedMoney(card.activeEffect?.amount || 0)}${durationSuffix(card.activeEffect?.duration || 0)}`,
      };
    });
}

function removeDcaMonthlyEffect() {
  player.activeEffects = player.activeEffects.filter((effect) => effect.sourcePlanId !== "index_dca_001");
}

function removeProtectionMonthlyEffect() {
  player.activeEffects = player.activeEffects.filter((effect) => effect.sourcePlanId !== "basic_protection_001");
}

function applyProtectionToSavingsChange(amount, event) {
  if (amount >= 0) return amount;
  const plan = getProtectionPlan();
  if (!plan || !isProtectionEligibleEvent(event)) return amount;

  const rawReduction = Math.round(Math.abs(amount) * plan.coverageRate);
  const remainingCoverage = Math.max(0, plan.maxReduction - (plan.totalReduced || 0));
  const reduction = Math.min(rawReduction, remainingCoverage);
  if (reduction <= 0) return amount;

  plan.totalReduced = (plan.totalReduced || 0) + reduction;
  player.tempProtectionReduction = (player.tempProtectionReduction || 0) + reduction;
  return amount + reduction;
}

function isProtectionEligibleEvent(event) {
  if (!event) return false;
  const eligibleIds = new Set(["elder_hospital", "insurance_gap", "minor_illness", "dental_cost", "child_fever", "sports_injury"]);
  return event.category === "health_risk" || eligibleIds.has(event.id);
}

function getProtectionPreview(event, effect) {
  const plan = getProtectionPlan();
  if (!plan || !isProtectionEligibleEvent(event)) return null;
  const loss = getSavingsLossFromEffect(effect);
  if (loss <= 0) return null;
  const remainingCoverage = Math.max(0, plan.maxReduction - (plan.totalReduced || 0));
  const reduction = Math.min(Math.round(loss * plan.coverageRate), remainingCoverage);
  if (reduction <= 0) return null;
  return {
    coverageRate: plan.coverageRate,
    reduction,
  };
}

function getSavingsLossFromEffect(effect) {
  if (!effect) return 0;
  if (effect.type === "change_savings") return Math.max(0, -effect.amount);
  if (effect.type === "schedule_savings_effect") return Math.max(0, -effect.amount);
  if (effect.type === "compound") return effect.effects.reduce((sum, item) => sum + getSavingsLossFromEffect(item), 0);
  return 0;
}

function getBuffer(savings, expense) {
  if (expense <= 0) return 999;
  return savings / expense;
}

function getBufferStatus(buffer) {
  if (buffer < 1) return { className: "buffer-stress", text: "高压区" };
  if (buffer < 3) return { className: "buffer-fragile", text: "脆弱区" };
  if (buffer < 6) return { className: "buffer-ok", text: "缓冲区" };
  return { className: "buffer-safe", text: "安全区" };
}

function bufferPill(buffer) {
  const status = getBufferStatus(buffer);
  return `<span class="buffer-pill ${status.className}">安全垫 ${formatBuffer(buffer)} 个月 · ${status.text}</span>`;
}

function effectText(effect) {
  if (!effect) return "无数值变化";
  if (effect.type === "change_savings") return `现金储备 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "change_savings_by_income_percent") return `现金储备 ${formatSignedMoney(player.baseIncome * effect.amount)}`;
  if (effect.type === "one_month_income_change") return `本月临时收入影响 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "one_month_income_percent") return `本月临时收入影响 ${formatPercent(effect.amount)}`;
  if (effect.type === "one_month_expense_change") return `本月临时支出影响 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "one_month_expense_percent") return `本月临时支出影响 ${formatPercent(effect.amount)}`;
  if (effect.type === "add_active_effect") {
    if (effect.target === "expense" && effect.amount < 0) {
      return `常规月支出 ${formatSignedMoney(effect.amount)}${durationSuffix(effect.duration)}`;
    }
    const target = effect.target === "expense" ? "常规月支出" : "常规月收入";
    if (effect.target === "income_percent") return `常规月收入 ${formatPercent(effect.amount)}${durationSuffix(effect.duration)}`;
    if (effect.target === "expense_percent") return `常规月支出 ${formatPercent(effect.amount)}${durationSuffix(effect.duration)}`;
    return `${target} ${formatSignedMoney(effect.amount)}${durationSuffix(effect.duration)}`;
  }
  if (effect.type === "add_uncertain_active_effect") {
    if (effect.target === "income_percent") return `常规月收入 ${formatPercent(effect.amount)}，恢复时间未知`;
    return "一项持续影响，结束时间未知";
  }
  if (effect.type === "schedule_active_effect") {
    const target = effect.target === "expense" ? "常规月支出" : "常规月收入";
    return `${effect.triggerDelay || 1} 个月后，${target} ${formatSignedMoney(effect.amount)}${durationSuffix(effect.duration)}`;
  }
  if (effect.type === "schedule_savings_effect") {
    return `${effect.triggerDelay || 1} 个月后，现金储备 ${formatSignedMoney(effect.amount)}`;
  }
  if (effect.type === "bonus_invest_or_reserve") return bonusInvestOrReserveText(effect);
  if (effect.type === "invest_or_reserve") return investOrReserveText(effect.amount || 0, effect.investPercent || 0.5);
  if (effect.type === "start_dca_plan") return `每月定投支出 +${effect.monthlyAmount} 元`;
  if (effect.type === "start_protection_plan") return `常规月支出 +${effect.monthlyAmount} 元，持续 ${effect.duration} 个月；部分健康风险可减少储备损失`;
  if (effect.type === "career_course_plan") return `现金储备 -${effect.cost} 元`;
  if (effect.type === "buy_car") return "现金储备 -50000 元，月支出 +2500 元";
  if (effect.type === "compound") return effect.effects.map(effectText).join("；");
  return "无数值变化";
}

function durationSuffix(duration) {
  return duration >= 120 ? "" : `，持续 ${duration} 个月`;
}

function choiceEffectLine(effect) {
  const text = choiceEffectText(effect);
  return text || "现金流不变";
}

function choiceEffectText(effect) {
  if (!effect || effect.type === "none") return "现金流不变";
  if (effect.type === "change_savings") return `现金储备 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "change_savings_by_income_percent") return `现金储备 ${formatSignedMoney(player.baseIncome * effect.amount)}`;
  if (effect.type === "one_month_income_change") return `本月收入 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "one_month_income_percent") return `本月收入 ${formatPercent(effect.amount)}`;
  if (effect.type === "one_month_expense_change") return `本月支出 ${formatSignedMoney(effect.amount)}`;
  if (effect.type === "one_month_expense_percent") return `本月支出 ${formatPercent(effect.amount)}`;
  if (effect.type === "add_active_effect") {
    if (effect.target === "income_percent") return `月收入 ${formatPercent(effect.amount)}${durationSuffix(effect.duration)}`;
    if (effect.target === "expense_percent") return `月支出 ${formatPercent(effect.amount)}${durationSuffix(effect.duration)}`;
    const target = effect.target === "expense" ? "月支出" : "月收入";
    return `${target} ${formatSignedMoney(effect.amount)}${durationSuffix(effect.duration)}`;
  }
  if (effect.type === "add_uncertain_active_effect") {
    if (effect.target === "income_percent") return `月收入 ${formatPercent(effect.amount)}，恢复时间未知`;
    return "一项持续影响，结束时间未知";
  }
  if (effect.type === "schedule_active_effect") {
    const target = effect.target === "expense" ? "月支出" : "月收入";
    return `${effect.triggerDelay || 1} 个月后，${target} ${formatSignedMoney(effect.amount)}${durationSuffix(effect.duration)}`;
  }
  if (effect.type === "schedule_savings_effect") return "";
  if (effect.type === "bonus_invest_or_reserve") return bonusInvestOrReserveText(effect);
  if (effect.type === "invest_or_reserve") return investOrReserveText(effect.amount || 0, effect.investPercent || 0.5);
  if (effect.type === "start_dca_plan") return `月支出 +${currencyFormatter.format(effect.monthlyAmount)} 元`;
  if (effect.type === "start_protection_plan") return `月支出 +${currencyFormatter.format(effect.monthlyAmount)} 元，持续 ${effect.duration} 个月`;
  if (effect.type === "career_course_plan") return `现金储备 -${currencyFormatter.format(effect.cost)} 元`;
  if (effect.type === "buy_car") return "现金储备 -50,000 元；月支出 +2,500 元";
  if (effect.type === "compound") {
    const visibleEffects = effect.effects.map(choiceEffectText).filter(Boolean);
    return visibleEffects.length ? visibleEffects.join("；") : "现金流不变";
  }
  return effectText(effect);
}

function choiceEffectTone(effect) {
  if (effect?.type === "compound") {
    const scores = effect.effects.map(getChoiceEffectScore);
    const hasPositive = scores.some((score) => score > 0);
    const hasNegative = scores.some((score) => score < 0);
    if (hasPositive && hasNegative) return "choice-mixed";
  }
  const score = getChoiceEffectScore(effect);
  if (score > 0) return "choice-positive";
  if (score < 0) return "choice-negative";
  return "choice-neutral";
}

function getChoiceEffectScore(effect) {
  if (!effect || effect.type === "none") return 0;
  if (effect.type === "change_savings") return Math.sign(effect.amount || 0);
  if (effect.type === "change_savings_by_income_percent") return Math.sign(effect.amount || 0);
  if (effect.type === "one_month_income_change" || effect.type === "one_month_income_percent") return Math.sign(effect.amount || 0);
  if (effect.type === "one_month_expense_change" || effect.type === "one_month_expense_percent") return -Math.sign(effect.amount || 0);
  if (effect.type === "add_active_effect" || effect.type === "schedule_active_effect") {
    if (effect.target === "expense" || effect.target === "expense_percent") return -Math.sign(effect.amount || 0);
    return Math.sign(effect.amount || 0);
  }
  if (effect.type === "add_uncertain_active_effect") return Math.sign(effect.amount || 0);
  if (effect.type === "schedule_savings_effect") return 0;
  if (effect.type === "bonus_invest_or_reserve") return 1;
  if (effect.type === "invest_or_reserve") return 1;
  if (effect.type === "start_dca_plan" || effect.type === "start_protection_plan" || effect.type === "career_course_plan" || effect.type === "buy_car") return -1;
  if (effect.type === "compound") {
    return effect.effects.reduce((sum, item) => sum + getChoiceEffectScore(item), 0);
  }
  return 0;
}

function bonusInvestOrReserveText(effect) {
  const bonusAmount = Math.round(player.baseIncome);
  return investOrReserveText(bonusAmount, effect.investPercent || 0.5);
}

function investOrReserveText(amount, investPercent = 0.5) {
  const plan = getDcaPlan();
  if (plan && plan.status === "active") {
    const investAmount = Math.round(amount * investPercent);
    const reserveAmount = amount - investAmount;
    return `定投加码 ${formatMoney(investAmount)}；现金储备 +${currencyFormatter.format(reserveAmount)} 元`;
  }
  return `现金储备 +${currencyFormatter.format(amount)} 元`;
}

function applyInvestOrReserve(amount, investPercent = 0.5) {
  const totalAmount = Math.round(amount || 0);
  const plan = getDcaPlan();
  const canInvest = plan && plan.status === "active";

  if (!canInvest) {
    player.savings += totalAmount;
    return;
  }

  const investAmount = Math.round(totalAmount * investPercent);
  const reserveAmount = totalAmount - investAmount;
  plan.totalInvested = (plan.totalInvested || 0) + investAmount;
  plan.holdingPrincipal = getDcaHoldingPrincipal(plan) + investAmount;
  player.savings += reserveAmount;
}

function planStatusText(status) {
  if (status === "active") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "redeemed") return "已赎回";
  if (status === "sold_all") return "已卖出";
  if (status === "expired") return "已到期";
  return "未开始";
}

function formatMoney(value) {
  const prefix = value < 0 ? "-" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(Math.round(value || 0)))} 元`;
}

function formatSignedMoney(value) {
  const rounded = Math.round(value || 0);
  if (rounded > 0) return `+${currencyFormatter.format(rounded)} 元`;
  if (rounded < 0) return `-${currencyFormatter.format(Math.abs(rounded))} 元`;
  return "0 元";
}

function formatBuffer(value) {
  if (!Number.isFinite(value)) return "999.0";
  return Math.max(-99, value).toFixed(1);
}

function formatSignedBuffer(value) {
  const rounded = Number.isFinite(value) ? value : 0;
  if (Math.abs(rounded) < 0.05) return "基本持平";
  const prefix = rounded > 0 ? "增加" : "减少";
  return `${prefix} ${Math.abs(rounded).toFixed(1)} 个月`;
}

function formatPercent(value) {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openModal(html) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(backdrop);
}

function closeModal() {
  document.querySelectorAll(".modal-backdrop").forEach((node) => node.remove());
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function validateCustomForm(form) {
  const income = Number(form.income.value);
  const expense = Number(form.expense.value);
  const savings = Number(form.savings.value);
  const maxMonth = Number(form.maxMonth.value);
  const error = document.getElementById("formError");

  if (!form.income.value || !form.expense.value || !form.savings.value) {
    error.textContent = "请填写月收入、月支出和现金储备。";
    return null;
  }

  if (!Number.isFinite(income) || income < 0) {
    error.textContent = "月收入必须大于等于 0。";
    return null;
  }

  if (!Number.isFinite(expense) || expense <= 0) {
    error.textContent = "月支出必须大于 0。";
    return null;
  }

  if (!Number.isFinite(savings) || savings < 0) {
    error.textContent = "当前现金储备必须大于等于 0。";
    return null;
  }

  error.textContent = "";
  return {
    id: "custom",
    name: "自定义角色",
    income,
    expense,
    savings,
    maxMonth,
  };
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;

  if (action === "home") {
    savedGameAvailable = Boolean(loadSavedGame(false));
    player = null;
    renderHome();
  }

  if (action === "random") {
    trackEvent("cash_game_identity_rerolled", {
      // 记录：玩家重新抽身份，用于观察身份卡是否让用户反复重抽。
      from_screen: player ? "game_or_result" : "home",
    });
    renderRandomIdentity();
  }

  if (action === "set-length") {
    selectedMaxMonth = Number(target.dataset.months) || selectedMaxMonth;
    trackEvent("cash_game_challenge_length_selected", {
      // 记录：玩家选择挑战长度，用于判断 12/24/36 个月哪个更常用。
      challenge_length: selectedMaxMonth,
    });
    const currentIdentityId = document.querySelector("[data-action='start-random']")?.dataset.id;
    const identity = identityCards.find((item) => item.id === currentIdentityId);
    if (identity) renderRandomIdentity(identity);
  }

  if (action === "custom") {
    trackEvent("cash_game_custom_identity_opened", {
      // 记录：玩家打开自定义身份表单，用于判断是否有人想输入自己的情况。
      from_screen: "home",
    });
    renderCustomIdentity();
  }

  if (action === "start-random") {
    const identity = identityCards.find((item) => item.id === target.dataset.id);
    if (identity) startGame(identity, selectedMaxMonth);
  }

  if (action === "continue") {
    if (loadSavedGame(true)) {
      lastDice = null;
      trackEvent("cash_game_resumed", {
        // 记录：玩家继续上次游戏，用于观察存档入口是否有用。
        month: player.currentMonth,
        challenge_length: player.maxMonth,
      });
      renderGamePage("已继续上次游戏。");
    } else {
      savedGameAvailable = false;
      renderHome();
    }
  }

  if (action === "restart") {
    trackEvent("cash_game_restarted", {
      // 记录：玩家重新开始，用于观察中途放弃或结果页重玩的情况。
      from_month: player?.currentMonth || null,
      had_active_game: Boolean(player && !player.gameEnded),
    });
    clearSavedGame();
    savedGameAvailable = false;
    player = null;
    lastDice = null;
    pendingMonthlySummary = null;
    closeModal();
    renderHome();
  }

  if (action === "roll") rollDice();

  if (action === "confirm-event") confirmEvent(target.dataset.eventId);

  if (action === "choose-event") confirmEvent(target.dataset.eventId, target.dataset.choiceIndex);

  if (action === "end-month") endMonth();

  if (action === "history") renderHistory();

  if (action === "end-now") endGameNow();

  if (action === "close-modal") closeModal();

  if (action === "dca-market-choice") handleDcaMarketChoice(target.dataset.choice, target.dataset.stage);
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "customForm") return;
  event.preventDefault();
  const identity = validateCustomForm(event.target);
  if (identity) startGame(identity, identity.maxMonth);
});

init();
