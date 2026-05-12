import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { onboardingApi } from '@/api/onboarding';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge } from '@/components/ui/Badge';
import { CopyButton } from '@/components/common/index';
import { ROUTES } from '@/lib/constants';
import { Sparkles, Check } from 'lucide-react';

export default function OnboardingPreviewPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', 'sample-message'],
    queryFn:  () => onboardingApi.generateSampleMessage().then((r) => r.data),
    staleTime: Infinity,
    retry: 1,
  });

  const { data: status } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn:  () => onboardingApi.getStatus().then((r) => r.data),
  });

  const handleStart = () => navigate(ROUTES.HOME, { replace: true });

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-brand" size={22} />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">Here's what Clutch will write for you</h1>
        <p className="text-sm text-text-muted mt-1">
          Based on your profile, this is a real outreach message in your voice.
        </p>
      </div>

      {/* Voice profile summary */}
      {status && (
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Check size={14} className="text-success" /> Your Clutch AI Profile
          </h3>
          <div className="space-y-2 text-sm">
            {[
              { label: 'Voice style',    value: status.business_name },
              { label: 'Business',       value: status.business_name },
            ].filter((r) => r.value).map((row) => (
              <div key={row.label} className="flex items-start gap-2">
                <span className="text-text-muted shrink-0 w-28">{row.label}</span>
                <span className="text-text-primary">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generated message */}
      <div className="bg-white rounded-lg border border-brand-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Generated outreach message</h3>
            {data?.based_on_opportunity && data.opportunity_context && (
              <p className="text-xs text-text-muted mt-0.5 truncate max-w-xs">
                Based on: {data.opportunity_context}
              </p>
            )}
          </div>
          {data?.sample_message && <CopyButton text={data.sample_message} />}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : (
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">
            {data?.sample_message ?? 'Could not generate a sample message — complete your profile first.'}
          </p>
        )}

        <p className="text-xs text-text-muted italic border-t border-surface-border pt-2">
          This is what Clutch sounds like when it knows your business.
        </p>
      </div>

      <Button fullWidth size="md" onClick={handleStart}>
        Let's go →
      </Button>
    </div>
  );
}
