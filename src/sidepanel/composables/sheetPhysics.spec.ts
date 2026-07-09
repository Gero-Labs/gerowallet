import { describe, it, expect } from 'vitest';
import { projectMomentum, rubberBand, createSpring } from './sheetPhysics';

describe('projectMomentum', () => {
  it('matches the exponential-decay projection formula', () => {
    // v=1000px/s, decel 0.998 → (1000/1000)*0.998/(1-0.998) = 499
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
  });
  it('is sign-preserving', () => {
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0);
    expect(projectMomentum(0)).toBe(0);
  });
});

describe('rubberBand', () => {
  it('is asymptotic: approaches but never reaches the full dimension', () => {
    // As overshoot -> infinity, x*d*c/(d+c*x) -> d (not d*c) — verify it gets
    // close to but stays strictly under the dimension itself.
    const result = rubberBand(100000, 600);
    expect(result).toBeLessThan(600);
    expect(result).toBeGreaterThan(600 * 0.9);
  });
  it('is near-linear for small overshoot', () => {
    expect(rubberBand(10, 600)).toBeGreaterThan(4);
    expect(rubberBand(10, 600)).toBeLessThan(10);
  });
  it('is sign-preserving', () => {
    expect(rubberBand(-50, 600)).toBeLessThan(0);
  });
});

describe('createSpring', () => {
  function settle(spring: ReturnType<typeof createSpring>, target: number, v0 = 0) {
    spring.setTarget(target, v0);
    let t = 0;
    while (!spring.isSettled() && t < 10) {
      spring.step(1 / 60);
      t += 1 / 60;
    }
    return { value: spring.getValue(), time: t };
  }

  it('converges to the target from rest (critically damped)', () => {
    const s = createSpring({ initialValue: 300, dampingRatio: 1, response: 0.3 });
    const r = settle(s, 0);
    expect(Math.abs(r.value)).toBeLessThan(1);
    expect(r.time).toBeLessThan(2);
  });

  it('never overshoots when critically damped from rest', () => {
    const s = createSpring({ initialValue: 300, dampingRatio: 1, response: 0.3 });
    s.setTarget(0, 0);
    let min = 300;
    for (let i = 0; i < 600 && !s.isSettled(); i++) {
      s.step(1 / 60);
      min = Math.min(min, s.getValue());
    }
    expect(min).toBeGreaterThanOrEqual(-0.5);
  });

  it('can be retargeted mid-flight and converges to the new target', () => {
    const s = createSpring({ initialValue: 300, dampingRatio: 1, response: 0.3 });
    s.setTarget(0, 0);
    for (let i = 0; i < 6; i++) s.step(1 / 60); // 100ms in
    const r = settle(s, 500); // interrupt: new target, keeps current velocity
    expect(Math.abs(r.value - 500)).toBeLessThan(1);
  });

  it('clamps huge dt so a background tab cannot explode the sim', () => {
    const s = createSpring({ initialValue: 300, dampingRatio: 1, response: 0.3 });
    s.setTarget(0, 0);
    s.step(5); // 5 seconds "frame"
    expect(Number.isFinite(s.getValue())).toBe(true);
    expect(Math.abs(s.getValue())).toBeLessThanOrEqual(300);
  });
});
