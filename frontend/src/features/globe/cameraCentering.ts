export interface CartesianLike {
  x: number;
  y: number;
  z: number;
}

export interface CenterFacingView {
  destination: CartesianLike;
  orientation: { direction: CartesianLike; up: CartesianLike };
}

const EPSILON_SQUARED = 1e-24;
// Normalizing an almost parallel projection amplifies floating-point error near
// the poles. Treat sub-microradian tangents as degenerate and use the next axis.
const MIN_PROJECTION_SQUARED = 1e-12;
const UNIT_Z = { x: 0, y: 0, z: 1 };
const UNIT_Y = { x: 0, y: 1, z: 0 };

const finite = (value: CartesianLike) =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const magnitudeSquared = (value: CartesianLike) => value.x ** 2 + value.y ** 2 + value.z ** 2;
const normalize = (value: CartesianLike): CartesianLike | null => {
  const lengthSquared = magnitudeSquared(value);
  if (!finite(value) || !Number.isFinite(lengthSquared) || lengthSquared <= EPSILON_SQUARED) return null;
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  return { x: value.x * inverseLength, y: value.y * inverseLength, z: value.z * inverseLength };
};
const projectOntoViewPlane = (value: CartesianLike, direction: CartesianLike) => {
  const alongDirection = value.x * direction.x + value.y * direction.y + value.z * direction.z;
  const projected = {
    x: value.x - alongDirection * direction.x,
    y: value.y - alongDirection * direction.y,
    z: value.z - alongDirection * direction.z,
  };
  if (!finite(projected) || magnitudeSquared(projected) <= MIN_PROJECTION_SQUARED) return null;
  return normalize(projected);
};

/** Computes a stable Earth-center-facing orientation without changing camera position or range. */
export function getCenterFacingView(positionWC: CartesianLike, upWC: CartesianLike): CenterFacingView {
  const direction = normalize({ x: -positionWC.x, y: -positionWC.y, z: -positionWC.z });
  if (!direction) throw new Error('Cannot center a camera with a non-finite or zero world position.');
  const up = projectOntoViewPlane(upWC, direction)
    ?? projectOntoViewPlane(UNIT_Z, direction)
    ?? projectOntoViewPlane(UNIT_Y, direction);
  if (!up) throw new Error('Cannot construct a finite camera up vector.');
  return {
    destination: { x: positionWC.x, y: positionWC.y, z: positionWC.z },
    orientation: { direction, up },
  };
}
