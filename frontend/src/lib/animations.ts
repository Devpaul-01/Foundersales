import type { Variants, Transition } from 'framer-motion';

// ── Page Transitions ──────────────────────────────────────────
export const PAGE_VARIANTS: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -4 },
};

export const PAGE_TRANSITION: Transition = {
  duration: 0.2,
  ease: 'easeOut',
};

// ── Fade ──────────────────────────────────────────────────────
export const FADE_IN: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
};

// ── Scale ─────────────────────────────────────────────────────
export const SCALE_IN: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.96, transition: { duration: 0.15 } },
};

// ── Card / List Stagger ───────────────────────────────────────
export const STAGGER_CONTAINER: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

export const STAGGER_ITEM: Variants = {
  hidden:  { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18 } },
};

export const CARD_ENTER: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.18 },
  }),
};

// ── Slide ─────────────────────────────────────────────────────
export const SLIDE_UP: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
  exit:    { opacity: 0, y: 8,  transition: { duration: 0.15 } },
};

export const SLIDE_DOWN: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

// ── Modal ─────────────────────────────────────────────────────
export const MODAL_BACKDROP: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.15 } },
};

export const MODAL_PANEL: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1,    y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
  exit:    { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.15 } },
};

// ── Drawer ────────────────────────────────────────────────────
export const DRAWER_RIGHT: Variants = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
  exit:    { x: '100%', transition: { duration: 0.22 } },
};

export const DRAWER_LEFT: Variants = {
  initial: { x: '-100%' },
  animate: { x: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
  exit:    { x: '-100%', transition: { duration: 0.22 } },
};

export const DRAWER_BOTTOM: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
  exit:    { y: '100%', transition: { duration: 0.22 } },
};

// ── Toast ─────────────────────────────────────────────────────
export const TOAST_VARIANTS: Variants = {
  initial: { opacity: 0, y: -16, scale: 0.95 },
  animate: { opacity: 1, y: 0,   scale: 1,   transition: { duration: 0.2 } },
  exit:    { opacity: 0, scale: 0.9,          transition: { duration: 0.15 } },
};

// ── Sidebar ───────────────────────────────────────────────────
export const SIDEBAR_OVERLAY: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit:    { opacity: 0, transition: { duration: 0.18 } },
};

// ── Buyer State Meters ────────────────────────────────────────
export const METER_TRANSITION: Transition = {
  duration: 0.6,
  ease: 'easeOut',
};

// ── Splash ────────────────────────────────────────────────────
export const SPLASH_LOGO: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

export const SPLASH_EXIT: Variants = {
  initial: { opacity: 1 },
  exit:    { opacity: 0, transition: { duration: 0.35, ease: 'easeInOut' } },
};

// ── Confetti items (pipeline won) ─────────────────────────────
export function confettiVariant(index: number): Variants {
  const x = (Math.random() - 0.5) * 120;
  const y = -(80 + Math.random() * 120);
  return {
    initial: { opacity: 1, x: 0, y: 0, scale: 1 },
    animate: {
      opacity: [1, 1, 0],
      x,
      y,
      scale: [1, 1.2, 0.8],
      transition: {
        duration: 1.2,
        delay:    index * 0.05,
        ease: 'easeOut',
      },
    },
  };
}
