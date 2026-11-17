'use strict';
/* =====================================================================
   Workout Log · Rest timer
   Tapping a set's ✓ starts a countdown from the plan's rest time. Editing a
   ticked set restarts it. When rest is over: sound, vibration, the bar flashes,
   and (best effort) a notification if the app isn't on screen.
   The screen is kept awake while a timer runs, so the alert fires on time.
   Uses globals from index.html: state, $, esc, store, toast, ENV, prevFor.
   ===================================================================== */

const REST = { t: null, endT: null, tick: null, ctx: null, wake: null, overT: null };
const REST_KEY = 'wl:rest';
const DEFAULT_REST = 90;

// Rest in the plan is seconds; older plans used small numbers for minutes (1 = 1 min).
function restSeconds(e) {
  const n = Number(String(e?.rest ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return { sec: DEFAULT_REST, defaulted: true };
  return { sec: n <= 5 ? n * 60 : n, defaulted: false };
}
const cap = s => String(s).replace(/\b\w/g, c => c.toUpperCase());
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// What comes after set j of entry i: the next set, or the next exercise.
function nextUp(i, j) {
  const e = state.entries[i];
  if (e && j + 1 < e.sets.length) return `set ${j + 2} of ${cap(e.exercise)}`;
  const n = state.entries[i + 1];
  return n ? cap(n.exercise) : 'last set done';
}

/* ----------------------------- start / stop ----------------------------- */
function startRest(i, j) {
  const e = state.entries[i]; if (!e) return;
  const { sec, defaulted } = restSeconds(e);
  clearTimeout(REST.overT);
  REST.t = { i, j, ex: e.exercise, set: j + 1, total: sec, endAt: Date.now() + sec * 1000, defaulted, day: state.day, over: false, next: nextUp(i, j) };
  store.set(REST_KEY, REST.t);
  unlockSound(); keepAwake(true); scheduleEnd(); buildRestBar();
}
function stopRest() {
  clearTimeout(REST.endT); clearTimeout(REST.overT); clearInterval(REST.tick); REST.tick = null;
  REST.t = null; store.del(REST_KEY); keepAwake(false); buildRestBar();
}
function addRest(sec) {
  if (!REST.t) return;
  if (REST.t.over) { REST.t.over = false; REST.t.endAt = Date.now(); REST.t.total = 0; keepAwake(true); }
  REST.t.endAt += sec * 1000; REST.t.total += sec;
  store.set(REST_KEY, REST.t); scheduleEnd(); buildRestBar();
}
// The set at (i, j) was ticked or edited while ticked.
function restartRestFor(i, j) { if (REST.t && REST.t.i === i && REST.t.j === j && !REST.t.over) startRest(i, j); else if (!REST.t || REST.t.over) startRest(i, j); }
function restBelongsTo(i, j) { return REST.t && REST.t.i === i && REST.t.j === j; }

function scheduleEnd() {
  clearTimeout(REST.endT);
  REST.endT = setTimeout(restDone, Math.max(0, REST.t.endAt - Date.now()));
  if (!REST.tick) REST.tick = setInterval(tickRest, 250);
}
function restDone() {
  if (!REST.t || REST.t.over) return;
  if (Date.now() < REST.t.endAt - 250) return scheduleEnd();      // woke up early
  REST.t.over = true; store.set(REST_KEY, REST.t);
  clearInterval(REST.tick); REST.tick = null;
  playBeeps();
  try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch {}
  notifyRestOver();
  keepAwake(false);
  buildRestBar();
  REST.overT = setTimeout(() => { if (REST.t?.over) stopRest(); }, 30000);   // the "over" bar hides itself
}

/* ----------------------------- the bar ----------------------------- */
function buildRestBar() {
  const el = document.getElementById('restBar'); if (!el) return;
  const t = REST.t;
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const askNotif = 'Notification' in window && Notification.permission === 'default' && !store.get('wl:notifAsked');
  if (t.over) {
    el.className = 'rest-bar over';
    el.innerHTML = `<div class="rest-row">
        <div class="rest-time" aria-hidden="true">✓</div>
        <div class="rest-txt" role="status"><b>Rest over</b><br><span>Next: ${esc(t.next)}</span></div>
        <button class="rest-btn" data-act="rest-add">+15s</button>
        <button class="rest-btn" data-act="rest-skip">OK</button>
      </div>`;
    return;
  }
  el.className = 'rest-bar';
  el.innerHTML = `<div class="rest-prog" id="restProg"></div>
    <div class="rest-row">
      <div class="rest-time" id="restTime" aria-live="off"></div>
      <div class="rest-txt"><b>Rest</b> · after set ${t.set}<br><span>${esc(cap(t.ex))} · ${t.total} s${t.defaulted ? ' (default)' : ''}</span></div>
      <button class="rest-btn" data-act="rest-add">+15s</button>
      <button class="rest-btn" data-act="rest-skip">Skip</button>
    </div>
    ${askNotif ? `<div class="rest-notif"><span>Get a notification when rest is over, even with the app in the background?</span><button class="text-btn" data-act="rest-notif">Allow</button><button class="text-btn" data-act="rest-notif-no" aria-label="No thanks">✕</button></div>` : ''}`;
  tickRest();
}
function tickRest() {
  const t = REST.t; if (!t || t.over) return;
  const left = t.endAt - Date.now();
  const time = document.getElementById('restTime'), prog = document.getElementById('restProg');
  if (time) time.textContent = mmss(left);
  if (prog) prog.style.width = `${Math.max(0, Math.min(100, left / (t.total * 1000) * 100))}%`;
  if (left <= 0) restDone();
}

/* ----------------------------- sound, screen, notifications ----------------------------- */
// Sound must be unlocked from a tap (the ✓), so the beep can play later on its own.
function unlockSound() {
  try {
    REST.ctx = REST.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (REST.ctx.state === 'suspended') REST.ctx.resume();
  } catch {}
}
function playBeeps() {
  const c = REST.ctx; if (!c) return;
  try {
    [0, 0.35, 0.7].forEach((at, k) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = k === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, c.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.4, c.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + 0.25);
      o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + 0.3);
    });
  } catch {}
}
async function keepAwake(on) {
  try {
    if (on && !REST.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      REST.wake = await navigator.wakeLock.request('screen');
      REST.wake.addEventListener('release', () => { REST.wake = null; });
    } else if (!on && REST.wake) { await REST.wake.release(); REST.wake = null; }
  } catch { REST.wake = null; }
}
async function notifyRestOver() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;              // on screen: the bar, sound and vibration are enough
  const body = `Next: ${REST.t.next}`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification('Rest over', { body, tag: 'rest', renotify: true, vibrate: [300, 150, 300], icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    else new Notification('Rest over', { body, tag: 'rest' });
  } catch {}
}

/* ----------------------------- lifecycle ----------------------------- */
// Pick up a running timer after a reload (it counts from the time the set was ticked).
function restResume() {
  if (REST.t) { buildRestBar(); return; }
  const t = store.get(REST_KEY);
  if (!t || t.day !== state.day) return;
  if (t.over || Date.now() > t.endAt + 30000) { store.del(REST_KEY); return; }
  REST.t = t; keepAwake(true); scheduleEnd(); buildRestBar();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !REST.t) return;
  if (!REST.t.over && Date.now() >= REST.t.endAt) restDone(); else if (!REST.t.over) { keepAwake(true); tickRest(); }
});
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act^="rest-"]'); if (!b) return;
  switch (b.dataset.act) {
    case 'rest-add': addRest(15); break;
    case 'rest-skip': stopRest(); break;
    case 'rest-notif-no': store.set('wl:notifAsked', true); buildRestBar(); break;
    case 'rest-notif':
      store.set('wl:notifAsked', true);
      try {
        const p = await Notification.requestPermission();
        toast(p === 'granted' ? 'You\'ll be notified when rest is over' : 'Notifications are off; you\'ll still hear and see the alert');
      } catch {}
      buildRestBar(); break;
  }
});
