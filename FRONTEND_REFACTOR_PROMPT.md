# VAYU Frontend Complete Refactor — Copilot Implementation Prompt

## Context
You are refactoring the frontend for VAYU, India's AI-powered Climate Digital Twin (ISRO BAH 2026 hackathon, PS-5). The current frontend has critical bugs:
1. Globe appears at the BOTTOM of the screen instead of centered/fullscreen
2. No imagery loads (globe is dark/black) — likely Cesium Ion token or initialization issue
3. Extremely laggy — 1225 entity rectangles cause frame drops
4. No real climate data overlay visible

## YOUR TASK: Complete rewrite of the CesiumGlobe component and App layout

## Technical Stack
- React 18 + TypeScript + Vite
- CesiumJS 1.118 (via `cesium` npm package + `vite-plugin-cesium`)
- TailwindCSS 3.4
- Cesium Ion token in `.env`: `VITE_CESIUM_ION_TOKEN=eyJhbGci...` (already set and valid)
- No Google Maps API key yet (VITE_GOOGLE_MAPS_API_KEY is empty)

## Critical Fix 1: Globe Fullscreen

The Cesium viewer MUST fill the entire viewport. The current issue is that the viewer container div doesn't get proper dimensions. Fix:

```tsx
// CesiumGlobe.tsx — the container ref div MUST be:
<div ref={containerRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
```

And in App.tsx, the globe container must be:
```tsx
<div className="fixed inset-0 w-screen h-screen">
  <CesiumGlobe ... />
</div>
```

NOT `relative` or `absolute` within a flex container — use `fixed inset-0`.

## Critical Fix 2: Imagery Loading

The globe is black because:
1. The Cesium Ion token must be set BEFORE creating the Viewer
2. The terrain provider must be awaited properly
3. OSM Buildings tileset loading may block rendering

Fix initialization:
```tsx
useEffect(() => {
  if (!containerRef.current || viewerRef.current) return;
  
  // Token MUST be set before any Cesium operations
  Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
  
  const viewer = new Cesium.Viewer(containerRef.current, {
    terrainProvider: undefined, // We'll set it async below
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.IonImageryProvider.fromAssetId(2) // Bing aerial
    ),
    timeline: false,
    animation: false,
    // ... other options
  });
  
  // Set terrain AFTER viewer creation
  Cesium.CesiumTerrainProvider.fromIonAssetId(1).then(terrain => {
    viewer.terrainProvider = terrain;
  });
  
  // DO NOT load OSM buildings on init — too heavy, add only when zoomed in
}, []);
```

## Critical Fix 3: Performance — Replace Entity Grid with ImageryProvider

Instead of 1225 individual Entity rectangles (which murder the frame rate), render climate data as a SINGLE image overlay:

```tsx
// Create a Canvas-based ImageryProvider that renders the entire heatmap as one image
class ClimateHeatmapProvider {
  constructor(gridCells, variable, bounds) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 25;  // lon grid points
    this.canvas.height = 49; // lat grid points (or 57x23 for real data)
    this.renderHeatmap(gridCells, variable);
  }
  
  renderHeatmap(cells, variable) {
    const ctx = this.canvas.getContext('2d');
    // Paint each cell as a single pixel — Cesium stretches to globe
    for (const cell of cells) {
      const x = Math.round((cell.lon - 72.0) / 0.25);
      const y = Math.round((20.0 - cell.lat) / 0.25); // flip Y
      ctx.fillStyle = valueToColor(cell[variable], variable);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Then add as a SingleTileImageryProvider:
const imageryProvider = new Cesium.SingleTileImageryProvider({
  url: canvas.toDataURL(),
  rectangle: Cesium.Rectangle.fromDegrees(72.0, 8.0, 78.0, 20.0),
});
viewer.imageryLayers.addImageryProvider(imageryProvider);
```

This renders ALL 1225 cells as ONE imagery layer — zero entities, 60fps guaranteed.

## Critical Fix 4: Initial Camera — Cinematic Intro to India

```tsx
// Start from far space looking at Earth
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(78.9, 20.5, 15_000_000),
  orientation: { heading: 0, pitch: -Math.PI/2, roll: 0 }
});

// After 1 second, fly to Western Ghats
setTimeout(() => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(75.0, 14.0, 1_200_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-50), roll: 0 },
    duration: 4.0,
  });
}, 1000);
```

## App Layout Structure

```
┌─────────────────────────────────────────────────┐
│ [VAYU Logo] [Region] [Mode Tabs] [Status]       │  ← Header (fixed top, z-20)
├─────────────────────────────────────────────────┤
│                                                   │
│           ┌─────────────────────────┐             │
│           │                         │             │
│           │      CesiumJS Globe     │ [Right      │
│  [Left    │      (FULLSCREEN)       │  Panel]     │
│   Var     │                         │             │
│   Btns]   │                         │             │
│           │                         │             │
│           └─────────────────────────┘             │
│                                                   │
├─────────────────────────────────────────────────┤
│ [◄] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ [►]   │  ← Time Slider (fixed bottom)
│      1951            2000            2025         │
└─────────────────────────────────────────────────┘
```

All UI panels are `position: fixed` with high z-index, floating OVER the globe.
The globe itself is `position: fixed; inset: 0; z-index: 0`.

## File Changes Needed

1. `src/App.tsx` — Change globe container from `absolute inset-0` to `fixed inset-0`
2. `src/components/CesiumGlobe.tsx` — Complete rewrite using SingleTileImageryProvider
3. `src/index.css` — Ensure `.cesium-viewer { position: absolute; inset: 0; }`
4. `index.html` — Already correct (has height: 100% chain)

## NASA GIBS Layers (Free, No Key)

Add these as toggleable overlay layers:
```ts
const GIBS = {
  modis: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
  precipitation: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.png',
  clouds: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Cloud_Fraction_Day/default/{Time}/GoogleMapsCompatible/{z}/{y}/{x}.png',
};
// Replace {Time} with 'YYYY-MM-DD' format (e.g., '2024-06-15')
```

## Google Photorealistic 3D Tiles (Need API Key)

If VITE_GOOGLE_MAPS_API_KEY is set:
```ts
const tileset = await Cesium.Cesium3DTileset.fromUrl(
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`
);
viewer.scene.primitives.add(tileset);
```
Get a key at: https://console.cloud.google.com → APIs → Map Tiles API

## Mock Data

When backend is offline, load `/mock_prediction.json` which has 1225 grid cells with realistic Western Ghats monsoon data. The API client already has this fallback implemented.

## Performance Targets
- Globe loads and shows imagery within 3 seconds
- Climate heatmap renders in <500ms (single image, not entities)
- 60fps during pan/zoom/rotate
- No loading spinners longer than 5 seconds

## What Success Looks Like
- Open localhost:5173 → see space → cinematic fly to India (4s)
- Globe is centered, full screen, with satellite imagery
- Climate heatmap (temperature/rainfall) overlaid on Western Ghats
- Left panel: variable selector
- Right panel: context-dependent (prediction summary / What-If / metrics)
- Bottom: time slider
- Top: VAYU branding + status

## DO NOT
- Use entity rectangles for climate grid (too slow)
- Load OSM buildings on initial render (load only when zoomed to city level)
- Block the main thread during data loading
- Use `requestRenderMode` (causes blank frames on some GPUs)
