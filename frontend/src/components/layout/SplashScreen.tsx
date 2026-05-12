import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SPLASH_LOGO, SPLASH_EXIT } from '@/lib/animations';

interface SplashScreenProps {
  isVisible: boolean;
}

export function SplashScreen({ isVisible }: SplashScreenProps) {
  const [showSlow, setShowSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="splash"
          variants={SPLASH_EXIT}
          initial="initial"
          exit="exit"
          className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center"
        >
          <motion.div
            variants={SPLASH_LOGO}
            initial="initial"
            animate="animate"
            className="flex flex-col items-center gap-4"
          >
            {/* Logo mark */}
            <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-brand">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="text-center">
              <span className="text-2xl font-bold text-text-primary tracking-tight">
                Foundersales
              </span>
              <p className="text-sm text-text-muted mt-0.5">Powered by Clutch AI</p>
            </div>
          </motion.div>

          {/* Animated dot */}
          <motion.div
            className="mt-10 w-1.5 h-1.5 rounded-full bg-brand"
            animate={{ scale: [1, 1.8, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {showSlow && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-10 text-xs text-text-muted"
            >
              Still loading…
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
