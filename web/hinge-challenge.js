(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.HingeChallenge = api.HingeChallenge;
    root.generateTargets = api.generateTargets;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The caller supplies an unbiased integer in [0, maxExclusive), normally
  // backed by crypto.getRandomValues with rejection sampling.
  function generateTargets(currentAngle, randomInt) {
    if (typeof randomInt !== 'function') throw new TypeError('An unbiased randomInt(maxExclusive) callback is required.');
    const targets = [];
    let previous = Number.isFinite(currentAngle) ? currentAngle : null;
    for (let stage = 0; stage < 3; stage++) {
      const choices = [];
      for (let angle = 65; angle <= 110; angle++) {
        if (previous === null || Math.abs(angle - previous) >= 12) choices.push(angle);
      }
      const index = randomInt(choices.length);
      if (!Number.isInteger(index) || index < 0 || index >= choices.length) throw new RangeError('randomInt returned an out-of-range integer.');
      previous = choices[index];
      targets.push(previous);
    }
    return targets;
  }

  class HingeChallenge {
    constructor(options) { this.reset(options); }

    // A reset requires a new monotonic start time. Other omitted settings can
    // be retained when reusing an instance; supply fresh targets per attempt.
    reset(options) {
      if (!options || !Number.isFinite(options.startedAt) || options.startedAt < 0) throw new TypeError('A nonnegative monotonic startedAt is required.');
      const config = Object.assign({ timeoutMs: 60000, tolerance: 3, holdMs: 500, maxGapMs: 1250, minSamples: 2 }, this.config || {}, options);
      if (!Array.isArray(config.targets) || !config.targets.length || config.targets.some(angle => !Number.isFinite(angle) || angle < 0 || angle > 360)) throw new TypeError('targets must contain valid angles.');
      for (const name of ['timeoutMs', 'holdMs', 'maxGapMs']) {
        if (!Number.isFinite(config[name]) || config[name] <= 0) throw new RangeError(name + ' must be positive.');
      }
      if (!Number.isFinite(config.tolerance) || config.tolerance < 0) throw new RangeError('tolerance must be nonnegative.');
      if (!Number.isInteger(config.minSamples) || config.minSamples < 2) throw new RangeError('minSamples must be at least two.');
      config.targets = config.targets.slice();
      this.config = config;
      this.status = 'active';
      this.reason = null;
      this.stageIndex = 0;
      this.lastAngle = null;
      this.lastReportAt = null;
      this.lastClock = config.startedAt;
      this.finishedAt = null;
      this._clearHold();
      return this.getState(config.startedAt);
    }

    _clearHold() {
      this.holdStartedAt = null;
      this.holdLastAt = null;
      this.holdSamples = 0;
    }

    _time(now) {
      if (!Number.isFinite(now)) throw new TypeError('A finite monotonic timestamp is required.');
      return Math.max(now, this.lastClock);
    }

    // Display timers may call tick; it can expire or clear a stale hold, but
    // cannot advance a stage. Only update() can count a sensor report.
    tick(now) {
      now = this._time(now);
      this.lastClock = now;
      if (this.status === 'active') {
        if (now - this.config.startedAt >= this.config.timeoutMs) {
          this.status = 'expired';
          this.reason = 'time-limit';
          this.finishedAt = this.config.startedAt + this.config.timeoutMs;
          this._clearHold();
        } else if (this.holdLastAt !== null && now - this.holdLastAt > this.config.maxGapMs) {
          this._clearHold();
        }
      }
      return this.getState(now);
    }

    update(angle, now) {
      const staleTimestamp = Number.isFinite(now) && (now < this.lastClock || (this.lastReportAt !== null && now <= this.lastReportAt));
      this.tick(now);
      if (this.status !== 'active' || staleTimestamp || !Number.isFinite(angle) || angle < 0 || angle > 360) return this.getState(now);
      this.lastAngle = angle;
      this.lastReportAt = now;
      if (Math.abs(angle - this.config.targets[this.stageIndex]) > this.config.tolerance) {
        this._clearHold();
        return this.getState(now);
      }
      if (this.holdStartedAt === null) this.holdStartedAt = now;
      this.holdLastAt = now;
      this.holdSamples++;
      if (this.holdSamples >= this.config.minSamples && now - this.holdStartedAt >= this.config.holdMs) {
        this.stageIndex++;
        this._clearHold();
        if (this.stageIndex === this.config.targets.length) {
          this.status = 'passed';
          this.finishedAt = now;
        }
      }
      // Even overlapping target ranges require a later report for the next
      // stage; the report that finished this stage is never reused.
      return this.getState(now);
    }

    abort(reason = 'aborted') {
      if (this.status === 'active') {
        this.status = 'aborted';
        this.reason = String(reason);
        this.finishedAt = this.lastClock;
        this._clearHold();
      }
      return this.getState(this.lastClock);
    }

    // Read-only: derive timeout/staleness even if the display has not ticked.
    // Holding progress comes from received reports, never the display clock.
    getState(now = this.lastClock) {
      now = this._time(now);
      const expired = this.status === 'active' && now - this.config.startedAt >= this.config.timeoutMs;
      const status = expired ? 'expired' : this.status;
      const freshHold = status === 'active' && this.holdLastAt !== null && now - this.holdLastAt <= this.config.maxGapMs;
      const elapsedMs = Math.max(0, (this.finishedAt === null ? now : this.finishedAt) - this.config.startedAt);
      const holdSamples = freshHold ? this.holdSamples : 0;
      const holdDuration = freshHold ? this.holdLastAt - this.holdStartedAt : 0;
      return {
        status,
        targets: this.config.targets.slice(),
        stageIndex: this.stageIndex,
        target: status === 'active' ? this.config.targets[this.stageIndex] : null,
        completedStages: this.stageIndex,
        totalStages: this.config.targets.length,
        holdProgress: freshHold ? Math.min(1, holdDuration / this.config.holdMs, holdSamples / this.config.minSamples) : 0,
        holdSamples,
        elapsedMs: Math.min(this.config.timeoutMs, elapsedMs),
        remainingMs: Math.max(0, this.config.timeoutMs - elapsedMs),
        lastAngle: this.lastAngle,
        lastReportAt: this.lastReportAt,
        reason: expired ? 'time-limit' : this.reason
      };
    }
  }

  HingeChallenge.generateTargets = generateTargets;
  return { HingeChallenge, generateTargets };
});
