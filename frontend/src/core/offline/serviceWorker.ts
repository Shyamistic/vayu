export const OFFLINE_CACHE_HIT_MESSAGE = 'vayu-offline-cache-hit';

export interface OfflineCacheHitMessage {
  type: typeof OFFLINE_CACHE_HIT_MESSAGE;
}

export function isOfflineCacheHitMessage(value: unknown): value is OfflineCacheHitMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && (value as { type?: unknown }).type === OFFLINE_CACHE_HIT_MESSAGE;
}

/** Registers the production Workbox worker after the initial page has loaded. */
export function registerOfflineServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  const register = () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}service-worker.js`, { type: 'module' })
      .catch((error: unknown) => {
        console.warn('[VAYU] Offline service worker registration failed:', error);
      });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
