const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuizServer } = require("../server/index");
const {
  games,
  MAX_PLAYERS_PER_GAME,
  createGame,
  getGame,
  deleteGame,
  newUniquePin,
  DEFAULT_QUIZ,
} = require("../server/gameStore");

const HOST_PASSWORD = process.env.HOST_ADMIN_PASSWORD || "wowcsg-admin";

function startServer() {
  return new Promise((resolve) => {
    const svc = createQuizServer();
    svc.server.listen(0, () => {
      const addr = svc.server.address();
      resolve({ ...svc, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test("game supports up to 5000 players per room", () => {
  assert.equal(MAX_PLAYERS_PER_GAME, 5000);
});

test("game session can hold up to max player records", () => {
  games.clear();
  const pin = newUniquePin();
  createGame(pin, DEFAULT_QUIZ, "test-host-secret");
  const game = getGame(pin);
  assert.ok(game);
  for (let i = 0; i < MAX_PLAYERS_PER_GAME; i++) {
    const id = `id_${i}`;
    game.players.set(id, {
      id,
      name: `P${i}`,
      score: 0,
      connected: true,
      lastSeenAt: Date.now(),
    });
  }
  assert.equal(game.players.size, MAX_PLAYERS_PER_GAME);
  deleteGame(pin);
});

test("health endpoint works", async () => {
  const svc = await startServer();
  try {
    const res = await fetch(`${svc.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  } finally {
    await stopServer(svc.server);
  }
});

test("host session requires password and returns auth tokens", async () => {
  const svc = await startServer();
  try {
    const denied = await fetch(`${svc.baseUrl}/api/host/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: "Host", hostPassword: "bad-pass", quiz: { questions: [] } }),
    });
    assert.equal(denied.status, 401);

    const ok = await fetch(`${svc.baseUrl}/api/host/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: "Host", hostPassword: HOST_PASSWORD }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(body.pin);
    assert.ok(body.hostSecret);
    assert.ok(body.hostToken);
  } finally {
    games.clear();
    await stopServer(svc.server);
  }
});
