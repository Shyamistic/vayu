import { describe, expect, it } from 'vitest';
import { getCenterFacingView } from './cameraCentering';

const magnitude = (value: { x: number; y: number; z: number }) =>
  Math.hypot(value.x, value.y, value.z);
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

describe('getCenterFacingView', () => {
  it('targets the Earth center while preserving exact destination and range', () => {
    const position = { x: 2_000_000, y: -4_000_000, z: 5_000_000 };
    const beforeRange = magnitude(position);
    const view = getCenterFacingView(position, { x: 0.1, y: 0.2, z: 0.97 });

    expect(view.destination).toEqual(position);
    expect(magnitude(view.destination)).toBe(beforeRange);
    expect(view.orientation.direction.x).toBeCloseTo(-position.x / beforeRange, 12);
    expect(view.orientation.direction.y).toBeCloseTo(-position.y / beforeRange, 12);
    expect(view.orientation.direction.z).toBeCloseTo(-position.z / beforeRange, 12);
  });

  it('returns finite unit orthogonal up vectors at and near both poles', () => {
    for (const position of [
      { x: 0, y: 0, z: 7_000_000 },
      { x: 0, y: 0, z: -7_000_000 },
      { x: 0.001, y: -0.002, z: 7_000_000 },
      { x: -0.001, y: 0.002, z: -7_000_000 },
    ]) {
      const { direction, up } = getCenterFacingView(position, { x: 0, y: 0, z: 1 }).orientation;
      expect([up.x, up.y, up.z].every(Number.isFinite)).toBe(true);
      expect(magnitude(direction)).toBeCloseTo(1, 12);
      expect(magnitude(up)).toBeCloseTo(1, 12);
      expect(dot(direction, up)).toBeCloseTo(0, 12);
    }
  });

  it('falls back safely when the current up vector is degenerate or non-finite', () => {
    for (const upInput of [{ x: 1, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: 1 }]) {
      const { direction, up } = getCenterFacingView({ x: 7_000_000, y: 0, z: 0 }, upInput).orientation;
      expect(magnitude(up)).toBeCloseTo(1, 12);
      expect(dot(direction, up)).toBeCloseTo(0, 12);
    }
  });
});
