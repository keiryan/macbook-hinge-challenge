(function () {
  'use strict';
  const root = document.documentElement;
  const storageKey = 'hinge-theme';
  const colors = { dark: '#0b1018', light: '#eef3f8' };
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'dark' || saved === 'light') theme = saved;
  } catch {}

  function syncTheme() {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
    const toggle = document.getElementById('theme-toggle');
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    toggle?.setAttribute('aria-label', label);
    toggle?.setAttribute('title', label);
    for (const name of ['dark', 'light']) {
      document.getElementById('theme-' + name)?.setAttribute('aria-pressed', String(theme === name));
    }
  }

  function setTheme(next) {
    if (next !== 'dark' && next !== 'light') return;
    theme = next;
    syncTheme();
    try { localStorage.setItem(storageKey, theme); } catch {}
  }

  function setup() {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
    for (const name of ['dark', 'light']) {
      const button = document.getElementById('theme-' + name);
      if (button) button.onclick = () => setTheme(name);
    }
    syncTheme();
  }

  // The lid sweeps open from closed when readings resume after a real pause.
  // Brief freshness gaps (common in browser mode) resume without replaying it.
  const entranceAfterMs = 2000;
  let inactiveSince = null;

  function update(angle) {
    if (!Number.isInteger(angle) || angle < 0 || angle > 360) return false;
    // Only the decorative lid clamps at 180°. The app's sensor readout
    // continues to display the actual accepted angle without interpolation.
    const bounded = Math.min(180, angle);
    if (root.dataset.sensorVisual !== 'active' && (inactiveSince === null || Date.now() - inactiveSince >= entranceAfterMs)) {
      root.dataset.lidEntrance = 'play';
    }
    root.style.setProperty('--lid-angle', bounded + 'deg');
    root.dataset.sensorVisual = 'active';
    return true;
  }

  // Leaves the last angle in place so the lid fades out where it stood
  // instead of swinging back to a neutral position.
  function clear() {
    if (root.dataset.sensorVisual === 'active') inactiveSince = Date.now();
    root.dataset.sensorVisual = 'inactive';
    delete root.dataset.lidEntrance;
  }

  // Loaded synchronously in <head> so the selected palette exists before
  // the page paints. Controls bind later, after app.js sees the body.
  syncTheme();
  clear();
  window.HingeAppearance = { setup, update, clear };
})();
