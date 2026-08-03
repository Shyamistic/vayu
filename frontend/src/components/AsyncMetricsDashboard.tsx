import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const MetricsDashboard = lazy(() => import('./MetricsDashboard'));
type MetricsDashboardProps = ComponentProps<typeof import('./MetricsDashboard').default>;

/** Defers Plotly and its charting code until the Metrics view is selected. */
export default function AsyncMetricsDashboard(props: MetricsDashboardProps) {
  return (
    <Suspense
      fallback={
        <div className="panel p-4 w-80 text-sm text-white/60" aria-busy="true">
          Loading performance charts…
        </div>
      }
    >
      <MetricsDashboard {...props} />
    </Suspense>
  );
}
