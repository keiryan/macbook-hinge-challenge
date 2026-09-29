'use strict';
// Synthetic measurements are restricted to these unit tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const { HingeChallenge, generateTargets } = require('../web/hinge-challenge.js');
const challenge = (overrides = {}) => new HingeChallenge({ targets: [75, 100, 80], startedAt: 0, ...overrides });

test('three real-report stages work at the direct sensor cadence of 1 Hz', () => {
  const c = challenge();
  for (const [angle, now] of [[75, 0], [75, 1000], [100, 2000], [100, 3000], [80, 4000], [80, 5000]]) c.update(angle, now);
  assert.equal(c.getState(5000).status, 'passed');
  assert.equal(c.getState(5000).completedStages, 3);
  assert.equal(c.update(20, 70000).status, 'passed');
});

test('60 Hz reports can finish a hold, while a timer alone cannot', () => {
  const c = challenge();
  c.update(75, 0);
  assert.equal(c.tick(600).completedStages, 0);
  assert.equal(c.getState(600).holdProgress, 0);
  for (let now = 610; now <= 1110; now += 10) c.update(75, now);
  assert.equal(c.getState(1110).completedStages, 1);
});

test('movement out of tolerance restarts the hold', () => {
  const c = challenge();
  c.update(75, 0);
  c.update(79, 400);
  c.update(75, 600);
  assert.equal(c.update(75, 1000).completedStages, 0);
  assert.equal(c.update(75, 1100).completedStages, 1);
});

test('stale reports cannot accumulate time across an interrupted stream', () => {
  const c = challenge();
  c.update(75, 0);
  assert.equal(c.getState(1300).holdSamples, 0);
  assert.equal(c.update(75, 2000).completedStages, 0);
  assert.equal(c.update(75, 3000).completedStages, 1);
});

test('duplicate and backward timestamps do not count as new samples', () => {
  const c = challenge({ minSamples: 3 });
  c.update(75, 100);
  c.update(75, 700);
  c.update(75, 700);
  c.update(75, 600);
  assert.equal(c.getState(700).holdSamples, 2);
  assert.equal(c.getState(700).completedStages, 0);
  assert.equal(c.update(75, 800).completedStages, 1);
});

test('a completed stage cannot reuse its final report for the next stage', () => {
  const c = challenge({ targets: [75, 75] });
  c.update(75, 0);
  assert.equal(c.update(75, 500).completedStages, 1);
  assert.equal(c.getState(500).holdSamples, 0);
  c.update(75, 1000);
  assert.equal(c.getState(1000).status, 'active');
  assert.equal(c.update(75, 1500).status, 'passed');
});

test('timeout is visible without reports and cannot be passed at the deadline', () => {
  const c = challenge({ targets: [75], timeoutMs: 1000 });
  c.update(75, 0);
  assert.equal(c.getState(1000).status, 'expired');
  assert.equal(c.status, 'active', 'getState is read-only');
  assert.equal(c.update(75, 1000).status, 'expired');
  assert.equal(c.getState(1100).remainingMs, 0);
  assert.equal(c.getState(1100).completedStages, 0);
});

test('abort is terminal until reset starts a fresh attempt', () => {
  const c = challenge();
  c.update(75, 0);
  assert.equal(c.abort('sensor-disconnected').reason, 'sensor-disconnected');
  assert.equal(c.update(75, 1000).status, 'aborted');
  c.reset({ startedAt: 2000, targets: [90] });
  assert.equal(c.getState(2000).lastAngle, null);
  c.update(90, 2000);
  assert.equal(c.update(90, 2500).status, 'passed');
});

test('invalid samples and a mutated returned target list cannot grant success', () => {
  const c = challenge();
  c.getState(0).targets[0] = 20;
  c.update(NaN, 0);
  c.update(361, 10);
  c.update(20, 20);
  assert.equal(c.getState(20).target, 75);
  assert.equal(c.getState(20).holdSamples, 0);
});

test('targets remain in a conservative range with distinct physical moves', () => {
  for (let current = 0; current <= 360; current++) {
    for (const randomInt of [() => 0, n => n - 1, n => Math.floor(n / 2)]) {
      const targets = generateTargets(current, randomInt);
      assert.equal(targets.length, 3);
      let previous = current;
      for (const target of targets) {
        assert.ok(target >= 65 && target <= 110);
        assert.ok(Math.abs(target - previous) >= 12);
        previous = target;
      }
    }
  }
  assert.throws(() => generateTargets(90, n => n), RangeError);
});
