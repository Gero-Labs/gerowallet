// Sheet motion physics, Apple fluid-interfaces style.
// - Spring: semi-implicit Euler on {value, velocity}. Parameters are the
//   designer pair (dampingRatio, response) instead of mass/stiffness/damping.
// - projectMomentum: exponential-decay momentum projection (decel 0.998),
//   the same form iOS scroll deceleration uses.
// - rubberBand: asymptotic edge resistance (constant 0.55, iOS feel).

export function projectMomentum(velocityPxPerSec: number, decelerationRate = 0.998): number {
  return ((velocityPxPerSec / 1000) * decelerationRate) / (1 - decelerationRate);
}

export function rubberBand(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export interface SpringConfig {
  initialValue: number;
  dampingRatio?: number; // 1.0 = critically damped (no overshoot), <1 bounces
  response?: number;     // seconds; lower = snappier. NOT a duration.
}

export function createSpring(config: SpringConfig) {
  let value = config.initialValue;
  let velocity = 0;
  let target = config.initialValue;
  const dampingRatio = config.dampingRatio ?? 1.0;
  const response = config.response ?? 0.3;

  const omega = (2 * Math.PI) / response; // natural frequency
  const k = omega * omega;                // stiffness (unit mass)
  const c = 2 * dampingRatio * omega;     // damping coefficient

  const SETTLE_V = 0.1;  // px/s
  const SETTLE_X = 0.5;  // px

  return {
    getValue: () => value,
    getVelocity: () => velocity,
    getTarget: () => target,
    setValue(v: number) { value = v; velocity = 0; },
    setTarget(t: number, initialVelocity?: number) {
      target = t;
      if (initialVelocity !== undefined) velocity = initialVelocity;
    },
    isSettled(): boolean {
      return Math.abs(velocity) < SETTLE_V && Math.abs(value - target) < SETTLE_X;
    },
    /** Advance by dt seconds (clamped to 1/30s per sub-step for stability). */
    step(dt: number) {
      let remaining = Math.min(dt, 1); // never simulate more than 1s per call
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 30);
        const accel = -k * (value - target) - c * velocity;
        velocity += accel * h;          // semi-implicit Euler: v first,
        value += velocity * h;          // then x with the NEW v (stable)
        remaining -= h;
      }
      if (this.isSettled()) {
        value = target;
        velocity = 0;
      }
    },
  };
}
