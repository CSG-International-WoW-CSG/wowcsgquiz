const fs = require("fs");
const path = require("path");

const MAX_PLAYERS_PER_GAME = 5000;
const PIN_LENGTH = 6;
const DATA_DIR = path.join(__dirname, "..", ".data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "games.json");

function randomPin() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

const DEFAULT_QUIZ = {
  title: "Sample quiz",
  questions: [
    {
      text: "What is 12 × 7?",
      choices: ["74", "84", "94", "72"],
      correctIndex: 1,
      timeSec: 20,
      points: 1000,
    },
    {
      text: "Which protocol is connection-oriented?",
      choices: ["UDP", "HTTP/3 only", "TCP", "ICMP"],
      correctIndex: 2,
      timeSec: 25,
      points: 1000,
    },
    {
      text: "Capital of Saudi Arabia?",
      choices: ["Jeddah", "Riyadh", "Dammam", "Mecca"],
      correctIndex: 1,
      timeSec: 20,
      points: 1000,
    },
  ],
};

/** @type {Map<string, import('./types').GameSession>} */
const games = new Map();

let persistTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function toSerializableGame(game) {
  return {
    ...game,
    players: [...game.players.entries()],
    answersThisRound: [...game.answersThisRound.entries()],
  };
}

function fromSerializableGame(raw) {
  return {
    ...raw,
    players: new Map(Array.isArray(raw.players) ? raw.players : []),
    answersThisRound: new Map(Array.isArray(raw.answersThisRound) ? raw.answersThisRound : []),
  };
}

function saveSnapshotNow() {
  ensureDataDir();
  const payload = {
    updatedAt: Date.now(),
    games: [...games.values()].map(toSerializableGame),
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      saveSnapshotNow();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Could not persist game snapshot", err);
    }
  }, 200);
}

function loadSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
    const loaded = Array.isArray(raw.games) ? raw.games : [];
    for (const g of loaded) {
      if (!g?.pin) continue;
      games.set(g.pin, fromSerializableGame(g));
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Could not read game snapshot", err);
  }
}

/**
 * @param {string} pin
 * @param {import('./types').Quiz} quiz
 * @param {string} hostSecret
 */
function createGame(pin, quiz, hostSecret) {
  games.set(pin, {
    pin,
    hostSecret,
    hostName: "Host",
    hostToken: "",
    quiz,
    phase: "lobby",
    questionIndex: -1,
    /** @type {Map<string, import('./types').PlayerState>} */
    players: new Map(),
    answersThisRound: new Map(),
    questionStartedAt: 0,
    analytics: [],
    createdAt: Date.now(),
  });
  schedulePersist();
}

function getGame(pin) {
  return games.get(pin) ?? null;
}

function deleteGame(pin) {
  games.delete(pin);
  schedulePersist();
}

function newUniquePin() {
  for (let i = 0; i < 50; i++) {
    const pin = randomPin();
    if (!games.has(pin)) return pin;
  }
  return `${Date.now()}`.slice(-PIN_LENGTH);
}

function touchGame() {
  schedulePersist();
}

loadSnapshot();

module.exports = {
  MAX_PLAYERS_PER_GAME,
  DEFAULT_QUIZ,
  games,
  createGame,
  getGame,
  deleteGame,
  newUniquePin,
  touchGame,
};
