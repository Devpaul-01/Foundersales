// src/utils/logger.js — CRIT-03
const fmt = (data) =>
  Object.entries(data)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
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
