import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const CesiumGlobe = lazy(() => import('./CesiumGlobe'));
type CesiumGlobeProps = ComponentProps<typeof import('./CesiumGlobe').default>;

/** Loads the WebGL renderer outside the initial JavaScript critical path. */
export default function AsyncCesiumGlobe(props: CesiumGlobeProps) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          aria-label="Loading interactive climate globe"
          className="absolute inset-0 flex items-center justify-center bg-vayu-dark text-sm text-white/60"
        >
          Loading interactive climate globe…
        </div>
      }
    >
      <CesiumGlobe {...props} />
    </Suspense>
  );
}
