import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { label: 'Your Info',   path: '/onboarding/basic' },
  { label: 'Q&A — 1',    path: '/onboarding/q/1' },
  { label: 'Q&A — 2',    path: '/onboarding/q/2' },
  { label: 'Q&A — 3',    path: '/onboarding/q/3' },
  { label: 'Preview',    path: '/onboarding/preview' },
];

function getStep(pathname: string) {
  if (pathname.includes('/basic'))   return 0;
  if (pathname.includes('/q/1'))     return 1;
  if (pathname.includes('/q/2'))     return 2;
  if (pathname.includes('/q/3'))     return 3;
  if (pathname.includes('/preview')) return 4;
  return 0;
}

export function OnboardingLayout() {
  const { pathname } = useLocation();
  const currentStep  = getStep(pathname);

  return (
    <div className="min-h-dvh bg-surface-base flex flex-col">
      {/* Fixed header */}
      <header className="fixed top-0 inset-x-0 z-30 bg-white border-b border-surface-border h-14 flex items-center px-6">
        <div className="flex items-center gap-2 mr-8">
          <div className="w-6 h-6 rounded-lg bg-brand flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-white" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <span className="font-bold text-sm text-text-primary">Foundersales</span>
        </div>
        {/* Step indicator */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-0">
            {STEPS.map((step, i) => (
              <React.Fragment key={step.path}>
                {/* Step circle */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                    i < currentStep  ? 'bg-brand border-brand text-white' :
                    i === currentStep ? 'border-brand text-brand bg-brand-50 ring-2 ring-brand ring-offset-1' :
                    'border-slate-200 text-text-muted bg-white',
                  )}>
                    {i < currentStep ? <Check size={13} /> : i + 1}
                  </div>
                  <span className={cn(
                    'text-[9px] mt-1 font-medium whitespace-nowrap hidden sm:block',
                    i === currentStep ? 'text-brand' : i < currentStep ? 'text-success' : 'text-text-muted',
                  )}>
                    {step.label}
                  </span>
                </div>
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    'h-0.5 w-8 sm:w-12 mx-1 mb-4 transition-colors',
                    i < currentStep ? 'bg-brand' : 'bg-slate-200',
                  )} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="w-24" />
      </header>

      {/* Content */}
      <main className="flex-1 pt-20 pb-8">
        <div className="max-w-2xl mx-auto px-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
