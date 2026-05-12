/* global io */
(() => {
  const $ = (id) => document.getElementById(id);
  const join = $("join");
  const wait = $("wait");
  const play = $("play");
  const reveal = $("reveal");
  const done = $("done");
  const joinErr = $("joinErr");
  const pinInput = $("pin");
  const nameInput = $("name");
  const waitTitle = $("waitTitle");
  const playMeta = $("playMeta");
  const pq = $("pq");
  const ptimer = $("ptimer");
  const pchoices = $("pchoices");
  const revealTitle = $("revealTitle");
  const miniLb = $("miniLb");
  const doneLb = $("doneLb");

  const params = new URLSearchParams(window.location.search);
  const qp = params.get("pin");
  if (qp) pinInput.value = qp.replace(/\D/g, "").slice(0, 6);

  /** @type {import('socket.io-client').Socket | null} */
  let socket = null;
  let pin = "";
  let playerToken = "";
  let timerId = null;
  let currentQ = -1;

  function show(el, on) {
    el.classList.toggle("hidden", !on);
  }

  function setError(msg) {
    if (!msg) {
      show(joinErr, false);
      joinErr.textContent = "";
      return;
    }
    joinErr.textContent = msg;
    show(joinErr, true);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    ptimer.textContent = "";
  }

  /** @param {number} sec fallback duration @param {number} [endsAt] wall-clock ms when round ends (server) */
  function startTimer(sec, endsAt) {
    stopTimer();
    const end = typeof endsAt === "number" && endsAt > 0 ? endsAt : Date.now() + sec * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      ptimer.textContent = `${left}s`;
      if (left <= 0) stopTimer();
    };
    tick();
    timerId = setInterval(tick, 250);
  }

  function tokenStorageKey(pinValue) {
    return `quiz_player_token_${pinValue}`;
  }

  function renderQuestionView(payload) {
    window.QuizMusic?.setSessionActive?.(true);
    window.QuizMusic?.playBackdrop?.();
    currentQ = payload.questionIndex;
    show(wait, false);
    show(play, true);
    show(reveal, false);
    playMeta.textContent = `Question ${payload.questionIndex + 1} of ${payload.total}`;
    pq.textContent = payload.text;
    pchoices.innerHTML = "";
    let answered = false;
    payload.choices.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `choice-btn c${i % 8}`;
      b.textContent = c;
      b.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        [...pchoices.children].forEach((x) => {
          x.disabled = true;
        });
        socket?.emit("player:answer", { pin, questionIndex: payload.questionIndex, choiceIndex: i });
      });
      pchoices.appendChild(b);
    });
    startTimer(payload.timeSec, payload.endsAt);
  }

  function wirePlayerSocketHandlers(sock) {
    sock.on("round:question", (payload) => {
      renderQuestionView(payload);
    });

    sock.on("player:answerAck", () => {});

    sock.on("round:reveal", (payload) => {
      stopTimer();
      show(play, false);
      show(reveal, true);
      revealTitle.textContent = "Scores";
      miniLb.innerHTML = "";
      (payload.leaderboard || []).forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        miniLb.appendChild(li);
      });
    });

    sock.on("game:finished", (payload) => {
      window.QuizMusic?.setSessionActive?.(false);
      stopTimer();
      show(wait, false);
      show(play, false);
      show(reveal, false);
      show(done, true);
      doneLb.innerHTML = "";
      (payload.leaderboard || []).forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        doneLb.appendChild(li);
      });
    });

    sock.on("game:ended", () => {
      window.QuizMusic?.setSessionActive?.(false);
      try {
        localStorage.removeItem(tokenStorageKey(pin));
      } catch {}
      window.location.href = "/play.html";
    });

    sock.on("lobby:update", () => {
      /* keep waiting */
    });
  }

  /** Apply server state if join happened mid-round (or after missed broadcast). */
  function applyJoinSync(sync) {
    if (!sync || !sync.phase) return;
    if (sync.phase === "question" && sync.payload) {
      show(join, false);
      renderQuestionView(sync.payload);
      return;
    }
    if (sync.phase === "reveal" && sync.payload) {
      stopTimer();
      show(join, false);
      show(wait, false);
      show(play, false);
      show(reveal, true);
      revealTitle.textContent = "Scores";
      miniLb.innerHTML = "";
      (sync.payload.leaderboard || []).forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        miniLb.appendChild(li);
      });
      return;
    }
    if (sync.phase === "finished" && sync.leaderboard) {
      stopTimer();
      window.QuizMusic?.setSessionActive?.(false);
      show(join, false);
      show(wait, false);
      show(play, false);
      show(reveal, false);
      show(done, true);
      doneLb.innerHTML = "";
      sync.leaderboard.forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        doneLb.appendChild(li);
      });
    }
  }

  $("btnJoin").addEventListener("click", () => {
    window.QuizMusic?.unlock?.();
    setError("");
    pin = pinInput.value.replace(/\D/g, "").slice(0, 8);
    const name = nameInput.value.trim();
    if (pin.length < 4) {
      setError("Enter a valid PIN");
      return;
    }
    if (!name) {
      setError("Enter a nickname");
      return;
    }
    try {
      playerToken = localStorage.getItem(tokenStorageKey(pin)) || "";
    } catch {
      playerToken = "";
    }

    socket = io({ transports: ["websocket", "polling"] });
    wirePlayerSocketHandlers(socket);

    socket.emit("player:join", { pin, name, playerId: playerToken }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Could not join");
        socket?.removeAllListeners?.();
        socket?.close();
        socket = null;
        return;
      }
      if (res.playerId) {
        playerToken = res.playerId;
        try {
          localStorage.setItem(tokenStorageKey(pin), playerToken);
        } catch {}
      }
      waitTitle.textContent = res.title || "";
      show(join, false);
      if (res.sync && res.sync.phase && res.sync.phase !== "lobby") {
        applyJoinSync(res.sync);
      } else {
        show(wait, true);
      }
    });
  });
})();
