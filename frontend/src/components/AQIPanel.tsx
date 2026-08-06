/**
 * AQIPanel — Feature 15
 * Air Quality Index at major Indian cities using OpenWeatherMap Air Pollution API.
 * Displays CPCB-standard color coding at city locations.
 * Falls back to indicative simulated data when API unavailable.
 */
import { useEffect, useState } from 'react';
import { Wind, RefreshCw } from 'lucide-react';

interface CityAQI {
  city: string;
  state: string;
  lat: number;
  lon: number;
  aqi: number; // 1-5 (OWM scale)
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
}

// Major Indian cities with known coordinates
const CITIES = [
  { city: 'Delhi',       state: 'Delhi',         lat: 28.61, lon: 77.21 },
  { city: 'Mumbai',      state: 'Maharashtra',   lat: 19.08, lon: 72.88 },
  { city: 'Bengaluru',   state: 'Karnataka',     lat: 12.97, lon: 77.59 },
  { city: 'Kolkata',     state: 'West Bengal',   lat: 22.57, lon: 88.36 },
  { city: 'Chennai',     state: 'Tamil Nadu',    lat: 13.08, lon: 80.27 },
  { city: 'Hyderabad',   state: 'Telangana',     lat: 17.38, lon: 78.49 },
  { city: 'Pune',        state: 'Maharashtra',   lat: 18.52, lon: 73.86 },
  { city: 'Ahmedabad',   state: 'Gujarat',       lat: 23.03, lon: 72.58 },
  { city: 'Jaipur',      state: 'Rajasthan',     lat: 26.91, lon: 75.79 },
  { city: 'Lucknow',     state: 'Uttar Pradesh', lat: 26.85, lon: 80.95 },
];

// CPCB-standard AQI bands (mapped from OWM 1-5 scale)
const AQI_BANDS = [
  { min: 1, max: 1, label: 'Good',       color: '#00b050', bg: 'rgba(0,176,80,0.15)' },
  { min: 2, max: 2, label: 'Fair',       color: '#92d050', bg: 'rgba(146,208,80,0.15)' },
  { min: 3, max: 3, label: 'Moderate',   color: '#ffc000', bg: 'rgba(255,192,0,0.15)' },
  { min: 4, max: 4, label: 'Poor',       color: '#ff6600', bg: 'rgba(255,102,0,0.15)' },
  { min: 5, max: 5, label: 'Very Poor',  color: '#c00000', bg: 'rgba(192,0,0,0.15)' },
];

function getAQIBand(aqi: number) {
  return AQI_BANDS.find((b) => aqi >= b.min && aqi <= b.max) ?? AQI_BANDS[2];
}

async function fetchCityAQI(city: typeof CITIES[0], apiKey: string): Promise<CityAQI> {
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${city.lat}&lon=${city.lon}&appid=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const comp = data.list[0].components;
  return {
    ...city,
    aqi: data.list[0].main.aqi,
    pm25: comp.pm2_5,
    pm10: comp.pm10,
    no2: comp.no2,
    o3: comp.o3,
  };
}

function generateSimulated(city: typeof CITIES[0]): CityAQI {
  // Deterministic but varied by city coords
  const seed = (city.lat * 7 + city.lon * 3) % 5;
  const aqi = Math.ceil(Math.abs(seed)) as 1 | 2 | 3 | 4 | 5;
  return {
    ...city,
    aqi: Math.max(1, Math.min(5, aqi)),
    pm25: 15 + seed * 20,
    pm10: 30 + seed * 40,
    no2: 10 + seed * 15,
    o3: 40 + seed * 30,
  };
}

export default function AQIPanel() {
  const [data, setData] = useState<CityAQI[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'live' | 'simulated'>('simulated');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const apiKey = import.meta.env.VITE_OPENWEATHERMAP_KEY ?? '';

    if (apiKey) {
      try {
        const results = await Promise.all(
          CITIES.slice(0, 5).map((c) => fetchCityAQI(c, apiKey)),
        );
        setData(results);
        setSource('live');
        setLoading(false);
        return;
      } catch {
        // Fall through to simulated
      }
    }
    setData(CITIES.map(generateSimulated));
    setSource('simulated');
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wind size={14} className="text-blue-400" />
          <span className="text-sm font-semibold text-foreground/85">Air Quality Index</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-mono"
            style={{
              background: source === 'live' ? 'rgba(34,197,94,0.12)' : 'rgba(var(--fg-rgb),var(--fg-a05))',
              color: source === 'live' ? '#86efac' : 'rgba(var(--fg-rgb),var(--fg-a3))',
              border: `1px solid ${source === 'live' ? 'rgba(34,197,94,0.2)' : 'rgba(var(--fg-rgb),var(--fg-a08))'}`,
            }}
          >
            {source === 'live' ? '● Live' : '◌ Demo'}
          </span>
          <button onClick={load} className="text-foreground/30 hover:text-foreground/70 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.map((city) => {
            const band = getAQIBand(city.aqi);
            const isOpen = expanded === city.city;
            return (
              <button
                key={city.city}
                onClick={() => setExpanded(isOpen ? null : city.city)}
                className="rounded-lg px-3 py-2 text-left transition-all"
                style={{ background: band.bg, border: `1px solid ${band.color}30` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-foreground/85">{city.city}</span>
                    <span className="text-[9px] text-foreground/35 ml-1.5">{city.state}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold" style={{ color: band.color }}>
                      {band.label}
                    </span>
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold"
                      style={{ background: band.color + '30', color: band.color }}
                    >
                      {city.aqi}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t" style={{ borderColor: 'rgba(var(--fg-rgb),var(--fg-a08))' }}>
                    {[
                      { label: 'PM2.5', value: city.pm25.toFixed(1), unit: 'μg' },
                      { label: 'PM10',  value: city.pm10.toFixed(1),  unit: 'μg' },
                      { label: 'NO₂',  value: city.no2.toFixed(1),   unit: 'μg' },
                      { label: 'O₃',   value: city.o3.toFixed(1),    unit: 'μg' },
                    ].map(({ label, value, unit }) => (
                      <div key={label} className="text-center">
                        <div className="text-[8px] text-foreground/35">{label}</div>
                        <div className="text-[10px] font-mono font-bold tabular-nums" style={{ color: band.color }}>
                          {value}
                        </div>
                        <div className="text-[8px] text-foreground/25">{unit}</div>
                      </div>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-foreground/20 text-center">
        OWM Air Pollution API · CPCB scale · Click city for details
      </p>
    </div>
  );
}
