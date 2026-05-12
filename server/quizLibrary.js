const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", ".data");
const LIBRARY_FILE = path.join(DATA_DIR, "saved-quizzes.json");

function readDb() {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return { items: [] };
    const j = JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf8"));
    return { items: Array.isArray(j.items) ? j.items : [] };
  } catch {
    return { items: [] };
  }
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(db, null, 2), "utf8");
}

function listSummaries() {
  return readDb()
    .items.map((x) => ({
      id: x.id,
      name: x.name,
      title: x.quiz?.title ?? "",
      questionCount: Array.isArray(x.quiz?.questions) ? x.quiz.questions.length : 0,
      updatedAt: x.updatedAt ?? 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getById(id) {
  return readDb().items.find((x) => x.id === id) ?? null;
}

function createEntry(name, quiz) {
  const db = readDb();
  const now = Date.now();
  const entry = {
    id: crypto.randomUUID(),
    name: String(name || quiz.title || "Untitled")
      .trim()
      .slice(0, 120) || "Untitled",
    quiz,
    createdAt: now,
    updatedAt: now,
  };
  db.items.push(entry);
  writeDb(db);
  return entry;
}

/**
 * @param {string} id
 * @param {{ name?: string, quiz?: object }} patch
 */
function updateEntry(id, patch) {
  const db = readDb();
  const i = db.items.findIndex((x) => x.id === id);
  if (i === -1) return null;
  if (patch.name !== undefined && patch.name !== null) {
    const n = String(patch.name).trim().slice(0, 120);
    if (n) db.items[i].name = n;
  }
  if (patch.quiz) db.items[i].quiz = patch.quiz;
  db.items[i].updatedAt = Date.now();
  writeDb(db);
  return db.items[i];
}

/** @returns {boolean} true if an entry was removed */
function deleteById(id) {
  const db = readDb();
  const before = db.items.length;
  db.items = db.items.filter((x) => x.id !== id);
  if (db.items.length === before) return false;
  writeDb(db);
  return true;
}

module.exports = {
  listSummaries,
  getById,
  createEntry,
  updateEntry,
  deleteById,
};
