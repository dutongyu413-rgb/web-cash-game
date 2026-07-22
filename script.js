const STORAGE_KEY = "cashflowLifeMapGame";
const app = document.getElementById("app");
const toast = document.getElementById("toast");
const TRACKING_PROJECT = "cash_game";
const TRACKING_SCRIPT_SRC = "https://cloud.umami.is/script.js";
const ONBOARDING_STORAGE_KEY = "cashflowLifeMapOnboardingV2";
const APP_VERSION = "0.4.13-internal";
const GAME_STATE_VERSION = window.CashGameCore?.GAME_STATE_VERSION || 3;
const debugParams = new URLSearchParams(window.location.search);
const debugMode = debugParams.get("debug") === "1" || debugParams.has("seed");
const DEFAULT_CHALLENGE_LENGTH = 24;

let player = null;
let savedGameAvailable = false;
let lastDice = null;
let pendingMonthlySummary = null;
let selectedMaxMonth = DEFAULT_CHALLENGE_LENGTH;
let mapMotion = null;
let pendingTrackingEvents = [];
let activeMarketQuoteTracking = null;
let debugRandomState = window.CashGameCore.normalizeSeed(debugParams.get("seed") || "cash-game-debug");
let debugSeedText = debugParams.get("seed") || "cash-game-debug";
const debugEventParam = debugParams.get("event") || null;
let debugForcedMarketQuote = debugParams.get("market") === "1" || debugEventParam === "index_dca_choice";
let debugForcedEventId = debugEventParam === "index_dca_choice" ? null : debugEventParam;
let onboardingStep = 0;
let onboardingManual = false;
let eventRevealTimer = null;
let gameVisualAssetsPreloaded = false;
const preloadedGameVisualImages = [];

const gameVisualAssets = [
  { primary: "assets/life-map-paper.webp", fallback: "assets/life-map-paper.png" },
  { primary: "assets/life-map-player.webp", fallback: "assets/life-map-player.png" },
];

const challengeLengths = [12, 24, 36];
const challengeLengthNames = {
  12: "短局",
  24: "标准局",
  36: "长局",
};
const investmentTiming = window.CashGameCore.INVESTMENT_TIMING;
if (debugMode && challengeLengths.includes(Number(debugParams.get("months")))) {
  selectedMaxMonth = Number(debugParams.get("months"));
}

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

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
    app_version: APP_VERSION,
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

function trackingDurationBand(startedAt) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - Number(startedAt || Date.now())) / 1000));
  return window.CashGameCore.getViewDurationBand(elapsedSeconds);
}

function investmentResultStatus(result) {
  if (!result) return "not_started";
  if (result.holdingPrincipal > 0 && result.realizedAmount > 0) return "partially_sold";
  if (result.holdingPrincipal > 0) return "holding";
  if (result.realizedAmount > 0) return "sold_all";
  return "started_without_investment";
}

function renderHome() {
  app.innerHTML = `
    <section class="screen home-poster-screen">
      <div class="home-poster-wrap">
        <picture class="home-poster-media">
          <source
            type="image/webp"
            srcset="assets/home-poster-480.webp 480w, assets/home-poster-768.webp 768w, assets/home-poster-941.webp 941w"
            sizes="(max-width: 430px) 100vw, 430px"
          />
          <img class="home-poster" src="assets/home-poster.jpg" width="941" height="1672" loading="eager" decoding="async" fetchpriority="high" alt="36 个月现金流生存挑战游戏海报，展示人生地图、身份卡牌、事件卡牌、骰子和安全垫。" />
        </picture>
        <button class="poster-start-hotspot" data-action="start-game" aria-label="开始游戏"></button>
      </div>
      <span class="home-version">v${escapeHtml(APP_VERSION.replace("-internal", ""))} · 内测版</span>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。</p>
    </section>
  `;

  const poster = app.querySelector(".home-poster");
  const schedulePreload = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(preloadGameVisuals, { timeout: 1200 });
    } else {
      window.setTimeout(preloadGameVisuals, 180);
    }
  };
  if (poster?.complete) schedulePreload();
  else poster?.addEventListener("load", schedulePreload, { once: true });
}

function preloadGameVisuals() {
  if (gameVisualAssetsPreloaded) return;
  gameVisualAssetsPreloaded = true;

  gameVisualAssets.forEach(({ primary, fallback }) => {
    const image = new Image();
    image.decoding = "async";
    image.onerror = () => {
      const fallbackImage = new Image();
      fallbackImage.decoding = "async";
      fallbackImage.src = fallback;
      preloadedGameVisualImages.push(fallbackImage);
    };
    image.src = primary;
    preloadedGameVisualImages.push(image);
  });
}

function renderRandomIdentity(identity = randomItem(identityCards)) {
  app.innerHTML = `
    <section class="screen">
      <div class="page-head">
        <div class="page-head-row">
          <h1 class="page-title">抽到的身份</h1>
          <button class="button ghost small" data-action="home">返回</button>
        </div>
        <p class="identity-prompt">选定身份与挑战长度</p>
      </div>
      ${identityCardHtml(identity)}
      ${challengeLengthHtml()}
      <div class="actions">
        <button class="button primary" data-action="start-random" data-id="${identity.id}">使用这个身份开始游戏</button>
        <button class="button secondary" data-action="random">再抽一次</button>
        <button class="button ghost" data-action="custom">自定义</button>
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

function renderCustomIdentity(initialValues = null) {
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
          <input id="income" name="income" inputmode="numeric" placeholder="例如 18000" value="${initialValues ? Math.round(initialValues.income || 0) : ""}" />
        </div>
        <div class="field">
          <label for="expense">月支出</label>
          <input id="expense" name="expense" inputmode="numeric" placeholder="例如 13000" value="${initialValues ? Math.round(initialValues.expense || 0) : ""}" />
        </div>
        <div class="field">
          <label for="savings">当前现金储备</label>
          <input id="savings" name="savings" inputmode="numeric" placeholder="例如 40000" value="${initialValues ? Math.round(initialValues.savings || 0) : ""}" />
        </div>
        <div class="field">
          <label for="maxMonth">挑战长度</label>
          <select id="maxMonth" name="maxMonth">
            ${challengeLengths
              .map(
                (months) =>
                  `<option value="${months}" ${months === selectedMaxMonth ? "selected" : ""}>${challengeLengthNames[months]}（${months}个月）</option>`,
              )
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
                <strong>${challengeLengthNames[months]}</strong>
                <small>（${months}个月）</small>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderGamePage(message = "", options = {}) {
  if (!player) {
    renderHome();
    return;
  }

  const currentIncome = calculateRecurringIncome();
  const currentExpense = calculateRecurringExpense();
  const buffer = calculateBuffer();
  const bufferStatus = getBufferStatus(buffer);
  const monthProgress = Math.round((player.currentMonth / player.maxMonth) * 100);
  const reserveChange = pendingMonthlySummary?.savingsDelta || 0;
  const reserveChangeClass = reserveChange > 0 ? "is-rising" : reserveChange < 0 ? "is-falling" : "";
  const currentStatuses = getCurrentGameStatuses();
  const hasCurrentStatuses = currentStatuses.length > 0;
  const currentMapPoint = getJourneyPoint(0);
  const moveBannerHtml = mapMotion
    ? `
      <div class="move-banner">
        <span class="move-dice">${lastDice}</span>
        <strong>前进 ${lastDice} 步</strong>
      </div>
    `
    : "";
  app.innerHTML = `
    <section class="screen game-screen ${hasCurrentStatuses ? "has-current-status" : ""}">
      <div class="status-bar">
        <div class="hud-progress-row">
          <div class="hud-month">
            <span class="hud-label">当前进度</span>
            <strong>第 ${player.currentMonth} / ${player.maxMonth} 个月</strong>
          </div>
          <div class="hud-tools">
            ${debugMode ? `<button class="debug-mode-button" data-action="debug-panel" aria-label="打开内部测试面板">TEST</button>` : ""}
            <button class="hud-menu-button" data-action="game-menu" aria-label="更多选项" title="更多选项"><span aria-hidden="true">•••</span></button>
          </div>
        </div>
        <div class="progress-track" aria-label="挑战进度"><i style="width:${monthProgress}%"></i></div>
        <div class="hud-core">
          <div class="hud-reserve ${reserveChangeClass}">
            <span>现金储备</span>
            <strong>${formatMoney(player.savings)}</strong>
          </div>
          <div class="hud-buffer">
            <div><span>安全垫</span><strong>${formatBuffer(buffer)} 个月</strong></div>
            <div class="hud-buffer-status"><span>${bufferStatus.text}</span></div>
            <div class="meter-track"><i class="${bufferStatus.className}" style="width:${getShieldPercent(buffer)}%"></i></div>
          </div>
        </div>
        <div class="hud-cashflow">
          <div><span>月收入</span><strong>${formatMoney(currentIncome)}</strong></div>
          <i aria-hidden="true"></i>
          <div><span>月支出</span><strong>${formatMoney(currentExpense)}</strong></div>
        </div>
      </div>
      <div class="map-panel">
        <div class="map-title">
          <div>
            <span>${escapeHtml(player.identityName)}的人生地图</span>
          </div>
        </div>
        <div class="journey-map map-canvas ${mapMotion ? "is-moving" : ""}" style="${mapMotion ? `--drift-x:${mapMotion.driftX}px; --drift-y:${mapMotion.driftY}px;` : ""}">
          <picture class="life-map-background-media" aria-hidden="true">
            <source type="image/webp" srcset="assets/life-map-paper.webp" />
            <img class="life-map-background" src="assets/life-map-paper.png" width="744" height="760" alt="" decoding="async" fetchpriority="high" />
          </picture>
          ${marketMisterButtonHtml()}
          ${moveBannerHtml}
          <div class="map-card-stack" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </div>
          <div class="journey-world">
            <svg class="life-map-path-layer" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
              <path class="map-path-shadow" d="M -80 470 C 120 430, 220 510, 370 400 S 610 250, 760 350 S 930 380, 1080 250" />
              <path class="map-path-main" d="M -80 470 C 120 430, 220 510, 370 400 S 610 250, 760 350 S 930 380, 1080 250" />
              <path class="map-path-dashed" d="M -80 470 C 120 430, 220 510, 370 400 S 610 250, 760 350 S 930 380, 1080 250" />
            </svg>
            ${journeyNodesHtml()}
          </div>
          <div class="player-token" style="--player-x:${currentMapPoint.x}%; --player-y:${currentMapPoint.y}%;" aria-label="当前位置">
            <b class="player-month-label">第 ${player.currentMonth} 个月</b>
            <picture class="player-token-media" aria-hidden="true">
              <source type="image/webp" srcset="assets/life-map-player.webp" />
              <img src="assets/life-map-player.png" width="180" height="225" alt="" decoding="async" fetchpriority="high" />
            </picture>
          </div>
        </div>
      </div>
      <div class="game-control-deck ${hasCurrentStatuses ? "has-current-status" : ""}">
        ${currentStatusSummaryHtml(currentStatuses)}
        <div class="bottom-bar game-actions">
          <button class="button primary roll-button ${getCompletedMonths() === 0 && !lastDice ? "is-ready" : ""}" data-action="roll" ${player.gameEnded || mapMotion ? "disabled" : ""}>
            <span class="dice-face">${lastDice || "?"}</span>
            掷骰前进
          </button>
          <button class="button secondary history-button" data-action="history">人生日志</button>
        </div>
      </div>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。</p>
    </section>
  `;

}

function rollDice() {
  if (!player || player.gameEnded) return;
  lastDice = randomInt(1, 3);
  trackEvent("cash_game_dice_rolled", {
    // 记录：玩家掷骰前进，用于判断玩家是否真正进入游玩循环。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    first_roll_seconds:
      getCompletedMonths() === 0 && player.startedAt ? Math.max(0, Math.round((Date.now() - player.startedAt) / 1000)) : null,
  });
  const currentPoint = getJourneyPoint(0);
  const previousPoint = getJourneyPoint(-lastDice);
  mapMotion = {
    driftX: (previousPoint.x - currentPoint.x) * 3.12,
    driftY: (previousPoint.y - currentPoint.y) * 3.48,
  };
  player.position = (player.position + lastDice) % mapCells.length;
  const event = getEventForCurrentPosition();
  renderGamePage(`你掷出了 ${lastDice} 点，地图正在向前滑动。`);
  window.setTimeout(() => {
    mapMotion = null;
    renderGamePage(`你停在新的节点上，事件即将揭晓。`, { skipEcho: true });
    window.setTimeout(() => revealEventCard(event), 120);
  }, 760);
}

function revealEventCard(event) {
  if (!event) return;
  if (prefersReducedMotion()) {
    showEventCard(event);
    return;
  }
  openModal(`
    <div class="event-reveal-card ${categoryClass(event.category)}" aria-label="事件卡揭晓中">
      <div class="event-reveal-line"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="event-reveal-mark">?</div>
    </div>
  `, "event-reveal-backdrop");
  window.clearTimeout(eventRevealTimer);
  eventRevealTimer = window.setTimeout(() => showEventCard(event), 320);
}

function maybeStartOnboarding() {
  if (debugMode || hasSeenOnboarding()) return;
  startOnboarding(false);
}

function startOnboarding(manual = false) {
  onboardingStep = 0;
  onboardingManual = manual;
  closeModal();
  renderOnboarding();
  trackEvent("cash_game_onboarding_shown", {
    source: manual ? "game_menu" : "first_game",
    challenge_length: player?.maxMonth || selectedMaxMonth,
  });
}

function renderOnboarding() {
  document.querySelectorAll(".onboarding-backdrop").forEach((node) => node.remove());
  const steps = [
    {
      label: "挑战目标",
      title: `完成 ${player?.maxMonth || selectedMaxMonth} 个月`,
      text: "现金储备保持在 0 元以上",
      visual: `<div class="guide-route" aria-hidden="true"><i></i><i></i><i></i><i></i><span></span></div>`,
    },
    {
      label: "每个月",
      title: "掷骰前进",
      text: "停下后处理一张事件卡",
      visual: `<div class="guide-dice" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>`,
    },
    {
      label: "本局关键",
      title: "现金储备",
      text: "低于 0 元，本局结束",
      visual: `<div class="guide-reserve" aria-hidden="true"><strong>¥</strong><span><i></i></span></div>`,
    },
  ];
  const step = steps[onboardingStep];
  const isLast = onboardingStep === steps.length - 1;
  const backdrop = document.createElement("div");
  backdrop.className = "onboarding-backdrop";
  backdrop.innerHTML = `
    <section class="onboarding-card" role="dialog" aria-modal="true" aria-label="玩法引导">
      <div class="onboarding-progress" aria-label="第 ${onboardingStep + 1} 步，共 ${steps.length} 步">
        ${steps.map((_, index) => `<i class="${index <= onboardingStep ? "active" : ""}"></i>`).join("")}
      </div>
      <div class="onboarding-visual">${step.visual}</div>
      <span class="onboarding-label">${escapeHtml(step.label)}</span>
      <h2>${escapeHtml(step.title)}</h2>
      <p>${escapeHtml(step.text)}</p>
      <div class="onboarding-actions">
        <button class="button ghost small" data-action="skip-onboarding">${onboardingManual ? "关闭" : "跳过"}</button>
        <button class="button primary" data-action="next-onboarding">${isLast ? (onboardingManual ? "回到游戏" : "开始前进") : "下一步"}</button>
      </div>
    </section>
  `;
  document.body.appendChild(backdrop);
}

function nextOnboardingStep() {
  if (onboardingStep < 2) {
    onboardingStep += 1;
    renderOnboarding();
    return;
  }
  finishOnboarding("completed");
}

function finishOnboarding(outcome) {
  document.querySelectorAll(".onboarding-backdrop").forEach((node) => node.remove());
  if (!onboardingManual) markOnboardingSeen();
  trackEvent(outcome === "completed" ? "cash_game_onboarding_completed" : "cash_game_onboarding_skipped", {
    step: onboardingStep + 1,
    source: onboardingManual ? "game_menu" : "first_game",
  });
  onboardingManual = false;
}

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "seen";
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "seen");
  } catch {
    // The guide can still run when storage is unavailable.
  }
}

function renderGameMenu() {
  openModal(`
    <div class="game-menu-sheet">
      <div class="menu-sheet-head">
        <span>第 ${player.currentMonth} / ${player.maxMonth} 个月</span>
        <h2>本局菜单</h2>
      </div>
      <div class="menu-list">
        <button data-action="show-rules"><strong>玩法说明</strong><span>重新查看三步引导</span></button>
        ${debugMode ? `<button data-action="debug-panel"><strong>内部测试面板</strong><span>${APP_VERSION} · 固定事件与导出诊断</span></button>` : ""}
        <button data-action="end-now"><strong>结束本局</strong><span>生成当前阶段结果</span></button>
        <button class="is-danger" data-action="request-restart"><strong>重新开始</strong><span>放弃当前进度</span></button>
      </div>
      <div class="modal-actions"><button class="button secondary" data-action="close-modal">关闭</button></div>
    </div>
  `);
}

function renderDebugPanel() {
  if (!debugMode || !player) return;
  const currentEvent = debugForcedEventId ? eventCards.find((event) => event.id === debugForcedEventId) : null;
  const eventOptions = [...eventCards]
    .sort((first, second) => first.title.localeCompare(second.title, "zh-CN"))
    .map(
      (event) =>
        `<option value="${escapeHtml(event.id)}" ${event.id === debugForcedEventId ? "selected" : ""}>${escapeHtml(event.title)} · ${escapeHtml(categoryLabel(event.category))}</option>`,
    )
    .join("");

  openModal(`
    <div class="debug-panel">
      <div class="debug-panel-head">
        <span>INTERNAL TEST · ${APP_VERSION}</span>
        <h2>内部测试面板</h2>
        <p>这些设置只影响当前浏览器中的测试局，不会改变正式玩家的随机规则。</p>
      </div>
      <div class="debug-state-summary">
        <div><span>身份</span><strong>${escapeHtml(player.identityName)}</strong></div>
        <div><span>当前状态</span><strong>第 ${player.currentMonth} 月 · ${formatBuffer(calculateBuffer())} 个月</strong></div>
      </div>
      <form class="debug-form" id="debugStateForm">
        <label>随机种子<input name="seed" value="${escapeHtml(debugSeedText)}" autocomplete="off" /></label>
        <div class="debug-field-row">
          <label>当前月份<input name="month" type="number" min="1" max="${player.maxMonth}" value="${player.currentMonth}" /></label>
          <label>现金储备<input name="savings" type="number" step="100" value="${Math.round(player.savings)}" /></label>
        </div>
        <button class="button secondary" type="submit">应用测试状态</button>
      </form>
      <form class="debug-form" id="debugEventForm">
        <label>指定下一张卡<select name="eventId">${eventOptions}</select></label>
        <button class="button primary" type="submit">设置并返回地图</button>
        ${currentEvent ? `<small>已指定：${escapeHtml(currentEvent.title)}。下一次掷骰时触发。</small>` : ""}
      </form>
      <div class="debug-tools">
        <button class="button ghost" data-action="debug-market">下月触发市场先生</button>
        <button class="button ghost" data-action="debug-copy">复制测试诊断</button>
        <button class="button ghost" data-action="debug-reset-onboarding">重置新手引导</button>
      </div>
      <p class="debug-privacy">诊断信息保存在剪贴板中，不会自动上传；自定义身份的具体金额会被隐藏。</p>
      <div class="modal-actions"><button class="button secondary" data-action="close-modal">关闭</button></div>
    </div>
  `);
}

function getDebugDiagnostic() {
  if (!player) return null;
  const customIdentity = player.identityId === "custom" || player.identityName === "自定义角色";
  return {
    appVersion: APP_VERSION,
    stateVersion: GAME_STATE_VERSION,
    capturedAt: new Date().toISOString(),
    seed: debugSeedText,
    randomState: player.randomState ?? debugRandomState,
    forcedEventId: debugForcedEventId,
    forcedMarketQuote: debugForcedMarketQuote,
    identity: { id: player.identityId, name: player.identityName },
    challenge: {
      currentMonth: player.currentMonth,
      completedMonths: getCompletedMonths(),
      maxMonth: player.maxMonth,
      careerEventMonth: player.careerEventMonth || null,
      gameEnded: Boolean(player.gameEnded),
      endReason: player.endReason || null,
    },
    finances: customIdentity
      ? { hidden: true, bufferBand: bufferBand(calculateBuffer()) }
      : {
          savings: Math.round(player.savings),
          recurringIncome: calculateRecurringIncome(),
          recurringExpense: calculateRecurringExpense(),
          buffer: Number(formatBuffer(calculateBuffer())),
        },
    activeEffects: (player.activeEffects || []).map((effect) => ({
      name: effect.name || null,
      target: effect.target,
      amount: effect.amount,
      remainingMonths: effect.remainingMonths,
      sourceEventId: effect.sourceEventId || null,
      sourcePlanId: effect.sourcePlanId || null,
    })),
    plans: (player.longTermPlans || []).map((plan) => ({
      id: plan.id,
      status: plan.status,
      startMonth: plan.startMonth,
      remainingMonths: plan.remainingMonths ?? null,
    })),
    investment: player.investment
      ? {
          status: player.investment.status,
          holdingStatus: getInvestmentHoldingStatus(player.investment),
          dcaStatus: getInvestmentDcaStatus(player.investment),
          entryMode: player.investment.entryMode || null,
          nav: Number(player.investment.nav || 0),
          shares: Number(player.investment.shares || 0),
          holdingPrincipal: Math.round(player.investment.holdingPrincipal || 0),
          totalInvested: Math.round(player.investment.totalInvested || 0),
          monthlyDcaAmount: Math.round(player.investment.monthlyDcaAmount || 0),
        }
      : null,
    recentDraws: (player.eventDrawHistory || []).slice(-12),
    recentHistory: (player.history || []).slice(-8).map((item) => ({
      month: item.month,
      eventTitle: item.eventTitle,
      choice: item.choice || null,
      entryType: item.entryType || "event",
    })),
    pendingScheduledCards: (player.scheduledCards || [])
      .filter((card) => !card.triggered)
      .map((card) => ({ id: card.id, triggerMonth: card.triggerMonth, type: card.type || "follow_up" })),
  };
}

function copyDebugDiagnostic() {
  const diagnostic = getDebugDiagnostic();
  if (!diagnostic) return;
  const text = JSON.stringify(diagnostic, null, 2);
  const copyFallback = () => {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
    showToast("测试诊断已复制。");
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("测试诊断已复制。"), copyFallback);
    return;
  }
  copyFallback();
}

function resetDebugOnboarding() {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    showToast("新手引导已重置，下次新开局会再次展示。");
  } catch {
    showToast("当前浏览器无法重置引导。");
  }
}

function requestRestart() {
  openModal(`
    <h2>重新开始？</h2>
    <p>当前 ${getCompletedMonths()} 个月的进度将被清除。</p>
    <div class="modal-actions">
      <button class="button secondary" data-action="close-modal">保留进度</button>
      <button class="button danger" data-action="confirm-restart">清除并重新开始</button>
    </div>
  `);
}

function restartGame() {
  trackEvent("cash_game_restarted", {
    from_month: player?.currentMonth || null,
    had_active_game: Boolean(player && !player.gameEnded),
  });
  clearSavedGame();
  savedGameAvailable = false;
  player = null;
  lastDice = null;
  pendingMonthlySummary = null;
  document.querySelectorAll(".onboarding-backdrop").forEach((node) => node.remove());
  closeModal();
  renderHome();
}

function showEventCard(event) {
  if (!event) return;
  const isChoice = Array.isArray(event.choices);
  if (!isChoice) {
    confirmEvent(event.id);
    return;
  }
  const protectionPreview = getProtectionPreview(event, event.effect);
  openModal(`
    <div class="event-modal-card ${categoryClass(event.category)}">
      <div class="event-draw-strip">
        <span>抽到事件</span>
        <strong>第 ${player.currentMonth} 个月</strong>
      </div>
      <div class="event-card-head ${categoryClass(event.category)}">
        <span>${escapeHtml(event.eventLabel || categoryLabel(event.category))}</span>
        <i>${escapeHtml(event.eventMark || categoryMark(event.category))}</i>
      </div>
      <div class="event-card-body">
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.description)}</p>
        ${
          protectionPreview
            ? `
              <div class="protection-preview">
                <strong>基础保障生效</strong>
                <div class="protection-preview-metrics">
                  <span>原支出<b>${formatMoney(protectionPreview.originalLoss)}</b></span>
                  <span>保障减少<b>-${formatMoney(protectionPreview.reduction)}</b></span>
                  <span>实际支出<b>${formatMoney(protectionPreview.actualLoss)}</b></span>
                </div>
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
                        ${choice.hideImpact ? "" : `<span class="choice-impact">${escapeHtml(choiceEffectLine(choice.effect))}</span>`}
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
  `, "choice-event-backdrop");
}

function confirmEvent(eventId, choiceIndex = null) {
  const event = eventCards.find((item) => item.id === eventId);
  if (!event) return;
  const choice = choiceIndex === null ? null : event.choices[Number(choiceIndex)];
  const effect = choice ? choice.effect : event.effect;
  const before = captureMonthState();

  applyEffect(effect, event);
  const wellbeingImpact = applyChoiceWellbeingCost(choice, event);
  const afterEffect = captureMonthState();
  pendingMonthlySummary = buildMonthlySummary(event, choice, before, afterEffect);
  pendingMonthlySummary.wellbeingCost = wellbeingImpact?.cost || 0;
  pendingMonthlySummary.wellbeingReason = wellbeingImpact?.reason || "";
  player.pendingMonthlySummary = pendingMonthlySummary;
  recordEventDraw(event.id);
  trackEvent("cash_game_card_resolved", {
    // 记录：玩家处理了一张事件卡，用于分析哪些卡牌和选择被触发。
    event_id: event.id,
    event_category: event.category,
    has_choice: Boolean(choice),
    choice_index: choice ? Number(choiceIndex) : null,
    wellbeing_cost: wellbeingImpact?.cost || 0,
    month: player.currentMonth,
  });
  saveGame();
  closeModal();
  updateTurnCue("事件影响已确认");
  if (shouldShowDetailedSettlement(pendingMonthlySummary)) {
    showMonthlySummary();
    return;
  }
  endMonth({ quick: true });
}

function shouldShowDetailedSettlement(summary) {
  if (!summary) return false;
  return summary.savingsAfterMonth < 0;
}

function updateTurnCue(message) {
  const cue = document.querySelector(".turn-cue");
  if (cue) cue.textContent = message;
}

function showMonthlySummary() {
  if (!pendingMonthlySummary) return;
  const summary = pendingMonthlySummary;
  const settlementClass = summary.bufferAfterMonth >= summary.bufferBefore ? "is-up" : "is-down";
  const verdict = getSettlementVerdict(summary);
  const detailRows = [
    summary.tempIncomeDelta ? ["临时收入影响", formatSignedMoney(summary.tempIncomeDelta), ""] : null,
    summary.tempExpenseDelta ? ["临时支出影响", formatSignedMoney(summary.tempExpenseDelta), ""] : null,
    summary.reserveDelta ? ["一次性储备变动", formatSignedMoney(summary.reserveDelta), ""] : null,
    summary.investmentContribution ? ["投资投入", formatSignedMoney(-summary.investmentContribution), ""] : null,
    summary.investmentContributionSkipped ? ["本月定投", `现金不足，未投入 ${formatMoney(summary.investmentContributionSkipped)}`, ""] : null,
  ].filter(Boolean);
  const protectionActualLoss = Math.max(0, -(summary.reserveDelta || 0));
  const protectionOriginalLoss = protectionActualLoss + (summary.protectionReduction || 0);
  const canRescueCash = summary.savingsAfterMonth < 0 && getCashRescueOptions(summary.savingsAfterMonth).eligible;
  const continueLabel = canRescueCash
    ? "处理现金缺口"
    : player.currentMonth >= player.maxMonth || summary.savingsAfterMonth < 0
      ? "查看本局结果"
      : "继续前进";
  const detailRowsHtml = detailRows.length
    ? `
      <div class="settlement-details">
        ${detailRows.map(([label, value, className]) => `<div class="detail-row ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
      </div>
    `
    : "";
  openModal(`
    <div class="settlement-card ${settlementClass}">
      <div class="settlement-head">
        <h2>本月结算</h2>
        <span class="round-badge">${escapeHtml(summary.roundLabel)}</span>
        <p>${escapeHtml(summary.eventTitle)}${summary.choiceLabel ? ` · 选择「${escapeHtml(summary.choiceLabel)}」` : ""}</p>
      </div>
      <div class="settlement-verdict ${verdict.className}">
        <span>本月状态</span>
        <strong>${escapeHtml(verdict.title)}</strong>
      </div>
      <div class="settlement-core">
        <div class="settlement-main-card cashflow-card">
          <span>本月现金流</span>
          <strong>${formatSignedMoney(summary.monthlyNetCashflow)}</strong>
          <small>${summary.monthlyNetCashflow >= 0 ? "净流入" : "净流出"}</small>
        </div>
        <div class="settlement-main-card savings-card">
          <span>现金储备</span>
          <strong>${formatMoney(summary.savingsAfterMonth)}</strong>
          <small>本月 ${formatSignedMoney(summary.savingsDelta)}</small>
          <div class="settlement-buffer-line"><span>安全垫</span><strong>${formatBuffer(summary.bufferBefore)} → ${formatBuffer(summary.bufferAfterMonth)} 个月</strong></div>
        </div>
      </div>
      ${
        summary.protectionReduction
          ? `
            <div class="settlement-special protection-hit">
              <span>基础保障生效</span>
              <div class="protection-impact-metrics">
                <div><small>原支出</small><strong>${formatMoney(protectionOriginalLoss)}</strong></div>
                <div><small>保障减少</small><strong>-${formatMoney(summary.protectionReduction)}</strong></div>
                <div><small>实际支出</small><strong>${formatMoney(protectionActualLoss)}</strong></div>
              </div>
            </div>
          `
          : ""
      }
      ${detailRowsHtml}
    </div>
    <div class="modal-actions">
      <button class="button primary" data-action="end-month">${continueLabel}</button>
    </div>
  `);
  animateSettlementCard();
}

function requestEndGame() {
  if (!player) return;
  const completedMonths = getCompletedMonths();
  openModal(`
    <h2>结束本局？</h2>
    <p>你已经完成 ${completedMonths} / ${player.maxMonth} 个月。结束后将生成阶段结果，本局不能继续。</p>
    <div class="modal-actions">
      <button class="button secondary" data-action="close-modal">继续游戏</button>
      <button class="button danger" data-action="confirm-end-now">结束并查看结果</button>
    </div>
  `);
}

function endGameNow() {
  if (!player) return;
  trackEvent("cash_game_report_requested", {
    // 记录：玩家主动查看报告，用于判断是否有人提前结束并查看结果。
    month: getCompletedMonths(),
    challenge_length: player.maxMonth,
  });
  player.gameEnded = true;
  player.endReason = "manual";
  player.endedMonth = getCompletedMonths();
  player.pendingTransition = null;
  player.pendingEchoes = [];
  saveGame();
  closeModal();
  renderResultPage();
}

function endMonth(options = {}) {
  if (!pendingMonthlySummary) return;
  const settledSummary = pendingMonthlySummary;
  recordActualMonthStress(settledSummary);
  player.savings = settledSummary.savingsAfterMonth;
  settledSummary.savingsAfterSettlement = player.savings;
  settledSummary.bufferAfterSettlement = settledSummary.bufferAfterMonth;
  processLongTermPlans();
  const recoveryMessages = processActiveEffects();
  player.recoveryMessages = recoveryMessages;
  settledSummary.savingsAfterMonth = player.savings;
  settledSummary.savingsDelta = player.savings - settledSummary.savingsBefore;
  settledSummary.bufferAfterMonth = calculateBuffer();
  settledSummary.bufferDelta = settledSummary.bufferAfterMonth - settledSummary.bufferBefore;
  const quickFeedback = options.quick ? createQuickFeedback(settledSummary) : null;
  const scheduledEchoes = processScheduledCards();
  updateLowestSavingsAndBuffer();
  settledSummary.followUps = scheduledEchoes.map((echo) => ({
    id: echo.id,
    title: echo.title,
    effectLine: echo.effectLine,
    savingsDelta: echo.savingsDelta || 0,
  }));
  settledSummary.savingsAfterMonth = player.savings;
  settledSummary.savingsDelta = player.savings - settledSummary.savingsBefore;
  settledSummary.bufferAfterMonth = calculateBuffer();
  settledSummary.bufferDelta = settledSummary.bufferAfterMonth - settledSummary.bufferBefore;
  player.completedMonths = player.currentMonth;
  addMonthlySnapshot(settledSummary, scheduledEchoes);
  advanceMarketToMonth(player.currentMonth);
  player.tempIncomeChange = 0;
  player.tempIncomePercent = 0;
  player.tempExpenseChange = 0;
  player.tempExpensePercent = 0;
  player.tempProtectionReduction = 0;
  pendingMonthlySummary = null;
  player.pendingMonthlySummary = null;
  trackEvent("cash_game_month_settled", {
    // 记录：玩家完成一次月度结算，用于观察实际推进到第几个月。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    round_label: settledSummary.roundLabel,
    buffer_band_after: bufferBand(settledSummary.bufferAfterMonth),
  });

  player.pendingEchoes = scheduledEchoes;
  const endReason = player.savings < 0 ? "cash_broken" : player.currentMonth >= player.maxMonth ? "completed" : null;
  const cashRescue = endReason === "cash_broken" ? createPendingCashRescue() : null;
  if (endReason === "cash_broken" && cashRescue?.hasHolding && !cashRescue.eligible) {
    recordUnavailableCashRescue(cashRescue);
  }
  const marketQuoteSource = getMarketQuoteTrigger(endReason);
  player.pendingTransition = {
    endReason,
    nextMonth: player.currentMonth + 1,
    recoveryMessages,
    quickFeedback,
    cashRescue: cashRescue?.eligible ? cashRescue : null,
    marketQuoteDue: Boolean(marketQuoteSource),
    marketQuoteSource,
    marketQuoteHandled: false,
  };
  saveGame();
  closeModal();
  if (player.pendingTransition.quickFeedback) {
    window.setTimeout(() => showTurnFeedback(player.pendingTransition.quickFeedback, { continueTransition: true }), 120);
    return;
  }
  if (player.pendingEchoes.length) {
    window.setTimeout(showNextScheduledEcho, 250);
    return;
  }
  showPendingMarketQuoteOrFinish();
}

function renderHistory() {
  trackEvent("cash_game_history_opened", {
    // 记录：玩家打开人生日志，用于判断历史回放是否有人使用。
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    from_screen: player.gameEnded ? "result" : "game",
  });
  const history = Array.isArray(player.history) ? player.history : [];
  const rows = history.length
    ? history.map((item) => historyRowHtml(item)).join("")
    : `<div class="empty-state">还没有历史事件。掷一次骰子，人生地图就会开始记录。</div>`;

  openModal(`
    <div class="history-modal">
      <div class="history-modal-head">
        <div>
          <span>本局回顾</span>
          <h2>人生日志</h2>
        </div>
        <strong>${history.length} 条记录</strong>
      </div>
      <div class="history-list">${rows}</div>
      <div class="modal-actions history-modal-actions">
        <button class="button secondary" data-action="close-modal">关闭</button>
      </div>
    </div>
  `, "history-backdrop");
}

function historyRowHtml(item, compact = false) {
  return `
    <div class="history-row ${compact ? "is-compact" : ""} ${getHistoryTone(item)}">
      <span class="history-dot"></span>
      <div class="history-main">
        <strong>第 ${item.month} 个月 · ${escapeHtml(item.eventTitle)}</strong>
        <span>${escapeHtml(getHistorySummary(item))}</span>
      </div>
      <div class="history-meta">
        ${formatMoney(item.savingsAfter)}<br>${formatBuffer(item.bufferAfter)} 个月
      </div>
    </div>
  `;
}

function resultHistoryHtml() {
  const history = Array.isArray(player.history) ? player.history : [];
  if (!history.length) return "";
  const preview = history.slice(-3).map((item) => historyRowHtml(item, true)).join("");
  return `
    <section class="result-history-card" aria-labelledby="result-history-title">
      <div class="result-history-head">
        <div>
          <span>本局回顾</span>
          <h2 id="result-history-title">人生日志</h2>
        </div>
        <button type="button" data-action="history">查看全部 ${history.length} 条</button>
      </div>
      <div class="result-history-preview">${preview}</div>
    </section>
  `;
}

function renderResultPage() {
  if (!player) return;
  const result = getResultType();
  const score = getSurvivalScore();
  const grade = player.endReason === "manual" ? { grade: "阶段", label: "阶段记录" } : getResultGrade(score);
  const finalBuffer = calculateBuffer();
  const biggestStressTitle = player.biggestStressEvent?.title || "暂无";
  const biggestStressAmount = player.biggestStressEvent?.stress || 0;
  const protectionResult = getProtectionResult();
  const dcaResult = getDcaResult();
  const careerResult = getCareerCourseResult();
  const wellbeingPenalty = getWellbeingPenalty();
  const investmentStatus = investmentResultStatus(dcaResult);
  const investmentReturnBand = dcaResult
    ? window.CashGameCore.getInvestmentReturnBand(dcaResult.returnRate)
    : "not_started";
  const rankLabel = player.endReason === "manual" ? "记录" : "等级";
  const resultTrackingEvent =
    player.endReason === "cash_broken"
      ? "cash_game_failed"
      : player.endReason === "manual"
        ? "cash_game_ended_manually"
        : "cash_game_completed";
  trackEvent(resultTrackingEvent, {
    // 记录：一局游戏结束。只上传结果类型和安全垫区间，不上传具体分数或金额。
    end_reason: player.endReason || "completed",
    ended_month: getCompletedMonths(),
    challenge_length: player.maxMonth,
    result_type: result.type,
    grade: grade.grade,
    final_buffer_band: bufferBand(finalBuffer),
    lowest_buffer_band: bufferBand(player.lowestBuffer),
    had_protection: Boolean(getAnyProtectionPlan()),
    had_dca: Boolean(getDcaPlan()),
    investment_status: investmentStatus,
    investment_return_band: investmentReturnBand,
  });
  trackEvent("cash_game_investment_result", {
    end_reason: player.endReason || "completed",
    challenge_length: player.maxMonth,
    investment_status: investmentStatus,
    investment_return_band: investmentReturnBand,
    dca_status: getDcaPlan() ? getInvestmentDcaStatus(getDcaPlan()) : "not_started",
  });
  clearSavedGame();
  savedGameAvailable = false;
  app.innerHTML = `
    <section class="screen result-screen">
      <div class="result-hero">
        <div class="result-rank">
          <strong>${escapeHtml(grade.grade)}</strong>
          <span>${rankLabel}</span>
        </div>
        <div class="result-score-copy">
          <span class="result-identity">本局身份 <strong>${escapeHtml(player.identityName)}</strong></span>
          <span class="result-type">${escapeHtml(result.type)}</span>
          <div class="result-score-line">
            <h1>${score}<small>生存分</small></h1>
            <button class="result-score-info" data-action="score-info" aria-label="查看生存分说明" title="查看生存分说明">?</button>
          </div>
          <p>${escapeHtml(result.summary)}</p>
          <small class="result-score-rule">完成进度 + 财务状态 - 生活体验${wellbeingPenalty ? ` · 本局扣 ${wellbeingPenalty} 分` : ""}</small>
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
      ${resultHistoryHtml()}
      <div class="actions result-actions">
        <button class="button primary" data-action="feedback">提交试玩反馈</button>
        <button class="button secondary" data-action="replay-identity">用当前身份再玩</button>
        <button class="button ghost" data-action="random">换个身份</button>
        <button class="result-home-link" data-action="restart">返回首页</button>
      </div>
      <p class="disclaimer">本游戏仅用于现金流管理和投资者教育场景下的模拟体验，不构成任何投资建议或收益承诺。游戏中的收入、支出、市场表现和事件结果均为简化模拟。</p>
    </section>
  `;
}

function showScoreInfo() {
  const breakdown = getSurvivalScoreBreakdown();
  const wellbeingPenalty = breakdown.wellbeingPenalty;
  const wellbeingRows = (player.wellbeingLedger || [])
    .slice(-4)
    .reverse()
    .map(
      (item) => `
        <div class="score-life-row">
          <span>第 ${item.month} 个月 · ${escapeHtml(item.choiceLabel)}</span>
          <strong>-${item.cost} 分</strong>
          <small>${escapeHtml(item.reason)}</small>
        </div>
      `,
    )
    .join("");
  openModal(`
    <div class="score-info-modal">
      <h2>生存分怎么计算</h2>
      <div class="score-rule-list">
        <div><span>完成进度</span><strong>${breakdown.monthScore} / 45 分</strong></div>
        <div><span>最终安全垫</span><strong>${breakdown.finalBufferScore} / 20 分</strong></div>
        <div><span>安全垫管理</span><strong>${breakdown.bufferManagementScore} / 15 分</strong></div>
        <div><span>现金储备为正</span><strong>${breakdown.savingsScore} / 15 分</strong></div>
        <div><span>基础分</span><strong>${breakdown.baseScore} 分</strong></div>
        <div class="is-cost"><span>生活体验</span><strong>${wellbeingPenalty ? `-${wellbeingPenalty}` : "0"} 分</strong></div>
      </div>
      <div class="score-buffer-note">
        <strong>安全垫 ${formatBuffer(breakdown.initialBuffer)} → ${formatBuffer(breakdown.finalBuffer)} 个月</strong>
        <span>最终安全垫每1个月得4分，最高20分。管理分以开局保持不变的10分为基准，每提高1个月约加2.5分，每下降1个月约减2.5分。</span>
      </div>
      <p>生活体验扣分来自明确压缩休息、持续降低生活安排或承担高强度工作的选择，单局最多扣 20 分。它不代表消费越多越好。</p>
      ${wellbeingRows ? `<div class="score-life-list">${wellbeingRows}</div>` : `<p class="score-empty">本局没有记录明显影响生活体验的选择。</p>`}
      <div class="modal-actions"><button class="button secondary" data-action="close-modal">关闭</button></div>
    </div>
  `);
}

function replayCurrentIdentity() {
  if (!player) return;
  selectedMaxMonth = player.maxMonth;
  const presetIdentity = identityCards.find((identity) => identity.id === player.identityId);
  if (presetIdentity) {
    renderRandomIdentity(presetIdentity);
    return;
  }
  renderCustomIdentity({
    income: player.baseIncome,
    expense: player.baseExpense,
    savings: player.initialSavings,
  });
}

function getFeedbackContext() {
  const score = getSurvivalScore();
  const grade = player.endReason === "manual" ? "阶段" : getResultGrade(score).grade;
  return {
    version: APP_VERSION,
    identity: player.identityId || "custom",
    identityName: player.identityName || "自定义身份",
    challengeLength: player.maxMonth,
    completedMonths: getCompletedMonths(),
    endReason: player.endReason || "completed",
    grade,
    score,
    wellbeingPenalty: getWellbeingPenalty(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

function openFeedbackEntry() {
  if (!player) return;
  const configuredUrl = String(window.CASH_GAME_FEEDBACK_URL || "").trim();
  const context = getFeedbackContext();
  trackEvent("cash_game_feedback_opened", {
    identity_id: context.identity,
    challenge_length: context.challengeLength,
    completed_months: context.completedMonths,
  });
  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl, window.location.href);
      url.searchParams.set("version", context.version);
      url.searchParams.set("identity", context.identity);
      url.searchParams.set("months", String(context.challengeLength));
      url.searchParams.set("completed", String(context.completedMonths));
      url.searchParams.set("end", context.endReason);
      url.searchParams.set("grade", context.grade);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      return;
    } catch {
      // 配置错误时回退到本地反馈表，不中断结果页。
    }
  }

  openModal(`
    <div class="feedback-modal">
      <h2>提交试玩反馈</h2>
      <p>填写后会调用手机分享；不支持分享时自动复制，方便发送给测试负责人。</p>
      <form id="feedbackForm" class="feedback-form">
        <label>这局体验怎么样？
          <select name="rating" required>
            <option value="">请选择</option>
            <option value="5">5分 · 很想再玩</option>
            <option value="4">4分 · 整体不错</option>
            <option value="3">3分 · 可以玩完</option>
            <option value="2">2分 · 有些无聊</option>
            <option value="1">1分 · 很想退出</option>
          </select>
        </label>
        <label>最需要改进的地方
          <select name="issue" required>
            <option value="">请选择</option>
            <option>操作重复</option>
            <option>文字太多</option>
            <option>规则难懂</option>
            <option>卡牌或数值不合理</option>
            <option>页面或按钮问题</option>
            <option>暂时没有明显问题</option>
          </select>
        </label>
        <label>补充说明
          <textarea name="comment" maxlength="300" rows="4" placeholder="哪一刻想退出？哪个选择让你犹豫？"></textarea>
        </label>
        <div class="modal-actions">
          <button class="button secondary" type="button" data-action="close-modal">取消</button>
          <button class="button primary" type="submit">发送反馈</button>
        </div>
      </form>
    </div>
  `);
}

function buildFeedbackText(formData) {
  const context = getFeedbackContext();
  const comment = String(formData.get("comment") || "").trim() || "无";
  return [
    "现金流生存游戏试玩反馈",
    `体验评分：${formData.get("rating")}/5`,
    `优先问题：${formData.get("issue")}`,
    `补充说明：${comment}`,
    "",
    `版本：${context.version}`,
    `身份：${context.identityName}`,
    `挑战：${context.completedMonths}/${context.challengeLength}个月`,
    `结果：${context.grade} · 生存分${context.score}`,
    `结束方式：${context.endReason}`,
    `屏幕：${context.viewport}`,
  ].join("\n");
}

async function submitLocalFeedback(form) {
  const data = new FormData(form);
  const text = buildFeedbackText(data);
  trackEvent("cash_game_feedback_prepared", {
    rating: Number(data.get("rating")) || null,
    issue: String(data.get("issue") || "unknown"),
    challenge_length: player.maxMonth,
  });
  if (navigator.share) {
    try {
      await navigator.share({ title: "现金流生存游戏试玩反馈", text });
      closeModal();
      showToast("感谢反馈。");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyTextToClipboard(text);
  closeModal();
  showToast("反馈内容已复制，请发送给测试负责人。");
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => copyTextWithTextarea(text));
  }
  return copyTextWithTextarea(text);
}

function copyTextWithTextarea(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

function resultJourneyHtml(finalBuffer) {
  const endedMonth = getCompletedMonths();
  const endStatus = getEndStatus();
  return `
    <div class="result-card result-journey-card">
      <div class="section-title">
        <span>进程与安全垫轨迹</span>
        <strong>${escapeHtml(endStatus.label)} · ${endedMonth} / ${player.maxMonth} 个月 · 最终安全垫 ${formatBuffer(finalBuffer)} 个月</strong>
      </div>
      ${resultBufferCurveHtml(finalBuffer)}
    </div>
  `;
}

function resultBufferCurveHtml(finalBuffer) {
  const buffers = window.CashGameCore.getCurveBuffers(player.initialBuffer, player.monthlySnapshots, finalBuffer);
  const points = getResultCurvePoints(buffers);
  const path = getSmoothCurvePath(points);
  const areaPath = `${path} L ${points[points.length - 1].x} 104 L ${points[0].x} 104 Z`;
  const lowestIndex = buffers.indexOf(Math.min(...buffers));
  const labelIndexes = [...new Set([0, lowestIndex, points.length - 1])];
  const labels = [
    { label: "开局", buffer: player.initialBuffer, savings: player.initialSavings, point: points[0] },
    {
      label: "最低点",
      buffer: buffers[lowestIndex],
      savings: lowestIndex === 0 ? player.initialSavings : player.monthlySnapshots[lowestIndex - 1]?.savingsAfterMonth,
      point: points[lowestIndex],
    },
    { label: "结算", buffer: buffers[buffers.length - 1], savings: player.savings, point: points[points.length - 1] },
  ];

  return `
    <div class="buffer-curve">
      <svg viewBox="0 0 300 112" role="img" aria-label="安全垫曲线">
        <path class="curve-grid" d="M 24 28 H 276 M 24 56 H 276 M 24 84 H 276" />
        <path class="curve-area" d="${areaPath}" />
        <path class="curve-line" d="${path}" />
        ${points
          .map(
            (point, index) => `
              <g class="curve-point point-${labelIndexes.includes(index) ? labelIndexes.indexOf(index) : "minor"}">
                <circle cx="${point.x}" cy="${point.y}" r="${labelIndexes.includes(index) ? 5 : 2.5}" />
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
  return finite.map((value, index) => ({
    x: finite.length === 1 ? 150 : 28 + (index / (finite.length - 1)) * 244,
    y: Math.round(92 - ((value - min) / range) * 64),
  }));
}

function getSmoothCurvePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const controlOffset = (point.x - previous.x) / 2;
    return `${path} C ${previous.x + controlOffset} ${previous.y}, ${point.x - controlOffset} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
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
  const endingMonth = Math.max(Number(plan.startMonth) || 1, getCompletedMonths());
  const priceHistory = window.CashGameCore.getInvestmentPriceSeries(plan.priceHistory, {
    startMonth: plan.startMonth,
    endMonth: endingMonth,
    endingNav: plan.nav,
  });
  const actions = window.CashGameCore.summarizeInvestmentActions(plan.actionHistory);
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
      nav: Number(plan.nav) || 3,
      priceHistory,
      actions,
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
    nav: Number(plan.nav) || 3,
    priceHistory,
    actions,
    summary: summaryParts.join("，") + "。",
  };
}

function resultDcaHtml(result) {
  const metrics = getDcaResultMetrics(result);
  const actionPreview = getInvestmentActionPreview(result.actions);
  return `
    <div class="result-special-card dca-result-card">
      <h2>投资日志</h2>
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
      ${investmentNavCurveHtml(result)}
      ${
        actionPreview.length
          ? `
            <div class="investment-action-section">
              <div class="investment-action-head">
                <strong>投资操作</strong>
                ${
                  result.actions.length > actionPreview.length
                    ? `<button type="button" data-action="investment-history">查看全部 ${result.actions.length} 条</button>`
                    : `<span>${result.actions.length} 条记录</span>`
                }
              </div>
              <div class="investment-action-list">
                ${actionPreview.map(investmentActionRowHtml).join("")}
              </div>
            </div>
          `
          : ""
      }
      <p>累计投入 ${formatMoney(result.invested)}。${escapeHtml(result.summary)}</p>
    </div>
  `;
}

function investmentNavCurveHtml(result) {
  const history = Array.isArray(result.priceHistory) ? result.priceHistory : [];
  if (!history.length) return "";
  const points = getInvestmentCurvePoints(history);
  const path = getSmoothCurvePath(points);
  const areaPath = `${path} L ${points[points.length - 1].x} 102 L ${points[0].x} 102 Z`;
  const lowest = history.reduce((current, item) => (item.nav < current.nav ? item : current), history[0]);
  const highest = history.reduce((current, item) => (item.nav > current.nav ? item : current), history[0]);
  const entry = history[0];
  const ending = history[history.length - 1];

  return `
    <div class="investment-curve">
      <div class="investment-curve-head">
        <strong>基金净值轨迹</strong>
        <span>第 ${entry.month}–${ending.month} 个月</span>
      </div>
      <svg viewBox="0 0 300 112" role="img" aria-label="宽基指数基金净值轨迹">
        <path class="investment-curve-grid" d="M 24 28 H 276 M 24 58 H 276 M 24 88 H 276" />
        <path class="investment-curve-area" d="${areaPath}" />
        <path class="investment-curve-line" d="${path}" />
        ${points
          .map(
            (point, index) => `
              <circle class="investment-curve-point ${index === points.length - 1 ? "is-current" : ""}" cx="${point.x}" cy="${point.y}" r="${index === points.length - 1 ? 5 : 3.5}" />
            `,
          )
          .join("")}
      </svg>
      <div class="investment-curve-labels">
        <div><span>入场</span><strong>${entry.nav.toFixed(2)}</strong><small>第 ${entry.month} 月</small></div>
        <div><span>区间低点</span><strong>${lowest.nav.toFixed(2)}</strong><small>第 ${lowest.month} 月</small></div>
        <div><span>区间高点</span><strong>${highest.nav.toFixed(2)}</strong><small>第 ${highest.month} 月</small></div>
        <div><span>结算</span><strong>${ending.nav.toFixed(2)}</strong><small>第 ${ending.month} 月</small></div>
      </div>
    </div>
  `;
}

function getInvestmentCurvePoints(history) {
  const months = history.map((item) => item.month);
  const navs = history.map((item) => item.nav);
  const minMonth = Math.min(...months);
  const maxMonth = Math.max(...months);
  const minNav = Math.min(...navs);
  const maxNav = Math.max(...navs);
  const monthRange = Math.max(1, maxMonth - minMonth);
  const navRange = Math.max(0.35, maxNav - minNav);
  return history.map((item, index) => ({
    x: history.length === 1 ? 150 : 28 + ((item.month - minMonth) / monthRange) * 244,
    y: history.length === 1 ? 60 : Math.round(90 - ((item.nav - minNav) / navRange) * 62),
    index,
  }));
}

function getInvestmentActionPreview(actions) {
  if (!Array.isArray(actions) || actions.length <= 4) return Array.isArray(actions) ? actions : [];
  return [actions[0], ...actions.slice(-3)];
}

function investmentActionRowHtml(item) {
  const copy = getInvestmentActionCopy(item);
  const monthLabel = item.endMonth && item.endMonth !== item.month
    ? `第 ${item.month}–${item.endMonth} 月`
    : `第 ${item.month} 月`;
  return `
    <div class="investment-action-row">
      <span>${monthLabel}</span>
      <div>
        <strong>${escapeHtml(copy.label)}</strong>
        <small>${escapeHtml(copy.detail)}</small>
      </div>
    </div>
  `;
}

function getInvestmentActionCopy(item) {
  const navText = Number.isFinite(item.nav) ? ` · 净值 ${item.nav.toFixed(2)}` : "";
  if (item.action === "initial_buy") return { label: "一次性买入", detail: `投入 ${formatMoney(item.amount)}${navText}` };
  if (item.action === "start_dca") return { label: "开始定投", detail: `每月 ${formatMoney(item.amount)}` };
  if (item.action === "monthly_dca_summary") {
    return { label: "定投执行", detail: `共 ${item.count} 次 · 累计投入 ${formatMoney(item.amount)}` };
  }
  if (item.action === "add_once") return { label: "追加买入", detail: `投入 ${formatMoney(item.amount)}${navText}` };
  if (item.action === "pause_dca") return { label: "暂停定投", detail: `保留当前持仓${navText}` };
  if (item.action === "dca_skipped_cash") return { label: "定投自动暂停", detail: `本月未投入 ${formatMoney(item.amount)}${navText}` };
  if (item.action === "resume_dca") return { label: "恢复定投", detail: `恢复每月投入${navText}` };
  if (item.action === "hold_summary") return { label: "继续持有", detail: `共选择 ${item.count} 次` };
  if (["sell_half", "sell_all"].includes(item.action)) {
    const profit = (item.amount || 0) - (item.principal || 0);
    const profitText = profit >= 0 ? `盈利 ${formatMoney(profit)}` : `亏损 ${formatMoney(Math.abs(profit))}`;
    return {
      label: item.action === "sell_all" ? "全部卖出" : "卖出一半",
      detail: `回款 ${formatMoney(item.amount)} · ${profitText}${navText}`,
    };
  }
  if (["emergency_sell_partial", "emergency_sell_all"].includes(item.action)) {
    const profit = (item.amount || 0) - (item.principal || 0);
    const profitText = profit >= 0 ? `盈利 ${formatMoney(profit)}` : `亏损 ${formatMoney(Math.abs(profit))}`;
    return {
      label: item.action === "emergency_sell_all" ? "应急全部卖出" : "应急卖出部分",
      detail: `回款 ${formatMoney(item.amount)} · ${profitText}${navText}`,
    };
  }
  return { label: "投资操作", detail: navText ? navText.slice(3) : "本次操作已记录" };
}

function renderInvestmentHistory() {
  const result = getDcaResult();
  if (!result?.actions?.length) return;
  openModal(`
    <div class="history-modal investment-history-modal">
      <div class="history-modal-head">
        <div>
          <span>本局投资</span>
          <h2>投资操作记录</h2>
        </div>
        <strong>${result.actions.length} 条记录</strong>
      </div>
      <div class="investment-history-list">
        ${result.actions.map(investmentActionRowHtml).join("")}
      </div>
      <div class="modal-actions history-modal-actions">
        <button class="button secondary" data-action="close-modal">关闭</button>
      </div>
    </div>
  `, "history-backdrop");
}

function getDcaResultMetrics(result) {
  const metrics = [
    {
      label: "期末净值",
      value: `${Number(result.nav || 3).toFixed(2)} 元`,
    },
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
    const endedMonth = getCompletedMonths();
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

function renderMarketQuote(quoteSource = "manual_map") {
  const market = ensureMarketState();
  syncInvestmentWithMarket();
  const plan = getDcaPlan();
  const hasHolding = plan && getInvestmentHoldingStatus(plan) !== "sold_all" && getDcaHoldingPrincipal(plan) > 0;
  const stage = marketTrendStage(market.trend);
  const state = getDcaMarketState(stage, hasHolding ? plan : null);
  const alreadyTraded = market.tradedMonth === player.currentMonth;
  const dcaStatus = hasHolding ? getInvestmentDcaStatus(plan) : "never_started";
  const accountMetrics = hasHolding
    ? [
        { label: "持仓市值", value: formatMoney(getDcaHoldingValue(plan)) },
        { label: "阶段收益率", value: formatPercent(getDcaCurrentReturnRate(plan)) },
        { label: "累计投入", value: formatMoney(plan.totalInvested || 0) },
        dcaStatus === "active"
          ? { label: "每月定投", value: formatMoney(plan.monthlyDcaAmount || plan.monthlyAmount || 0) }
          : { label: "定投状态", value: dcaStatus === "paused" ? "已暂停" : "未开启" },
      ]
    : [];
  const choices = hasHolding
    ? state.choices
    : [
        { id: "buy_once", label: "一次性买入", text: `从现金储备取出 ${formatMoney(6000)} 买入。` },
        { id: "begin_dca", label: "每月定投", text: `从本月起每月投入 ${formatMoney(2000)}。` },
        { id: "skip", label: "暂不参与", text: "这次不买入。" },
      ];

  market.lastViewedMonth = player.currentMonth;
  openModal(
    marketQuoteHtml({
      subtitle: market.fundName,
      currentNav: `${market.nav.toFixed(2)} 元`,
      trendLabel: marketTrendLabel(market.trend),
      accountStatus: hasHolding ? investmentPlanStatusText(plan) : "当前未持有这只基金",
      accountMetrics,
      notice: alreadyTraded ? "本月已经完成一次投资操作，下个月可以再次交易。" : "",
      choicesHtml: alreadyTraded
        ? ""
        : choices
            .map(
              (choice) => `
                <button class="choice-button" data-action="market-quote-choice" data-choice="${choice.id}">
                  <strong>${escapeHtml(choice.label)}</strong>
                  <span>${escapeHtml(choice.text)}</span>
                </button>
              `,
            )
            .join(""),
    }),
    "investment-quote-backdrop",
  );
  activeMarketQuoteTracking = {
    source: quoteSource,
    startedAt: Date.now(),
    hadHolding: Boolean(hasHolding),
    dcaStatus,
    alreadyTraded,
    marketTrend: market.trend,
  };
  trackEvent("cash_game_market_quote_viewed", {
    quote_source: quoteSource,
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    market_trend: market.trend,
    holding_status: hasHolding ? "holding" : "no_holding",
    dca_status: dcaStatus,
    already_traded: alreadyTraded,
  });
}

function marketQuoteHtml({ subtitle, currentNav, trendLabel, accountStatus, accountMetrics, choicesHtml, notice = "" }) {
  return `
    <div class="market-quote-card">
      <div class="market-quote-head">
        <div class="market-quote-title-row">
          <h2>市场先生报价</h2>
          <span>第 ${player.currentMonth} 个月</span>
        </div>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="market-quote-market">
        <span>当前净值</span>
        <strong>${escapeHtml(currentNav)}</strong>
        <small>最近走势 <b>${escapeHtml(trendLabel)}</b></small>
      </div>
      <div class="market-quote-scroll">
        <section class="market-account ${accountMetrics.length ? "has-holding" : "is-empty"}">
          <div class="market-account-head">
            <strong>我的持仓</strong>
            <span>${escapeHtml(accountStatus)}</span>
          </div>
          ${accountMetrics.length
            ? `
              <div class="market-account-grid">
                ${accountMetrics
                  .map(
                    (metric) => `
                      <div>
                        <span>${escapeHtml(metric.label)}</span>
                        <strong>${escapeHtml(metric.value)}</strong>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `<p>还没有买入记录，本次报价可用于决定是否开始。</p>`}
        </section>
        ${notice ? `<div class="market-quote-notice">${escapeHtml(notice)}</div>` : ""}
        ${choicesHtml
          ? `
            <section class="market-quote-actions">
              <h3>本月操作</h3>
              <div class="choice-list market-quote-choices">${choicesHtml}</div>
            </section>
          `
          : ""}
      </div>
      <div class="market-quote-footer"><button class="button secondary" data-action="close-market-quote">关闭报价</button></div>
    </div>
  `;
}

function handleMarketQuoteChoice(choice) {
  const market = ensureMarketState();
  if (market.tradedMonth === player.currentMonth) return;
  let plan = getDcaPlan();
  const stage = marketTrendStage(market.trend);
  const holdingBefore = getDcaHoldingPrincipal(plan);

  if (choice === "buy_once") startInvestmentPlan({ initialAmount: 6000 });
  if (choice === "begin_dca") startInvestmentPlan({ monthlyAmount: 2000, initialAmount: 2000 });
  plan = getDcaPlan();

  if (!plan && choice !== "skip") return;
  const state = getDcaMarketState(stage, plan);

  if (choice === "sell_half") {
    sellDcaHolding(plan, 0.5, stage);
    plan.lastAction = `${state.stage}_sell_half`;
  }

  if (choice === "sell_all") {
    sellDcaHolding(plan, 1, state.stage);
    plan.lastAction = `${state.stage}_sell_all`;
  }

  if (choice === "add_once") {
    const amount = 4000;
    player.savings -= amount;
    recordInvestmentPurchase(plan, amount, "add_once", { stage: state.stage });
    plan.lastAction = `${state.stage}_add_once`;
    updateLowestSavingsAndBuffer();
  }

  if (choice === "hold" && plan) {
    plan.lastAction = `${state.stage}_hold`;
    plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
    plan.actionHistory.push({ month: player.currentMonth, action: "hold", nav: plan.nav, stage: state.stage });
  }

  if (choice === "pause_dca" && plan) {
    plan.dcaStatus = "paused";
    plan.pauseCount = (plan.pauseCount || 0) + 1;
    plan.lastAction = `${state.stage}_pause_dca`;
    plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
    plan.actionHistory.push({ month: player.currentMonth, action: "pause_dca", nav: plan.nav, stage: state.stage });
    removeDcaMonthlyEffect();
  }

  if (choice === "resume_dca" && plan) {
    plan.dcaStatus = "active";
    plan.monthlyDcaAmount = Math.max(1, Number(plan.monthlyDcaAmount || plan.monthlyAmount) || 2000);
    plan.monthlyAmount = plan.monthlyDcaAmount;
    plan.lastAction = `${state.stage}_resume_dca`;
    plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
    plan.actionHistory.push({ month: player.currentMonth, action: "resume_dca", nav: plan.nav, stage: state.stage });
  }

  if (choice === "start_dca" && plan) {
    plan.dcaStatus = "active";
    plan.monthlyDcaAmount = Math.max(1, Number(plan.monthlyDcaAmount || plan.monthlyAmount) || 2000);
    plan.monthlyAmount = plan.monthlyDcaAmount;
    plan.lastAction = `${state.stage}_start_dca`;
    plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
    plan.actionHistory.push({
      month: player.currentMonth,
      action: "start_dca",
      amount: plan.monthlyDcaAmount,
      nav: plan.nav,
      stage: state.stage,
    });
  }

  if (plan) syncInvestmentLegacyStatus(plan);
  market.tradedMonth = player.currentMonth;
  market.lastQuoteMonth = player.currentMonth;
  market.previousQuoteNav = market.nav;
  trackEvent("cash_game_investment_choice_made", {
    // 记录：玩家在市场先生报价中的投资选择。
    market_stage: state.stage,
    choice_type: choice,
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    quote_source: activeMarketQuoteTracking?.source || "unknown",
    holding_status_before: activeMarketQuoteTracking?.hadHolding ? "holding" : "no_holding",
    dca_status_before: activeMarketQuoteTracking?.dcaStatus || "unknown",
    view_duration_band: trackingDurationBand(activeMarketQuoteTracking?.startedAt),
  });
  if ((choice === "sell_half" || choice === "sell_all") && plan) {
    trackEvent("cash_game_investment_sold", {
      // 记录：玩家发生卖出行为，只记录卖出类型，不上传卖出金额。
      market_stage: state.stage,
      sell_type: choice,
      sold_all: getDcaHoldingPrincipal(plan) <= 0,
      holding_before_band: holdingBefore > 0 ? "has_holding" : "no_holding",
    });
  }
  syncLatestSnapshotAfterMarketAction();
  saveGame();
  activeMarketQuoteTracking = null;
  closeModal();
  continueAfterMarketQuote("投资状态已更新。");
}

function closeMarketQuote() {
  const market = ensureMarketState();
  market.lastQuoteMonth = player.currentMonth;
  market.previousQuoteNav = market.nav;
  trackEvent("cash_game_market_quote_closed", {
    quote_source: activeMarketQuoteTracking?.source || "unknown",
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    market_trend: activeMarketQuoteTracking?.marketTrend || market.trend,
    holding_status: activeMarketQuoteTracking?.hadHolding ? "holding" : "no_holding",
    dca_status: activeMarketQuoteTracking?.dcaStatus || "unknown",
    already_traded: Boolean(activeMarketQuoteTracking?.alreadyTraded),
    view_duration_band: trackingDurationBand(activeMarketQuoteTracking?.startedAt),
  });
  activeMarketQuoteTracking = null;
  saveGame();
  closeModal();
  continueAfterMarketQuote();
}

function continueAfterMarketQuote(message = "") {
  if (player.pendingTransition?.marketQuoteDue && !player.pendingTransition.marketQuoteHandled) {
    player.pendingTransition.marketQuoteHandled = true;
    saveGame();
    finishMonthTransition();
    return;
  }
  renderGamePage(message || "市场报价保持不变。", { skipEcho: true });
}

function startGame(identity, maxMonth = selectedMaxMonth) {
  const initialBuffer = getBuffer(identity.savings, identity.expense);
  const normalizedMaxMonth = challengeLengths.includes(Number(maxMonth)) ? Number(maxMonth) : selectedMaxMonth;
  const debugStartMonth = debugMode ? Math.max(1, Math.min(normalizedMaxMonth, Number(debugParams.get("month")) || 1)) : 1;
  player = {
    stateVersion: GAME_STATE_VERSION,
    identityId: identity.id || "custom",
    identityName: identity.name,
    baseIncome: Number(identity.income) || 0,
    baseExpense: Number(identity.expense) || 0,
    savings: Number(identity.savings) || 0,
    currentMonth: debugStartMonth,
    completedMonths: debugStartMonth - 1,
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
    investment: null,
    market: null,
    scheduledCards: [],
    pendingEchoes: [],
    pendingTransition: null,
    pendingMonthlySummary: null,
    monthlySnapshots: [],
    eventDrawHistory: [],
    wellbeingPenalty: 0,
    wellbeingLedger: [],
    recoveryMessages: [],
    tempProtectionReduction: 0,
    endReason: null,
    endedMonth: null,
    history: [],
    cashRescueHistory: [],
    gameEnded: false,
    randomState: debugMode ? debugRandomState : null,
    debugSeed: debugMode ? debugSeedText : null,
    startedAt: Date.now(),
  };
  player.market = window.CashGameCore.createInitialMarketState(
    randomFloat(),
    randomFloat(),
    randomFloat(),
    debugStartMonth,
  );
  player.careerEventMonth = randomInt(2, Math.max(2, Math.min(5, normalizedMaxMonth - 2)));
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
  window.setTimeout(maybeStartOnboarding, 380);
}

function getScheduledTriggerMonth(delay, preserveDelay = false) {
  const triggerMonth = player.currentMonth + (delay || 1);
  return preserveDelay ? triggerMonth : Math.min(player.maxMonth, triggerMonth);
}

function startInvestmentPlan({ monthlyAmount = 0, initialAmount = 0 } = {}) {
  const existing = getDcaPlan();
  if (existing && getInvestmentHoldingStatus(existing) !== "sold_all") {
    showToast("你已经持有这只基金，不能重复开启。");
    return false;
  }

  const normalizedMonthlyAmount = Math.max(0, Math.round(Number(monthlyAmount) || 0));
  const normalizedInitialAmount = Math.max(0, Math.round(Number(initialAmount) || 0));
  const market = ensureMarketState();
  const previousActions = Array.isArray(existing?.actionHistory) ? existing.actionHistory : [];
  const previousPriceHistory = Array.isArray(existing?.priceHistory) ? existing.priceHistory : [];
  player.investment = window.CashGameCore.normalizeInvestmentState({
    ...(existing || {}),
    id: "index_fund_001",
    fundName: "宽基指数基金",
    name: "宽基指数基金",
    status: normalizedMonthlyAmount > 0 ? "active" : "paused",
    holdingStatus: "holding",
    dcaStatus: normalizedMonthlyAmount > 0 ? "active" : "never_started",
    entryMode: normalizedMonthlyAmount > 0 ? "dca" : "one_time",
    entryNav: market.nav,
    nav: market.nav,
    valuation: market.valuation,
    shares: 0,
    monthlyDcaAmount: normalizedMonthlyAmount,
    monthlyAmount: normalizedMonthlyAmount,
    totalInvested: existing?.totalInvested || 0,
    holdingPrincipal: 0,
    soldPrincipal: existing?.soldPrincipal || 0,
    realizedAmount: existing?.realizedAmount || 0,
    realizedProfit: existing?.realizedProfit || 0,
    currentReturnRate: 0,
    marketStage: marketTrendStage(market.trend),
    startMonth: player.currentMonth,
    pauseCount: 0,
    lastAction: normalizedMonthlyAmount > 0 ? "start_dca" : "initial_buy",
    priceHistory: [
      ...previousPriceHistory.filter((item) => Number(item.month) !== Number(player.currentMonth)),
      { month: player.currentMonth, nav: market.nav, stage: marketTrendStage(market.trend) },
    ],
    actionHistory: previousActions,
  });

  if (normalizedInitialAmount > 0) {
    player.savings -= normalizedInitialAmount;
    recordInvestmentPurchase(player.investment, normalizedInitialAmount, "initial_buy");
    updateLowestSavingsAndBuffer();
  }
  if (normalizedMonthlyAmount > 0) {
    player.investment.actionHistory.push({
      month: player.currentMonth,
      action: "start_dca",
      amount: normalizedMonthlyAmount,
      nav: player.investment.nav,
    });
  }

  trackEvent("cash_game_dca_started", {
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    investment_mode: normalizedMonthlyAmount > 0 ? "monthly" : "one_time",
  });
  return true;
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
      blocksRecurringIncome: effect.blocksRecurringIncome === true,
    });
    return;
  }

  if (effect.type === "add_uncertain_active_effect") {
    player.activeEffects.push({
      id: generateId("uncertain"),
      name: event?.title || "不确定收入变化",
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
      triggerMonth: getScheduledTriggerMonth(effect.triggerDelay, effect.preserveDelay),
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
      triggerMonth: getScheduledTriggerMonth(effect.triggerDelay, effect.preserveDelay),
      triggered: false,
      amount: effect.amount,
    });
    return;
  }

  if (effect.type === "schedule_savings_by_income_percent") {
    player.scheduledCards.push({
      id: effect.id || generateId("scheduled_income_savings"),
      type: "savings_effect",
      title: effect.title || event?.title || "后续回款",
      message: effect.message || "之前延期的收入到账了。",
      triggerMonth: getScheduledTriggerMonth(effect.triggerDelay, effect.preserveDelay),
      triggered: false,
      amount: Math.round(player.baseIncome * effect.amount),
    });
    return;
  }

  if (effect.type === "schedule_random_savings_effect") {
    player.scheduledCards.push({
      id: effect.id || generateId("scheduled_random_savings"),
      type: "random_savings_effect",
      title: effect.title || event?.title || "后续结果",
      message: effect.message || "之前的选择有了结果。",
      triggerMonth: getScheduledTriggerMonth(effect.triggerDelay, effect.preserveDelay),
      triggered: false,
      outcomes: effect.outcomes.map((outcome) => ({ ...outcome })),
    });
    return;
  }

  if (effect.type === "start_fund_investment") {
    startInvestmentPlan({ initialAmount: effect.initialAmount });
    return;
  }

  if (effect.type === "start_dca_plan") {
    startInvestmentPlan({ monthlyAmount: effect.monthlyAmount });
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
      waitForIncomeRecovery: true,
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
  const settlement = window.CashGameCore.calculateSettlement({
    savingsAfterEffects: player.savings,
    recurringIncome,
    recurringExpense,
    tempIncomeDelta,
    tempExpenseDelta,
  });
  const monthlyNetCashflow = settlement.monthlyNetCashflow;
  const requestedInvestmentContribution = getMonthlyInvestmentContribution();
  const investmentExecution = window.CashGameCore.calculateAffordableInvestmentContribution({
    savingsBeforeContribution: settlement.savingsAfterMonth,
    requestedAmount: requestedInvestmentContribution,
  });
  const investmentContribution = investmentExecution.contributionAmount;
  const investmentContributionSkipped = investmentExecution.skippedAmount;
  if (investmentExecution.shouldPause) pauseDcaForCashShortfall(getDcaPlan(), investmentContributionSkipped);
  const savingsAfterMonth = settlement.savingsAfterMonth - investmentContribution;
  const savingsDelta = savingsAfterMonth - before.savings;
  const bufferAfterMonth = getBuffer(savingsAfterMonth, recurringExpense);
  const beforeBuffer = before.buffer;
  const afterBuffer = bufferAfterMonth;
  const direction = savingsDelta >= 0 ? "结算后现金储备增加" : "结算后现金储备减少";
  const bufferDelta = afterBuffer - beforeBuffer;

  return {
    month: player.currentMonth,
    eventId: event.id,
    eventTitle: event.title,
    eventDescription: event.description,
    category: event.category,
    choiceLabel: choice ? choice.label : null,
    savingsBefore: before.savings,
    bufferBefore: beforeBuffer,
    incomeBefore: before.income,
    expenseBefore: before.expense,
    recurringIncome,
    recurringExpense,
    currentIncome,
    currentExpense,
    tempIncomeDelta,
    tempExpenseDelta,
    reserveDelta,
    protectionReduction,
    monthlyNetCashflow,
    investmentContribution,
    investmentContributionSkipped,
    savingsAfterMonth,
    savingsAfterSettlement: savingsAfterMonth,
    savingsDelta,
    bufferAfterMonth,
    bufferAfterSettlement: bufferAfterMonth,
    bufferDelta,
    roundLabel: getRoundLabel(savingsDelta, beforeBuffer, afterBuffer),
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
  if (window.CashGameCore.isRecurringIncomeBlocked(player.activeEffects)) return 0;
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
  return window.CashGameCore.calculateRecurringIncome(player.baseIncome, player.activeEffects);
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

function pauseDcaForCashShortfall(plan, skippedAmount) {
  if (!plan || getInvestmentDcaStatus(plan) !== "active") return;
  plan.dcaStatus = "paused";
  plan.pauseCount = (plan.pauseCount || 0) + 1;
  plan.lastAction = "dca_skipped_cash";
  plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
  plan.actionHistory.push({
    month: player.currentMonth,
    action: "dca_skipped_cash",
    amount: Math.max(0, Math.round(Number(skippedAmount) || 0)),
    nav: plan.nav,
  });
  syncInvestmentLegacyStatus(plan);
}

function processLongTermPlans() {
  const investment = getDcaPlan();
  const investmentContribution = getMonthlyInvestmentContribution();
  if (investment && investmentContribution > 0) {
    recordInvestmentPurchase(investment, investmentContribution, "monthly_dca");
  }

  player.longTermPlans.forEach((plan) => {
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
        return { ...effect, remainingMonths: window.CashGameCore.tickDuration(effect.remainingMonths) };
      }

      const elapsedMonths = (effect.elapsedMonths || 0) + 1;
      const canRecover = elapsedMonths >= effect.minMonths;
      const forcedRecovery = elapsedMonths >= effect.maxMonths;
      const recovered = canRecover && (forcedRecovery || randomFloat() < effect.recoveryChance);

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
  const dueCards = window.CashGameCore.getDueScheduledCards(player.scheduledCards, player.currentMonth);
  dueCards.forEach((card) => {
    if (window.CashGameCore.shouldDeferScheduledCard(card, player.activeEffects)) {
      card.triggerMonth = player.currentMonth + 1;
      card.deferredByIncomeBlock = true;
      return;
    }
    card.triggered = true;
    card.resolvedMonth = player.currentMonth;
    const echo = resolveScheduledCard(card);
    if (echo) echoes.push(echo);
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
      id: card.id,
      title: card.title,
      message: card.message,
      effectLine: `${formatActiveEffectLine(card.activeEffect, "常规月")}。`,
      savingsDelta: 0,
      savingsAfter: player.savings,
      bufferAfter: calculateBuffer(),
    };
  }

  if (card.type === "savings_effect") {
    player.savings += card.amount;
    recordStress(card.title || "后续事件", Math.max(0, -(card.amount || 0)), "次");

    return {
      id: card.id,
      title: card.title,
      message: card.message,
      effectLine: `现金储备 ${formatSignedMoney(card.amount)}。`,
      savingsDelta: card.amount || 0,
      savingsAfter: player.savings,
      bufferAfter: calculateBuffer(),
    };
  }

  if (card.type === "random_savings_effect") {
    const outcome = window.CashGameCore.pickWeightedOutcome(card.outcomes, randomFloat());
    if (!outcome) return null;
    card.outcomeId = outcome.id || null;
    card.amount = window.CashGameCore.calculateSavingsOutcomeAmount(outcome, player.baseIncome);
    player.savings += card.amount;

    const incomeLoss = Math.round(player.baseIncome * (Number(outcome.incomeLossPercent) || 0));
    const savingsCost = Math.round(Number(outcome.savingsCost) || 0);
    const activeEffect = outcome.activeEffect;
    const hasActiveEffect =
      activeEffect &&
      ["income", "income_percent", "expense", "expense_percent"].includes(activeEffect.target) &&
      Number.isFinite(Number(activeEffect.amount)) &&
      Number(activeEffect.duration) > 0;
    if (hasActiveEffect) {
      player.activeEffects.push({
        id: generateId("scheduled_random_effect"),
        name: activeEffect.name || outcome.title || card.title || "后续影响",
        target: activeEffect.target,
        amount: Number(activeEffect.amount),
        remainingMonths: Number(activeEffect.duration),
        sourceEventId: card.id,
      });
    }
    if (outcome.silent && !card.amount && !incomeLoss && !savingsCost && !hasActiveEffect) return null;
    recordStress(outcome.title || card.title || "后续事件", Math.max(0, -card.amount), "次");
    const riskImpactLines = [];
    if (incomeLoss) riskImpactLines.push(`本月收入 -${formatMoney(incomeLoss)}`);
    if (savingsCost) riskImpactLines.push(`现金储备 -${formatMoney(savingsCost)}`);
    if (hasActiveEffect) riskImpactLines.push(formatActiveEffectLine(activeEffect, "常规月"));
    const effectLine = riskImpactLines.length
      ? `${riskImpactLines.join(" · ")}。`
      : `现金储备 ${formatSignedMoney(card.amount)}。`;

    return {
      id: card.id,
      title: outcome.title || card.title,
      message: outcome.message || card.message,
      effectLine,
      savingsDelta: card.amount,
      savingsAfter: player.savings,
      bufferAfter: calculateBuffer(),
    };
  }

  if (card.id !== "career_course_echo") return null;
  const success = randomFloat() < 0.7;

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
      id: card.id,
      title: "课程开始回本",
      message: "之前报名的职业提升课程帮你拿到了更好的项目机会。",
      effectLine: "常规月收入 +1,500 元，持续 12 个月。",
      savingsDelta: 0,
      savingsAfter: player.savings,
      bufferAfter: calculateBuffer(),
    };
  }

  card.outcome = "neutral";
  return {
    id: card.id,
    title: "课程还在发酵",
    message: "课程没有立刻带来收入变化，但你补上了一块能力短板。",
    effectLine: "本月现金流暂时不变。",
    savingsDelta: 0,
    savingsAfter: player.savings,
    bufferAfter: calculateBuffer(),
  };
}

function showNextScheduledEcho() {
  const echo = player?.pendingEchoes?.[0];
  if (!echo) {
    showPendingMarketQuoteOrFinish();
    return;
  }
  renderScheduledEchoCard(echo);
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
      <button class="button primary" data-action="continue-echo">继续前进</button>
    </div>
  `);
}

function continueScheduledEcho() {
  if (!player?.pendingEchoes?.length) {
    closeModal();
    showPendingMarketQuoteOrFinish();
    return;
  }
  player.pendingEchoes.shift();
  saveGame();
  closeModal();
  if (player.pendingEchoes.length) {
    window.setTimeout(showNextScheduledEcho, 120);
    return;
  }
  showPendingMarketQuoteOrFinish();
}

function continueAfterTurnFeedback() {
  if (!player?.pendingTransition) return;
  player.pendingTransition.quickFeedback = null;
  saveGame();
  if (player.pendingEchoes?.length) {
    window.setTimeout(showNextScheduledEcho, 120);
    return;
  }
  showPendingMarketQuoteOrFinish();
}

function getCashRescueOptions(savings = player?.savings) {
  const plan = getDcaPlan();
  const hasHolding = plan && getInvestmentHoldingStatus(plan) !== "sold_all" && getDcaHoldingPrincipal(plan) > 0;
  return window.CashGameCore.calculateCashRescueOptions({
    savings,
    shares: hasHolding ? plan.shares : 0,
    holdingPrincipal: hasHolding ? getDcaHoldingPrincipal(plan) : 0,
    nav: hasHolding ? plan.nav : ensureMarketState()?.nav,
  });
}

function createPendingCashRescue() {
  const options = getCashRescueOptions();
  return {
    month: player.currentMonth,
    handled: false,
    eligible: options.eligible,
    hasHolding: options.hasHolding,
    savingsBeforeRescue: player.savings,
    deficit: options.deficit,
    holdingValue: options.holdingValue,
    nav: Number(getDcaPlan()?.nav) || Number(ensureMarketState()?.nav) || 0,
  };
}

function recordUnavailableCashRescue(rescue) {
  player.cashRescueHistory = Array.isArray(player.cashRescueHistory) ? player.cashRescueHistory : [];
  if (player.cashRescueHistory.some((item) => item.month === player.currentMonth && item.outcome === "insufficient")) return;
  const entry = {
    month: player.currentMonth,
    outcome: "insufficient",
    deficit: rescue.deficit,
    holdingValue: rescue.holdingValue,
    savingsAfter: player.savings,
  };
  player.cashRescueHistory.push(entry);
  trackEvent("cash_game_cash_rescue_unavailable", {
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    holding_status: rescue.hasHolding ? "holding" : "no_holding",
    result: "insufficient_holding",
  });
  player.history.push({
    month: player.currentMonth,
    entryType: "cash_rescue_unavailable",
    eventTitle: "基金持仓不足以填补缺口",
    category: "investment",
    choice: null,
    effectLine: `现金缺口 ${formatMoney(rescue.deficit)}，基金持仓估值 ${formatMoney(rescue.holdingValue)}。`,
    savingsAfter: player.savings,
    bufferAfter: calculateBuffer(),
  });
}

function renderCashRescue() {
  const transition = player?.pendingTransition;
  if (!transition?.cashRescue || transition.cashRescue.handled) return;
  const options = getCashRescueOptions();
  const plan = getDcaPlan();
  if (!options.eligible || !plan) {
    transition.cashRescue.handled = true;
    saveGame();
    finishMonthTransition();
    return;
  }

  const partialIsFull = options.partialRatio >= 0.999999 || options.partialSale.status === "sold_all";
  const partialChoice = partialIsFull
    ? ""
    : `
      <button class="choice-button rescue-choice" data-action="cash-rescue-choice" data-choice="partial">
        <strong>卖出足够份额</strong>
        <span>预计回款 ${formatMoney(options.partialSale.soldAmount)}，卖出后现金储备 ${formatMoney(options.savingsAfterPartial)}。</span>
      </button>
    `;

  openModal(
    `
      <div class="cash-rescue-card">
        <div class="cash-rescue-head">
          <span>第 ${player.currentMonth} 个月</span>
          <h2>现金储备告急</h2>
          <p>本月结算后现金储备出现缺口。</p>
        </div>
        <div class="cash-rescue-metrics">
          <div class="is-danger"><span>现金缺口</span><strong>-${formatMoney(options.deficit)}</strong></div>
          <div><span>基金净值</span><strong>${Number(plan.nav).toFixed(2)} 元</strong></div>
          <div><span>持仓市值</span><strong>${formatMoney(options.holdingValue)}</strong></div>
          <div><span>阶段收益率</span><strong>${formatPercent(getDcaCurrentReturnRate(plan))}</strong></div>
        </div>
        <div class="choice-list cash-rescue-choices">
          ${partialChoice}
          <button class="choice-button rescue-choice" data-action="cash-rescue-choice" data-choice="all">
            <strong>全部卖出</strong>
            <span>预计回款 ${formatMoney(options.fullSale.soldAmount)}，卖出后现金储备 ${formatMoney(options.savingsAfterFull)}。</span>
          </button>
          <button class="choice-button rescue-choice is-decline" data-action="cash-rescue-choice" data-choice="decline">
            <strong>保留持仓</strong>
            <span>不卖出基金，本局在本月结束。</span>
          </button>
        </div>
      </div>
    `,
    "cash-rescue-backdrop",
  );
  if (!transition.cashRescue.trackingViewed) {
    transition.cashRescue.trackingViewed = true;
    trackEvent("cash_game_cash_rescue_viewed", {
      month: player.currentMonth,
      challenge_length: player.maxMonth,
      partial_sale_available: !partialIsFull,
      investment_return_band: window.CashGameCore.getInvestmentReturnBand(getDcaCurrentReturnRate(plan)),
    });
    saveGame();
  }
}

function handleCashRescueChoice(choice) {
  const transition = player?.pendingTransition;
  const rescue = transition?.cashRescue;
  if (!transition || !rescue || rescue.handled) return;

  if (choice === "decline") {
    rescue.handled = true;
    rescue.outcome = "declined";
    player.cashRescueHistory = Array.isArray(player.cashRescueHistory) ? player.cashRescueHistory : [];
    player.cashRescueHistory.push({
      month: player.currentMonth,
      outcome: "declined",
      deficit: Math.max(0, -player.savings),
      holdingValue: getCashRescueOptions().holdingValue,
      savingsAfter: player.savings,
    });
    player.history.push({
      month: player.currentMonth,
      entryType: "cash_rescue_declined",
      eventTitle: "保留基金持仓",
      category: "investment",
      choice: "不卖出基金",
      effectLine: "现金缺口没有填补，本局结束。",
      savingsAfter: player.savings,
      bufferAfter: calculateBuffer(),
    });
    trackEvent("cash_game_cash_rescue_resolved", {
      month: player.currentMonth,
      challenge_length: player.maxMonth,
      sale_type: "declined",
      result: "cash_broken",
      investment_return_band: window.CashGameCore.getInvestmentReturnBand(getDcaCurrentReturnRate(getDcaPlan())),
    });
    saveGame();
    closeModal();
    finishMonthTransition();
    return;
  }

  const options = getCashRescueOptions();
  const plan = getDcaPlan();
  if (!options.eligible || !plan) return;
  const savingsBeforeRescue = player.savings;
  const ratio = choice === "all" ? 1 : options.partialRatio;
  const action = choice === "all" ? "emergency_sell_all" : "emergency_sell_partial";
  const stage = marketTrendStage(ensureMarketState().trend);
  const soldAmount = sellDcaHolding(plan, ratio, stage, { action, emergency: true });
  const lastSale = plan.actionHistory[plan.actionHistory.length - 1];
  const soldAll = getInvestmentHoldingStatus(plan) === "sold_all";
  plan.lastAction = action;

  rescue.handled = true;
  rescue.outcome = soldAll ? "sold_all" : "sold_partial";
  rescue.soldAmount = soldAmount;
  rescue.soldPrincipal = lastSale?.principal || 0;
  rescue.savingsAfter = player.savings;
  transition.endReason = player.savings < 0
    ? "cash_broken"
    : player.currentMonth >= player.maxMonth
      ? "completed"
      : null;
  transition.marketQuoteDue = false;
  transition.marketQuoteHandled = true;

  const market = ensureMarketState();
  market.tradedMonth = player.currentMonth;
  market.lastViewedMonth = player.currentMonth;
  market.lastQuoteMonth = player.currentMonth;
  market.previousQuoteNav = market.nav;
  recordSuccessfulCashRescue({
    outcome: rescue.outcome,
    soldAmount,
    soldPrincipal: rescue.soldPrincipal,
    savingsBeforeRescue,
    savingsAfter: player.savings,
    nav: plan.nav,
  });
  trackEvent("cash_game_cash_rescue_resolved", {
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    sale_type: rescue.outcome,
    result: player.savings >= 0 ? "continued" : "cash_broken",
    investment_return_band: window.CashGameCore.getInvestmentReturnBand(
      lastSale?.principal > 0 ? (soldAmount - lastSale.principal) / lastSale.principal : 0,
    ),
  });
  saveGame();
  closeModal();
  renderCashRescueResult(rescue);
}

function recordSuccessfulCashRescue(entry) {
  const bufferAfter = calculateBuffer();
  player.cashRescueHistory = Array.isArray(player.cashRescueHistory) ? player.cashRescueHistory : [];
  player.cashRescueHistory.push({ month: player.currentMonth, ...entry, bufferAfter });

  const snapshot = player.monthlySnapshots?.[player.monthlySnapshots.length - 1];
  if (snapshot && Number(snapshot.month) === Number(player.currentMonth)) {
    snapshot.savingsBeforeRescue = entry.savingsBeforeRescue;
    snapshot.cashRescueProceeds = entry.soldAmount;
    snapshot.savingsAfterRescue = entry.savingsAfter;
    snapshot.bufferAfterRescue = bufferAfter;
    snapshot.savingsAfterMonth = entry.savingsAfter;
    snapshot.bufferAfterMonth = bufferAfter;
  }

  const actionLabel = entry.outcome === "sold_all" ? "全部卖出基金" : "卖出部分基金";
  player.history.push({
    month: player.currentMonth,
    entryType: "cash_rescue",
    eventTitle: "应急卖出基金",
    category: "investment",
    choice: actionLabel,
    effectLine: `${actionLabel}，回款 ${formatMoney(entry.soldAmount)}。`,
    savingsDelta: entry.soldAmount,
    savingsAfter: entry.savingsAfter,
    bufferAfter,
    realizedProfit: entry.soldAmount - entry.soldPrincipal,
  });
}

function renderCashRescueResult(rescue) {
  const profit = (rescue.soldAmount || 0) - (rescue.soldPrincipal || 0);
  const resultLabel = profit >= 0 ? `实现盈利 ${formatMoney(profit)}` : `实现亏损 ${formatMoney(Math.abs(profit))}`;
  const continueLabel = player.pendingTransition?.endReason === "completed" ? "查看本局结果" : "继续游戏";
  openModal(
    `
      <div class="cash-rescue-card cash-rescue-result">
        <div class="cash-rescue-head is-success">
          <span>应急处置完成</span>
          <h2>现金缺口已经填补</h2>
          <p>${rescue.outcome === "sold_all" ? "基金持仓已经全部卖出。" : "基金仍保留部分持仓。"}</p>
        </div>
        <div class="cash-rescue-result-main">
          <span>卖出回款</span>
          <strong>+${formatMoney(rescue.soldAmount)}</strong>
          <small>${escapeHtml(resultLabel)}</small>
        </div>
        <div class="cash-rescue-result-balance">
          <span>当前现金储备</span>
          <strong>${formatMoney(player.savings)}</strong>
          <small>安全垫 ${formatBuffer(calculateBuffer())} 个月</small>
        </div>
        <div class="modal-actions">
          <button class="button primary" data-action="continue-cash-rescue">${continueLabel}</button>
        </div>
      </div>
    `,
    "cash-rescue-backdrop",
  );
}

function continueAfterCashRescue() {
  closeModal();
  finishMonthTransition();
}

function showPendingMarketQuoteOrFinish() {
  const transition = player?.pendingTransition;
  if (!transition) return;
  if (transition.cashRescue && !transition.cashRescue.handled) {
    window.setTimeout(renderCashRescue, 120);
    return;
  }
  if (transition.marketQuoteDue && !transition.marketQuoteHandled) {
    window.setTimeout(() => renderMarketQuote(transition.marketQuoteSource || "automatic_random"), 120);
    return;
  }
  finishMonthTransition();
}

function finishMonthTransition() {
  const transition = player?.pendingTransition;
  if (!player || !transition) return;
  if (transition.cashRescue && !transition.cashRescue.handled) {
    showPendingMarketQuoteOrFinish();
    return;
  }
  if (transition.marketQuoteDue && !transition.marketQuoteHandled) {
    showPendingMarketQuoteOrFinish();
    return;
  }
  player.pendingTransition = null;
  player.pendingEchoes = [];

  if (transition.endReason) {
    player.gameEnded = true;
    player.endReason = transition.endReason;
    player.endedMonth = getCompletedMonths();
    saveGame();
    closeModal();
    renderResultPage();
    return;
  }

  player.currentMonth = transition.nextMonth;
  advanceMarketToMonth(player.currentMonth);
  saveGame();
  closeModal();
  renderGamePage(nextMonthMessage(transition.recoveryMessages || []));
}

function createQuickFeedback(summary) {
  const incomeDelta = summary.currentIncome - (summary.incomeBefore ?? summary.recurringIncome);
  const expenseDelta = summary.currentExpense - (summary.expenseBefore ?? summary.recurringExpense);
  const detailRows = [];

  if (summary.reserveDelta) detailRows.push({ label: "一次性储备影响", value: formatSignedMoney(summary.reserveDelta) });
  if (incomeDelta) detailRows.push({ label: incomeDelta > 0 ? "收入增加" : "收入减少", value: formatSignedMoney(incomeDelta) });
  if (expenseDelta) detailRows.push({ label: expenseDelta > 0 ? "支出增加" : "支出减少", value: formatSignedMoney(expenseDelta) });
  if (summary.investmentContribution) detailRows.push({ label: "投资投入", value: formatSignedMoney(-summary.investmentContribution) });
  if (summary.investmentContributionSkipped) {
    detailRows.push({ label: "定投暂停", value: `本月未投入 ${formatMoney(summary.investmentContributionSkipped)}` });
  }
  const impactRows = [
    { label: "本月合计", value: formatSignedMoney(summary.savingsDelta) },
    ...detailRows.slice(0, 1),
  ];

  const crossedThreshold = [3, 1, 0].find(
    (threshold) => summary.bufferBefore >= threshold && summary.bufferAfterMonth < threshold,
  );
  const isCheckpoint = summary.month < player.maxMonth && summary.month % 4 === 0;

  return {
    eventTitle: summary.eventTitle,
    eventDescription: summary.eventDescription,
    choiceLabel: summary.choiceLabel,
    month: summary.month,
    savingsAfter: summary.savingsAfterMonth,
    savingsDelta: summary.savingsDelta,
    bufferBefore: summary.bufferBefore,
    bufferAfter: summary.bufferAfterMonth,
    impactRows: impactRows.slice(0, 2),
    crossedThreshold: crossedThreshold ?? null,
    protectionReduction: summary.protectionReduction || 0,
    wellbeingCost: summary.wellbeingCost || 0,
    wellbeingReason: summary.wellbeingReason || "",
    isCheckpoint,
  };
}

function showTurnFeedback(feedback, options = {}) {
  document.querySelectorAll(".turn-feedback-backdrop").forEach((node) => node.remove());
  const backdrop = document.createElement("div");
  const element = document.createElement("div");
  const tone = feedback.crossedThreshold !== null ? "is-warning" : feedback.savingsDelta < 0 ? "is-down" : "is-up";
  const [primaryImpact, secondaryImpact] = feedback.impactRows;
  backdrop.className = "turn-feedback-backdrop";
  element.className = `turn-feedback ${tone}`;
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.innerHTML = `
    <div class="turn-feedback-head">
      <span>${feedback.isCheckpoint ? `阶段完成 · ${feedback.month} / ${player.maxMonth} 个月` : `第 ${feedback.month} 个月结算`}</span>
      <strong>${escapeHtml(feedback.eventTitle)}</strong>
      ${feedback.eventDescription ? `<p>${escapeHtml(feedback.eventDescription)}</p>` : ""}
      ${feedback.choiceLabel ? `<small>选择：${escapeHtml(feedback.choiceLabel)}</small>` : ""}
    </div>
    <div class="turn-feedback-result">
      <span>${escapeHtml(primaryImpact.label)}</span>
      <strong>${escapeHtml(primaryImpact.value)}</strong>
      ${secondaryImpact ? `<small>${escapeHtml(secondaryImpact.label)} ${escapeHtml(secondaryImpact.value)}</small>` : ""}
    </div>
    ${
      feedback.crossedThreshold !== null
        ? `<div class="turn-feedback-alert">安全垫跌破 ${feedback.crossedThreshold} 个月</div>`
        : ""
    }
    ${
      feedback.protectionReduction
        ? `<div class="turn-feedback-protection">基础保障生效，本次少花 ${formatMoney(feedback.protectionReduction)}</div>`
        : ""
    }
    ${
      feedback.wellbeingCost
        ? `<div class="turn-feedback-life-cost"><strong>生活体验 -${feedback.wellbeingCost} 分</strong><span>${escapeHtml(feedback.wellbeingReason)}</span></div>`
        : ""
    }
    <div class="turn-feedback-footer">
      <div><span>月末现金储备</span><strong>${formatMoney(feedback.savingsAfter)}</strong></div>
      <div><span>安全垫</span><strong>${formatBuffer(feedback.bufferBefore)} → ${formatBuffer(feedback.bufferAfter)} 个月</strong></div>
    </div>
    <span class="turn-feedback-hint">点击卡片外关闭</span>
  `;
  backdrop.appendChild(element);
  document.body.appendChild(backdrop);
  trackEvent("cash_game_quick_result_viewed", {
    month: feedback.month,
    challenge_length: player.maxMonth,
    feedback_tone: tone.replace("is-", ""),
    is_checkpoint: Boolean(feedback.isCheckpoint),
    has_choice: Boolean(feedback.choiceLabel),
    crossed_buffer_threshold: feedback.crossedThreshold !== null,
    has_protection_effect: Boolean(feedback.protectionReduction),
    has_wellbeing_impact: Boolean(feedback.wellbeingCost),
  });

  let dismissed = false;
  let readyToDismiss = prefersReducedMotion();
  const dismiss = () => {
    if (dismissed || !readyToDismiss) return;
    dismissed = true;
    trackEvent("cash_game_quick_result_closed", {
      month: feedback.month,
      challenge_length: player.maxMonth,
      feedback_tone: tone.replace("is-", ""),
      is_checkpoint: Boolean(feedback.isCheckpoint),
    });
    backdrop.classList.remove("show");
    window.setTimeout(() => {
      backdrop.remove();
      if (options.continueTransition) continueAfterTurnFeedback();
    }, 220);
  };

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  window.requestAnimationFrame(() => {
    backdrop.classList.add("show");
    if (!readyToDismiss) {
      window.setTimeout(() => {
        readyToDismiss = true;
        backdrop.classList.add("is-ready");
      }, 280);
    }
  });
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

function addMonthlySnapshot(summary, scheduledEchoes = []) {
  const snapshot = {
    ...summary,
    month: player.currentMonth,
    completedAt: Date.now(),
  };
  player.monthlySnapshots = player.monthlySnapshots || [];
  player.monthlySnapshots.push(snapshot);

  player.history.push({
    month: player.currentMonth,
    entryType: "event",
    eventTitle: summary.eventTitle,
    category: summary.category,
    choice: summary.choiceLabel,
    protectionReduction: summary.protectionReduction || 0,
    savingsDelta: summary.savingsAfterSettlement - summary.savingsBefore,
    savingsAfter: summary.savingsAfterSettlement,
    bufferAfter: summary.bufferAfterSettlement,
  });

  scheduledEchoes.forEach((echo) => {
    player.history.push({
      month: player.currentMonth,
      entryType: "follow_up",
      eventTitle: echo.title,
      category: "follow_up",
      choice: null,
      protectionReduction: 0,
      savingsAfter: echo.savingsAfter,
      bufferAfter: echo.bufferAfter,
      effectLine: echo.effectLine,
    });
  });
}

function getHistorySummary(item) {
  const parts = [];
  const specialEntryTypes = ["follow_up", "cash_rescue", "cash_rescue_unavailable", "cash_rescue_declined"];
  if (specialEntryTypes.includes(item.entryType)) {
    parts.push(item.effectLine || "后续影响已生效");
  }
  if (item.choice) parts.push(`选择：${item.choice}`);
  else if (!specialEntryTypes.includes(item.entryType)) parts.push(categoryLabel(item.category));
  if (item.protectionReduction) parts.push(`保障少花 ${formatMoney(item.protectionReduction)}`);
  if (Number.isFinite(item.savingsDelta)) parts.push(`本月合计 ${formatSignedMoney(item.savingsDelta)}`);
  if (item.bufferAfter < 1) parts.push("安全垫进入高压区");
  return parts.join(" · ");
}

function getHistoryTone(item) {
  if (item.protectionReduction) return "is-protected";
  if (item.entryType === "cash_rescue") return "is-good";
  if (["cash_rescue_unavailable", "cash_rescue_declined"].includes(item.entryType)) return "is-danger";
  if (item.bufferAfter < 1) return "is-danger";
  if (item.choice) return "is-choice";
  if (item.entryType === "follow_up") return "is-choice";
  if (item.category === "positive") return "is-good";
  return "";
}

function recordEventDraw(eventId) {
  player.eventDrawHistory = player.eventDrawHistory || [];
  player.eventDrawHistory.push({ id: eventId, month: player.currentMonth });
  player.eventDrawHistory = player.eventDrawHistory.slice(-80);
}

function applyChoiceWellbeingCost(choice, event) {
  const cost = Math.max(0, Math.min(6, Number(choice?.wellbeingCost) || 0));
  if (!cost) return null;
  const reason = String(choice.wellbeingReason || choice.resultText || "这次选择增加了生活负担").trim();
  player.wellbeingPenalty = Math.max(0, Number(player.wellbeingPenalty) || 0) + cost;
  player.wellbeingLedger = Array.isArray(player.wellbeingLedger) ? player.wellbeingLedger : [];
  const entry = {
    month: player.currentMonth,
    eventId: event?.id || null,
    eventTitle: event?.title || "未命名事件",
    choiceLabel: choice?.label || "未命名选择",
    cost,
    reason,
  };
  player.wellbeingLedger.push(entry);
  return entry;
}

function getWellbeingPenalty() {
  return Math.min(20, Math.max(0, Number(player?.wellbeingPenalty) || 0));
}

function isEventAllowedByFrequency(event) {
  if (event.enabled === false) return false;
  return getEventOccurrenceCount(event.id) === 0;
}

function getEventOccurrenceCount(eventId) {
  return (player.eventDrawHistory || []).filter((item) => item.id === eventId).length;
}

function weightedRandomItem(items) {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + getEventWeight(item), 0);
  let roll = randomFloat() * total;

  for (const item of items) {
    roll -= getEventWeight(item);
    if (roll <= 0) return item;
  }

  return items[items.length - 1];
}

function getEventWeight(event) {
  const baseWeight = Number.isFinite(event.weight) ? event.weight : getDefaultWeight(event);
  const multiplier = window.CareerEventRules?.getWeightMultiplier(event.id, player?.identityId) || 1;
  return Math.max(0, baseWeight * multiplier);
}

function isEventEligibleForIdentity(event) {
  return window.CareerEventRules?.isEligible(event.id, player?.identityId) ?? true;
}

function getDefaultWeight(event) {
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

function isCareerEvent(event) {
  return Array.isArray(event?.careerIdentityIds) && event.careerIdentityIds.length > 0;
}

function getCareerEventTriggerMonth() {
  if (Number.isFinite(player?.careerEventMonth)) return player.careerEventMonth;
  player.careerEventMonth = Math.min(4, player.maxMonth);
  return player.careerEventMonth;
}

function getDueCareerEvent() {
  return window.CashGameCore.getDueCareerEvent(eventCards, {
    identityId: player.identityId,
    currentMonth: player.currentMonth,
    triggerMonth: getCareerEventTriggerMonth(),
    drawnEventIds: (player.eventDrawHistory || []).map((item) => item.id),
  });
}

function getEventForCurrentPosition() {
  if (debugMode && debugForcedEventId) {
    const forcedEvent = eventCards.find((event) => event.id === debugForcedEventId);
    debugForcedEventId = null;
    if (forcedEvent) return forcedEvent;
  }
  const careerEvent = getDueCareerEvent();
  if (careerEvent) return careerEvent;
  const cell = mapCells[player.position];
  const pools = cell.categories.flatMap((category) =>
    eventCards.filter((event) => event.category === category && !isCareerEvent(event)),
  );
  const eligiblePool = pools.filter((event) => {
    if (!isEventEligibleForIdentity(event)) return false;
    if (!isEventAllowedByFrequency(event)) return false;
    if (hasActiveEvent(event.id)) return false;
    return true;
  });
  const fallbackPool = eventCards.filter((event) => {
    if (isCareerEvent(event)) return false;
    if (!isEventEligibleForIdentity(event)) return false;
    return isEventAllowedByFrequency(event) && !hasActiveEvent(event.id);
  });
  return weightedRandomItem(eligiblePool.length ? eligiblePool : fallbackPool);
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

function getUncertainEffectHint() {
  const uncertainEffects = player.activeEffects.filter((effect) => effect.uncertain);
  if (!uncertainEffects.length) return "";
  const names = uncertainEffects.map((effect) => effect.name || "不确定影响").join("、");
  return `仍在持续的不确定状态：${names}。恢复时间未知，之后每个月都有机会解除。`;
}

function getEndStatus() {
  const endedMonth = getCompletedMonths();
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

const JOURNEY_NODE_GAP = 42;
const JOURNEY_ROUTE_SAMPLE_COUNT = 360;
const JOURNEY_ROUTE_REFERENCE_WIDTH = 312;
const JOURNEY_ROUTE_REFERENCE_HEIGHT = 348;
let journeyRouteMetricsCache = null;

function journeyNodesHtml() {
  const offsets = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];

  return offsets
    .map((offset) => {
      const wrappedIndex = (player.position + offset + mapCells.length) % mapCells.length;
      const isCurrent = offset === 0;
      const isPast = offset < 0;
      const depth = Math.abs(offset);
      const point = getJourneyPoint(offset);
      const tone = getNodeTone(wrappedIndex);
      const isKey = isCurrent || Math.abs(offset) % 3 === 0;

      return `
        <span
          class="journey-node tone-${tone} ${isKey ? "is-key" : ""} ${isCurrent ? "current" : ""} ${isPast ? "past" : "future"}"
          style="--x:${point.x}%; --y:${point.y}%; --scale:${Math.max(0.78, 1 - depth * 0.025)};"
          aria-label="地图节点 ${wrappedIndex + 1}"
        >${isKey ? mapNodeIcon(tone) : ""}</span>
      `;
    })
    .join("");
}

function getJourneyPoint(offset) {
  const route = getJourneyRouteMetrics();
  const targetDistance = Math.max(
    0,
    Math.min(route.totalLength, route.totalLength / 2 + offset * JOURNEY_NODE_GAP),
  );
  let low = 0;
  let high = route.samples.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.samples[middle].distance < targetDistance) low = middle + 1;
    else high = middle;
  }

  const next = route.samples[low];
  const previous = route.samples[Math.max(0, low - 1)];
  const span = Math.max(0.001, next.distance - previous.distance);
  const ratio = (targetDistance - previous.distance) / span;

  return {
    x: Number((previous.x + (next.x - previous.x) * ratio).toFixed(3)),
    y: Number((previous.y + (next.y - previous.y) * ratio).toFixed(3)),
  };
}

function getJourneyRouteMetrics() {
  if (journeyRouteMetricsCache) return journeyRouteMetricsCache;

  const samples = [];
  let totalLength = 0;
  let previous = null;

  for (let index = 0; index <= JOURNEY_ROUTE_SAMPLE_COUNT; index += 1) {
    const routePoint = getRoutePoint(index / JOURNEY_ROUTE_SAMPLE_COUNT);
    const point = {
      x: routePoint.x / 10,
      y: routePoint.y / 6.2,
    };
    const screenPoint = {
      x: (point.x / 100) * JOURNEY_ROUTE_REFERENCE_WIDTH,
      y: (point.y / 100) * JOURNEY_ROUTE_REFERENCE_HEIGHT,
    };

    if (previous) {
      totalLength += Math.hypot(screenPoint.x - previous.screenX, screenPoint.y - previous.screenY);
    }
    samples.push({ ...point, distance: totalLength });
    previous = { screenX: screenPoint.x, screenY: screenPoint.y };
  }

  journeyRouteMetricsCache = { samples, totalLength };
  return journeyRouteMetricsCache;
}

function getRoutePoint(t) {
  const segments = [
    [
      { x: -80, y: 470 },
      { x: 120, y: 430 },
      { x: 220, y: 510 },
      { x: 370, y: 400 },
    ],
    [
      { x: 370, y: 400 },
      { x: 520, y: 290 },
      { x: 610, y: 250 },
      { x: 760, y: 350 },
    ],
    [
      { x: 760, y: 350 },
      { x: 910, y: 450 },
      { x: 930, y: 380 },
      { x: 1080, y: 250 },
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

function mapNodeIcon(tone) {
  const icons = {
    hot: '<path d="M5 15V10M10 15V6M15 15V3"/><path d="M3 17h14"/>',
    calm: '<path d="M5 7h10v9H5z"/><path d="M8 7V5h4v2M8 11h4"/>',
    risk: '<path d="M10 3l6 2v4c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V5z"/><path d="M8 10l1.5 1.5L13 8"/>',
    choice: '<path d="M10 3l2 4 4.5.7-3.2 3.2.8 4.6-4.1-2.2-4.1 2.2.8-4.6-3.2-3.2L8 7z"/>',
    sky: '<path d="M10 3l6 2v4c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V5z"/><path d="M10 6v7"/>',
    stone: '<path d="M5 7h10v9H5z"/><path d="M8 7V5h4v2M8 11h4"/>',
  };
  return `<svg viewBox="0 0 20 20" aria-hidden="true">${icons[tone] || icons.stone}</svg>`;
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
  return getSurvivalScoreBreakdown().total;
}

function getSurvivalScoreBreakdown() {
  return window.CashGameCore.calculateSurvivalScoreBreakdown({
    completedMonths: getCompletedMonths(),
    maxMonth: player.maxMonth,
    initialBuffer: player.initialBuffer,
    finalBuffer: calculateBuffer(),
    savings: player.savings,
    wellbeingPenalty: getWellbeingPenalty(),
  });
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

  if (player.endReason === "manual") {
    return {
      type: "主动结束",
      headline: "这是一份阶段记录",
      summary: `你完成了 ${getCompletedMonths()} / ${player.maxMonth} 个月，本页仅呈现当前阶段结果。`,
      oneLine: "本局未完成全部挑战。",
    };
  }

  if (dcaPlan && dcaPlan.status === "paused") {
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
    const parsed = window.CashGameCore.migratePlayerState(JSON.parse(raw));
    if (!parsed || typeof parsed !== "object" || !Number.isFinite(parsed.baseExpense)) {
      clearSavedGame();
      return null;
    }
    if (apply) {
      player = parsed;
      pendingMonthlySummary = player.pendingMonthlySummary || null;
      if (debugMode && Number.isFinite(player.randomState)) {
        debugRandomState = player.randomState;
        debugSeedText = player.debugSeed || debugSeedText;
      }
    }
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

function getCompletedMonths() {
  if (!player) return 0;
  if (Number.isFinite(player.completedMonths)) return Math.max(0, player.completedMonths);
  return Math.max(0, (player.currentMonth || 1) - 1);
}

function getDcaPlan() {
  return player?.investment || player?.longTermPlans?.find((plan) => plan.id === "index_dca_001") || null;
}

function ensureMarketState() {
  if (!player) return null;
  const normalized = window.CashGameCore.normalizeMarketState(player.market, getDcaPlan(), player.currentMonth);
  if (player.market && normalized) {
    Object.assign(player.market, normalized);
  } else if (normalized) {
    player.market = normalized;
  } else {
    player.market = window.CashGameCore.createInitialMarketState(
      randomFloat(),
      randomFloat(),
      randomFloat(),
      player.currentMonth,
    );
  }
  return player.market;
}

function advanceMarketToMonth(targetMonth) {
  let market = ensureMarketState();
  const normalizedTarget = Math.max(1, Math.round(Number(targetMonth) || 1));
  while (market.lastUpdatedMonth < normalizedTarget) {
    market = window.CashGameCore.advanceMarketState(market, {
      month: market.lastUpdatedMonth + 1,
      regimeRandom: randomFloat(),
      trendRandom: randomFloat(),
      moveRandom: randomFloat(),
    });
  }
  player.market = market;
  syncInvestmentWithMarket();
  return market;
}

function syncInvestmentWithMarket() {
  const market = ensureMarketState();
  const plan = getDcaPlan();
  if (!market || !plan) return;
  plan.previousNav = Number(plan.nav) || market.previousNav;
  plan.nav = market.nav;
  plan.valuation = market.valuation;
  plan.marketStage = marketTrendStage(market.trend);
  plan.currentReturnRate = plan.entryNav > 0 ? plan.nav / plan.entryNav - 1 : 0;
  plan.lastEventMonth = player.currentMonth;
  plan.priceHistory = Array.isArray(plan.priceHistory) ? plan.priceHistory : [];
  const point = {
    month: market.lastUpdatedMonth,
    nav: market.nav,
    stage: plan.marketStage,
    valuation: market.valuation,
  };
  const existingIndex = plan.priceHistory.findIndex((item) => Number(item.month) === point.month);
  if (existingIndex >= 0) plan.priceHistory[existingIndex] = point;
  else plan.priceHistory.push(point);
}

function marketTrendStage(trend) {
  if (trend === "up") return "market_rise";
  if (trend === "down") return "market_drop";
  return "market_flat";
}

function marketTrendTitle(trend) {
  if (trend === "up") return "本月净值上涨";
  if (trend === "down") return "本月净值下跌";
  return "本月窄幅波动";
}

function marketTrendLabel(trend) {
  if (trend === "up") return "上涨";
  if (trend === "down") return "下跌";
  return "震荡";
}

function marketValuationLabel(valuation) {
  if (valuation === "undervalued") return "低估";
  if (valuation === "overvalued") return "高估";
  return "正常估值";
}

function marketMisterButtonHtml() {
  const market = ensureMarketState();
  return `
    <button class="market-mister-button" data-action="market-quote" aria-label="查看市场先生报价">
      <span class="market-mister-icon" aria-hidden="true">市</span>
      <span><strong>市场先生</strong><small>${market.nav.toFixed(2)} · ${marketTrendLabel(market.trend)}</small></span>
    </button>
  `;
}

function getMarketQuoteTrigger(endReason) {
  const market = ensureMarketState();
  if (!market || endReason === "cash_broken") return null;

  const riseStreak = window.CashGameCore.countConsecutiveMarketRises(market.history);
  const latestMove = window.CashGameCore.getLatestMarketMove(market.history);
  if (riseStreak < investmentTiming.riseStreakMonths) market.riseStreakQuoteActive = false;
  const riseStreakDue = window.CashGameCore.shouldTriggerRiseStreakQuote(
    market,
    investmentTiming.riseStreakMonths,
  );

  if (market.lastViewedMonth === player.currentMonth || market.lastQuoteMonth === player.currentMonth) {
    if (riseStreakDue) market.riseStreakQuoteActive = true;
    return null;
  }
  if (debugForcedMarketQuote) {
    debugForcedMarketQuote = false;
    if (riseStreakDue) market.riseStreakQuoteActive = true;
    return "debug";
  }
  if (latestMove === "down") return null;
  if (riseStreakDue) {
    market.riseStreakQuoteActive = true;
    return "automatic_rise_streak";
  }
  if (riseStreak >= investmentTiming.riseStreakMonths && market.riseStreakQuoteActive) return null;
  return randomFloat() < investmentTiming.quoteChance ? "automatic_random" : null;
}

function syncLatestSnapshotAfterMarketAction() {
  if (!player) return;
  const snapshot = player.monthlySnapshots?.[player.monthlySnapshots.length - 1];
  if (snapshot && Number(snapshot.month) === Number(player.currentMonth)) {
    snapshot.savingsAfterMonth = player.savings;
    snapshot.savingsAfterSettlement = player.savings;
    snapshot.savingsDelta = player.savings - snapshot.savingsBefore;
    snapshot.bufferAfterMonth = calculateBuffer();
    snapshot.bufferAfterSettlement = snapshot.bufferAfterMonth;
    snapshot.bufferDelta = snapshot.bufferAfterMonth - snapshot.bufferBefore;
  }
  const historyEntry = [...(player.history || [])]
    .reverse()
    .find((item) => item.entryType === "event" && Number(item.month) === Number(player.currentMonth));
  if (historyEntry && snapshot) {
    historyEntry.savingsAfter = player.savings;
    historyEntry.savingsDelta = player.savings - snapshot.savingsBefore;
    historyEntry.bufferAfter = calculateBuffer();
  }
  updateLowestSavingsAndBuffer();
}

function getInvestmentHoldingStatus(plan) {
  if (!plan) return "sold_all";
  if (plan.holdingStatus === "sold_all" || plan.status === "sold_all") return "sold_all";
  return "holding";
}

function getInvestmentDcaStatus(plan) {
  if (!plan) return "never_started";
  if (["never_started", "active", "paused"].includes(plan.dcaStatus)) return plan.dcaStatus;
  if (plan.status === "active") return "active";
  const actionNames = new Set((plan.actionHistory || []).map((item) => item?.action));
  const hadDca =
    plan.id === "index_dca_001" ||
    Number(plan.monthlyDcaAmount || plan.monthlyAmount) > 0 ||
    ["start_dca", "monthly_dca", "pause_dca", "resume_dca"].some((action) => actionNames.has(action));
  return hadDca ? "paused" : "never_started";
}

function syncInvestmentLegacyStatus(plan) {
  if (!plan) return;
  plan.holdingStatus = getInvestmentHoldingStatus(plan);
  plan.dcaStatus = getInvestmentDcaStatus(plan);
  plan.status =
    plan.holdingStatus === "sold_all" ? "sold_all" : plan.dcaStatus === "active" ? "active" : "paused";
}

function shouldShowDcaPlanCard(plan) {
  if (!plan || getInvestmentHoldingStatus(plan) === "sold_all") return false;
  return getDcaHoldingPrincipal(plan) > 0 || getInvestmentDcaStatus(plan) === "active";
}

function currentStatusInvestment(plan) {
  if (!shouldShowDcaPlanCard(plan)) return null;
  const dcaStatus = getInvestmentDcaStatus(plan);
  const holdingValue = getDcaHoldingValue(plan);
  const monthlyAmount = Math.max(0, Number(plan.monthlyDcaAmount ?? plan.monthlyAmount) || 0);
  const statusText = investmentPlanStatusText(plan);
  const summaryMeta = dcaStatus === "active"
    ? `每月投入 ${formatMoney(monthlyAmount)} · 持仓 ${formatMoney(holdingValue)}`
    : `持仓 ${formatMoney(holdingValue)} · ${statusText}`;
  return {
    type: "investment",
    group: "投资",
    icon: "投",
    title: dcaPlanCardTitle(plan),
    summaryMeta,
    detailMeta: `净值 ${Number(plan.nav || 3).toFixed(2)} 元 · ${summaryMeta} · 阶段收益率 ${formatPercent(getDcaCurrentReturnRate(plan))}`,
    impact: Number.POSITIVE_INFINITY,
  };
}

function currentStatusProtection(plan) {
  if (!plan) return null;
  return {
    type: "protection",
    group: "保障",
    icon: "保",
    title: "基础保障生效中",
    summaryMeta: `剩余 ${plan.remainingMonths} 个月 · 累计少花 ${formatMoney(plan.totalReduced || 0)}`,
    detailMeta: `每月支出 ${formatMoney(plan.monthlyAmount)} · 剩余 ${plan.remainingMonths} 个月 · 累计少花 ${formatMoney(plan.totalReduced || 0)}`,
    impact: Number.POSITIVE_INFINITY,
  };
}

function currentEffectImpact(effect) {
  const base = effect.target?.startsWith("income") ? player.baseIncome : player.baseExpense;
  return Math.abs(effect.target?.endsWith("_percent") ? base * effect.amount : effect.amount);
}

function currentEffectMeta(effect) {
  const target = effect.target?.startsWith("income") ? "月收入" : "月支出";
  const amount = effect.target?.endsWith("_percent") ? formatPercent(effect.amount) : formatSignedMoney(effect.amount);
  const duration = effect.uncertain ? "结束时间未定" : `剩余 ${effect.remainingMonths} 个月`;
  return `${target} ${amount} · ${duration}`;
}

function getOtherCurrentStatuses() {
  if (!player) return [];
  return player.activeEffects
    .filter((effect) => {
      if (effect.sourcePlanId) return false;
      if (effect.uncertain) return true;
      return Number.isFinite(effect.remainingMonths) && effect.remainingMonths > 0 && effect.remainingMonths < 120;
    })
    .map((effect) => ({
      type: "other",
      group: "其他影响",
      icon: effect.target?.startsWith("income") ? "收" : "支",
      title: effect.name || "持续影响",
      summaryMeta: currentEffectMeta(effect),
      detailMeta: currentEffectMeta(effect),
      impact: currentEffectImpact(effect),
    }))
    .sort((first, second) => second.impact - first.impact);
}

function getCurrentGameStatuses() {
  const investment = currentStatusInvestment(getDcaPlan());
  const protection = currentStatusProtection(getProtectionPlan());
  return [investment, protection, ...getOtherCurrentStatuses()].filter(Boolean);
}

function currentStatusSummaryHtml(statuses) {
  if (!statuses.length) return "";
  const primary = statuses[0];
  const indicators = statuses
    .slice(0, 3)
    .map((status) => `<i class="current-status-dot status-${status.type}" title="${escapeHtml(status.group)}"></i>`)
    .join("");
  return `
    <button class="current-status-summary" data-action="current-statuses" aria-label="查看全部当前状态，共 ${statuses.length} 项">
      <span class="current-status-summary-head">
        <span>当前状态 <b>${statuses.length}</b></span>
        <span>查看全部 <i aria-hidden="true">⌃</i></span>
      </span>
      <span class="current-status-summary-main">
        <span class="current-status-mark status-${primary.type}" aria-hidden="true">${primary.icon}</span>
        <span class="current-status-copy">
          <strong>${escapeHtml(primary.title)}</strong>
          <small>${escapeHtml(primary.summaryMeta)}</small>
        </span>
        <span class="current-status-indicators" aria-hidden="true">${indicators}</span>
      </span>
    </button>
  `;
}

function renderCurrentStatuses() {
  const statuses = getCurrentGameStatuses();
  if (!statuses.length) {
    showToast("当前没有正在生效的状态。");
    return;
  }
  const groupOrder = ["投资", "保障", "其他影响"];
  const groupsHtml = groupOrder
    .map((group) => {
      const items = statuses.filter((status) => status.group === group);
      if (!items.length) return "";
      return `
        <section class="current-status-group">
          <h3>${group}</h3>
          <div class="current-status-list">
            ${items
              .map(
                (status) => `
                  <div class="current-status-row">
                    <span class="current-status-mark status-${status.type}" aria-hidden="true">${status.icon}</span>
                    <span>
                      <strong>${escapeHtml(status.title)}</strong>
                      <small>${escapeHtml(status.detailMeta)}</small>
                    </span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");
  trackEvent("cash_game_current_status_opened", {
    month: player.currentMonth,
    challenge_length: player.maxMonth,
    status_count: statuses.length,
    has_investment: statuses.some((status) => status.type === "investment"),
    has_protection: statuses.some((status) => status.type === "protection"),
  });
  openModal(
    `
      <div class="current-status-sheet">
        <header class="current-status-sheet-head">
          <div><span>本局状态</span><h2>当前状态 <b>${statuses.length}</b></h2></div>
          <button class="current-status-close" data-action="close-modal" aria-label="关闭当前状态">×</button>
        </header>
        <div class="current-status-sheet-body">${groupsHtml}</div>
      </div>
    `,
    "current-status-backdrop",
  );
}

function dcaPlanCardTitle(plan) {
  if (getInvestmentDcaStatus(plan) !== "active") return `投资持仓：${plan.fundName || plan.name}`;
  return `正在定投：${plan.fundName || plan.name}`;
}

function getMonthlyInvestmentContribution() {
  const investment = getDcaPlan();
  if (!investment || getInvestmentDcaStatus(investment) !== "active") return 0;
  return Math.max(0, Math.round(Number(investment.monthlyDcaAmount ?? investment.monthlyAmount) || 0));
}

function recordInvestmentPurchase(investment, amount, action = "buy", metadata = {}) {
  if (!investment) return 0;
  const purchase = window.CashGameCore.calculateFundPurchase(amount, investment.nav);
  if (!purchase.investedAmount) return 0;
  investment.shares = Math.max(0, Number(investment.shares) || 0) + purchase.purchasedShares;
  investment.totalInvested = (investment.totalInvested || 0) + purchase.investedAmount;
  investment.holdingPrincipal = getDcaHoldingPrincipal(investment) + purchase.investedAmount;
  investment.actionHistory = Array.isArray(investment.actionHistory) ? investment.actionHistory : [];
  investment.actionHistory.push({
    month: player.currentMonth,
    action,
    amount: purchase.investedAmount,
    nav: investment.nav,
    shares: purchase.purchasedShares,
    ...metadata,
  });
  return purchase.investedAmount;
}

function getDcaHoldingPrincipal(plan) {
  if (!plan) return 0;
  if (Number.isFinite(plan.holdingPrincipal)) return Math.max(0, Math.round(plan.holdingPrincipal));
  return Math.max(0, Math.round(plan.totalInvested || 0));
}

function getDcaCurrentReturnRate(plan) {
  if (!plan) return 0;
  if (Number.isFinite(plan.nav) && Number.isFinite(plan.entryNav) && plan.entryNav > 0) {
    return plan.nav / plan.entryNav - 1;
  }
  if (Number.isFinite(plan.currentReturnRate)) return plan.currentReturnRate;

  const endedMonth = getCompletedMonths();
  const heldMonths = Math.max(1, endedMonth - (plan.startMonth || 1) + 1);
  const scenarioIndex = Math.abs(Math.round((plan.startMonth || 1) * 17 + heldMonths * 11 + player.initialSavings / 1000)) % 3;
  return [-0.02, 0.06, 0.18][scenarioIndex];
}

function getDcaHoldingValue(plan, returnRate = getDcaCurrentReturnRate(plan)) {
  if (Number.isFinite(plan?.shares)) {
    const entryNav = Math.max(0.01, Number(plan.entryNav) || 3);
    const nav = Number.isFinite(returnRate) ? entryNav * (1 + returnRate) : Number(plan.nav) || entryNav;
    return Math.max(0, Math.round(plan.shares * nav));
  }
  return Math.max(0, Math.round(getDcaHoldingPrincipal(plan) * (1 + returnRate)));
}

function getDcaMarketState(stage, plan = null) {
  const returnRate = getDcaCurrentReturnRate(plan);
  const monthlyAmount = Math.max(1, Number(plan?.monthlyDcaAmount || plan?.monthlyAmount) || 2000);
  const dcaStatus = getInvestmentDcaStatus(plan);
  const isActive = dcaStatus === "active";
  const continueChoice = isActive
    ? { id: "hold", label: "继续定投", text: `下个月仍按每月 ${formatMoney(monthlyAmount)} 买入。` }
    : { id: "hold", label: "继续持有", text: "保留当前持仓，不增加投入。" };
  const addChoice = { id: "add_once", label: "追加买入", text: `从现金储备取出 ${formatMoney(4000)}买入。` };
  const pauseChoice = { id: "pause_dca", label: "暂停定投", text: "暂停每月买入，保留当前持仓。" };
  const resumeChoice = { id: "resume_dca", label: "恢复定投", text: `恢复每月 ${formatMoney(monthlyAmount)} 买入。` };
  const startChoice = { id: "start_dca", label: "开始定投", text: `从下个月开始每月 ${formatMoney(monthlyAmount)} 买入。` };
  const sellHalfChoice = {
    id: "sell_half",
    label: "卖出一半",
    text: isActive
      ? "卖出约 50% 持仓，回款进入现金储备，同时暂停后续定投。"
      : "卖出约 50% 持仓，回款进入现金储备。",
  };
  const sellAllChoice = {
    id: "sell_all",
    label: "全部卖出",
    text: dcaStatus === "never_started"
      ? "卖出全部持仓，回款进入现金储备。"
      : "卖出全部持仓，回款进入现金储备，定投同时结束。",
  };
  const stageConfig = {
    market_rise: {
      title: "净值上涨",
      description: "宽基指数基金本月净值上涨。",
      valuationLabel: marketValuationLabel(ensureMarketState().valuation),
    },
    market_drop: {
      title: "净值下跌",
      description: "宽基指数基金本月净值下跌。",
      valuationLabel: marketValuationLabel(ensureMarketState().valuation),
    },
    market_flat: {
      title: "市场震荡",
      description: "宽基指数基金本月窄幅波动。",
      valuationLabel: marketValuationLabel(ensureMarketState().valuation),
    },
    low_drop: {
      title: "净值下跌",
      description: "宽基指数基金净值继续下跌。",
      valuationLabel: "低估",
    },
    low_oscillation: {
      title: "低位震荡",
      description: "宽基指数基金仍在低估区间波动。",
      valuationLabel: "低估",
    },
    recovered: {
      title: "估值修复",
      description: "宽基指数基金回到正常估值区间。",
      valuationLabel: "正常",
    },
    normal_oscillation: {
      title: "市场波动",
      description: "宽基指数基金在正常估值区间波动。",
      valuationLabel: "正常",
    },
    overvalued: {
      title: "阶段高估",
      description: "宽基指数基金进入阶段高估区间。",
      valuationLabel: "高估",
    },
    pullback: {
      title: "市场回落",
      description: "宽基指数基金净值从前期位置回落。",
      valuationLabel: "正常",
    },
  };
  const config = stageConfig[stage] || stageConfig.low_oscillation;
  const dcaControlChoice = isActive ? pauseChoice : dcaStatus === "paused" ? resumeChoice : startChoice;
  const choices = [continueChoice, addChoice, dcaControlChoice, sellHalfChoice, sellAllChoice];
  return {
    stage,
    ...config,
    returnRate,
    choices,
  };
}

function sellDcaHolding(plan, ratio, stage = null, options = {}) {
  const dcaStatusBeforeSale = getInvestmentDcaStatus(plan);
  const holdingPrincipal = getDcaHoldingPrincipal(plan);
  const sale = window.CashGameCore.calculateFundSale({
    shares: plan.shares,
    holdingPrincipal,
    ratio,
    nav: plan.nav,
  });
  const { soldPrincipal, soldAmount } = sale;

  plan.shares = sale.remainingShares;
  plan.holdingPrincipal = sale.remainingPrincipal;
  plan.soldPrincipal = (plan.soldPrincipal || 0) + soldPrincipal;
  plan.realizedAmount = (plan.realizedAmount || 0) + soldAmount;
  plan.realizedProfit = (plan.realizedProfit || 0) + sale.realizedProfit;
  plan.lastSoldAmount = soldAmount;
  plan.actionHistory = Array.isArray(plan.actionHistory) ? plan.actionHistory : [];
  const saleAction = options.action || (ratio >= 1 ? "sell_all" : "sell_half");
  plan.actionHistory.push({
    month: player.currentMonth,
    action: saleAction,
    amount: soldAmount,
    principal: soldPrincipal,
    nav: plan.nav,
    shares: sale.soldShares,
    stage,
    emergency: Boolean(options.emergency),
  });
  player.savings += soldAmount;
  removeDcaMonthlyEffect();

  if (plan.holdingPrincipal <= 0) {
    plan.holdingPrincipal = 0;
    plan.holdingStatus = "sold_all";
    if (dcaStatusBeforeSale === "active") plan.dcaStatus = "paused";
  } else {
    plan.holdingStatus = "holding";
    if (dcaStatusBeforeSale === "active") {
      plan.dcaStatus = "paused";
      plan.pauseCount = (plan.pauseCount || 0) + 1;
    }
  }
  syncInvestmentLegacyStatus(plan);

  updateLowestSavingsAndBuffer();
  return soldAmount;
}

function getDcaResultLabel(plan) {
  if (getInvestmentHoldingStatus(plan) === "sold_all") return "已卖出";
  if (plan.marketStage === "market_rise") return "净值上涨";
  if (plan.marketStage === "market_drop") return "净值下跌";
  if (plan.marketStage === "market_flat") return "市场震荡";
  if (plan.marketStage === "overvalued") return "阶段高估";
  if (plan.marketStage === "recovered") return "估值修复";
  if (plan.marketStage === "pullback") return "市场回落";
  if (plan.marketStage === "normal_oscillation") return "正常估值";
  if (plan.marketStage === "low_drop") return "低估下跌";
  if (plan.marketStage === "low_oscillation") return "低位震荡";
  if (getInvestmentDcaStatus(plan) === "paused") return "暂停后持有";
  if (getInvestmentDcaStatus(plan) === "never_started") return "单笔持有";
  return "仍在持有";
}

function getProtectionPlan() {
  return player?.longTermPlans?.find((plan) => plan.id === "basic_protection_001" && plan.status === "active");
}

function getAnyProtectionPlan() {
  return player?.longTermPlans?.find((plan) => plan.id === "basic_protection_001");
}

function formatActiveEffectLine(effect, prefix = "常规月") {
  const target = effect?.target?.startsWith("expense") ? "支出" : "收入";
  const amount = effect?.target?.endsWith("_percent")
    ? formatPercent(effect.amount)
    : formatSignedMoney(effect.amount);
  return `${prefix}${target} ${amount}${durationSuffix(effect.duration)}`;
}

function removeDcaMonthlyEffect() {
  player.activeEffects = player.activeEffects.filter(
    (effect) => effect.sourcePlanId !== "index_dca_001" && effect.sourcePlanId !== "index_fund_001",
  );
}

function removeProtectionMonthlyEffect() {
  player.activeEffects = player.activeEffects.filter((effect) => effect.sourcePlanId !== "basic_protection_001");
}

function applyProtectionToSavingsChange(amount, event) {
  const plan = getProtectionPlan();
  const result = window.CashGameCore.calculateProtectionChange(amount, plan, isProtectionEligibleEvent(event));
  if (!plan || result.reduction <= 0) return result.adjustedAmount;
  plan.totalReduced = result.totalReduced;
  const reduction = result.reduction;
  player.tempProtectionReduction = (player.tempProtectionReduction || 0) + reduction;
  return result.adjustedAmount;
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
    originalLoss: loss,
    actualLoss: loss - reduction,
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
    return `${effect.triggerDelay || 1} 个月后，${formatActiveEffectLine(effect, "常规月")}`;
  }
  if (effect.type === "schedule_savings_effect") {
    return `${effect.triggerDelay || 1} 个月后，现金储备 ${formatSignedMoney(effect.amount)}`;
  }
  if (effect.type === "schedule_savings_by_income_percent") {
    return `${effect.triggerDelay || 1} 个月后，现金储备 ${formatSignedMoney(player.baseIncome * effect.amount)}`;
  }
  if (effect.type === "schedule_random_savings_effect") {
    return `${effect.triggerDelay || 1} 个月后结算结果`;
  }
  if (effect.type === "bonus_invest_or_reserve") return bonusInvestOrReserveText(effect);
  if (effect.type === "invest_or_reserve") return investOrReserveText(effect.amount || 0, effect.investPercent || 0.5);
  if (effect.type === "start_fund_investment") return `现金储备 ${formatSignedMoney(-effect.initialAmount)}；买入指数基金`;
  if (effect.type === "start_dca_plan") return `每月投资投入 ${formatSignedMoney(-effect.monthlyAmount)}`;
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
    return `${effect.triggerDelay || 1} 个月后，${formatActiveEffectLine(effect, "月")}`;
  }
  if (
    effect.type === "schedule_savings_effect" ||
    effect.type === "schedule_savings_by_income_percent" ||
    effect.type === "schedule_random_savings_effect"
  ) {
    return "";
  }
  if (effect.type === "bonus_invest_or_reserve") return bonusInvestOrReserveText(effect);
  if (effect.type === "invest_or_reserve") return investOrReserveText(effect.amount || 0, effect.investPercent || 0.5);
  if (effect.type === "start_fund_investment") return `现金储备 -${currencyFormatter.format(effect.initialAmount)} 元；买入指数基金`;
  if (effect.type === "start_dca_plan") return `每月投资投入 -${currencyFormatter.format(effect.monthlyAmount)} 元`;
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
  if (
    effect.type === "schedule_savings_effect" ||
    effect.type === "schedule_savings_by_income_percent" ||
    effect.type === "schedule_random_savings_effect"
  ) {
    return 0;
  }
  if (effect.type === "bonus_invest_or_reserve") return 1;
  if (effect.type === "invest_or_reserve") return 1;
  if (
    effect.type === "start_fund_investment" ||
    effect.type === "start_dca_plan" ||
    effect.type === "start_protection_plan" ||
    effect.type === "career_course_plan" ||
    effect.type === "buy_car"
  ) return -1;
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
  if (plan && getInvestmentDcaStatus(plan) === "active") {
    const investAmount = Math.round(amount * investPercent);
    const reserveAmount = amount - investAmount;
    return `定投加码 ${formatMoney(investAmount)}；现金储备 +${currencyFormatter.format(reserveAmount)} 元`;
  }
  return `现金储备 +${currencyFormatter.format(amount)} 元`;
}

function applyInvestOrReserve(amount, investPercent = 0.5) {
  const totalAmount = Math.round(amount || 0);
  const plan = getDcaPlan();
  const canInvest = plan && getInvestmentDcaStatus(plan) === "active";

  if (!canInvest) {
    player.savings += totalAmount;
    return;
  }

  const investAmount = Math.round(totalAmount * investPercent);
  const reserveAmount = totalAmount - investAmount;
  recordInvestmentPurchase(plan, investAmount, "extra_buy");
  player.savings += reserveAmount;
}

function planStatusText(status) {
  if (status === "active") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "sold_all") return "已卖出";
  if (status === "expired") return "已到期";
  return "未开始";
}

function investmentPlanStatusText(plan) {
  if (getInvestmentHoldingStatus(plan) === "sold_all") return "已卖出";
  const dcaStatus = getInvestmentDcaStatus(plan);
  if (dcaStatus === "active") return "定投进行中";
  if (dcaStatus === "paused") return "定投已暂停，继续持有";
  return "单笔持有，尚未定投";
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

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateSettlementCard() {
  if (prefersReducedMotion()) return;
  const card = document.querySelector(".modal .settlement-card");
  if (!card) return;
  window.requestAnimationFrame(() => card.classList.add("is-emphasized"));
}

function randomInt(min, max) {
  return Math.floor(randomFloat() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[Math.floor(randomFloat() * items.length)];
}

function generateId(prefix) {
  return `${prefix}_${player?.currentMonth || 0}_${Math.floor(randomFloat() * 0xffffffff).toString(16)}`;
}

function randomFloat() {
  if (!debugMode) return Math.random();
  const currentState = Number.isFinite(player?.randomState) ? player.randomState : debugRandomState;
  const next = window.CashGameCore.nextSeededRandom(currentState);
  debugRandomState = next.state;
  if (player) player.randomState = next.state;
  return next.value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openModal(html, backdropClass = "") {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = `modal-backdrop ${backdropClass}`.trim();
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(backdrop);
}

function closeModal() {
  document.querySelectorAll(".modal-backdrop").forEach((node) => node.remove());
}

function resolveChoiceFromButton(button) {
  if (!button || button.classList.contains("is-selected")) return;
  const list = button.closest(".choice-list");
  list?.querySelectorAll(".choice-button").forEach((item) => {
    item.disabled = true;
  });
  button.classList.add("is-selected");
  const delay = prefersReducedMotion() ? 0 : 170;
  window.setTimeout(() => confirmEvent(button.dataset.eventId, button.dataset.choiceIndex), delay);
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

function resumeLoadedGame() {
  lastDice = null;
  if (player.gameEnded) {
    renderResultPage();
    return;
  }
  renderGamePage("已继续上次游戏。", { skipEcho: true });
  if (pendingMonthlySummary) {
    window.setTimeout(() => {
      if (shouldShowDetailedSettlement(pendingMonthlySummary)) showMonthlySummary();
      else endMonth({ quick: true });
    }, 120);
    return;
  }
  if (player.pendingTransition?.quickFeedback) {
    window.setTimeout(() => showTurnFeedback(player.pendingTransition.quickFeedback, { continueTransition: true }), 120);
    return;
  }
  if (player.pendingEchoes?.length) {
    window.setTimeout(showNextScheduledEcho, 120);
    return;
  }
  if (player.pendingTransition) showPendingMarketQuoteOrFinish();
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

  if (action === "start-game") {
    trackEvent("cash_game_start_clicked", {
      // 记录：玩家从海报首页进入身份筛选页。
      had_saved_game: savedGameAvailable,
    });
    selectedMaxMonth = challengeLengths.includes(Number(debugParams.get("months")))
      ? Number(debugParams.get("months"))
      : DEFAULT_CHALLENGE_LENGTH;
    preloadGameVisuals();
    renderRandomIdentity();
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
      trackEvent("cash_game_resumed", {
        // 记录：玩家继续上次游戏，用于观察存档入口是否有用。
        month: player.currentMonth,
        challenge_length: player.maxMonth,
      });
      resumeLoadedGame();
    } else {
      savedGameAvailable = false;
      renderHome();
    }
  }

  if (action === "restart") {
    restartGame();
  }

  if (action === "replay-identity") replayCurrentIdentity();

  if (action === "feedback") openFeedbackEntry();

  if (action === "score-info") showScoreInfo();

  if (action === "roll") rollDice();

  if (action === "confirm-event") confirmEvent(target.dataset.eventId);

  if (action === "choose-event") resolveChoiceFromButton(target);

  if (action === "end-month") endMonth();

  if (action === "history") renderHistory();

  if (action === "current-statuses") renderCurrentStatuses();

  if (action === "investment-history") renderInvestmentHistory();

  if (action === "game-menu") renderGameMenu();

  if (action === "debug-panel") renderDebugPanel();

  if (action === "debug-market") {
    debugForcedMarketQuote = true;
    closeModal();
    renderGamePage("下一次月度结算后将触发市场先生报价。", { skipEcho: true });
    showToast("已安排下一次市场先生报价。");
  }

  if (action === "debug-copy") copyDebugDiagnostic();

  if (action === "debug-reset-onboarding") resetDebugOnboarding();

  if (action === "show-rules") startOnboarding(true);

  if (action === "request-restart") requestRestart();

  if (action === "confirm-restart") restartGame();

  if (action === "next-onboarding") nextOnboardingStep();

  if (action === "skip-onboarding") finishOnboarding("skipped");

  if (action === "end-now") requestEndGame();

  if (action === "confirm-end-now") endGameNow();

  if (action === "continue-echo") continueScheduledEcho();

  if (action === "market-quote") renderMarketQuote("manual_map");

  if (action === "market-quote-choice") handleMarketQuoteChoice(target.dataset.choice);

  if (action === "close-market-quote") closeMarketQuote();

  if (action === "cash-rescue-choice") handleCashRescueChoice(target.dataset.choice);

  if (action === "continue-cash-rescue") continueAfterCashRescue();

  if (action === "close-modal") closeModal();

});

document.addEventListener("submit", (event) => {
  if (event.target.id === "feedbackForm") {
    event.preventDefault();
    submitLocalFeedback(event.target).catch(() => showToast("反馈生成失败，请稍后再试。"));
    return;
  }

  if (event.target.id === "debugStateForm") {
    event.preventDefault();
    if (!debugMode || !player) return;
    const seed = String(event.target.seed.value || "cash-game-debug").trim() || "cash-game-debug";
    const month = Math.max(1, Math.min(player.maxMonth, Number(event.target.month.value) || 1));
    const savings = Number(event.target.savings.value);
    debugSeedText = seed;
    debugRandomState = window.CashGameCore.normalizeSeed(seed);
    player.randomState = debugRandomState;
    player.debugSeed = seed;
    player.currentMonth = month;
    player.completedMonths = Math.max(0, month - 1);
    if (Number.isFinite(savings)) player.savings = savings;
    updateLowestSavingsAndBuffer();
    saveGame();
    closeModal();
    renderGamePage("测试状态已应用。", { skipEcho: true });
    showToast("测试状态已应用。");
    return;
  }

  if (event.target.id === "debugEventForm") {
    event.preventDefault();
    if (!debugMode) return;
    const eventId = String(event.target.eventId.value || "");
    if (!eventCards.some((card) => card.id === eventId)) return;
    debugForcedEventId = eventId;
    closeModal();
    renderGamePage("下一张测试卡已指定，掷骰后触发。", { skipEcho: true });
    showToast("下一张测试卡已指定。");
    return;
  }

  if (event.target.id !== "customForm") return;
  event.preventDefault();
  const identity = validateCustomForm(event.target);
  if (identity) startGame(identity, identity.maxMonth);
});

if (debugMode) {
  window.CashGameDebug = {
    forceNextEvent(eventId) {
      debugForcedEventId = eventId;
    },
    forceMarketQuote() {
      debugForcedMarketQuote = true;
    },
    setSeed(seed) {
      debugSeedText = String(seed || "cash-game-debug");
      debugRandomState = window.CashGameCore.normalizeSeed(debugSeedText);
      if (player) player.randomState = debugRandomState;
    },
    setMonth(month) {
      if (!player) return;
      player.currentMonth = Math.max(1, Math.min(player.maxMonth, Number(month) || 1));
      player.completedMonths = Math.max(0, player.currentMonth - 1);
      saveGame();
      renderGamePage("测试月份已更新。", { skipEcho: true });
    },
    setSavings(amount) {
      if (!player) return;
      player.savings = Number(amount) || 0;
      updateLowestSavingsAndBuffer();
      saveGame();
      renderGamePage("测试现金储备已更新。", { skipEcho: true });
    },
    getState() {
      return JSON.parse(JSON.stringify(player));
    },
    getDiagnostic() {
      return getDebugDiagnostic();
    },
  };
}

init();
