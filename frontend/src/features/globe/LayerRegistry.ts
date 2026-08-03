/**
 * Globe Layer Registry
 *
 * Manages the lifecycle of LayerPlugin instances: registration, initialization,
 * state updates (dispatched to all active layers), and teardown. Layers are
 * sorted by priority so that rendering order is deterministic (lower = first).
 */

import type * as Cesium from 'cesium';
import type { LayerPlugin, LayerState } from './types';

export class LayerRegistry {
  private layers: Map<string, LayerPlugin> = new Map();
  private viewer: Cesium.Viewer | null = null;
  private initialized: Set<string> = new Set();

  // ── Registration ─────────────────────────────────────────────────────────

  /**
   * Register a layer plugin. If the viewer is already available, the layer
   * is initialized immediately. Otherwise it will be initialized when
   * `initAll` is called.
   */
  async register(plugin: LayerPlugin): Promise<void> {
    if (this.layers.has(plugin.id)) {
      console.warn(`[LayerRegistry] Layer "${plugin.id}" already registered — replacing.`);
      await this.unregister(plugin.id);
    }

    this.layers.set(plugin.id, plugin);

    // If viewer is already available, init immediately
    if (this.viewer && !this.initialized.has(plugin.id)) {
      try {
        await plugin.init(this.viewer);
        this.initialized.add(plugin.id);
      } catch (err) {
        console.error(`[LayerRegistry] Failed to init layer "${plugin.id}":`, err);
      }
    }
  }

  /**
   * Unregister and destroy a layer plugin by id.
   */
  async unregister(id: string): Promise<void> {
    const plugin = this.layers.get(id);
    if (!plugin) return;

    try {
      plugin.destroy();
    } catch (err) {
      console.error(`[LayerRegistry] Error destroying layer "${id}":`, err);
    }

    this.layers.delete(id);
    this.initialized.delete(id);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize all registered layers with the Cesium viewer.
   * Called once when the viewer is ready.
   */
  async initAll(viewer: Cesium.Viewer): Promise<void> {
    this.viewer = viewer;

    const sorted = this.getAll();
    for (const plugin of sorted) {
      if (this.initialized.has(plugin.id)) continue;
      try {
        await plugin.init(viewer);
        this.initialized.add(plugin.id);
      } catch (err) {
        console.error(`[LayerRegistry] Failed to init layer "${plugin.id}":`, err);
      }
    }
  }

  /**
   * Dispatch a state update to all initialized layers (sorted by priority).
   */
  updateAll(state: LayerState): void {
    const sorted = this.getAll();
    for (const plugin of sorted) {
      if (!this.initialized.has(plugin.id)) continue;
      try {
        plugin.update(state);
      } catch (err) {
        console.error(`[LayerRegistry] Error updating layer "${plugin.id}":`, err);
      }
    }
  }

  /**
   * Destroy all layers and clear the registry. Called on unmount.
   */
  destroyAll(): void {
    for (const plugin of this.layers.values()) {
      try {
        plugin.destroy();
      } catch (err) {
        console.error(`[LayerRegistry] Error destroying layer "${plugin.id}":`, err);
      }
    }
    this.layers.clear();
    this.initialized.clear();
    this.viewer = null;
  }

  // ── Query ────────────────────────────────────────────────────────────────

  /**
   * Get all registered layers sorted by priority (ascending — lower first).
   */
  getAll(): LayerPlugin[] {
    return Array.from(this.layers.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get a specific layer by id.
   */
  get(id: string): LayerPlugin | undefined {
    return this.layers.get(id);
  }

  /**
   * Check if a layer is registered.
   */
  has(id: string): boolean {
    return this.layers.has(id);
  }

  /**
   * Get the number of registered layers.
   */
  get size(): number {
    return this.layers.size;
  }
}
