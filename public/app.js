const elements = {
  gameShell: document.querySelector("#game-shell"),
  lobbyScreen: document.querySelector("#lobby-screen"),
  lobbyAccountName: document.querySelector("#lobby-account-name"),
  lobbyAccountTokens: document.querySelector("#lobby-account-tokens"),
  lobbyLogoutButton: document.querySelector("#lobby-logout-button"),
  gameLayout: document.querySelector("#game-layout"),
  leftPanelToggle: document.querySelector("#left-panel-toggle"),
  rightPanelToggle: document.querySelector("#right-panel-toggle"),
  topLeftPanelToggle: document.querySelector("#top-left-panel-toggle"),
  topRightPanelToggle: document.querySelector("#top-right-panel-toggle"),
  layoutResetButton: document.querySelector("#layout-reset-button"),
  roomCount: document.querySelector("#room-count"),
  roomList: document.querySelector("#room-list"),
  createRoomForm: document.querySelector("#create-room-form"),
  roomNameInput: document.querySelector("#room-name-input"),
  roomPasswordInput: document.querySelector("#room-password-input"),
  joinDialog: document.querySelector("#join-dialog"),
  joinRoomForm: document.querySelector("#join-room-form"),
  joinRoomTitle: document.querySelector("#join-room-title"),
  joinRoomPassword: document.querySelector("#join-room-password"),
  cancelJoinButton: document.querySelector("#cancel-join-button"),
  experimentDialog: document.querySelector("#experiment-dialog"),
  experimentForm: document.querySelector("#experiment-form"),
  experimentConsent: document.querySelector("#experiment-consent"),
  cancelExperimentButton: document.querySelector("#cancel-experiment-button"),
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  usernameInput: document.querySelector("#username-input"),
  passwordInput: document.querySelector("#password-input"),
  passwordConfirmInput: document.querySelector("#password-confirm-input"),
  confirmPasswordField: document.querySelector("#confirm-password-field"),
  authTabs: [...document.querySelectorAll("[data-auth-mode]")],
  authSubmit: document.querySelector("#auth-submit"),
  authNote: document.querySelector("#auth-note"),
  playerLogoutButton: document.querySelector("#player-logout-button"),
  currentRoomName: document.querySelector("#current-room-name"),
  roomOwnerLabel: document.querySelector("#room-owner-label"),
  roomBotControl: document.querySelector("#room-bot-control"),
  botCount: document.querySelector("#bot-count"),
  addBotButton: document.querySelector("#add-bot-button"),
  removeBotButton: document.querySelector("#remove-bot-button"),
  inviteForm: document.querySelector("#invite-form"),
  inviteUser: document.querySelector("#invite-user"),
  leaveRoomButton: document.querySelector("#leave-room-button"),
  connectionStatus: document.querySelector("#connection-status"),
  streetLabel: document.querySelector("#street-label"),
  pot: document.querySelector("#pot"),
  board: document.querySelector("#board"),
  handInsight: document.querySelector("#hand-insight"),
  seatRing: document.querySelector("#seat-ring"),
  handHistory: document.querySelector("#hand-history"),
  playerCount: document.querySelector("#player-count"),
  blindLevel: document.querySelector("#blind-level"),
  rulesBlinds: document.querySelector("#rules-blinds"),
  rulesBuyin: document.querySelector("#rules-buyin"),
  rulesBetRange: document.querySelector("#rules-bet-range"),
  rulesMinRaise: document.querySelector("#rules-min-raise"),
  statusCopy: document.querySelector("#status-copy"),
  turnCopy: document.querySelector("#turn-copy"),
  callCopy: document.querySelector("#call-copy"),
  foldButton: document.querySelector("#fold-button"),
  checkButton: document.querySelector("#check-button"),
  callButton: document.querySelector("#call-button"),
  raiseButton: document.querySelector("#raise-button"),
  raiseSlider: document.querySelector("#raise-slider"),
  raiseOutput: document.querySelector("#raise-output"),
  toast: document.querySelector("#toast"),
  soundButton: document.querySelector("#sound-button")
};

let me = null;
let latestState = null;
let soundOn = false;
let toastTimer = null;
let requestInFlight = false;
let actionInFlight = false;
let lastTurnPlayerId = null;
let authMode = "login";
let pendingRoomId = null;

const suitGlyphs = { S: "&spades;", H: "&hearts;", D: "&diams;", C: "&clubs;" };
const avatarColors = ["#5f7d7f", "#9a7554", "#697e54", "#795d87", "#4c7287"];

function tokenTier(tokens) {
  if (tokens >= 100000) return { id: "crimson", label: "至尊" };
  if (tokens >= 20000) return { id: "gold", label: "大师" };
  if (tokens >= 5000) return { id: "blue", label: "高手" };
  if (tokens >= 1000) return { id: "green", label: "进阶" };
  return { id: "stone", label: "新手" };
}

function applySidebarState(state) {
  elements.gameLayout.classList.toggle("left-collapsed", state.left);
  elements.gameLayout.classList.toggle("right-collapsed", state.right);
  const controls = [
    [elements.leftPanelToggle, elements.topLeftPanelToggle, state.left, "›", "‹", "左侧栏"],
    [elements.rightPanelToggle, elements.topRightPanelToggle, state.right, "‹", "›", "右侧栏"]
  ];
  controls.forEach(([panelControl, topControl, collapsed, collapsedIcon, openIcon, label]) => {
    const action = `${collapsed ? "展开" : "收起"}${label}`;
    [panelControl, topControl].forEach((control) => {
      control.textContent = collapsed ? collapsedIcon : openIcon;
      control.setAttribute("aria-label", action);
      control.dataset.tooltip = action;
    });
  });
}

let sidebarState = { left: false, right: false };

function toggleSidebar(side) {
  sidebarState = { ...sidebarState, [side]: !sidebarState[side] };
  applySidebarState(sidebarState);
}

function resetSidebarLayout() {
  sidebarState = { left: false, right: false };
  applySidebarState(sidebarState);
}

function formatChips(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount < 1000) return new Intl.NumberFormat("zh-CN").format(amount);

  const units = [[1_000_000_000, "B"], [1_000_000, "M"], [1_000, "k"]];
  let [scale, suffix] = units.find(([unit]) => amount >= unit);
  let normalized = amount / scale;
  if (normalized >= 999.995 && scale < 1_000_000_000) {
    const next = units[units.findIndex(([unit]) => unit === scale) - 1];
    if (next) {
      [scale, suffix] = next;
      normalized = amount / scale;
    }
  }
  const digits = normalized >= 100 ? 0 : normalized >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "")}${suffix}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function localizeHistoryEntry(entry) {
  const scoreNames = {
    "High card": "高牌",
    "One pair": "一对",
    "Two pair": "两对",
    "Three of a kind": "三条",
    Straight: "顺子",
    Flush: "同花",
    "Full house": "葫芦",
    "Four of a kind": "四条",
    "Straight flush": "同花顺"
  };
  if (entry === "Room created. Waiting for players.") return "房间已创建，等待玩家。";
  if (entry === "Waiting for enough players.") return "等待足够的玩家。";
  if (entry === "Admin updated table rules. New rules begin next hand.") return "管理员更新了牌局规则，将在下一手生效。";
  let match = entry.match(/^(.+) joins the table\.$/);
  if (match) return `${match[1]} 加入了牌桌。`;
  match = entry.match(/^(.+) invited (.+)\.$/);
  if (match) return `${match[1]} 邀请了 ${match[2]}。`;
  match = entry.match(/^(.+) posts (small blind|big blind) (\d+)\.$/);
  if (match) return `${match[1]} 下${match[2] === "small blind" ? "小盲注" : "大盲注"} ${match[3]}。`;
  match = entry.match(/^(.+) folds\.$/);
  if (match) return `${match[1]} 弃牌。`;
  match = entry.match(/^(.+) checks\.$/);
  if (match) return `${match[1]} 过牌。`;
  match = entry.match(/^(.+) calls (\d+)\.$/);
  if (match) return `${match[1]} 跟注 ${match[2]}。`;
  match = entry.match(/^(.+) raises to (\d+)\.$/);
  if (match) return `${match[1]} 加注到 ${match[2]}。`;
  match = entry.match(/^(.+)'s turn\.$/);
  if (match) return `轮到 ${match[1]}。`;
  match = entry.match(/^Hand begins\. (.+) has the dealer button\.$/);
  if (match) return `牌局开始，${match[1]} 担任庄家。`;
  match = entry.match(/^(.+): (.+)\.$/);
  if (match && ["Flop", "Turn", "River"].includes(match[1])) {
    return `${{ Flop: "翻牌", Turn: "转牌", River: "河牌" }[match[1]]}：${match[2]}。`;
  }
  match = entry.match(/^(.+) wins (\d+) without a showdown\.$/);
  if (match) return `${match[1]} 未经摊牌赢得 ${match[2]} Token。`;
  match = entry.match(/^(.+) win (\d+) with (.+)\.$/);
  if (match) return `${match[1]} 以${scoreNames[match[3]] || match[3]}赢得 ${match[2]} Token。`;
  match = entry.match(/^Admin grants (\d+) Token to every seated player\.$/);
  if (match) return `管理员给所有在座玩家发放 ${match[1]} Token。`;
  match = entry.match(/^Admin grants (\d+) Token to (.+)\.$/);
  if (match) return `管理员给 ${match[2]} 发放 ${match[1]} Token。`;
  return entry;
}

const handTypeNames = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const suitNames = { S: "♠", H: "♥", D: "♦", C: "♣" };
const rankNames = { T: "10", J: "J", Q: "Q", K: "K", A: "A" };

function cardKey(card) {
  return `${card.rank}${card.suit}`;
}

function cardText(card) {
  return `${rankNames[card.rank] || card.rank}${suitNames[card.suit] || card.suit}`;
}

function cardRankValue(rank) {
  return ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"].indexOf(rank) + 2;
}

function compareHandScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function evaluateFiveCards(cards) {
  const values = cards.map((card) => cardRankValue(card.rank)).sort((a, b) => b - a);
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const unique = [...new Set(values)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    if (unique.join(",") === "14,5,4,3,2") straightHigh = 5;
  }
  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return [2, Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)];
  return [0, ...values];
}

function bestVisibleHand(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const selected = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = evaluateFiveCards(selected);
            if (!best || compareHandScores(score, best.score) > 0) best = { score, cards: selected };
          }
        }
      }
    }
  }
  return best;
}

function handInsightFor(state) {
  const player = state.players.find((candidate) => candidate.id === me?.id);
  const holeCards = player?.cards || [];
  const visibleCards = [...holeCards, ...state.board];
  if (!holeCards.length) return { text: "等待你的底牌", keys: new Set() };
  if (visibleCards.length < 5) {
    return { text: `等待公共牌（已有 ${visibleCards.length} 张可用牌）`, keys: new Set() };
  }
  const best = bestVisibleHand(visibleCards);
  const keys = new Set(best.cards.map(cardKey));
  return {
    text: `你当前能组成：${handTypeNames[best.score[0]]} · 使用 ${best.cards.map(cardText).join(" ")}`,
    keys
  };
}

function cardHtml(card, hidden = false, highlighted = false, backTier = "stone") {
  if (hidden) return `<span class="card card-back tier-${backTier}" aria-label="暗牌"></span>`;
  if (!card) return "";
  const red = card.suit === "H" || card.suit === "D";
  const suit = suitGlyphs[card.suit];
  return `
    <span class="card ${red ? "red" : ""} ${highlighted ? "hand-highlight" : ""}" data-card-key="${cardKey(card)}" aria-label="${card.rank}${card.suit}">
      <span>${card.rank}</span>
      <span class="suit-large">${suit}</span>
      <span class="rank-bottom">${card.rank}</span>
    </span>
  `;
}

function showToast(message) {
  if (!message) return;
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function playTurnTone() {
  if (!soundOn) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 620;
  gain.gain.setValueAtTime(0.05, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.16);
  oscillator.addEventListener("ended", () => context.close());
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  elements.authTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
  elements.confirmPasswordField.hidden = !registering;
  elements.passwordInput.autocomplete = registering ? "new-password" : "current-password";
  elements.passwordConfirmInput.required = registering;
  elements.authSubmit.textContent = registering ? "注册并入座" : "登录并入座";
  elements.authNote.textContent = registering
    ? "账号和初始 Token 会保存到当前服务器。"
    : "首次使用请先注册；登录状态会保留在此浏览器中。";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "服务器响应无效。" }));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "请求失败。", { cause: payload.state });
  return payload;
}

function updateRaiseSlider(controls) {
  const min = Math.max(controls.minRaiseTo || 0, 0);
  const max = Math.max(controls.maxRaiseTo || min, min);
  const current = Number(elements.raiseSlider.value);
  elements.raiseSlider.min = min;
  elements.raiseSlider.max = max;
  elements.raiseSlider.step = latestState?.smallBlind || 25;
  elements.raiseSlider.value = Math.min(Math.max(current || min, min), max);
  elements.raiseOutput.value = formatChips(elements.raiseSlider.value);
}

function renderSeats(state) {
  elements.seatRing.innerHTML = "";
  const visualPlayers = me
    ? [...state.players.filter((player) => player.id !== me.id), ...state.players.filter((player) => player.id === me.id)]
    : state.players;
  const opponentCount = visualPlayers.filter((player) => player.id !== me?.id).length;
  elements.seatRing.dataset.opponents = opponentCount;
  let opponentIndex = 0;

  visualPlayers.forEach((player, index) => {
    const seat = document.createElement("article");
    const isCurrent = player.id === state.currentPlayerId;
    const isMe = player.id === me?.id;
    const positionClass = isMe ? "me-seat" : `opponent-${opponentIndex++}`;
    const tier = tokenTier(player.stack);
    seat.className = `seat tier-${tier.id} ${positionClass} ${isCurrent ? "active" : ""} ${player.folded ? "folded" : ""}`;
    seat.title = `Token 等级：${tier.label}`;
    seat.style.setProperty("--avatar", avatarColors[index % avatarColors.length]);

    const initials = player.name.slice(0, 2).toUpperCase();
    const handKeys = isMe ? handInsightFor(state).keys : new Set();
    const cards = player.cards?.length
      ? player.cards.map((card) => cardHtml(card, false, handKeys.has(cardKey(card)))).join("")
      : (player.inHand ? `${cardHtml(null, true, false, tier.id)}${cardHtml(null, true, false, tier.id)}` : "");
    const actionBet = player.bet > 0 ? `<span class="action-bet">${formatChips(player.bet)}</span>` : "";
    const dealer = player.seat === state.dealerIndex ? '<span class="dealer-chip">D</span>' : "";
    const status = player.folded ? "已弃牌" : player.allIn ? "全下" : isCurrent ? "思考中" : player.connected ? "" : "离线";

    seat.innerHTML = `
      <div class="hole-cards">${cards}</div>
      <div class="seat-player">
        <span class="avatar">${initials}</span>
        <div class="seat-copy">
          <div class="seat-name">${player.name}${isMe ? "（你）" : ""}</div>
          <div class="seat-stack">${formatChips(player.stack)}${status ? ` &middot; ${status}` : ""}</div>
        </div>
        ${dealer}
      </div>
      ${actionBet}
    `;
    elements.seatRing.append(seat);
  });
}

function renderControls(state) {
  const controls = state.controls;
  const current = state.players.find((player) => player.id === state.currentPlayerId);
  const myPlayer = state.players.find((player) => player.id === me?.id);
  const canAct = controls.canAct && !actionInFlight;
  const toCall = controls.toCall || 0;
  const canRaise = controls.minRaiseTo <= controls.maxRaiseTo;

  elements.foldButton.disabled = !canAct;
  elements.checkButton.disabled = !canAct || toCall > 0;
  elements.callButton.disabled = !canAct || toCall === 0;
  elements.raiseButton.disabled = !canAct || !canRaise;
  elements.raiseSlider.disabled = !canAct || !canRaise;
  elements.callButton.textContent = toCall ? `跟注 ${formatChips(toCall)}` : "跟注";
  updateRaiseSlider(controls);

  if (!me) {
    elements.turnCopy.textContent = "等待入座";
    elements.callCopy.textContent = "-";
    elements.statusCopy.textContent = "登录账号后即可加入牌桌。";
  } else if (controls.canAct) {
    elements.turnCopy.textContent = "轮到你了";
    elements.callCopy.textContent = toCall ? `需跟注 ${formatChips(toCall)}` : "可以过牌";
    elements.statusCopy.textContent = "请选择弃牌、跟注或加注。";
  } else if (current) {
    elements.turnCopy.textContent = `等待 ${current.name}`;
    elements.callCopy.textContent = current.isBot ? "电脑正在随机决策" : "等待操作";
    elements.statusCopy.textContent = myPlayer?.folded ? "你本手已弃牌，下一局很快开始。" : "正在观看牌桌行动。";
  } else {
    elements.turnCopy.textContent = state.phase === "Showdown" ? "本手结束" : state.phase;
    elements.callCopy.textContent = state.phase === "Showdown" ? "即将开始下一手" : "-";
    elements.statusCopy.textContent = state.phase === "Showdown" ? "亮牌并结算底池。" : "牌桌正在准备。";
  }
}

function renderLobby(state) {
  me = null;
  elements.gameShell.hidden = true;
  elements.lobbyScreen.hidden = false;
  elements.lobbyAccountName.textContent = state.account.displayName;
  elements.lobbyAccountTokens.textContent = `${formatChips(state.account.tokens)} Token`;
  elements.lobbyAccountTokens.className = `tier-text tier-${tokenTier(state.account.tokens).id}`;
  elements.roomCount.textContent = `${state.rooms.length} 个房间`;
  elements.roomList.innerHTML = state.rooms.map((room) => {
    const invited = state.invitations.includes(room.id);
    const access = room.experimentalDeal ? "实验" : invited ? "已邀请" : room.hasPassword ? "密码" : "公开";
    return `<article class="room-item ${invited ? "invited" : ""} ${room.experimentalDeal ? "experiment-room" : ""}">
      <div class="room-item-main"><span class="room-access">${access}</span><h3>${escapeHtml(room.name)}</h3><p>房主 ${escapeHtml(room.ownerName)} · ${room.humanCount} 真人 · ${room.botCount} AI</p></div>
      <div class="room-item-side"><span>${escapeHtml(room.phase)}</span><button class="compact-button" type="button" data-join-room="${room.id}">${room.humanCount + room.botCount >= room.maxSeats && room.handActive ? "已满" : "加入"}</button></div>
    </article>`;
  }).join("") || '<div class="empty-lobby"><strong>暂时没有房间</strong><span>创建一个房间并邀请其他服务器用户。</span></div>';
  state.rooms.forEach((room) => {
    const button = elements.roomList.querySelector(`[data-join-room="${room.id}"]`);
    if (button) button.disabled = room.humanCount + room.botCount >= room.maxSeats && room.handActive;
  });
}

function renderRoomManagement(state) {
  const owner = state.room.ownerAccountId === state.account.id;
  elements.currentRoomName.textContent = state.room.name;
  elements.roomOwnerLabel.textContent = owner ? "你是房主" : `房主 ${state.room.ownerName}`;
  elements.roomBotControl.hidden = !owner;
  elements.inviteForm.hidden = !owner;
  elements.botCount.textContent = state.room.botTarget;
  elements.removeBotButton.disabled = state.room.botTarget <= 0;
  elements.addBotButton.disabled = state.room.humanCount + state.room.botTarget >= state.room.maxSeats;
  const users = state.users || [];
  elements.inviteUser.innerHTML = users.map((user) => `<option value="${user.id}">${escapeHtml(user.displayName)}（${escapeHtml(user.username)}）${user.online ? " · 已在房间" : ""}</option>`).join("");
  elements.inviteUser.disabled = users.length === 0;
  elements.inviteForm.querySelector("button").disabled = users.length === 0;
}

function renderTable(state) {
  const previousTurn = lastTurnPlayerId;
  me = state.me;
  lastTurnPlayerId = state.currentPlayerId;

  elements.gameShell.hidden = false;
  elements.lobbyScreen.hidden = true;
  elements.playerLogoutButton.hidden = !me;
  renderRoomManagement(state);
  elements.streetLabel.textContent = state.streetLabel;
  elements.pot.innerHTML = `底池 <strong>${formatChips(state.pot)}</strong>`;
  const handInsight = handInsightFor(state);
  elements.board.innerHTML = state.board.map((card) => cardHtml(card, false, handInsight.keys.has(cardKey(card)))).join("");
  elements.handInsight.textContent = handInsight.text;
  elements.handHistory.innerHTML = state.log.map((entry) => `<div class="history-item">${escapeHtml(localizeHistoryEntry(entry))}</div>`).join("");
  elements.playerCount.textContent = `${state.players.filter((player) => !player.isBot).length} / 5`;
  elements.blindLevel.textContent = `${formatChips(state.smallBlind)} / ${formatChips(state.bigBlind)}`;
  elements.rulesBlinds.textContent = elements.blindLevel.textContent;
  elements.rulesBuyin.textContent = formatChips(state.startingTokens);
  elements.rulesBetRange.textContent = state.maximumBet === null
    ? `${formatChips(state.minimumBet)} - 不限`
    : `${formatChips(state.minimumBet)} - ${formatChips(state.maximumBet)}`;
  elements.rulesMinRaise.textContent = formatChips(state.minimumRaise);
  renderSeats(state);
  renderControls(state);

  if (me && previousTurn !== me.id && state.currentPlayerId === me.id) playTurnTone();
}

function renderState(state) {
  latestState = state;
  elements.loginScreen.classList.toggle("hidden", state.authenticated);
  if (!state.authenticated) {
    me = null;
    elements.gameShell.hidden = true;
    elements.lobbyScreen.hidden = true;
    return;
  }
  if (state.view === "lobby") renderLobby(state);
  else renderTable(state);
}

async function refreshState() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const payload = await api("/api/state", { method: "GET", headers: {} });
    elements.connectionStatus.textContent = "已连接";
    renderState(payload.state);
  } catch (error) {
    elements.connectionStatus.textContent = "正在重连";
  } finally {
    requestInFlight = false;
  }
}

async function sendAction(action) {
  if (actionInFlight) return;
  actionInFlight = true;
  if (latestState) renderControls(latestState);
  try {
    const payload = await api("/api/action", {
      method: "POST",
      body: JSON.stringify(action)
    });
    renderState(payload.state);
  } catch (error) {
    if (error.cause) renderState(error.cause);
    showToast(error.message);
  } finally {
    actionInFlight = false;
    if (latestState) renderControls(latestState);
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;
  if (!username || !password) return;
  if (authMode === "register" && password !== elements.passwordConfirmInput.value) {
    showToast("两次输入的密码不一致。");
    return;
  }
  elements.authSubmit.disabled = true;
  try {
    const payload = await api(`/api/account/${authMode}`, {
      method: "POST",
      body: JSON.stringify({ username, password, passwordConfirm: elements.passwordConfirmInput.value })
    });
    elements.passwordInput.value = "";
    elements.passwordConfirmInput.value = "";
    renderState(payload.state);
    showToast(`欢迎，${payload.state.account.displayName}。`);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.authSubmit.disabled = false;
  }
});

elements.authTabs.forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
});

async function logout() {
  try {
    await api("/api/account/logout", { method: "POST", body: "{}" });
    me = null;
    latestState = null;
    elements.loginForm.reset();
    setAuthMode("login");
    await refreshState();
    showToast("已退出登录。");
  } catch (error) {
    showToast(error.message);
  }
}

elements.playerLogoutButton.addEventListener("click", logout);
elements.lobbyLogoutButton.addEventListener("click", logout);
elements.leftPanelToggle.addEventListener("click", () => toggleSidebar("left"));
elements.rightPanelToggle.addEventListener("click", () => toggleSidebar("right"));
elements.topLeftPanelToggle.addEventListener("click", () => toggleSidebar("left"));
elements.topRightPanelToggle.addEventListener("click", () => toggleSidebar("right"));
elements.layoutResetButton.addEventListener("click", resetSidebarLayout);

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/rooms/create", { method: "POST", body: JSON.stringify({ name: elements.roomNameInput.value, password: elements.roomPasswordInput.value }) });
    elements.createRoomForm.reset();
    renderState(payload.state);
    showToast("房间已创建。");
  } catch (error) {
    showToast(error.message);
  }
});

async function joinRoom(roomId, password = "", experimentConsent = false) {
  const payload = await api("/api/rooms/join", { method: "POST", body: JSON.stringify({ roomId, password, experimentConsent }) });
  pendingRoomId = null;
  elements.joinDialog.hidden = true;
  elements.experimentDialog.hidden = true;
  elements.joinRoomForm.reset();
  elements.experimentForm.reset();
  renderState(payload.state);
  showToast(`已加入 ${payload.state.room.name}。`);
}

elements.roomList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-join-room]");
  if (!button || button.disabled) return;
  const room = latestState.rooms.find((candidate) => candidate.id === button.dataset.joinRoom);
  if (!room) return;
  if (room.requiresExperimentConsent) {
    pendingRoomId = room.id;
    elements.experimentDialog.hidden = false;
    elements.experimentConsent.focus();
    return;
  }
  if (room.hasPassword && !room.invited) {
    pendingRoomId = room.id;
    elements.joinRoomTitle.textContent = `加入 ${room.name}`;
    elements.joinDialog.hidden = false;
    elements.joinRoomPassword.focus();
    return;
  }
  try {
    await joinRoom(room.id);
  } catch (error) {
    showToast(error.message);
  }
});

elements.joinRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await joinRoom(pendingRoomId, elements.joinRoomPassword.value);
  } catch (error) {
    showToast(error.message);
  }
});

elements.cancelJoinButton.addEventListener("click", () => {
  pendingRoomId = null;
  elements.joinDialog.hidden = true;
  elements.joinRoomForm.reset();
});

elements.experimentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.experimentConsent.checked) return;
  try {
    await joinRoom(pendingRoomId, "", true);
  } catch (error) {
    showToast(error.message);
  }
});

elements.cancelExperimentButton.addEventListener("click", () => {
  pendingRoomId = null;
  elements.experimentDialog.hidden = true;
  elements.experimentForm.reset();
});

elements.leaveRoomButton.addEventListener("click", async () => {
  try {
    const payload = await api("/api/rooms/leave", { method: "POST", body: "{}" });
    renderState(payload.state);
    showToast("已退出房间。");
  } catch (error) {
    showToast(error.message);
  }
});

async function changeBots(delta) {
  try {
    const payload = await api("/api/rooms/bots", { method: "POST", body: JSON.stringify({ delta }) });
    renderState(payload.state);
  } catch (error) {
    showToast(error.message);
  }
}

elements.addBotButton.addEventListener("click", () => changeBots(1));
elements.removeBotButton.addEventListener("click", () => changeBots(-1));

elements.inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/rooms/invite", { method: "POST", body: JSON.stringify({ accountId: elements.inviteUser.value }) });
    renderState(payload.state);
    showToast("邀请已发送。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.foldButton.addEventListener("click", () => sendAction({ type: "fold" }));
elements.checkButton.addEventListener("click", () => sendAction({ type: "checkCall" }));
elements.callButton.addEventListener("click", () => sendAction({ type: "checkCall" }));
elements.raiseButton.addEventListener("click", () => {
  sendAction({ type: "raise", raiseTo: Number(elements.raiseSlider.value) });
});
elements.raiseSlider.addEventListener("input", () => {
  elements.raiseOutput.value = formatChips(elements.raiseSlider.value);
});
elements.soundButton.addEventListener("click", () => {
  soundOn = !soundOn;
  elements.soundButton.textContent = soundOn ? "♫" : "♪";
  elements.soundButton.setAttribute("data-tooltip", soundOn ? "提示音已开启" : "提示音已关闭");
  showToast(soundOn ? "回合提示音已开启。" : "回合提示音已关闭。");
});

refreshState();
setInterval(refreshState, 900);
applySidebarState(sidebarState);
