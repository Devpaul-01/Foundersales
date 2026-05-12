// ============================================================
// FILE: src/pages/NotFoundPage.tsx
// ============================================================
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ROUTES } from '@/lib/constants';

export default function NotFoundPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-8 text-center bg-surface-base">
      <div className="text-6xl mb-4">🚪</div>
      <h1 className="text-2xl font-bold text-text-primary mb-2">Nothing here.</h1>
      <p className="text-sm text-text-muted mb-8 max-w-xs">
        This page doesn't exist or you don't have access.
      </p>
      <Link to={ROUTES.HOME}>
        <Button>Go Home</Button>
      </Link>
    </div>
  );
}
