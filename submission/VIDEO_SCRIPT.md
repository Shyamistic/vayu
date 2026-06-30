# MAUSAM — Video Submission Script
## Bharatiya Antariksh Hackathon 2026 | PS-5: AI-Powered Climate Digital Twin
### Duration: 3 minutes 45 seconds

---

## PRODUCTION NOTES

- **Tone:** Confident, scientific, visually stunning — like a DRDO/ISRO tech demo
- **Music:** Subtle cinematic ambient (low, builds toward end) — think Interstellar-lite
- **Recording:** Screen record the live dashboard + architecture diagrams + Kaggle training + code
- **Voice:** Clear, measured pace. NOT rushed. Every sentence should land.

---

## SCENE 1: THE HOOK (0:00 – 0:25)
**[VISUAL: Earth from space → zoom into India → monsoon clouds swirling over Western Ghats]**
*(Use the CesiumJS globe opening animation — the cinematic camera fly-in from space to India)*

**NARRATION:**

> "Every year, monsoon variability costs India 14 billion dollars in agricultural losses. 800 lives are lost to floods, droughts, and heat waves — not because we lack data, but because we lack the ability to simulate our climate system in real time.
>
> This is MAUSAM — India's first AI-powered Climate Digital Twin."

**[VISUAL: Dashboard title card appears — "MAUSAM: Multi-scale Atmospheric Understanding through Spatio-temporal AI Modeling"]**

---

## SCENE 2: THE PROBLEM (0:25 – 0:55)
**[VISUAL: Split screen — left: IMD weather station map of India. Right: EU's DestinE platform screenshot]**

**NARRATION:**

> "Europe built Destination Earth — a billion-euro digital twin of Earth's climate. India has 75 years of IMD gridded observations, ISRO's INSAT satellite constellation, and one of the densest weather networks on the planet — yet we have no national Climate Digital Twin.
>
> Problem Statement 5 asks us to change that. Build a scalable, AI-driven framework that fuses India's national datasets into a living, breathing replica of our climate system — capable of real-time prediction and 'What-If' simulation."

**[VISUAL: Quick flash of PS-5 slide from mentor session → transition to architecture]**

---

## SCENE 3: ARCHITECTURE (0:55 – 1:40)
**[VISUAL: Animated architecture diagram — data flows left to right]**

**NARRATION:**

> "MAUSAM is built on four pillars.
>
> **First — Data Fusion.** We ingest 15 years of IMD gridded rainfall at 0.25-degree resolution, daily max-min temperature, INSAT-3D land and sea surface temperature from MOSDAC, NCEP 850-hectopascal wind fields, and CHIRPS satellite precipitation — totaling over 110 megabytes of processed NetCDF covering 1,225 spatial nodes across the Western Ghats pilot region."

**[VISUAL: Data source logos animate in: IMD → MOSDAC/INSAT → NCEP → CHIRPS]**

> "**Second — The AI Engine.** Our model, VayuClimateModel, combines a Graph Neural Network — specifically three-layer GraphSAGE — that captures spatial relationships like orographic rainfall enhancement and monsoon flow patterns, with a four-layer Temporal Transformer that attends over a 30-day input window using multi-head self-attention."

**[VISUAL: Graph network visualization showing nodes connected over Western Ghats terrain → Transformer attention heatmap animation]**

> "The graph has 1,225 nodes with 8-connectivity edges encoding geographic distance, elevation differential, and prevailing wind direction. The model takes 11 input features per node and produces 7-day forecasts for rainfall, maximum temperature, and minimum temperature — with Monte Carlo dropout providing calibrated uncertainty bounds."

**[VISUAL: Model architecture block diagram: GraphSAGE → Transformer → Prediction Heads]**

> "**Third — Physics-Informed Training.** Our loss function isn't just MSE. We enforce water balance conservation across spatial cells and spatial smoothness constraints — preventing the model from producing physically impossible climate states."

---

## SCENE 4: VALIDATION (1:40 – 2:10)
**[VISUAL: Kaggle training notebook → validation plots → R² bar chart]**

**NARRATION:**

> "We trained for 27 epochs on a single GPU using the Western Ghats pilot region — 2010 to 2020 for training, 2021 to 2023 for validation. Results:"

**[VISUAL: Clean metrics card — large numbers]**

> "Temperature Maximum: R-squared 0.82 — explaining 82 percent of climate variance.
> Temperature Minimum: R-squared 0.79.
> Rainfall: R-squared 0.20 — a positive skill score, beating both persistence and random baselines for monsoon prediction."

**[VISUAL: Side-by-side comparison — Predicted vs Observed heatmaps showing monsoon July (wet) vs January (dry)]**

> "The model correctly identifies seasonal monsoon onset, coastal orographic enhancement along the Western Ghats ridge, and winter dry periods — entirely from learned representations, no hand-coded rules."

**[VISUAL: Graph showing monsoon Jul=41.87 mm/day prediction vs Jan=4.45 mm/day — seasonal discrimination]**

---

## SCENE 5: LIVE DASHBOARD DEMO (2:10 – 3:00)
**[VISUAL: Screen recording of the deployed MAUSAM dashboard]**

**NARRATION:**

> "Now — the deployed system. This is running live on AWS, accessible via a public URL."

**[VISUAL: CesiumJS globe spinning to Western Ghats, satellite imagery loading, heatmap appearing]**

> "A CesiumJS 3D globe with real-time satellite imagery from NASA GIBS. The climate prediction heatmap overlays 1,152 grid cells of real model output — color-coded by IMD operational rainfall categories."

**[VISUAL: Drag timeline slider from January 2020 → July 2023. Heatmap visibly changes from dry (green) to heavy monsoon (blue/purple)]**

> "As we move through time, the model generates fresh predictions for each date — running real inference on our trained checkpoint. Watch the monsoon activate."

**[VISUAL: Click Tmax variable → heatmap changes to temperature gradient. Click Tmin → changes again]**

> "Switch between rainfall, maximum temperature, minimum temperature — each with dedicated color scales matching IMD operational standards."

**[VISUAL: Open What-If panel → Temperature Rise +4°C → Run Scenario → Split screen shows baseline vs scenario with red delta overlay]**

> "The What-If engine. Apply a four-degree temperature offset — the scenario propagates through the trained model and shows delta impacts per grid cell. Red indicates positive change, blue indicates cooling. Twenty hotspot cells identified exceeding the 90th percentile impact threshold."

**[VISUAL: Open hamburger menu → scroll through: India Climate Stats, Model Info Card, Flood Risk, Drought SPI, Monsoon Tracker]**

> "The dashboard includes real-time India climate statistics, flood risk assessment, drought SPI monitoring, monsoon onset tracking, and a complete model architecture card — giving scientists full transparency into the prediction pipeline."

---

## SCENE 6: SCALABILITY & IoT VISION (3:00 – 3:30)
**[VISUAL: Architecture diagram showing pilot region → national expansion. IoT sensor CAD design]**

**NARRATION:**

> "The framework is designed for national scalability. Our graph architecture naturally extends — add more nodes, the GNN adapts. We've validated on Western Ghats and prepared the full India dataset covering 10,000+ grid points.
>
> For ground truth validation, we've designed a distributed IoT sensor network — ESP32-based weather stations measuring temperature, humidity, and rainfall every 15 minutes. In the finals, we'll deploy two to three units for live field validation against model predictions."

**[VISUAL: IoT sensor panel from the dashboard showing simulated sensor nodes across Western Ghats]**

---

## SCENE 7: CLOSING — WHY MAUSAM WINS (3:30 – 3:45)
**[VISUAL: Summary card with key differentiators. Dashboard in background.]**

**NARRATION:**

> "MAUSAM is not a notebook. It is not a dashboard with static data. It is a fully deployed, production-grade AI system running real inference on India's national datasets — accessible to anyone with a browser.
>
> The first Climate Digital Twin built for India, by India.
>
> Thank you."

**[VISUAL: Live URL appears on screen: vayu-frontend-275688773412.s3-website.ap-south-1.amazonaws.com]**
**[VISUAL: Team name + "Bharatiya Antariksh Hackathon 2026 — PS-5"]**

---

## APPENDIX: B-ROLL SHOTS TO CAPTURE

1. **Globe zoom-in** — Space → India → Western Ghats (use Tour button, 5 sec)
2. **Timeline scrub** — Drag slider from 2015 to 2023, show heatmap changing
3. **Variable switching** — Click Rainfall → Tmax → Tmin in sequence
4. **What-If scenario** — Run Temperature Rise +4°C, show split screen
5. **3D mode** — Click 3D button for extruded rainfall columns
6. **Wind particles** — Toggle wind layer on
7. **Region selector** — Click different regions
8. **Metrics panel** — Open hamburger → scroll through Prediction view panels
9. **Inspect mode** — Click Inspect → click a cell → show CellInfoCard popup
10. **Kaggle notebook** — Quick scroll through training code (3 sec)
11. **Architecture diagram** — Full-screen for 5 seconds
12. **Backend /docs** — Flash the Swagger API docs page (2 sec)
13. **Terminal** — Show `docker push` and `cdk deploy` output (1 sec flash for credibility)

---

## KEY PHRASES TO HIT (Judge Trigger Words)

- "National datasets" (IMD, MOSDAC, INSAT)
- "Graph Neural Network + Temporal Transformer"
- "Physics-informed loss"
- "Monte Carlo uncertainty quantification"
- "7-day forecast horizon"
- "What-If scenario simulation"
- "CesiumJS 3D visualization"
- "Deployed and accessible via public URL"
- "Scalable to national level"
- "0.25-degree resolution, 1,225 grid nodes"
- "R² = 0.82 for temperature"
- "15 years of historical data (2010-2025)"

---

## TIMING BREAKDOWN

| Segment | Duration | Visual |
|---------|----------|--------|
| Hook | 25s | Globe zoom + stats |
| Problem | 30s | IMD map + DestinE comparison |
| Architecture | 45s | Animated diagram + model blocks |
| Validation | 30s | Training plots + R² metrics |
| Live Demo | 50s | Dashboard screen recording |
| Scalability + IoT | 30s | Expansion diagram + sensor design |
| Closing | 15s | Summary + URL + team |
| **TOTAL** | **3:45** | |

---

## RECORDING TIPS

1. Record dashboard at 1920×1080, 60fps
2. Use OBS or screen recorder with mic overlay
3. Record narration SEPARATELY (clean audio) → sync in editor
4. Architecture diagram: make in Figma/draw.io, export as PNG, animate with zoom/pan
5. Add subtle transitions (fade, zoom) between scenes — NOT flashy
6. Lower-third text for key numbers (R²=0.82, 1225 nodes, 7-day forecast)
7. End with the live URL clearly visible for 5 seconds
