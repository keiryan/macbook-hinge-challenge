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

  function update(angle) {
    if (!Number.isInteger(angle) || angle < 0 || angle > 360) return false;
    // Only the decorative plane clamps at 180°. The app's sensor readout
    // continues to display the actual accepted angle without interpolation.
    const bounded = Math.min(180, angle);
    root.style.setProperty('--horizon-y', Number((82 - bounded / 180 * 64).toFixed(3)) + '%');
    root.style.setProperty('--horizon-tilt', Number(((90 - bounded) * 0.22).toFixed(3)) + 'deg');
    root.dataset.sensorVisual = 'active';
    return true;
  }

  function clear() {
    root.dataset.sensorVisual = 'inactive';
    root.style.setProperty('--horizon-y', '50%');
    root.style.setProperty('--horizon-tilt', '0deg');
  }

  // Loaded synchronously in <head> so the selected palette exists before
  // the page paints. Controls bind later, after app.js sees the body.
  syncTheme();
  clear();
  window.HingeAppearance = { setup, update, clear };
})();
