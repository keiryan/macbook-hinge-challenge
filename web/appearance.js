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

  // Targets share the lid's polar coordinates: 0° points right, 90° up.
  // A repeated/nearby later target sits inward on the same radial line.
  function challengeState(state, fresh = true) {
    const dial = document.getElementById('challenge-dial');
    if (!dial) return;
    dial.hidden = !state;
    if (!state) return;
    const active = state.status === 'active' ? state.stageIndex : -1;
    const spacing = Math.max(7, 4200 / (dial.clientHeight || 600));
    const placed = [];
    const order = state.targets.map((_, i) => i).sort((a, b) => (b === active) - (a === active));
    for (const i of order) {
      const angle = state.targets[i], radians = angle * Math.PI / 180;
      let radius = 96.5;
      while (placed.some(p => Math.abs(p.angle - angle) < 10 && p.radius === radius)) radius -= spacing;
      placed.push({ angle, radius });
      const marker = document.getElementById('dial-target-' + i);
      const done = i < state.completedStages;
      marker.dataset.state = done ? 'done' : i === active ? 'active' : state.status === 'active' ? 'pending' : 'stopped';
      marker.dataset.inset = String(radius < 96.5);
      marker.style.left = (50 + Math.cos(radians) * radius / 2) + '%';
      marker.style.top = (100 - Math.sin(radians) * radius) + '%';
      marker.style.setProperty('--hold-progress', String(done ? 1 : i === active && fresh ? state.holdProgress : 0));
      document.getElementById('dial-number-' + i).textContent = done ? '✓' : String(i + 1);
      document.getElementById('dial-angle-' + i).textContent = angle + '°';
    }
    const range = document.getElementById('dial-range');
    range.style.display = active < 0 ? 'none' : '';
    if (active >= 0) {
      const point = angle => [96.5 * Math.cos(angle * Math.PI / 180), -96.5 * Math.sin(angle * Math.PI / 180)];
      const from = point(state.target - 3), to = point(state.target + 3);
      range.setAttribute('d', 'M' + from.join(' ') + ' A96.5 96.5 0 0 0 ' + to.join(' '));
    }
  }

  // Loaded synchronously in <head> so the selected palette exists before
  // the page paints. Controls bind later, after app.js sees the body.
  syncTheme();
  clear();
  window.HingeAppearance = { setup, update, clear, challengeState };
})();
