/**
 * In-memory game sessions. For multiple app instances behind a load balancer,
 * replace this with Redis + @socket.io/redis-adapter and shared session state.
 */

const MAX_PLAYERS_PER_GAME = 500;
const PIN_LENGTH = 6;

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

/**
 * @param {string} pin
 * @param {import('./types').Quiz} quiz
 * @param {string} hostSecret
 */
function createGame(pin, quiz, hostSecret) {
  games.set(pin, {
    pin,
    hostSecret,
    quiz,
    phase: "lobby",
    questionIndex: -1,
    /** @type {Map<string, import('./types').PlayerState>} */
    players: new Map(),
    answersThisRound: new Map(),
    createdAt: Date.now(),
  });
}

function getGame(pin) {
  return games.get(pin) ?? null;
}

function deleteGame(pin) {
  games.delete(pin);
}

function newUniquePin() {
  for (let i = 0; i < 50; i++) {
    const pin = randomPin();
    if (!games.has(pin)) return pin;
  }
  return `${Date.now()}`.slice(-PIN_LENGTH);
}

module.exports = {
  MAX_PLAYERS_PER_GAME,
  DEFAULT_QUIZ,
  games,
  createGame,
  getGame,
  deleteGame,
  newUniquePin,
};
