'use strict';
/* =====================================================================
   Workout Log · PT targets (PT mode only)
   The PT sets reps / weight per set for any day of the plan (it opens on the
   trainee's next session). The "PT Targets" tab holds one block per day:
   saving a day replaces that day's block. When the trainee saves that day's
   workout the block is marked used; the PT can reuse it with one tap.
   Uses globals from index.html (state, $, esc, norm, q, store, toast, openModal,
   closeModal, setChrome, tabsHTML, tokenValid, requestToken, AuthError, fetchModel,
   nextPlanDay, prevFor, parseTargets, targetBlock, activeTargets, targetsUsed, tgtTime, agoText,
   fmtShort, tgtFilled, str, num, pad, colLetter, TGT_TAB, TGT_HEAD, TGT_COLS, fmtRest, renderLoading,
   renderSignin, DEMO).
   ===================================================================== */

const TG = { day: null, ex: [], resumed: false, saving: false };
const tgDraftKey = (day = TG.day) => `wl:tgtDraft:${state.sheet?.id}:${norm(day)}`;
const blankSet = () => ({ reps: '', wgt: '', note: '', showNote: false });

function saveTgDraft() {
  clearTimeout(saveTgDraft.t);
  const day = TG.day, ex = TG.ex;
  saveTgDraft.t = setTimeout(() => store.set(tgDraftKey(day), { day, ex, plan: state.model.planName, at: Date.now() }), 300);
}

// Re-read the sheet first: the trainee may have logged a session since this page was opened,
// which changes which day is next and which targets are used.
async function renderTargets() {
  setChrome({ menu: true });
  renderLoading('Checking the trainee\'s latest workout…');
  try {
    const r = await fetchModel(state.sheet.id);
    state.model = r.model; state.checks = r.checks;
    if (typeof INS !== 'undefined') INS.data = null;
  } catch (e) {
    if (e instanceof AuthError) return renderSignin(e.message);
    toast('Couldn\'t re-read the sheet: ' + e.message, 4000);       // carry on with what's loaded
  }
  buildTargets(nextPlanDay(state.model).day);
  renderTargetsEditor();
  window.scrollTo({ top: 0 });
}

function buildTargets(day) {
  const m = state.model, plan = m.plan.filter(p => p.day === day);
  const live = activeTargets(day, m), draft = store.get(tgDraftKey(day));
  TG.day = day; TG.resumed = false;
  if (draft && norm(draft.plan) === norm(m.planName) && draft.at > (live ? tgtTime(live)?.getTime() || 0 : 0)) {
    // unsaved edits on this device, newer than what's in the sheet
    TG.ex = plan.map(p => draft.ex.find(x => norm(x.exercise) === norm(p.exercise)) || fromPlan(p, null));
    TG.resumed = true;
    return;
  }
  store.del(tgDraftKey(day));
  TG.ex = plan.map(p => fromPlan(p, live?.items.get(norm(p.exercise))));
}
function fromPlan(p, it) {
  const n = it ? it.sets.length : Math.max(1, Math.min(20, parseInt(p.sets) || 1));
  return { exercise: p.exercise, category: p.category, planSets: p.sets, planReps: p.reps, rest: p.rest,
    sets: Array.from({ length: n }, (_, j) => { const s = it?.sets[j]; return s ? { reps: s.reps, wgt: s.wgt, note: s.note, showNote: !!s.note } : blankSet(); }) };
}
const anyWeight = () => TG.ex.some(x => x.sets.some(s => Number.isFinite(Number(str(s.wgt).replace(',', '.'))) && str(s.wgt) !== ''));

function statusHTML() {
  const b = targetBlock(TG.day);
  if (!b) return 'No targets for this day yet.';
  const used = targetsUsed(b);
  if (!used) return `Targets saved ${esc(agoText(tgtTime(b)))}. The trainee sees them; your changes replace them.`;
  const on = b.usedOn ? (typeof toDay === 'function' ? toDay(b.usedOn) : null) : null;
  return `The last targets for ${esc(TG.day)} were used${on ? ` on ${esc(fmtShort(on))}` : ''}. Reuse them as they are, or adjust and save.`;
}
function renderTargetsEditor() {
  setChrome({ menu: true });
  const m = state.model, nx = nextPlanDay(m), isNext = norm(nx.day) === norm(TG.day);
  let last = '';
  if (nx.why === 'next') {
    const d = nx.date && typeof toDay === 'function' ? toDay(nx.date) : null;
    last = `last logged: ${esc(nx.after)}${d ? ', ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}`;
  } else last = 'nothing logged under this plan yet';
  const b = targetBlock(TG.day), used = b && targetsUsed(b);
  const anyUsed = m.days.some(d => { const x = targetBlock(d); return x && targetsUsed(x); });
  const anyLive = m.days.some(d => activeTargets(d));
  const y = window.scrollY;
  $('#app').innerHTML = `${tabsHTML('targets')}
    <section class="panel" style="padding:14px">
      <p class="eyebrow">PT targets · pick a day</p>
      <div class="days" style="padding-top:2px">${m.days.map(d => `<button class="day ${norm(d) === norm(TG.day) ? 'active' : ''} ${activeTargets(d) ? 'tgt' : targetBlock(d) ? 'tgu' : ''}" data-act="tg-day" data-day="${esc(d)}">${esc(d)}${norm(d) === norm(nx.day) ? ' · next' : ''}</button>`).join('')}</div>
      ${anyLive || anyUsed ? `<div class="tg-legend">${anyLive ? '<i></i>targets set' : ''}${anyLive && anyUsed ? ' &nbsp; ' : ''}${anyUsed ? '<i class="u"></i>used, can be reused' : ''}</div>` : ''}
      <h2 style="margin:4px 0 2px">${esc(TG.day)}${isNext ? ' <span style="color:var(--accent);font-size:15px">· next session</span>' : ''}</h2>
      <div class="sub" style="margin:0">${isNext ? `Picked from the trainee's history (${last}).` : `The trainee's next session is ${esc(nx.day)}.`}</div>
      <div class="nextup" style="margin:10px 0 0">${statusHTML()}</div>
      <div class="tg-actions">
        ${used ? `<button class="btn ghost" data-act="tg-reuse">↺ Reuse last targets</button>` : ''}
        <button class="btn ghost" data-act="tg-plus" id="tgPlus" ${anyWeight() ? '' : 'disabled'}>+2.5 kg on all</button>
      </div>
    </section>
    ${TG.resumed ? `<div class="banner"><span>Your unsaved targets for ${esc(TG.day)} were kept on this device.</span><button class="text-btn" data-act="tg-discard">Discard</button></div>` : ''}
    ${TG.ex.length ? TG.ex.map(tgCardHTML).join('') : `<p class="muted center">${esc(TG.day)} has no exercises in the plan.</p>`}
    <p class="small muted" style="line-height:1.5">Each day keeps its own targets; saving replaces only this day's. Leave an exercise empty to give it no targets. The trainee's app picks up saved targets within about 30 seconds.</p>
    <div class="savebar" id="tgBar"><div class="inner"><div class="count" id="tgCount"></div><button class="btn" data-act="tg-save" ${TG.saving ? 'disabled' : ''}>Save ${esc(TG.day)}</button></div></div>`;
  updateTgBar();
  window.scrollTo({ top: y });
}
function tgCardHTML(x, i) {
  const a = j => `data-i="${i}" data-j="${j}"`;
  const has = x.sets.some(tgtFilled);
  return `<section class="card ${has ? 'has' : ''}" id="tg-${i}">
    <div class="card-head"><div class="titles">
      <span class="chip">${esc(x.category || '—')}</span>
      <h3>${esc(x.exercise)}</h3>
      <div class="meta">Plan: ${esc(x.planSets || '—')} set${String(x.planSets) === '1' ? '' : 's'} × ${esc(x.planReps || '—')}${x.rest ? ` · Rest ${esc(fmtRest(x.rest))}` : ''}</div>
    </div></div>
    <div class="sets">
      <div class="set-row head tg-row"><span class="center">Set</span><span>Last time</span><span class="center">Reps</span><span class="center">kg</span><span></span></div>
      ${x.sets.map((s, j) => {
        const p = prevFor(x.exercise, j + 1);
        return `<div class="set-row tg-row">
          <span class="set-no">${j + 1}</span>
          <span class="prev" style="border-color:transparent">${p ? esc(`${p.reps || '–'} @ ${p.wgt || 0}`) : '—'}</span>
          <input inputmode="numeric" data-tf="reps" ${a(j)} value="${esc(s.reps)}" placeholder="${esc(x.planReps)}" aria-label="${esc(x.exercise)} set ${j + 1} target reps">
          <input inputmode="decimal" data-tf="wgt" ${a(j)} value="${esc(s.wgt)}" placeholder="${esc(p?.wgt ?? '')}" aria-label="${esc(x.exercise)} set ${j + 1} target weight">
          <button class="icon-btn small ${s.note ? 'on' : ''}" data-act="tg-note" ${a(j)} aria-label="Note for set ${j + 1}">✎</button>
        </div>
        ${s.showNote || s.note ? `<div class="set-note"><input data-tf="note" ${a(j)} value="${esc(s.note)}" placeholder="Note for set ${j + 1} (e.g. slow on the way down)" dir="auto"></div>` : ''}`;
      }).join('')}
    </div>
    <div class="card-foot">
      <button class="text-btn" data-act="tg-addset" data-i="${i}">+ Set</button>
      ${x.sets.length > 1 ? `<button class="text-btn" data-act="tg-rmset" data-i="${i}">− Set</button>` : ''}
      ${x.sets.length > 1 ? `<button class="text-btn" data-act="tg-copy" data-i="${i}" ${tgtFilled(x.sets[0]) ? '' : 'disabled'}>Copy set 1 to all</button>` : ''}
      <span style="flex:1"></span>
      <button class="text-btn" data-act="tg-clear" data-i="${i}" style="color:var(--muted)">Clear</button>
    </div>
  </section>`;
}
function rerenderTgCard(i) {
  const el = document.getElementById('tg-' + i);
  if (el) el.outerHTML = tgCardHTML(TG.ex[i], i);
  updateTgBar();
}
function updateTgBar() {
  const el = document.getElementById('tgCount'); if (!el) return;
  const n = TG.ex.filter(x => x.sets.some(tgtFilled)).length;
  el.innerHTML = `<b>${n} of ${TG.ex.length}</b> exercise${TG.ex.length === 1 ? '' : 's'} have targets`;
  const plus = document.getElementById('tgPlus'); if (plus) plus.disabled = !anyWeight();
}

async function writeTargets() {
  const id = state.sheet.id, m = state.model;
  const meta = await state.ds.meta(id);
  let tab = meta.sheets.find(x => norm(x.title) === norm(TGT_TAB));
  if (!tab) tab = { title: TGT_TAB, sheetId: await state.ds.addSheet(id, TGT_TAB), rowCount: 1000 };
  const [cur] = await state.ds.batchGet(id, [`${q(tab.title)}!A1:I`]);
  const d = new Date();
  const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // Keep the other days' blocks (current plan only; older plans' targets are dropped).
  const dayIdx = x => m.days.findIndex(dd => norm(dd) === norm(x));
  const kept = [];
  for (const b of parseTargets(cur).values()) {
    if (norm(b.day) === norm(TG.day) || dayIdx(b.day) < 0 || (b.plan && norm(b.plan) !== norm(m.planName))) continue;
    for (const it of b.items.values()) it.sets.forEach((x, j) => kept.push([b.day, it.exercise, j + 1, num(x.reps), num(x.wgt), x.note, m.planName, b.savedAt, b.usedOn]));
  }
  // Every set of an exercise that has targets is written (blank ones too), so the set count carries over.
  const mine = [];
  TG.ex.filter(x => x.sets.some(tgtFilled)).forEach(x => x.sets.forEach((s, j) =>
    mine.push([TG.day, x.exercise, j + 1, num(s.reps), num(s.wgt), str(s.note), m.planName, when, ''])));
  const rows = [...kept, ...mine].sort((a, b) => dayIdx(a[0]) - dayIdx(b[0]));   // stable: keeps exercise/set order
  const end = Math.max(rows.length + 1, cur.length, 1);
  if (end > tab.rowCount) await state.ds.addRows(id, tab.sheetId, end - tab.rowCount + 20);
  const values = [TGT_HEAD, ...rows];
  while (values.length < end) values.push(Array(TGT_COLS).fill(''));      // blank out leftover rows
  await state.ds.update(id, `${q(tab.title)}!A1:${colLetter(TGT_COLS - 1)}${end}`, values, 'RAW');
  m.targets = parseTargets([TGT_HEAD, ...rows.map(r => r.map(String))]);
  return { sets: mine.length, exercises: new Set(mine.map(r => r[1])).size };
}
async function saveTargets() {
  if (TG.saving) return;
  TG.saving = true;
  openModal(`<div class="center" style="padding:18px 0"><div class="spinner"></div><b>Saving the targets…</b><p class="muted small">Keep this page open.</p></div>`, { locked: true });
  try {
    const r = await writeTargets();
    clearTimeout(saveTgDraft.t); store.del(tgDraftKey()); TG.resumed = false;
    renderTargetsEditor();
    try { navigator.vibrate?.(60); } catch {}
    openModal(`<div class="result ok"><div class="r-icon" aria-hidden="true">✓</div><h3>${r.sets ? `${esc(TG.day)} targets saved` : `${esc(TG.day)} targets cleared`}</h3>
      <p>${r.sets ? `<b>${r.exercises} exercise${r.exercises === 1 ? '' : 's'}</b> (${r.sets} sets) for <b>${esc(TG.day)}</b> in “${esc(state.sheet.name)}”.` : `There are no targets for ${esc(TG.day)} now.`}</p>
      <p class="small muted">If the trainee has the app open, it updates within about 30 seconds (or right away with ↻ Refresh).</p>
      <button class="btn block" data-act="close">Done</button></div>`, { locked: true });
  } catch (e) {
    const auth = e instanceof AuthError;
    openModal(`<div class="result err"><div class="r-icon" aria-hidden="true">!</div><h3>Targets not saved</h3>
      <p>${auth ? 'Your Google sign-in expired (it lasts about an hour), so the targets couldn\'t be saved.' : `Something went wrong: <span class="muted">${esc(e.message)}</span>`}</p>
      <p class="muted small">Your entries are kept on this device. Saving again is safe: the targets are rewritten as a whole.</p>
      <button class="btn block" data-act="tg-save">${auth ? 'Sign in &amp; save' : 'Try again'}</button>
      <button class="btn ghost block" data-act="close" style="margin-top:10px">Not now</button></div>`, { locked: true });
  } finally { TG.saving = false; }
}

document.addEventListener('click', async ev => {
  const t = ev.target.closest('[data-act^="tg-"]'); if (!t || t.disabled) return;
  const i = Number(t.dataset.i), j = Number(t.dataset.j), x = TG.ex[i];
  switch (t.dataset.act) {
    case 'tg-note': x.sets[j].showNote = !x.sets[j].showNote || !!x.sets[j].note; rerenderTgCard(i);
      document.querySelector(`[data-tf="note"][data-i="${i}"][data-j="${j}"]`)?.focus(); break;
    case 'tg-addset': if (x.sets.length < 20) { x.sets.push(blankSet()); rerenderTgCard(i); saveTgDraft(); } break;
    case 'tg-rmset': if (x.sets.length > 1) { x.sets.pop(); rerenderTgCard(i); saveTgDraft(); } break;
    case 'tg-copy': { const f = x.sets[0]; x.sets.forEach((s, k) => { if (k) { s.reps = f.reps; s.wgt = f.wgt; } }); rerenderTgCard(i); saveTgDraft(); break; }
    case 'tg-clear': x.sets = x.sets.map(blankSet); rerenderTgCard(i); saveTgDraft(); break;
    case 'tg-discard': clearTimeout(saveTgDraft.t); store.del(tgDraftKey()); buildTargets(TG.day); renderTargetsEditor(); break;
    case 'tg-day': if (norm(t.dataset.day) !== norm(TG.day)) { buildTargets(t.dataset.day); renderTargetsEditor(); } break;
    case 'tg-reuse': {
      const b = targetBlock(TG.day); if (!b) break;
      TG.ex = state.model.plan.filter(p => p.day === TG.day).map(p => fromPlan(p, b.items.get(norm(p.exercise))));
      saveTgDraft(); renderTargetsEditor();
      toast('Last targets copied in. Change anything, then save.', 3500); break;
    }
    case 'tg-plus': {
      let n = 0;
      TG.ex.forEach(x => x.sets.forEach(s => {
        const w = Number(str(s.wgt).replace(',', '.'));
        if (str(s.wgt) !== '' && Number.isFinite(w)) { s.wgt = String(Math.round((w + 2.5) * 100) / 100); n++; }
      }));
      if (!n) break;
      saveTgDraft(); renderTargetsEditor();
      toast(`+2.5 kg on ${n} set${n === 1 ? '' : 's'} (not saved yet)`); break;
    }
    case 'tg-save':
      closeModal();
      try { await ensureToken(); } catch (err) { toast(err.message, 4000); break; }
      saveTargets(); break;
  }
});
document.addEventListener('input', ev => {
  const f = ev.target.dataset && ev.target.dataset.tf; if (!f) return;
  const i = Number(ev.target.dataset.i), x = TG.ex[i], s = x?.sets[Number(ev.target.dataset.j)]; if (!s) return;
  s[f] = ev.target.value;
  document.getElementById('tg-' + i)?.classList.toggle('has', x.sets.some(tgtFilled));
  const copy = document.querySelector(`#tg-${i} [data-act="tg-copy"]`); if (copy) copy.disabled = !tgtFilled(x.sets[0]);
  updateTgBar(); saveTgDraft();
});
