/**
 * Globe feature module — public API
 */

export { default as CesiumGlobe } from './CesiumGlobe';
export type { CesiumGlobeProps } from './CesiumGlobe';
export { default as SplitViewContainer } from './SplitViewContainer';
export type { SplitViewContainerProps, SplitViewCameraState } from './SplitViewContainer';
export {
  clampDividerPosition,
  computeLeftWidth,
  syncCamera,
  MIN_DIVIDER_POSITION,
  MAX_DIVIDER_POSITION,
  DEFAULT_DIVIDER_POSITION,
} from './SplitViewContainer';
export { LayerRegistry } from './LayerRegistry';
export type { LayerPlugin, LayerState, LayerConfig } from './types';
