/**
 * Socket.IO player join load test (optional dev tool).
 *
 * Usage (PowerShell):
 *   $env:BASE_URL="https://your-app.azurewebsites.net"
 *   $env:PIN="123456"
 *   $env:PLAYERS="200"
 *   $env:BATCH="20"
 *   $env:PAUSE_MS="100"
 *   npm run load-test
 *
 * For ~2000 players: use a strong VM (or several machines), tune BATCH/PAUSE_MS,
 * and coordinate with your team before hitting production. One process may hit OS
 * socket limits before the server does.
 */
/* eslint-disable no-console */
const { io } = require("socket.io-client");

const BASE_URL = process.env.BASE_URL || "";
const PIN = String(process.env.PIN || "").replace(/\D/g, "").slice(0, 8);
const PLAYERS = Math.min(5000, Math.max(1, parseInt(process.env.PLAYERS || "50", 10) || 50));
const BATCH = Math.max(1, parseInt(process.env.BATCH || "25", 10) || 25);
const PAUSE_MS = Math.max(0, parseInt(process.env.PAUSE_MS || "50", 10) || 0);
const JOIN_TIMEOUT_MS = Math.max(5000, parseInt(process.env.JOIN_TIMEOUT_MS || "30000", 10) || 30000);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function joinOnce(index) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = io(BASE_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io/",
      reconnection: false,
      timeout: JOIN_TIMEOUT_MS,
    });
    const done = (ok, err) => {
      const ms = Date.now() - t0;
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* ignore */
      }
      resolve({ ok, ms, err: err || null });
    };

    const timer = setTimeout(() => done(false, new Error("join_timeout")), JOIN_TIMEOUT_MS);

    socket.on("connect_error", (e) => {
      clearTimeout(timer);
      done(false, e);
    });

    socket.on("connect", () => {
      socket.emit(
        "player:join",
        { pin: PIN, name: `load_${index}_${Date.now()}`, playerId: "" },
        (res) => {
          clearTimeout(timer);
          if (res && res.ok) done(true, null);
          else done(false, new Error((res && res.error) || "join_failed"));
        }
      );
    });
  });
}

async function main() {
  if (!BASE_URL) {
    console.error("Set BASE_URL to the quiz site origin, e.g. https://myapp.azurewebsites.net");
    process.exit(1);
  }
  if (PIN.length < 4) {
    console.error("Set PIN to a 4–8 digit game PIN (env PIN).");
    process.exit(1);
  }

  const host = new URL(BASE_URL).hostname;
  if (!/localhost|127\.0\.0\.1/.test(host) && PLAYERS > 100) {
    console.warn(
      `WARNING: PLAYERS=${PLAYERS} against ${host}. Confirm this is acceptable on production/staging.`
    );
  }

  console.log(
    JSON.stringify(
      { BASE_URL, PIN, PLAYERS, BATCH, PAUSE_MS, JOIN_TIMEOUT_MS },
      null,
      2
    )
  );

  const latencies = [];
  let ok = 0;
  let fail = 0;

  const tStart = Date.now();
  for (let i = 0; i < PLAYERS; i += BATCH) {
    const slice = [];
    for (let j = 0; j < BATCH && i + j < PLAYERS; j++) slice.push(joinOnce(i + j));
    const results = await Promise.all(slice);
    for (const r of results) {
      if (r.ok) {
        ok++;
        latencies.push(r.ms);
      } else {
        fail++;
        if (fail <= 10) console.error("join error:", r.err && r.err.message ? r.err.message : r.err);
      }
    }
    if (i + BATCH < PLAYERS && PAUSE_MS) await sleep(PAUSE_MS);
  }
  const totalSec = (Date.now() - tStart) / 1000;

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  console.log(
    JSON.stringify(
      {
        completedInSec: Math.round(totalSec * 100) / 100,
        joinAckOk: ok,
        joinAckFail: fail,
        joinLatencyMs: { min: latencies[0] ?? null, p50, p95, p99, max: latencies[latencies.length - 1] ?? null },
      },
      null,
      2
    )
  );

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
