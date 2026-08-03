# Globe-first viewport audit worksheet

**Task:** 0.1 — audit-only baseline. These fixtures document current geometry; they do not change application behavior.

## Fixture inventory

`globeFirstViewportAudit.ts` defines **30 screenshot records**: five viewport baselines × initial load, drawer open, focused globe, North-East region change, empty response, and request error. Each row has a unique expected PNG path and WebM path. It also defines five continuous 35-second walkthroughs—one per viewport—that visit every state in order.

| ID | viewport | CSS breakpoint |
|---|---:|---|
| desktop-1440x900 | 1440 × 900 | desktop |
| desktop-1280x720 | 1280 × 720 | desktop |
| tablet-768x1024 | 768 × 1024 | desktop (`min-width: 768px`) |
| mobile-390x844 | 390 × 844 | mobile |
| mobile-360x740 | 360 × 740 | mobile |

Media paths are intentionally stable: `media/screenshots/<viewport>/<state>.png`, `media/videos/<viewport>/<state>.webm`, and `media/walkthroughs/<viewport>.webm`. The repository currently has no browser screenshot runner, so the paths are a checked-in capture manifest for a human/browser-capable runner rather than fabricated image/video binaries.

## Capture procedure

1. Start `npm run dev`, use a clean browser profile, and set the exact CSS viewport from the table. Record at device scale factor 1 with browser chrome excluded.
2. Let the intro settle or dismiss it, wait for the camera and request state to settle, then follow the fixture's `interaction` text. Use `pilot → north_east_india` for every region-change capture.
3. For empty data, serve `prediction-empty.json` for the prediction request. For error data, fail both the API request and `/mock_prediction.json` with the `detail` in `prediction-error.json`; otherwise the existing fallback converts API failures to simulated data.
4. Capture the PNG after transitions finish. Capture the walkthrough in this order: initial load → drawer open → focused globe → restore panels → region change → empty data → error data.
5. Compare rendered control rectangles to the `expected` bounds, allowing each control's `tolerancePx`; write actual measurements and pass/fail notes alongside the media in review tooling.

## Expected control-bound contracts

- Header: 56px top band (±8px). Normal globe bounds begin below it.
- Normal globe: `top = 56`; `bottom = timeline height (140) + 16px`; desktop open drawer also reserves 392px on the right. Focus mode restores `0,0,width,height`.
- Timeline: desktop/tablet begins at x=84; mobile at x=16; it is 140px tall (±8px) and desktop/tablet reserve 392px when the drawer is open.
- Drawer: desktop/tablet is right-aligned, 380px wide, below the header. Mobile is a 30dvh bottom sheet. The region-change target is the authoritative North-East extent: 22–29.5°N, 88–97.5°E.
- Empty/error disclosures: target bounds must clear the timeline by 8px. The fixture separately preserves the present baseline bounds because they overlap the timeline band by 12px; resolving that is explicitly outside Task 0.1.

## Baseline findings to preserve for later comparison

1. The safe-area implementation reserves 392px but the visible desktop drawer is 380px, leaving a 12px visual gap.
2. Demo/simulated and error disclosures use `bottom: 8rem`; their current baseline overlaps the 140px timeline band by 12px. The contract records the non-overlap target without applying it.
3. On mobile, the 30dvh drawer and bottom timeline occupy the same lower viewport. Capture this overlap at both mobile sizes; do not redesign it in this audit task.
