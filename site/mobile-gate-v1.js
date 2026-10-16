/* Mobile arrival screen. Gameplay loads only after an explicit opt-in on phones. */
(() => {
  const ua = navigator.userAgent || '';
  const phone = navigator.userAgentData?.mobile === true || /iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua);
  const smallTouch = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 700;
  let bypass = false;
  try { bypass = sessionStorage.getItem('datawars:mobile-bypass:v1') === 'yes'; } catch (_) {}
  const gated = (phone || smallTouch) && !bypass;
  window.__dataWarsMobileGate = gated;
  document.documentElement.classList.toggle('dw-mobile-gated', gated);
  let loaded = false;
  function loadGame() {
    if (loaded) return;
    loaded = true;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/game-v30.js';
    document.head.appendChild(script);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('dw-mobile-welcome');
    if (!gated) { loadGame(); return; }
    page.hidden = false;
    document.getElementById('dw-mobile-continue').addEventListener('click', () => {
      if (!window.__dataWarsMobileGate) return;
      try { sessionStorage.setItem('datawars:mobile-bypass:v1', 'yes'); } catch (_) {}
      window.__dataWarsMobileGate = false;
      document.documentElement.classList.remove('dw-mobile-gated');
      page.hidden = true;
      window.dispatchEvent(new Event('datawars-load-requested'));
      loadGame();
      document.getElementById('dw-splash').focus({ preventScroll: true });
    });
    document.getElementById('dw-mobile-copy').addEventListener('click', async () => {
      const status = document.getElementById('dw-mobile-copy-status');
      const url = 'https://www.playdatawars.com/';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(url);
        status.textContent = 'Link copied. Open it on your computer.';
      } catch (_) {
        const field = document.getElementById('dw-mobile-link');
        field.hidden = false;
        field.focus();
        field.select();
        status.textContent = 'Select and copy the link below.';
      }
    });
  }, { once: true });
})();
