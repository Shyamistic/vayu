import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Constants ──────────────────────────────────────────────────────────────────

const FIRST_VISIT_KEY = 'mausam_intro_seen';

/** Panel labels that slide in with staggered 200ms delay */
const PANEL_LABELS = [
  'Initializing Climate Engine',
  'Loading ISRO Dataset',
  'Calibrating Forecast Models',
  'Activating Digital Twin',
];

/** Total duration of the full sequence (ms):
 *  0–400   : logo fade-in
 *  400–3400: globe zoom from space to India (3 seconds)
 *  3400–4200: panel slide-ins staggered (4 × 200ms)
 *  After 4200ms: auto-dismiss
 */
const SEQUENCE_DURATION_MS = 5000;

// ── Easing curve matching design system ───────────────────────────────────────
const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Animated earth/globe that zooms from space-view to India */
const GlobeZoom: React.FC<{ playing: boolean }> = ({ playing }) => (
  <motion.div
    aria-hidden="true"
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}
    initial={{ opacity: 0 }}
    animate={playing ? { opacity: 1 } : { opacity: 0 }}
    transition={{ duration: 0.4, delay: 0.4, ease: EASE_STANDARD }}
  >
    {/* Outer glow ring — represents "space" viewport */}
    <motion.div
      style={{
        position: 'absolute',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(14,165,233,0.08) 0%, rgba(14,165,233,0.02) 60%, transparent 100%)',
      }}
      initial={{ width: 600, height: 600, opacity: 0.3 }}
      animate={playing ? { width: 1400, height: 1400, opacity: 0 } : {}}
      transition={{ duration: 3, delay: 0.5, ease: EASE_STANDARD }}
    />

    {/* Main globe — starts small (far away / space view) and zooms in */}
    <motion.div
      style={{ position: 'relative' }}
      initial={{ scale: 0.15, opacity: 0 }}
      animate={playing ? { scale: 1, opacity: 1 } : {}}
      transition={{ duration: 3, delay: 0.5, ease: EASE_STANDARD }}
    >
      {/* Globe body */}
      <div
        style={{
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 35% 35%,
              rgba(14,165,233,0.6) 0%,
              rgba(16,185,129,0.4) 25%,
              rgba(6,78,59,0.6) 55%,
              rgba(var(--panel-bg-rgb),0.9) 100%
            )
          `,
          boxShadow: `
            0 0 80px rgba(14,165,233,0.25),
            0 0 160px rgba(14,165,233,0.1),
            inset -30px -30px 60px rgba(0,0,0,0.6)
          `,
          border: '1px solid rgba(14,165,233,0.2)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* India landmass silhouette (simplified CSS representation) */}
        <motion.div
          style={{
            position: 'absolute',
            top: '28%',
            left: '30%',
            width: '40%',
            height: '52%',
            background: 'rgba(16,185,129,0.45)',
            borderRadius: '30% 40% 55% 35% / 25% 35% 65% 45%',
            filter: 'blur(4px)',
          }}
          initial={{ opacity: 0 }}
          animate={playing ? { opacity: 1 } : {}}
          transition={{ duration: 1.5, delay: 2.5, ease: EASE_STANDARD }}
        />

        {/* Atmospheric haze overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, rgba(var(--fg-rgb),var(--fg-a08)) 0%, transparent 60%)',
          }}
        />

        {/* Terminator shadow */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, transparent 40%, rgba(0,0,0,0.55) 100%)',
          }}
        />
      </div>

      {/* Orbit ring */}
      <motion.div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotateX(75deg)',
          width: 340,
          height: 340,
          borderRadius: '50%',
          border: '1px solid rgba(14,165,233,0.2)',
          pointerEvents: 'none',
        }}
        initial={{ opacity: 0 }}
        animate={playing ? { opacity: [0, 0.6, 0.3] } : {}}
        transition={{ duration: 2, delay: 1.5, ease: EASE_STANDARD }}
      />

      {/* India pin marker — fades in at end of zoom */}
      <motion.div
        style={{
          position: 'absolute',
          top: '38%',
          left: '47%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
        }}
        initial={{ opacity: 0, y: -8 }}
        animate={playing ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.5, delay: 3.2, ease: EASE_STANDARD }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#0ea5e9',
            boxShadow: '0 0 12px rgba(14,165,233,0.8)',
            animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
          }}
        />
      </motion.div>
    </motion.div>
  </motion.div>
);

/** Staggered panel slide-in indicators */
const StagedPanels: React.FC<{ playing: boolean }> = ({ playing }) => (
  <div
    style={{
      position: 'absolute',
      bottom: '15%',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 260,
    }}
  >
    {PANEL_LABELS.map((label, i) => (
      <motion.div
        key={label}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          borderRadius: 8,
          background: 'rgba(var(--panel-bg-rgb),0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(var(--fg-rgb),var(--fg-a08))',
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        }}
        initial={{ opacity: 0, x: -24 }}
        animate={playing ? { opacity: 1, x: 0 } : {}}
        transition={{
          duration: 0.35,
          // first panel at 3.5s, each subsequent +0.2s
          delay: 3.5 + i * 0.2,
          ease: EASE_STANDARD,
        }}
      >
        {/* Animated check indicator */}
        <motion.div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#10b981',
            flexShrink: 0,
          }}
          initial={{ scale: 0 }}
          animate={playing ? { scale: [0, 1.4, 1] } : {}}
          transition={{
            duration: 0.3,
            delay: 3.5 + i * 0.2 + 0.25,
            ease: EASE_STANDARD,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: 'rgba(var(--fg-rgb),var(--fg-a6))',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {label}
        </span>
        <motion.span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: '#10b981',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
          initial={{ opacity: 0 }}
          animate={playing ? { opacity: 1 } : {}}
          transition={{ duration: 0.2, delay: 3.5 + i * 0.2 + 0.3 }}
        >
          OK
        </motion.span>
      </motion.div>
    ))}
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────────

export interface CinematicIntroProps {
  /** Override first-visit detection; forces the intro to show when true */
  forceShow?: boolean;
  /** Called when the intro finishes (either auto-dismiss or skip) */
  onComplete?: () => void;
}

/**
 * CinematicIntro — Full-screen cinematic intro sequence.
 *
 * Sequence:
 *  1. Logo fade-in (400ms)
 *  2. Globe zoom from space to India (3 seconds)
 *  3. UI panel labels staggered slide-in (200ms delay between each)
 *  4. Auto-dismiss after full sequence
 *
 * Auto-plays on first visit (uses localStorage key). A "Skip" button is
 * always available in the top-right corner.
 *
 * Validates: Requirements 5.3
 */
export const CinematicIntro: React.FC<CinematicIntroProps> = ({
  forceShow = false,
  onComplete,
}) => {
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setVisible(false);
    setPlaying(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    onComplete?.();
  }, [onComplete]);

  useEffect(() => {
    const alreadySeen = localStorage.getItem(FIRST_VISIT_KEY);

    if (forceShow || !alreadySeen) {
      // Mark as seen immediately so refresh doesn't replay
      localStorage.setItem(FIRST_VISIT_KEY, '1');
      setVisible(true);

      // Small rAF delay so framer-motion picks up the initial state
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPlaying(true));
      });

      // Auto-dismiss after sequence completes
      timerRef.current = setTimeout(dismiss, SEQUENCE_DURATION_MS);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [forceShow, dismiss]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="dialog"
          aria-label="MAUSAM intro sequence"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#060a16',
            overflow: 'hidden',
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE_STANDARD }}
        >
          {/* Star-field background */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `
                radial-gradient(1px 1px at 20% 30%, rgba(var(--fg-rgb),var(--fg-a4)) 0%, transparent 100%),
                radial-gradient(1px 1px at 80% 10%, rgba(var(--fg-rgb),var(--fg-a3)) 0%, transparent 100%),
                radial-gradient(1px 1px at 60% 70%, rgba(var(--fg-rgb),var(--fg-a3)) 0%, transparent 100%),
                radial-gradient(1px 1px at 10% 80%, rgba(var(--fg-rgb),var(--fg-a2)) 0%, transparent 100%),
                radial-gradient(1px 1px at 90% 50%, rgba(var(--fg-rgb),var(--fg-a3)) 0%, transparent 100%),
                radial-gradient(1px 1px at 45% 15%, rgba(var(--fg-rgb),var(--fg-a4)) 0%, transparent 100%),
                radial-gradient(1px 1px at 35% 90%, rgba(var(--fg-rgb),var(--fg-a2)) 0%, transparent 100%),
                radial-gradient(1px 1px at 75% 85%, rgba(var(--fg-rgb),var(--fg-a3)) 0%, transparent 100%)
              `,
              opacity: 0.8,
            }}
          />

          {/* Radial vignette at edge */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)',
              pointerEvents: 'none',
            }}
          />

          {/* Globe zoom animation */}
          <GlobeZoom playing={playing} />

          {/* ── Logo (fade-in 400ms) ── */}
          <motion.div
            style={{
              position: 'absolute',
              top: '18%',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              zIndex: 10,
              textAlign: 'center',
            }}
            initial={{ opacity: 0, y: -8 }}
            animate={playing ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, ease: EASE_STANDARD }}
          >
            {/* ISRO / MAUSAM logo mark */}
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #0ea5e9 0%, #22d3ee 60%, #6366f1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                boxShadow: '0 0 32px rgba(14,165,233,0.5), 0 0 64px rgba(14,165,233,0.15)',
                border: '2px solid rgba(var(--fg-rgb),var(--fg-a15))',
              }}
              aria-hidden="true"
            >
              ☁
            </div>

            <div>
              <div
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontWeight: 700,
                  fontSize: 32,
                  letterSpacing: '0.12em',
                  color: '#ffffff',
                  textShadow: '0 0 40px rgba(14,165,233,0.6)',
                  lineHeight: 1,
                }}
              >
                MAUSAM
              </div>
              <div
                style={{
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontWeight: 400,
                  fontSize: 12,
                  letterSpacing: '0.25em',
                  color: 'rgba(var(--fg-rgb),var(--fg-a4))',
                  marginTop: 6,
                  textTransform: 'uppercase',
                }}
              >
                Climate Digital Twin · ISRO BAH 2026
              </div>
            </div>
          </motion.div>

          {/* ── Staggered panel slide-ins ── */}
          <StagedPanels playing={playing} />

          {/* ── Skip button ── */}
          <button
            onClick={dismiss}
            aria-label="Skip intro"
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              zIndex: 20,
              padding: '6px 16px',
              borderRadius: 6,
              background: 'rgba(var(--fg-rgb),var(--fg-a05))',
              border: '1px solid rgba(var(--fg-rgb),var(--fg-a12))',
              color: 'rgba(var(--fg-rgb),var(--fg-a4))',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'background 200ms, color 200ms, border-color 200ms',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a12))';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(var(--fg-rgb),var(--fg-a75))';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(var(--fg-rgb),var(--fg-a2))';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--fg-rgb),var(--fg-a05))';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(var(--fg-rgb),var(--fg-a4))';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(var(--fg-rgb),var(--fg-a12))';
            }}
          >
            Skip
          </button>

          {/* ── Progress bar at bottom ── */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
              background: 'rgba(var(--fg-rgb),var(--fg-a05))',
            }}
          >
            <motion.div
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #0ea5e9, #22d3ee)',
                transformOrigin: 'left',
              }}
              initial={{ scaleX: 0 }}
              animate={playing ? { scaleX: 1 } : {}}
              transition={{ duration: SEQUENCE_DURATION_MS / 1000, ease: 'linear' }}
            />
          </div>

          {/* Inline keyframes for ping animation */}
          <style>{`
            @keyframes ping {
              75%, 100% { transform: scale(2); opacity: 0; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CinematicIntro;
