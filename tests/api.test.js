const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuizServer } = require("../server/index");
const { games } = require("../server/gameStore");

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
