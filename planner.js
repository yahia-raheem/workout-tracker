'use strict';
/* =====================================================================
   Workout Log · Plan editor (PT mode only)
   Edit the current plan or create a new one, then write it to the Plan tab.
   Loaded on demand once PT mode is unlocked; never loaded for trainees.
   Uses globals from index.html (state, $, esc, norm, q, colLetter, store,
   toast, openModal, closeModal, setChrome, tabsHTML, tokenValid, requestToken,
   AuthError, renderSignin, fetchModel, entriesForDay, draftKey, libVideo, DEMO).
   ===================================================================== */

// The plan being edited. mode: null (not editing) | 'edit' | 'create'
const PL = { mode: null, name: '', cardio: '', days: [], dayIdx: 0, archive: true, orig: null, converted: 0, saving: false, source: null, archived: [], fileData: null };
let plSeq = 0;
const pid = () => `p${Date.now().toString(36)}${(plSeq++).toString(36)}`;
const planDraftKey = () => `wl:planDraft:${state.sheet?.id}`;

/* ----------------------------- helpers ----------------------------- */
// Rest is kept in seconds. Old sheets used small numbers for minutes (1 = 1 min).
function restToSec(r) {
  const t = String(r ?? '').trim(); if (!t) return '';
  const n = Number(t); if (!Number.isFinite(n)) return t;
  return n > 0 && n <= 5 ? n * 60 : n;
}
const numOr = v => { const t = String(v ?? '').trim(); if (t === '') return ''; const n = Number(t); return Number.isFinite(n) ? n : t; };
const isInt = v => /^\d+$/.test(String(v ?? '').trim());
const clone = o => JSON.parse(JSON.stringify(o));
const curDay = () => PL.days[PL.dayIdx] || PL.days[0];

function planFromModel() {
  const m = state.model; let converted = 0;
  const days = m.days.map(d => ({ id: pid(), name: d, items: m.plan.filter(p => p.day === d).map(p => {
    const rest = restToSec(p.rest);
    if (String(rest) !== String(p.rest).trim() && p.rest !== '') converted++;
    return { id: pid(), ex: p.exercise, cat: p.category, sets: p.sets, reps: p.reps, rest, notes: p.notes || '', video: p.video || libVideo(p.exercise) };
  }) }));
  return { name: m.planName.trim(), cardio: m.cardioTarget ? String(m.cardioTarget) : '', days, converted };
}
function saveDraftPlan() {
  clearTimeout(saveDraftPlan.t);
  saveDraftPlan.t = setTimeout(() => {
    if (!PL.mode) return store.del(planDraftKey());
    store.set(planDraftKey(), { mode: PL.mode, name: PL.name, cardio: PL.cardio, days: PL.days, dayIdx: PL.dayIdx, archive: PL.archive, orig: PL.orig, converted: PL.converted, source: PL.source, at: Date.now() });
  }, 300);
}
function startEditing(mode, { from = 'copy', name = '', archive = true, archived = null } = {}) {
  const cur = planFromModel();
  PL.mode = mode; PL.archive = archive; PL.dayIdx = 0; PL.converted = cur.converted; PL.source = null;
  PL.orig = clone({ name: cur.name, cardio: cur.cardio, days: cur.days });   // same ids, so changes can be listed
  PL.cardio = from === 'empty' ? '' : cur.cardio;
  if (mode === 'edit') { PL.name = cur.name; PL.days = cur.days; }
  else if (from === 'file' && PL.fileData) {
    PL.name = name; PL.days = planFromFile(PL.fileData); PL.converted = 0; PL.cardio = PL.fileData.cardio || '';
    PL.source = { name: PL.fileData.name, file: true };
  }
  else if (from === 'archive' && archived) {
    const a = planFromArchive(archived);
    PL.name = name; PL.days = a.days; PL.converted = a.converted; PL.cardio = archived.cardio || '';
    PL.source = { name: archived.name, when: archived.when };
  }
  else { PL.name = name; PL.days = from === 'copy' ? clone(cur.days) : [{ id: pid(), name: 'Day 1', items: [] }]; }
  saveDraftPlan(); renderPlanEditor(); window.scrollTo({ top: 0 });
}
function stopEditing() {
  Object.assign(PL, { mode: null, name: '', cardio: '', days: [], dayIdx: 0, orig: null, converted: 0, source: null });
  store.del(planDraftKey());
}

/* ----------------------------- changes & checks ----------------------------- */
const FIELD = { sets: 'sets', reps: 'reps', rest: 'rest' };
function planChanges() {
  const o = PL.orig, out = [];
  if (PL.mode === 'create') return out;
  if (norm(o.name) !== norm(PL.name)) out.push({ t: '~', text: `Plan name: “${o.name}” → “${PL.name}”` });
  if (str(o.cardio) !== str(PL.cardio)) out.push({ t: '~', text: `Weekly cardio target: ${str(o.cardio) ? o.cardio + ' min' : 'none'} → ${str(PL.cardio) ? PL.cardio + ' min' : 'none'}` });
  const oDays = new Map(o.days.map(d => [d.id, d]));
  PL.days.forEach(d => {
    const od = oDays.get(d.id);
    if (!od) { out.push({ t: '+', text: `Day “${d.name}” added (${d.items.length} exercise${d.items.length === 1 ? '' : 's'})` }); return; }
    if (od.name !== d.name) out.push({ t: '~', text: `Day “${od.name}” renamed to “${d.name}”` });
    const oi = new Map(od.items.map(x => [x.id, x]));
    d.items.forEach(x => {
      const ox = oi.get(x.id);
      if (!ox) { out.push({ t: '+', day: d.name, text: `${x.ex} added (${x.sets || '?'} × ${x.reps || '?'}${x.rest !== '' ? `, rest ${x.rest} s` : ''})` }); return; }
      const ch = [];
      if (norm(ox.ex) !== norm(x.ex)) ch.push(`now ${x.ex}`);
      for (const k of Object.keys(FIELD)) if (String(ox[k]).trim() !== String(x[k]).trim()) ch.push(`${FIELD[k]} ${String(ox[k]).trim() || '–'} → ${String(x[k]).trim() || '–'}`);
      if ((ox.notes || '').trim() !== (x.notes || '').trim()) ch.push('comment changed');
      if (ch.length) out.push({ t: '~', day: d.name, text: `${ox.ex}: ${ch.join(', ')}` });
    });
    od.items.forEach(ox => { if (!d.items.some(x => x.id === ox.id)) out.push({ t: '−', day: d.name, text: `${ox.ex} removed` }); });
    const kept = od.items.filter(ox => d.items.some(x => x.id === ox.id)).map(x => x.id).join();
    const now = d.items.filter(x => oi.has(x.id)).map(x => x.id).join();
    if (kept !== now) out.push({ t: '~', day: d.name, text: 'exercise order changed' });
  });
  o.days.forEach(od => { if (!PL.days.some(d => d.id === od.id)) out.push({ t: '−', text: `Day “${od.name}” removed (${od.items.length} exercises)` }); });
  const kept = o.days.filter(od => PL.days.some(d => d.id === od.id)).map(d => d.id).join();
  const now = PL.days.filter(d => oDays.has(d.id)).map(d => d.id).join();
  if (kept !== now) out.push({ t: '~', text: 'Day order changed' });
  return out;
}
function itemChanged(dayId, x) {
  if (PL.mode !== 'edit') return false;
  const od = PL.orig.days.find(d => d.id === dayId); const ox = od && od.items.find(i => i.id === x.id);
  if (!ox) return true;
  return norm(ox.ex) !== norm(x.ex) || ['sets', 'reps', 'rest'].some(k => String(ox[k]).trim() !== String(x[k]).trim()) || (ox.notes || '').trim() !== (x.notes || '').trim();
}
function planProblems() {
  const errors = [], warns = [];
  const name = PL.name.trim();
  if (!name) errors.push('The plan needs a name.');
  if (PL.mode === 'create' && name && norm(name) === norm(state.model.planName)) errors.push('Choose a new name: this is the current plan\'s name. (To change the current plan, use “Edit this plan”.)');
  if (!PL.days.length) errors.push('The plan needs at least one day.');
  const seen = new Set();
  PL.days.forEach(d => {
    const dn = d.name.trim();
    if (!dn) errors.push('A day has no name.');
    else if (seen.has(norm(dn))) errors.push(`Two days are called “${dn}”.`); else seen.add(norm(dn));
    if (!d.items.length) errors.push(`“${dn || 'A day'}” has no exercises. Add one or delete the day.`);
    d.items.forEach(x => {
      const where = `${dn} · ${x.ex}`;
      if (!isInt(x.sets) || +x.sets < 1 || +x.sets > 20) errors.push(`${where}: sets must be a whole number from 1 to 20.`);
      if (String(x.reps).trim() === '') warns.push(`${where}: no target reps.`);
      else if (!Number.isFinite(Number(x.reps))) warns.push(`${where}: target reps “${x.reps}” isn't a number.`);
      if (String(x.rest).trim() !== '' && !Number.isFinite(Number(x.rest))) errors.push(`${where}: rest must be a number of seconds.`);
      if (!state.model.libByName.has(norm(x.ex))) warns.push(`${where}: not in the Settings tab any more (it will still be saved).`);
    });
  });
  return { errors, warns };
}

/* ----------------------------- screens ----------------------------- */
function renderPlan() {
  if (!PL.mode) {                                            // resume an unsaved edit kept on this device
    const d = store.get(planDraftKey());
    if (d && d.mode) { Object.assign(PL, d); PL.resumed = true; }
  }
  PL.mode ? renderPlanEditor() : renderPlanHome();
}

function renderPlanHome() {
  setChrome({ menu: true });
  const m = state.model;
  $('#app').innerHTML = `${tabsHTML('plan')}${typeof planSegHTML === 'function' ? planSegHTML('workout') : ''}
    <section class="panel" style="margin-top:0">
      <div class="eyebrow">Current plan</div>
      <h2>${esc(m.planName.trim() || 'Unnamed plan')}</h2>
      <p class="muted small">${m.days.length} day${m.days.length === 1 ? '' : 's'} · ${m.plan.length} exercises · in “${esc(state.sheet.name)}”</p>
      <div class="pl-days">${m.days.map(d => { const n = m.plan.filter(p => p.day === d).length; return `<div><b>${esc(d)}</b><span class="muted small">${n} exercise${n === 1 ? '' : 's'}</span></div>`; }).join('')}</div>
      <div style="display:grid;gap:10px;margin-top:14px">
        <button class="btn block" data-act="pl-edit">Edit this plan</button>
        <button class="btn ghost block" data-act="pl-new">Create a new plan</button>
        <button class="text-btn" data-act="pl-export" style="justify-self:center">⤓ Export this plan as a file</button>
      </div>
    </section>
    <p class="small muted" style="line-height:1.5"><b style="color:var(--text)">Edit</b> keeps the plan name, so its history stays together.<br>
    <b style="color:var(--text)">Create</b> starts a new plan name; past workouts stay under the old one.</p>`;
}

function renderPlanCreate() {
  setChrome({ menu: true });
  $('#app').innerHTML = `${tabsHTML('plan')}
    <section class="panel">
      <button class="text-btn" data-act="pl-home" style="padding-left:0">← Plan</button>
      <h2>Create a new plan</h2>
      <div class="field"><label for="plNewName">Plan name</label><input id="plNewName" autocomplete="off" placeholder="e.g. Strength block · Dec"></div>
      <p class="small muted" id="plNameNote" style="margin-top:-4px">${defaultNameNote()}</p>
      <fieldset class="pl-choices">
        <legend>Start from</legend>
        <label><input type="radio" name="plFrom" value="copy" checked><span><b>A copy of the current plan</b><br><span class="muted small">Same days and exercises, ready to change.</span></span></label>
        <label><input type="radio" name="plFrom" value="empty"><span><b>An empty plan</b><br><span class="muted small">Start with one day and add everything yourself.</span></span></label>
        <label id="plFromArcRow"><input type="radio" name="plFrom" value="archive" id="plFromArc" disabled><span style="flex:1;min-width:0"><b>A plan from the archive</b><br>
          <span class="muted small" id="plArcMsg">Looking for archived plans…</span>
          <select id="plArcPick" hidden style="display:block;width:100%;margin-top:8px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px;color:var(--text);font-size:15px"></select></span></label>
        <label><input type="radio" name="plFrom" value="file"><span style="flex:1;min-width:0"><b>A plan file</b><br>
          <span class="muted small" id="plFileMsg">A .json file exported from Workout Log, e.g. from another trainee's sheet.</span>
          <input type="file" id="plFile" accept=".json,application/json" hidden style="display:block;margin-top:8px;font-size:14px;max-width:100%"></span></label>
      </fieldset>
      <label class="pl-check"><input type="checkbox" id="plArchive" checked><span><b>Keep a copy of the current plan</b><br><span class="muted small">Saved to a “Plan Archive” tab in the sheet (created if needed) before it's replaced.</span></span></label>
      <div class="small err-text" id="plNewErr" style="min-height:18px;margin:8px 0"></div>
      <button class="btn block" data-act="pl-create-go">Continue to editor</button>
      <p class="small muted center">Nothing changes in the sheet until you tap Save plan.</p>
    </section>`;
  $('#plNewName').focus();
  loadArchivedPlans().then(fillArchiveChoice);
}
const defaultNameNote = () => `Must be different from “${esc(state.model.planName.trim())}”, so past workouts stay under that name.`;

/* ----------------------------- plan files ----------------------------- */
// A plan file is plain JSON, so the PT can move a plan between trainees' sheets.
function planToFile() {
  const m = state.model;
  return { app: 'workout-log', kind: 'plan', version: 1, exportedAt: new Date().toISOString(), name: m.planName.trim(),
    cardioMinPerWeek: m.cardioTarget || null,
    days: m.days.map(d => ({ name: d, exercises: m.plan.filter(p => p.day === d).map(p => ({
      exercise: p.exercise, category: p.category, sets: numOr(p.sets), reps: numOr(p.reps), restSec: numOr(restToSec(p.rest)),
      comment: p.notes || '', video: p.video || libVideo(p.exercise) || '' })) })) };
}
async function exportPlan() {
  const data = planToFile();
  await shareJSON(data, `${fileSlug(data.name, 'plan')}.workout-plan.json`, data.name);
}
async function readPlanFile(f) {
  const msg = $('#plFileMsg'); PL.fileData = null;
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const days = Array.isArray(data.days) ? data.days.filter(d => d && Array.isArray(d.exercises)) : [];
    if (data.kind !== 'plan' || !days.length) throw new Error('not a plan');
    PL.fileData = { name: String(data.name || '').trim(), cardio: Number(data.cardioMinPerWeek) > 0 ? String(data.cardioMinPerWeek) : '', days };
    const n = days.reduce((t, d) => t + d.exercises.length, 0);
    msg.innerHTML = `<b style="color:var(--text)">${esc(f.name)}</b>: ${days.length} day${days.length === 1 ? '' : 's'}, ${n} exercise${n === 1 ? '' : 's'}.`;
    useFileName();
  } catch {
    msg.innerHTML = `<span class="err-text">“${esc(f.name)}” isn't a Workout Log plan file.</span>`;
  }
}
function useFileName() {
  if (!PL.fileData) return;
  if (PL.fileData.name) $('#plNewName').value = PL.fileData.name;
  $('#plNameNote').innerHTML = `Name taken from the file. Keep it, or change it if this sheet already uses that name for a different plan.`;
  $('#plNewErr').textContent = '';
}
function planFromFile(data) {
  return data.days.map(d => ({ id: pid(), name: String(d.name || 'Day').trim(), items: d.exercises.filter(x => x && x.exercise).map(x => {
    const lib = state.model.libByName.get(norm(x.exercise));
    return { id: pid(), ex: String(x.exercise).trim(), cat: String(x.category || lib?.category || '').trim(),
      sets: String(x.sets ?? ''), reps: String(x.reps ?? ''), rest: String(x.restSec ?? ''), notes: String(x.comment || ''), video: String(x.video || lib?.video || '') };
  }) }));
}

/* ----------------------------- archived plans ----------------------------- */
// The Plan Archive tab holds one block of rows per archived plan: same Plan Name + Archived on.
async function loadArchivedPlans() {
  try {
    const meta = await state.ds.meta(state.sheet.id);
    const tab = meta.sheets.find(s => norm(s.title) === 'plan archive');
    if (!tab) return [];
    const [rows] = await state.ds.batchGet(state.sheet.id, [`${q(tab.title)}!A1:Z`]);
    const head = (rows[0] || []).map(norm);
    const col = re => head.findIndex(h => re.test(h));
    const C = { when: col(/^archived/), plan: col(/^plan( name)?$/), day: col(/^day$/), cat: col(/^category$/), ex: col(/^exercise$/),
      sets: col(/sets?$/), reps: col(/^target reps?$/), rest: col(/^rest/), notes: col(/^notes?$/), video: col(/video/), cardio: col(/^weekly cardio/) };
    if (C.plan < 0 || C.day < 0 || C.ex < 0) return [];
    const get = (r, k) => C[k] >= 0 ? String(r[C[k]] ?? '').trim() : '';
    const groups = []; let lastKey = null;
    rows.slice(1).forEach(r => {
      if (!get(r, 'ex')) return;
      const key = `${get(r, 'plan')}|${get(r, 'when')}`;
      if (key !== lastKey) { groups.push({ name: get(r, 'plan'), when: get(r, 'when'), cardio: get(r, 'cardio'), rows: [] }); lastKey = key; }
      groups[groups.length - 1].rows.push({ day: get(r, 'day'), cat: get(r, 'cat'), ex: get(r, 'ex'), sets: get(r, 'sets'), reps: get(r, 'reps'), rest: get(r, 'rest'), notes: get(r, 'notes'), video: get(r, 'video') });
    });
    PL.archived = groups.reverse();                                  // newest first
    return PL.archived;
  } catch { PL.archived = []; return []; }
}
const fmtArchived = w => { const d = typeof toDay === 'function' ? toDay(w) : null; return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : w; };
function fillArchiveChoice(list) {
  const radio = $('#plFromArc'), msg = $('#plArcMsg'), pick = $('#plArcPick');
  if (!radio) return;                                                // left the screen meanwhile
  if (!list.length) { msg.textContent = 'No archived plans in this sheet yet.'; $('#plFromArcRow').style.opacity = '.55'; return; }
  radio.disabled = false;
  msg.textContent = `${list.length} archived plan${list.length === 1 ? '' : 's'}. Opens with its days, exercises and settings.`;
  pick.innerHTML = list.map((a, i) => {
    const days = [...new Set(a.rows.map(r => r.day))].length;
    return `<option value="${i}">${esc(a.name || 'Unnamed plan')} · archived ${esc(fmtArchived(a.when))} · ${days} day${days === 1 ? '' : 's'}</option>`;
  }).join('');
}
function useArchivedName() {
  const a = PL.archived?.[Number($('#plArcPick').value)]; if (!a) return;
  $('#plNewName').value = a.name;
  $('#plNameNote').innerHTML = `This is the archived plan's name. Keep it to carry on that plan's history in Insights, or change it to start a separate history.`;
  $('#plNewErr').textContent = '';
}
function planFromArchive(a) {
  let converted = 0; const days = [];
  a.rows.forEach(r => {
    let d = days.find(x => x.name === r.day);
    if (!d) { d = { id: pid(), name: r.day, items: [] }; days.push(d); }
    const rest = restToSec(r.rest);
    if (r.rest !== '' && String(rest) !== r.rest) converted++;
    const lib = state.model.libByName.get(norm(r.ex));
    d.items.push({ id: pid(), ex: r.ex, cat: r.cat || lib?.category || '', sets: r.sets, reps: r.reps, rest, notes: r.notes, video: r.video || lib?.video || '' });
  });
  return { days, converted };
}

function renderPlanEditor() {
  setChrome({ menu: true });
  if (PL.dayIdx >= PL.days.length) PL.dayIdx = Math.max(0, PL.days.length - 1);
  const d = curDay();
  const y = window.scrollY;
  $('#app').innerHTML = `${tabsHTML('plan')}
    <div class="pl-top"><button class="text-btn" data-act="pl-cancel" style="padding-left:0">Cancel</button><b>${PL.mode === 'edit' ? 'Edit plan' : 'New plan'}</b><span style="width:52px"></span></div>
    ${PL.resumed ? `<div class="banner"><span>Your unsaved plan changes were kept on this device.</span><button class="text-btn" data-act="pl-cancel">Discard</button></div>` : ''}
    <div class="field"><label for="plName">Plan name</label><input id="plName" data-pf="name" value="${esc(PL.name)}" autocomplete="off"></div>
    <div class="field"><label for="plCardio">Weekly cardio target</label>
      <div style="display:flex;align-items:center;gap:8px"><input id="plCardio" data-pf="cardio" value="${esc(PL.cardio || '')}" inputmode="numeric" placeholder="none" style="width:110px;text-align:center"><span class="muted">minutes per week</span></div>
      <p class="small muted" style="margin:6px 0 0">Leave empty for no target. Counts minutes from every exercise in the cardio category, in plan days and “Other” sessions. Weeks run Saturday to Friday.</p></div>
    ${PL.converted ? `<p class="small muted">${PL.converted} rest time${PL.converted === 1 ? ' was' : 's were'} in minutes in the sheet and ${PL.converted === 1 ? 'is' : 'are'} shown here in seconds (1 → 60).</p>` : ''}
    <div class="eyebrow" style="margin-top:6px">Days, in rotation order</div>
    <div class="days">${PL.days.map((x, i) => `<button class="day ${i === PL.dayIdx ? 'active' : ''}" data-act="pl-day" data-i="${i}">${esc(x.name || 'Unnamed')}</button>`).join('')}<button class="day pl-add-day" data-act="pl-day-add">+ Day</button></div>
    ${d ? `<div class="pl-daybar">
      <button class="text-btn" data-act="pl-day-rename">Rename</button>
      <button class="text-btn" data-act="pl-day-left" ${PL.dayIdx === 0 ? 'disabled' : ''} aria-label="Move day earlier">← Move</button>
      <button class="text-btn" data-act="pl-day-right" ${PL.dayIdx >= PL.days.length - 1 ? 'disabled' : ''} aria-label="Move day later">Move →</button>
      <span style="flex:1"></span>
      <button class="text-btn danger" data-act="pl-day-del">Delete day</button>
    </div>
    <div id="plCards">${d.items.map((x, i) => planCardHTML(d, x, i)).join('') || `<p class="muted center" style="padding:18px 0">No exercises on ${esc(d.name)} yet.</p>`}</div>
    <button class="add-ex" data-act="pl-add">+ Add exercise to ${esc(d.name || 'this day')}</button>` : `<p class="muted">Add a day to start.</p>`}
    <div class="savebar" id="planBar"><div class="inner"><div class="count" id="plCount"></div><button class="btn" data-act="pl-review">Save plan</button></div></div>`;
  updatePlanBar();
  window.scrollTo({ top: y });
}
function planCardHTML(d, x, i) {
  const a = `data-i="${i}"`;
  return `<section class="card pl-card ${itemChanged(d.id, x) ? 'has' : ''}">
    <div class="card-head">
      <div class="pl-move"><button class="icon-btn small" data-act="pl-up" ${a} ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(x.ex)} up">↑</button><button class="icon-btn small" data-act="pl-down" ${a} ${i === d.items.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(x.ex)} down">↓</button></div>
      <div class="titles">
        <span class="chip">${esc(x.cat || '—')}</span>${itemChanged(d.id, x) ? `<span class="chip adhoc">${PL.orig.days.find(o => o.id === d.id)?.items.some(o => o.id === x.id) ? 'Changed' : 'New'}</span>` : ''}
        <h3>${esc(x.ex)}</h3>
        <button class="text-btn" data-act="pl-change" ${a} style="padding:2px 0;font-size:13px">Change exercise</button>
      </div>
      <button class="icon-btn small pl-del" data-act="pl-del" ${a} aria-label="Remove ${esc(x.ex)}">✕</button>
    </div>
    <div class="pl-grid">
      <label>Sets<input data-pf="sets" ${a} value="${esc(x.sets)}" inputmode="numeric"></label>
      <label>Reps<input data-pf="reps" ${a} value="${esc(x.reps)}" inputmode="numeric"></label>
      <label>Rest (sec)<input data-pf="rest" ${a} value="${esc(x.rest)}" inputmode="numeric"></label>
    </div>
    <label class="pl-note">Comment<input data-pf="notes" ${a} value="${esc(x.notes)}" dir="auto" placeholder="Optional cue for the trainee"></label>
  </section>`;
}
function updatePlanBar() {
  const el = document.getElementById('plCount'); if (!el) return;
  const n = PL.days.reduce((t, d) => t + d.items.length, 0);
  const ch = planChanges().length;
  el.innerHTML = PL.mode === 'edit'
    ? (ch ? `<b>${ch} change${ch === 1 ? '' : 's'}</b> · not saved yet` : 'No changes yet')
    : `<b>${PL.days.length} day${PL.days.length === 1 ? '' : 's'}</b> · ${n} exercise${n === 1 ? '' : 's'} · not saved yet`;
}

/* ----------------------------- modals ----------------------------- */
function showDayName(rename) {
  const d = curDay();
  openModal(`<h3 style="text-transform:none">${rename ? 'Rename day' : 'Add a day'}</h3>
    <div class="field"><label for="plDayName">Day name</label><input id="plDayName" value="${rename ? esc(d.name) : ''}" placeholder="e.g. upper C" autocomplete="off"></div>
    <div class="small err-text" id="plDayErr" style="min-height:18px"></div>
    <div class="row"><button class="btn" data-act="pl-day-ok" data-rename="${rename ? 1 : ''}">${rename ? 'Rename' : 'Add day'}</button><button class="btn ghost" data-act="close">Cancel</button></div>`);
  $('#plDayName').focus();
}
function showExercisePicker(i) {
  const lib = state.model.library, d = curDay();
  const x = i == null ? null : d.items[i];
  const cats = state.model.categories;
  const cur = x ? lib.find(l => norm(l.exercise) === norm(x.ex)) : null;
  openModal(`<h3 style="text-transform:none">${x ? 'Change exercise' : `Add exercise to ${esc(d.name)}`}</h3>
    <div class="two">
      <div class="field"><label for="plCat">Category</label><select id="plCat">${cats.map(c => `<option ${cur && norm(cur.category) === norm(c) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="plEx">Exercise</label><select id="plEx"></select></div>
    </div>
    <p class="small muted" id="plVid" style="margin:-4px 0 6px"></p>
    <div class="pl-grid">
      <label>Sets<input id="plSets" value="${esc(x ? x.sets : 3)}" inputmode="numeric"></label>
      <label>Reps<input id="plReps" value="${esc(x ? x.reps : 10)}" inputmode="numeric"></label>
      <label>Rest (sec)<input id="plRest" value="${esc(x ? x.rest : 90)}" inputmode="numeric"></label>
    </div>
    <label class="pl-note">Comment (optional)<input id="plNotes" value="${esc(x ? x.notes : '')}" dir="auto" placeholder="e.g. pause 1 second at the top"></label>
    <div class="row" style="margin-top:14px"><button class="btn" data-act="pl-pick-ok" data-i="${x ? i : ''}">${x ? 'Update' : 'Add'}</button><button class="btn ghost" data-act="close">Cancel</button></div>
    <p class="small muted" style="margin-bottom:0">Exercises come from the Settings tab, so names stay consistent with the history.</p>`);
  const fill = () => {
    const c = norm($('#plCat').value);
    $('#plEx').innerHTML = lib.map((it, idx) => ({ it, idx })).filter(o => norm(o.it.category) === c)
      .sort((a, b) => a.it.exercise.localeCompare(b.it.exercise))
      .map(o => `<option value="${o.idx}" ${cur && o.it === cur ? 'selected' : ''}>${esc(o.it.exercise)}</option>`).join('');
    vid();
  };
  const vid = () => { const it = lib[Number($('#plEx').value)]; $('#plVid').textContent = it ? (it.video ? '▶ Video link found in the Settings tab' : 'No video link for this exercise in the Settings tab') : ''; };
  $('#plCat').addEventListener('change', fill); $('#plEx').addEventListener('change', vid); fill();
}
function showPlanReview() {
  const { errors, warns } = planProblems();
  const ch = planChanges();
  const n = PL.days.reduce((t, d) => t + d.items.length, 0);
  const expired = !DEMO && !tokenValid();
  const sym = { '+': ['+', 'pl-add'], '−': ['−', 'pl-rem'], '~': ['~', 'pl-mod'] };
  openModal(`<h3 style="text-transform:none">Save “${esc(PL.name.trim() || 'Unnamed plan')}”?</h3>
    <p class="small muted" style="margin-top:-6px">This replaces the Plan tab in “${esc(state.sheet.name)}”. Past workouts in Historical Data are not changed.</p>
    ${PL.mode === 'create'
      ? `<p>New plan with <b>${PL.days.length} day${PL.days.length === 1 ? '' : 's'}</b> and <b>${n} exercise${n === 1 ? '' : 's'}</b>: ${PL.days.map(d => esc(d.name)).join(', ')}.</p>
         ${PL.source ? `<p class="small muted">${PL.source.file ? `Loaded from a plan file: “${esc(PL.source.name)}”.` : `Loaded from the archive: “${esc(PL.source.name)}” (archived ${esc(fmtArchived(PL.source.when))}).`}</p>` : ''}
         <p class="small muted">${PL.archive ? `The current plan “${esc(state.model.planName.trim())}” will be copied to the “Plan Archive” tab first.` : 'The current plan will not be kept anywhere else.'}</p>`
      : `<div class="eyebrow">Changes</div>
         <ul class="summary">${ch.map(c => `<li style="justify-content:flex-start;gap:10px"><b class="${sym[c.t][1]}" style="width:14px">${sym[c.t][0]}</b><span>${c.day ? `<b>${esc(c.day)}</b> · ` : ''}${esc(c.text)}</span></li>`).join('') || '<li><span class="muted">No changes.</span></li>'}</ul>`}
    ${PL.converted ? `<p class="small muted">Rest times will be saved in seconds (${PL.converted} converted from minutes).</p>` : ''}
    ${errors.map(e => `<div class="banner err"><span>${esc(e)}</span></div>`).join('')}
    ${warns.map(w => `<div class="banner"><span>${esc(w)}</span></div>`).join('')}
    ${expired && !errors.length ? `<div class="banner err">Your Google sign-in has expired. Tap “Sign in &amp; save”; your changes are kept.</div>` : ''}
    <div class="row" style="margin-top:12px">
      <button class="btn" data-act="pl-save" ${errors.length || (PL.mode === 'edit' && !ch.length && !PL.converted) ? 'disabled' : ''}>${expired ? 'Sign in &amp; save' : 'Save plan'}</button>
      <button class="btn ghost" data-act="close">Keep editing</button>
    </div>`);
}

/* ----------------------------- saving ----------------------------- */
async function writePlan() {
  const id = state.sheet.id, m = state.model, PM = m.planMeta;
  const meta = await state.ds.meta(id);
  const tab = meta.sheets.find(s => s.sheetId === PM.sheetId) || meta.sheets.find(s => norm(s.title) === norm(PM.title));
  if (!tab) throw new Error('The Plan tab was not found.');
  const [fresh] = await state.ds.batchGet(id, [`${q(tab.title)}!A1:Z`]);
  if (PL.mode === 'create' && PL.archive) await archiveCurrentPlan(meta);

  const cols = Object.values(PM.map), minCol = Math.min(...cols), maxCol = Math.max(...cols);
  const rows = [];
  PL.days.forEach(d => d.items.forEach(x => rows.push({ day: d.name.trim(), category: x.cat, exercise: x.ex, sets: numOr(x.sets), reps: numOr(x.reps), rest: numOr(x.rest), notes: (x.notes || '').trim(), video: x.video || '' })));
  const start = PM.headerRow + 2;                                   // first data row, 1-based
  const end = Math.max(start + rows.length - 1, fresh.length);      // also blank out old rows below
  if (end > tab.rowCount) await state.ds.addRows(id, tab.sheetId, end - tab.rowCount + 20);
  const values = [];
  for (let r = start; r <= end; r++) {
    const o = rows[r - start];
    const line = Array(maxCol - minCol + 1).fill(null);             // null = leave unmapped cells alone
    for (const [k, idx] of Object.entries(PM.map)) line[idx - minCol] = o ? (o[k] ?? '') : '';
    values.push(line);
  }
  await state.ds.update(id, `${q(tab.title)}!${colLetter(minCol)}${start}:${colLetter(maxCol)}${end}`, values, 'RAW');
  if (PM.nameCell) {
    // Editing with the same name keeps the exact original text (history matches it).
    const name = PL.mode === 'edit' && norm(PL.name) === norm(m.planName) ? m.planName : PL.name.trim();
    await state.ds.update(id, `${q(tab.title)}!${colLetter(PM.nameCell.col)}${PM.nameCell.row + 1}`, [[name]], 'RAW');
  }
  await writeCardioTarget(id, tab.title, fresh);
  return rows.length;
}
// The weekly cardio target lives next to the plan name: a "Weekly Cardio (min):" label and the
// value to its right. It's found by its label; the first time, it goes in the first two empty
// cells on the plan-name row (E3:F3 on the standard sheet), never over anything.
async function writeCardioTarget(id, title, fresh) {
  const PM = state.model.planMeta, v = numOr(str(PL.cardio));
  if (PM.cardioCell) {
    await state.ds.update(id, `${q(title)}!${colLetter(PM.cardioCell.col + 1)}${PM.cardioCell.row + 1}`, [[v > 0 ? v : '']], 'RAW');
    return;
  }
  if (!(v > 0)) return;
  const row = PM.nameCell ? PM.nameCell.row : Math.max(0, PM.headerRow - 1);
  const cells = fresh[row] || [], empty = c => String(cells[c] ?? '').trim() === '';
  let col = Math.max(4, (PM.nameCell ? PM.nameCell.col : 1) + 2);
  while (!(empty(col) && empty(col + 1))) col++;
  await state.ds.update(id, `${q(title)}!${colLetter(col)}${row + 1}:${colLetter(col + 1)}${row + 1}`, [['Weekly Cardio (min):', v]], 'RAW');
}
async function archiveCurrentPlan(meta) {
  const id = state.sheet.id, m = state.model, TITLE = 'Plan Archive';
  const head = ['Archived on', 'Plan Name', 'Day', 'Category', 'Exercise', '# Sets', 'Target Reps', 'Rest', 'Notes', 'Exercise Video link', 'Weekly Cardio (min)'];
  let tab = meta.sheets.find(s => norm(s.title) === norm(TITLE));
  if (!tab) {
    const sheetId = await state.ds.addSheet(id, TITLE);
    tab = { title: TITLE, sheetId, rowCount: 1000 };
  }
  const [cur] = await state.ds.batchGet(id, [`${q(tab.title)}!A1:K`]);
  if (!cur.length || norm(cur[0]?.[10]) !== norm(head[10])) await state.ds.update(id, `${q(tab.title)}!A1:K1`, [head], 'RAW');   // new tab, or one from before the cardio column
  if (!cur.length) cur.push(head);
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;   // time keeps copies apart
  const rows = m.plan.map(p => [when, m.planName.trim(), p.day, p.category, p.exercise, numOr(p.sets), numOr(p.reps), numOr(p.rest), p.notes || '', p.video || '', m.cardioTarget || '']);
  if (!rows.length) return;
  const start = Math.max(cur.length, 1) + 1, end = start + rows.length - 1;
  if (end > tab.rowCount) await state.ds.addRows(id, tab.sheetId, end - tab.rowCount + 20);
  await state.ds.update(id, `${q(tab.title)}!A${start}:K${end}`, rows, 'RAW');
}
async function savePlan() {
  if (PL.saving) return;
  PL.saving = true;
  openModal(`<div class="center" style="padding:18px 0"><div class="spinner"></div><b>Saving the plan…</b><p class="muted small">Keep this page open.</p></div>`, { locked: true });
  try {
    const count = await writePlan();
    const name = PL.name.trim(), days = PL.days.length, archived = PL.mode === 'create' && PL.archive;
    // reload the sheet so logging, next-day and Insights use the new plan
    const r = await fetchModel(state.sheet.id);
    state.model = r.model; state.checks = r.checks;
    if (typeof INS !== 'undefined') INS.data = null;
    if (state.day && state.model.days.includes(state.day) && !store.get(draftKey(state.day))) state.entries = entriesForDay(state.day);
    stopEditing();
    renderPlanHome(); window.scrollTo({ top: 0 });
    try { navigator.vibrate?.(60); } catch {}
    openModal(`<div class="result ok"><div class="r-icon" aria-hidden="true">✓</div><h3>Plan saved</h3>
      <p>“${esc(name)}” now has <b>${days} day${days === 1 ? '' : 's'}</b> and <b>${count} exercise${count === 1 ? '' : 's'}</b> in “${esc(state.sheet.name)}”.</p>
      ${archived ? '<p class="small muted">The previous plan was copied to the “Plan Archive” tab.</p>' : ''}
      <p class="small muted">The trainee sees it the next time they open the app.</p>
      <button class="btn block" data-act="close">Done</button></div>`, { locked: true });
  } catch (e) {
    const auth = e instanceof AuthError;
    openModal(`<div class="result err"><div class="r-icon" aria-hidden="true">!</div><h3>Plan not saved</h3>
      <p>${auth ? 'Your Google sign-in expired (it lasts about an hour), so the plan couldn\'t be saved.' : `Something went wrong: <span class="muted">${esc(e.message)}</span>`}</p>
      <p class="muted small">Your changes are kept on this device. Saving again is safe: the Plan tab is rewritten as a whole.</p>
      <button class="btn block" data-act="pl-save">${auth ? 'Sign in &amp; save' : 'Try again'}</button>
      <button class="btn ghost block" data-act="close" style="margin-top:10px">Not now</button></div>`, { locked: true });
  } finally { PL.saving = false; }
}

/* ----------------------------- events ----------------------------- */
document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act^="pl-"]'); if (!t || t.disabled) return;
  const i = Number(t.dataset.i), d = curDay();
  switch (t.dataset.act) {
    case 'pl-home': renderPlanHome(); break;
    case 'pl-export': exportPlan(); break;
    case 'pl-edit': startEditing('edit'); break;
    case 'pl-new': renderPlanCreate(); break;
    case 'pl-create-go': {
      const name = $('#plNewName').value.trim();
      const from = document.querySelector('input[name=plFrom]:checked').value;
      if (!name) { $('#plNewErr').textContent = 'Give the plan a name.'; $('#plNewName').focus(); break; }
      if (norm(name) === norm(state.model.planName)) { $('#plNewErr').textContent = 'That is the current plan\'s name. Pick a new one.'; break; }
      const archived = from === 'archive' ? PL.archived?.[Number($('#plArcPick').value)] : null;
      if (from === 'archive' && !archived) { $('#plNewErr').textContent = 'Pick an archived plan.'; break; }
      if (from === 'file' && !PL.fileData) { $('#plNewErr').textContent = 'Choose a plan file first.'; break; }
      startEditing('create', { name, from, archive: $('#plArchive').checked, archived });
      break;
    }
    case 'pl-cancel':
      if (PL.mode === 'edit' && !planChanges().length) { stopEditing(); renderPlanHome(); break; }
      openModal(`<h3 style="text-transform:none">Discard your plan changes?</h3><p class="muted">Nothing has been saved to the sheet yet.</p>
        <div class="row"><button class="btn" data-act="pl-discard">Discard</button><button class="btn ghost" data-act="close">Keep editing</button></div>`);
      break;
    case 'pl-discard': closeModal(); stopEditing(); renderPlanHome(); window.scrollTo({ top: 0 }); break;
    case 'pl-day': PL.dayIdx = i; saveDraftPlan(); renderPlanEditor(); break;
    case 'pl-day-add': showDayName(false); break;
    case 'pl-day-rename': showDayName(true); break;
    case 'pl-day-ok': {
      const name = $('#plDayName').value.trim();
      const rename = !!t.dataset.rename;
      if (!name) { $('#plDayErr').textContent = 'Type a name.'; break; }
      if (PL.days.some((x, k) => norm(x.name) === norm(name) && !(rename && k === PL.dayIdx))) { $('#plDayErr').textContent = 'There is already a day with that name.'; break; }
      if (rename) d.name = name; else { PL.days.push({ id: pid(), name, items: [] }); PL.dayIdx = PL.days.length - 1; }
      closeModal(); saveDraftPlan(); renderPlanEditor(); break;
    }
    case 'pl-day-left': case 'pl-day-right': {
      const j = PL.dayIdx + (t.dataset.act === 'pl-day-left' ? -1 : 1);
      [PL.days[PL.dayIdx], PL.days[j]] = [PL.days[j], PL.days[PL.dayIdx]]; PL.dayIdx = j;
      saveDraftPlan(); renderPlanEditor(); break;
    }
    case 'pl-day-del':
      openModal(`<h3 style="text-transform:none">Delete “${esc(d.name)}”?</h3><p class="muted">Its ${d.items.length} exercise${d.items.length === 1 ? '' : 's'} will be removed from the plan when you save. Past workouts are not affected.</p>
        <div class="row"><button class="btn" data-act="pl-day-del-ok" style="background:var(--err);color:#fff">Delete day</button><button class="btn ghost" data-act="close">Cancel</button></div>`);
      break;
    case 'pl-day-del-ok': PL.days.splice(PL.dayIdx, 1); PL.dayIdx = Math.max(0, PL.dayIdx - 1); closeModal(); saveDraftPlan(); renderPlanEditor(); break;
    case 'pl-up': case 'pl-down': {
      const j = i + (t.dataset.act === 'pl-up' ? -1 : 1);
      [d.items[i], d.items[j]] = [d.items[j], d.items[i]]; saveDraftPlan(); renderPlanEditor(); break;
    }
    case 'pl-del': d.items.splice(i, 1); saveDraftPlan(); renderPlanEditor(); toast('Exercise removed (not saved yet)'); break;
    case 'pl-add': showExercisePicker(null); break;
    case 'pl-change': showExercisePicker(i); break;
    case 'pl-pick-ok': {
      const it = state.model.library[Number($('#plEx').value)]; if (!it) break;
      const vals = { ex: it.exercise, cat: it.category, video: it.video || '', sets: $('#plSets').value.trim(), reps: $('#plReps').value.trim(), rest: $('#plRest').value.trim(), notes: $('#plNotes').value.trim() };
      if (t.dataset.i === '') d.items.push({ id: pid(), ...vals }); else Object.assign(d.items[i], vals);
      closeModal(); saveDraftPlan(); renderPlanEditor();
      if (t.dataset.i === '') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      break;
    }
    case 'pl-review': showPlanReview(); break;
    case 'pl-save':
      try { await ensureToken(); } catch (err) { toast(err.message, 4000); break; }
      savePlan(); break;
  }
});
// Create screen: picking "from the archive" (or another archived plan) fills in its name.
document.addEventListener('change', ev => {
  if (ev.target.name === 'plFrom') {
    $('#plArcPick').hidden = ev.target.value !== 'archive';
    $('#plFile').hidden = ev.target.value !== 'file';
    if (ev.target.value === 'archive') useArchivedName();
    else if (ev.target.value === 'file') { if (PL.fileData) useFileName(); else $('#plFile').click(); }
    else { $('#plNameNote').innerHTML = defaultNameNote(); }
  } else if (ev.target.id === 'plArcPick') useArchivedName();
  else if (ev.target.id === 'plFile') readPlanFile(ev.target.files[0]);
});
document.addEventListener('input', ev => {
  const f = ev.target.dataset && ev.target.dataset.pf; if (!f || !PL.mode) return;
  if (f === 'name') PL.name = ev.target.value;
  else if (f === 'cardio') PL.cardio = ev.target.value.replace(/[^\d.]/g, '');
  else { const x = curDay()?.items[Number(ev.target.dataset.i)]; if (x) x[f] = ev.target.value; }
  saveDraftPlan(); updatePlanBar();
});
