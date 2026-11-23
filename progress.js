'use strict';
/* =====================================================================
   Workout Log · Progress
   Reads the history (and Body Data), works out each exercise's status and
   shows Go heavier / New best / Stalled on the Log workout cards.
   Loaded for everyone. The PT-only dashboards live in insights.js.
   Uses globals from index.html: state, esc, norm, q, pad.
   ===================================================================== */

const INS = { data: null, range: '12w', exercise: null, exScope: 'plan', charts: [] };
const NON_STRENGTH = new Set(['mobility', 'cardio', 'agility', 'conditioning']);
/* ----------------------------- helpers ----------------------------- */
const DAY_MS = 864e5;
const toNum = v => { if (typeof v === 'number') return v; const t = String(v ?? '').trim().replace(',', '.'); return t === '' ? NaN : Number(t); };
function toDay(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000) {      // Sheets serial date
    const d = new Date(Math.round((v - 25569) * DAY_MS));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return new Date(+m[1], m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return new Date(+m[3], m[1] - 1, +m[2]);  // sheet uses M/D/YYYY
  if (/^\d{5}(\.\d+)?$/.test(s)) return toDay(Number(s));
  return null;
}
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const daysAgo = d => Math.round((today() - d) / DAY_MS);
const weekStart = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };  // Monday
const fmtDate = (d, year = false) => d.toLocaleDateString('en-GB', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const fmtNum = (v, dp = 1) => Number.isFinite(v) ? (Math.round(v * 10 ** dp) / 10 ** dp).toLocaleString('en-US') : '–';
const fmtKg = v => Number.isFinite(v) ? `${fmtNum(v)} kg` : '–';
const signed = (v, dp = 1, unit = '') => !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtNum(Math.abs(v), dp)}${unit}`;
const pct = (v, dp = 0) => Number.isFinite(v) ? `${signed(v * 100, dp)}%` : '–';
const title = s => String(s).replace(/\b\w/g, c => c.toUpperCase());
const ago = d => { const n = daysAgo(d); return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
const e1rm = (w, r) => (w > 0 && r > 0) ? w * (1 + Math.min(r, 30) / 30) : NaN;   // Epley estimate

/* ----------------------------- data ----------------------------- */
async function loadInsightsData(force = false) {
  if (INS.data && !force) return INS.data;
  const pre = state.model.rawData;                  // read when the sheet was opened
  if (pre && !force) { INS.data = buildInsights(pre.hist, pre.body); return INS.data; }
  const id = state.sheet.id, H = state.model.history;
  const meta = await state.ds.meta(id);
  const bodyTab = meta.sheets.find(s => norm(s.title) === 'body data');
  const ranges = [`${q(H.title)}!A1:Z`];
  if (bodyTab) ranges.push(`${q(bodyTab.title)}!A1:Z`);
  const get = state.ds.batchGetRaw ? state.ds.batchGetRaw.bind(state.ds) : state.ds.batchGet.bind(state.ds);
  const [hist, body] = await get(id, ranges);
  INS.data = buildInsights(hist || [], body || null);
  return INS.data;
}

function buildInsights(histRows, bodyRows) {
  const H = state.model.history, M = H.map;
  const sets = [];
  histRows.slice(H.headerRow + 1).forEach(r => {
    const name = String(r[M.exercise] ?? '').trim(); if (!name) return;
    const date = toDay(r[M.date]); if (!date) return;
    sets.push({ date, key: dayKey(date), day: String(r[M.day] ?? '').trim(), cat: norm(r[M.category]) || 'other',
      ex: norm(name), name, reps: toNum(r[M.actualReps]), w: toNum(r[M.actualWgt]), tr: toNum(r[M.targetReps]),
      plan: String(r[M.plan] ?? '').trim() });
  });
  sets.sort((a, b) => a.date - b.date);

  // Sessions = one day of one plan on one date
  const sMap = new Map();
  for (const s of sets) {
    const k = `${s.key}|${norm(s.day)}|${norm(s.plan)}`;
    if (!sMap.has(k)) sMap.set(k, { date: s.date, key: s.key, day: s.day, plan: s.plan, sets: [] });
    sMap.get(k).sets.push(s);
  }
  const sessions = [...sMap.values()].sort((a, b) => a.date - b.date);

  // Exercises with one entry per session date
  const exMap = new Map();
  for (const s of sets) {
    if (!exMap.has(s.ex)) exMap.set(s.ex, { ex: s.ex, name: s.name, cat: s.cat, byDate: new Map() });
    const e = exMap.get(s.ex); e.name = s.name; e.cat = s.cat;
    if (!e.byDate.has(s.key)) e.byDate.set(s.key, { date: s.date, sets: [] });
    e.byDate.get(s.key).sets.push(s);
  }
  const exercises = [...exMap.values()].map(e => {
    const hist = [...e.byDate.values()].sort((a, b) => a.date - b.date).map(h => {
      const ws = h.sets.filter(s => s.w > 0);
      const top = ws.length ? ws.reduce((a, b) => (b.w > a.w || (b.w === a.w && b.reps > a.reps)) ? b : a) : null;
      const est = Math.max(...h.sets.map(s => e1rm(s.w, s.reps)).filter(Number.isFinite), -Infinity);
      const withTarget = h.sets.filter(s => Number.isFinite(s.tr) && s.tr > 0);
      return { date: h.date, sets: h.sets.length, top, e1rm: Number.isFinite(est) ? est : NaN,
        volume: ws.reduce((t, s) => t + s.w * (Number.isFinite(s.reps) ? s.reps : 0), 0),
        bestReps: Math.max(...h.sets.map(s => Number.isFinite(s.reps) ? s.reps : 0)),
        hitAll: withTarget.length > 0 && withTarget.every(s => s.reps >= s.tr) };
    });
    const weighted = hist.some(h => h.top);
    const metric = h => weighted ? h.e1rm : h.bestReps;
    // personal bests: sessions that beat every earlier session
    let best = -Infinity; hist.forEach((h, i) => { const m = metric(h); h.pb = i > 0 && Number.isFinite(m) && m > best; if (Number.isFinite(m)) best = Math.max(best, m); });
    const n = hist.length, last = hist[n - 1];
    const ms = hist.map(metric).filter(Number.isFinite);
    let status = 'new';
    if (NON_STRENGTH.has(e.cat)) status = 'na';                              // mobility/cardio: no progression status
    else if (n >= 2) {
      const before = Math.max(...hist.slice(0, -1).map(metric).filter(Number.isFinite), -Infinity);
      if (weighted && last.hitAll) status = 'ready';
      else if (!weighted && last.hitAll && metric(last) >= before) status = 'steady';   // bodyweight move done at target
      else if (metric(last) > before) status = 'pb';
      else if (n >= 4 && Math.max(...hist.slice(-3).map(metric)) <= Math.max(...hist.slice(0, -3).map(metric))) status = 'stalled';
      else status = 'steady';
    }
    return { ...e, hist, weighted, metric, status, first: hist[0], last,
      change: ms.length >= 2 && ms[0] > 0 ? (ms[ms.length - 1] - ms[0]) / ms[0] : NaN,
      bestTop: weighted ? Math.max(...hist.map(h => h.top ? h.top.w : 0)) : Math.max(...hist.map(h => h.bestReps)) };
  });

  return { sets, sessions, exercises, exByKey: new Map(exercises.map(e => [e.ex, e])), body: parseBody(bodyRows), loadedAt: new Date() };
}

function parseBody(rows) {
  if (!rows || !rows.length) return null;
  const cols = { date: /^date$/, chest: /^chest/, waist: /^waist/, lleg: /^left leg/, rleg: /^right leg/, larm: /^left arm/, rarm: /^right arm/,
    neck: /^neck/, weight: /^weight/, hips: /^hips?\b/, bmi: /^bmi/, bf: /body ?fat/, whtr: /^whtr/, fat: /^fat mass/, lean: /lean/, whr: /^whr$/ };
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] || []; const map = {};
    for (const [k, re] of Object.entries(cols)) { const i = row.findIndex(c => re.test(norm(c))); if (i >= 0) map[k] = i; }
    if (!('date' in map && 'weight' in map)) continue;
    const entries = rows.slice(r + 1).map(x => {
      const date = toDay(x[map.date]); const weight = toNum(x[map.weight]);
      if (!date || !Number.isFinite(weight)) return null;
      const e = { date };
      for (const k of Object.keys(map)) if (k !== 'date') e[k] = toNum(x[map[k]]);
      if (Number.isFinite(e.bf) && e.bf < 1) e.bf *= 100;                   // stored as a fraction
      e.arm = avg(e.larm, e.rarm); e.leg = avg(e.lleg, e.rleg);
      return e;
    }).filter(Boolean).sort((a, b) => a.date - b.date);
    return entries.length ? { entries, has: k => entries.some(e => Number.isFinite(e[k])) } : null;
  }
  return null;
}
const avg = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : b;

function planExerciseKeys() { return new Set(state.model.plan.map(p => norm(p.exercise))); }
const countBy = (arr, fn) => { const m = new Map(); arr.forEach(x => m.set(fn(x), (m.get(fn(x)) || 0) + 1)); return [...m.entries()]; };
/* ------------------- status hints on the Log workout cards ------------------- */
const LOG_HINT = {
  ready: (e) => ['▲', 'good', 'Go heavier', `you hit every target rep last time${e.last.top ? ` (${fmtNum(e.last.top.w)} kg × ${fmtNum(e.last.top.reps, 0)})` : ''}`],
  pb: () => ['★', 'good', 'New best', 'last session beat every earlier one'],
  stalled: () => ['■', 'warning', 'Stalled', 'no improvement in the last 3 sessions'],
};
function logHint(name) {
  const e = INS.data && INS.data.exByKey.get(norm(name));
  if (!e || !LOG_HINT[e.status]) return '';
  const [ic, cls, label, why] = LOG_HINT[e.status](e);
  return `<div class="log-hint"><span class="badge"><span class="b-ic ${cls}" aria-hidden="true">${ic}</span>${label}</span><span class="muted">${esc(why)}</span></div>`;
}
function fillLogHints() {
  document.querySelectorAll('.hint-slot').forEach(el => { el.innerHTML = logHint(el.dataset.ex); });
}
// Load the history in the background while logging, then show the hints on the cards.
let hintsLoading = null;
function prefetchInsights() {
  if (INS.data) return fillLogHints();
  if (!hintsLoading) hintsLoading = loadInsightsData().catch(() => null).finally(() => { hintsLoading = null; });
  hintsLoading.then(() => { if (INS.data) fillLogHints(); });
}
