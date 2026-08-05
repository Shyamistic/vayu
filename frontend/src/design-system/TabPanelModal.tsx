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

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[min(94vw,960px)] max-h-[85vh] rounded-2xl flex flex-col overflow-hidden animate-slide-in-up"
        style={{
          background: 'rgba(6, 10, 22, 0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {icon}
            {title}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="text-white/50 hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
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
