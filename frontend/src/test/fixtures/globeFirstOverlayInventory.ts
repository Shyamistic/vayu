/**
 * Static audit for Task 0.2. This records current behavior only; it must not
 * become a runtime overlay coordinator or alter App-owned surface behavior.
 */
export type OverlaySurfaceId =
  | 'app-header' | 'desktop-variable-toolbar' | 'mobile-floating-controls' | 'timeline'
  | 'drawer' | 'extreme-alerts' | 'request-notices' | 'scenario-comparison-ribbon'
  | 'focus-mode-restore' | 'cell-info-card' | 'guided-tour' | 'cinematic-intro'
  | 'drawer-panels' | 'export-toast' | 'keyboard-hint' | 'command-palette' | 'shortcut-overlay';

/** Intended coordinator role; `drawer-content` is deliberately outside its visibility state. */
export type IntendedOverlayRole =
  | 'persistent-hud' | 'non-modal-sheet' | 'non-modal-panel' | 'inspect-card'
  | 'intro' | 'transient-toast' | 'drawer-content' | 'modal-dialog';
export type AppMountStatus = 'mounted-by-app' | 'not-mounted-by-app';
export type CurrentModalBehavior = 'not-modal' | 'modal-semantics-without-focus-isolation';
export type CurrentFocusBehavior =
  | 'native-control-focus-only' | 'global-escape-close-without-restoration'
  | 'focus-first-input-without-trap-or-restoration' | 'no-focus-management';

export interface OverlayInventoryEntry {
  id: OverlaySurfaceId;
  component: string;
  source: string;
  appMountStatus: AppMountStatus;
  trigger: string;
  currentStacking: string;
  currentModalBehavior: CurrentModalBehavior;
  currentFocusBehavior: CurrentFocusBehavior;
  viewportFootprint: { desktop: string; mobile: string };
  intendedRole: IntendedOverlayRole;
  notes: string;
}

const appSurface = (entry: Omit<OverlayInventoryEntry, 'appMountStatus'>): OverlayInventoryEntry => ({
  ...entry, appMountStatus: 'mounted-by-app',
});

export const APP_OVERLAY_INVENTORY: readonly OverlayInventoryEntry[] = [
  appSurface({
    id: 'app-header', component: 'App header', source: 'App.tsx', trigger: 'Always rendered; hidden by focusMode.',
    currentStacking: 'fixed; Tailwind z-[1000].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Full width top band; measured as 56px baseline.', mobile: 'Full width top band; measured as 56px baseline.' }, intendedRole: 'persistent-hud', notes: 'Contains region, health, tour, language, and drawer triggers.',
  }),
  appSurface({
    id: 'desktop-variable-toolbar', component: 'App variable toolbar', source: 'App.tsx', trigger: 'Always rendered at md+; hidden by focusMode.',
    currentStacking: 'fixed; Tailwind z-[1000].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Left rail from 72px top to 64px bottom; scrollable.', mobile: 'Not rendered.' }, intendedRole: 'persistent-hud', notes: 'Variable, terrain, 3D, wind, and inspect commands.',
  }),
  appSurface({
    id: 'mobile-floating-controls', component: 'App mobile floating controls', source: 'App.tsx', trigger: 'Always rendered below md; hidden by focusMode.',
    currentStacking: 'fixed; Tailwind z-[1000].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Not rendered.', mobile: 'Three 40px controls at left 12px, top 68px.' }, intendedRole: 'persistent-hud', notes: 'Opens/toggles drawer and inspect mode.',
  }),
  appSurface({
    id: 'timeline', component: 'TimeSlider with ForecastAnimation and ColorLegend', source: 'App.tsx → components/TimeSlider.tsx', trigger: 'Always rendered; prediction controls conditional on viewMode.',
    currentStacking: 'fixed; Tailwind z-[1000]; right inset changes when drawer opens.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Bottom band from left 84px; reserves 392px while drawer is open.', mobile: 'Bottom band from left/right 16px; overlaps mobile drawer in current baseline.' }, intendedRole: 'persistent-hud', notes: 'Swipe handling is owned by App.',
  }),
  appSurface({
    id: 'drawer', component: 'App right drawer', source: 'App.tsx', trigger: 'Header hamburger or mobile data/menu controls toggle drawerOpen.',
    currentStacking: 'fixed; Tailwind z-[1000]; transform/visibility slide.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Right 380px from below 56px header to viewport bottom.', mobile: 'Full-width 30dvh bottom sheet.' }, intendedRole: 'non-modal-sheet', notes: 'Uses aria-hidden when closed but has no Escape close, focus trap, or focus restoration.',
  }),
  appSurface({
    id: 'extreme-alerts', component: 'ExtremeAlerts', source: 'components/ExtremeAlerts.tsx', trigger: 'Derived threshold alert from App prediction grid cells and variable.',
    currentStacking: 'fixed; Tailwind z-[998].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Top 80px, horizontally centered, max 420px/80vw.', mobile: 'Same top-centered 80vw constraint.' }, intendedRole: 'transient-toast', notes: 'Individually dismissible; no live region or focus movement.',
  }),
  appSurface({
    id: 'request-notices', component: 'App error, simulated-data, and loading notices', source: 'App.tsx', trigger: 'Prediction request error/loading state or mock model result.',
    currentStacking: 'fixed; Tailwind z-[1001].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Centered; loading at top 80px, other notices at bottom 128px.', mobile: 'Same fixed anchors and can collide with lower chrome.' }, intendedRole: 'transient-toast', notes: 'No dismissal, aria-live region, or collision policy.',
  }),
  appSurface({
    id: 'scenario-comparison-ribbon', component: 'App scenario comparison labels', source: 'App.tsx', trigger: 'Visible when showSplitScreen and activeScenario are true.',
    currentStacking: 'fixed; Tailwind z-[999].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Centered at top 64px.', mobile: 'Same top-centered strip.' }, intendedRole: 'persistent-hud', notes: 'Read-only context marker.',
  }),
  appSurface({
    id: 'focus-mode-restore', component: 'App focus-mode restore button', source: 'App.tsx', trigger: 'Visible only while focusMode is true.',
    currentStacking: 'fixed; Tailwind z-[1000].', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Top-right compact control.', mobile: 'Top-right compact control.' }, intendedRole: 'persistent-hud', notes: 'Only remaining App chrome in globe focus mode.',
  }),
  appSurface({
    id: 'cell-info-card', component: 'CellInfoCard', source: 'components/CellInfoCard.tsx', trigger: 'Inspect-mode click or globe long press sets selectedCell; global Escape or close button clears it.',
    currentStacking: 'fixed; Tailwind z-[1003]; pixel-positioned from globe event.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'global-escape-close-without-restoration',
    viewportFootprint: { desktop: '224px card offset from selected cell and clamped only by fixed viewport arithmetic.', mobile: 'Same 224px card; no safe-area or keyboard collision handling.' }, intendedRole: 'inspect-card', notes: 'Does not capture focus or make background inert.',
  }),
  appSurface({
    id: 'guided-tour', component: 'GuidedTour', source: 'components/GuidedTour.tsx', trigger: 'Header Tour button toggles showTour; App blocks start while drawer is open.',
    currentStacking: 'fixed; Tailwind z-[1004] when active.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'global-escape-close-without-restoration',
    viewportFootprint: { desktop: '360px max 40vw, right 16px, bottom 180px.', mobile: 'Same max 40vw rule; can become too narrow and conflicts with lower chrome.' }, intendedRole: 'non-modal-panel', notes: 'Header contains a separate inactive launcher instance; active panel has no dialog semantics.',
  }),
  appSurface({
    id: 'cinematic-intro', component: 'CinematicIntro', source: 'design-system/CinematicIntro.tsx', trigger: 'First visit localStorage check or forceShow; auto-dismisses or Skip button dismisses.',
    currentStacking: 'fixed inset 0; inline zIndex: 9999.', currentModalBehavior: 'modal-semantics-without-focus-isolation', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Entire viewport.', mobile: 'Entire viewport.' }, intendedRole: 'intro', notes: 'role=dialog and aria-modal=true, but no focus trap, initial focus, restoration, or coordinator collision policy.',
  }),
  appSurface({
    id: 'drawer-panels', component: 'LayerControlPanel, WhatIfStudio, view-mode panels, and IMDAlertBanner', source: 'App.tsx drawer children', trigger: 'Rendered inside the open drawer; view-mode panels depend on viewMode.',
    currentStacking: 'No independent fixed layer; inherits the drawer stacking context.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'native-control-focus-only',
    viewportFootprint: { desktop: 'Scrollable content within 380px drawer.', mobile: 'Scrollable content within 30dvh bottom sheet.' }, intendedRole: 'drawer-content', notes: 'No current App-mounted panel is a standalone viewport dialog; IMDAlertBanner is inline drawer content, not ExtremeAlerts.',
  }),
  appSurface({
    id: 'export-toast', component: 'ExportTools local toast', source: 'components/ExportTools.tsx', trigger: 'Screenshot/CSV/JSON success or export failure; clears after 2.5 seconds.',
    currentStacking: 'No independent fixed layer; inside ExportTools drawer panel.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Inline within drawer content.', mobile: 'Inline within drawer content.' }, intendedRole: 'drawer-content', notes: 'Not a viewport toast despite its local state name.',
  }),
  appSurface({
    id: 'keyboard-hint', component: 'KeyboardHint', source: 'App.tsx', trigger: 'Mounted at startup and self-dismisses after 8 seconds.',
    currentStacking: 'fixed; Tailwind z-[999]; pointer-events-none.', currentModalBehavior: 'not-modal', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Fixed at 38% left and 170px from bottom.', mobile: 'Same desktop-oriented positioning; no responsive constraint.' }, intendedRole: 'transient-toast', notes: 'Informational only; cannot receive focus.',
  }),
  {
    id: 'command-palette', component: 'CommandPalette', source: 'features/platform/CommandPalette.tsx', appMountStatus: 'not-mounted-by-app', trigger: 'Component supports Ctrl+K through its own hook, but App.tsx does not render it.',
    currentStacking: 'fixed inset 0; inline zIndex: 9000.', currentModalBehavior: 'modal-semantics-without-focus-isolation', currentFocusBehavior: 'focus-first-input-without-trap-or-restoration',
    viewportFootprint: { desktop: 'Full scrim; centered max-width 580px panel at 12vh.', mobile: 'Full scrim; 92vw panel.' }, intendedRole: 'modal-dialog', notes: 'Included as a command-surface audit candidate, not as a current App overlay.',
  },
  {
    id: 'shortcut-overlay', component: 'ShortcutOverlay inside CommandPalette', source: 'features/platform/CommandPalette.tsx', appMountStatus: 'not-mounted-by-app', trigger: 'The unmounted CommandPalette opens it from ? shortcut.',
    currentStacking: 'fixed inset 0; inline zIndex: 9999.', currentModalBehavior: 'modal-semantics-without-focus-isolation', currentFocusBehavior: 'no-focus-management',
    viewportFootprint: { desktop: 'Full scrim; centered 92vw/max 680px and 80vh panel.', mobile: 'Same 92vw/80vh dialog.' }, intendedRole: 'modal-dialog', notes: 'Backdrop and close button work, but focus is neither trapped nor restored.',
  },
] as const;

export const REQUIRED_OVERLAY_SURFACE_IDS: readonly OverlaySurfaceId[] = [
  'app-header', 'desktop-variable-toolbar', 'mobile-floating-controls', 'timeline', 'drawer', 'extreme-alerts', 'request-notices', 'scenario-comparison-ribbon', 'focus-mode-restore', 'cell-info-card', 'guided-tour', 'cinematic-intro', 'drawer-panels', 'export-toast', 'keyboard-hint', 'command-palette', 'shortcut-overlay',
] as const;

export function overlayInventoryById(id: OverlaySurfaceId): OverlayInventoryEntry {
  const entry = APP_OVERLAY_INVENTORY.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Missing overlay inventory entry: ${id}`);
  return entry;
}
