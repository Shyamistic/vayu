/**
 * SatelliteDataCard — Displays ISRO/NASA satellite data feed status.
 * Shows which Earth observation data streams are active with last-update timestamps.
 */
import { useState, useEffect } from 'react';
import { Satellite, CheckCircle, AlertCircle, Clock } from 'lucide-react';

interface SatelliteFeed {
  id: string;
  name: string;
  agency: 'ISRO' | 'NASA';
  products: string[];
  status: 'active' | 'delayed' | 'offline';
  lastUpdate: Date;
  cadence: string;
}

// Simulated satellite feed status (in production, fetched from backend)
function getSimulatedFeeds(): SatelliteFeed[] {
  const now = new Date();
  return [
    {
      id: 'insat-3d',
      name: 'INSAT-3D/3DR',
      agency: 'ISRO',
      products: ['LST', 'SST', 'Rainfall (HE)'],
      status: 'active',
      lastUpdate: new Date(now.getTime() - 30 * 60 * 1000), // 30 min ago
      cadence: '30 min',
    },
    {
      id: 'oceansat-3',
      name: 'OCEANSAT-3',
      agency: 'ISRO',
      products: ['Chlorophyll-a', 'SST', 'Wind'],
      status: 'active',
      lastUpdate: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6h ago
      cadence: '12 hr',
    },
    {
      id: 'resourcesat-2a',
      name: 'ResourceSAT-2A',
      agency: 'ISRO',
      products: ['LISS-IV', 'NDVI', 'AWiFS'],
      status: 'delayed',
      lastUpdate: new Date(now.getTime() - 26 * 60 * 60 * 1000), // 26h ago
      cadence: '24 hr',
    },
    {
      id: 'cartosat-3',
      name: 'Cartosat-3',
      agency: 'ISRO',
      products: ['DEM', 'Terrain'],
      status: 'active',
      lastUpdate: new Date(now.getTime() - 48 * 60 * 60 * 1000), // 48h (static DEM)
      cadence: 'Static',
    },
  ];
}

function formatTimeSince(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_CONFIG = {
  active: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', label: 'Live', Icon: CheckCircle },
  delayed: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'Delayed', Icon: AlertCircle },
  offline: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Offline', Icon: AlertCircle },
};

export default function SatelliteDataCard() {
  const [feeds, setFeeds] = useState<SatelliteFeed[]>([]);

  useEffect(() => {
    setFeeds(getSimulatedFeeds());
    // Refresh every 60s
    const interval = setInterval(() => setFeeds(getSimulatedFeeds()), 60000);
    return () => clearInterval(interval);
  }, []);

  const activeCount = feeds.filter((f) => f.status === 'active').length;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Satellite size={14} className="text-[#0ea5e9]" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">
            Satellite Data Feeds
          </h3>
        </div>
        <span className="text-[10px] font-mono text-emerald-400">
          {activeCount}/{feeds.length} Active
        </span>
      </div>

      <div className="space-y-2">
        {feeds.map((feed) => {
          const cfg = STATUS_CONFIG[feed.status];
          const { Icon } = cfg;
          return (
            <div
              key={feed.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              {/* Status indicator */}
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.color}60` }}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-white/85 truncate">
                    {feed.name}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                    style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </span>
                </div>
                <p className="text-[10px] text-white/40 truncate">
                  {feed.products.join(' · ')}
                </p>
              </div>

              {/* Last update */}
              <div className="flex items-center gap-1 shrink-0">
                <Clock size={10} className="text-white/30" />
                <span className="text-[10px] text-white/40 font-mono">
                  {formatTimeSince(feed.lastUpdate)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-1 border-t border-white/5">
        <p className="text-[9px] text-white/30 text-center">
          Data assimilation: MOSDAC + Bhuvan APIs • Cadence varies by orbit
        </p>
      </div>
    </div>
  );
}
