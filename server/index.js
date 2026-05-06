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
} = require("./gameStore");

const PORT = Number(process.env.PORT) || 3333;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true },
  // Tuned for many concurrent connections on one node
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  perMessageDeflate: true,
});

app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function hostSecret() {
  return crypto.randomBytes(24).toString("hex");
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

/** @param {import('./gameStore').GameSession} game */
function lobbyPayload(game) {
  return {
    pin: game.pin,
    title: game.quiz.title,
    playerCount: game.players.size,
    players: [...game.players.values()].map((p) => ({ name: p.name, score: p.score })),
  };
}

/** @param {import('./gameStore').GameSession} game */
function leaderboard(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

app.post("/api/host/session", (req, res) => {
  const quiz = validateQuiz(req.body?.quiz) ?? DEFAULT_QUIZ;
  const pin = newUniquePin();
  const secret = hostSecret();
  createGame(pin, quiz, secret);
  res.json({ pin, hostSecret: secret, joinUrl: `/play.html?pin=${pin}` });
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

  socket.on("player:join", ({ pin, name }, ack) => {
    const game = getGame(pin);
    if (!game) {
      ack?.({ ok: false, error: "Game not found" });
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
    const id = socket.id;
    game.players.set(id, { id, name: displayName, score: 0 });
    socket.data.role = "player";
    socket.data.pin = pin;
    socket.join(roomId(pin));
    io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
    ack?.({ ok: true, name: displayName, title: game.quiz.title });
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
    broadcastQuestion(game);
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
      revealRound(game);
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
        ack?.({ ok: true, finished: true });
        return;
      }
      game.questionIndex = next;
      game.phase = "question";
      game.answersThisRound = new Map();
      broadcastQuestion(game);
      ack?.({ ok: true });
    }
  });

  socket.on("player:answer", ({ pin, questionIndex, choiceIndex }) => {
    const game = getGame(pin);
    if (!game || game.phase !== "question") return;
    if (questionIndex !== game.questionIndex) return;
    const q = game.quiz.questions[questionIndex];
    if (!q) return;
    if (!game.players.has(socket.id)) return;
    if (game.answersThisRound.has(socket.id)) return;
    const ci = Number(choiceIndex);
    if (!Number.isInteger(ci) || ci < 0 || ci >= q.choices.length) return;
    game.answersThisRound.set(socket.id, { choiceIndex: ci, answeredAt: Date.now() });
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
    if (socket.data.role === "player" && game.players.has(socket.id)) {
      if (game.phase === "lobby") {
        game.players.delete(socket.id);
        io.to(roomId(pin)).emit("lobby:update", lobbyPayload(game));
      }
    }
  });
});

function roomId(pin) {
  return `game:${pin}`;
}

/** @param {import('./gameStore').GameSession} game */
function broadcastQuestion(game) {
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

/** @param {import('./gameStore').GameSession} game */
function revealRound(game) {
  const q = game.quiz.questions[game.questionIndex];
  const correctIndex = q.correctIndex;
  const startedAt = game.questionStartedAt ?? Date.now();
  const windowMs = Math.max(1000, q.timeSec * 1000);

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

  io.to(roomId(game.pin)).emit("round:reveal", {
    questionIndex: game.questionIndex,
    correctIndex,
    choiceCounts: q.choices.map((_, i) => game.answersThisRound.size
      ? [...game.answersThisRound.values()].filter((v) => v.choiceIndex === i).length
      : 0),
    leaderboard: leaderboard(game),
  });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Live quiz app → http://localhost:${PORT}`);
});
