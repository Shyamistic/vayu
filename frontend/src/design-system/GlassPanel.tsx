import React from 'react';

export interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  /** Optional HTML element to render as (defaults to div) */
  as?: keyof React.JSX.IntrinsicElements;
}

const paddingValues: Record<NonNullable<GlassPanelProps['padding']>, string | undefined> = {
  none: undefined,
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
};

/**
 * GlassPanel — A glass-morphism container using backdrop-filter blur.
 *
 * Applies:
 * - backdrop-filter: blur(12px)
 * - background: rgba(6, 10, 22, 0.85)
 * - Subtle border and shadow
 *
 * Validates: Requirements 5.2
 */
export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  className = '',
  padding = 'md',
  as: Component = 'div',
}) => {
  const style: React.CSSProperties = {
    background: 'rgba(6, 10, 22, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
    padding: paddingValues[padding],
  };

  return React.createElement(
    Component,
    { className: `glass-panel ${className}`.trim(), style },
    children
  );
};

export default GlassPanel;
