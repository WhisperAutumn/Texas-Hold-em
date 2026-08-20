const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "riverroom-admin";
const MAX_SEATS = 5;
const TABLE_IDLE_TIMEOUT = 12000;
const ACTION_TIMEOUT_MS = 18000;
const M_ROOM_ID = "m-room";
const M_ROOM_NAME = "M房";
const BOT_NAMES = ["Nova", "Milo", "Iris", "Theo", "Jade"];
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const ROUND_LABELS = ["Pre-flop", "Flop", "Turn", "River", "Showdown"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const settingsFile = path.join(dataDir, "table-settings.json");
const accountsFile = path.join(dataDir, "accounts.json");
const authSecretFile = path.join(dataDir, "auth-secret.txt");
const AUTH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_SETTINGS = {
  startingTokens: 2000,
  smallBlind: 25,
  bigBlind: 50,
  minimumBet: 50,
  maximumBet: 2000,
  minimumRaise: 50
};

function loadTableSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveTableSettings() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(settingsFile, `${JSON.stringify(tableSettings, null, 2)}\n`, "utf8");
}

const tableSettings = loadTableSettings();

function rulesForRoom(experimentalDeal = false) {
  return {
    ...tableSettings,
    // M room has no table cap, but every player remains limited by their own stack.
    maximumBet: experimentalDeal ? null : tableSettings.maximumBet
  };
}

function loadAccounts() {
  try {
    const saved = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    return new Map((Array.isArray(saved) ? saved : []).map((account) => [account.id, account]));
  } catch {
    return new Map();
  }
}

function saveAccounts() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(accountsFile, `${JSON.stringify([...accounts.values()], null, 2)}\n`, "utf8");
}

function loadOrCreateAuthSecret() {
  try {
    const secret = fs.readFileSync(authSecretFile, "utf8").trim();
    if (secret) return secret;
  } catch {
    // The secret is created on the first server start.
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(authSecretFile, `${secret}\n`, "utf8");
  return secret;
}

const accounts = loadAccounts();
const authSecret = loadOrCreateAuthSecret();
const adminSessions = new Set();
function createGame(experimentalDeal = false) {
  return {
    players: [],
    board: [],
    deck: [],
    pot: 0,
    dealerIndex: 0,
    currentIndex: -1,
    street: 0,
    minRaise: tableSettings.minimumRaise,
    rules: rulesForRoom(experimentalDeal),
    currentBet: 0,
    handActive: false,
    phase: "Waiting for players",
    log: ["Room created. Waiting for players."],
    nextHandTimer: null,
    turnTimer: null,
    settlement: null,
    nextHandReady: new Set(),
    version: 0,
    botTarget: 0,
    experimentalDeal
  };
}

const rooms = new Map();
const invitations = new Map();
const dealProfiles = new Map();
let game = null;

function withGame(target, callback) {
  const previous = game;
  game = target;
  try {
    return callback();
  } finally {
    game = previous;
  }
}

function createRoomRecord(name, ownerAccountId, password = null, options = {}) {
  const room = {
    id: options.id || crypto.randomUUID(),
    name,
    ownerAccountId,
    password,
    experimentalDeal: Boolean(options.experimentalDeal),
    createdAt: new Date().toISOString(),
    game: createGame(Boolean(options.experimentalDeal))
  };
  rooms.set(room.id, room);
  return room;
}

createRoomRecord(M_ROOM_NAME, null, null, { id: M_ROOM_ID, experimentalDeal: true });

function bumpVersion() {
  game.version += 1;
}

function touchPlayer(player) {
  if (!player || player.isBot) return;
  player.lastSeen = Date.now();
  player.connected = true;
}

function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function draw() {
  return game.deck.pop();
}

function holeCardStrength(left, right) {
  const high = Math.max(rankValue(left.rank), rankValue(right.rank));
  const low = Math.min(rankValue(left.rank), rankValue(right.rank));
  if (high === low) return 200 + high * 10;
  let score = high * 6 + low * 2;
  if (left.suit === right.suit) score += 8;
  const gap = high - low;
  if (gap === 1) score += 6;
  else if (gap === 2) score += 2;
  else if (gap >= 5) score -= 8;
  if (high >= 11 && low >= 10) score += 12;
  return score;
}

function drawHoleCards(player) {
  const profile = game.experimentalDeal && player.accountId
    ? dealProfiles.get(player.accountId)
    : null;
  const roll = Math.random() * 100;
  const mode = profile && roll < profile.strongChance
    ? "strong"
    : profile && roll < profile.strongChance + profile.weakChance
      ? "weak"
      : "random";
  if (mode === "random" || game.deck.length < 2) return [draw(), draw()];

  let selected = null;
  for (let leftIndex = 0; leftIndex < game.deck.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < game.deck.length; rightIndex += 1) {
      const score = holeCardStrength(game.deck[leftIndex], game.deck[rightIndex]);
      if (!selected || (mode === "strong" ? score > selected.score : score < selected.score)) {
        selected = { leftIndex, rightIndex, score };
      }
    }
  }
  const cards = [game.deck[selected.leftIndex], game.deck[selected.rightIndex]];
  game.deck.splice(selected.rightIndex, 1);
  game.deck.splice(selected.leftIndex, 1);
  return cards;
}

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function addLog(message) {
  game.log.unshift(message);
  game.log = game.log.slice(0, 7);
  bumpVersion();
}

function normalizeSeats() {
  game.players.forEach((player, index) => {
    player.seat = index;
  });
  game.dealerIndex = game.players.length ? game.dealerIndex % game.players.length : 0;
}

function compareScores(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function rankValue(rank) {
  return RANKS.indexOf(rank) + 2;
}

function evaluateFive(cards) {
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
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

function bestHand(cards) {
  if (cards.length < 5) return { score: null, cards: [] };
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const selected = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const score = evaluateFive(selected);
            if (!best || compareScores(score, best.score) > 0) best = { score, cards: selected };
          }
        }
      }
    }
  }
  return best;
}

function bestScore(cards) {
  return bestHand(cards).score || [-1];
}

function scoreName(score) {
  return [
    "High card",
    "One pair",
    "Two pair",
    "Three of a kind",
    "Straight",
    "Flush",
    "Full house",
    "Four of a kind",
    "Straight flush"
  ][score[0]];
}

function copyCards(cards) {
  return cards.map((card) => ({ ...card }));
}

function createSettlement(winnerIds, payouts) {
  const participants = game.players.filter((player) => player.inHand || player.cards.length > 0);
  return {
    board: copyCards(game.board),
    pot: game.pot,
    winnerIds,
    players: participants.map((player) => {
      const hand = bestHand([...player.cards, ...game.board]);
      return {
        id: player.id,
        name: player.name,
        isBot: player.isBot,
        folded: player.folded,
        cards: copyCards(player.cards),
        bestCards: copyCards(hand.cards),
        handType: hand.score ? scoreName(hand.score) : null,
        payout: payouts[player.id] || 0,
        stack: player.stack
      };
    })
  };
}

function readyCandidates() {
  return game.players.filter((player) => !player.isBot && !player.leftRoom && player.connected);
}

function allReadyForNextHand() {
  const candidates = readyCandidates();
  return candidates.length > 0 && candidates.every((player) => player.readyForNextHand);
}

function finishHand(winnerIds, payouts) {
  const settlement = createSettlement(winnerIds, payouts);
  game.phase = "Settlement";
  game.handActive = false;
  game.currentIndex = -1;
  game.pot = 0;
  game.settlement = settlement;
  game.nextHandReady = new Set();
  game.players.forEach((player) => {
    player.readyForNextHand = player.isBot;
  });
  syncAccountBalances();
  emitStateVersion();
}

function maybeStartNextHand() {
  if (game.handActive || game.phase !== "Settlement") return false;
  const eligible = game.players.filter((player) => player.isBot || (!player.leftRoom && player.connected));
  if (eligible.length < 2 || !allReadyForNextHand()) return false;
  startHand();
  return true;
}

function activePlayers() {
  return game.players.filter((player) => player.inHand && !player.folded);
}

function playerAfter(index, predicate = () => true) {
  if (!game.players.length) return -1;
  for (let offset = 1; offset <= game.players.length; offset += 1) {
    const candidate = (index + offset) % game.players.length;
    if (predicate(game.players[candidate])) return candidate;
  }
  return -1;
}

function playerNeedsAction(player) {
  return player.inHand && !player.folded && !player.allIn && player.actedAtBet !== game.currentBet;
}

function everyEligiblePlayerMatched() {
  return activePlayers().every((player) => player.allIn || (player.bet === game.currentBet && player.actedAtBet === game.currentBet));
}

function ensureBotSeats() {
  const humanCount = game.players.filter((player) => !player.isBot && !player.leftRoom).length;
  const targetBots = Math.min(game.botTarget, Math.max(0, MAX_SEATS - humanCount));
  game.botTarget = targetBots;
  while (game.players.filter((player) => player.isBot).length > targetBots) {
    const index = game.players.findIndex((player) => player.isBot && !player.inHand);
    if (index === -1) break;
    game.players.splice(index, 1);
  }
  while (game.players.filter((player) => player.isBot).length < targetBots && game.players.length < MAX_SEATS) {
    const name = BOT_NAMES.find((candidate) => !game.players.some((player) => player.name === candidate));
    if (!name) break;
    game.players.push({
      id: `bot-${name.toLowerCase()}`,
      name,
      stack: tableSettings.startingTokens,
      seat: game.players.length,
      isBot: true,
      connected: true,
      lastSeen: Date.now(),
      inHand: false,
      folded: false,
      allIn: false,
      cards: [],
      bet: 0,
      totalBet: 0,
      actedAtBet: -1,
      readyForNextHand: false
    });
  }
  normalizeSeats();
}

function publicPlayer(player, viewerId, now) {
  const connected = player.isBot || now - (player.lastSeen || 0) <= TABLE_IDLE_TIMEOUT;
  const showCards = viewerId === player.id || game.phase === "Showdown" || !game.handActive;
  return {
    id: player.id,
    name: player.name,
    stack: player.stack,
    seat: player.seat,
    isBot: player.isBot,
    connected,
    inHand: player.inHand,
    folded: player.folded,
    allIn: player.allIn,
    bet: player.bet,
    readyForNextHand: Boolean(player.readyForNextHand),
    cards: showCards ? player.cards : []
  };
}

function stateFor(viewerSid, room, account) {
  const now = Date.now();
  const current = game.players[game.currentIndex];
  const viewer = findPlayerBySid(viewerSid);
  const ready = readyCandidates();
  const viewerId = viewer?.id;
  return {
    view: "table",
    authenticated: true,
    account: publicAccount(account),
    room: publicRoom(room, account?.id),
    users: serverUsers(account),
    version: game.version,
    phase: game.phase,
    street: game.street,
    streetLabel: ROUND_LABELS[game.street] || "Waiting",
    board: game.board,
    pot: game.pot,
    smallBlind: game.rules.smallBlind,
    bigBlind: game.rules.bigBlind,
    startingTokens: game.rules.startingTokens,
    minimumBet: game.rules.minimumBet,
    maximumBet: game.rules.maximumBet,
    minimumRaise: game.rules.minimumRaise,
    dealerIndex: game.dealerIndex,
    currentPlayerId: current ? current.id : null,
    players: game.players.map((player) => publicPlayer(player, viewerId, now)),
    settlement: game.settlement,
    readiness: {
      canReady: Boolean(viewer && !game.handActive && game.phase === "Settlement" && !viewer.isBot && !viewer.leftRoom && viewer.connected),
      meReady: Boolean(viewer?.readyForNextHand),
      readyCount: ready.filter((player) => player.readyForNextHand).length,
      total: ready.length
    },
    log: game.log,
    me: viewer ? publicPlayer(viewer, viewerId, now) : null,
    controls: {
      canAct: Boolean(viewer && game.handActive && current && current.id === viewerId && !viewer.folded && !viewer.allIn),
      toCall: viewer && viewer.inHand ? Math.max(0, game.currentBet - viewer.bet) : 0,
      minRaiseTo: game.currentBet === 0 ? game.rules.minimumBet : game.currentBet + game.minRaise,
      maxRaiseTo: viewer ? maximumRaiseTo(viewer) : 0,
      canManageRoom: room?.ownerAccountId === account?.id
    }
  };
}

function maximumRaiseTo(player) {
  const stackMaximum = player.stack + player.bet;
  return game.rules.maximumBet === null
    ? stackMaximum
    : Math.min(stackMaximum, game.rules.maximumBet);
}

function emitStateVersion() {
  bumpVersion();
}

function addChips(player, targetBet) {
  const target = Math.min(targetBet, player.bet + player.stack);
  const added = Math.max(0, target - player.bet);
  player.stack -= added;
  player.bet += added;
  player.totalBet += added;
  game.pot += added;
  if (player.stack === 0) player.allIn = true;
  return added;
}

function resetStreetBets() {
  game.players.forEach((player) => {
    player.bet = 0;
  });
  game.currentBet = 0;
  game.minRaise = game.rules.minimumRaise;
}

function clearTimers() {
  if (game.nextHandTimer) clearTimeout(game.nextHandTimer);
  if (game.turnTimer) clearTimeout(game.turnTimer);
  game.nextHandTimer = null;
  game.turnTimer = null;
}

function awardUncontested() {
  const winner = activePlayers()[0];
  if (!winner) return;
  const payout = game.pot;
  winner.stack += payout;
  addLog(`${winner.name} wins ${payout} without a showdown.`);
  finishHand([winner.id], { [winner.id]: payout });
}

function showdown() {
  const contenders = activePlayers();
  const scores = contenders.map((player) => ({ player, score: bestScore([...player.cards, ...game.board]) }));
  const best = scores.reduce((winner, current) => (compareScores(current.score, winner.score) > 0 ? current : winner));
  const winners = scores.filter((entry) => compareScores(entry.score, best.score) === 0);
  const share = Math.floor(game.pot / winners.length);
  let remainder = game.pot - share * winners.length;
  winners.forEach((entry) => {
    entry.player.stack += share + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
  });
  addLog(`${winners.map((entry) => entry.player.name).join(" & ")} win ${game.pot} with ${scoreName(best.score)}.`);
  const payouts = Object.fromEntries(winners.map((entry, index) => [
    entry.player.id,
    share + (index < game.pot - share * winners.length ? 1 : 0)
  ]));
  finishHand(winners.map((entry) => entry.player.id), payouts);
}

function advanceStreet() {
  if (activePlayers().length <= 1) {
    awardUncontested();
    return;
  }

  game.street += 1;
  if (game.street === 1) {
    game.board.push(draw(), draw(), draw());
    game.phase = "Flop";
  } else if (game.street === 2) {
    game.board.push(draw());
    game.phase = "Turn";
  } else if (game.street === 3) {
    game.board.push(draw());
    game.phase = "River";
  } else {
    showdown();
    return;
  }

  resetStreetBets();
  game.players.forEach((player) => {
    player.actedAtBet = -1;
  });
  addLog(`${game.phase}: ${game.board.map(cardLabel).join(" ")}.`);
  game.currentIndex = playerAfter(game.dealerIndex, (player) => playerNeedsAction(player));
  emitStateVersion();
  if (game.currentIndex === -1) {
    advanceStreet();
  } else {
    announceTurn();
  }
}

function handleAction(player, action, raiseTo) {
  if (!game.handActive || game.players[game.currentIndex]?.id !== player.id) return false;
  if (game.turnTimer) clearTimeout(game.turnTimer);
  const toCall = Math.max(0, game.currentBet - player.bet);

  if (action === "fold") {
    player.folded = true;
    player.actedAtBet = game.currentBet;
    addLog(`${player.name} folds.`);
  } else if (action === "raise") {
    const requested = Number(raiseTo);
    const minimum = game.currentBet === 0 ? game.rules.minimumBet : game.currentBet + game.minRaise;
    const maximum = maximumRaiseTo(player);
    if (!Number.isFinite(requested) || requested < minimum || requested > maximum) {
      return false;
    }
    addChips(player, Math.floor(requested));
    const raiseSize = player.bet - game.currentBet;
    game.currentBet = player.bet;
    game.minRaise = Math.max(game.minRaise, raiseSize);
    game.players.forEach((other) => {
      if (other.id !== player.id && other.inHand && !other.folded && !other.allIn) other.actedAtBet = -1;
    });
    player.actedAtBet = game.currentBet;
    addLog(`${player.name} raises to ${player.bet}.`);
  } else {
    const paid = addChips(player, game.currentBet);
    player.actedAtBet = game.currentBet;
    addLog(toCall === 0 ? `${player.name} checks.` : `${player.name} calls ${paid}.`);
  }

  emitStateVersion();
  advanceTurn();
  return true;
}

function botAct(player) {
  if (!game.handActive || game.players[game.currentIndex]?.id !== player.id) return;
  const toCall = Math.max(0, game.currentBet - player.bet);
  const minimumRaiseTo = game.currentBet === 0 ? game.rules.minimumBet : game.currentBet + game.minRaise;
  const canRaise = maximumRaiseTo(player) >= minimumRaiseTo;
  const roll = Math.random();

  if (toCall > 0 && roll < 0.18) {
    handleAction(player, "fold");
    return;
  }
  if (canRaise && roll > 0.72) {
    const spread = Math.max(game.minRaise, Math.min(game.rules.bigBlind * 4, Math.floor(player.stack / 3)));
    const minimum = game.currentBet === 0 ? game.rules.minimumBet : game.currentBet + game.minRaise;
    const target = Math.min(maximumRaiseTo(player), minimum + Math.floor(Math.random() * Math.max(1, spread)));
    handleAction(player, "raise", target);
    return;
  }
  handleAction(player, "checkCall");
}

function timeoutAction(player) {
  if (!game.handActive || game.players[game.currentIndex]?.id !== player.id) return;
  const toCall = Math.max(0, game.currentBet - player.bet);
  handleAction(player, toCall > 0 ? "fold" : "checkCall");
}

function announceTurn() {
  if (game.turnTimer) clearTimeout(game.turnTimer);
  const player = game.players[game.currentIndex];
  if (!player || !game.handActive) return;
  addLog(`${player.name}'s turn.`);
  emitStateVersion();
  const targetGame = game;
  const runInGame = (callback) => () => withGame(targetGame, callback);

  if (player.isBot) {
    game.turnTimer = setTimeout(runInGame(() => botAct(player)), 850 + Math.floor(Math.random() * 800));
  } else if (!player.connected) {
    game.turnTimer = setTimeout(runInGame(() => timeoutAction(player)), 250);
  } else {
    game.turnTimer = setTimeout(runInGame(() => timeoutAction(player)), ACTION_TIMEOUT_MS);
  }
}

function advanceTurn() {
  if (!game.handActive) return;
  if (activePlayers().length <= 1) {
    awardUncontested();
    return;
  }

  if (everyEligiblePlayerMatched()) {
    advanceStreet();
    return;
  }

  const next = playerAfter(game.currentIndex, (player) => playerNeedsAction(player));
  if (next === -1) {
    advanceStreet();
    return;
  }
  game.currentIndex = next;
  announceTurn();
}

function startHand() {
  if (game.phase === "Settlement" && !allReadyForNextHand()) return false;
  clearTimers();
  game.rules = rulesForRoom(game.experimentalDeal);
  game.settlement = null;
  game.nextHandReady = new Set();
  game.players = game.players.filter((player) => player.isBot || (player.connected && !player.leftRoom));
  game.players.forEach((player) => {
    player.inHand = false;
    player.folded = false;
    player.allIn = false;
    player.cards = [];
    player.bet = 0;
    player.totalBet = 0;
    player.actedAtBet = -1;
    player.readyForNextHand = false;
  });
  ensureBotSeats();

  const eligible = game.players.filter((player) => player.isBot || player.connected);
  if (eligible.length < 2) {
    game.phase = "Waiting for players";
    game.handActive = false;
    game.currentIndex = -1;
    addLog("Waiting for enough players.");
    emitStateVersion();
    return;
  }

  game.handActive = true;
  game.phase = "Pre-flop";
  game.street = 0;
  game.board = [];
  game.pot = 0;
  game.deck = shuffle(createDeck());
  let accountBalanceReset = false;
  game.players.forEach((player) => {
    if (player.stack <= 0) {
      player.stack = game.rules.startingTokens;
      if (player.accountId) {
        const account = accounts.get(player.accountId);
        if (account) {
          account.tokens = player.stack;
          accountBalanceReset = true;
        }
      }
    }
    player.inHand = player.isBot || player.connected;
    player.folded = false;
    player.allIn = false;
    player.cards = player.inHand ? drawHoleCards(player) : [];
    player.bet = 0;
    player.totalBet = 0;
    player.actedAtBet = -1;
  });
  if (accountBalanceReset) saveAccounts();

  game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
  const smallBlindIndex = playerAfter(game.dealerIndex, (player) => player.inHand);
  const bigBlindIndex = playerAfter(smallBlindIndex, (player) => player.inHand);
  const smallBlind = game.players[smallBlindIndex];
  const bigBlind = game.players[bigBlindIndex];

  if (!smallBlind || !bigBlind) {
    game.handActive = false;
    game.phase = "Waiting for players";
    emitStateVersion();
    return;
  }

  postBlind(smallBlind, game.rules.smallBlind, "small blind");
  postBlind(bigBlind, game.rules.bigBlind, "big blind");
  game.currentBet = game.rules.bigBlind;
  game.minRaise = game.rules.minimumRaise;
  game.players.forEach((player) => {
    if (player.inHand) player.actedAtBet = -1;
  });
  addLog(`Hand begins. ${game.players[game.dealerIndex].name} has the dealer button.`);
  game.currentIndex = playerAfter(bigBlindIndex, (player) => playerNeedsAction(player));
  emitStateVersion();
  if (game.currentIndex === -1) {
    advanceStreet();
  } else {
    announceTurn();
  }
  return true;
}

function maintenanceTick() {
  const now = Date.now();
  let changed = false;

  for (const player of game.players) {
    if (player.isBot) continue;
    const connected = now - (player.lastSeen || 0) <= TABLE_IDLE_TIMEOUT;
    if (player.connected !== connected) {
      player.connected = connected;
      changed = true;
    }
  }

  if (game.handActive) {
    const current = game.players[game.currentIndex];
    if (current && !current.isBot && !current.connected) {
      timeoutAction(current);
      return;
    }
  } else {
    const before = game.players.length;
    game.players = game.players.filter((player) => player.isBot || player.connected || now - (player.lastSeen || 0) <= TABLE_IDLE_TIMEOUT);
    if (game.players.length !== before) {
      changed = true;
      ensureBotSeats();
    }
    if (game.phase === "Settlement") maybeStartNextHand();
  }

  if (changed) emitStateVersion();
}

function maintenanceAllRooms() {
  for (const room of [...rooms.values()]) {
    withGame(room.game, maintenanceTick);
    const hasHumans = room.game.players.some((player) => !player.isBot && !player.leftRoom);
    if (!room.game.handActive && !hasHumans) {
      withGame(room.game, clearTimers);
      if (room.experimentalDeal) {
        room.ownerAccountId = null;
        room.game.players = [];
        room.game.botTarget = 0;
      } else {
        rooms.delete(room.id);
      }
    }
  }
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const index = part.indexOf("=");
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function json(res, statusCode, payload, headers = {}) {
  send(res, statusCode, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function getSid(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies.sid || "";
}

function setSidCookie(res, sid) {
  appendCookie(res, `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
}

function appendCookie(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", existing ? [...(Array.isArray(existing) ? existing : [existing]), cookie] : cookie);
}

function setAuthCookie(res, accountId) {
  const payload = Buffer.from(JSON.stringify({ accountId, exp: Math.floor(Date.now() / 1000) + AUTH_TOKEN_MAX_AGE })).toString("base64url");
  const signature = crypto.createHmac("sha256", authSecret).update(payload).digest("base64url");
  appendCookie(res, `auth_token=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TOKEN_MAX_AGE}`);
}

function clearAuthCookies(res) {
  appendCookie(res, "auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  appendCookie(res, "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getAccountFromRequest(req) {
  const token = parseCookies(req.headers.cookie || "").auth_token || "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", authSecret).update(payload).digest("base64url");
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded.accountId || Number(decoded.exp) < Math.floor(Date.now() / 1000)) return null;
    return accounts.get(decoded.accountId) || null;
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function handleJsonRoute(req, res, handler) {
  readBody(req)
    .then((raw) => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        json(res, 400, { ok: false, error: "Invalid JSON." });
        return;
      }
      Promise.resolve().then(() => handler(body)).catch((error) => {
        console.error(error);
        if (!res.headersSent) json(res, 500, { ok: false, error: "Internal server error." });
      });
    })
    .catch((error) => {
      if (!res.headersSent) json(res, 400, { ok: false, error: error.message });
    });
}

function sanitizeName(input) {
  return String(input || "Guest")
    .replace(/[^\w\u4e00-\u9fff -]/g, "")
    .trim()
    .slice(0, 14) || "Guest";
}

function findPlayerBySid(sid) {
  return game.players.find((player) => !player.isBot && player.sid === sid);
}

function findPlayerByAccountId(accountId) {
  return game.players.find((player) => !player.isBot && player.accountId === accountId);
}

function syncAccountBalances() {
  let changed = false;
  game.players.forEach((player) => {
    if (!player.accountId) return;
    const account = accounts.get(player.accountId);
    if (!account || account.tokens === player.stack) return;
    account.tokens = player.stack;
    changed = true;
  });
  if (changed) saveAccounts();
}

function findMembershipByAccountId(accountId) {
  for (const room of rooms.values()) {
    const player = room.game.players.find((candidate) => !candidate.isBot && !candidate.leftRoom && candidate.accountId === accountId);
    if (player) return { room, player };
  }
  return null;
}

function findMembershipBySid(sid) {
  for (const room of rooms.values()) {
    const player = room.game.players.find((candidate) => !candidate.isBot && !candidate.leftRoom && candidate.sid === sid);
    if (player) return { room, player };
  }
  return null;
}

function publicAccount(account) {
  if (!account) return null;
  return { id: account.id, username: account.username, displayName: account.displayName, tokens: account.tokens };
}

function serverUsers(account) {
  return [...accounts.values()]
    .filter((candidate) => candidate.id !== account.id)
    .map((candidate) => ({
      id: candidate.id,
      username: candidate.username,
      displayName: candidate.displayName,
      online: Boolean(findMembershipByAccountId(candidate.id))
    }));
}

function publicRoom(room, accountId) {
  const humans = room.game.players.filter((player) => !player.isBot && !player.leftRoom);
  const invited = invitations.get(accountId)?.has(room.id) || false;
  return {
    id: room.id,
    name: room.name,
    experimentalDeal: room.experimentalDeal,
    requiresExperimentConsent: room.experimentalDeal,
    ownerAccountId: room.ownerAccountId,
    ownerName: accounts.get(room.ownerAccountId)?.displayName || "待入座",
    hasPassword: Boolean(room.password),
    invited,
    humanCount: humans.length,
    botCount: room.game.players.filter((player) => player.isBot).length,
    botTarget: room.game.botTarget,
    maxSeats: MAX_SEATS,
    phase: room.game.phase,
    pot: room.game.pot,
    handActive: room.game.handActive
  };
}

function lobbyState(account) {
  const invitedRooms = invitations.get(account.id) || new Set();
  return {
    view: "lobby",
    authenticated: true,
    account: publicAccount(account),
    rooms: [...rooms.values()].map((room) => publicRoom(room, account.id)),
    invitations: [...invitedRooms].filter((roomId) => rooms.has(roomId)),
    users: serverUsers(account)
  };
}

function unauthenticatedState() {
  return { view: "auth", authenticated: false, account: null, rooms: [], invitations: [], users: [] };
}

function stateForAccount(account, req, res) {
  if (!account) return unauthenticatedState();
  const membership = findMembershipByAccountId(account.id);
  if (!membership) return lobbyState(account);
  return withGame(membership.room.game, () => {
    membership.player.sid = getSid(req) || membership.player.sid || crypto.randomUUID();
    touchPlayer(membership.player);
    setSidCookie(res, membership.player.sid);
    return stateFor(membership.player.sid, membership.room, account);
  });
}

function createOrUpdateAccountPlayer(room, req, res, account) {
  return withGame(room.game, () => {
  const sid = getSid(req) || crypto.randomUUID();
  const existing = findPlayerByAccountId(account.id);
  if (existing) {
    existing.sid = sid;
    existing.name = account.displayName;
    touchPlayer(existing);
    setSidCookie(res, sid);
    setAuthCookie(res, account.id);
    return existing;
  }

  const replacementBotIndex = game.players.findIndex((player) => player.isBot && !player.inHand);
  if (game.players.length >= MAX_SEATS && replacementBotIndex === -1) return null;
  const player = {
    id: crypto.randomUUID(),
    sid,
    accountId: account.id,
    name: account.displayName,
    stack: Math.max(0, Number(account.tokens) || tableSettings.startingTokens),
    seat: 0,
    isBot: false,
    connected: true,
    lastSeen: Date.now(),
    inHand: false,
    folded: false,
    allIn: false,
    cards: [],
    bet: 0,
    totalBet: 0,
    actedAtBet: -1
  };
  if (replacementBotIndex !== -1) game.players.splice(replacementBotIndex, 1, player);
  else game.players.push(player);
  normalizeSeats();
  touchPlayer(player);
  setSidCookie(res, sid);
  setAuthCookie(res, account.id);
  addLog(`${player.name} joins the table.`);
  emitStateVersion();
    if (!game.handActive) {
      if (game.phase === "Settlement") maybeStartNextHand();
      else startHand();
    } else ensureBotSeats();
  return player;
  });
}

function normalizeUsername(input) {
  return String(input || "").trim();
}

function findAccountByUsername(username) {
  const normalized = username.toLocaleLowerCase();
  return [...accounts.values()].find((account) => account.username.toLocaleLowerCase() === normalized) || null;
}

function validateAccountInput(body, requireConfirm = false) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,20}$/.test(username)) return { error: "账号需为 2-20 位中文、字母、数字或下划线。" };
  if (password.length < 6 || password.length > 72) return { error: "密码长度需为 6-72 位。" };
  if (requireConfirm && password !== String(body?.passwordConfirm || "")) return { error: "两次输入的密码不一致。" };
  return { username, password };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve({ salt, passwordHash: derivedKey.toString("hex") });
    });
  });
}

async function passwordMatchesAccount(password, account) {
  const result = await hashPassword(password, account.salt);
  const supplied = Buffer.from(result.passwordHash, "hex");
  const expected = Buffer.from(account.passwordHash, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function handleAccountRegister(req, res, body) {
  const result = validateAccountInput(body, true);
  if (result.error) {
    json(res, 400, { ok: false, error: result.error });
    return;
  }
  if (findAccountByUsername(result.username)) {
    json(res, 409, { ok: false, error: "这个账号已经存在。" });
    return;
  }
  const { salt, passwordHash } = await hashPassword(result.password);
  if (findAccountByUsername(result.username)) {
    json(res, 409, { ok: false, error: "这个账号已经存在。" });
    return;
  }
  const account = {
    id: crypto.randomUUID(),
    username: result.username,
    displayName: sanitizeName(body?.displayName || result.username),
    salt,
    passwordHash,
    tokens: tableSettings.startingTokens,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };
  accounts.set(account.id, account);
  saveAccounts();
  const sid = getSid(req) || crypto.randomUUID();
  setSidCookie(res, sid);
  setAuthCookie(res, account.id);
  json(res, 200, { ok: true, state: lobbyState(account) });
}

async function handleAccountLogin(req, res, body) {
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  const account = findAccountByUsername(username);
  if (!account || !(await passwordMatchesAccount(password, account))) {
    json(res, 403, { ok: false, error: "账号或密码错误。" });
    return;
  }
  account.lastLoginAt = new Date().toISOString();
  saveAccounts();
  const sid = getSid(req) || crypto.randomUUID();
  const membership = findMembershipByAccountId(account.id);
  if (membership) membership.player.sid = sid;
  setSidCookie(res, sid);
  setAuthCookie(res, account.id);
  json(res, 200, { ok: true, state: stateForAccount(account, req, res) });
}

function handleAccountLogout(req, res) {
  const account = getAccountFromRequest(req);
  const membership = account ? findMembershipByAccountId(account.id) : findMembershipBySid(getSid(req));
  if (membership) {
    withGame(membership.room.game, () => {
      membership.player.connected = false;
      membership.player.lastSeen = 0;
      membership.player.sid = "";
      membership.player.readyForNextHand = false;
      maybeStartNextHand();
      emitStateVersion();
    });
  }
  clearAuthCookies(res);
  json(res, 200, { ok: true });
}

function handleReadyNextHand(req, res) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  const membership = findMembershipByAccountId(account.id);
  if (!membership) {
    json(res, 409, { ok: false, error: "请先加入房间。" });
    return;
  }
  const { room, player } = membership;
  withGame(room.game, () => {
    touchPlayer(player);
    if (game.handActive || game.phase !== "Settlement") {
      json(res, 409, { ok: false, error: "当前没有等待准备的结算牌局。", state: stateFor(player.sid, room, account) });
      return;
    }
    player.readyForNextHand = true;
    game.nextHandReady.add(player.id);
    maybeStartNextHand();
    emitStateVersion();
    json(res, 200, { ok: true, state: stateFor(player.sid, room, account) });
  });
}

function handleActionRequest(req, res, body) {
  const account = getAccountFromRequest(req);
  const membership = account ? findMembershipByAccountId(account.id) : null;
  if (!membership) {
    json(res, 401, { ok: false, error: "Please log in first." });
    return;
  }
  withGame(membership.room.game, () => {
    touchPlayer(membership.player);
    const accepted = handleAction(membership.player, body?.type, body?.raiseTo);
    const state = stateFor(membership.player.sid, membership.room, account);
    if (!accepted) json(res, 400, { ok: false, error: "Action not accepted right now.", state });
    else json(res, 200, { ok: true, state });
  });
}

function requirePlayerAccount(req, res) {
  const account = getAccountFromRequest(req);
  if (account) return account;
  json(res, 401, { ok: false, error: "请先登录账号。" });
  return null;
}

function sanitizeRoomName(input) {
  return String(input || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 24);
}

async function createRoomPassword(password) {
  if (!password) return null;
  const result = await hashPassword(password);
  return { salt: result.salt, passwordHash: result.passwordHash };
}

async function roomPasswordMatches(password, room) {
  if (!room.password) return true;
  const result = await hashPassword(String(password || ""), room.password.salt);
  const supplied = Buffer.from(result.passwordHash, "hex");
  const expected = Buffer.from(room.password.passwordHash, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function handleCreateRoom(req, res, body) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  if (findMembershipByAccountId(account.id)) {
    json(res, 409, { ok: false, error: "请先退出当前房间。" });
    return;
  }
  const name = sanitizeRoomName(body?.name);
  const password = String(body?.password || "");
  if (name.length < 2) {
    json(res, 400, { ok: false, error: "房间名称至少需要 2 个字符。" });
    return;
  }
  if (name.toLocaleLowerCase() === M_ROOM_NAME.toLocaleLowerCase()) {
    json(res, 409, { ok: false, error: "M房由服务器统一管理，请直接从大厅加入。" });
    return;
  }
  if (password.length > 40) {
    json(res, 400, { ok: false, error: "房间密码不能超过 40 位。" });
    return;
  }
  const room = createRoomRecord(name, account.id, await createRoomPassword(password));
  const player = createOrUpdateAccountPlayer(room, req, res, account);
  json(res, 200, { ok: true, state: withGame(room.game, () => stateFor(player.sid, room, account)) });
}

async function handleJoinRoom(req, res, body) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  const current = findMembershipByAccountId(account.id);
  if (current) {
    json(res, 409, { ok: false, error: "请先退出当前房间。" });
    return;
  }
  const room = rooms.get(String(body?.roomId || ""));
  if (!room) {
    json(res, 404, { ok: false, error: "房间不存在或已经关闭。" });
    return;
  }
  if (room.experimentalDeal && body?.experimentConsent !== true) {
    json(res, 400, { ok: false, error: "本房间为实验性高价值房间，慎入。请先勾选确认后再加入。" });
    return;
  }
  const invited = invitations.get(account.id)?.has(room.id) || false;
  if (!invited && !(await roomPasswordMatches(body?.password, room))) {
    json(res, 403, { ok: false, error: "房间密码错误。" });
    return;
  }
  const player = createOrUpdateAccountPlayer(room, req, res, account);
  if (!player) {
    json(res, 409, { ok: false, error: "房间已经坐满。" });
    return;
  }
  if (room.experimentalDeal && !room.ownerAccountId) room.ownerAccountId = account.id;
  invitations.get(account.id)?.delete(room.id);
  json(res, 200, { ok: true, state: withGame(room.game, () => stateFor(player.sid, room, account)) });
}

function handleLeaveRoom(req, res) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  const membership = findMembershipByAccountId(account.id);
  if (!membership) {
    json(res, 200, { ok: true, state: lobbyState(account) });
    return;
  }
  const { room, player } = membership;
  if (room.game.handActive) {
    json(res, 409, { ok: false, error: "本手牌结束后才能退出房间。" });
    return;
  }
  withGame(room.game, () => {
    player.leftRoom = true;
    player.connected = false;
    player.lastSeen = 0;
    player.sid = "";
    if (game.handActive) {
      if (game.players[game.currentIndex]?.id === player.id) timeoutAction(player);
    } else {
      syncAccountBalances();
      game.players = game.players.filter((candidate) => candidate !== player);
      ensureBotSeats();
      maybeStartNextHand();
    }
    const nextOwner = game.players.find((candidate) => !candidate.isBot && !candidate.leftRoom);
    if (room.ownerAccountId === account.id && nextOwner) room.ownerAccountId = nextOwner.accountId;
    if (!game.handActive && !nextOwner && !room.experimentalDeal) {
      clearTimers();
      rooms.delete(room.id);
    }
    if (!nextOwner && room.experimentalDeal) room.ownerAccountId = null;
    emitStateVersion();
  });
  json(res, 200, { ok: true, state: lobbyState(account) });
}

function handleRoomBots(req, res, body) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  const membership = findMembershipByAccountId(account.id);
  if (!membership || membership.room.ownerAccountId !== account.id) {
    json(res, 403, { ok: false, error: "只有房主可以管理机器人。" });
    return;
  }
  const delta = Number(body?.delta);
  if (![1, -1].includes(delta)) {
    json(res, 400, { ok: false, error: "无效的机器人操作。" });
    return;
  }
  const { room, player } = membership;
  withGame(room.game, () => {
    const humanCount = game.players.filter((candidate) => !candidate.isBot && !candidate.leftRoom).length;
    game.botTarget = Math.max(0, Math.min(MAX_SEATS - humanCount, game.botTarget + delta));
    if (!game.handActive) {
      ensureBotSeats();
      if (game.phase === "Settlement") maybeStartNextHand();
      else if (game.players.length >= 2) startHand();
    }
    emitStateVersion();
    json(res, 200, { ok: true, state: stateFor(player.sid, room, account) });
  });
}

function handleRoomInvite(req, res, body) {
  const account = requirePlayerAccount(req, res);
  if (!account) return;
  const membership = findMembershipByAccountId(account.id);
  if (!membership || membership.room.ownerAccountId !== account.id) {
    json(res, 403, { ok: false, error: "只有房主可以邀请玩家。" });
    return;
  }
  const invitedAccount = accounts.get(String(body?.accountId || ""));
  if (!invitedAccount || invitedAccount.id === account.id) {
    json(res, 404, { ok: false, error: "指定账号不存在。" });
    return;
  }
  if (!invitations.has(invitedAccount.id)) invitations.set(invitedAccount.id, new Set());
  invitations.get(invitedAccount.id).add(membership.room.id);
  withGame(membership.room.game, () => addLog(`${account.displayName} invited ${invitedAccount.displayName}.`));
  json(res, 200, { ok: true, state: stateForAccount(account, req, res) });
}

function getAdminSession(req) {
  return parseCookies(req.headers.cookie || "").admin_sid || "";
}

function isAdmin(req) {
  return adminSessions.has(getAdminSession(req));
}

function setAdminCookie(res, sessionId, maxAge = 28800) {
  res.setHeader("Set-Cookie", `admin_sid=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
}

function passwordMatches(input) {
  const supplied = Buffer.from(String(input || ""));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function adminState() {
  const now = Date.now();
  const roomList = [...rooms.values()];
  const takesEffectNextHand = roomList.some((room) => Object.keys(DEFAULT_SETTINGS).some((key) => tableSettings[key] !== room.game.rules[key]));
  const tablePlayers = roomList.flatMap((room) => room.game.players.map((player) => ({
    id: player.id,
    name: player.name,
    roomName: room.name,
    stack: player.stack,
    bet: player.bet,
    isBot: player.isBot,
    connected: player.isBot || now - (player.lastSeen || 0) <= TABLE_IDLE_TIMEOUT,
    inHand: player.inHand,
    folded: player.folded,
    allIn: player.allIn,
    current: room.game.players[room.game.currentIndex]?.id === player.id
  })));
  const lanAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => `http://${address.address}:${PORT}`);
  return {
    server: {
      port: PORT,
      uptimeSeconds: Math.floor(process.uptime()),
      localPlayerUrl: `http://localhost:${PORT}`,
      lanPlayerUrls: [...new Set(lanAddresses)]
    },
    pendingSettings: { ...tableSettings },
    activeRules: { ...tableSettings },
    takesEffectNextHand,
    rooms: roomList.map((room) => publicRoom(room)),
    accounts: [...accounts.values()].map((account) => {
      const membership = findMembershipByAccountId(account.id);
      return {
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        tokens: account.tokens,
        online: Boolean(membership?.player.connected),
        lastLoginAt: account.lastLoginAt,
        createdAt: account.createdAt
      };
    }),
    dealExperiment: {
      roomId: M_ROOM_ID,
      roomName: M_ROOM_NAME,
      active: dealProfiles.size > 0,
      profiles: [...dealProfiles.entries()].map(([accountId, profile]) => ({
        accountId,
        username: accounts.get(accountId)?.username || "",
        displayName: accounts.get(accountId)?.displayName || "",
        strongChance: profile.strongChance,
        weakChance: profile.weakChance
      }))
    },
    table: {
      phase: `${roomList.length} 个房间`,
      pot: roomList.reduce((total, room) => total + room.game.pot, 0),
      handActive: roomList.some((room) => room.game.handActive),
      currentPlayerId: null,
      players: tablePlayers
    },
    log: roomList.flatMap((room) => room.game.log.map((entry) => `[${room.name}] ${entry}`)).slice(0, 20)
  };
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  json(res, 401, { ok: false, error: "Admin login required." });
  return false;
}

function parsePositiveInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) return null;
  return number;
}

function validateTableSettings(body) {
  const settings = {
    startingTokens: parsePositiveInteger(body?.startingTokens, 100, 1_000_000_000),
    smallBlind: parsePositiveInteger(body?.smallBlind, 1, 10_000_000),
    bigBlind: parsePositiveInteger(body?.bigBlind, 1, 10_000_000),
    minimumBet: parsePositiveInteger(body?.minimumBet, 1, 100_000_000),
    maximumBet: parsePositiveInteger(body?.maximumBet, 1, 1_000_000_000),
    minimumRaise: parsePositiveInteger(body?.minimumRaise, 1, 100_000_000)
  };
  if (Object.values(settings).some((value) => value === null)) {
    return { error: "All settings must be positive whole numbers within the allowed range." };
  }
  if (settings.smallBlind > settings.bigBlind) return { error: "Small blind cannot exceed big blind." };
  if (settings.bigBlind > settings.maximumBet) return { error: "Maximum bet cannot be lower than the big blind." };
  if (settings.minimumBet > settings.maximumBet) return { error: "Minimum bet cannot exceed maximum bet." };
  if (settings.minimumRaise > settings.maximumBet) return { error: "Minimum raise cannot exceed maximum bet." };
  return { settings };
}

function handleAdminLogin(res, body) {
  if (!passwordMatches(body?.password)) {
    json(res, 403, { ok: false, error: "Incorrect admin password." });
    return;
  }
  const sessionId = crypto.randomUUID();
  adminSessions.add(sessionId);
  setAdminCookie(res, sessionId);
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminSettings(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const result = validateTableSettings(body);
  if (result.error) {
    json(res, 400, { ok: false, error: result.error });
    return;
  }
  Object.assign(tableSettings, result.settings);
  rooms.forEach((room) => withGame(room.game, () => {
    if (!game.handActive) game.rules = rulesForRoom(room.experimentalDeal);
    addLog("Admin updated table rules. New rules begin next hand.");
    emitStateVersion();
  }));
  saveTableSettings();
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminGrant(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const amount = parsePositiveInteger(body?.amount, 1, 1_000_000_000);
  if (amount === null) {
    json(res, 400, { ok: false, error: "Grant amount must be a positive whole number." });
    return;
  }
  rooms.forEach((room) => withGame(room.game, () => {
    game.players.forEach((player) => {
      player.stack = Math.min(Number.MAX_SAFE_INTEGER, player.stack + amount);
      if (player.accountId) {
        const account = accounts.get(player.accountId);
        if (account) account.tokens = player.stack;
      }
    });
    addLog(`Admin grants ${amount} Token to every seated player.`);
    emitStateVersion();
  }));
  saveAccounts();
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminAccountGrant(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const amount = parsePositiveInteger(body?.amount, 1, 1_000_000_000);
  const accountId = String(body?.accountId || "");
  const account = accounts.get(accountId);
  if (amount === null) {
    json(res, 400, { ok: false, error: "发放数量必须是正整数。" });
    return;
  }
  if (!account) {
    json(res, 404, { ok: false, error: "指定账号不存在。" });
    return;
  }

  const membership = findMembershipByAccountId(account.id);
  const nextTokens = Math.min(Number.MAX_SAFE_INTEGER, (membership ? membership.player.stack : Number(account.tokens) || 0) + amount);
  account.tokens = nextTokens;
  if (membership) {
    membership.player.stack = nextTokens;
    withGame(membership.room.game, () => {
      addLog(`Admin grants ${amount} Token to ${account.displayName}.`);
      emitStateVersion();
    });
  }
  saveAccounts();
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminDealProfile(req, res, body) {
  if (!requireAdmin(req, res)) return;
  const accountId = String(body?.accountId || "");
  const account = accounts.get(accountId);
  const strongChance = parsePositiveInteger(body?.strongChance, 0, 100);
  const weakChance = parsePositiveInteger(body?.weakChance, 0, 100);
  if (!account) {
    json(res, 404, { ok: false, error: "指定账号不存在。" });
    return;
  }
  if (strongChance === null || weakChance === null || strongChance + weakChance > 100) {
    json(res, 400, { ok: false, error: "大牌概率与小牌概率必须是整数，且总和不能超过 100%。" });
    return;
  }
  if (strongChance === 0 && weakChance === 0) dealProfiles.delete(accountId);
  else dealProfiles.set(accountId, { strongChance, weakChance });
  console.log(`[M-room] ${account.username}: strong=${strongChance}% weak=${weakChance}%`);
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminDealProfileReset(req, res) {
  if (!requireAdmin(req, res)) return;
  dealProfiles.clear();
  console.log("[M-room] all deal profiles cleared");
  json(res, 200, { ok: true, state: adminState() });
}

function handleAdminLogout(req, res) {
  adminSessions.delete(getAdminSession(req));
  setAdminCookie(res, "", 0);
  json(res, 200, { ok: true });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 200, data, { "Content-Type": type });
  });
}

function safeJoin(base, target) {
  const targetPath = path.resolve(base, target);
  const relative = path.relative(base, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return targetPath;
}

function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/") {
    serveFile(res, path.join(publicDir, "index.html"));
    return;
  }

  if (req.method === "GET" && ["/admin", "/admin/", "/server", "/server/"].includes(pathname)) {
    serveFile(res, path.join(publicDir, "admin.html"));
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    maintenanceAllRooms();
    const account = getAccountFromRequest(req);
    json(res, 200, { ok: true, state: stateForAccount(account, req, res) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/account/register") {
    handleJsonRoute(req, res, (body) => handleAccountRegister(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/account/login") {
    handleJsonRoute(req, res, (body) => handleAccountLogin(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/account/logout") {
    handleAccountLogout(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/action") {
    handleJsonRoute(req, res, (body) => handleActionRequest(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/ready") {
    handleReadyNextHand(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    handleJsonRoute(req, res, (body) => handleAdminLogin(res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    handleAdminLogout(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/state") {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { ok: true, state: adminState() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/settings") {
    handleJsonRoute(req, res, (body) => handleAdminSettings(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/grant") {
    handleJsonRoute(req, res, (body) => handleAdminGrant(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/deal-profile") {
    handleJsonRoute(req, res, (body) => handleAdminDealProfile(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/deal-profile/reset") {
    handleAdminDealProfileReset(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/create") {
    handleJsonRoute(req, res, (body) => handleCreateRoom(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/join") {
    handleJsonRoute(req, res, (body) => handleJoinRoom(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/leave") {
    handleLeaveRoom(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/bots") {
    handleJsonRoute(req, res, (body) => handleRoomBots(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/rooms/invite") {
    handleJsonRoute(req, res, (body) => handleRoomInvite(req, res, body));
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/account-grant") {
    handleJsonRoute(req, res, (body) => handleAdminAccountGrant(req, res, body));
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/")) {
    const asset = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = safeJoin(publicDir, asset);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      send(res, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    serveFile(res, file);
    return;
  }

  send(res, 405, "Method not allowed", { "Content-Type": "text/plain; charset=utf-8" });
}

function postBlind(player, amount, label) {
  const paid = Math.min(amount, player.stack);
  player.stack -= paid;
  player.bet += paid;
  player.totalBet += paid;
  game.pot += paid;
  if (player.stack === 0) player.allIn = true;
  addLog(`${player.name} posts ${label} ${paid}.`);
}

http.createServer((req, res) => {
  try {
    routeRequest(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      json(res, 500, { ok: false, error: "Internal server error." });
    } else {
      res.end();
    }
  }
}).listen(PORT, () => {
  console.log(`River Room is running on http://localhost:${PORT}`);
  console.log(`Server settings: http://localhost:${PORT}/server`);
  if (!process.env.ADMIN_PASSWORD) console.log("Admin password: riverroom-admin (set ADMIN_PASSWORD to change it)");
});

setInterval(maintenanceAllRooms, 1000).unref();
