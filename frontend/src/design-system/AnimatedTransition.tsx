import React from 'react';
import { motion, type Variants } from 'framer-motion';

export type AnimationType = 'fade' | 'slide' | 'scale';

export interface AnimatedTransitionProps {
  children: React.ReactNode;
  /** Animation type: fade, slide (from bottom), or scale */
  type?: AnimationType;
  /** Duration in milliseconds (200–400ms range). Defaults to 300ms. */
  duration?: number;
  /** Delay before animation starts, in milliseconds */
  delay?: number;
  /** Additional CSS class names */
  className?: string;
}

/** Standard easing curve: cubic-bezier(0.4, 0, 0.2, 1) */
const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];

const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const slideVariants: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 16 },
};

const scaleVariants: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.92 },
};

const variantMap: Record<AnimationType, Variants> = {
  fade: fadeVariants,
  slide: slideVariants,
  scale: scaleVariants,
};

/**
 * AnimatedTransition — Wrapper component providing entrance/exit animations.
 *
 * Uses framer-motion with cubic-bezier(0.4, 0, 0.2, 1) easing.
 * Duration is clamped between 200ms and 400ms per design system spec.
 *
 * Validates: Requirements 5.5
 */
export const AnimatedTransition: React.FC<AnimatedTransitionProps> = ({
  children,
  type = 'fade',
  duration = 300,
  delay = 0,
  className = '',
}) => {
  // Clamp duration to 200–400ms range per design system spec
  const clampedDuration = Math.max(200, Math.min(400, duration)) / 1000;
  const delaySeconds = delay / 1000;

  const variants = variantMap[type];

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{
        duration: clampedDuration,
        delay: delaySeconds,
        ease: EASE_STANDARD,
      }}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedTransition;
