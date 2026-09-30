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

  // Spreads markers along the dial so none sit closer than `gap` degrees.
  // Overlapping markers form a cluster centered on their mean angle; a
  // cluster holding the pinned (active) marker is anchored on that marker's
  // exact angle instead, so only its neighbors move. Returns display angles.
  function spreadAlongDial(angles, gap, pinned = -1) {
    const order = angles.map((_, i) => i).sort((a, b) => angles[a] - angles[b] || a - b);
    const clusters = order.map(i => ({ members: [i] }));
    const place = cluster => {
      const n = cluster.members.length, pin = cluster.members.indexOf(pinned);
      cluster.start = pin >= 0
        ? angles[pinned] - pin * gap
        : cluster.members.reduce((sum, i) => sum + angles[i], 0) / n - (n - 1) * gap / 2;
      cluster.end = cluster.start + (n - 1) * gap;
    };
    clusters.forEach(place);
    for (let k = 0; k < clusters.length - 1;) {
      if (clusters[k + 1].start - clusters[k].end < gap - 1e-9) {
        clusters[k].members.push(...clusters[k + 1].members);
        clusters.splice(k + 1, 1);
        place(clusters[k]);
        k = Math.max(0, k - 1);
      } else k++;
    }
    const shown = [];
    for (const cluster of clusters) cluster.members.forEach((i, k) => { shown[i] = cluster.start + k * gap; });
    return shown;
  }

  // Targets share the lid's polar coordinates: 0° points right, 90° up.
  // Every marker sits on the same ring. The active target keeps its exact
  // angle; nearby markers slide along the ring just far enough to stay
  // legible, and their labels still name the true target angle.
  const markerGapPx = 44, bandClearPx = 22;
  function challengeState(state, fresh = true) {
    const dial = document.getElementById('challenge-dial');
    if (!dial) return;
    dial.hidden = !state;
    if (!state) return;
    const active = state.status === 'active' ? state.stageIndex : -1;
    dial.dataset.phase = active >= 0 ? 'running' : 'ended';
    const radiusPx = 0.965 * (dial.clientHeight || 600), degreesPerPx = 180 / Math.PI / radiusPx;
    // While a target is live, neighbors also clear its lit ±3° band.
    const gap = Math.max(markerGapPx * degreesPerPx, active >= 0 ? 3 + bandClearPx * degreesPerPx : 0);
    const shown = spreadAlongDial(state.targets, gap, active);
    for (let i = 0; i < state.targets.length; i++) {
      const angle = state.targets[i], radians = shown[i] * Math.PI / 180;
      const marker = document.getElementById('dial-target-' + i);
      const done = i < state.completedStages;
      marker.dataset.state = done ? 'done' : i === active ? 'active' : state.status === 'active' ? 'pending' : 'stopped';
      marker.style.left = (50 + Math.cos(radians) * 96.5 / 2) + '%';
      marker.style.top = (100 - Math.sin(radians) * 96.5) + '%';
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
  window.HingeAppearance = { setup, update, clear, challengeState, spreadAlongDial };
})();
