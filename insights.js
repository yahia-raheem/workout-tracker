'use strict';
/* =====================================================================
   Workout Log · Insights
   Dashboards built from the "Historical Data" and "Body Data" tabs.
   Uses globals from index.html: state, $, esc, norm, q, pad, store, toast,
   setChrome, renderSignin, AuthError, tabsHTML.
   ===================================================================== */

const INS = { data: null, range: '12w', exercise: null, exScope: 'plan', charts: [] };

// Categorical slots (dark steps), validated against the card surface #181b22.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c'];
const OTHER_COLOR = '#5d6370';
const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a' };
const GRID = '#2a2f3a', AXIS = '#3a404c', MUTED = '#8b919d';
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

/* ----------------------------- metrics ----------------------------- */
function rangeBounds() {
  const end = today(); const D = INS.data;
  const days = INS.range === '4w' ? 28 : INS.range === '12w' ? 84 : null;
  const first = D.sessions.length ? D.sessions[0].date : end;
  const start = days ? new Date(end - (days - 1) * DAY_MS) : first;
  const prevStart = days ? new Date(start - days * DAY_MS) : null;
  return { start, end, days: days || Math.max(1, Math.round((end - start) / DAY_MS) + 1), prevStart };
}
const inRange = (d, a, b) => d >= a && d <= b;

function planProgress() {
  const D = INS.data, m = state.model, pn = norm(m.planName);
  let ss = D.sessions.filter(s => pn && norm(s.plan) === pn);
  if (!ss.length) ss = D.sessions.filter(s => m.days.some(d => norm(d) === norm(s.day)));
  const days = m.days.map(day => {
    const mine = ss.filter(s => norm(s.day) === norm(day));
    const planned = m.plan.filter(p => p.day === day);
    const plannedSets = planned.reduce((t, p) => t + (parseInt(p.sets) || 1), 0);
    const names = new Set(planned.map(p => norm(p.exercise)));
    const completion = mine.length ? mine.reduce((t, s) => t + Math.min(1, s.sets.filter(x => names.has(x.ex)).length / Math.max(1, plannedSets)), 0) / mine.length : NaN;
    return { day, count: mine.length, last: mine.length ? mine[mine.length - 1].date : null, completion };
  });
  const lastS = ss[ss.length - 1];
  const idx = lastS ? m.days.findIndex(d => norm(d) === norm(lastS.day)) : -1;
  const next = m.days.length ? m.days[(idx + 1) % m.days.length] : null;
  const start = ss.length ? ss[0].date : null;
  const weeks = start ? Math.max(1, (today() - start) / (7 * DAY_MS)) : NaN;
  return { sessions: ss, days, next, start, weeks, perWeek: ss.length / weeks, rounds: Math.min(...days.map(d => d.count)) };
}

function planExerciseKeys() { return new Set(state.model.plan.map(p => norm(p.exercise))); }

/* ----------------------------- highlights ----------------------------- */
function highlights(pp) {
  const D = INS.data, out = [];
  const t = today();
  const last28 = D.sessions.filter(s => daysAgo(s.date) < 28).length;
  const prev28 = D.sessions.filter(s => daysAgo(s.date) >= 28 && daysAgo(s.date) < 56).length;
  if (D.sessions.length && daysAgo(D.sessions[0].date) >= 56) {
    const dir = last28 > prev28 ? ['▲', 'up from'] : last28 < prev28 ? ['▼', 'down from'] : ['●', 'same as'];
    out.push({ icon: dir[0], text: `<b>${last28} workouts</b> in the last 4 weeks (${fmtNum(last28 / 4)} a week), ${dir[1]} ${prev28} the 4 weeks before.` });
  } else if (D.sessions.length) out.push({ icon: '●', text: `<b>${last28} workouts</b> in the last 4 weeks (${fmtNum(last28 / 4)} a week).` });
  if (D.sessions.length) {
    const lastS = D.sessions[D.sessions.length - 1];
    out.push({ icon: '⏱', text: `Last workout: <b>${esc(lastS.day)}</b> ${ago(lastS.date)}.${pp.next ? ` Next in your rotation: <b>${esc(pp.next)}</b>.` : ''}` });
  }
  const overdue = pp.days.filter(d => d.last && daysAgo(d.last) >= 10).map(d => `${esc(d.day)} (${daysAgo(d.last)} days)`);
  const never = pp.days.filter(d => !d.count).map(d => esc(d.day));
  if (overdue.length) out.push({ icon: '!', warn: true, text: `Not trained in a while: ${overdue.join(', ')}.` });
  if (never.length) out.push({ icon: '!', warn: true, text: `Never logged on this plan: ${never.join(', ')}.` });

  const keys = planExerciseKeys();
  const planEx = D.exercises.filter(e => keys.has(e.ex));
  const ready = planEx.filter(e => e.status === 'ready').map(e => esc(title(e.name)));
  if (ready.length) out.push({ icon: '▲', good: true, text: `Hit every target rep last time, ready to go heavier: <b>${ready.slice(0, 5).join(', ')}</b>.` });
  const improved = planEx.filter(e => e.weighted && e.hist.length >= 3 && Number.isFinite(e.change)).sort((a, b) => b.change - a.change)[0];
  if (improved && improved.change > 0) out.push({ icon: '★', good: true, text: `Most improved: <b>${esc(title(improved.name))}</b>, estimated 1-rep max ${pct(improved.change)} since ${fmtDate(improved.first.date)}.` });
  const stalled = planEx.filter(e => e.status === 'stalled').map(e => esc(title(e.name)));
  if (stalled.length) out.push({ icon: '■', warn: true, text: `No progress in the last 3 sessions: ${stalled.slice(0, 5).join(', ')}.` });

  const recent = D.sets.filter(s => daysAgo(s.date) < 28 && !NON_STRENGTH.has(s.cat));
  if (recent.length >= 10) {
    const by = countBy(recent, s => s.cat).sort((a, b) => b[1] - a[1]);
    const top = by[0], low = by[by.length - 1];
    if (by.length >= 2) out.push({ icon: '◐', text: `Last 4 weeks: <b>${title(top[0])}</b> got ${Math.round(top[1] / recent.length * 100)}% of your strength sets, <b>${title(low[0])}</b> ${Math.round(low[1] / recent.length * 100)}%.` });
  }
  const B = D.body;
  if (B && B.entries.length >= 2) {
    const f = B.entries[0], l = B.entries[B.entries.length - 1];
    const bits = [`weight ${signed(l.weight - f.weight, 1, ' kg')}`];
    if (Number.isFinite(l.bf) && Number.isFinite(f.bf)) bits.push(`body fat ${fmtNum(f.bf)}% → ${fmtNum(l.bf)}%`);
    if (Number.isFinite(l.lean) && Number.isFinite(f.lean)) bits.push(`lean mass ${signed(l.lean - f.lean, 1, ' kg')}`);
    if (Number.isFinite(l.waist) && Number.isFinite(f.waist)) bits.push(`waist ${signed(l.waist - f.waist, 1, ' cm')}`);
    out.push({ icon: '◆', text: `Since ${fmtDate(f.date)}: ${bits.join(', ')}.` });
    if (daysAgo(l.date) > 21) out.push({ icon: '⏱', text: `Body measurements were last taken ${daysAgo(l.date)} days ago.` });
  }
  return out;
}
const countBy = (arr, fn) => { const m = new Map(); arr.forEach(x => m.set(fn(x), (m.get(fn(x)) || 0) + 1)); return [...m.entries()]; };

/* ----------------------------- rendering ----------------------------- */
function renderInsights() {
  setChrome({ menu: true });
  INS.charts = [];
  $('#app').innerHTML = `${tabsHTML('insights')}<div class="panel center"><div class="spinner"></div><div class="muted">Crunching your history…</div></div>`;
  loadInsightsData().then(drawInsights).catch(e => {
    if (e instanceof AuthError) { state.authLost = true; return renderSignin(e.message); }
    $('#app').innerHTML = `${tabsHTML('insights')}<div class="panel"><h2>Couldn't load insights</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-act="ins-refresh">Try again</button></div>`;
  });
}

function drawInsights() {
  const D = INS.data;
  INS.charts = [];
  if (!D.sessions.length) {
    $('#app').innerHTML = `${tabsHTML('insights')}<div class="panel"><h2>No workouts yet</h2><p class="muted">Log a few sessions and your insights will show up here.</p></div>`;
    return;
  }
  const pp = planProgress();
  const R = rangeBounds();
  const rs = D.sessions.filter(s => inRange(s.date, R.start, R.end));
  const rsets = D.sets.filter(s => inRange(s.date, R.start, R.end));
  const prev = R.prevStart ? D.sessions.filter(s => inRange(s.date, R.prevStart, new Date(R.start - DAY_MS))) : null;
  const prevSets = R.prevStart ? D.sets.filter(s => inRange(s.date, R.prevStart, new Date(R.start - DAY_MS))) : null;
  const vol = arr => arr.reduce((t, s) => t + (s.w > 0 && s.reps > 0 ? s.w * s.reps : 0), 0);
  const pbs = D.exercises.reduce((t, e) => t + e.hist.filter(h => h.pb && inRange(h.date, R.start, R.end)).length, 0);
  const lastS = D.sessions[D.sessions.length - 1];
  const comparable = R.prevStart && D.sessions[0].date <= R.prevStart;   // previous period fully covered by history
  const delta = (cur, before) => before === 0 ? '–' : pct((cur - before) / before);

  const rangeLabel = { '4w': 'last 4 weeks', '12w': 'last 12 weeks', all: 'all time' }[INS.range];
  $('#app').innerHTML = `${tabsHTML('insights')}
    <div class="ins-head">
      <div class="seg" role="tablist" aria-label="Time range">
        ${[['4w', '4 weeks'], ['12w', '12 weeks'], ['all', 'All time']].map(([k, l]) => `<button class="${INS.range === k ? 'on' : ''}" data-act="ins-range" data-range="${k}">${l}</button>`).join('')}
      </div>
      <button class="text-btn" data-act="ins-refresh" title="Reload from the sheet">↻ Refresh</button>
    </div>

    <section class="panel ins">
      <h2>Highlights</h2>
      <ul class="hl">${highlights(pp).map(h => `<li><span class="hl-ic ${h.good ? 'good' : h.warn ? 'warn' : ''}" aria-hidden="true">${h.icon}</span><span>${h.text}</span></li>`).join('')}</ul>
    </section>

    <div class="tiles">
      ${tile('Workouts', rs.length, comparable ? `${delta(rs.length, prev.length)} vs previous` : rangeLabel)}
      ${tile('Per week', fmtNum(rs.length / (R.days / 7)), rangeLabel)}
      ${tile('Sets logged', rsets.length.toLocaleString('en-US'), comparable ? `${delta(rsets.length, prevSets.length)} vs previous` : rangeLabel)}
      ${tile('Volume', `${fmtNum(vol(rsets) / 1000)} t`, comparable ? `${delta(vol(rsets), vol(prevSets))} vs previous` : 'kg × reps lifted')}
      ${tile('New bests', pbs, rangeLabel)}
      ${tile('Last workout', daysAgo(lastS.date) === 0 ? 'Today' : `${daysAgo(lastS.date)}d ago`, esc(lastS.day))}
    </div>

    <section class="panel ins">
      <h2>Workouts per week</h2>
      <p class="sub">Each bar is one week (Monday to Sunday), ${rangeLabel}.</p>
      <div class="chart" id="chWeeks"></div>
    </section>

    ${planSection(pp)}
    ${exerciseTable()}
    <section class="panel ins" id="exDetail"></section>
    ${muscleSection(rsets, R, rangeLabel)}
    ${bodySection()}
    <p class="small muted center">Updated ${D.loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} from “${esc(state.sheet.name)}”. Estimated 1-rep max uses the Epley formula: weight × (1 + reps ÷ 30).</p>`;

  // weekly workouts chart
  const weeks = []; for (let w = weekStart(R.start); w <= R.end; w = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7)) weeks.push(w);
  const perWeek = weeks.map(w => D.sessions.filter(s => weekStart(s.date).getTime() === w.getTime()));
  addChart('chWeeks', el => barChart(el, { labels: weeks.map(w => fmtDate(w)), values: perWeek.map(a => a.length), height: 170, integer: true,
    tip: i => `<b>Week of ${fmtDate(weeks[i])}</b><br>${perWeek[i].length} workout${perWeek[i].length === 1 ? '' : 's'}${perWeek[i].length ? `<br><span class="muted">${perWeek[i].map(s => esc(s.day)).join(', ')}</span>` : ''}`,
    table: { head: ['Week of', 'Workouts', 'Days'], rows: weeks.map((w, i) => [fmtDate(w, true), perWeek[i].length, perWeek[i].map(s => s.day).join(', ')]) } }));

  drawMuscles(rsets, R);
  drawExerciseDetail();
  drawBody();
  drawAll();
}

const tile = (label, value, sub) => `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div><div class="t-sub">${sub}</div></div>`;

function planSection(pp) {
  const max = Math.max(1, ...pp.days.map(d => d.count));
  return `<section class="panel ins">
    <h2>Current plan</h2>
    <p class="sub">${esc(state.model.planName.trim() || 'Unnamed plan')}${pp.start ? ` · since ${fmtDate(pp.start, true)} · ${pp.sessions.length} workouts, ${fmtNum(pp.perWeek)} a week` : ''}</p>
    ${pp.next ? `<div class="nextup"><span class="muted">Next up</span> <b>${esc(pp.next)}</b>${Number.isFinite(pp.rounds) && pp.rounds > 0 ? `<span class="muted"> · full rotations done: ${pp.rounds}</span>` : ''}</div>` : ''}
    <table class="tbl-plan">
      <thead><tr><th>Day</th><th>Times done</th><th>Last</th><th title="Share of planned sets logged, on average">Sets done</th></tr></thead>
      <tbody>${pp.days.map(d => `<tr>
        <td><b>${esc(d.day)}</b></td>
        <td><div class="inbar"><span style="width:${d.count / max * 100}%"></span></div><span class="num">${d.count}</span></td>
        <td class="muted">${d.last ? ago(d.last) : 'never'}</td>
        <td class="num">${Number.isFinite(d.completion) ? Math.round(d.completion * 100) + '%' : '–'}</td></tr>`).join('')}</tbody>
    </table>
  </section>`;
}

const STATUS_UI = {
  ready: ['▲', 'good', 'Go heavier'], pb: ['★', 'good', 'New best'], stalled: ['■', 'warning', 'Stalled'],
  steady: ['●', '', 'Steady'], new: ['○', '', 'New'], na: ['–', '', 'Mobility/cardio'],
};
function statusBadge(st) { const [ic, cls, label] = STATUS_UI[st]; return `<span class="badge"><span class="b-ic ${cls}" aria-hidden="true">${ic}</span>${label}</span>`; }

function exerciseList() {
  const D = INS.data;
  if (INS.exScope === 'plan') {
    const order = [...new Map(state.model.plan.map(p => [norm(p.exercise), p])).keys()];
    return order.map(k => D.exByKey.get(k)).filter(Boolean);
  }
  return [...D.exercises].sort((a, b) => b.last.date - a.last.date);
}
function exerciseTable() {
  const list = exerciseList();
  if (!INS.exercise || !INS.data.exByKey.has(INS.exercise))   // default to the first strength lift, not a warm-up move
    INS.exercise = (list.find(e => e.weighted && !NON_STRENGTH.has(e.cat)) || list.find(e => !NON_STRENGTH.has(e.cat)) || list[0] || INS.data.exercises[0])?.ex;
  return `<section class="panel ins">
    <div class="h-row"><h2>Exercise progress</h2>
      <div class="seg small">${[['plan', 'Current plan'], ['all', 'All']].map(([k, l]) => `<button class="${INS.exScope === k ? 'on' : ''}" data-act="ins-scope" data-scope="${k}">${l}</button>`).join('')}</div></div>
    <p class="sub">Trend = estimated 1-rep max per session (best set reps for bodyweight or timed moves). Pick an exercise under “Exercise trends” to see its charts.</p>
    <div class="ex-list">${list.map(e => `<div class="ex-row">
        <span class="ex-name">${esc(title(e.name))}<small>${e.hist.length} session${e.hist.length === 1 ? '' : 's'} · ${e.weighted ? `best ${fmtKg(e.bestTop)}` : `best ${fmtNum(e.bestTop, 0)} reps`}</small></span>
        <span class="spark">${sparkline(e.hist.map(e.metric))}</span>
        <span class="ex-chg num">${Number.isFinite(e.change) ? pct(e.change) : '–'}</span>
        <span class="ex-st">${statusBadge(e.status)}</span>
      </div>`).join('') || '<p class="muted">No logged exercises from this plan yet.</p>'}</div>
    <p class="small muted legend-line">${['ready', 'pb', 'stalled', 'steady', 'new'].map(statusBadge).join(' ')}<br>Go heavier = hit every target rep last session · New best = beat every earlier session · Stalled = no improvement in the last 3 sessions.</p>
  </section>`;
}

// Exercises of one category: current-plan ones first, then most recently trained.
function exercisesInCategory(cat) {
  const inPlan = planExerciseKeys();
  return INS.data.exercises.filter(x => x.cat === cat)
    .sort((a, b) => (inPlan.has(b.ex) - inPlan.has(a.ex)) || (b.last.date - a.last.date));
}
function redrawDetail() {
  INS.charts = INS.charts.filter(c => !c.id.startsWith('chEx'));
  drawExerciseDetail();
  INS.charts.filter(c => c.id.startsWith('chEx')).forEach(c => { const el = document.getElementById(c.id); if (el) c.draw(el); });
}
function drawExerciseDetail() {
  const el = document.getElementById('exDetail'); if (!el) return;
  const e = INS.data.exByKey.get(INS.exercise);
  if (!e) { el.hidden = true; return; }
  const h = e.hist;
  const lastTop = e.last.top;
  const D = INS.data, inPlan = planExerciseKeys();
  const cats = countBy(D.exercises, x => x.cat).sort((a, b) => a[0].localeCompare(b[0])).map(x => x[0]);
  const inCat = exercisesInCategory(e.cat);
  el.innerHTML = `<h2>Exercise trends</h2>
    <div class="pickers">
      <label>Category<select id="exCat">${cats.map(c => `<option value="${esc(c)}" ${c === e.cat ? 'selected' : ''}>${esc(title(c))}</option>`).join('')}</select></label>
      <label>Exercise<select id="exPick">${inCat.map(x => `<option value="${esc(x.ex)}" ${x.ex === e.ex ? 'selected' : ''}>${esc(title(x.name))}${inPlan.has(x.ex) ? '' : ' (not in plan)'}</option>`).join('')}</select></label>
    </div>
    <div class="h-row"><h3 class="ex-title">${esc(title(e.name))}</h3>${statusBadge(e.status)}</div>
    <p class="sub">${esc(title(e.cat))} · ${h.length} session${h.length === 1 ? '' : 's'} since ${fmtDate(e.first.date, true)}</p>
    <div class="tiles three">
      ${e.weighted ? tile('Last top set', lastTop ? `${fmtNum(lastTop.w)} × ${fmtNum(lastTop.reps, 0)}` : '–', fmtDate(e.last.date))
                   : tile('Last best set', `${fmtNum(e.last.bestReps, 0)} reps`, fmtDate(e.last.date))}
      ${e.weighted ? tile('Est. 1-rep max', fmtKg(e.last.e1rm), `${pct(e.change)} since start`) : tile('Change', pct(e.change), 'since start')}
      ${tile('Best ever', e.weighted ? fmtKg(e.bestTop) : `${fmtNum(e.bestTop, 0)} reps`, e.weighted ? 'heaviest set' : 'most reps in a set')}
    </div>
    <h3 class="ch-title">${e.weighted ? 'Top set and estimated 1-rep max (kg)' : 'Best set (reps)'}</h3>
    <div class="chart" id="chEx"></div>
    ${e.weighted ? `<h3 class="ch-title">Volume per session (kg × reps)</h3><div class="chart" id="chExVol"></div>` : ''}`;
  const dates = h.map(x => x.date);
  addChart('chEx', c => lineChart(c, { dates, height: 200,
    series: e.weighted
      ? [{ name: 'Top set', color: SERIES[0], values: h.map(x => x.top ? x.top.w : NaN) }, { name: 'Est. 1RM', color: SERIES[1], values: h.map(x => x.e1rm) }]
      : [{ name: 'Best set', color: SERIES[0], values: h.map(x => x.bestReps) }],
    fmt: v => e.weighted ? fmtKg(v) : `${fmtNum(v, 0)} reps`,
    extraTip: i => h[i].top ? `<span class="muted">Top set ${fmtNum(h[i].top.w)} kg × ${fmtNum(h[i].top.reps, 0)} · ${h[i].sets} sets${h[i].pb ? ' · ★ new best' : ''}</span>` : `<span class="muted">${h[i].sets} sets${h[i].pb ? ' · ★ new best' : ''}</span>`,
    table: { head: e.weighted ? ['Date', 'Top set', 'Est. 1RM', 'Sets', 'Volume'] : ['Date', 'Best set', 'Sets'],
      rows: h.map(x => e.weighted ? [fmtDate(x.date, true), x.top ? `${fmtNum(x.top.w)} kg × ${fmtNum(x.top.reps, 0)}` : '–', fmtKg(x.e1rm), x.sets, fmtNum(x.volume, 0)] : [fmtDate(x.date, true), `${fmtNum(x.bestReps, 0)} reps`, x.sets]) } }));
  if (e.weighted) addChart('chExVol', c => barChart(c, { labels: dates.map(d => fmtDate(d)), values: h.map(x => x.volume), height: 150,
    tip: i => `<b>${fmtDate(dates[i], true)}</b><br>${fmtNum(h[i].volume, 0)} kg × reps over ${h[i].sets} sets` }));
}

function muscleSection(rsets, R, rangeLabel) {
  return `<section class="panel ins">
    <h2>Sets per muscle group</h2>
    <p class="sub">Logged sets per week by category, ${rangeLabel}. Mobility and cardio are included.</p>
    <div class="legend" id="lgMuscle"></div>
    <div class="chart" id="chMuscle"></div>
  </section>`;
}
function drawMuscles(rsets, R) {
  const by = countBy(rsets, s => s.cat).sort((a, b) => b[1] - a[1]);
  const topCats = by.slice(0, by.length > 6 ? 5 : 6).map(x => x[0]);
  const hasOther = by.length > topCats.length;
  // colour follows the category (fixed by overall frequency in the whole history), not the current rank
  const allCats = countBy(INS.data.sets, s => s.cat).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const colorOf = c => SERIES[allCats.indexOf(c) % SERIES.length];
  const weeks = []; for (let w = weekStart(R.start); w <= R.end; w = new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7)) weeks.push(w);
  const series = topCats.map(c => ({ name: title(c), color: colorOf(c), values: weeks.map(w => rsets.filter(s => s.cat === c && weekStart(s.date).getTime() === w.getTime()).length) }));
  if (hasOther) series.push({ name: 'Other', color: OTHER_COLOR, values: weeks.map(w => rsets.filter(s => !topCats.includes(s.cat) && weekStart(s.date).getTime() === w.getTime()).length) });
  const lg = document.getElementById('lgMuscle');
  if (lg) lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${s.values.reduce((a, b) => a + b, 0)}</b></span>`).join('');
  addChart('chMuscle', el => stackedBar(el, { labels: weeks.map(w => fmtDate(w)), series, height: 200,
    tip: i => `<b>Week of ${fmtDate(weeks[i])}</b><br>${series.filter(s => s.values[i]).map(s => `<span class="sw" style="background:${s.color}"></span>${esc(s.name)}: ${s.values[i]}`).join('<br>') || 'No sets'}`,
    table: { head: ['Week of', ...series.map(s => s.name)], rows: weeks.map((w, i) => [fmtDate(w, true), ...series.map(s => s.values[i])]) } }));
}

function bodySection() {
  const B = INS.data.body;
  if (!B) return `<section class="panel ins"><h2>Body</h2><p class="muted">No “Body Data” tab with a Date and Weight column was found, so there's nothing to show yet.</p></section>`;
  const E = B.entries, f = E[0], l = E[E.length - 1], p = E[E.length - 2];
  const t = (label, k, unit, dp = 1, lowerIsBetter = null) => {
    if (!Number.isFinite(l[k])) return '';
    const dFirst = Number.isFinite(f[k]) ? l[k] - f[k] : NaN, dPrev = p && Number.isFinite(p[k]) ? l[k] - p[k] : NaN;
    return tile(label, `${fmtNum(l[k], dp)}${unit}`, E.length > 1 ? `${signed(dPrev, dp)} vs last · ${signed(dFirst, dp)} total` : fmtDate(l.date));
  };
  return `<section class="panel ins">
    <h2>Body</h2>
    <p class="sub">${E.length} measurement${E.length === 1 ? '' : 's'}, ${fmtDate(f.date, true)} to ${fmtDate(l.date, true)} (last taken ${ago(l.date)}). Changes shown vs the previous measurement and vs the first.</p>
    <div class="tiles">
      ${t('Weight', 'weight', ' kg')}${t('Body fat', 'bf', '%')}${t('Lean mass', 'lean', ' kg')}${t('Fat mass', 'fat', ' kg')}${t('Waist', 'waist', ' cm')}${t('Waist ÷ height', 'whtr', '', 2)}
    </div>
    ${E.length > 1 ? `<h3 class="ch-title">Weight (kg)</h3><div class="chart" id="chBodyW"></div>
    ${B.has('bf') ? `<h3 class="ch-title">Body fat (%)</h3><div class="chart" id="chBodyF"></div>` : ''}
    <h3 class="ch-title">Measurements: change since the first one (cm)</h3><div class="legend" id="lgBodyM"></div><div class="chart" id="chBodyM"></div>` : '<p class="muted">Add a second measurement to see trends.</p>'}
  </section>`;
}
function drawBody() {
  const B = INS.data.body; if (!B || B.entries.length < 2) return;
  const E = B.entries, dates = E.map(e => e.date);
  const one = (k, unit, dp, extra) => ({ dates, height: 170, series: [{ name: k, color: SERIES[0], values: E.map(e => e[k]) }], fmt: v => `${fmtNum(v, dp)}${unit}`, extraTip: extra,
    table: { head: ['Date', k], rows: E.map(e => [fmtDate(e.date, true), `${fmtNum(e[k], dp)}${unit}`]) } });
  addChart('chBodyW', el => lineChart(el, one('weight', ' kg', 1, i => Number.isFinite(E[i].lean) ? `<span class="muted">Lean ${fmtNum(E[i].lean)} kg · fat ${fmtNum(E[i].fat)} kg</span>` : '')));
  if (B.has('bf')) addChart('chBodyF', el => lineChart(el, one('bf', '%', 1)));
  const ms = [['waist', 'Waist'], ['chest', 'Chest'], ['hips', 'Hips'], ['arm', 'Arms (avg)'], ['leg', 'Legs (avg)']].filter(([k]) => B.has(k));
  // indexed to the first measurement, so different-sized measurements share one axis
  const series = ms.map(([k, name], i) => { const f0 = E.find(e => Number.isFinite(e[k]))?.[k]; return { name, k, color: SERIES[i], values: E.map(e => Number.isFinite(e[k]) ? e[k] - f0 : NaN) }; });
  const lg = document.getElementById('lgBodyM');
  if (lg) lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b>${fmtNum(E[E.length - 1][s.k])} cm</b></span>`).join('');
  addChart('chBodyM', el => lineChart(el, { dates, height: 220, series, fmt: v => `${signed(v, 1, ' cm')}`,
    extraTip: i => `<span class="muted">${series.map(s => `${esc(s.name)} ${fmtNum(E[i][s.k])} cm`).join(' · ')}</span>`,
    table: { head: ['Date', ...series.map(s => `${s.name} (cm)`)], rows: E.map(e => [fmtDate(e.date, true), ...series.map(s => fmtNum(e[s.k]))]) } }));
}

/* ----------------------------- charts (SVG) ----------------------------- */
function addChart(id, draw) { INS.charts.push({ id, draw }); }
function drawAll() {
  for (const c of INS.charts) { const el = document.getElementById(c.id); if (el) { el.innerHTML = ''; c.draw(el); } }
}
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (document.querySelector('.ins')) drawAll(); }, 150); });

function niceScale(min, max, ticks = 4, zero = false) {
  if (zero) min = Math.min(0, min);
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const raw = (max - min) / ticks, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const vals = []; for (let v = lo; v <= hi + step / 2; v += step) vals.push(+v.toFixed(10));
  return { lo, hi, vals, step };
}
const tickFmt = (v, step = 1) => Math.abs(v) >= 1000 ? `${fmtNum(v / 1000, 1)}k` : fmtNum(v, step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
const svgEl = (w, h) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="false">`;

function frame(el, height, padL = 34) {
  const w = Math.max(260, Math.floor(el.clientWidth || el.parentElement.clientWidth || 320));
  return { w, h: height, l: padL, r: 10, t: 10, b: 24 };
}
function yAxis(F, sc, fmt = v => tickFmt(v, sc.step)) {
  const y = v => F.t + (F.h - F.t - F.b) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
  const lines = sc.vals.map(v => `<line x1="${F.l}" x2="${F.w - F.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? AXIS : GRID}" stroke-width="1"/>
    <text x="${F.l - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmt(v)}</text>`).join('');
  return { y, svg: lines };
}
function xLabels(F, labels, xOf, maxN) {
  const n = labels.length, every = Math.max(1, Math.ceil(n / maxN));
  return labels.map((lab, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2 || i === 0)
    ? `<text x="${xOf(i)}" y="${F.h - 6}" text-anchor="middle" class="ax">${esc(lab)}</text>` : '').join('');
}
function attachTable(el, table) {
  if (!table) return;
  el.insertAdjacentHTML('beforeend', `<details class="dt"><summary>Show data</summary><div class="dt-wrap"><table><thead><tr>${table.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`);
}
const roundTop = (x, y, w, h, r = 4) => {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

function barChart(el, { labels, values, height = 170, tip, table, integer }) {
  const F = frame(el, height);
  const sc = niceScale(0, Math.max(...values, integer ? 3 : 1), 3, true);
  if (integer) { sc.vals = sc.vals.filter(v => Number.isInteger(v)); }
  const ax = yAxis(F, sc);
  const n = values.length, band = (F.w - F.l - F.r) / n, bw = Math.max(3, Math.min(28, band - 2));
  const xOf = i => F.l + band * i + band / 2;
  const bars = values.map((v, i) => `<path d="${roundTop(xOf(i) - bw / 2, ax.y(v), bw, ax.y(0) - ax.y(v))}" fill="${SERIES[0]}"/>`).join('');
  const hits = values.map((v, i) => `<rect x="${F.l + band * i}" y="${F.t}" width="${band}" height="${F.h - F.t - F.b}" fill="transparent" data-i="${i}"/>`).join('');
  el.innerHTML = `${svgEl(F.w, F.h)}${ax.svg}${bars}${xLabels(F, labels, xOf, Math.floor((F.w - F.l) / 52))}<g class="hits">${hits}</g></svg>`;
  wireHover(el, i => tip ? tip(i) : `<b>${esc(labels[i])}</b><br>${fmtNum(values[i])}`, i => highlightBand(el, F, band, i));
  attachTable(el, table);
}

function stackedBar(el, { labels, series, height = 200, tip, table }) {
  const F = frame(el, height);
  const totals = labels.map((_, i) => series.reduce((t, s) => t + s.values[i], 0));
  const sc = niceScale(0, Math.max(...totals, 4), 3, true);
  const ax = yAxis(F, sc);
  const n = labels.length, band = (F.w - F.l - F.r) / n, bw = Math.max(3, Math.min(28, band - 2));
  const xOf = i => F.l + band * i + band / 2;
  let marks = '';
  labels.forEach((_, i) => {
    let acc = 0; const segs = series.map(s => ({ s, v: s.values[i] })).filter(x => x.v > 0);
    segs.forEach((x, k) => {
      const y0 = ax.y(acc), y1 = ax.y(acc + x.v); acc += x.v;
      const top = k === segs.length - 1, gap = k ? 2 : 0;                   // 2px surface gap between segments
      const hgt = Math.max(0, y0 - y1 - gap);
      marks += top ? `<path d="${roundTop(xOf(i) - bw / 2, y1, bw, hgt)}" fill="${x.s.color}"/>` : `<rect x="${xOf(i) - bw / 2}" y="${y1}" width="${bw}" height="${hgt}" fill="${x.s.color}"/>`;
    });
  });
  const hits = labels.map((_, i) => `<rect x="${F.l + band * i}" y="${F.t}" width="${band}" height="${F.h - F.t - F.b}" fill="transparent" data-i="${i}"/>`).join('');
  el.innerHTML = `${svgEl(F.w, F.h)}${ax.svg}${marks}${xLabels(F, labels, xOf, Math.floor((F.w - F.l) / 52))}<g class="hits">${hits}</g></svg>`;
  wireHover(el, tip, i => highlightBand(el, F, band, i));
  attachTable(el, table);
}

function lineChart(el, { dates, series, height = 200, fmt = v => fmtNum(v), extraTip, table }) {
  const labelRoom = series.length > 1 && series.length <= 4 ? 64 : 10;     // room for end-of-line labels
  const F = frame(el, height, 40); F.r = labelRoom;
  const all = series.flatMap(s => s.values).filter(Number.isFinite);
  const sc = niceScale(Math.min(...all), Math.max(...all), 4);
  const ax = yAxis(F, sc);
  const t0 = dates[0].getTime(), t1 = dates[dates.length - 1].getTime();
  const xOf = i => dates.length === 1 ? (F.l + F.w - F.r) / 2 : F.l + (F.w - F.l - F.r) * ((dates[i].getTime() - t0) / Math.max(1, t1 - t0));
  const markers = dates.length <= 12;
  let paths = '', dots = '', endLabels = '';
  const ends = [];
  series.forEach(s => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (Number.isFinite(v)) { d += `${pen ? 'L' : 'M'}${xOf(i).toFixed(1)},${ax.y(v).toFixed(1)}`; pen = true; } else pen = false; });
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (markers) s.values.forEach((v, i) => { if (Number.isFinite(v)) dots += `<circle cx="${xOf(i)}" cy="${ax.y(v)}" r="4" fill="${s.color}" stroke="#181b22" stroke-width="2"/>`; });
    const li = s.values.map(Number.isFinite).lastIndexOf(true);
    if (li >= 0) ends.push({ y: ax.y(s.values[li]), x: xOf(li), name: s.name });
  });
  if (labelRoom > 10) {                                                     // direct labels, nudged apart
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    endLabels = ends.map(e => `<text x="${F.w - F.r + 6}" y="${e.y + 4}" class="lbl">${esc(e.name)}</text>`).join('');
  }
  const xl = xLabels(F, dates.map(d => fmtDate(d)), xOf, Math.floor((F.w - F.l - F.r) / 56));
  el.innerHTML = `${svgEl(F.w, F.h)}${ax.svg}${paths}${dots}${endLabels}${xl}<line class="xh" x1="0" x2="0" y1="${F.t}" y2="${F.h - F.b}" stroke="${MUTED}" stroke-width="1" visibility="hidden"/>
    <rect class="ov" x="${F.l}" y="${F.t}" width="${F.w - F.l - F.r}" height="${F.h - F.t - F.b}" fill="transparent"/></svg>`;
  const svg = el.querySelector('svg'), ov = el.querySelector('.ov'), xh = el.querySelector('.xh');
  const nearest = cx => { let bi = 0, bd = Infinity; dates.forEach((_, i) => { const d = Math.abs(xOf(i) - cx); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const show = ev => {
    const r = svg.getBoundingClientRect(); const cx = (ev.clientX - r.left) * (F.w / r.width);
    const i = nearest(cx); xh.setAttribute('x1', xOf(i)); xh.setAttribute('x2', xOf(i)); xh.setAttribute('visibility', 'visible');
    const rows = series.filter(s => Number.isFinite(s.values[i])).map(s => `<span class="sw" style="background:${s.color}"></span>${esc(s.name)}: <b>${fmt(s.values[i])}</b>`).join('<br>');
    showTip(`<b>${fmtDate(dates[i], true)}</b><br>${rows}${extraTip ? `<br>${extraTip(i)}` : ''}`, ev.clientX, ev.clientY);
  };
  ov.addEventListener('pointermove', show); ov.addEventListener('pointerdown', show);
  ov.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
  attachTable(el, table);
}

function sparkline(vals) {
  const v = vals.map(x => Number.isFinite(x) ? x : null);
  const pts = v.map((y, i) => ({ y, i })).filter(p => p.y != null);
  if (pts.length < 2) return '<svg width="72" height="24"></svg>';
  const w = 72, h = 24, lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y));
  const X = i => 3 + (w - 6) * i / Math.max(1, v.length - 1), Y = y => hi === lo ? h / 2 : 3 + (h - 6) * (1 - (y - lo) / (hi - lo));
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${X(p.i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const l = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${SERIES[0]}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${X(l.i)}" cy="${Y(l.y)}" r="2.5" fill="${SERIES[0]}"/></svg>`;
}

function highlightBand(el, F, band, i) {
  const svg = el.querySelector('svg'); let hl = svg.querySelector('.hl-band');
  if (!hl) { hl = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); hl.setAttribute('class', 'hl-band'); svg.insertBefore(hl, svg.firstChild); }
  if (i == null) { hl.setAttribute('visibility', 'hidden'); return; }
  Object.entries({ x: F.l + band * i, y: F.t, width: band, height: F.h - F.t - F.b, fill: 'rgba(255,255,255,0.05)', visibility: 'visible' }).forEach(([k, v]) => hl.setAttribute(k, v));
}
function wireHover(el, html, onIdx) {
  el.querySelectorAll('.hits rect').forEach(r => {
    const show = ev => { const i = Number(r.dataset.i); onIdx && onIdx(i); showTip(html(i), ev.clientX, ev.clientY); };
    r.addEventListener('pointermove', show); r.addEventListener('pointerdown', show);
    r.addEventListener('pointerleave', () => { onIdx && onIdx(null); hideTip(); });
  });
}
function showTip(html, x, y) {
  let t = document.getElementById('vizTip');
  if (!t) { t = document.createElement('div'); t.id = 'vizTip'; document.body.appendChild(t); }
  t.innerHTML = html; t.style.display = 'block';
  const r = t.getBoundingClientRect(), vw = window.innerWidth;
  let left = x + 14, top = y - r.height - 12;
  if (left + r.width > vw - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 16;
  t.style.left = `${left}px`; t.style.top = `${top}px`;
}
function hideTip() { const t = document.getElementById('vizTip'); if (t) t.style.display = 'none'; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('.chart')) hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });

/* ----------------------------- events ----------------------------- */
document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act^="ins-"]'); if (!t) return;
  switch (t.dataset.act) {
    case 'ins-range': INS.range = t.dataset.range; store.set('wl:insRange', INS.range); drawInsights(); break;
    case 'ins-refresh': INS.data = null; renderInsights(); break;
    case 'ins-scope': INS.exScope = t.dataset.scope; drawInsights(); break;
  }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'exCat') {
    const list = exercisesInCategory(ev.target.value);
    INS.exercise = (list.find(x => x.weighted) || list[0])?.ex;
    redrawDetail();
  } else if (ev.target.id === 'exPick') { INS.exercise = ev.target.value; redrawDetail(); }
});

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
INS.range = store.get('wl:insRange', '12w');
