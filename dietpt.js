'use strict';
/* =====================================================================
   Workout Log · Diet for the PT (PT mode only): Foods library, Diet planner,
   diet files and Diet insights. Uses the data layer in diet.js.
   ===================================================================== */

const DPT = { fq: '', fg: '', draft: null, openMeal: 0, saving: false };
const DIET_GROUPS = ['protein', 'carbs', 'fats', 'veg', 'fruit', 'dairy', 'other'];
const dietDraftKey = () => `wl:dietDraft:${state.sheet?.id}`;
const clone2 = x => JSON.parse(JSON.stringify(x));

function planSegHTML(on) {
  return `<div class="seg wide" role="tablist" aria-label="Plan type">${[['workout', 'Workout plan'], ['diet', 'Diet plan'], ['foods', 'Foods']]
    .map(([k, l]) => `<button class="${on === k ? 'on' : ''}" data-act="dp-view" data-v="${k}">${l}</button>`).join('')}</div>`;
}
function dietInsSegHTML(on) {
  return `<div class="seg wide" role="tablist" aria-label="Insights type">${[['training', 'Training'], ['diet', 'Diet']]
    .map(([k, l]) => `<button class="${on === k ? 'on' : ''}" data-act="di-view" data-v="${k}">${l}</button>`).join('')}</div>`;
}
const macroPer100 = f => `${fmtG(f.kcal)} kcal · <span class="mp">P ${r1(f.p)}</span> · <span class="mc">C ${r1(f.c)}</span> · <span class="mf">F ${r1(f.f)}</span>`;
async function ensureTab(title, head) {
  const id = state.sheet.id, meta = await state.ds.meta(id);
  let t = meta.sheets.find(s => norm(s.title) === norm(title));
  if (!t) { const sheetId = await state.ds.addSheet(id, title); t = { title, sheetId, rowCount: 1000 }; }
  return t;
}
// Rewrite a whole tab: header + rows, blanking whatever was below.
async function writeTab(title, head, rows) {
  const id = state.sheet.id, t = await ensureTab(title, head);
  const [cur] = await state.ds.batchGet(id, [`${q(t.title)}!A1:${colLetter(head.length - 1)}`]);
  const end = Math.max(rows.length + 1, cur.length, 1);
  if (end > (t.rowCount || 1000)) await state.ds.addRows(id, t.sheetId, end - t.rowCount + 50);
  const values = [head, ...rows];
  while (values.length < end) values.push(Array(head.length).fill(''));
  await state.ds.update(id, `${q(t.title)}!A1:${colLetter(head.length - 1)}${end}`, values, 'RAW');
  return { tab: t, values: [head, ...rows] };
}
const authMsg = e => e instanceof AuthError ? 'Your Google sign-in expired. Tap again to sign in.' : e.message;

/* ================================ Foods ================================ */
function renderFoods() {
  setChrome({ menu: true });
  const F = dietModel().foods, qv = norm(DPT.fq), y = window.scrollY;
  const groups = [...new Set([...F.groups])].sort();
  const list = F.list.filter(f => (!DPT.fg || f.group === DPT.fg) && (!qv || norm(f.name + ' ' + f.group).includes(qv)))
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  $('#app').innerHTML = `${tabsHTML('plan')}${planSegHTML('foods')}
    <div class="dp" style="padding:10px 12px"><input class="d-inp" id="dfQ" value="${esc(DPT.fq)}" placeholder="Search ${F.list.length} food${F.list.length === 1 ? '' : 's'}…" autocomplete="off"></div>
    ${groups.length ? `<div class="d-chips">${[['', 'All'], ...groups.map(g => [g, g])].map(([g, l]) => `<button class="${DPT.fg === g ? 'on' : ''}" data-act="df-group" data-g="${esc(g)}">${esc(l[0].toUpperCase() + l.slice(1))}</button>`).join('')}</div>` : ''}
    <div class="dp" style="padding:4px 14px">${list.length ? list.map(f => `<button class="d-food" data-act="df-edit" data-name="${esc(f.name)}">
        <span class="n"><b dir="auto">${esc(f.name)}</b><span>${macroPer100(f)} ${f.gpu ? `· 1 ${esc(f.unit)} = ${r1(f.gpu)} g` : 'per 100 g'}</span></span><span class="chip">${esc(f.group || '—')}</span></button>`).join('')
      : `<p class="muted" style="margin:12px 0">${F.list.length ? 'No foods match.' : 'No foods yet. Add the foods your trainees may eat; values are per 100 g, as on nutrition labels.'}</p>`}</div>
    <button class="add-ex" data-act="df-edit" data-name="">+ Add food</button>
    <p class="small muted" style="line-height:1.5">Foods are shared by every diet plan in this sheet and are never deleted when a new diet plan is created. The group is used for swaps: a trainee can swap a food for another of the same group if the meal allows it.</p>`;
  window.scrollTo({ top: y });
  $('#dfQ').addEventListener('input', ev => { DPT.fq = ev.target.value; const pos = ev.target.selectionStart; renderFoods(); const el = $('#dfQ'); el.focus(); el.setSelectionRange(pos, pos); });
}
function foodFormHTML(f) {
  const groups = [...new Set([...DIET_GROUPS, ...dietModel().foods.groups])];
  const n = (id, v, label, cls = '') => `<div><input class="d-inp c" id="${id}" inputmode="decimal" value="${esc(v ?? '')}" data-ff><span class="d-lbl ${cls}" style="margin-top:3px;text-align:center">${label}</span></div>`;
  return `<h3>${f ? 'Edit food' : 'Add a food'}</h3>
    <label class="d-lbl" for="ffName">Name</label><input class="d-inp" id="ffName" value="${esc(f?.name || '')}" dir="auto" autocomplete="off">
    <div class="d-row2"><div><label class="d-lbl" for="ffGroup">Swap group</label><input class="d-inp" id="ffGroup" list="ffGroups" value="${esc(f?.group || '')}" autocomplete="off"><datalist id="ffGroups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
      <div><label class="d-lbl" for="ffUnit">Unit (optional)</label><div style="display:grid;grid-template-columns:1fr 64px;gap:6px"><input class="d-inp" id="ffUnit" value="${esc(f?.unit || '')}" placeholder="e.g. egg" autocomplete="off"><input class="d-inp c" id="ffGpu" inputmode="decimal" value="${esc(f?.gpu || '')}" placeholder="g" aria-label="Grams per unit"></div></div></div>
    <span class="d-lbl">Per 100 g</span>
    <div class="d-row4">${n('ffK', f?.kcal, 'kcal')}${n('ffP', f?.p, 'protein', 'mp')}${n('ffC', f?.c, 'carbs', 'mc')}${n('ffF', f?.f, 'fat', 'mf')}</div>
    <div class="d-check" id="ffCheck"></div>
    <p class="small err-text" id="ffErr" hidden></p>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" style="flex:1" data-act="df-save" data-orig="${esc(f?.name || '')}">Save food</button><button class="btn ghost" data-act="close">Cancel</button></div>
    ${f ? `<button class="text-btn" data-act="df-del" data-name="${esc(f.name)}" style="display:block;margin:8px auto 0;color:var(--err)">Delete this food</button>` : ''}`;
}
function foodCheck() {
  const v = id => nnum($('#' + id)?.value), k = v('ffK'), p = v('ffP') || 0, c = v('ffC') || 0, f = v('ffF') || 0, el = $('#ffCheck');
  if (!el) return;
  if (k == null) { el.className = 'd-check'; el.textContent = 'Enter the values from the label, per 100 g.'; return; }
  const calc = Math.round(p * 4 + c * 4 + f * 9), off = Math.abs(calc - k) > Math.max(25, k * 0.15);
  el.className = 'd-check' + (off ? ' bad' : '');
  el.innerHTML = `${off ? '⚠' : '✓'} Protein × 4 + carbs × 4 + fat × 9 = <b>${calc} kcal</b>${off ? `, but kcal says ${k}. Check for a typo (fibre and alcohol can explain small gaps).` : `, close to ${k}. Numbers look consistent.`}`;
}
function foodRows(list) { return list.map(f => [f.name, f.group, f.kcal, f.p, f.c, f.f, f.unit, f.gpu || '']); }
async function saveFood(orig) {
  const v = id => str($('#' + id).value), err = msg => { const e = $('#ffErr'); e.textContent = msg; e.hidden = false; };
  const name = v('ffName'), list = dietModel().foods.list.map(f => ({ ...f }));
  if (!name) return err('Give the food a name.');
  if (list.some(f => norm(f.name) === norm(name) && norm(f.name) !== norm(orig))) return err('There is already a food with this name.');
  const num4 = ['ffK', 'ffP', 'ffC', 'ffF'].map(id => nnum(v(id)));
  if (num4[0] == null || num4.some(x => x != null && x < 0)) return err('Enter kcal per 100 g (and protein, carbs, fat if known).');
  const unit = v('ffUnit'), gpu = nnum(v('ffGpu'));
  if (unit && !(gpu > 0)) return err(`Enter how many grams one ${unit} weighs.`);
  const food = { name, group: v('ffGroup').toLowerCase(), kcal: num4[0], p: num4[1] || 0, c: num4[2] || 0, f: num4[3] || 0, unit: gpu > 0 ? unit : '', gpu: unit ? gpu : 0 };
  const i = list.findIndex(f => norm(f.name) === norm(orig));
  if (i >= 0) list[i] = food; else list.push(food);
  try {
    await ensureToken();
    const { values } = await writeTab('Foods', FOODS_HEAD, foodRows(list));
    state.model.dietRaw.foods = values;
    if (orig && norm(orig) !== norm(name)) await renameInPlan(orig, name);
    state.model.dietRaw._parsed = null;
    closeModal(); toast(`“${name}” saved`); renderFoods();
  } catch (e) { err('Not saved: ' + authMsg(e)); }
}
// A renamed food keeps its place in the diet plan.
async function renameInPlan(from, to) {
  const rows = state.model.dietRaw.plan; if (!rows) return;
  let changed = false;
  const out = rows.slice(1).map(r => { const x = [...r]; if (['planned', 'allowed'].includes(norm(x[0])) && norm(x[2]) === norm(from)) { x[2] = to; changed = true; } return x; });
  if (changed) { const { values } = await writeTab('Diet Plan', DIET_PLAN_HEAD, out); state.model.dietRaw.plan = values; }
}
async function deleteFood(name) {
  const P = dietModel().plan;
  const used = P.meals.filter(m => m.planned.some(it => norm(it.food) === norm(name)) || m.allowed.some(a => norm(a) === norm(name))).map(m => m.name);
  if (used.length) return toast(`“${name}” is used in the diet plan (${used.join(', ')}). Remove it there first.`, 5000);
  try {
    await ensureToken();
    const { values } = await writeTab('Foods', FOODS_HEAD, foodRows(dietModel().foods.list.filter(f => norm(f.name) !== norm(name))));
    state.model.dietRaw.foods = values; state.model.dietRaw._parsed = null;
    closeModal(); toast(`“${name}” deleted`); renderFoods();
  } catch (e) { toast('Not deleted: ' + authMsg(e), 5000); }
}

/* ============================= Diet planner ============================= */
const blankLimits = () => ({ kcal: null, p: null, c: null, f: null });
function newDraft(from = null) {
  const P = from ? clone2(from) : { name: '', start: '', daily: blankLimits(), cheat: { n: 1, weeks: 2 }, water: 8, supps: [], meals: [] };
  P.meals = P.meals.map(m => ({ ...m, limits: { ...blankLimits(), ...m.limits } }));
  P.daily = { ...blankLimits(), ...P.daily };
  return P;
}
function saveDietDraft() { clearTimeout(saveDietDraft.t); saveDietDraft.t = setTimeout(() => store.set(dietDraftKey(), { ...DPT.draft, at: Date.now() }), 300); }
function renderDietPlanner() {
  setChrome({ menu: true });
  const has = state.model.hasDiet;
  if (!DPT.draft) {
    const d = store.get(dietDraftKey());
    if (d && d.plan) { DPT.draft = d; DPT.resumed = true; }
    else if (has) DPT.draft = { mode: 'edit', plan: newDraft(dietModel().plan) };
  }
  if (!DPT.draft) return renderDietIntro();
  renderDietEditor();
}
function renderDietIntro() {
  const nFoods = dietModel().foods.list.length;
  $('#app').innerHTML = `${tabsHTML('plan')}${planSegHTML('diet')}
    <section class="panel"><h2>No diet plan yet</h2>
      <p class="muted">A diet plan has meals with limits, the foods planned for each meal, and the foods the trainee may swap in. Once it's saved, the trainee gets a <b>Diet</b> tab.</p>
      ${nFoods ? '' : `<div class="d-warn" style="margin-bottom:12px">Add some foods first (the <b>Foods</b> tab above); meals are built from them.</div>`}
      <div style="display:grid;gap:10px"><button class="btn block" data-act="dp-new" data-from="empty">Create a diet plan</button>
      <button class="btn ghost block" data-act="dp-import">⤒ Import a diet file</button></div>
      <input type="file" id="dpFile" accept=".json,application/json" hidden></section>`;
}
function limitInputs(prefix, limits, idx = '') {
  return `<div class="d-row2">${MACROS.map(m => {
    const l = limits[m.k];
    return `<div><span class="d-lbl ${m.cls}" style="margin:6px 0 3px">${m.k === 'kcal' ? 'kcal' : m.name.toLowerCase() + ' g'}</span><div class="d-lim">
      <select class="d-inp" data-dpf="${prefix}-mode" data-m="${m.k}" data-i="${idx}" aria-label="${m.name} limit type">${[['max', '≤'], ['min', '≥'], ['target', '≈']].map(([v, s]) => `<option value="${v}" ${(l?.mode || (m.k === 'p' ? 'min' : 'max')) === v ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input class="d-inp" inputmode="decimal" data-dpf="${prefix}-val" data-m="${m.k}" data-i="${idx}" value="${esc(l?.val ?? '')}" placeholder="none" aria-label="${m.name} limit"></div></div>`;
  }).join('')}</div>`;
}
function renderDietEditor() {
  setChrome({ menu: true });
  const Dr = DPT.draft, P = Dr.plan, D = dietModel(), y = window.scrollY;
  $('#app').innerHTML = `${tabsHTML('plan')}${planSegHTML('diet')}
    ${DPT.resumed ? `<div class="banner"><span>Unsaved diet-plan changes were kept on this device.</span><button class="text-btn" data-act="dp-discard">Discard</button></div>` : ''}
    ${Dr.mode === 'new' && state.model.hasDiet ? `<div class="d-warn" style="margin:0 0 12px">New diet plan. Saving it <b>replaces “${esc(D.plan.name)}”</b> and deletes its logged meals.</div>` : ''}
    <section class="dp">
      <p class="eyebrow">${Dr.mode === 'new' ? 'New diet plan' : 'Current diet plan'}</p>
      <label class="d-lbl" for="dpName">Plan name</label><input class="d-inp" id="dpName" data-dpf="name" value="${esc(P.name)}" placeholder="e.g. Cut – Dec" autocomplete="off">
      ${Dr.mode !== 'new' && P.start ? `<p class="small muted" style="margin:6px 0 0">Started ${esc(shortDate(dayOf(P.start), true))}.</p>` : ''}
      <span class="d-lbl">Daily targets <span style="text-transform:none;letter-spacing:0">(≤ max · ≥ min · ≈ target ±10%)</span></span>
      ${limitInputs('daily', P.daily)}
      <div class="d-row2"><div><span class="d-lbl">Cheat meals</span><div style="display:flex;align-items:center;gap:6px"><input class="d-inp c" style="width:54px" inputmode="numeric" data-dpf="cheat-n" value="${esc(P.cheat.n)}" aria-label="Cheat meals allowed"><span class="small muted">in any</span><input class="d-inp c" style="width:54px" inputmode="numeric" data-dpf="cheat-w" value="${esc(P.cheat.weeks)}" aria-label="Weeks"><span class="small muted">wk</span></div></div>
        <div><span class="d-lbl">Water (glasses / day)</span><input class="d-inp" inputmode="numeric" data-dpf="water" value="${esc(P.water || '')}" placeholder="none"></div></div>
      <span class="d-lbl">Supplements</span>
      <div class="d-pills">${P.supps.map((s, i) => `<button data-act="dp-supp-rm" data-i="${i}" aria-label="Remove ${esc(s.name)}">${esc(s.name)}${s.amount ? ' · ' + esc(s.amount) : ''}${s.when ? ' · ' + esc(s.when) : ''} ✕</button>`).join('')}<button class="add" data-act="dp-supp-add">+ Add</button></div>
    </section>
    ${P.meals.map((m, i) => dietMealHTML(m, i, D)).join('')}
    <button class="add-ex" data-act="dp-meal-add">+ Add meal</button>
    <section class="dp"><div class="d-pills" style="margin:0">
      <button data-act="dp-export">⤓ Export diet file</button><button data-act="dp-import">⤒ Import diet file</button>
      ${Dr.mode === 'new' ? (state.model.hasDiet ? '<button data-act="dp-discard">Cancel new plan</button>' : '') : '<button data-act="dp-newask">New diet plan…</button>'}
    </div><input type="file" id="dpFile" accept=".json,application/json" hidden></section>
    <div class="savebar" id="dpBar"><div class="inner"><div class="count">${esc(P.meals.length)} meal${P.meals.length === 1 ? '' : 's'} · ${esc(P.meals.reduce((t, m) => t + m.planned.length, 0))} planned foods</div>
      <button class="btn" data-act="dp-save" ${DPT.saving ? 'disabled' : ''}>${Dr.mode === 'new' ? 'Create diet plan' : 'Save diet plan'}</button></div></div>`;
  window.scrollTo({ top: y });
}
function dietMealHTML(m, i, D) {
  const open = DPT.openMeal === i, P = DPT.draft.plan;
  if (!open) {
    const t = sumNutrition(m.planned, D.foods);
    return `<section class="dp"><button class="d-food" data-act="dp-meal-open" data-i="${i}" style="padding:0">
      <span class="n"><b>Meal ${i + 1} · ${esc(m.name || 'Unnamed')}</b><span>${plural(m.planned.length, 'planned food')} · ${fmtG(t.kcal)} kcal</span></span><span class="text-btn" style="padding:0">Open</span></button></section>`;
  }
  const tot = sumNutrition(m.planned, D.foods);
  return `<section class="dp" style="border-color:#3b4250">
    <div style="display:flex;align-items:center;gap:6px"><b style="flex:1">Meal ${i + 1}</b>
      <button class="icon-btn small" data-act="dp-meal-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
      <button class="icon-btn small" data-act="dp-meal-move" data-i="${i}" data-d="1" ${i < P.meals.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
      <button class="icon-btn small" data-act="dp-meal-rm" data-i="${i}" aria-label="Delete meal">✕</button></div>
    <label class="d-lbl">Name</label><input class="d-inp" data-dpf="meal-name" data-i="${i}" value="${esc(m.name)}" placeholder="e.g. Breakfast" dir="auto">
    <span class="d-lbl">Limits for this meal</span>${limitInputs('meal', m.limits, i)}
    <span class="d-lbl">Planned (“As planned”)</span>
    ${m.planned.map((it, k) => { const f = D.foods.byName.get(norm(it.food)), units = f?.gpu ? ['g', f.unit] : ['g'];
      return `<div class="d-it"><div class="top"><b dir="auto">${esc(f ? f.name : it.food)}</b><span id="dpIt-${i}-${k}">${f ? macroLine(nutrition(it, D.foods)) : '<span class="d-over">not in Foods</span>'}</span></div>
        <div class="ctl" style="grid-template-columns:74px 92px 1fr auto"><input class="d-inp c" inputmode="decimal" data-dpf="it-amt" data-i="${i}" data-k="${k}" value="${esc(it.amount)}" aria-label="Amount">
        <select class="d-inp" data-dpf="it-unit" data-i="${i}" data-k="${k}" aria-label="Unit">${units.map(u => `<option ${norm(u) === norm(it.unit) ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select><span></span>
        <button class="icon-btn small" data-act="dp-it-rm" data-i="${i}" data-k="${k}" aria-label="Remove">✕</button></div></div>`; }).join('')}
    <button class="d-add" data-act="dp-it-add" data-i="${i}">+ Add planned food</button>
    <div class="d-tot" id="dpTot-${i}">${totalsHTML(tot, m.limits, 'Planned total: ')}</div>
    <span class="d-lbl">Also allowed (trainee can swap or add)</span>
    <div class="d-pills">${m.allowed.map((a, k) => { const g = a.match(/^group:\s*(.+)$/i);
      return `<button data-act="dp-al-rm" data-i="${i}" data-k="${k}">${g ? `All <b>${esc(g[1])}</b>` : esc(a)} ✕</button>`; }).join('')}<button class="add" data-act="dp-al-add" data-i="${i}">+ Allow food or group</button></div>
    <p class="small muted" style="margin:4px 0 0">Planned foods are always allowed. Swaps stay within a food's group.</p>
  </section>`;
}
function readDraftLimits(prefix, obj, i) {
  // inputs → limits object (called on input)
  MACROS.forEach(m => {
    const mode = document.querySelector(`[data-dpf="${prefix}-mode"][data-m="${m.k}"][data-i="${i}"]`)?.value;
    const val = nnum(document.querySelector(`[data-dpf="${prefix}-val"][data-m="${m.k}"][data-i="${i}"]`)?.value);
    obj[m.k] = val > 0 ? { mode, val } : null;
  });
}
function showDietPicker(kind, i) {
  const D = dietModel(), m = DPT.draft.plan.meals[i];
  const foods = D.foods.list.slice().sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const groups = kind === 'al' ? D.foods.groups.filter(g => !m.allowed.some(a => norm(a) === norm('group: ' + g))) : [];
  const skip = kind === 'al' ? new Set([...m.allowed.map(norm), ...m.planned.map(it => norm(it.food))]) : new Set(m.planned.map(it => norm(it.food)));
  const list = foods.filter(f => !skip.has(norm(f.name)));
  openModal(`<h3>${kind === 'al' ? 'Allow for' : 'Add to'} ${esc(m.name || 'this meal')}</h3>
    ${list.length > 6 ? `<input class="d-inp" id="dpPickQ" placeholder="Search…" autocomplete="off">` : ''}
    <div class="d-list" id="dpPickList">
      ${groups.map(g => `<button class="d-food" data-act="dp-pick" data-kind="${kind}" data-i="${i}" data-v="group: ${esc(g)}" data-q="${esc(g)}"><span class="n"><b>All ${esc(g)} foods</b><span>any food in the ${esc(g)} group, now and later</span></span><span class="chip">group</span></button>`).join('')}
      ${list.map(f => `<button class="d-food" data-act="dp-pick" data-kind="${kind}" data-i="${i}" data-v="${esc(f.name)}" data-q="${esc(norm(f.name + ' ' + f.group))}"><span class="n"><b dir="auto">${esc(f.name)}</b><span>${macroPer100(f)}</span></span><span class="chip">${esc(f.group || '—')}</span></button>`).join('')}
      ${!groups.length && !list.length ? `<p class="muted">${D.foods.list.length ? 'Every food is already in this meal.' : 'Add foods in the Foods tab first.'}</p>` : ''}
    </div><button class="btn ghost block" data-act="close" style="margin-top:12px">Cancel</button>`);
  $('#dpPickQ')?.addEventListener('input', ev => { const qv = norm(ev.target.value); document.querySelectorAll('#dpPickList .d-food').forEach(b => b.hidden = qv && !b.dataset.q.includes(qv)); });
}
function planToRows(P) {
  const L = l => fmtLimit(l);
  const rows = [['Plan', '', P.name, P.start], ['Daily', '', '', '', '', L(P.daily.kcal), L(P.daily.p), L(P.daily.c), L(P.daily.f)],
    ['Cheat', '', '', Number(P.cheat.n) || 0, `${Number(P.cheat.weeks) || 1} weeks`]];
  if (P.water) rows.push(['Water', '', '', Number(P.water), 'glasses']);
  P.supps.forEach(s => rows.push(['Supplement', '', s.name, s.amount, '', '', '', '', '', s.when]));
  P.meals.forEach(m => {
    rows.push(['Meal', m.name, '', '', '', L(m.limits.kcal), L(m.limits.p), L(m.limits.c), L(m.limits.f)]);
    m.planned.forEach(it => rows.push(['Planned', m.name, it.food, nnum(it.amount) ?? '', it.unit || 'g']));
    m.allowed.forEach(a => rows.push(['Allowed', m.name, a]));
  });
  return rows;
}
function validateDraft(P) {
  if (!str(P.name)) return 'Give the diet plan a name.';
  if (!P.meals.length) return 'Add at least one meal.';
  const names = P.meals.map(m => norm(m.name));
  if (names.some(n => !n)) return 'Every meal needs a name.';
  if (new Set(names).size !== names.length) return 'Two meals have the same name.';
  if (names.some(n => n === norm(SUPP) || n === norm(WATER))) return `“Supplement” and “Water” can't be meal names.`;
  return '';
}
async function countLoggedMeals() {
  const t = state.model.dietRaw.tabs.log; if (!t) return 0;
  const L = await loadDietLog();
  let n = 0; for (const day of L.byDay.values()) n += day.size;
  return n;
}
async function askSaveDiet() {
  const Dr = DPT.draft, err = validateDraft(Dr.plan);
  if (err) return toast(err, 4000);
  if (Dr.mode === 'new' && state.model.hasDiet) {
    let n = 0;
    try { n = await countLoggedMeals(); } catch (e) { return toast(authMsg(e), 4000); }
    openModal(`<h3>Create a new diet plan?</h3>
      <div class="d-warn">⚠ This <b>replaces “${esc(dietModel().plan.name)}”</b> and <b>deletes all ${plural(n, 'logged meal')}</b> (and supplement and water logs) from the Diet Log. It can't be undone in the app. (Google Sheets' File → Version history can still restore the sheet.) Your Foods list is kept.</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn danger" style="flex:1" data-act="dp-save-go">Delete &amp; create</button><button class="btn ghost" data-act="close">Cancel</button></div>`);
    return;
  }
  saveDiet();
}
async function saveDiet() {
  if (DPT.saving) return;
  const Dr = DPT.draft, P = clone2(Dr.plan);
  if (Dr.mode === 'new' || !P.start) P.start = isoDay(new Date());
  DPT.saving = true;
  openModal(`<div class="center" style="padding:18px 0"><div class="spinner"></div><b>Saving the diet plan…</b><p class="muted small">Keep this page open.</p></div>`, { locked: true });
  try {
    await ensureToken();
    if (Dr.mode === 'new' && state.model.dietRaw.tabs.log) {          // start the new plan with an empty log
      const t = state.model.dietRaw.tabs.log, [cur] = await state.ds.batchGet(state.sheet.id, [`${q(t.title)}!A1:N`]);
      if (cur.length > 1) await state.ds.update(state.sheet.id, `${q(t.title)}!A2:N${cur.length}`, cur.slice(1).map(() => Array(LOG_COLS).fill('')), 'RAW');
      DT.grid = null; DT.L = null; DT.date = null;
    }
    await writeTab('Diet Plan', DIET_PLAN_HEAD, planToRows(P));
    const r = await fetchModel(state.sheet.id);                        // re-read: the trainee's Diet tab appears
    state.model = r.model; state.checks = r.checks;
    store.del(dietDraftKey()); DPT.draft = null; DPT.resumed = false; DPT.saving = false;
    renderDietPlanner();
    openModal(`<div class="result ok"><div class="r-icon" aria-hidden="true">✓</div><h3>Diet plan saved</h3>
      <p><b>${esc(P.name)}</b>: ${plural(P.meals.length, 'meal')}. The trainee sees it in the <b>Diet</b> tab.</p><button class="btn block" data-act="close">Done</button></div>`);
  } catch (e) {
    DPT.saving = false;
    openModal(`<div class="result err"><div class="r-icon" aria-hidden="true">!</div><h3>Diet plan not saved</h3><p>${esc(authMsg(e))}</p>
      <p class="muted small">Your changes are kept on this device.</p><button class="btn block" data-act="dp-save">${e instanceof AuthError ? 'Sign in &amp; save' : 'Try again'}</button>
      <button class="btn ghost block" data-act="close" style="margin-top:10px">Not now</button></div>`, { locked: true });
  }
}

/* ------------------------------ diet files ------------------------------ */
async function shareJSON(data, fname, title) {
  const file = new File([JSON.stringify(data, null, 2)], fname, { type: 'application/json' });
  if (isMobile && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved “${fname}”`);
}
function exportDiet() {
  const D = dietModel(), P = DPT.draft ? DPT.draft.plan : D.plan;
  const used = new Set();
  P.meals.forEach(m => { m.planned.forEach(it => used.add(norm(it.food))); m.allowed.forEach(a => { const g = a.match(/^group:\s*(.+)$/i); if (g) D.foods.list.filter(f => f.group === norm(g[1])).forEach(f => used.add(norm(f.name))); else used.add(norm(a)); }); });
  const foods = D.foods.list.filter(f => used.has(norm(f.name))).map(({ row, ...f }) => f);
  const plan = clone2(P); delete plan.start;
  const slug = (P.name || 'diet').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/gi, '-').replace(/^-+|-+$/g, '') || 'diet';
  shareJSON({ app: 'workout-log', kind: 'diet', version: 1, exportedAt: new Date().toISOString(), name: P.name, plan, foods }, `${slug}.diet-plan.json`, P.name);
}
// Importing adds the file's foods that this sheet doesn't have yet (existing foods are kept as they are)
// and opens the plan as a new diet plan.
async function importDiet(file) {
  let data;
  try { data = JSON.parse(await file.text()); if (data.kind !== 'diet' || !data.plan || !Array.isArray(data.plan.meals)) throw 0; }
  catch { return toast(`“${file.name}” isn't a Workout Log diet file.`, 4000); }
  const have = dietModel().foods.list, add = (data.foods || []).filter(f => f && str(f.name) && !have.some(h => norm(h.name) === norm(f.name)));
  try {
    if (add.length) {
      await ensureToken();
      const list = [...have, ...add.map(f => ({ name: str(f.name), group: str(f.group).toLowerCase(), kcal: +f.kcal || 0, p: +f.p || 0, c: +f.c || 0, f: +f.f || 0, unit: str(f.unit), gpu: +f.gpu || 0 }))];
      const { values } = await writeTab('Foods', FOODS_HEAD, foodRows(list));
      state.model.dietRaw.foods = values; state.model.dietRaw._parsed = null;
    }
  } catch (e) { return toast('Foods not added: ' + authMsg(e), 5000); }
  DPT.draft = { mode: 'new', plan: newDraft({ ...data.plan, name: str(data.name || data.plan.name), start: '' }) };
  DPT.openMeal = 0; DPT.resumed = false; saveDietDraft();
  renderDietEditor();
  toast(`${plural(add.length, 'food')} added to Foods. Check the plan, then create it.`, 4500);
}

/* ============================ Diet insights ============================ */
async function renderDietInsights() {
  setChrome({ menu: true });
  INS.charts = [];
  $('#app').innerHTML = `${tabsHTML('insights')}${dietInsSegHTML('diet')}<div class="panel center"><div class="spinner"></div><div class="muted">Reading the diet log…</div></div>`;
  try {
    await loadDietLog();
    if (!INS.data) await loadInsightsData().catch(() => null);          // for body weight
  } catch (e) {
    if (e instanceof AuthError) { state.authLost = true; return renderSignin(e.message); }
    $('#app').innerHTML = `${tabsHTML('insights')}${dietInsSegHTML('diet')}<div class="panel"><h2>Couldn't load the diet log</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-act="di-view" data-v="diet">Try again</button></div>`;
    return;
  }
  drawDietInsights();
}
function drawDietInsights() {
  const D = dietModel(), P = D.plan, L = DT.L, seg = dietInsSegHTML('diet');
  INS.charts = [];
  const start = dayOf(P.start) || new Date(), today = dayOf(isoDay(new Date()));
  const days = []; for (let d = new Date(start); d <= today; d = addDays(d, 1)) days.push(isoDay(d));
  const entries = []; for (const [ds, day] of L.byDay) for (const e of day.values()) entries.push({ ds, ...e });
  const eaten = entries.filter(e => e.status === 'planned' || e.status === 'adjusted');
  const mealOf = e => P.meals.find(m => norm(m.name) === norm(e.meal));
  const on = eaten.filter(e => mealOf(e) && onTarget(sumNutrition(e.items), mealOf(e).limits));
  const perDay = days.map(ds => { const xs = eaten.filter(e => e.ds === ds); return { ds, n: xs.length, ...sumNutrition(xs.flatMap(e => e.items)) }; });
  const logged = perDay.filter(d => d.n);
  const avg = k => logged.length ? logged.reduce((t, d) => t + d[k], 0) / logged.length : 0;
  const cheats = cheatList(L), overN = cheats.filter(c => cheatOver(L, P, c.ds, c.meal)).length;
  const expected = days.length * P.meals.length, notLogged = Math.max(0, expected - entries.length - P.meals.filter(m => !L.byDay.get(isoDay(today))?.has(norm(m.name))).length);   // today isn't over yet
  const lim = P.daily;
  const tileLim = (k, v) => lim[k] ? `${({ max: 'max', min: 'min', target: 'target' })[lim[k].mode]} ${fmtG(lim[k].val)}${lim[k].mode === 'min' && v < lim[k].val ? ` · ${fmtG(lim[k].val - v)} short` : lim[k].mode === 'max' && v > lim[k].val ? ` · ${fmtG(v - lim[k].val)} over` : ''}` : 'no daily target';
  // per meal
  const byMeal = P.meals.map(m => {
    const es = entries.filter(e => norm(e.meal) === norm(m.name)), ea = es.filter(e => e.status === 'planned' || e.status === 'adjusted');
    const issues = new Map();
    ea.forEach(e => { const t = sumNutrition(e.items); MACROS.forEach(x => { const st = limitState(m.limits[x.k], t[x.k]); if (st && st !== 'ok') { const k = `${x.k === 'kcal' ? 'kcal' : x.name.toLowerCase()} ${st === 'over' ? 'over' : 'low'}`; issues.set(k, (issues.get(k) || 0) + 1); } }); });
    const top = [...issues.entries()].sort((a, b) => b[1] - a[1])[0];
    return { m, n: ea.length, on: ea.filter(e => onTarget(sumNutrition(e.items), m.limits)).length, skipped: es.filter(e => e.status === 'skipped').length, cheat: es.filter(e => e.status === 'cheat').length, top };
  });
  const supp = P.supps.map(s => ({ s, n: days.filter(ds => L.supp.get(ds)?.has(norm(s.name))).length }));
  const waterDays = days.map(ds => nnum(L.water.get(ds)?.amount)).filter(v => v != null);
  const body = INS.data?.body?.entries || [];
  const b0 = [...body].reverse().find(e => e.date <= start) || body.find(e => e.date >= start), b1 = body[body.length - 1];
  const pctOn = eaten.length ? Math.round(on.length / eaten.length * 100) : 0;
  $('#app').innerHTML = `${tabsHTML('insights')}${seg}
    <section class="dp"><p class="eyebrow">Diet plan</p><h3>${esc(P.name)}</h3><div class="meta">Since ${esc(shortDate(start, true))} · ${plural(days.length, 'day')} · ${plural(entries.length, 'meal')} logged${notLogged ? ` · ${notLogged} not logged` : ''}</div></section>
    ${!entries.length ? `<section class="panel"><h2>Nothing logged yet</h2><p class="muted">Once the trainee logs meals in the Diet tab, adherence shows up here.</p></section>` : `
    <div class="tiles">
      ${tile('Meals on target', eaten.length ? `${pctOn}%` : '–', `${on.length} of ${eaten.length} eaten`)}
      ${tile('Avg calories', fmtG(avg('kcal')), `kcal/day · ${tileLim('kcal', avg('kcal'))}`)}
      ${tile('Avg protein', `${fmtG(avg('p'))} g`, tileLim('p', avg('p')))}
      ${tile('Cheat meals', cheats.length, `${P.cheat.n} per ${plural(P.cheat.weeks || 1, 'week')}${overN ? ` · <span class="d-over">${overN} over</span>` : ''}`)}
    </div>
    <section class="panel ins"><h2>Calories per day</h2><p class="sub">Eaten meals only (cheat meals aren't counted).${lim.kcal ? ` Dashed line: ${lim.kcal.mode} ${fmtG(lim.kcal.val)}.` : ''}</p><div class="chart" id="chDietK"></div></section>
    <section class="panel ins"><h2>Protein per day</h2><p class="sub">${lim.p ? `Dashed line: ${lim.p.mode} ${fmtG(lim.p.val)} g.` : 'No daily protein target.'}</p><div class="chart" id="chDietP"></div></section>
    <section class="panel ins"><h2>By meal</h2>
      <table class="d-tbl"><thead><tr><th>Meal</th><th class="r">On target</th><th class="r">Skipped</th><th class="r">Cheat</th><th>Most often</th></tr></thead><tbody>
      ${byMeal.map(x => `<tr><td>${esc(x.m.name)}</td><td class="r">${x.n ? Math.round(x.on / x.n * 100) + '%' : '–'}</td><td class="r">${x.skipped}</td><td class="r">${x.cheat}</td><td class="${x.top ? (/over/.test(x.top[0]) ? 'd-over' : 'd-low') : 'muted'}">${x.top ? esc(x.top[0]) + ` (${x.top[1]}×)` : '—'}</td></tr>`).join('')}
      </tbody></table></section>`}
    ${P.supps.length || P.water ? `<section class="panel ins"><h2>Supplements &amp; water</h2><table class="d-tbl"><tbody>
      ${supp.map(x => `<tr><td>${esc(x.s.name)}${x.s.when ? ` <span class="muted small">${esc(x.s.when)}</span>` : ''}</td><td class="r">${x.n} / ${days.length} days</td></tr>`).join('')}
      ${P.water ? `<tr><td>Water</td><td class="r">${waterDays.length ? r1(waterDays.reduce((t, v) => t + v, 0) / waterDays.length) : '–'} / ${P.water} glasses avg</td></tr>` : ''}
    </tbody></table></section>` : ''}
    ${b0 && b1 && b1.date > b0.date ? `<section class="panel ins"><h2>Body weight</h2><p class="sub">From Body Data, since the plan started.</p><div class="tiles three" style="margin:8px 0 0">
      ${tile('Start', r1(b0.weight), `kg · ${fmtDate(b0.date)}`)}${tile('Latest', r1(b1.weight), `kg · ${fmtDate(b1.date)}`)}${tile('Change', (b1.weight - b0.weight > 0 ? '+' : '') + r1(b1.weight - b0.weight), 'kg')}</div></section>` : ''}`;
  if (!entries.length) return;
  const lbl = perDay.map(d => fmtDate(dayOf(d.ds)));
  const tip = (k, unit) => i => `<b>${esc(shortDate(dayOf(perDay[i].ds), true))}</b><br>${fmtG(perDay[i][k])} ${unit}${perDay[i].n ? ` · ${plural(perDay[i].n, 'meal')}` : ' · nothing logged'}`;
  const chart = (id, k, unit, l) => addChart(id, el => barChart(el, { labels: lbl, values: perDay.map(d => Math.round(d[k])), height: 170,
    ref: l ? { value: l.val, label: `${l.mode} ${fmtG(l.val)}` } : null, tip: tip(k, unit),
    table: { head: ['Day', unit, 'Meals'], rows: perDay.map(d => [shortDate(dayOf(d.ds), true), Math.round(d[k]), d.n]) } }));
  chart('chDietK', 'kcal', 'kcal', lim.kcal);
  chart('chDietP', 'p', 'g protein', lim.p);
  drawAll();
}

/* ------------------------------- events ------------------------------- */
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act^="dp-"],[data-act^="df-"],[data-act^="di-"]'); if (!t || t.disabled) return;
  const i = Number(t.dataset.i), k = Number(t.dataset.k), Dr = DPT.draft, P = Dr?.plan;
  switch (t.dataset.act) {
    case 'dp-view':
      if (t.dataset.v === 'workout') renderPlan(); else if (t.dataset.v === 'diet') renderDietPlanner(); else renderFoods();
      window.scrollTo({ top: 0 }); break;
    case 'di-view': if (t.dataset.v === 'diet') renderDietInsights(); else renderInsights(); window.scrollTo({ top: 0 }); break;
    case 'df-group': DPT.fg = t.dataset.g; renderFoods(); break;
    case 'df-edit': { const f = dietModel().foods.byName.get(norm(t.dataset.name)); openModal(foodFormHTML(f)); foodCheck(); break; }
    case 'df-save': saveFood(t.dataset.orig); break;
    case 'df-del': deleteFood(t.dataset.name); break;
    case 'dp-new': DPT.draft = { mode: 'new', plan: newDraft() }; DPT.draft.plan.meals.push({ name: 'Breakfast', limits: blankLimits(), planned: [], allowed: [] }); DPT.openMeal = 0; saveDietDraft(); renderDietEditor(); break;
    case 'dp-newask': openModal(`<h3>New diet plan</h3><p class="muted">Start from a copy of “${esc(dietModel().plan.name)}” or from scratch. Nothing changes until you create it; you'll be asked to confirm, because creating it deletes the current plan's logged meals.</p>
      <div style="display:grid;gap:10px"><button class="btn block" data-act="dp-new-copy">Copy of the current plan</button><button class="btn ghost block" data-act="dp-new">Empty plan</button><button class="btn ghost block" data-act="close">Cancel</button></div>`); break;
    case 'dp-new-copy': closeModal(); DPT.draft = { mode: 'new', plan: newDraft({ ...dietModel().plan, name: '', start: '' }) }; DPT.openMeal = 0; saveDietDraft(); renderDietEditor(); window.scrollTo({ top: 0 }); break;
    case 'dp-discard': store.del(dietDraftKey()); DPT.draft = null; DPT.resumed = false; renderDietPlanner(); break;
    case 'dp-import': $('#dpFile')?.click(); break;
    case 'dp-export': exportDiet(); break;
    case 'dp-save': closeModal(); askSaveDiet(); break;
    case 'dp-save-go': closeModal(); saveDiet(); break;
    case 'dp-supp-rm': P.supps.splice(i, 1); saveDietDraft(); renderDietEditor(); break;
    case 'dp-supp-add': openModal(`<h3>Add a supplement</h3><label class="d-lbl" for="dsN">Name</label><input class="d-inp" id="dsN" placeholder="e.g. Creatine" autocomplete="off">
      <div class="d-row2"><div><label class="d-lbl" for="dsA">Amount</label><input class="d-inp" id="dsA" placeholder="e.g. 5 g"></div><div><label class="d-lbl" for="dsW">When</label><input class="d-inp" id="dsW" placeholder="e.g. daily"></div></div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" style="flex:1" data-act="dp-supp-go">Add</button><button class="btn ghost" data-act="close">Cancel</button></div>`); $('#dsN').focus(); break;
    case 'dp-supp-go': { const n = str($('#dsN').value); if (!n) break; P.supps.push({ name: n, amount: str($('#dsA').value), when: str($('#dsW').value) }); closeModal(); saveDietDraft(); renderDietEditor(); break; }
    case 'dp-meal-add': P.meals.push({ name: '', limits: blankLimits(), planned: [], allowed: [] }); DPT.openMeal = P.meals.length - 1; saveDietDraft(); renderDietEditor(); break;
    case 'dp-meal-open': DPT.openMeal = i; renderDietEditor(); document.querySelectorAll('.dp')[i + 1]?.scrollIntoView({ block: 'start' }); break;
    case 'dp-meal-move': { const j = i + Number(t.dataset.d); [P.meals[i], P.meals[j]] = [P.meals[j], P.meals[i]]; DPT.openMeal = j; saveDietDraft(); renderDietEditor(); break; }
    case 'dp-meal-rm': if (P.meals[i].planned.length && !confirmOnce(t, 'Tap again to delete')) break; P.meals.splice(i, 1); DPT.openMeal = -1; saveDietDraft(); renderDietEditor(); break;
    case 'dp-it-rm': P.meals[i].planned.splice(k, 1); saveDietDraft(); renderDietEditor(); break;
    case 'dp-al-rm': P.meals[i].allowed.splice(k, 1); saveDietDraft(); renderDietEditor(); break;
    case 'dp-it-add': showDietPicker('it', i); break;
    case 'dp-al-add': showDietPicker('al', i); break;
    case 'dp-pick': {
      const m = P.meals[i];
      if (t.dataset.kind === 'al') m.allowed.push(t.dataset.v);
      else { const f = dietModel().foods.byName.get(norm(t.dataset.v)); if (f) m.planned.push({ food: f.name, ...defaultAmount(f) }); }
      closeModal(); saveDietDraft(); renderDietEditor(); break;
    }
  }
});
// "Tap again" guard for destructive taps, without a dialog
function confirmOnce(el, label) {
  if (el.dataset.armed) return true;
  el.dataset.armed = '1'; const old = el.innerHTML; el.innerHTML = '?'; el.title = label; toast(label);
  setTimeout(() => { if (el.isConnected) { el.dataset.armed = ''; el.innerHTML = old; } }, 3000);
  return false;
}
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset?.ff !== undefined || ['ffK', 'ffP', 'ffC', 'ffF'].includes(t.id)) return foodCheck();
  const f = t.dataset?.dpf; if (!f || !DPT.draft) return;
  const P = DPT.draft.plan, i = Number(t.dataset.i), k = Number(t.dataset.k);
  if (f === 'name') P.name = t.value;
  else if (f === 'cheat-n') P.cheat.n = Math.max(0, parseInt(t.value) || 0);
  else if (f === 'cheat-w') P.cheat.weeks = Math.max(1, parseInt(t.value) || 1);
  else if (f === 'water') P.water = Math.max(0, parseInt(t.value) || 0);
  else if (f.startsWith('daily-')) readDraftLimits('daily', P.daily, '');
  else if (f.startsWith('meal-') && f !== 'meal-name') readDraftLimits('meal', P.meals[i].limits, i);
  else if (f === 'meal-name') P.meals[i].name = t.value;
  else if (f === 'it-amt') P.meals[i].planned[k].amount = t.value.replace(',', '.');
  else if (f === 'it-unit') { P.meals[i].planned[k].unit = t.value; saveDietDraft(); return renderDietEditor(); }
  saveDietDraft();
  if (f === 'it-amt' || f.startsWith('meal-')) {
    const D = dietModel(), m = P.meals[i];
    if (f === 'it-amt') { const el = document.getElementById(`dpIt-${i}-${k}`); if (el) el.innerHTML = macroLine(nutrition(m.planned[k], D.foods)); }
    const tot = document.getElementById(`dpTot-${i}`); if (tot) tot.innerHTML = totalsHTML(sumNutrition(m.planned, D.foods), m.limits, 'Planned total: ');
  }
});
document.addEventListener('change', ev => { if (ev.target.id === 'dpFile' && ev.target.files[0]) { importDiet(ev.target.files[0]); ev.target.value = ''; } });
