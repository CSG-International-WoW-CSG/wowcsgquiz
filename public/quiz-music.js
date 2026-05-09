/**
 * Quiz backdrop music (loop). Track: Kevin MacLeod — incompetech.com — CC BY 4.0.
 * Call unlock() from a user click/touch before play() so browsers allow audio.
 */
(() => {
  const STORAGE_KEY = "wowCsgQuizMusicEnabled";
  /** @type {HTMLAudioElement | null} */
  let audio = null;
  let fadeTimer = null;
  const baseVolume = 0.28;
  let enabled = true;
  /** True after first live question until game over (keeps music between rounds). */
  let sessionActive = false;
  /** True while host is on the quiz builder screen (before lobby). */
  let builderActive = false;

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

  function ensureAudio() {
    if (audio) return audio;
    const TRACK_URL =
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Beach%20Party.mp3";
    audio = new Audio(TRACK_URL);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = baseVolume;
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
    if (!enabled || (!sessionActive && !builderActive)) return;
    const a = ensureAudio();
    clearFade();
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
        <span class="quiz-music-credit-title">Beach Party</span>
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
