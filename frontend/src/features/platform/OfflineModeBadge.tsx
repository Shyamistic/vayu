import { useEffect, useState } from 'react';
import {
  isOfflineCacheHitMessage,
} from '../../core/offline/serviceWorker';

/** Indicates that a response was served by the service-worker cache while offline. */
export default function OfflineModeBadge() {
  const [isServingCachedData, setIsServingCachedData] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (isOfflineCacheHitMessage(event.data)) setIsServingCachedData(true);
    };
    const clearOfflineMode = () => setIsServingCachedData(false);

    navigator.serviceWorker?.addEventListener('message', handleMessage);
    window.addEventListener('online', clearOfflineMode);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
      window.removeEventListener('online', clearOfflineMode);
    };
  }, []);

  if (!isServingCachedData) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      title="Resources are being served from this device's offline cache"
      className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-medium tracking-wide text-cyan-100"
    >
      Offline Mode
    </span>
  );
}
