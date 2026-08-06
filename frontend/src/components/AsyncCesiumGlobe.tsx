import { forwardRef, lazy, Suspense } from 'react';
import type { ComponentProps, Ref } from 'react';
import type { CesiumGlobeHandle } from './CesiumGlobe';

const CesiumGlobe = lazy(() => import('./CesiumGlobe'));
type CesiumGlobeProps = ComponentProps<typeof import('./CesiumGlobe').default>;

/** Loads the WebGL renderer outside the initial JavaScript critical path. */
const AsyncCesiumGlobe = forwardRef(function AsyncCesiumGlobe(
  props: CesiumGlobeProps,
  ref: Ref<CesiumGlobeHandle>,
) {
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
      <CesiumGlobe {...props} ref={ref} />
    </Suspense>
  );
});

export default AsyncCesiumGlobe;
