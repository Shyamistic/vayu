# Globe-first camera-transition audit worksheet

**Task 0.5 — audit only.** `globeFirstCameraTransitionAudit.ts` is the typed, tested source of truth for this worksheet. It documents current behavior and deliberately does not introduce a controller or change Cesium runtime behavior.

## Scope and source path

The active path is `App.tsx → components/AsyncCesiumGlobe.tsx → components/CesiumGlobe.tsx`. `App` measures header, timeline, and drawer geometry with `ResizeObserver`, window resize, and a media query; it converts those measurements to `viewportKey`. The globe effect only calls `viewer.resize()` and `scene.requestRender()` for that key.

A separate `features/globe/CesiumGlobe.tsx` plugin shell contains `setView`, `setView`, and `flyTo`, but the App imports the component lazy wrapper and no active production import of that plugin shell was found. It is recorded as a static-audit limitation, not combined with the active table.

## Camera-transition table

| Caller | Active camera calls | Actual priority | Actual cancellation | Actual completion | Main conflict |
|---|---|---|---|---|---|
| Initial space frame | `setView` | Mount-time only; later writers supersede it | None | Synchronous | Intro timer overwrites it |
| Intro overview | `cancelFlight` → `flyToBoundingSphere` | Scheduled last writer wins at 800ms | Cancels any active programmatic flight | `complete`/`cancel` clear animation ref | Can replace early region selection; visual intro is unrelated |
| Region sync | `cancelFlight` → `flyToBoundingSphere` | Last programmatic writer wins | Cancels any active programmatic flight | `complete`/`cancel` clear animation ref | Intro/tour can replace it |
| Guided tour | `cancelFlight` → `flyTo` | Last programmatic writer wins | Cancels active flight; closing tour does not cancel an active flight | `complete`/`cancel` clear animation ref; auto-advance is timer-based | Two mounted tour instances; region does not stop tour scheduling |
| `preRender` auto-pitch | `setView` | Per-frame idle writer | None; yields only while local animation flag is true | No terminal state | Continuously changes high-altitude manual orientation |
| Resize handling | none (`resize`, `requestRender`) | Layout-only | None | No camera completion | Renders through existing races; does not reframe |
| Mouse handlers | none | No App ownership signal | None | Synchronous picking only | Does not suppress auto-pitch after manual interaction |
| Touch handlers | none | No App ownership signal | Only long-press timer cancels | Long-press callback only | Pinch/pan has no cooldown or automatic-write suppression |

## Manual verification worksheet

| Check | Procedure | Current expected observation | Record |
|---|---|---|---|
| Intro versus region | Select a region within 800ms of globe initialization | Scheduled overview may cancel/replace the region flight | viewport, timestamp, final target |
| Region versus tour | Start tour, select region, then allow auto-advance | Region wins briefly; a later tour step can fly again | step, final target |
| Tour close | Start a long tour flight, immediately close the panel | In-flight flight continues because clear `tourStep` does not call `cancelFlight` | duration until settled |
| Manual high-altitude rotate | Zoom above 4,000km and rotate/tilt with mouse | `preRender` repeatedly nudges pitch toward −85° | heading/pitch before/after |
| Manual pinch | At high altitude, pan/pinch while holding one/two fingers | Cesium gestures work; no manual-interaction/cooldown gate prevents auto-pitch | device, pitch movement |
| Drawer/device resize | Open/close drawer or rotate device after manual framing | Canvas resizes without intentional camera flight; record any visual framing side effect | viewport, orientation |

## Findings retained for Wave 1

1. There is no single priority or intent owner: both flight helpers cancel whichever programmatic flight is currently active.
2. `CinematicIntro` is a separate 5-second visual overlay; skip, returning visitor, and `onComplete` do not govern the Cesium 800ms opening flight.
3. The initial region effect avoids its default first run, but an explicit early region action can still be overwritten by the pending intro timer.
4. `preRender` auto-pitch is the direct manual-camera conflict: it has no input detection or cooldown and mutates pitch every eligible render.
5. Mouse/touch handlers coexist with enabled Cesium controls but never announce manual camera intent. These are evidence for Tasks 1.6–1.10, not implementation work for this audit.
