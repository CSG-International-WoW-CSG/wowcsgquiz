/* global io */
(() => {
  const $ = (id) => document.getElementById(id);
  const setup = $("setup");
  const lobby = $("lobby");
  const live = $("live");
  const setupErr = $("setupErr");
  const lobbyErr = $("lobbyErr");
  const pinDisplay = $("pinDisplay");
  const joinHint = $("joinHint");
  const plist = $("plist");
  const pc = $("pc");
  const qtext = $("qtext");
  const qmeta = $("qmeta");
  const timerEl = $("timer");
  const choicesPreview = $("choicesPreview");
  const btnCreate = $("btnCreate");
  const btnStart = $("btnStart");
  const btnEndLobby = $("btnEndLobby");
  const btnReveal = $("btnReveal");
  const btnNext = $("btnNext");
  const revealPanel = $("revealPanel");
  const correctLine = $("correctLine");
  const leaderboard = $("leaderboard");
  const finished = $("finished");
  const finalBoard = $("finalBoard");
  const phaseBadge = $("phaseBadge");
  const quizBuilder = $("quizBuilder");
  const quizTitle = $("quizTitle");
  const hostNameInput = $("hostName");
  const hostPasswordInput = $("hostPassword");
  const quizJson = $("quizJson");
  const btnAddQ = $("btnAddQ");
  const btnLoadSample = $("btnLoadSample");
  const connectedPc = $("connectedPc");
  const btnAnalytics = $("btnAnalytics");
  const analyticsPanel = $("analyticsPanel");
  const analyticsText = $("analyticsText");

  const SAMPLE_QUIZ = {
    title: "WoW-CSG Quiz",
    questions: [
      {
        text: "What is 12 × 7?",
        choices: ["74", "84", "94", "72"],
        correctIndex: 1,
        timeSec: 20,
      },
      {
        text: "Which protocol is connection-oriented?",
        choices: ["UDP", "HTTP/3 only", "TCP", "ICMP"],
        correctIndex: 2,
        timeSec: 25,
      },
      {
        text: "Capital of Saudi Arabia?",
        choices: ["Jeddah", "Riyadh", "Dammam", "Mecca"],
        correctIndex: 1,
        timeSec: 20,
      },
    ],
  };

  let pin = "";
  let hostSecret = "";
  let hostToken = "";
  /** @type {import('socket.io-client').Socket | null} */
  let socket = null;
  let timerId = null;

  /** First successful unlock in the quiz builder starts backdrop (browser autoplay policy). */
  let builderMusicPrimed = false;
  let builderUnlockPending = false;
  function primeBuilderMusic() {
    if (builderMusicPrimed || builderUnlockPending) return;
    builderUnlockPending = true;
    window.QuizMusic?.unlock?.().finally(() => {
      builderUnlockPending = false;
      builderMusicPrimed = true;
      window.QuizMusic?.setBuilderActive?.(true);
    });
  }
  setup.addEventListener("pointerdown", primeBuilderMusic, { passive: true });
  setup.addEventListener("keydown", primeBuilderMusic, { passive: true });
  setup.addEventListener("focusin", primeBuilderMusic);

  function show(el, on) {
    el.classList.toggle("hidden", !on);
  }

  function setError(el, msg) {
    if (!msg) {
      show(el, false);
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    show(el, true);
  }

  function newQid() {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function renumberQuestions() {
    const blocks = quizBuilder.querySelectorAll(".builder-q");
    blocks.forEach((block, i) => {
      const num = block.querySelector(".q-num");
      if (num) num.textContent = String(i + 1);
      const rm = block.querySelector(".rm-q");
      if (rm) rm.disabled = blocks.length <= 1;
    });
  }

  /**
   * @param {{ text?: string, choices?: string[], correctIndex?: number, timeSec?: number } | undefined} pref
   */
  function addQuestion(pref) {
    const qid = newQid();
    const text = pref?.text ?? "";
    const timeSec = pref?.timeSec ?? 20;
    const choices = pref?.choices ?? ["", "", "", ""];
    while (choices.length < 4) choices.push("");
    const correct = Math.min(3, Math.max(0, Number(pref?.correctIndex) || 0));

    const section = document.createElement("section");
    section.className = "builder-q";
    section.dataset.qid = qid;
    section.innerHTML = `
      <h3>Question <span class="q-num">1</span>
        <button type="button" class="btn danger sm rm-q">Remove</button>
      </h3>
      <div class="row-2">
        <div>
          <label>Question text</label>
          <input class="q-text" type="text" maxlength="500" placeholder="Type your question" value="" />
        </div>
        <div>
          <label>Time (seconds)</label>
          <input class="q-time" type="number" min="5" max="120" step="1" value="20" />
        </div>
      </div>
      <p class="fineprint" style="margin:0 0 8px">Answers — select the correct one (fill at least two, from top to bottom)</p>
      ${[0, 1, 2, 3]
        .map(
          (i) => `
        <div class="choice-row">
          <input type="radio" name="correct_${qid}" value="${i}" ${i === correct ? "checked" : ""} aria-label="Correct answer ${i + 1}" />
          <input class="q-choice" type="text" maxlength="200" placeholder="Answer ${i + 1}" data-slot="${i}" value="" />
        </div>`
        )
        .join("")}
    `;
    section.querySelector(".q-text").value = text;
    section.querySelector(".q-time").value = String(timeSec);
    const choiceInputs = section.querySelectorAll(".q-choice");
    choiceInputs.forEach((inp, i) => {
      inp.value = choices[i] ?? "";
    });

    section.querySelector(".rm-q").addEventListener("click", () => {
      if (quizBuilder.querySelectorAll(".builder-q").length <= 1) return;
      section.remove();
      renumberQuestions();
    });

    quizBuilder.appendChild(section);
    renumberQuestions();
  }

  function clearBuilder() {
    quizBuilder.innerHTML = "";
  }

  function loadSampleIntoForm() {
    clearBuilder();
    quizTitle.value = SAMPLE_QUIZ.title;
    SAMPLE_QUIZ.questions.forEach((q) => addQuestion(q));
  }

  /** @returns {{ ok: true, quiz: object } | { ok: false, error: string }} */
  function buildQuizFromForm() {
    const title = quizTitle.value.trim() || "WoW-CSG Quiz";
    const blocks = [...quizBuilder.querySelectorAll(".builder-q")];
    if (!blocks.length) return { ok: false, error: "Add at least one question" };

    const questions = [];
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      const qText = block.querySelector(".q-text").value.trim();
      if (!qText) return { ok: false, error: `Question ${b + 1}: enter question text` };

      const slots = [...block.querySelectorAll(".q-choice")].map((inp) => inp.value.trim());
      let last = -1;
      for (let i = 0; i < 4; i++) {
        if (slots[i]) last = i;
      }
      if (last < 1) return { ok: false, error: `Question ${b + 1}: enter at least two answers (top to bottom)` };
      for (let i = 0; i <= last; i++) {
        if (!slots[i]) return { ok: false, error: `Question ${b + 1}: fill answer ${i + 1} or remove gaps between answers` };
      }
      const choices = slots.slice(0, last + 1);

      const qid = block.dataset.qid;
      const checked = block.querySelector(`input[name="correct_${qid}"]:checked`);
      const correctSlot = checked ? Number(checked.value) : 0;
      if (!Number.isInteger(correctSlot) || correctSlot < 0 || correctSlot > last) {
        return { ok: false, error: `Question ${b + 1}: pick which answer is correct` };
      }

      let timeSec = Number(block.querySelector(".q-time").value);
      if (!Number.isFinite(timeSec)) timeSec = 20;
      timeSec = Math.min(120, Math.max(5, Math.round(timeSec)));

      questions.push({
        text: qText,
        choices,
        correctIndex: correctSlot,
        timeSec,
        points: 1000,
      });
    }
    return { ok: true, quiz: { title, questions } };
  }

  btnAddQ.addEventListener("click", () => addQuestion());
  btnLoadSample.addEventListener("click", () => loadSampleIntoForm());

  addQuestion();

  function connectSocket() {
    socket = io({ transports: ["websocket", "polling"] });
    socket.emit("host:join", { pin, hostSecret }, (res) => {
      if (!res?.ok) {
        setError(setupErr, res?.error || "Could not connect as host");
        show(lobby, false);
        show(setup, true);
        pin = "";
        hostSecret = "";
        socket?.disconnect();
        socket = null;
        return;
      }
      renderLobby(res.game);
    });

    socket.on("lobby:update", (g) => {
      if (g.pin === pin) renderLobby(g);
    });

    socket.on("round:question", (payload) => {
      window.QuizMusic?.setSessionActive?.(true);
      window.QuizMusic?.playBackdrop?.();
      show(lobby, false);
      show(live, true);
      show(revealPanel, false);
      show(finished, false);
      show(btnReveal, true);
      show(btnNext, false);
      phaseBadge.textContent = "Question";
      qmeta.textContent = `Question ${payload.questionIndex + 1} of ${payload.total}`;
      qtext.textContent = payload.text;
      choicesPreview.innerHTML = "";
      payload.choices.forEach((c, i) => {
        const d = document.createElement("div");
        d.className = `choice-btn c${i % 8}`;
        d.textContent = c;
        d.style.gridColumn = "span 1";
        choicesPreview.appendChild(d);
      });
      startTimer(payload.timeSec);
    });

    socket.on("round:reveal", (payload) => {
      stopTimer();
      show(btnReveal, false);
      show(btnNext, true);
      phaseBadge.textContent = "Answer";
      const letter = String.fromCharCode(65 + payload.correctIndex);
      correctLine.textContent = `Correct answer: ${letter} — ${payload.choiceCounts[payload.correctIndex] ?? 0} correct`;
      leaderboard.innerHTML = "";
      (payload.leaderboard || []).forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        leaderboard.appendChild(li);
      });
      show(revealPanel, true);
    });

    socket.on("game:finished", (payload) => {
      window.QuizMusic?.setSessionActive?.(false);
      stopTimer();
      show(btnReveal, false);
      show(btnNext, false);
      show(revealPanel, false);
      phaseBadge.textContent = "Finished";
      finalBoard.innerHTML = "";
      (payload.leaderboard || []).forEach((row) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${row.rank}. ${escapeHtml(row.name)}</span><span class="score">${row.score}</span>`;
        finalBoard.appendChild(li);
      });
      show(finished, true);
    });

    socket.on("game:ended", () => {
      window.QuizMusic?.setSessionActive?.(false);
      window.location.href = "/";
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderLobby(g) {
    pc.textContent = String(g.playerCount);
    connectedPc.textContent = String(g.connectedCount ?? g.playerCount ?? 0);
    plist.innerHTML = "";
    (g.players || []).forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(p.name)}${p.connected === false ? " (offline)" : ""}</span><span class="score">${p.score}</span>`;
      plist.appendChild(li);
    });
  }

  async function loadAnalytics() {
    if (!pin || !hostSecret) return;
    analyticsText.textContent = "Loading...";
    show(analyticsPanel, true);
    try {
      const res = await fetch(`/api/game/${encodeURIComponent(pin)}/analytics?hostSecret=${encodeURIComponent(hostSecret)}`);
      if (!res.ok) {
        analyticsText.textContent = "Could not load analytics.";
        return;
      }
      const data = await res.json();
      const rows = (data.analytics || [])
        .map((a) => {
          const pct = a.totalAnswers ? Math.round((a.correctAnswers / a.totalAnswers) * 100) : 0;
          return `Q${a.questionIndex + 1}: ${a.correctAnswers}/${a.totalAnswers} correct (${pct}%), avg response ${a.avgResponseMs}ms`;
        })
        .join("\n");
      analyticsText.textContent = rows || "No analytics yet. Start the quiz and reveal answers.";
    } catch {
      analyticsText.textContent = "Could not load analytics.";
    }
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    timerEl.textContent = "";
  }

  function startTimer(sec) {
    stopTimer();
    const end = Date.now() + sec * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      timerEl.textContent = `${left}s`;
      if (left <= 0) stopTimer();
    };
    tick();
    timerId = setInterval(tick, 250);
  }

  btnCreate.addEventListener("click", async () => {
    window.QuizMusic?.unlock?.();
    setError(setupErr, "");
    let quiz;

    const rawJson = quizJson.value.trim();
    if (rawJson) {
      try {
        quiz = JSON.parse(rawJson);
      } catch {
        setError(setupErr, "Invalid JSON in advanced import");
        return;
      }
      if (!quiz || typeof quiz !== "object" || !Array.isArray(quiz.questions)) {
        setError(setupErr, 'JSON must be an object with a "questions" array (same shape as the API).');
        return;
      }
    } else {
      const built = buildQuizFromForm();
      if (!built.ok) {
        setError(setupErr, built.error);
        return;
      }
      quiz = built.quiz;
    }

    const res = await fetch("/api/host/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quiz,
        hostName: hostNameInput.value.trim() || "Host",
        hostPassword: hostPasswordInput.value,
      }),
    });
    if (!res.ok) {
      const maybe = await res.json().catch(() => ({}));
      setError(setupErr, maybe.error || "Server error");
      return;
    }
    const data = await res.json();
    pin = data.pin;
    hostSecret = data.hostSecret;
    hostToken = data.hostToken || "";
    try {
      localStorage.setItem("quiz_host_token", hostToken);
    } catch {}
    pinDisplay.textContent = pin;
    const base = `${window.location.origin}`;
    joinHint.innerHTML = `Player link: <a href="${base}/play.html?pin=${pin}" style="color:#00cec9">${base}/play.html?pin=${pin}</a>`;
    window.QuizMusic?.setBuilderActive?.(false);
    show(setup, false);
    show(lobby, true);
    connectSocket();
  });

  btnStart.addEventListener("click", () => {
    window.QuizMusic?.unlock?.();
    setError(lobbyErr, "");
    socket?.emit("host:start", { pin, hostSecret }, (res) => {
      if (!res?.ok) setError(lobbyErr, res?.error || "Could not start");
    });
  });

  btnEndLobby.addEventListener("click", () => {
    socket?.emit("host:end", { pin, hostSecret });
  });

  btnReveal.addEventListener("click", () => {
    socket?.emit("host:next", { pin, hostSecret }, () => {});
  });

  btnNext.addEventListener("click", () => {
    socket?.emit("host:next", { pin, hostSecret }, (res) => {
      if (res?.finished) {
        show(btnNext, false);
      }
    });
  });

  btnAnalytics.addEventListener("click", () => {
    loadAnalytics();
  });
})();
