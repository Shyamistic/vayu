/// <reference lib="WebWorker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Kept below 200 MB to reserve a small amount for cache bookkeeping metadata.
const MAX_OFFLINE_CACHE_BYTES = 200 * 1024 * 1024;
const CACHE_BUDGET_BYTES = MAX_OFFLINE_CACHE_BYTES - 1024 * 1024;
const OPAQUE_RESPONSE_ESTIMATE_BYTES = 512 * 1024;
const METADATA_CACHE = 'vayu-offline-cache-metadata-v1';
const STATIC_CACHE_NAMES = new Set(['vayu-mock-data-v1']);
const INDIA_BOUNDS = { west: 68, east: 98, south: 6, north: 38 };
const worker = self as unknown as ServiceWorkerGlobalScope;

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
worker.skipWaiting();
clientsClaim();

interface CacheEntry {
  cacheName: string;
  request: Request;
  bytes: number;
  lastAccess: number;
}

async function responseBytes(response: Response): Promise<number> {
  const headerLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(headerLength) && headerLength >= 0) return headerLength;
  if (response.type === 'opaque') return OPAQUE_RESPONSE_ESTIMATE_BYTES;
  try {
    return (await response.clone().arrayBuffer()).byteLength;
  } catch {
    return OPAQUE_RESPONSE_ESTIMATE_BYTES;
  }
}

function metadataRequest(cacheName: string, requestUrl: string): Request {
  return new Request(`${worker.location.origin}/__vayu-cache-meta__/${encodeURIComponent(cacheName)}/${encodeURIComponent(requestUrl)}`);
}

async function readLastAccess(cacheName: string, requestUrl: string): Promise<number> {
  const response = await (await caches.open(METADATA_CACHE)).match(metadataRequest(cacheName, requestUrl));
  if (!response) return 0;
  try {
    return (await response.json() as { lastAccess?: number }).lastAccess ?? 0;
  } catch {
    return 0;
  }
}

async function recordCacheAccess(cacheName: string, requestUrl: string): Promise<void> {
  await (await caches.open(METADATA_CACHE)).put(
    metadataRequest(cacheName, requestUrl),
    new Response(JSON.stringify({ lastAccess: Date.now() }), { headers: { 'content-type': 'application/json' } }),
  );
}

async function listCacheEntries(): Promise<CacheEntry[]> {
  const entries: CacheEntry[] = [];
  for (const cacheName of await caches.keys()) {
    if (cacheName === METADATA_CACHE) continue;
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      entries.push({
        cacheName,
        request,
        bytes: await responseBytes(response),
        lastAccess: await readLastAccess(cacheName, request.url),
      });
    }
  }
  return entries;
}

function evictionPriority(entry: CacheEntry): number {
  return STATIC_CACHE_NAMES.has(entry.cacheName) || entry.cacheName.startsWith('workbox-precache') ? 1 : 0;
}

async function makeRoomFor(additionalBytes: number, replacingRequest?: Request): Promise<boolean> {
  const entries = await listCacheEntries();
  const retained = replacingRequest
    ? entries.filter((entry) => entry.request.url !== replacingRequest.url)
    : entries;
  let total = retained.reduce((sum, entry) => sum + entry.bytes, 0) + additionalBytes;
  if (total <= CACHE_BUDGET_BYTES) return true;

  const evictable = retained
    .sort((a, b) => evictionPriority(a) - evictionPriority(b) || a.lastAccess - b.lastAccess);
  for (const entry of evictable) {
    if (total <= CACHE_BUDGET_BYTES) break;
    if (await (await caches.open(entry.cacheName)).delete(entry.request)) {
      total -= entry.bytes;
      await (await caches.open(METADATA_CACHE)).delete(metadataRequest(entry.cacheName, entry.request.url));
    }
  }
  return total <= CACHE_BUDGET_BYTES;
}

async function notifyOfflineCacheHit(): Promise<void> {
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'vayu-offline-cache-hit' }));
}

type CacheWillUpdateContext = { request: Request; response?: Response };
type CacheDidUpdateContext = { cacheName: string; request: Request; newResponse?: Response };
type CachedResponseContext = { cacheName: string; request: Request; cachedResponse?: Response };

const cacheBudgetPlugin = {
  async cacheWillUpdate({ request, response }: CacheWillUpdateContext): Promise<Response | null> {
    if (!response || (!response.ok && response.type !== 'opaque')) return null;
    return await makeRoomFor(await responseBytes(response), request) ? response : null;
  },
  async cacheDidUpdate({ cacheName, request, newResponse }: CacheDidUpdateContext): Promise<void> {
    if (newResponse) await recordCacheAccess(cacheName, request.url);
  },
  async cachedResponseWillBeUsed({ cacheName, request, cachedResponse }: CachedResponseContext): Promise<Response | undefined> {
    if (cachedResponse) {
      await recordCacheAccess(cacheName, request.url);
      if (!worker.navigator.onLine) void notifyOfflineCacheHit();
    }
    return cachedResponse;
  },
};

function runtimePlugins() {
  return [new CacheableResponsePlugin({ statuses: [0, 200] }), cacheBudgetPlugin];
}

function isMockDataRequest(url: URL): boolean {
  return url.origin === worker.location.origin
    && (/^\/mock_scenarios\//.test(url.pathname)
      || /\/(?:mock_[^/]+|wind_field|india_states|india_outline_simplified)\.(?:json|geojson)$/.test(url.pathname));
}

function isIndiaTerrainTile(url: URL): boolean {
  if (url.pathname.endsWith('/layer.json')) return true;
  const match = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.terrain(?:$|\/)/);
  if (!match) return false;
  const [zoom, x, y] = match.slice(1).map(Number);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 8) return false;
  const tileCount = 2 ** zoom;
  if (x < 0 || y < 0 || x >= tileCount || y >= tileCount) return false;
  const west = x / tileCount * 360 - 180;
  const east = (x + 1) / tileCount * 360 - 180;
  const latitude = (tileY: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / tileCount))) * 180 / Math.PI;
  const north = latitude(y);
  const south = latitude(y + 1);
  return west <= INDIA_BOUNDS.east && east >= INDIA_BOUNDS.west
    && south <= INDIA_BOUNDS.north && north >= INDIA_BOUNDS.south;
}

function isTerrainRequest(url: URL): boolean {
  return (url.hostname.endsWith('cesium.com') || url.pathname.includes('/terrain/'))
    && (url.pathname.endsWith('/layer.json') || url.pathname.includes('.terrain'));
}

registerRoute(({ url }) => isMockDataRequest(url), new CacheFirst({
  cacheName: 'vayu-mock-data-v1',
  plugins: runtimePlugins(),
}));

registerRoute(({ url }) => isTerrainRequest(url) && isIndiaTerrainTile(url), new CacheFirst({
  cacheName: 'vayu-terrain-india-z0-8-v1',
  plugins: runtimePlugins(),
}));

registerRoute(({ url }) => url.hostname === 'gibs.earthdata.nasa.gov' && url.pathname.includes('/wmts/'), new CacheFirst({
  cacheName: 'vayu-gibs-imagery-v1',
  plugins: runtimePlugins(),
}));

registerRoute(({ url }) => url.origin === worker.location.origin && url.pathname.startsWith('/api/'), new NetworkFirst({
  cacheName: 'vayu-api-data-v1',
  networkTimeoutSeconds: 4,
  plugins: runtimePlugins(),
}));

registerRoute(({ request }) => request.mode === 'navigate', createHandlerBoundToURL('/index.html'));

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') return (await caches.match('/index.html')) ?? Response.error();
  return Response.error();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(makeRoomFor(0));
});
