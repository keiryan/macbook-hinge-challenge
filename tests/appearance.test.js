'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { HingeChallenge } = require('../web/hinge-challenge.js');
const script = fs.readFileSync(path.join(__dirname, '../web/appearance.js'), 'utf8');

function fixture(options = {}) {
  const properties = new Map(), elements = new Map(), stored = new Map();
  if (options.saved !== undefined) stored.set('hinge-theme', options.saved);
  function element() {
    const attributes = new Map(), styles = new Map();
    return {
      dataset: {}, hidden: false, textContent: '',
      style: { setProperty: (name, value) => styles.set(name, value), getPropertyValue: name => styles.get(name) },
      setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name)
    };
  }
  const meta = element();
  const root = { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value) } };
  const document = { documentElement: root, querySelector: () => meta, getElementById: id => elements.get(id) || null };
  const localStorage = options.storage || { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const clock = { now: options.now ?? 0 };
  const context = vm.createContext({ window: {}, document, localStorage, Date: { now: () => clock.now } });
  vm.runInContext(script, context);
  return { root, meta, properties, stored, clock, api: context.window.HingeAppearance, controls() {
    for (const id of ['theme-toggle', 'theme-dark', 'theme-light']) elements.set(id, element());
    context.window.HingeAppearance.setup();
    return Object.fromEntries(elements);
  }, dial() {
    for (const id of ['challenge-dial', 'dial-range', ...[0, 1, 2].flatMap(i => ['dial-target-' + i, 'dial-number-' + i, 'dial-angle-' + i])]) elements.set(id, element());
    return Object.fromEntries(elements);
  } };
}

test('theme applies before controls exist, defaults dark, and honors only explicit saved palettes', () => {
  for (const [saved, expected, color] of [[undefined, 'dark', '#0b1018'], ['light', 'light', '#eef3f8'], ['dark', 'dark', '#0b1018'], ['system', 'dark', '#0b1018']]) {
    const f = fixture({ saved });
    assert.equal(f.root.dataset.theme, expected);
    assert.equal(f.meta.getAttribute('content'), color);
    assert.equal(f.root.dataset.sensorVisual, 'inactive');
  }
});

test('theme controls toggle, persist explicit choice, and expose matching accessible states', () => {
  const f = fixture(), controls = f.controls();
  assert.equal(controls['theme-dark'].getAttribute('aria-pressed'), 'true');
  controls['theme-toggle'].onclick();
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.stored.get('hinge-theme'), 'light');
  assert.equal(f.meta.getAttribute('content'), '#eef3f8');
  assert.equal(controls['theme-toggle'].getAttribute('aria-label'), 'Switch to dark mode');
  assert.equal(controls['theme-dark'].getAttribute('aria-pressed'), 'false');
  assert.equal(controls['theme-light'].getAttribute('aria-pressed'), 'true');
  controls['theme-dark'].onclick();
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.stored.get('hinge-theme'), 'dark');
  controls['theme-light'].onclick();
  assert.equal(f.root.dataset.theme, 'light');
});

test('blocked theme storage does not prevent initialization or user choice', () => {
  const f = fixture({ storage: { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } } });
  const controls = f.controls();
  assert.equal(f.root.dataset.theme, 'dark');
  assert.doesNotThrow(() => controls['theme-toggle'].onclick());
  assert.equal(f.root.dataset.theme, 'light');
});

test('accepted sensor angles set the lid angle while geometry alone clamps above 180 degrees', () => {
  const f = fixture();
  for (const [angle, lid] of [[0, '0deg'], [90, '90deg'], [180, '180deg'], [270, '180deg'], [360, '180deg']]) {
    assert.equal(f.api.update(angle), true);
    assert.equal(f.root.dataset.sensorVisual, 'active');
    assert.equal(f.properties.get('--lid-angle'), lid);
  }
});

test('invalid values cannot activate the sensor decoration and clear fades the lid out where it stood', () => {
  const f = fixture();
  for (const invalid of [NaN, Infinity, -1, 361, 89.5, '90', null]) assert.equal(f.api.update(invalid), false);
  assert.equal(f.root.dataset.sensorVisual, 'inactive');
  assert.equal(f.properties.has('--lid-angle'), false);
  f.api.update(120);
  f.api.clear();
  assert.equal(f.root.dataset.sensorVisual, 'inactive');
  assert.equal(f.properties.get('--lid-angle'), '120deg');
});

test('the lid opening plays on first reading and after a real pause, not after brief freshness gaps', () => {
  const f = fixture({ now: 1000 });
  f.api.update(100);
  assert.equal(f.root.dataset.lidEntrance, 'play');
  f.api.update(104);
  assert.equal(f.root.dataset.lidEntrance, 'play', 'continuous readings do not restart it');
  f.api.clear();
  assert.equal(f.root.dataset.lidEntrance, undefined);
  f.clock.now = 2500;
  f.api.clear();
  f.api.update(106);
  assert.equal(f.root.dataset.lidEntrance, undefined, 'a 1.5 s gap resumes in place');
  f.api.clear();
  f.clock.now = 4500;
  f.api.clear();
  f.api.update(108);
  assert.equal(f.root.dataset.lidEntrance, 'play', 'a 2 s pause replays the opening');
});

test('challenge markers share the lid geometry: 90 degrees above, lower angles right, higher angles left', () => {
  const f = fixture(), nodes = f.dial();
  const challenge = new HingeChallenge({ targets: [90, 65, 110], startedAt: 0 });
  f.api.challengeState(challenge.getState());
  assert.equal(nodes['challenge-dial'].hidden, false);
  assert.ok(Math.abs(parseFloat(nodes['dial-target-0'].style.left) - 50) < 1e-9);
  assert.ok(parseFloat(nodes['dial-target-0'].style.top) < 5);
  assert.ok(parseFloat(nodes['dial-target-1'].style.left) > 50);
  assert.ok(parseFloat(nodes['dial-target-2'].style.left) < 50);
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-angle-' + i].textContent), ['90°', '65°', '110°']);
  const range = nodes['dial-range'].getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  assert.ok(range.every(Number.isFinite));
  assert.ok(range[0] > 0 && range.at(-2) < 0, 'the ±3° target arc straddles the upright lid');
});

// Reads a marker's position back into dial polar coordinates.
function polar(node) {
  const x = (parseFloat(node.style.left) - 50) * 2, y = 100 - parseFloat(node.style.top);
  return { radius: Math.hypot(x, y), angle: Math.atan2(y, x) * 180 / Math.PI };
}

test('nearby or repeated targets stay on one ring, and the active one keeps its exact angle', () => {
  for (const thirdAngle of [75, 76, 79]) {
    const f = fixture(), nodes = f.dial();
    const challenge = new HingeChallenge({ targets: [75, 100, thirdAngle], startedAt: 0 });
    for (const [angle, time] of [[75, 0], [75, 500], [100, 600], [100, 1100]]) challenge.update(angle, time);
    f.api.challengeState(challenge.getState());
    assert.equal(nodes['dial-target-0'].dataset.state, 'done');
    assert.equal(nodes['dial-number-0'].textContent, '✓');
    assert.equal(nodes['dial-target-2'].dataset.state, 'active');
    assert.equal(nodes['dial-number-2'].textContent, '3');
    const markers = [0, 1, 2].map(i => polar(nodes['dial-target-' + i]));
    for (const marker of markers) assert.ok(Math.abs(marker.radius - 96.5) < 1e-9, 'every marker sits on the same ring');
    assert.ok(Math.abs(markers[2].angle - thirdAngle) < 1e-9, 'the active target is not displaced');
    assert.ok(Math.abs(markers[2].angle - markers[0].angle) >= 4.3, 'the nearby completed target moves aside along the ring');
    assert.equal(nodes['dial-angle-0'].textContent, '75°', 'a moved marker still names its true angle');
  }
});

test('markers spread only as far as needed, centering a close pair once no target is active', () => {
  const { api } = fixture();
  // The script runs in its own VM context; copy results into this realm's arrays.
  const spreadAlongDial = (...args) => [...api.spreadAlongDial(...args)];
  assert.deepEqual(spreadAlongDial([90, 65, 110], 4), [90, 65, 110], 'well separated targets never move');
  const ended = spreadAlongDial([67, 81, 68], 4);
  assert.equal(ended[1], 81);
  assert.ok(Math.abs(ended[0] - 65.5) < 1e-9 && Math.abs(ended[2] - 69.5) < 1e-9, 'the pair centers on 67.5°');
  const pinned = spreadAlongDial([67, 81, 68], 4, 2);
  assert.equal(pinned[2], 68);
  assert.equal(pinned[0], 64);
  const same = spreadAlongDial([75, 100, 75], 4);
  assert.ok(same[0] < same[2], 'identical angles keep a stable order: target 1 to the right of target 3');
  const chain = spreadAlongDial([70, 72, 74], 4, 1);
  assert.deepEqual(chain, [68, 72, 76], 'a cluster around the pinned marker grows outward on both sides');
});

test('during a run the dial is marked running so only the active target stays at full strength', () => {
  const f = fixture(), nodes = f.dial();
  const challenge = new HingeChallenge({ targets: [75, 100, 80], startedAt: 0 });
  f.api.challengeState(challenge.getState());
  assert.equal(nodes['challenge-dial'].dataset.phase, 'running');
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-target-' + i].dataset.state), ['active', 'pending', 'pending']);
  for (const [angle, time] of [[75, 0], [75, 500], [100, 600], [100, 1100], [80, 1200], [80, 1700]]) challenge.update(angle, time);
  f.api.challengeState(challenge.getState());
  assert.equal(nodes['challenge-dial'].dataset.phase, 'ended', 'all three return to full strength at the end');
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-target-' + i].dataset.state), ['done', 'done', 'done']);
});

test('pass, abort, and expiry never render a phantom active target from a null target value', () => {
  for (const ending of ['passed', 'aborted', 'expired']) {
    const f = fixture(), nodes = f.dial();
    const challenge = new HingeChallenge({ targets: [75, 100, 80], startedAt: 0 });
    challenge.update(75, 0); challenge.update(75, 500);
    if (ending === 'passed') {
      for (const [angle, time] of [[100, 600], [100, 1100], [80, 1200], [80, 1700]]) challenge.update(angle, time);
    } else if (ending === 'aborted') challenge.abort('test interruption');
    else challenge.tick(60000);
    const state = challenge.getState();
    assert.equal(state.status, ending);
    assert.equal(state.target, null);
    f.api.challengeState(state, false);
    assert.equal(nodes['dial-range'].style.display, 'none');
    assert.deepEqual([0, 1, 2].map(i => nodes['dial-target-' + i].dataset.state), ending === 'passed' ? ['done', 'done', 'done'] : ['done', 'stopped', 'stopped']);
    assert.equal(nodes['dial-number-0'].textContent, '✓');
    if (ending === 'passed') assert.equal(nodes['dial-number-2'].textContent, '✓');
  }
});

test('hiding and restarting the dial replaces previous target labels, completion, and hold feedback', () => {
  const f = fixture(), nodes = f.dial();
  const previous = new HingeChallenge({ targets: [75, 100, 80], startedAt: 0 });
  for (const [angle, time] of [[75, 0], [75, 500], [100, 600], [100, 1100], [80, 1200], [80, 1700]]) previous.update(angle, time);
  f.api.challengeState(previous.getState());
  f.api.challengeState(null);
  assert.equal(nodes['challenge-dial'].hidden, true);
  const next = new HingeChallenge({ targets: [90, 70, 105], startedAt: 2000 });
  f.api.challengeState(next.getState());
  assert.equal(nodes['challenge-dial'].hidden, false);
  assert.equal(nodes['dial-range'].style.display, '');
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-angle-' + i].textContent), ['90°', '70°', '105°']);
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-number-' + i].textContent), ['1', '2', '3']);
  assert.deepEqual([0, 1, 2].map(i => nodes['dial-target-' + i].dataset.state), ['active', 'pending', 'pending']);
  for (const i of [0, 1, 2]) assert.equal(nodes['dial-target-' + i].style.getPropertyValue('--hold-progress'), '0');
});

test('stale readings suppress current holding feedback while retaining completed stages and the target', () => {
  const f = fixture(), nodes = f.dial();
  const challenge = new HingeChallenge({ targets: [75, 100, 80], startedAt: 0 });
  for (const [angle, time] of [[75, 0], [75, 500], [100, 600], [100, 800]]) challenge.update(angle, time);
  const state = challenge.getState();
  assert.equal(state.holdProgress, 0.4);
  f.api.challengeState(state, true);
  assert.equal(nodes['dial-target-1'].style.getPropertyValue('--hold-progress'), '0.4');
  f.api.challengeState(state, false);
  assert.equal(nodes['dial-target-1'].style.getPropertyValue('--hold-progress'), '0');
  assert.equal(nodes['dial-target-1'].dataset.state, 'active');
  assert.equal(nodes['dial-range'].style.display, '');
  assert.equal(nodes['dial-target-0'].dataset.state, 'done');
  assert.equal(challenge.getState().holdProgress, 0.4, 'presentation does not mutate challenge evidence');
});
