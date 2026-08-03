import { Activity, Battery, Clock, Radio, TriangleAlert } from 'lucide-react';
import { useIoTSensors } from '../core/api/useIoTSensors';
import type { IoTStation, IoTStationStatus } from '../types';

const STATUS_STYLE: Record<IoTStationStatus, { color: string; label: string }> = {
  online: { color: '#4ade80', label: 'Connected' },
  low_battery: { color: '#fbbf24', label: 'Low battery' },
  offline: { color: '#94a3b8', label: 'Offline' },
};

export function formatLastReport(lastSeen: string | null, now = Date.now()): string {
  if (!lastSeen || Number.isNaN(Date.parse(lastSeen))) return 'No report received';
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(lastSeen)) / 60_000));
  if (elapsedMinutes < 1) return 'Just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  return `${Math.floor(elapsedMinutes / 60)}h ago`;
}

function batteryLabel(station: IoTStation): string {
  return station.power?.battery_v == null ? '—' : `${station.power.battery_v.toFixed(2)} V`;
}

/** Network-health view backed by the latest /api/stations telemetry. */
export default function IoTSensorPanel() {
  const { data, isLoading, isError, error, isFetching } = useIoTSensors();
  const stations = data?.stations ?? [];
  const connected = stations.filter((station) => station.status === 'online').length;

  return (
    <section className="panel p-4 flex flex-col gap-3" aria-label="Sensor Network Health">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-cyan-300" />
          <span className="text-sm font-semibold text-white/85">Sensor Network Health</span>
        </div>
        <span className="text-[10px] text-green-300">{connected}/{stations.length} connected</span>
      </header>

      <p className="text-[10px] text-white/40">
        Live AWS IoT Core telemetry {isFetching ? '· refreshing…' : '· updates every 30s'}
      </p>

      {isLoading && <p className="text-xs text-white/50">Loading sensor telemetry…</p>}
      {isError && <p className="text-xs text-red-300">{error.message}</p>}
      {!isLoading && !isError && stations.length === 0 && (
        <p className="text-xs text-white/50">No registered sensor stations.</p>
      )}

      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
        {stations.map((station) => {
          const status = STATUS_STYLE[station.status];
          return (
            <article
              key={station.station_id}
              className="rounded-lg p-2.5"
              style={{ background: 'rgba(255,255,255,0.035)', border: `1px solid ${status.color}33` }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[11px] font-semibold text-white/85">{station.name}</h3>
                  <p className="text-[9px] font-mono text-white/35">{station.station_id}</p>
                </div>
                <span className="flex items-center gap-1 text-[10px]" style={{ color: status.color }}>
                  <Activity size={11} /> {status.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]">
                <span className="flex items-center gap-1 text-white/55"><Battery size={11} /> Battery: <b className="text-white/80">{batteryLabel(station)}</b></span>
                <span className="flex items-center gap-1 text-white/55"><Clock size={11} /> Last report: <b className="text-white/80">{formatLastReport(station.last_seen)}</b></span>
              </div>
              {station.status === 'low_battery' && (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-300"><TriangleAlert size={11} /> Maintenance attention required</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
