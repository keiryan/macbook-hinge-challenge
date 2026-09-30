'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../web/appearance.js'), 'utf8');

function fixture(options = {}) {
  const properties = new Map(), elements = new Map(), stored = new Map();
  if (options.saved !== undefined) stored.set('hinge-theme', options.saved);
  function element() {
    const attributes = new Map();
    return { setAttribute: (name, value) => attributes.set(name, value), getAttribute: name => attributes.get(name) };
  }
  const meta = element();
  const root = { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value) } };
  const document = { documentElement: root, querySelector: () => meta, getElementById: id => elements.get(id) || null };
  const localStorage = options.storage || { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const context = vm.createContext({ window: {}, document, localStorage });
  vm.runInContext(script, context);
  return { root, meta, properties, stored, api: context.window.HingeAppearance, controls() {
    for (const id of ['theme-toggle', 'theme-dark', 'theme-light']) elements.set(id, element());
    context.window.HingeAppearance.setup();
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

test('accepted sensor angles map to the horizon while geometry alone clamps above 180 degrees', () => {
  const f = fixture();
  for (const [angle, y, tilt] of [[0, '82%', '19.8deg'], [90, '50%', '0deg'], [180, '18%', '-19.8deg'], [270, '18%', '-19.8deg'], [360, '18%', '-19.8deg']]) {
    assert.equal(f.api.update(angle), true);
    assert.equal(f.root.dataset.sensorVisual, 'active');
    assert.equal(f.properties.get('--horizon-y'), y);
    assert.equal(f.properties.get('--horizon-tilt'), tilt);
  }
});

test('invalid values cannot activate the sensor decoration and clear restores neutral geometry', () => {
  const f = fixture();
  for (const invalid of [NaN, Infinity, -1, 361, 89.5, '90', null]) assert.equal(f.api.update(invalid), false);
  assert.equal(f.root.dataset.sensorVisual, 'inactive');
  f.api.update(120);
  f.api.clear();
  assert.equal(f.root.dataset.sensorVisual, 'inactive');
  assert.equal(f.properties.get('--horizon-y'), '50%');
  assert.equal(f.properties.get('--horizon-tilt'), '0deg');
});
