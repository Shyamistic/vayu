/**
 * IoTSensorPanel — Feature 31
 * Simulated IoT sensor network across India.
 * Shows real-time sensor readings with pulsing status indicators.
 * Demonstrates the "low-cost distributed sensor network" pitch.
 */
import { useEffect, useState } from 'react';
import { Radio, Thermometer, Droplets, Wind } from 'lucide-react';

interface SensorReading {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  temperature: number;
  humidity: number;
  rainfall: number;
  windSpeed: number;
  status: 'online' | 'warning' | 'offline';
  lastUpdate: string;
}

// 20 simulated sensors — Western Ghats pilot region only
const SENSOR_BASE: Omit<SensorReading, 'temperature' | 'humidity' | 'rainfall' | 'windSpeed' | 'lastUpdate'>[] = [
  { id: 'S01', name: 'Mysuru-Rural',    state: 'Karnataka',    lat: 12.3, lon: 76.6,  status: 'online'  },
  { id: 'S02', name: 'Coorg-Forest',    state: 'Karnataka',    lat: 12.4, lon: 75.7,  status: 'online'  },
  { id: 'S03', name: 'Kozhikode-Bay',   state: 'Kerala',       lat: 11.3, lon: 75.8,  status: 'warning' },
  { id: 'S04', name: 'Munnar-Hill',     state: 'Kerala',       lat: 10.1, lon: 77.1,  status: 'online'  },
  { id: 'S05', name: 'Pune-Agri',       state: 'Maharashtra',  lat: 18.5, lon: 73.8,  status: 'online'  },
  { id: 'S06', name: 'Kolhapur-River',  state: 'Maharashtra',  lat: 16.7, lon: 74.2,  status: 'online'  },
  { id: 'S07', name: 'Tiruvannamalai', state: 'Tamil Nadu',   lat: 12.2, lon: 79.1,  status: 'offline' },
  { id: 'S08', name: 'Madurai-Farm',    state: 'Tamil Nadu',   lat: 9.9,  lon: 78.1,  status: 'online'  },
  { id: 'S09', name: 'Nasik-Plateau',   state: 'Maharashtra',  lat: 19.9, lon: 73.8,  status: 'online'  },
  { id: 'S10', name: 'Satara-Hills',    state: 'Maharashtra',  lat: 17.7, lon: 74.0,  status: 'warning' },
  { id: 'S11', name: 'Palakkad-Pass',   state: 'Kerala',       lat: 10.8, lon: 76.6,  status: 'online'  },
  { id: 'S12', name: 'Vizag-Ghats',     state: 'AP',           lat: 17.7, lon: 82.0,  status: 'online'  },
  { id: 'S13', name: 'Goa-Coast',       state: 'Goa',          lat: 15.5, lon: 74.0,  status: 'online'  },
  { id: 'S14', name: 'Udupi-Coastal',   state: 'Karnataka',    lat: 13.3, lon: 74.7,  status: 'online'  },
  { id: 'S15', name: 'Kalpetta-Forest', state: 'Kerala',       lat: 11.6, lon: 76.1,  status: 'warning' },
  { id: 'S16', name: 'Belgaum-Deccan',  state: 'Karnataka',    lat: 15.9, lon: 74.5,  status: 'online'  },
  { id: 'S17', name: 'Lonavala-Ridge',  state: 'Maharashtra',  lat: 18.7, lon: 73.4,  status: 'online'  },
  { id: 'S18', name: 'Mahabaleshwar',   state: 'Maharashtra',  lat: 17.9, lon: 73.7,  status: 'offline' },
  { id: 'S19', name: 'Palghat-Plains',  state: 'Kerala',       lat: 10.7, lon: 76.7,  status: 'online'  },
  { id: 'S20', name: 'Coimbatore-WG',   state: 'Tamil Nadu',   lat: 11.0, lon: 76.9,  status: 'online'  },
];

function generateReading(base: typeof SENSOR_BASE[0], t: number): SensorReading {
  // Add per-sensor jitter so sensors don't update identically
  const jitter = (base.id.charCodeAt(1) - 48) * 137.5;
  const r = Math.sin(base.lat * 3.7 + (t + jitter) * 0.001) * 0.5 + 0.5;
  return {
    ...base,
    temperature: 22 + r * 14 + (base.lat > 15 ? 2 : 0),   // WG range: 22–36°C
    humidity: 55 + r * 40,                                  // WG high humidity
    rainfall: base.status === 'offline' ? 0 : Math.max(0, r * 18 - 4),
    windSpeed: Math.min(12, 2 + r * 10),                    // cap at 12 m/s (WG realistic)
    lastUpdate: new Date(Date.now() - Math.floor(r * 300000)).toISOString(),
  };
}

const STATUS_STYLES = {
  online:  { color: '#22c55e', label: 'Online',  dot: 'animate-pulse' },
  warning: { color: '#eab308', label: 'Warning', dot: 'animate-pulse' },
  offline: { color: '#6b7280', label: 'Offline', dot: '' },
};

export default function IoTSensorPanel() {
  const [sensors, setSensors] = useState<SensorReading[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'online' | 'warning'>('all');

  // Simulate live updates every 5 seconds
  useEffect(() => {
    const update = () => {
      const t = Date.now();
      setSensors(SENSOR_BASE.map((s) => generateReading(s, t)));
    };
    update();
    const iv = setInterval(update, 5000);
    return () => clearInterval(iv);
  }, []);

  const filtered = sensors.filter(
    (s) => filter === 'all' || s.status === filter,
  );

  const online = sensors.filter((s) => s.status === 'online').length;
  const warning = sensors.filter((s) => s.status === 'warning').length;
  const offline = sensors.filter((s) => s.status === 'offline').length;

  const selectedSensor = sensors.find((s) => s.id === selected);

  return (
    <div className="panel p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-green-400" />
          <span className="text-sm font-semibold text-white/85">VayuDrishti IoT Network</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-green-400">{online}●</span>
          <span className="text-yellow-400">{warning}●</span>
          <span className="text-gray-500">{offline}●</span>
        </div>
      </div>
      {/* Demo badge */}
      <div className="flex items-center gap-1.5 text-[9px] text-white/30">
        <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 border border-yellow-500/25 text-yellow-400/70">Simulated</span>
        <span>20 ESP32-based units · Western Ghats pilot</span>
      </div>

      {/* Status summary bar */}
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        <div className="bg-green-500 rounded-l-full" style={{ flex: online }} />
        <div className="bg-yellow-500" style={{ flex: warning }} />
        <div className="bg-gray-600 rounded-r-full" style={{ flex: offline }} />
      </div>
      <div className="flex justify-between text-[9px] text-white/30 -mt-1">
        <span>{online} online</span>
        <span>{warning} warning</span>
        <span>{offline} offline</span>
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {(['all', 'online', 'warning'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="flex-1 text-[10px] py-1 rounded-md transition-all"
            style={{
              background: filter === f ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
              border: filter === f ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.07)',
              color: filter === f ? '#86efac' : 'rgba(255,255,255,0.4)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Sensor list */}
      <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
        {filtered.map((sensor) => {
          const ss = STATUS_STYLES[sensor.status];
          const isSelected = selected === sensor.id;
          return (
            <button
              key={sensor.id}
              onClick={() => setSelected(isSelected ? null : sensor.id)}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all"
              style={{
                background: isSelected ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.03)',
                border: isSelected ? '1px solid rgba(14,165,233,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${ss.dot}`}
                  style={{ background: ss.color }}
                />
                <div>
                  <div className="text-[10px] font-medium text-white/80">{sensor.name}</div>
                  <div className="text-[9px] text-white/30">{sensor.state}</div>
                </div>
              </div>
              {sensor.status !== 'offline' && (
                <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums">
                  <span className="text-orange-300">{sensor.temperature.toFixed(1)}°</span>
                  <span className="text-blue-300">{sensor.rainfall.toFixed(1)}mm</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded sensor detail */}
      {selectedSensor && (
        <div
          className="rounded-lg p-2.5 flex flex-col gap-2"
          style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.2)' }}
        >
          <div className="text-[10px] font-semibold text-vayu-accent">{selectedSensor.name}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Thermometer size={10} />, label: 'Temperature', value: `${selectedSensor.temperature.toFixed(1)}°C`, color: '#f97316' },
              { icon: <Droplets size={10} />,    label: 'Humidity',    value: `${selectedSensor.humidity.toFixed(0)}%`,   color: '#60a5fa' },
              { icon: <Droplets size={10} />,    label: 'Rainfall',    value: `${selectedSensor.rainfall.toFixed(1)} mm`, color: '#818cf8' },
              { icon: <Wind size={10} />,         label: 'Wind',        value: `${selectedSensor.windSpeed.toFixed(1)} m/s`, color: '#94a3b8' },
            ].map(({ icon, label, value, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span style={{ color }}>{icon}</span>
                <div>
                  <div className="text-[8px] text-white/30">{label}</div>
                  <div className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>
                    {value}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-white/25 font-mono">
            {selectedSensor.lat.toFixed(2)}°N {selectedSensor.lon.toFixed(2)}°E
          </div>
        </div>
      )}

      <p className="text-[9px] text-white/20 text-center">
        {SENSOR_BASE.length} simulated IMD-class sensors · Updates every 5s
      </p>
    </div>
  );
}
