'use strict';
/* =====================================================================
   Workout Log · Install as an app
   Android/desktop Chrome: uses the browser's own install prompt.
   iPhone/iPad: shows the Share → "Add to Home Screen" steps (no one-tap install there).
   Installed, the app gets its own icon, opens full screen, and can show
   notifications in the background (on iPhone only when installed).
   Uses globals from index.html: $, esc, store, toast, openModal, closeModal, ENV.
   ===================================================================== */

let installPrompt = null;
const INSTALL_HIDE = 'wl:installHidden';
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canInstall = () => !isInstalled() && (!!installPrompt || ENV.os === 'ios');

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installPrompt = e;
  installBanner();
});
window.addEventListener('appinstalled', () => { installPrompt = null; store.set(INSTALL_HIDE, true); document.getElementById('installBanner')?.remove(); toast('Installed. Open Workout Log from its new icon.'); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// A small, dismissible banner at the top of the Log workout screen.
function installBanner() {
  if (!canInstall() || store.get(INSTALL_HIDE) || document.getElementById('installBanner')) return;
  const app = document.getElementById('app'); if (!app || !app.querySelector('.session-head')) return;
  app.querySelector('.session-head').insertAdjacentHTML('beforebegin', `<div class="banner install" id="installBanner">
    <span><b>Install Workout Log</b><br><span class="small">Home-screen icon, full screen, and a notification when rest is over${ENV.os === 'ios' ? ' (iPhone needs this for notifications)' : ''}.</span></span>
    <span class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn" data-act="install" style="padding:9px 12px">Install</button><button class="text-btn" data-act="install-hide" aria-label="Hide">✕</button></span>
  </div>`);
}

async function runInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({}));
    installPrompt = null;
    if (outcome === 'accepted') { store.set(INSTALL_HIDE, true); document.getElementById('installBanner')?.remove(); }
    return;
  }
  if (ENV.os === 'ios') {
    const share = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg>`;
    const where = ENV.browser === 'safari' ? 'at the bottom of the screen (or at the top on iPad)' : 'next to the address bar (in some browsers it\'s in the ⋯ menu)';
    openModal(`<h3 style="text-transform:none">Add Workout Log to your Home Screen</h3>
      <ol class="guide">
        <li>Tap the <b>Share</b> button ${share} ${where}.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
        <li>Tap <b>Add</b>, then open <b>Workout Log</b> from its new icon.</li>
      </ol>
      <p class="small muted">In the installed app you'll sign in with Google once more, and if you use PT mode, enter the PT password again. After that, rest-timer notifications can be turned on.</p>
      <button class="btn block" data-act="close">Got it</button>`);
    return;
  }
  toast('Use your browser menu → “Install app” or “Add to Home screen”.', 4000);
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act="install"],[data-act="install-hide"]'); if (!b) return;
  if (b.dataset.act === 'install') { closeModal(); runInstall(); }
  else { store.set(INSTALL_HIDE, true); document.getElementById('installBanner')?.remove(); toast('You can still install it from the ☰ menu.'); }
});
