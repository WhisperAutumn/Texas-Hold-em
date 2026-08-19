const elements = {
  gameShell: document.querySelector("#game-shell"),
  lobbyScreen: document.querySelector("#lobby-screen"),
  lobbyAccountName: document.querySelector("#lobby-account-name"),
  lobbyAccountTokens: document.querySelector("#lobby-account-tokens"),
  lobbyLogoutButton: document.querySelector("#lobby-logout-button"),
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

function formatChips(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function cardHtml(card, hidden = false) {
  if (hidden) return '<span class="card card-back" aria-label="暗牌"></span>';
  if (!card) return "";
  const red = card.suit === "H" || card.suit === "D";
  const suit = suitGlyphs[card.suit];
  return `
    <span class="card ${red ? "red" : ""}" aria-label="${card.rank}${card.suit}">
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
    seat.className = `seat ${positionClass} ${isCurrent ? "active" : ""} ${player.folded ? "folded" : ""}`;
    seat.style.setProperty("--avatar", avatarColors[index % avatarColors.length]);

    const initials = player.name.slice(0, 2).toUpperCase();
    const cards = player.cards?.length
      ? player.cards.map((card) => cardHtml(card)).join("")
      : (player.inHand ? `${cardHtml(null, true)}${cardHtml(null, true)}` : "");
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
  elements.roomCount.textContent = `${state.rooms.length} 个房间`;
  elements.roomList.innerHTML = state.rooms.map((room) => {
    const invited = state.invitations.includes(room.id);
    const access = invited ? "已邀请" : room.hasPassword ? "密码" : "公开";
    return `<article class="room-item ${invited ? "invited" : ""}">
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
  elements.board.innerHTML = state.board.map((card) => cardHtml(card)).join("");
  elements.handHistory.innerHTML = state.log.map((entry) => `<div class="history-item">${entry}</div>`).join("");
  elements.playerCount.textContent = `${state.players.filter((player) => !player.isBot).length} / 5`;
  elements.blindLevel.textContent = `${formatChips(state.smallBlind)} / ${formatChips(state.bigBlind)}`;
  elements.rulesBlinds.textContent = elements.blindLevel.textContent;
  elements.rulesBuyin.textContent = formatChips(state.startingTokens);
  elements.rulesBetRange.textContent = `${formatChips(state.minimumBet)} - ${formatChips(state.maximumBet)}`;
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

async function joinRoom(roomId, password = "") {
  const payload = await api("/api/rooms/join", { method: "POST", body: JSON.stringify({ roomId, password }) });
  pendingRoomId = null;
  elements.joinDialog.hidden = true;
  elements.joinRoomForm.reset();
  renderState(payload.state);
  showToast(`已加入 ${payload.state.room.name}。`);
}

elements.roomList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-join-room]");
  if (!button || button.disabled) return;
  const room = latestState.rooms.find((candidate) => candidate.id === button.dataset.joinRoom);
  if (!room) return;
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
