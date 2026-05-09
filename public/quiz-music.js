/**
 * Quiz backdrop music: playlist of similar upbeat tracks (no single-song loop).
 * Tracks: Kevin MacLeod — incompetech.com — CC BY 4.0.
 * Call unlock() from a user click/touch before play() so browsers allow audio.
 */
(() => {
  const STORAGE_KEY = "wowCsgQuizMusicEnabled";
  /** Similar tempo/mood — rotates when each track ends (not the same song on repeat). */
  const TRACKS = [
    {
      title: "Beach Party",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Beach%20Party.mp3",
    },
    {
      title: "Happy Alley",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Happy%20Alley.mp3",
    },
    {
      title: "Jaunty Gumption",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Jaunty%20Gumption.mp3",
    },
    {
      title: "Who Likes to Party",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Who%20Likes%20to%20Party.mp3",
    },
    {
      title: "Feelin Good",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Feelin%20Good.mp3",
    },
    {
      title: "Carefree",
      url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3",
    },
  ];

  /** @type {HTMLAudioElement | null} */
  let audio = null;
  let fadeTimer = null;
  const baseVolume = 0.28;
  let enabled = true;
  /** True after first live question until game over (keeps music between rounds). */
  let sessionActive = false;
  /** True while host is on the quiz builder screen (before lobby). */
  let builderActive = false;
  /** Index into TRACKS for the current song. */
  let trackIndex = 0;
  /** Avoid infinite skip loops if sources fail to load. */
  let consecutiveErrors = 0;

  function loadPref() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "0") enabled = false;
      if (v === "1") enabled = true;
    } catch (_) {
      /* ignore */
    }
  }

  function savePref() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function shouldPlayBackdrop() {
    return enabled && (sessionActive || builderActive);
  }

  function updateCreditUi() {
    const titleEl = document.getElementById("quizMusicTrackTitle");
    const t = TRACKS[trackIndex];
    if (titleEl && t) titleEl.textContent = t.title;
  }

  /** Pick a different track than the current one when possible. */
  function pickNextTrackIndex() {
    if (TRACKS.length < 2) return 0;
    let n = Math.floor(Math.random() * TRACKS.length);
    let guard = 0;
    while (n === trackIndex && guard < 8) {
      n = Math.floor(Math.random() * TRACKS.length);
      guard += 1;
    }
    return n;
  }

  /**
   * @param {number} i
   */
  function loadTrack(i) {
    if (!audio) return;
    trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const t = TRACKS[trackIndex];
    audio.src = t.url;
    try {
      audio.load();
    } catch (_) {
      /* ignore */
    }
    updateCreditUi();
  }

  function onTrackEnded() {
    consecutiveErrors = 0;
    if (!shouldPlayBackdrop()) return;
    loadTrack(pickNextTrackIndex());
    const a = audio;
    if (!a) return;
    a.volume = baseVolume;
    a.play().catch(() => {});
  }

  function onTrackError() {
    if (!shouldPlayBackdrop()) return;
    consecutiveErrors += 1;
    if (consecutiveErrors > TRACKS.length * 2) return;
    loadTrack(trackIndex + 1);
    const a = audio;
    if (!a) return;
    a.volume = baseVolume;
    a.play().catch(() => {});
  }

  function ensureAudio() {
    if (audio) return audio;
    trackIndex = Math.floor(Math.random() * TRACKS.length);
    audio = new Audio();
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = baseVolume;
    audio.addEventListener("ended", onTrackEnded);
    audio.addEventListener("error", onTrackError);
    loadTrack(trackIndex);
    return audio;
  }

  function clearFade() {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  /**
   * Warm the audio graph inside a click handler (required on many browsers).
   * @returns {Promise<void>}
   */
  function unlock() {
    const a = ensureAudio();
    const prev = a.volume;
    a.volume = 0;
    return a
      .play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = prev;
      })
      .catch(() => {
        a.volume = prev;
      });
  }

  function playBackdrop() {
    if (!shouldPlayBackdrop()) return;
    const a = ensureAudio();
    clearFade();
    consecutiveErrors = 0;
    a.volume = baseVolume;
    a.play().catch(() => {});
  }

  function stopBackdrop() {
    const a = audio;
    if (!a) return;
    clearFade();
    const start = a.volume || baseVolume;
    const steps = 14;
    let step = 0;
    fadeTimer = setInterval(() => {
      step += 1;
      a.volume = Math.max(0, start * (1 - step / steps));
      if (step >= steps) {
        clearFade();
        a.pause();
        try {
          a.currentTime = 0;
        } catch (_) {
          /* ignore */
        }
        a.volume = baseVolume;
      }
    }, 45);
  }

  /**
   * @param {boolean} on - false fades out and stops; true only marks session (use playBackdrop after).
   */
  function setSessionActive(on) {
    sessionActive = Boolean(on);
    if (!sessionActive && !builderActive) stopBackdrop();
  }

  /**
   * Host quiz builder: allow backdrop while editing questions (still requires a prior user gesture via unlock).
   * @param {boolean} on
   */
  function setBuilderActive(on) {
    builderActive = Boolean(on);
    if (!builderActive && !sessionActive) stopBackdrop();
    else if (builderActive && enabled) playBackdrop();
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    savePref();
    const btn = document.getElementById("quizMusicToggle");
    if (btn) {
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.textContent = enabled ? "Music on" : "Music off";
    }
    if (!enabled) stopBackdrop();
  }

  function isEnabled() {
    return enabled;
  }

  function mountToggle() {
    if (document.getElementById("quizMusicBar")) return;
    const firstTitle = TRACKS[0].title;
    const bar = document.createElement("div");
    bar.id = "quizMusicBar";
    bar.className = "quiz-music-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Quiz music");
    bar.innerHTML = `
      <button type="button" class="quiz-music-toggle" id="quizMusicToggle" aria-pressed="${enabled ? "true" : "false"}">
        ${enabled ? "Music on" : "Music off"}
      </button>
      <p class="quiz-music-credit">
        Now playing: <span class="quiz-music-credit-title" id="quizMusicTrackTitle">${firstTitle}</span>
        · Kevin MacLeod ·
        <a href="https://incompetech.com/music/royalty-free/music.html" target="_blank" rel="noopener noreferrer">incompetech.com</a>
        · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
      </p>
    `;
    document.body.appendChild(bar);
    const btn = bar.querySelector("#quizMusicToggle");
    btn.addEventListener("click", () => {
      unlock().finally(() => {
        setEnabled(!enabled);
        if (enabled && (sessionActive || builderActive)) playBackdrop();
      });
    });
  }

  loadPref();

  if (document.body) mountToggle();
  else document.addEventListener("DOMContentLoaded", mountToggle, { once: true });

  window.QuizMusic = {
    unlock,
    playBackdrop,
    stopBackdrop,
    setEnabled,
    isEnabled,
    setSessionActive,
    setBuilderActive,
    mountToggle,
  };
})();
