# Frontend Runbook

## 1) Local launch

From repo root:

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## 2) Required environment variables

Create or update `frontend/.env` with:

```env
VITE_API_URL=http://localhost:8000
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token_here
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

Notes:
- `VITE_GOOGLE_MAPS_API_KEY` is optional for app startup.
- If the Google key is missing or invalid, the globe still works with world terrain fallback.

## 3) Backend requirement for live data

Run backend before opening metrics/prediction UI:

```powershell
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## 4) Validation checklist

- App loads without blank screen.
- Region selector appears in top bar.
- Metrics mode shows model comparison panel.
- Prediction mode loads grid overlays.
- Bottom-left globe status badge appears:
  - `3D terrain loaded` when Google tiles load, or
  - `World terrain active — add GOOGLE_MAPS_API_KEY for 3D cities` fallback.

## 5) Production build

```powershell
cd frontend
npm run build
```

Expected output:
- TypeScript compile succeeds.
- Vite build succeeds.
- Large chunk warning is acceptable currently due to Cesium/Plotly payload size.
