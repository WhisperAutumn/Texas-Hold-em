const elements = {
  shell: document.querySelector("#admin-shell"),
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  password: document.querySelector("#password-input"),
  settingsForm: document.querySelector("#settings-form"),
  grantForm: document.querySelector("#grant-form"),
  grantAmount: document.querySelector("#grant-amount"),
  accountGrantForm: document.querySelector("#account-grant-form"),
  accountGrantAmount: document.querySelector("#account-grant-amount"),
  grantAccount: document.querySelector("#grant-account"),
  accountGrantButton: document.querySelector("#account-grant-button"),
  dealExperimentToggle: document.querySelector("#deal-experiment-toggle"),
  dealExperimentPanel: document.querySelector("#deal-experiment-panel"),
  dealExperimentForm: document.querySelector("#deal-experiment-form"),
  dealExperimentAccount: document.querySelector("#deal-experiment-account"),
  strongChance: document.querySelector("#strong-chance"),
  weakChance: document.querySelector("#weak-chance"),
  dealExperimentSave: document.querySelector("#deal-experiment-save"),
  dealExperimentStatus: document.querySelector("#deal-experiment-status"),
  dealProfileList: document.querySelector("#deal-profile-list"),
  dealExperimentReset: document.querySelector("#deal-experiment-reset"),
  logout: document.querySelector("#logout-button"),
  connection: document.querySelector("#connection-status"),
  phase: document.querySelector("#phase-label"),
  pot: document.querySelector("#pot-label"),
  uptime: document.querySelector("#uptime-label"),
  serverPort: document.querySelector("#server-port"),
  localPlayerUrl: document.querySelector("#local-player-url"),
  lanPlayerUrls: document.querySelector("#lan-player-urls"),
  ruleState: document.querySelector("#rule-state"),
  playerCount: document.querySelector("#player-count"),
  playersBody: document.querySelector("#players-body"),
  accountCount: document.querySelector("#account-count"),
  accountsBody: document.querySelector("#accounts-body"),
  toast: document.querySelector("#toast")
};

let toastTimer = null;
let pollTimer = null;
let settingsHydrated = false;
let dealExperimentHydrated = false;
let latestAdminState = null;

function formatTokens(value) {
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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 3000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "服务器响应无效。" }));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "请求失败。");
  return payload;
}

function setFormValues(settings) {
  Object.entries(settings).forEach(([key, value]) => {
    const input = elements.settingsForm.elements.namedItem(key);
    if (input) input.value = value;
  });
}

function renderPlayers(state) {
  const players = state.table.players;
  elements.playerCount.textContent = `${players.length} 人`;
  elements.playersBody.innerHTML = players.map((player) => {
    const status = player.folded ? "已弃牌" : player.allIn ? "全下" : player.current ? "行动中" : player.connected ? "在线" : "离线";
    const statusClass = player.connected && !player.folded ? "active" : player.connected ? "" : "offline";
    return `<tr>
      <td>${player.name}</td>
      <td>${player.roomName}</td>
      <td class="player-type">${player.isBot ? "AI" : "真人"}</td>
      <td class="player-state ${statusClass}">${status}</td>
      <td class="stack-value">${formatTokens(player.stack)}</td>
      <td>${formatTokens(player.bet)}</td>
    </tr>`;
  }).join("");
}

function formatTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}

function renderAccounts(state) {
  const accounts = state.accounts || [];
  const selectedAccount = elements.grantAccount.value;
  elements.accountCount.textContent = `${accounts.length} 个`;
  elements.grantAccount.innerHTML = accounts.map((account) => `<option value="${account.id}">${account.displayName}（${account.username}） · ${formatTokens(account.tokens)} Token</option>`).join("");
  elements.grantAccount.disabled = accounts.length === 0;
  elements.accountGrantButton.disabled = accounts.length === 0;
  if (accounts.some((account) => account.id === selectedAccount)) elements.grantAccount.value = selectedAccount;
  elements.accountsBody.innerHTML = accounts.map((account) => `
    <tr>
      <td>${account.username}</td>
      <td>${account.displayName}</td>
      <td class="stack-value">${formatTokens(account.tokens)}</td>
      <td class="player-state ${account.online ? "active" : "offline"}">${account.online ? "在线" : "离线"}</td>
      <td>${formatTimestamp(account.lastLoginAt)}</td>
    </tr>
  `).join("") || '<tr><td colspan="5" class="empty-row">暂无账号</td></tr>';
}

function hydrateDealAccount(accountId, profiles) {
  const profile = profiles.find((item) => item.accountId === accountId);
  elements.strongChance.value = profile?.strongChance || 0;
  elements.weakChance.value = profile?.weakChance || 0;
}

function renderDealExperiment(state, hydrate = false) {
  const experiment = state.dealExperiment || { active: false, profiles: [] };
  const profiles = experiment.profiles || [];
  const selectedAccount = elements.dealExperimentAccount.value;
  elements.dealExperimentAccount.innerHTML = (state.accounts || [])
    .map((account) => `<option value="${account.id}">${account.displayName}（${account.username}）</option>`)
    .join("");
  elements.dealExperimentAccount.disabled = !(state.accounts || []).length;
  elements.dealExperimentSave.disabled = !(state.accounts || []).length;
  if ([...elements.dealExperimentAccount.options].some((option) => option.value === selectedAccount)) {
    elements.dealExperimentAccount.value = selectedAccount;
  }
  if (hydrate || !dealExperimentHydrated) {
    hydrateDealAccount(elements.dealExperimentAccount.value, profiles);
    dealExperimentHydrated = true;
  }
  elements.dealExperimentStatus.textContent = profiles.length ? `${profiles.length} 个账号已设置` : "未启用";
  elements.dealProfileList.innerHTML = profiles.map((profile) => `
    <div class="deal-profile-row">
      <span><strong>${profile.displayName}</strong><small>${profile.username}</small></span>
      <span>大牌 ${profile.strongChance}% · 小牌 ${profile.weakChance}%</span>
    </div>
  `).join("") || '<p class="empty-row">暂无 M房发牌参数。</p>';
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`;
}

function renderServer(server) {
  elements.uptime.textContent = `运行 ${formatUptime(server.uptimeSeconds)}`;
  elements.serverPort.textContent = server.port;
  elements.localPlayerUrl.textContent = server.localPlayerUrl;
  const urls = server.lanPlayerUrls.length ? server.lanPlayerUrls : ["未检测到局域网 IPv4 地址"];
  elements.lanPlayerUrls.innerHTML = urls.map((url) => `<button type="button" data-url="${url}">${url}</button>`).join("");
}

function renderState(state, hydrate = false) {
  latestAdminState = state;
  elements.shell.hidden = false;
  elements.loginScreen.classList.add("hidden");
  elements.connection.textContent = "已连接";
  elements.phase.textContent = state.table.phase;
  elements.pot.textContent = `底池 ${formatTokens(state.table.pot)}`;
  elements.ruleState.textContent = state.takesEffectNextHand ? "下一手生效" : "当前已生效";
  renderServer(state.server);
  renderPlayers(state);
  renderAccounts(state);
  renderDealExperiment(state, hydrate);
  if (hydrate) {
    setFormValues(state.pendingSettings);
    settingsHydrated = true;
  }
}

async function refreshState() {
  try {
    const payload = await api("/api/admin/state", { method: "GET", headers: {} });
    renderState(payload.state, !settingsHydrated);
  } catch (error) {
    elements.connection.textContent = "未登录";
    elements.shell.hidden = true;
    elements.loginScreen.classList.remove("hidden");
    if (pollTimer) clearInterval(pollTimer);
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: elements.password.value }) });
    elements.password.value = "";
    renderState(payload.state, true);
    pollTimer = setInterval(refreshState, 2000);
    showToast("管理员登录成功。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(elements.settingsForm).entries());
  try {
    const payload = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
    renderState(payload.state, true);
    showToast("规则已保存，将在下一手生效。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.grantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/grant", { method: "POST", body: JSON.stringify({ amount: Number(elements.grantAmount.value) }) });
    renderState(payload.state);
    showToast("Token 已发放给全桌玩家。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.accountGrantForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/account-grant", {
      method: "POST",
      body: JSON.stringify({ accountId: elements.grantAccount.value, amount: Number(elements.accountGrantAmount.value) })
    });
    renderState(payload.state);
    showToast("Token 已发放给指定账号。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.dealExperimentToggle.addEventListener("click", () => {
  elements.dealExperimentPanel.hidden = !elements.dealExperimentPanel.hidden;
});

elements.dealExperimentAccount.addEventListener("change", () => {
  const profiles = latestAdminState?.dealExperiment?.profiles || [];
  hydrateDealAccount(elements.dealExperimentAccount.value, profiles);
});

elements.dealExperimentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/deal-profile", {
      method: "POST",
      body: JSON.stringify({
        accountId: elements.dealExperimentAccount.value,
        strongChance: Number(elements.strongChance.value),
        weakChance: Number(elements.weakChance.value)
      })
    });
    renderState(payload.state);
    showToast("M房发牌参数已保存。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.dealExperimentReset.addEventListener("click", async () => {
  if (!window.confirm("确定清除全部 M房发牌参数吗？")) return;
  try {
    const payload = await api("/api/admin/deal-profile/reset", { method: "POST", body: "{}" });
    renderState(payload.state);
    showToast("M房发牌参数已清除。即将恢复随机发牌。");
  } catch (error) {
    showToast(error.message);
  }
});

elements.logout.addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => {});
  window.location.reload();
});

elements.lanPlayerUrls.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-url]");
  if (!button || !button.dataset.url.startsWith("http")) return;
  await navigator.clipboard.writeText(button.dataset.url).catch(() => {});
  showToast("玩家地址已复制。");
});

refreshState();
