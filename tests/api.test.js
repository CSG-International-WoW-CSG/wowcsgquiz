const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
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

test("host session requires a game password (6–100 chars) and returns auth tokens", async () => {
  const svc = await startServer();
  try {
    const deniedShort = await fetch(`${svc.baseUrl}/api/host/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: "Host", hostPassword: "short", quiz: { questions: [] } }),
    });
    assert.equal(deniedShort.status, 400);

    const deniedEmpty = await fetch(`${svc.baseUrl}/api/host/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: "Host", hostPassword: "   ", quiz: { questions: [] } }),
    });
    assert.equal(deniedEmpty.status, 400);

    const ok = await fetch(`${svc.baseUrl}/api/host/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostName: "Host", hostPassword: "my-own-game-pass" }),
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

const sampleQuiz = {
  title: "LibTest",
  questions: [{ text: "Q1?", choices: ["A", "B"], correctIndex: 0, timeSec: 10 }],
};

test("quiz library rejects bad password", async () => {
  const svc = await startServer();
  try {
    const res = await fetch(`${svc.baseUrl}/api/quizzes/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostPassword: "wrong", name: "X", quiz: sampleQuiz }),
    });
    assert.equal(res.status, 401);
  } finally {
    await stopServer(svc.server);
  }
});

test("quiz library save list and update", async () => {
  const svc = await startServer();
  const libPath = path.join(__dirname, "..", ".data", "saved-quizzes.json");
  try {
    if (fs.existsSync(libPath)) fs.unlinkSync(libPath);

    const post = await fetch(`${svc.baseUrl}/api/quizzes/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostPassword: HOST_PASSWORD, name: "My Quiz", quiz: sampleQuiz }),
    });
    assert.equal(post.status, 200);
    const created = await post.json();
    assert.ok(created.id);

    const list = await fetch(`${svc.baseUrl}/api/quizzes/library?hostPassword=${encodeURIComponent(HOST_PASSWORD)}`);
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.equal(listJson.items.length, 1);

    const updatedQuiz = {
      title: "LibTest2",
      questions: [{ text: "Q2?", choices: ["X", "Y"], correctIndex: 1, timeSec: 15 }],
    };
    const put = await fetch(`${svc.baseUrl}/api/quizzes/library/${encodeURIComponent(created.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostPassword: HOST_PASSWORD, name: "Renamed", quiz: updatedQuiz }),
    });
    assert.equal(put.status, 200);
  } finally {
    if (fs.existsSync(libPath)) fs.unlinkSync(libPath);
    await stopServer(svc.server);
  }
});
