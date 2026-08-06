/**
 * CyclonePanel — Feature 7
 * Historical cyclone tracks for the Bay of Bengal and Arabian Sea.
 * Shows track path, landfall point, peak intensity, and affected states.
 * Data sourced from IMD historical cyclone database (hardcoded key events).
 */
import { useState } from 'react';
import { CloudLightning, ChevronDown, ChevronRight } from 'lucide-react';

interface CycloneTrack {
  id: string;
  name: string;
  year: number;
  basin: 'BOB' | 'AS';  // Bay of Bengal | Arabian Sea
  category: string;
  peakWindKnots: number;
  landfallDate: string;
  landfallLoc: string;
  affectedStates: string[];
  deaths: number;
  color: string;
  track: [number, number][]; // [lon, lat] pairs
}

const CYCLONES: CycloneTrack[] = [
  {
    id: 'amphan',
    name: 'Amphan (2020)',
    year: 2020,
    basin: 'BOB',
    category: 'Extremely Severe CS',
    peakWindKnots: 130,
    landfallDate: '20 May 2020',
    landfallLoc: 'West Bengal coast',
    affectedStates: ['West Bengal', 'Odisha', 'Bangladesh'],
    deaths: 128,
    color: '#ef4444',
    track: [[86,9],[86.5,11],[87,14],[87.2,16],[87,18],[86.5,20],[86,21.5],[85.5,22.5]],
  },
  {
    id: 'tauktae',
    name: 'Tauktae (2021)',
    year: 2021,
    basin: 'AS',
    category: 'Extremely Severe CS',
    peakWindKnots: 120,
    landfallDate: '17 May 2021',
    landfallLoc: 'Gujarat coast',
    affectedStates: ['Goa', 'Maharashtra', 'Gujarat'],
    deaths: 174,
    color: '#f97316',
    track: [[75,9],[74.5,11],[74,13],[73.8,15],[73.5,17],[72.5,19],[71.5,21],[70,22.5]],
  },
  {
    id: 'biparjoy',
    name: 'Biparjoy (2023)',
    year: 2023,
    basin: 'AS',
    category: 'Extremely Severe CS',
    peakWindKnots: 115,
    landfallDate: '15 Jun 2023',
    landfallLoc: 'Saurashtra, Gujarat',
    affectedStates: ['Gujarat', 'Rajasthan'],
    deaths: 2,
    color: '#a855f7',
    track: [[66,12],[65.5,14],[65,16],[64.5,18],[64,20],[65,22],[67,22.5],[68.5,22.8]],
  },
  {
    id: 'yaas',
    name: 'Yaas (2021)',
    year: 2021,
    basin: 'BOB',
    category: 'Very Severe CS',
    peakWindKnots: 85,
    landfallDate: '26 May 2021',
    landfallLoc: 'Odisha coast',
    affectedStates: ['Odisha', 'West Bengal'],
    deaths: 19,
    color: '#eab308',
    track: [[91,10],[90.5,12],[90,14],[89.5,16],[88.5,18],[87.5,19.5],[87,21]],
  },
  {
    id: 'ockhi',
    name: 'Ockhi (2017)',
    year: 2017,
    basin: 'AS',
    category: 'Very Severe CS',
    peakWindKnots: 90,
    landfallDate: '6 Dec 2017',
    landfallLoc: 'Saurashtra',
    affectedStates: ['Kerala', 'Tamil Nadu', 'Gujarat'],
    deaths: 245,
    color: '#06b6d4',
    track: [[80,6],[78,7],[76,9],[74,11],[72,13],[70,15],[68,18],[67.5,20.5]],
  },
];

const INTENSITY_LABELS: Record<string, string> = {
  'Extremely Severe CS': 'Category 4+',
  'Very Severe CS': 'Category 3',
  'Severe CS': 'Category 2',
};

export default function CyclonePanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'BOB' | 'AS'>('ALL');

  const filtered = CYCLONES.filter((c) => filter === 'ALL' || c.basin === filter);

  return (
    <div className="panel p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CloudLightning size={14} className="text-purple-400" />
          <span className="text-sm font-semibold text-foreground/85">Cyclone Tracks</span>
        </div>
        <span className="text-[9px] text-foreground/30 font-mono">IMD Historical</span>
      </div>

      {/* Basin filter */}
      <div className="flex gap-1">
        {(['ALL', 'BOB', 'AS'] as const).map((b) => (
          <button
            key={b}
            onClick={() => setFilter(b)}
            className="flex-1 text-[10px] py-1 rounded-md transition-all"
            style={{
              background: filter === b ? 'rgba(168,85,247,0.2)' : 'rgba(var(--fg-rgb),var(--fg-a05))',
              border: filter === b ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
              color: filter === b ? '#d8b4fe' : 'rgba(var(--fg-rgb),var(--fg-a4))',
            }}
          >
            {b === 'ALL' ? 'All' : b === 'BOB' ? 'Bay of Bengal' : 'Arabian Sea'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {filtered.map((cy) => {
          const isOpen = expanded === cy.id;
          return (
            <button
              key={cy.id}
              onClick={() => setExpanded(isOpen ? null : cy.id)}
              className="rounded-lg px-3 py-2 text-left transition-all"
              style={{
                background: `${cy.color}12`,
                border: `1px solid ${cy.color}30`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cy.color }} />
                  <div>
                    <div className="text-[11px] font-semibold text-foreground/85">{cy.name}</div>
                    <div className="text-[9px] text-foreground/35">{cy.category}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono" style={{ color: cy.color }}>
                    {cy.peakWindKnots} kt
                  </span>
                  {isOpen ? <ChevronDown size={10} className="text-foreground/30" /> : <ChevronRight size={10} className="text-foreground/30" />}
                </div>
              </div>

              {isOpen && (
                <div className="mt-2 pt-2 border-t flex flex-col gap-1" style={{ borderColor: 'rgba(var(--fg-rgb),var(--fg-a08))' }}>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    <div className="text-foreground/40">Landfall:</div>
                    <div className="text-foreground/70">{cy.landfallDate}</div>
                    <div className="text-foreground/40">Location:</div>
                    <div className="text-foreground/70">{cy.landfallLoc}</div>
                    <div className="text-foreground/40">Intensity:</div>
                    <div style={{ color: cy.color }}>{INTENSITY_LABELS[cy.category] ?? cy.category}</div>
                    <div className="text-foreground/40">Deaths:</div>
                    <div className="text-foreground/70 tabular-nums">{cy.deaths.toLocaleString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cy.affectedStates.map((s) => (
                      <span
                        key={s}
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: `${cy.color}20`, color: cy.color, border: `1px solid ${cy.color}30` }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[9px] text-foreground/20 text-center">
        IMD post-season cyclone reports · 2017–2023
      </p>
    </div>
  );
}
