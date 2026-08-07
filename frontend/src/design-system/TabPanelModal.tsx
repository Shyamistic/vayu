import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export interface TabPanelModalProps {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * TabPanelModal — a centered glass-morphism dialog for drawer tabs whose
 * content (What-If, Metrics, History, Cases, Crops, Env) should open as a
 * pop-up instead of rendering inline in the always-open drawer.
 */
export function TabPanelModal({ open, title, icon, onClose, children }: TabPanelModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Callers pass `onClose` as an inline arrow (e.g. App.tsx's
  // `onClose={() => update({ viewMode: 'prediction' })}`), so it's a new
  // function reference on every render of the caller — which happens
  // continuously while this modal is open (forecast-day animation ticks
  // every 1-3s, plus a 30s health poll). With `onClose` in the effect's
  // dependency array, EVERY one of those unrelated re-renders re-ran
  // `closeButtonRef.current?.focus()`, yanking focus back to the close
  // button out from under whatever field the user had focused inside the
  // modal — surfacing as "any input loses focus a moment after I interact
  // with it," independent of what that input actually was. A ref sidesteps
  // this: the effect (and the one-time autofocus it performs) only depends
  // on `open`, while the Escape handler still always calls the latest
  // `onClose` via the ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 modal-scrim"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(94vw,960px)] max-h-[85vh] rounded-2xl flex flex-col overflow-hidden animate-slide-in-up"
        style={{
          background: 'rgba(var(--panel-bg-rgb), 0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(var(--fg-rgb), var(--fg-a1))',
          boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(var(--fg-rgb), var(--fg-a08))' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {icon}
            {title}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="text-foreground/50 hover:text-foreground transition-colors p-1 rounded-md hover:bg-foreground/10"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

export default TabPanelModal;
