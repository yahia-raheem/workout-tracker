'use strict';
/* =====================================================================
   Workout Log · Diet: data layer + the trainee's Diet tracker
   Loaded only when the sheet has a diet plan (and in PT mode).

   Sheet tabs (created by the PT screens in dietpt.js):
   - Foods:      Food | Group | kcal /100g | Protein /100g | Carbs /100g | Fat /100g | Unit | Grams per unit
   - Diet Plan:  Kind | Meal | Item | Value | Unit | kcal | Protein | Carbs | Fat | Notes
                 Kind = Plan (Item = name, Value = start date) · Daily (limits) · Cheat (Value = N, Unit = "2 weeks")
                        · Water (Value = glasses) · Supplement (Item, Value = amount, Notes = when)
                        · Meal (Meal, limits) · Planned (Meal, Item = food, Value = amount, Unit = g / unit)
                        · Allowed (Meal, Item = food or "group: protein")
                 Limits are written "max 550", "min 40" or "target 2200" (±10%).
   - Diet Log:   Date | Meal | Status | Food | Amount | Unit | Grams | kcal | Protein | Carbs | Fat | Notes | Diet Plan | Saved at
                 Status = planned / adjusted / skipped / cheat, or taken (Meal = Supplement) / water (Meal = Water).
                 The log only ever holds the current diet plan: creating a new plan empties it.
   ===================================================================== */

const DIET_LOG_HEAD = ['Date', 'Meal', 'Status', 'Food', 'Amount', 'Unit', 'Grams', 'kcal', 'Protein', 'Carbs', 'Fat', 'Notes', 'Diet Plan', 'Saved at'];
const FOODS_HEAD = ['Food', 'Group', 'kcal /100g', 'Protein /100g', 'Carbs /100g', 'Fat /100g', 'Unit', 'Grams per unit'];
const DIET_PLAN_HEAD = ['Kind', 'Meal', 'Item', 'Value', 'Unit', 'kcal', 'Protein', 'Carbs', 'Fat', 'Notes'];
const MACROS = [{ k: 'kcal', name: 'Calories', short: '', unit: 'kcal', cls: '' }, { k: 'p', name: 'Protein', short: 'P', unit: 'g', cls: 'mp' },
  { k: 'c', name: 'Carbs', short: 'C', unit: 'g', cls: 'mc' }, { k: 'f', name: 'Fat', short: 'F', unit: 'g', cls: 'mf' }];
const LOG_COLS = DIET_LOG_HEAD.length;
const SUPP = 'Supplement', WATER = 'Water';

const nnum = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const r1 = x => Math.round(x * 10) / 10;
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = s => { const m = String(s ?? '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], m[2] - 1, +m[3]); const d = typeof toDay === 'function' ? toDay(s) : null; return d && !isNaN(d) ? d : null; };
const stampNow = () => { const d = new Date(); return `${isoDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtG = x => Math.round(x).toLocaleString('en-GB');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ------------------------------ parsing ------------------------------ */
function headerMap(row, spec) {
  const h = (row || []).map(c => norm(c)), out = {};
  for (const [k, re] of Object.entries(spec)) out[k] = h.findIndex(c => re.test(c));
  return out;
}
function parseFoods(rows) {
  const list = [];
  if (rows && rows.length) {
    const M = headerMap(rows[0], { name: /^(food|name)/, group: /^group/, kcal: /^(kcal|cal)/, p: /^protein/, c: /^carb/, f: /^fat/, unit: /^unit/, gpu: /^grams? per/ });
    if (M.name >= 0) rows.slice(1).forEach((r, i) => {
      const name = str(r[M.name]); if (!name) return;
      const g = k => M[k] >= 0 ? nnum(r[M[k]]) : null;
      list.push({ name, group: M.group >= 0 ? str(r[M.group]).toLowerCase() : '', kcal: g('kcal') || 0, p: g('p') || 0, c: g('c') || 0, f: g('f') || 0,
        unit: M.unit >= 0 ? str(r[M.unit]) : '', gpu: g('gpu') || 0, row: i + 2 });
    });
  }
  return { list, byName: new Map(list.map(f => [norm(f.name), f])), groups: [...new Set(list.map(f => f.group).filter(Boolean))] };
}
function parseLimit(v, k) {
  const s = str(v); if (!s) return null;
  const m = s.match(/^(max|min|target|≤|<=|≥|>=|≈|~)?\s*([\d.,]+)/i); if (!m) return null;
  const val = nnum(m[2]); if (!(val > 0)) return null;
  const w = (m[1] || '').toLowerCase();
  const mode = /max|≤|<=/.test(w) ? 'max' : /min|≥|>=/.test(w) ? 'min' : /target|≈|~/.test(w) ? 'target' : (k === 'p' ? 'min' : 'max');
  return { mode, val };
}
const fmtLimit = l => l ? `${l.mode} ${l.val}` : '';
const limSym = l => ({ max: '≤', min: '≥', target: '≈' })[l.mode];
function parseDietPlan(rows) {
  const P = { name: '', start: '', daily: {}, cheat: { n: 0, weeks: 0 }, water: 0, supps: [], meals: [] };
  if (!rows || !rows.length) return P;
  const lims = r => ({ kcal: parseLimit(r[5], 'kcal'), p: parseLimit(r[6], 'p'), c: parseLimit(r[7], 'c'), f: parseLimit(r[8], 'f') });
  const meal = name => { let m = P.meals.find(x => norm(x.name) === norm(name)); if (!m) { m = { name: str(name), limits: {}, planned: [], allowed: [] }; P.meals.push(m); } return m; };
  for (const r of rows.slice(1)) {
    const kind = norm(r[0]);
    if (kind === 'plan') { P.name = str(r[2]); const d = dayOf(r[3]); P.start = d ? isoDay(d) : ''; }
    else if (kind === 'daily') P.daily = lims(r);
    else if (kind === 'cheat') P.cheat = { n: Math.max(0, parseInt(r[3]) || 0), weeks: Math.max(0, parseInt(r[4]) || 0) };
    else if (kind === 'water') P.water = Math.max(0, parseInt(r[3]) || 0);
    else if (kind === 'supplement' && str(r[2])) P.supps.push({ name: str(r[2]), amount: str(r[3]), when: str(r[9]) });
    else if (kind === 'meal' && str(r[1])) { const m = meal(r[1]); m.limits = lims(r); }
    else if (kind === 'planned' && str(r[1]) && str(r[2])) meal(r[1]).planned.push({ food: str(r[2]), amount: nnum(r[3]) ?? '', unit: str(r[4]) || 'g' });
    else if (kind === 'allowed' && str(r[1]) && str(r[2])) meal(r[1]).allowed.push(str(r[2]));
  }
  return P;
}
// Parsed Foods + Diet Plan, cached until the sheet is re-read.
function dietModel() {
  const raw = state.model.dietRaw;
  if (raw._parsed) return raw._parsed;
  raw._parsed = { foods: parseFoods(raw.foods), plan: parseDietPlan(raw.plan) };
  return raw._parsed;
}
function parseLog(grid) {
  const L = { rows: [], byDay: new Map(), supp: new Map(), water: new Map() };
  if (!grid || !grid.length) return L;
  const M = headerMap(grid[0], { date: /^date/, meal: /^meal/, status: /^status/, food: /^food/, amount: /^amount/, unit: /^unit/, grams: /^grams/,
    kcal: /^(kcal|cal)/, p: /^protein/, c: /^carb/, f: /^fat/, notes: /^notes?/, plan: /^diet plan/, at: /^saved/ });
  const g = (r, k) => M[k] >= 0 ? r[M[k]] : '';
  grid.slice(1).forEach((r, i) => {
    const date = dayOf(g(r, 'date')), meal = str(g(r, 'meal'));
    if (!date || !meal) return;
    const x = { rowNum: i + 2, date: isoDay(date), meal, status: norm(g(r, 'status')), food: str(g(r, 'food')), amount: str(g(r, 'amount')), unit: str(g(r, 'unit')) || 'g',
      grams: nnum(g(r, 'grams')) || 0, kcal: nnum(g(r, 'kcal')) || 0, p: nnum(g(r, 'p')) || 0, c: nnum(g(r, 'c')) || 0, f: nnum(g(r, 'f')) || 0,
      notes: str(g(r, 'notes')), plan: str(g(r, 'plan')) };
    L.rows.push(x);
    if (norm(meal) === norm(SUPP)) { if (!L.supp.has(x.date)) L.supp.set(x.date, new Map()); L.supp.get(x.date).set(norm(x.food), x); return; }
    if (norm(meal) === norm(WATER)) { L.water.set(x.date, x); return; }
    if (!L.byDay.has(x.date)) L.byDay.set(x.date, new Map());
    const day = L.byDay.get(x.date), k = norm(meal);
    if (!day.has(k)) day.set(k, { meal, status: x.status, items: [], notes: '', rowNums: [] });
    const e = day.get(k);
    e.rowNums.push(x.rowNum);
    if (x.food) e.items.push({ food: x.food, amount: nnum(x.amount) ?? x.amount, unit: x.unit, logged: x });
    if (x.notes) e.notes = e.notes ? e.notes + ' · ' + x.notes : x.notes;
    if (x.status === 'cheat' || x.status === 'skipped') e.status = x.status;
  });
  return L;
}

/* ---------------------------- nutrition maths ---------------------------- */
function gramsOf(it, food) {
  const a = nnum(it.amount) || 0;
  return food && it.unit && norm(it.unit) !== 'g' && food.gpu ? a * food.gpu : a;
}
function nutrition(it, foods = dietModel().foods) {
  const food = foods.byName.get(norm(it.food));
  if (!food) return { g: 0, kcal: 0, p: 0, c: 0, f: 0, missing: true };
  const g = gramsOf(it, food);
  return { g, kcal: food.kcal * g / 100, p: food.p * g / 100, c: food.c * g / 100, f: food.f * g / 100 };
}
function sumNutrition(items, foods) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  items.forEach(it => { const n = it.logged && !foods ? it.logged : nutrition(it, foods); for (const k in t) t[k] += n[k] || 0; });
  return t;
}
// within ±10% for a target
function limitState(l, v) {
  if (!l) return '';
  if (l.mode === 'max') return v <= l.val ? 'ok' : 'over';
  if (l.mode === 'min') return v >= l.val ? 'ok' : 'low';
  return v > l.val * 1.1 ? 'over' : v < l.val * 0.9 ? 'low' : 'ok';
}
function onTarget(tot, limits) { return MACROS.every(m => !limits?.[m.k] || limitState(limits[m.k], tot[m.k]) === 'ok'); }
function amountLabel(it, food) {
  const a = nnum(it.amount);
  if (!it.unit || norm(it.unit) === 'g') return `${a ?? '–'} g`;
  return `${a ?? '–'} × ${it.unit}${food?.gpu && a ? ` (${fmtG(a * food.gpu)} g)` : ''}`;
}
function macroLine(n) { return `${fmtG(n.kcal)} kcal · <span class="mp">P ${fmtG(n.p)}</span> · <span class="mc">C ${fmtG(n.c)}</span> · <span class="mf">F ${fmtG(n.f)}</span>`; }
// "548 kcal ✓ · P 52 ✓ · C 66 6 over · F 7 ✓"
function totalsHTML(tot, limits, label = '') {
  return `${label}${MACROS.map(m => {
    const l = limits?.[m.k], st = limitState(l, tot[m.k]);
    const v = m.k === 'kcal' ? `<b>${fmtG(tot.kcal)} kcal</b>` : `<span class="${m.cls}">${m.short} ${fmtG(tot[m.k])}</span>`;
    if (!st) return v;
    const diff = Math.round(Math.abs(tot[m.k] - l.val * (l.mode === 'target' ? (st === 'over' ? 1.1 : 0.9) : 1)));
    return `${v} ${st === 'ok' ? '<span class="d-ok" aria-label="within limit">✓</span>' : `<span class="d-${st}">${diff} ${st === 'over' ? 'over' : 'short'}</span>`}`;
  }).join(' · ')}`;
}
function limitPills(limits) {
  return MACROS.filter(m => limits?.[m.k]).map(m => `<span class="${m.cls}">${m.k === 'kcal' ? 'kcal' : m.name.toLowerCase()} ${limSym(limits[m.k])} ${limits[m.k].val}</span>`).join('');
}
// The foods a trainee may pick for a meal: the planned ones, the allowed ones, and whole allowed groups.
function allowedFoods(meal, D = dietModel()) {
  const out = new Map(), add = f => f && out.set(norm(f.name), f);
  meal.planned.forEach(it => add(D.foods.byName.get(norm(it.food))));
  meal.allowed.forEach(a => {
    const g = a.match(/^group:\s*(.+)$/i);
    if (g) D.foods.list.filter(f => f.group === norm(g[1])).forEach(add); else add(D.foods.byName.get(norm(a)));
  });
  return [...out.values()];
}
// A swap keeps the nutrient the group is about (protein for protein foods, carbs for carbs…).
function swapAmount(fromIt, to, D = dietModel()) {
  const from = D.foods.byName.get(norm(fromIt.food)), n = nutrition(fromIt, D.foods);
  const key = { protein: 'p', dairy: 'p', carbs: 'c', fruit: 'c', fats: 'f' }[from?.group] || 'kcal';
  const per = to[key] > 0 ? to[key] : to.kcal, have = to[key] > 0 ? n[key] : n.kcal;
  const grams = per > 0 ? have / per * 100 : 100;
  if (to.gpu) return { amount: Math.max(0.5, Math.round(grams / to.gpu * 2) / 2), unit: to.unit, key };
  return { amount: Math.max(5, Math.round(grams / 5) * 5), unit: 'g', key };
}
const defaultAmount = f => f.gpu ? { amount: 1, unit: f.unit } : { amount: 100, unit: 'g' };

/* ------------------------- cheat meals (rolling) ------------------------- */
// "N cheat meals in any X weeks": counted over the X weeks ending on the day in question.
function cheatList(L) {
  const out = [];
  for (const [ds, day] of L.byDay) for (const e of day.values()) if (e.status === 'cheat') out.push({ ds, date: dayOf(ds), meal: e.meal });
  return out.sort((a, b) => a.date - b.date);
}
function cheatInfo(L, plan, ds) {
  const { n, weeks } = plan.cheat;
  if (!weeks && !n) return null;
  const W = (weeks || 1) * 7, end = dayOf(ds), from = addDays(end, -(W - 1));
  const win = cheatList(L).filter(c => c.date >= from && c.date <= end);
  if (!n) return { used: win.length, n, text: win.length ? `Cheat meals: ${win.length} (none allowed in this plan)` : 'No cheat meals in this plan', over: win.length > 0 };
  if (win.length < n) return { used: win.length, n, text: `Cheat meals: ${win.length} of ${n} in the last ${W} days`, over: false };
  const next = addDays(win[win.length - n].date, W);
  return { used: win.length, n, next, over: win.length > n,
    text: `Cheat meals: ${win.length} of ${n} used${win.length > n ? ' (over the allowance)' : ''} · next one from ${shortDate(next, true)}` };
}
// Was this cheat meal one too many? (more than N in the X weeks ending that day)
function cheatOver(L, plan, ds, meal) {
  const { n, weeks } = plan.cheat, W = (weeks || 1) * 7, end = dayOf(ds), from = addDays(end, -(W - 1));
  const win = cheatList(L).filter(c => c.date >= from && (c.date < end || (c.ds === ds && norm(c.meal) <= norm(meal))));
  return win.length > n;
}

/* ------------------------------ Diet Log I/O ------------------------------ */
const DT = { date: null, grid: null, L: null, open: null, edit: null, busy: false, tab: null, water: null, waterTimer: null };
async function loadDietLog() {
  const t = state.model.dietRaw.tabs.log;
  if (!t) { DT.grid = [DIET_LOG_HEAD]; DT.tab = null; }
  else { const [rows] = await state.ds.batchGet(state.sheet.id, [`${q(t.title)}!A1:N`]); DT.grid = rows.length ? rows : [DIET_LOG_HEAD]; DT.tab = { ...t }; }
  DT.L = parseLog(DT.grid);
  return DT.L;
}
async function ensureLogTab() {
  if (DT.tab) return DT.tab;
  const id = state.sheet.id, meta = await state.ds.meta(id);
  let t = meta.sheets.find(s => norm(s.title) === 'diet log');
  if (!t) {
    const sheetId = await state.ds.addSheet(id, 'Diet Log');
    t = { title: 'Diet Log', sheetId, rowCount: 1000 };
    await state.ds.update(id, `${q(t.title)}!A1:N1`, [DIET_LOG_HEAD], 'RAW');
  }
  DT.tab = { title: t.title, sheetId: t.sheetId, rowCount: t.rowCount || 1000 };
  state.model.dietRaw.tabs.log = DT.tab;
  return DT.tab;
}
// Replace the log rows picked by `match` with `newRows` (in place where possible, extra rows appended,
// leftovers blanked). Reads the tab first so another device's rows are respected.
async function writeLog(match, newRows) {
  const id = state.sheet.id, tab = await ensureLogTab();
  const [fresh] = await state.ds.batchGet(id, [`${q(tab.title)}!A1:N`]);
  const grid = fresh.length ? fresh : [DIET_LOG_HEAD];
  const old = parseLog(grid).rows.filter(match).map(r => r.rowNum).sort((a, b) => a - b);
  const writes = new Map();
  newRows.forEach((v, i) => { if (i < old.length) writes.set(old[i], v); });
  old.slice(newRows.length).forEach(rn => writes.set(rn, Array(LOG_COLS).fill('')));
  let next = grid.length + 1;
  const extra = newRows.slice(old.length);
  if (extra.length) {
    const end = next + extra.length - 1;
    if (end > tab.rowCount) { await state.ds.addRows(id, tab.sheetId, end - tab.rowCount + 100); tab.rowCount = end + 100; }
    extra.forEach(v => writes.set(next++, v));
  }
  // one update per run of consecutive rows (usually one or two)
  const nums = [...writes.keys()].sort((a, b) => a - b);
  for (let i = 0; i < nums.length;) {
    let j = i; while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    await state.ds.update(id, `${q(tab.title)}!A${nums[i]}:N${nums[j]}`, nums.slice(i, j + 1).map(n => writes.get(n)), 'RAW');
    i = j + 1;
  }
  for (const [rn, v] of writes) { while (grid.length < rn) grid.push([]); grid[rn - 1] = v; }
  DT.grid = grid; DT.L = parseLog(grid);
}
async function ensureToken() { if (!DEMO && !tokenValid()) await requestToken(); }
function mealRows(ds, meal, status, items, notes) {
  const D = dietModel(), plan = D.plan.name, at = stampNow();
  const base = (food = '', amount = '', unit = '', n = null, note = '') =>
    [ds, meal, status, food, amount, unit, n ? Math.round(n.g) : '', n ? Math.round(n.kcal) : '', n ? r1(n.p) : '', n ? r1(n.c) : '', n ? r1(n.f) : '', note, plan, at];
  if (status === 'skipped') return [base('', '', '', null, notes)];
  if (status === 'cheat') return [base('', '', '', null, notes || 'cheat meal')];
  return items.filter(it => nnum(it.amount) > 0).map((it, i) => {
    const f = D.foods.byName.get(norm(it.food));
    return base(f ? f.name : it.food, nnum(it.amount), it.unit || 'g', nutrition(it, D.foods), i === 0 ? notes : '');
  });
}

/* ------------------------------ tracker UI ------------------------------ */
async function renderDiet() {
  setChrome({ menu: true });
  if (!state.model.hasDiet) { $('#app').innerHTML = `${tabsHTML('log')}<div class="panel"><h2>No diet plan</h2><p class="muted">Your PT hasn't set up a diet plan in this sheet.</p></div>`; return; }
  $('#app').innerHTML = `${tabsHTML('diet')}<div class="panel center"><div class="spinner"></div><div class="muted">Loading your diet…</div></div>`;
  try { await loadDietLog(); }
  catch (e) {
    if (e instanceof AuthError) { state.authLost = true; return renderSignin(e.message); }
    $('#app').innerHTML = `${tabsHTML('diet')}<div class="panel"><h2>Couldn't load your diet</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-act="d-retry">Try again</button></div>`;
    return;
  }
  const today = isoDay(new Date()), start = dietModel().plan.start;
  if (!DT.date || DT.date > today || (start && DT.date < start)) DT.date = today;
  if (DT.open === null) DT.open = defaultOpenMeal();
  drawDiet();
}
// Today, the first meal not logged yet is open, ready to log.
function defaultOpenMeal() {
  const { plan } = dietModel(), today = isoDay(new Date());
  if (DT.date !== today) return '';
  const logged = DT.L.byDay.get(today) || new Map();
  const m = plan.meals.find(x => !logged.has(norm(x.name)));
  if (m) startEdit(m);
  return m ? m.name : '';
}
function startEdit(meal) {
  const e = DT.L.byDay.get(DT.date)?.get(norm(meal.name));
  const copy = items => items.map(it => ({ food: it.food, amount: it.amount, unit: it.unit || 'g' }));
  if (e) DT.edit = { meal: meal.name, status: e.status, items: copy(e.items.length ? e.items : meal.planned), notes: e.notes || '' };
  else DT.edit = { meal: meal.name, status: meal.planned.length ? 'planned' : 'adjusted', items: copy(meal.planned), notes: '' };
}
function dayTitle(ds) {
  const today = isoDay(new Date()), y = isoDay(addDays(new Date(), -1));
  return ds === today ? 'Today' : ds === y ? 'Yesterday' : dayOf(ds).toLocaleDateString('en-GB', { weekday: 'long' });
}
function drawDiet() {
  setChrome({ menu: true });
  const D = dietModel(), P = D.plan, L = DT.L, ds = DT.date, today = isoDay(new Date());
  const day = L.byDay.get(ds) || new Map();
  const eaten = [...day.values()].filter(e => e.status === 'planned' || e.status === 'adjusted');
  const tot = sumNutrition(eaten.flatMap(e => e.items));
  const cheats = [...day.values()].filter(e => e.status === 'cheat').length;
  const ci = cheatInfo(L, P, ds);
  const y = window.scrollY;
  $('#app').innerHTML = `${tabsHTML('diet')}
    <div class="d-nav">
      <button data-act="d-day" data-d="-1" ${P.start && ds <= P.start ? 'disabled' : ''} aria-label="Previous day">‹</button>
      <div class="center"><b>${esc(dayTitle(ds))}</b><div class="muted small">${esc(shortDate(dayOf(ds), true))} · ${esc(P.name || 'Diet plan')}</div></div>
      <button data-act="d-day" data-d="1" ${ds >= today ? 'disabled' : ''} aria-label="Next day">›</button>
    </div>
    <section class="dp"><div class="d-bars">${MACROS.map(m => dayBar(m, tot[m.k], P.daily[m.k])).join('')}</div>
      ${cheats ? `<div class="small muted" style="margin-top:8px">+ ${plural(cheats, 'cheat meal')} (not counted in the totals)</div>` : ''}
      ${ci ? `<div class="small ${ci.over ? 'd-over' : 'muted'}" style="margin-top:8px">${esc(ci.text)}</div>` : ''}
    </section>
    ${P.meals.length ? P.meals.map(mealCardHTML).join('') : '<p class="muted center">This diet plan has no meals yet.</p>'}
    ${P.supps.length || P.water ? suppHTML() : ''}
    <p class="small muted center" style="margin-top:14px">Diet plan by your PT. Totals are worked out from the Foods list.</p>`;
  window.scrollTo({ top: y });
}
function dayBar(m, v, l) {
  const pct = l ? Math.min(100, Math.round(v / l.val * 100)) : 0, st = limitState(l, v);
  const right = l ? `<b>${fmtG(v)}</b> / ${limSym(l)} ${fmtG(l.val)} ${m.unit}${st === 'over' ? ` <span class="d-over">· ${fmtG(v - l.val * (l.mode === 'target' ? 1.1 : 1))} over</span>` : ''}` : `<b>${fmtG(v)}</b> ${m.unit}`;
  return `<div class="d-mb"><div class="t"><span class="${m.cls}">${m.name}</span><span>${right}</span></div>
    ${l ? `<div class="bar" role="progressbar" aria-label="${m.name}" aria-valuenow="${Math.round(v)}" aria-valuemax="${l.val}"><i style="width:${pct}%"></i></div>` : ''}</div>`;
}
const STATUS_CHIP = { planned: ['eat', '✓ As planned'], adjusted: ['eat', '✓ Adjusted'], skipped: ['skip', 'Skipped'], cheat: ['cheat', 'Cheat'] };
function mealCardHTML(m) {
  const D = dietModel(), e = DT.L.byDay.get(DT.date)?.get(norm(m.name)), open = norm(DT.open || '') === norm(m.name);
  const today = isoDay(new Date());
  let chip, sub;
  if (e) {
    chip = STATUS_CHIP[e.status] || ['eat', e.status];
    if (e.status === 'cheat') {
      const over = cheatOver(DT.L, D.plan, DT.date, m.name);
      sub = `“${esc(e.notes || 'cheat meal')}”${over ? ' · <span class="d-over">over allowance</span>' : ''}`;
    } else if (e.status === 'skipped') sub = 'skipped';
    else { const t = sumNutrition(e.items); sub = `${fmtG(t.kcal)} kcal · P ${fmtG(t.p)} · C ${fmtG(t.c)} · F ${fmtG(t.f)}`; }
  } else {
    chip = ['todo', 'Not logged'];
    sub = esc(limitPillsText(m.limits) || 'no limits');
  }
  return `<section class="d-meal ${open ? 'open' : ''}" id="meal-${esc(norm(m.name).replace(/\W+/g, '-'))}">
    <button class="hd" data-act="d-meal" data-meal="${esc(m.name)}" aria-expanded="${open}">
      <span class="t"><b>${esc(m.name)}</b><span class="s">${sub}</span></span><span class="d-st ${chip[0]}">${chip[1]}</span>
    </button>
    ${open ? `<div class="bd">${mealEditorHTML(m)}</div>` : ''}
  </section>`;
}
const limitPillsText = l => MACROS.filter(x => l?.[x.k]).map(x => `${x.k === 'kcal' ? 'kcal' : x.short} ${limSym(l[x.k])} ${l[x.k].val}`).join(' · ');
function mealEditorHTML(m) {
  const D = dietModel(), E = DT.edit, e = DT.L.byDay.get(DT.date)?.get(norm(m.name));
  const btn = (s, label, dis) => `<button class="${E.status === s ? 'on' : ''}" data-act="d-status" data-s="${s}" ${dis ? 'disabled' : ''}>${label}</button>`;
  let body = '';
  if (E.status === 'planned') {
    body = m.planned.map(it => { const f = D.foods.byName.get(norm(it.food)), n = nutrition(it, D.foods);
      return `<div class="d-it"><div class="top"><b dir="auto">${esc(f ? f.name : it.food)}</b><span>${esc(amountLabel(it, f))}</span></div><div class="ro">${macroLine(n)}</div></div>`; }).join('')
      + `<div class="d-tot" id="dTot">${totalsHTML(sumNutrition(m.planned, D.foods), m.limits)}</div>`;
  } else if (E.status === 'adjusted') {
    body = E.items.map((it, k) => itemEditorHTML(it, k, D)).join('')
      + `<button class="d-add" data-act="d-addfood">+ Add allowed food</button>
      <div class="d-tot" id="dTot">${totalsHTML(sumNutrition(E.items, D.foods), m.limits)}</div>`;
  } else if (E.status === 'skipped') {
    body = `<p class="muted small" style="margin:6px 0">This meal will be saved as skipped.</p>`;
  } else {
    const ci = cheatInfo(DT.L, D.plan, DT.date), already = e?.status === 'cheat';
    const wouldBeOver = ci && !already && (ci.n === 0 || ci.used >= ci.n);
    body = `<label class="d-lbl" for="dNotes">What did you eat?</label>
      <textarea class="d-inp" id="dNotes" data-df="notes" dir="auto" placeholder="e.g. pizza, 2 slices">${esc(E.notes)}</textarea>
      ${wouldBeOver ? `<div class="d-warn">This is over your cheat-meal allowance (${ci.n} in ${D.plan.cheat.weeks || 1} week${D.plan.cheat.weeks === 1 ? '' : 's'}). You can still log it; your PT will see it marked.</div>` : ''}`;
  }
  return `<div class="d-sbtn">${btn('planned', '✓ As planned', !m.planned.length)}${btn('adjusted', 'Adjust')}${btn('skipped', 'Skipped')}${btn('cheat', 'Cheat')}</div>
    ${limitPills(m.limits) ? `<div class="d-pills">${limitPills(m.limits)}</div>` : ''}
    ${body}
    <button class="btn block" data-act="d-save" style="margin-top:10px" ${DT.busy ? 'disabled' : ''}>${DT.busy ? 'Saving…' : `Save ${esc(m.name.toLowerCase())}`}</button>
    ${e ? `<button class="text-btn block" data-act="d-clear" style="display:block;margin:6px auto 0;color:var(--muted)">Remove this log</button>` : ''}`;
}
function itemEditorHTML(it, k, D = dietModel()) {
  const f = D.foods.byName.get(norm(it.food)), n = nutrition(it, D.foods);
  const units = f?.gpu ? [['g', 'g'], [f.unit, f.unit]] : [['g', 'g']];
  return `<div class="d-it">
    <div class="top"><b dir="auto">${esc(f ? f.name : it.food)}</b><span id="dIt-${k}">${f ? macroLine(n) : 'not in Foods'}</span></div>
    <div class="ctl">
      <input class="d-inp c" inputmode="decimal" data-df="amt" data-k="${k}" value="${esc(it.amount)}" aria-label="Amount of ${esc(it.food)}">
      <select class="d-inp" data-df="unit" data-k="${k}" aria-label="Unit">${units.map(([v, l]) => `<option value="${esc(v)}" ${norm(v) === norm(it.unit || 'g') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button class="text-btn" data-act="d-swap" data-k="${k}" style="justify-self:start;padding:6px 2px">⇄ Swap</button>
      <button class="icon-btn small" data-act="d-rm" data-k="${k}" aria-label="Remove ${esc(it.food)}">✕</button>
    </div></div>`;
}
function suppHTML() {
  const P = dietModel().plan, taken = DT.L.supp.get(DT.date) || new Map();
  const w = DT.water && DT.water.ds === DT.date ? DT.water.n : (nnum(DT.L.water.get(DT.date)?.amount) || 0);
  return `<section class="dp"><h3 style="margin-bottom:8px">Supplements &amp; water</h3>
    ${P.supps.map(s => { const on = taken.has(norm(s.name));
      return `<button class="d-sup" data-act="d-sup" data-name="${esc(s.name)}" aria-pressed="${on}"><span class="d-box ${on ? 'on' : ''}">${on ? '✓' : ''}</span><span style="flex:1">${esc(s.name)}${s.amount ? ` · ${esc(s.amount)}` : ''} ${s.when ? `<span class="muted small">${esc(s.when)}</span>` : ''}</span></button>`; }).join('')}
    ${P.water ? `<div class="d-sup" style="display:block"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span>Water</span><span><b>${w}</b> / ${P.water} glasses</span></div>
      <div style="display:flex;align-items:center;gap:10px"><div class="d-glass" aria-hidden="true">${Array.from({ length: Math.max(P.water, w) }, (_, i) => `<i class="${i < w ? 'f' : ''}"></i>`).join('')}</div><span style="flex:1"></span>
      <button class="icon-btn small" data-act="d-water" data-d="-1" aria-label="One glass less" ${w ? '' : 'disabled'}>−</button><button class="icon-btn small" data-act="d-water" data-d="1" aria-label="One more glass">+</button></div></div>` : ''}
  </section>`;
}
function redrawOpenMeal() {
  const m = dietModel().plan.meals.find(x => norm(x.name) === norm(DT.open));
  const el = m && document.getElementById('meal-' + norm(m.name).replace(/\W+/g, '-'));
  if (el) el.outerHTML = mealCardHTML(m); else drawDiet();
}
function showFoodPicker(mode, k) {
  const D = dietModel(), m = D.plan.meals.find(x => norm(x.name) === norm(DT.open)); if (!m) return;
  let foods = allowedFoods(m, D), from = null;
  if (mode === 'swap') {
    from = DT.edit.items[k];
    const fg = D.foods.byName.get(norm(from.food))?.group;
    const same = foods.filter(f => f.group === fg && norm(f.name) !== norm(from.food));
    foods = same.length ? same : foods.filter(f => norm(f.name) !== norm(from.food));
  }
  const keyName = { p: 'protein', c: 'carbs', f: 'fat', kcal: 'calories' };
  openModal(`<h3>${mode === 'swap' ? `Swap ${esc(from.food)}` : `Add to ${esc(m.name.toLowerCase())}`}</h3>
    <p class="muted small" style="margin-top:-6px">${mode === 'swap' ? 'Foods your PT allows for this meal. The amount is set to match the original.' : 'Only foods your PT allows for this meal.'}</p>
    ${foods.length > 6 ? `<input class="d-inp" id="dPickQ" placeholder="Search…" autocomplete="off">` : ''}
    <div class="d-list" id="dPickList">${foods.length ? foods.map(f => {
      const s = mode === 'swap' ? swapAmount(from, f, D) : null;
      return `<button class="d-food" data-act="d-pick" data-food="${esc(f.name)}" data-mode="${mode}" data-k="${k ?? ''}" data-q="${esc(norm(f.name + ' ' + f.group))}">
        <span class="n"><b dir="auto">${esc(f.name)}</b><span>${s ? `${esc(amountLabel(s, f))} for the same ${keyName[s.key]}` : `${fmtG(f.kcal)} kcal · P ${r1(f.p)} · C ${r1(f.c)} · F ${r1(f.f)} per 100 g`}</span></span><span class="chip">${esc(f.group || '—')}</span></button>`; }).join('') : '<p class="muted">No other foods are allowed for this meal.</p>'}</div>
    <button class="btn ghost block" data-act="close" style="margin-top:12px">Cancel</button>`);
  $('#dPickQ')?.addEventListener('input', ev => { const qv = norm(ev.target.value); document.querySelectorAll('#dPickList .d-food').forEach(b => b.hidden = qv && !b.dataset.q.includes(qv)); });
}
async function saveMeal() {
  if (DT.busy) return;
  const D = dietModel(), m = D.plan.meals.find(x => norm(x.name) === norm(DT.open)), E = DT.edit; if (!m) return;
  const items = E.status === 'planned' ? m.planned : E.items;
  if ((E.status === 'planned' || E.status === 'adjusted') && !items.some(it => nnum(it.amount) > 0)) return toast('Add at least one food with an amount.', 3000);
  const rows = mealRows(DT.date, m.name, E.status, items, str(E.notes));
  DT.busy = true; redrawOpenMeal();
  try {
    await ensureToken();
    await writeLog(r => r.date === DT.date && norm(r.meal) === norm(m.name), rows);
    toast(`${m.name} saved`);
    try { navigator.vibrate?.(40); } catch {}
    DT.busy = false; DT.open = '';
    const next = D.plan.meals.find(x => !DT.L.byDay.get(DT.date)?.has(norm(x.name)) && D.plan.meals.indexOf(x) > D.plan.meals.indexOf(m));
    if (next) { DT.open = next.name; startEdit(next); }
    drawDiet();
  } catch (e) {
    DT.busy = false; redrawOpenMeal();
    toast(e instanceof AuthError ? 'Your Google sign-in expired. Tap Save again to sign in.' : 'Not saved: ' + e.message, 5000);
  }
}
async function clearMeal() {
  const m = dietModel().plan.meals.find(x => norm(x.name) === norm(DT.open)); if (!m) return;
  closeModal();
  try {
    await ensureToken();
    await writeLog(r => r.date === DT.date && norm(r.meal) === norm(m.name), []);
    startEdit(m); toast(`${m.name} log removed`); drawDiet();
  } catch (e) { toast(e instanceof AuthError ? 'Your Google sign-in expired. Try again to sign in.' : 'Not removed: ' + e.message, 5000); }
}
async function toggleSupp(name) {
  const ds = DT.date, on = (DT.L.supp.get(ds) || new Map()).has(norm(name)), P = dietModel().plan;
  try {
    await ensureToken();
    await writeLog(r => r.date === ds && norm(r.meal) === norm(SUPP) && norm(r.food) === norm(name),
      on ? [] : [[ds, SUPP, 'taken', name, '', '', '', '', '', '', '', '', P.name, stampNow()]]);
    drawDiet();
  } catch (e) { toast(e instanceof AuthError ? 'Your Google sign-in expired. Tap again to sign in.' : 'Not saved: ' + e.message, 5000); }
}
// Water: the count changes on screen at once and is written a moment after the last tap.
async function changeWater(d) {
  const ds = DT.date, P = dietModel().plan;
  const cur = DT.water && DT.water.ds === ds ? DT.water.n : (nnum(DT.L.water.get(ds)?.amount) || 0);
  DT.water = { ds, n: Math.max(0, Math.min(30, cur + d)) };
  drawDiet();
  try { await ensureToken(); } catch (e) { return toast('Sign in to save water: ' + e.message, 4000); }
  clearTimeout(DT.waterTimer);
  DT.waterTimer = setTimeout(async () => {
    const w = DT.water;
    try {
      await writeLog(r => r.date === w.ds && norm(r.meal) === norm(WATER), w.n ? [[w.ds, WATER, 'water', '', w.n, 'glasses', '', '', '', '', '', '', P.name, stampNow()]] : []);
      if (DT.water === w) DT.water = null;
    } catch (e) { toast('Water not saved: ' + e.message, 4000); }
  }, 1200);
}

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act^="d-"]'); if (!t || t.disabled) return;
  const D = DT.L ? dietModel() : null, E = DT.edit, k = Number(t.dataset.k);
  switch (t.dataset.act) {
    case 'd-retry': renderDiet(); break;
    case 'd-day': {
      const nd = isoDay(addDays(dayOf(DT.date), Number(t.dataset.d))), today = isoDay(new Date());
      if (nd > today || (D.plan.start && nd < D.plan.start)) break;
      DT.date = nd; DT.open = ''; DT.open = defaultOpenMeal(); drawDiet(); window.scrollTo({ top: 0 }); break;
    }
    case 'd-meal': {
      const m = D.plan.meals.find(x => norm(x.name) === norm(t.dataset.meal)); if (!m) break;
      if (norm(DT.open || '') === norm(m.name)) DT.open = ''; else { DT.open = m.name; startEdit(m); }
      drawDiet();
      if (DT.open) document.getElementById('meal-' + norm(m.name).replace(/\W+/g, '-'))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    }
    case 'd-status': {
      const m = D.plan.meals.find(x => norm(x.name) === norm(DT.open));
      E.status = t.dataset.s;
      if (E.status === 'adjusted' && !E.items.length) E.items = m.planned.map(it => ({ ...it }));
      redrawOpenMeal(); break;
    }
    case 'd-rm': E.items.splice(k, 1); redrawOpenMeal(); break;
    case 'd-swap': showFoodPicker('swap', k); break;
    case 'd-addfood': showFoodPicker('add'); break;
    case 'd-pick': {
      const f = D.foods.byName.get(norm(t.dataset.food)); if (!f) break;
      if (t.dataset.mode === 'swap') { const s = swapAmount(E.items[Number(t.dataset.k)], f, D); E.items[Number(t.dataset.k)] = { food: f.name, amount: s.amount, unit: s.unit }; }
      else E.items.push({ food: f.name, ...defaultAmount(f) });
      closeModal(); redrawOpenMeal(); break;
    }
    case 'd-save': saveMeal(); break;
    case 'd-clear': openModal(`<h3>Remove this log?</h3><p class="muted">The ${esc(DT.open.toLowerCase())} entry for ${esc(shortDate(dayOf(DT.date), true))} is removed from the Diet Log.</p>
      <div style="display:flex;gap:8px"><button class="btn danger" data-act="d-clear-go" style="flex:1">Remove</button><button class="btn ghost" data-act="close">Cancel</button></div>`); break;
    case 'd-clear-go': clearMeal(); break;
    case 'd-sup': toggleSupp(t.dataset.name); break;
    case 'd-water': changeWater(Number(t.dataset.d)); break;
  }
});
document.addEventListener('input', ev => {
  const f = ev.target.dataset?.df; if (!f || !DT.edit) return;
  const E = DT.edit, k = Number(ev.target.dataset.k);
  if (f === 'notes') { E.notes = ev.target.value; return; }
  if (f === 'amt') E.items[k].amount = ev.target.value.replace(',', '.');
  if (f === 'unit') { E.items[k].unit = ev.target.value; return redrawOpenMeal(); }
  const D = dietModel(), m = D.plan.meals.find(x => norm(x.name) === norm(DT.open));
  const it = document.getElementById('dIt-' + k); if (it) it.innerHTML = macroLine(nutrition(E.items[k], D.foods));
  const tot = document.getElementById('dTot'); if (tot && m) tot.innerHTML = totalsHTML(sumNutrition(E.items, D.foods), m.limits);
});
