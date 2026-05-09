const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  MAX_PLAYERS_PER_GAME,
  DEFAULT_QUIZ,
  createGame,
  getGame,
  deleteGame,
  newUniquePin,
  touchGame,
} = require("./gameStore");

const PORT = Number(process.env.PORT) || 3333;
const HOST_ADMIN_PASSWORD = String(process.env.HOST_ADMIN_PASSWORD || "wowcsg-admin");
const PLAYER_RECONNECT_GRACE_MS = 60000;

function randomId(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hostSecret() {
  return randomId(24);
}

function sanitizeName(name) {
  const s = String(name ?? "").trim().slice(0, 24);
  return s || "Player";
}

function validateQuiz(body) {
  if (!body || typeof body !== "object") return null;
  const title = String(body.title ?? "Quiz").slice(0, 120);
  const questions = Array.isArray(body.questions) ? body.questions : [];
  const out = [];
  for (const q of questions.slice(0, 100)) {
    const text = String(q.text ?? "").slice(0, 500);
    const choices = (Array.isArray(q.choices) ? q.choices : [])
      .map((c) => String(c).slice(0, 200))
      .slice(0, 8);
    if (choices.length < 2) continue;
    let correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
      correctIndex = 0;
    }
    const timeSec = Math.min(120, Math.max(5, Number(q.timeSec) || 20));
    const points = Math.min(5000, Math.max(100, Number(q.points) || 1000));
    if (text) out.push({ text, choices, correctIndex, timeSec, points });
  }
  if (!out.length) return null;
  return { title, questions: out };
}

function requireHostPassword(password) {
  return String(password ?? "") === HOST_ADMIN_PASSWORD;
}

/** @param {import('./types').GameSession} game */
function lobbyPayload(game) {
  const players = [...game.players.values()];
  return {
    pin: game.pin,
    title: game.quiz.title,
    playerCount: players.length,
    connectedCount: players.filter((p) => p.connected).length,
    hostName: game.hostName || "Host",
    players: players.map((p) => ({ name: p.name, score: p.score, connected: p.connected })),
  };
}

/** @param {import('./types').GameSession} game */
function leaderboard(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function roomId(pin) {
  return `game:${pin}`;
}

/** @param {import('./types').GameSession} game */
function buildAnalyticsSummary(game) {
  const questionCount = game.quiz.questions.length;
  const rounds = game.analytics || [];
  const totalAnswers = rounds.reduce((sum, x) => sum + (x.totalAnswers || 0), 0);
  return {
    pin: game.pin,
    title: game.quiz.title,
    hostName: game.hostName || "Host",
    phase: game.phase,
    questionCount,
    answeredEvents: totalAnswers,
    players: game.players.size,
    createdAt: game.createdAt,
  };
}

function createQuizServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: true },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    perMessageDeflate: true,
  });

  app.use(express.json({ limit: "512kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.post("/api/host/session", (req, res) => {
    const hostName = sanitizeName(req.body?.hostName || "Host");
    if (!requireHostPassword(req.body?.hostPassword)) {
      res.status(401).json({ ok: false, error: "Invalid host password" });
      return;
    }
    const quiz = validateQuiz(req.body?.quiz) ?? DEFAULT_QUIZ;
    const pin = newUniquePin();
    const secret = hostSecret();
    const hostToken = randomId(18);
    createGame(pin, quiz, secret);
    const game = getGame(pin);
    if (game) {
      game.hostName = hostName;
      game.hostToken = hostToken;
      touchGame();
    }
    res.json({
      pin,
      hostSecret: secret,
      hostToken,
      joinUrl: `/play.html?pin=${pin}`,
      analyticsUrl: `/api/game/${pin}/analytics?hostSecret=${secret}`,
    });
  });

  app.get("/api/host/sessions", (req, res) => {
    const hostToken = String(req.query.hostToken || "");
    if (!hostToken) {
      res.status(401).json({ ok: false, error: "Missing host token" });
      return;
    }
    const sessions = [];
    const { games } = require("./gameStore");
    for (const g of games.values()) {
      if (g.hostToken === hostToken) sessions.push(buildAnalyticsSummary(g));
    }
    res.json({ ok: true, sessions });
  });

  app.get("/api/game/:pin/analytics", (req, res) => {
    const pin = String(req.params.pin || "");
    const game = getGame(pin);
    if (!game || game.hostSecret !== String(req.query.hostSecret || "")) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }
    res.json({
      ok: true,
      pin: game.pin,
      title: game.quiz.title,
      hostName: game.hostName || "Host",
      phase: game.phase,
      players: [...game.players.values()].map((p) => ({
        name: p.name,
        score: p.score,
        connected: p.connected,
      })),
      analytics: game.analytics || [],
    });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  io.on("connection", (socket) => {
    socket.on("host:join", ({ pin, hostSecret: hs }, ack) => {
      const game = getGame(pin);
      if (!game || game.hostSecret !== hs) {
        ack?.({ ok: false, error: "Invalid host session" });
        return;
      }
      socket.data.role = "host";
      socket.data.pin = pin;
      socket.join(roomId(pin));
      ack?.({ ok: true, game: lobbyPayload(game) });
    });

    socket.on("player:join", ({ pin, name, playerId }, ack) => {
      const game = getGame(pin);
      if (!game) {
        ack?.({ ok: false, error: "Game not found" });
        return;
      }

      const reconnectPlayerId = String(playerId || "");
      if (reconnectPlayerId && game.players.has(reconnectPlayerId)) {
        const player = game.players.get(reconnectPlayerId);
        player.connected = true;
        player.lastSeenAt = Date.now();
        socket.data.role = "player";
        socket.data.pin = pin;
        socket.data.playerId = reconnectPlayerId;
        socket.join(roomId(pin));
        io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
        touchGame();
        ack?.({
          ok: true,
          resumed: true,
          playerId: reconnectPlayerId,
          name: player.name,
          title: game.quiz.title,
          phase: game.phase,
        });
        return;
      }

      if (game.players.size >= MAX_PLAYERS_PER_GAME) {
        ack?.({ ok: false, error: `This game is full (${MAX_PLAYERS_PER_GAME} players)` });
        return;
      }
      if (game.phase !== "lobby") {
        ack?.({ ok: false, error: "Game already started" });
        return;
      }
      const displayName = sanitizeName(name);
      const id = randomId(10);
      game.players.set(id, {
        id,
        name: displayName,
        score: 0,
        connected: true,
        lastSeenAt: Date.now(),
      });
      socket.data.role = "player";
      socket.data.pin = pin;
      socket.data.playerId = id;
      socket.join(roomId(pin));
      io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
      touchGame();
      ack?.({ ok: true, playerId: id, name: displayName, title: game.quiz.title, resumed: false });
    });

    socket.on("host:start", ({ pin, hostSecret: hs }, ack) => {
      const game = getGame(pin);
      if (!game || game.hostSecret !== hs) {
        ack?.({ ok: false });
        return;
      }
      if (game.players.size < 1) {
        ack?.({ ok: false, error: "Need at least one player" });
        return;
      }
      game.phase = "question";
      game.questionIndex = 0;
      game.answersThisRound = new Map();
      touchGame();
      broadcastQuestion(io, game);
      ack?.({ ok: true });
    });

    socket.on("host:next", ({ pin, hostSecret: hs }, ack) => {
      const game = getGame(pin);
      if (!game || game.hostSecret !== hs) {
        ack?.({ ok: false });
        return;
      }
      if (game.phase === "finished") {
        ack?.({ ok: false });
        return;
      }
      if (game.phase === "question") {
        revealRound(io, game);
        ack?.({ ok: true });
        return;
      }
      if (game.phase === "reveal") {
        const next = game.questionIndex + 1;
        if (next >= game.quiz.questions.length) {
          game.phase = "finished";
          io.to(roomId(pin)).emit("game:finished", {
            leaderboard: leaderboard(game),
          });
          touchGame();
          ack?.({ ok: true, finished: true });
          return;
        }
        game.questionIndex = next;
        game.phase = "question";
        game.answersThisRound = new Map();
        touchGame();
        broadcastQuestion(io, game);
        ack?.({ ok: true });
      }
    });

    socket.on("player:answer", ({ pin, questionIndex, choiceIndex }) => {
      const game = getGame(pin);
      if (!game || game.phase !== "question") return;
      if (questionIndex !== game.questionIndex) return;
      const q = game.quiz.questions[questionIndex];
      if (!q) return;
      const pid = String(socket.data.playerId || "");
      if (!pid || !game.players.has(pid)) return;
      if (game.answersThisRound.has(pid)) return;
      const ci = Number(choiceIndex);
      if (!Number.isInteger(ci) || ci < 0 || ci >= q.choices.length) return;
      game.answersThisRound.set(pid, { choiceIndex: ci, answeredAt: Date.now() });
      const player = game.players.get(pid);
      if (player) player.lastSeenAt = Date.now();
      touchGame();
      socket.emit("player:answerAck", { questionIndex, choiceIndex: ci });
      io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
    });

    socket.on("host:end", ({ pin, hostSecret: hs }) => {
      const game = getGame(pin);
      if (!game || game.hostSecret !== hs) return;
      deleteGame(pin);
      io.to(roomId(pin)).emit("game:ended");
    });

    socket.on("disconnect", () => {
      const pin = socket.data.pin;
      const game = pin ? getGame(pin) : null;
      if (!game) return;
      if (socket.data.role === "player") {
        const pid = String(socket.data.playerId || "");
        const player = game.players.get(pid);
        if (!player) return;
        player.connected = false;
        player.lastSeenAt = Date.now();
        io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
        touchGame();
        setTimeout(() => {
          const g2 = getGame(pin);
          const p2 = g2?.players.get(pid);
          if (!g2 || !p2) return;
          if (p2.connected) return;
          if (Date.now() - p2.lastSeenAt < PLAYER_RECONNECT_GRACE_MS) return;
          if (g2.phase === "lobby") {
            g2.players.delete(pid);
            io.to(roomId(pin)).emit("lobby:update", lobbyPayload(g2));
            touchGame();
          }
        }, PLAYER_RECONNECT_GRACE_MS + 100);
      }
    });
  });

  return { app, server, io };
}

/** @param {import('./types').GameSession} game */
function broadcastQuestion(io, game) {
  game.questionStartedAt = Date.now();
  const q = game.quiz.questions[game.questionIndex];
  const payload = {
    questionIndex: game.questionIndex,
    total: game.quiz.questions.length,
    text: q.text,
    choices: q.choices,
    timeSec: q.timeSec,
    points: q.points,
  };
  io.to(roomId(game.pin)).emit("round:question", payload);
}

/** @param {import('./types').GameSession} game */
function revealRound(io, game) {
  const q = game.quiz.questions[game.questionIndex];
  const correctIndex = q.correctIndex;
  const startedAt = game.questionStartedAt ?? Date.now();
  const windowMs = Math.max(1000, q.timeSec * 1000);
  const answers = [...game.answersThisRound.values()];
  const choiceCounts = q.choices.map((_, i) =>
    answers.length ? answers.filter((v) => v.choiceIndex === i).length : 0
  );
  for (const [playerId, ans] of game.answersThisRound.entries()) {
    const p = game.players.get(playerId);
    if (!p) continue;
    const correct = ans.choiceIndex === correctIndex;
    if (!correct) continue;
    const max = q.points;
    const elapsed = Math.max(0, ans.answeredAt - startedAt);
    const ratio = Math.max(0, 1 - Math.min(1, elapsed / windowMs));
    const bonus = Math.round(max * ratio * 0.5);
    p.score += Math.round(max * 0.5) + bonus;
  }

  game.phase = "reveal";
  const correctAnswers = answers.filter((a) => a.choiceIndex === correctIndex).length;
  const avgResponseMs = answers.length
    ? Math.round(
        answers.reduce((sum, a) => sum + Math.max(0, a.answeredAt - startedAt), 0) / answers.length
      )
    : 0;
  game.analytics[game.questionIndex] = {
    questionIndex: game.questionIndex,
    correctIndex,
    totalAnswers: answers.length,
    correctAnswers,
    avgResponseMs,
    choiceCounts,
    createdAt: Date.now(),
  };
  touchGame();

  io.to(roomId(game.pin)).emit("round:reveal", {
    questionIndex: game.questionIndex,
    correctIndex,
    choiceCounts,
    leaderboard: leaderboard(game),
  });
}

if (require.main === module) {
  const { server } = createQuizServer();
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Live quiz app → http://localhost:${PORT}`);
  });
}

module.exports = { createQuizServer };
