export type AuditViewportId = 'desktop-1440x900' | 'desktop-1280x720' | 'tablet-768x1024' | 'mobile-390x844' | 'mobile-360x740';
export type AuditState = 'initial-load' | 'drawer-open' | 'focused-globe' | 'region-change' | 'empty-data' | 'error-data';
export interface Rect { x: number; y: number; width: number; height: number; }
export interface AuditViewport { id: AuditViewportId; width: number; height: number; isDesktop: boolean; }
export interface ControlContract { expected: Rect; tolerancePx: number; rule: string; baseline?: Rect; status?: 'known-baseline-defect'; }
export interface AuditCase {
  id: string;
  viewport: AuditViewport;
  state: AuditState;
  screenshot: string;
  video: string;
  interaction: string;
  dataFixture?: string;
  controls: Record<string, ControlContract>;
}

export const VIEWPORTS: readonly AuditViewport[] = [
  { id: 'desktop-1440x900', width: 1440, height: 900, isDesktop: true },
  { id: 'desktop-1280x720', width: 1280, height: 720, isDesktop: true },
  { id: 'tablet-768x1024', width: 768, height: 1024, isDesktop: true },
  { id: 'mobile-390x844', width: 390, height: 844, isDesktop: false },
  { id: 'mobile-360x740', width: 360, height: 740, isDesktop: false },
] as const;

export const AUDIT_STATES: readonly AuditState[] = [
  'initial-load', 'drawer-open', 'focused-globe', 'region-change', 'empty-data', 'error-data',
] as const;

const HEADER_HEIGHT = 56;
const TIMELINE_HEIGHT = 140;
const BOTTOM_CLEARANCE = 16;
const DESKTOP_DRAWER_RESERVATION = 392;
const DESKTOP_DRAWER_WIDTH = 380;
const MOBILE_DRAWER_VIEWPORT_FRACTION = 0.3;

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

function drawerIsOpen(state: AuditState): boolean {
  return state === 'drawer-open' || state === 'empty-data' || state === 'error-data';
}

function disclosureFor(viewport: AuditViewport, timeline: Rect): ControlContract {
  const width = Math.min(320, viewport.width - 32);
  const target = rect((viewport.width - width) / 2, timeline.y - 40, width, 32);
  return {
    expected: target,
    tolerancePx: 4,
    rule: 'Demo / simulated and request-error disclosures must clear the timeline by at least 8px.',
    baseline: rect((viewport.width - width) / 2, viewport.height - 160, width, 32),
    status: 'known-baseline-defect',
  };
}

function controlsFor(viewport: AuditViewport, state: AuditState): Record<string, ControlContract> {
  if (state === 'focused-globe') {
    return {
      'globe-viewport': { expected: rect(0, 0, viewport.width, viewport.height), tolerancePx: 0, rule: 'Focus mode restores the full browser viewport to the globe.' },
      'show-panels': { expected: rect(viewport.width - 132, 12, 120, 32), tolerancePx: 16, rule: 'The focus-mode restore affordance remains visible and reachable.' },
    };
  }

  const open = drawerIsOpen(state);
  const timelineRight = viewport.isDesktop && open ? DESKTOP_DRAWER_RESERVATION : 4;
  const timeline = rect(viewport.isDesktop ? 84 : 16, viewport.height - TIMELINE_HEIGHT, viewport.width - (viewport.isDesktop ? 84 : 16) - timelineRight, TIMELINE_HEIGHT);
  const mobileDrawerHeight = Math.ceil(viewport.height * MOBILE_DRAWER_VIEWPORT_FRACTION);
  const globeBottom = !viewport.isDesktop && open ? mobileDrawerHeight + BOTTOM_CLEARANCE : TIMELINE_HEIGHT + BOTTOM_CLEARANCE;
  const globeRight = viewport.isDesktop && open ? DESKTOP_DRAWER_RESERVATION : 0;
  const controls: Record<string, ControlContract> = {
    header: { expected: rect(0, 0, viewport.width, HEADER_HEIGHT), tolerancePx: 8, rule: 'Persistent header occupies the top measured chrome band.' },
    'globe-viewport': { expected: rect(0, HEADER_HEIGHT, viewport.width - globeRight, viewport.height - HEADER_HEIGHT - globeBottom), tolerancePx: 1, rule: 'Globe bounds equal App safe-area insets: measured header, timeline or mobile drawer, and 16px bottom clearance.' },
    timeline: { expected: timeline, tolerancePx: 8, rule: 'Timeline remains within the viewport and reserves the desktop drawer lane when open.' },
  };
  if (open) {
    controls.drawer = viewport.isDesktop
      ? { expected: rect(viewport.width - DESKTOP_DRAWER_WIDTH, HEADER_HEIGHT, DESKTOP_DRAWER_WIDTH, viewport.height - HEADER_HEIGHT), tolerancePx: 8, rule: 'Desktop/tablet drawer is right-aligned below the header.' }
      : { expected: rect(0, viewport.height - mobileDrawerHeight, viewport.width, mobileDrawerHeight), tolerancePx: 8, rule: 'Mobile drawer is a 30dvh bottom sheet.' };
  }
  if (state === 'empty-data' || state === 'error-data') controls['data-disclosure'] = disclosureFor(viewport, timeline);
  return controls;
}

function interactionFor(state: AuditState): string {
  switch (state) {
    case 'initial-load': return 'Dismiss or wait for intro, then wait for the initial All India / Pilot overview to settle.';
    case 'drawer-open': return 'Activate the header menu (desktop/tablet) or climate data sheet control (mobile).';
    case 'focused-globe': return 'Activate the empty-globe focus gesture, then verify the Show panels restore control.';
    case 'region-change': return 'Select North-East India from the header region selector after the Pilot overview has settled.';
    case 'empty-data': return 'Intercept the prediction response with prediction-empty.json and open the data surface.';
    case 'error-data': return 'Fail both prediction and mock-prediction requests with prediction-error.json and open the data surface.';
  }
}

function dataFixtureFor(state: AuditState): string | undefined {
  if (state === 'empty-data') return 'prediction-empty.json';
  if (state === 'error-data') return 'prediction-error.json';
  return undefined;
}

export const AUDIT_CASES: readonly AuditCase[] = VIEWPORTS.flatMap((viewport) =>
  AUDIT_STATES.map((state) => ({
    id: `${viewport.id}--${state}`,
    viewport,
    state,
    screenshot: `media/screenshots/${viewport.id}/${state}.png`,
    video: `media/videos/${viewport.id}/${state}.webm`,
    interaction: interactionFor(state),
    dataFixture: dataFixtureFor(state),
    controls: controlsFor(viewport, state),
  })),
);

export const VIDEO_WALKTHROUGHS = VIEWPORTS.map((viewport) => ({
  viewport: viewport.id,
  path: `media/walkthroughs/${viewport.id}.webm`,
  durationSeconds: 35,
  states: AUDIT_STATES,
  rule: 'One continuous recording covers initial load, drawer, focused globe, region change, empty data, and error data.',
}));

export const REGION_CHANGE_CONTRACT = {
  from: 'full_india',
  to: 'north_east_india',
  bounds: { latMin: 22, latMax: 29.5, lonMin: 88, lonMax: 97.5 },
  rule: 'North-East must remain readable above the timeline within the measured clear globe rectangle; no manual altitude baseline is accepted.',
} as const;

export const AUDIT_BASELINE_NOTES = [
  'The 392px desktop safe-area reservation is 12px wider than the current 380px drawer; retain that measured gap in baseline review.',
  'The current demo/error disclosure baseline is 12px into the 140px timeline band; this fixture records the defect and the future non-overlap contract without changing UI behavior.',
  'The current mobile bottom sheet and timeline share the lower viewport; capture the overlap before a later overlay-coordinator change.',
] as const;
