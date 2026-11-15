// src/utils/logger.js — CRIT-03
// Full audit 1.59: JSON.stringify throws on circular structures (e.g. an
// axios/HTTP error object) and on BigInt. A logger must never throw — it is
// usually called from inside a catch block, where a throw would replace the
// real error with a TypeError.
const safeValue = (v) => {
  if (typeof v !== 'object') return v;
  try { return JSON.stringify(v); } catch { return '[unserializable]'; }
};

const fmt = (data) =>
  Object.entries(data)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${safeValue(v)}`)
    .join(' ');

export const createLogger = (namespace) => ({
  log:      (event, data = {}) =>
    console.log(`[${namespace}] ${event}${fmt(data) ? ` → ${fmt(data)}` : ''}`),
  logError: (fn, err, data = {}) =>
    console.error(`[${namespace}] ❌ ${fn} — ${err?.message || err}${fmt(data) ? ` | ${fmt(data)}` : ''}`),
  logDB:    (op, table, data = {}) =>
    console.log(`[${namespace}] 🗄️  DB ${op} → table=${table}${fmt(data) ? ` ${fmt(data)}` : ''}`),
  logAI:    (fn, data = {}) =>
    console.log(`[${namespace}] 🤖 AI [${fn}]${fmt(data) ? ` → ${fmt(data)}` : ''}`),
  logJob:   (name, data = {}) =>
    console.log(`[${namespace}] 🔄 Job [${name}]${fmt(data) ? ` → ${fmt(data)}` : ''}`),
});
