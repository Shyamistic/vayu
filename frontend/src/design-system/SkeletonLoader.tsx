import React from 'react';

export type SkeletonVariant = 'text' | 'card' | 'circle';

export interface SkeletonLoaderProps {
  /** Shape variant: text (inline rectangle), card (larger block), circle */
  variant?: SkeletonVariant;
  /** Width — CSS value (e.g. '100%', '200px'). Defaults vary by variant. */
  width?: string;
  /** Height — CSS value (e.g. '16px', '120px'). Defaults vary by variant. */
  height?: string;
  /** Additional CSS class names */
  className?: string;
  /** Number of skeleton lines to render (only for text variant) */
  count?: number;
}

const variantDefaults: Record<SkeletonVariant, { width: string; height: string; borderRadius: string }> = {
  text: { width: '100%', height: '14px', borderRadius: '6px' },
  card: { width: '100%', height: '120px', borderRadius: '12px' },
  circle: { width: '40px', height: '40px', borderRadius: '50%' },
};

/**
 * SkeletonLoader — Animated shimmer placeholder for loading states.
 *
 * Uses a left-to-right gradient sweep animation.
 * Supports text, card, and circle variants with configurable dimensions.
 *
 * Validates: Requirements 88.1
 */
export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'text',
  width,
  height,
  className = '',
  count = 1,
}) => {
  const defaults = variantDefaults[variant];

  const style: React.CSSProperties = {
    width: width ?? defaults.width,
    height: height ?? defaults.height,
    borderRadius: defaults.borderRadius,
    background: `linear-gradient(90deg,
      rgba(var(--fg-rgb),var(--fg-a05)) 25%,
      rgba(var(--fg-rgb),var(--fg-a1)) 50%,
      rgba(var(--fg-rgb),var(--fg-a05)) 75%
    )`,
    backgroundSize: '200% 100%',
    animation: 'skeleton-shimmer 1.5s ease-in-out infinite',
  };

  if (count > 1 && variant === 'text') {
    return (
      <div className={`skeleton-loader-group ${className}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="skeleton-loader"
            style={{
              ...style,
              // Make last line shorter for a natural look
              width: i === count - 1 ? '70%' : (width ?? defaults.width),
            }}
            role="presentation"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`skeleton-loader ${className}`}
      style={style}
      role="presentation"
      aria-hidden="true"
    />
  );
};

export default SkeletonLoader;
