/**
 * ForecastDaySelector — lets the user pick which day (T+1 … T+7) to display.
 * The model always predicts all 7 days; this controls which slice is shown.
 */

interface ForecastDaySelectorProps {
  selected: number;           // 1–7
  onChange: (day: number) => void;
  className?: string;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export default function ForecastDaySelector({
  selected,
  onChange,
  className = '',
}: ForecastDaySelectorProps) {
  return (
    <div className={`panel-tight px-1 py-1 flex items-center gap-0.5 ${className}`}>
      <span className="text-[10px] text-foreground/40 px-1.5 whitespace-nowrap">
        Forecast day
      </span>
      {DAYS.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`w-7 h-7 rounded-md text-xs font-mono transition-colors ${
            selected === d
              ? 'bg-vayu-blue text-foreground font-bold'
              : 'text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80'
          }`}
          title={`T+${d} day forecast`}
        >
          +{d}
        </button>
      ))}
    </div>
  );
}
