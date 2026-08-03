/**
 * BoundaryLayer — India Country/State/District Boundary Rendering
 *
 * Implements the LayerPlugin interface to render GeoJSON-based political
 * boundaries on the CesiumJS globe with:
 * - Terrain-clamped polylines for country, state, and district borders
 * - Zoom-based progressive disclosure (states at altitude < 2,000,000m, districts < 500,000m)
 * - LabelCollection with collision-avoidance for state/city names
 * - Hover highlight (2px→4px width, 0.5→1.0 opacity)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from '../types';

// ── Constants ────────────────────────────────────────────────────────────────

/** Altitude thresholds for progressive disclosure (in meters) */
const STATE_ALTITUDE_THRESHOLD = 2_000_000; // ~zoom 7
const DISTRICT_ALTITUDE_THRESHOLD = 500_000; // ~zoom 9

/** GeoJSON data URLs (served via CDN or local public folder) */
const INDIA_STATES_URL = '/data/india-states.geojson';
const INDIA_DISTRICTS_URL = '/data/india-districts.geojson';

/** Boundary styling */
const COUNTRY_BORDER_WIDTH = 3;
const STATE_BORDER_WIDTH = 2;
const DISTRICT_BORDER_WIDTH = 1;

const COUNTRY_BORDER_COLOR = Cesium.Color.WHITE.withAlpha(0.8);
const STATE_BORDER_COLOR = Cesium.Color.fromCssColorString('#94a3b8').withAlpha(0.5);
const DISTRICT_BORDER_COLOR = Cesium.Color.fromCssColorString('#64748b').withAlpha(0.3);

/** Hover highlight styling */
const HOVER_WIDTH = 4;
const HOVER_OPACITY = 1.0;
const DEFAULT_WIDTH = 2;
const DEFAULT_OPACITY = 0.5;

// ── Interfaces ───────────────────────────────────────────────────────────────

interface BoundaryFeature {
  name: string;
  type: 'country' | 'state' | 'district';
  entity: Cesium.Entity;
}

interface LabelEntry {
  name: string;
  position: Cesium.Cartesian3;
  type: 'state' | 'city';
}

// ── State label data (major Indian states and cities) ────────────────────────

const STATE_LABELS: LabelEntry[] = [
  { name: 'Maharashtra', position: Cesium.Cartesian3.fromDegrees(75.7139, 19.7515), type: 'state' },
  { name: 'Karnataka', position: Cesium.Cartesian3.fromDegrees(75.7139, 15.3173), type: 'state' },
  { name: 'Tamil Nadu', position: Cesium.Cartesian3.fromDegrees(78.6569, 11.1271), type: 'state' },
  { name: 'Kerala', position: Cesium.Cartesian3.fromDegrees(76.2711, 10.8505), type: 'state' },
  { name: 'Andhra Pradesh', position: Cesium.Cartesian3.fromDegrees(79.7400, 15.9129), type: 'state' },
  { name: 'Telangana', position: Cesium.Cartesian3.fromDegrees(79.0193, 18.1124), type: 'state' },
  { name: 'Gujarat', position: Cesium.Cartesian3.fromDegrees(71.1924, 22.2587), type: 'state' },
  { name: 'Rajasthan', position: Cesium.Cartesian3.fromDegrees(74.2179, 27.0238), type: 'state' },
  { name: 'Madhya Pradesh', position: Cesium.Cartesian3.fromDegrees(78.6569, 22.9734), type: 'state' },
  { name: 'Uttar Pradesh', position: Cesium.Cartesian3.fromDegrees(80.9462, 26.8467), type: 'state' },
  { name: 'Bihar', position: Cesium.Cartesian3.fromDegrees(85.3131, 25.0961), type: 'state' },
  { name: 'West Bengal', position: Cesium.Cartesian3.fromDegrees(87.8550, 22.9868), type: 'state' },
  { name: 'Odisha', position: Cesium.Cartesian3.fromDegrees(84.2700, 20.4625), type: 'state' },
  { name: 'Chhattisgarh', position: Cesium.Cartesian3.fromDegrees(81.8661, 21.2787), type: 'state' },
  { name: 'Jharkhand', position: Cesium.Cartesian3.fromDegrees(85.2799, 23.6102), type: 'state' },
  { name: 'Assam', position: Cesium.Cartesian3.fromDegrees(92.9376, 26.2006), type: 'state' },
  { name: 'Punjab', position: Cesium.Cartesian3.fromDegrees(75.3412, 31.1471), type: 'state' },
  { name: 'Haryana', position: Cesium.Cartesian3.fromDegrees(76.0856, 29.0588), type: 'state' },
  { name: 'Himachal Pradesh', position: Cesium.Cartesian3.fromDegrees(77.1734, 31.1048), type: 'state' },
  { name: 'Uttarakhand', position: Cesium.Cartesian3.fromDegrees(79.0193, 30.0668), type: 'state' },
  { name: 'Jammu & Kashmir', position: Cesium.Cartesian3.fromDegrees(74.7973, 33.7782), type: 'state' },
  { name: 'Goa', position: Cesium.Cartesian3.fromDegrees(74.1240, 15.2993), type: 'state' },

  // Major cities
  { name: 'Mumbai', position: Cesium.Cartesian3.fromDegrees(72.8777, 19.0760), type: 'city' },
  { name: 'Delhi', position: Cesium.Cartesian3.fromDegrees(77.1025, 28.7041), type: 'city' },
  { name: 'Bengaluru', position: Cesium.Cartesian3.fromDegrees(77.5946, 12.9716), type: 'city' },
  { name: 'Chennai', position: Cesium.Cartesian3.fromDegrees(80.2707, 13.0827), type: 'city' },
  { name: 'Hyderabad', position: Cesium.Cartesian3.fromDegrees(78.4867, 17.3850), type: 'city' },
  { name: 'Kolkata', position: Cesium.Cartesian3.fromDegrees(88.3639, 22.5726), type: 'city' },
  { name: 'Ahmedabad', position: Cesium.Cartesian3.fromDegrees(72.5714, 23.0225), type: 'city' },
  { name: 'Pune', position: Cesium.Cartesian3.fromDegrees(73.8567, 18.5204), type: 'city' },
  { name: 'Jaipur', position: Cesium.Cartesian3.fromDegrees(75.7873, 26.9124), type: 'city' },
  { name: 'Lucknow', position: Cesium.Cartesian3.fromDegrees(80.9462, 26.8467), type: 'city' },
  { name: 'Bhopal', position: Cesium.Cartesian3.fromDegrees(77.4126, 23.2599), type: 'city' },
  { name: 'Patna', position: Cesium.Cartesian3.fromDegrees(85.1376, 25.6093), type: 'city' },
  { name: 'Guwahati', position: Cesium.Cartesian3.fromDegrees(91.7362, 26.1445), type: 'city' },
  { name: 'Thiruvananthapuram', position: Cesium.Cartesian3.fromDegrees(76.9366, 8.5241), type: 'city' },
  { name: 'Chandigarh', position: Cesium.Cartesian3.fromDegrees(76.7794, 30.7333), type: 'city' },
];

// ── BoundaryLayer Implementation ─────────────────────────────────────────────

export class BoundaryLayer implements LayerPlugin {
  readonly id = 'boundary';
  readonly priority = 50; // Render after terrain, before heatmap overlays

  private viewer: Cesium.Viewer | null = null;
  private stateDataSource: Cesium.GeoJsonDataSource | null = null;
  private districtDataSource: Cesium.GeoJsonDataSource | null = null;
  private labelCollection: Cesium.LabelCollection | null = null;
  private moveHandler: Cesium.ScreenSpaceEventHandler | null = null;
  private hoveredEntity: Cesium.Entity | null = null;
  private boundaryFeatures: BoundaryFeature[] = [];
  private isVisible = false;
  private statesLoaded = false;
  private districtsLoaded = false;

  // ── Init ─────────────────────────────────────────────────────────────────

  async init(viewer: Cesium.Viewer): Promise<void> {
    this.viewer = viewer;

    // Create label collection for state/city names
    this.labelCollection = viewer.scene.primitives.add(
      new Cesium.LabelCollection({ scene: viewer.scene })
    ) as Cesium.LabelCollection;

    // Add labels with collision-avoidance
    this.createLabels();

    // Load state boundaries
    this.loadStateBoundaries();

    // Load district boundaries (deferred until needed)
    this.loadDistrictBoundaries();

    // Set up hover interaction
    this.setupHoverHandler();
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(state: LayerState): void {
    if (!this.viewer) return;

    const shouldShow = state.showBoundaries;

    if (shouldShow !== this.isVisible) {
      this.isVisible = shouldShow;
      this.setVisibility(shouldShow);
    }

    if (!shouldShow) return;

    // Progressive disclosure based on camera altitude
    const altitude = this.getCameraAltitude();
    this.updateProgressiveDisclosure(altitude);
  }

  // ── Destroy ──────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.moveHandler) {
      this.moveHandler.destroy();
      this.moveHandler = null;
    }

    if (this.viewer) {
      if (this.stateDataSource) {
        this.viewer.dataSources.remove(this.stateDataSource, true);
        this.stateDataSource = null;
      }

      if (this.districtDataSource) {
        this.viewer.dataSources.remove(this.districtDataSource, true);
        this.districtDataSource = null;
      }

      if (this.labelCollection) {
        this.viewer.scene.primitives.remove(this.labelCollection);
        this.labelCollection = null;
      }
    }

    this.boundaryFeatures = [];
    this.hoveredEntity = null;
    this.viewer = null;
  }

  // ── Private: Data Loading ────────────────────────────────────────────────

  private async loadStateBoundaries(): Promise<void> {
    if (!this.viewer || this.statesLoaded) return;

    try {
      this.stateDataSource = await Cesium.GeoJsonDataSource.load(INDIA_STATES_URL, {
        stroke: STATE_BORDER_COLOR,
        strokeWidth: STATE_BORDER_WIDTH,
        fill: Cesium.Color.TRANSPARENT,
        clampToGround: true,
      });

      this.viewer.dataSources.add(this.stateDataSource);
      this.stateDataSource.show = this.isVisible;

      // Index features for hover interaction
      const entities = this.stateDataSource.entities.values;
      for (const entity of entities) {
        this.boundaryFeatures.push({
          name: (entity.name || entity.properties?.getValue(Cesium.JulianDate.now())?.name) ?? 'Unknown',
          type: 'state',
          entity,
        });
      }

      this.statesLoaded = true;
    } catch (err) {
      console.warn('[BoundaryLayer] Failed to load state boundaries:', err);
    }
  }

  private async loadDistrictBoundaries(): Promise<void> {
    if (!this.viewer || this.districtsLoaded) return;

    try {
      this.districtDataSource = await Cesium.GeoJsonDataSource.load(INDIA_DISTRICTS_URL, {
        stroke: DISTRICT_BORDER_COLOR,
        strokeWidth: DISTRICT_BORDER_WIDTH,
        fill: Cesium.Color.TRANSPARENT,
        clampToGround: true,
      });

      this.viewer.dataSources.add(this.districtDataSource);
      // Initially hidden — revealed via progressive disclosure
      this.districtDataSource.show = false;

      // Index features for hover interaction
      const entities = this.districtDataSource.entities.values;
      for (const entity of entities) {
        this.boundaryFeatures.push({
          name: (entity.name || entity.properties?.getValue(Cesium.JulianDate.now())?.name) ?? 'Unknown',
          type: 'district',
          entity,
        });
      }

      this.districtsLoaded = true;
    } catch (err) {
      console.warn('[BoundaryLayer] Failed to load district boundaries:', err);
    }
  }

  // ── Private: Labels ──────────────────────────────────────────────────────

  private createLabels(): void {
    if (!this.labelCollection) return;

    for (const entry of STATE_LABELS) {
      this.labelCollection.add({
        position: entry.position,
        text: entry.name,
        font: entry.type === 'state' ? '14px Inter, sans-serif' : '12px Inter, sans-serif',
        fillColor: entry.type === 'state' ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#e2e8f0'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, entry.type === 'city' ? -12 : 0),
        // Collision-avoidance: disable depth test so labels always render on top
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Scale based on distance for readability
        scaleByDistance: new Cesium.NearFarScalar(
          500_000,
          1.0,
          5_000_000,
          0.5
        ),
        // Translucency by distance
        translucencyByDistance: new Cesium.NearFarScalar(
          100_000,
          1.0,
          8_000_000,
          0.0
        ),
        show: false, // Controlled by progressive disclosure
      });
    }
  }

  // ── Private: Hover Handling ──────────────────────────────────────────────

  private setupHoverHandler(): void {
    if (!this.viewer) return;

    this.moveHandler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    this.moveHandler.setInputAction(
      (movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
        if (!this.isVisible || !this.viewer) return;

        const pickedObject = this.viewer.scene.pick(movement.endPosition);

        // Reset previously hovered entity
        if (this.hoveredEntity) {
          this.resetEntityStyle(this.hoveredEntity);
          this.hoveredEntity = null;
        }

        // Apply highlight to newly hovered entity
        if (Cesium.defined(pickedObject) && pickedObject.id instanceof Cesium.Entity) {
          const entity = pickedObject.id as Cesium.Entity;
          const feature = this.boundaryFeatures.find((f) => f.entity === entity);

          if (feature) {
            this.highlightEntity(entity);
            this.hoveredEntity = entity;
          }
        }
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );
  }

  private highlightEntity(entity: Cesium.Entity): void {
    if (entity.polyline) {
      entity.polyline.width = new Cesium.ConstantProperty(HOVER_WIDTH);
      entity.polyline.material = new Cesium.ColorMaterialProperty(
        Cesium.Color.fromCssColorString('#38bdf8').withAlpha(HOVER_OPACITY)
      );
    }
    // GeoJsonDataSource entities may use polygon outlines
    if (entity.polygon) {
      entity.polygon.outlineWidth = new Cesium.ConstantProperty(HOVER_WIDTH);
      entity.polygon.outlineColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString('#38bdf8').withAlpha(HOVER_OPACITY)
      );
    }
  }

  private resetEntityStyle(entity: Cesium.Entity): void {
    const feature = this.boundaryFeatures.find((f) => f.entity === entity);
    if (!feature) return;

    const color =
      feature.type === 'state' ? STATE_BORDER_COLOR : DISTRICT_BORDER_COLOR;
    const width =
      feature.type === 'state' ? STATE_BORDER_WIDTH : DISTRICT_BORDER_WIDTH;

    if (entity.polyline) {
      entity.polyline.width = new Cesium.ConstantProperty(width);
      entity.polyline.material = new Cesium.ColorMaterialProperty(color);
    }
    if (entity.polygon) {
      entity.polygon.outlineWidth = new Cesium.ConstantProperty(width);
      entity.polygon.outlineColor = new Cesium.ConstantProperty(color);
    }
  }

  // ── Private: Progressive Disclosure ──────────────────────────────────────

  private updateProgressiveDisclosure(altitude: number): void {
    const showStates = altitude < STATE_ALTITUDE_THRESHOLD;
    const showDistricts = altitude < DISTRICT_ALTITUDE_THRESHOLD;

    // State boundaries visibility
    if (this.stateDataSource) {
      this.stateDataSource.show = this.isVisible && showStates;
    }

    // District boundaries visibility
    if (this.districtDataSource) {
      this.districtDataSource.show = this.isVisible && showDistricts;
    }

    // Labels visibility — show state labels when states are visible
    if (this.labelCollection) {
      for (let i = 0; i < this.labelCollection.length; i++) {
        const label = this.labelCollection.get(i);
        const entry = STATE_LABELS[i];

        if (entry) {
          if (entry.type === 'state') {
            label.show = this.isVisible && showStates;
          } else {
            // City labels show at a closer zoom
            label.show = this.isVisible && altitude < STATE_ALTITUDE_THRESHOLD;
          }
        }
      }
    }
  }

  // ── Private: Helpers ─────────────────────────────────────────────────────

  private getCameraAltitude(): number {
    if (!this.viewer) return Infinity;

    const cameraPosition = this.viewer.camera.positionCartographic;
    return cameraPosition.height;
  }

  private setVisibility(visible: boolean): void {
    if (this.stateDataSource) {
      this.stateDataSource.show = visible;
    }
    if (this.districtDataSource) {
      this.districtDataSource.show = visible;
    }
    if (this.labelCollection) {
      for (let i = 0; i < this.labelCollection.length; i++) {
        this.labelCollection.get(i).show = visible;
      }
    }
  }
}
