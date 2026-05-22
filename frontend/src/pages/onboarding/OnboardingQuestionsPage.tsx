import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { onboardingApi } from '@/api/onboarding';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { motion } from 'framer-motion';
import { SLIDE_UP } from '@/lib/animations';

export default function OnboardingQuestionsPage() {
  const { burst } = useParams<{ burst: string }>();
  const burstNum = parseInt(burst ?? '1', 10);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', 'questions', burstNum],
    queryFn: () => onboardingApi.getQuestions().then((r) => r.data),
  });

  useEffect(() => {
    setAnswers({});
  }, [burstNum]);

  const submitMutation = useMutation({
    mutationFn: () =>
      onboardingApi.submitAnswers({ answers, burst: burstNum }).then((r) => r.data),

    onSuccess: async (result) => {
      if ('voice_profile' in result && result.voice_profile) {
        // FINAL BURST COMPLETE
        setShowCelebration(true);
        
        // Refresh user state BEFORE navigation
        // This ensures the route guard sees onboarding_completed=true
        await refreshUser();
        
        // Small delay for celebration animation, then navigate
        setTimeout(() => {
          navigate('/onboarding/preview', { replace: true });
        }, 2000);
        
      } else if ('step' in result) {
        // PARTIAL BURST COMPLETE
        // Navigate to next burst (step is the completed one, so +1)
        navigate(`/onboarding/q/${result.step + 1}`);
      }
    },

    onError: (err) => {
      setServerError(err instanceof AppError ? err.message : 'Submission failed.');
    },
  });

  const questions = data?.questions ?? [];
  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  // Celebration screen
  if (showCelebration) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-6xl mb-4"
        >
          ✨
        </motion.div>
        <h2 className="text-xl font-bold text-text-primary mb-2">Your AI sales voice is ready!</h2>
        <p className="text-sm text-text-muted">Taking you to your profile...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          Help us understand your approach
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Round {burstNum} of 3 — these answers shape your Clutch AI coaching.
        </p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} onDismiss={() => setServerError('')} />
      )}

      <div className="space-y-4">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-surface-border p-5 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))
          : questions.map((q, i) => (
              <motion.div
                key={q.id}
                custom={i}
                variants={SLIDE_UP}
                initial="initial"
                animate="animate"
                className="bg-white rounded-lg border border-surface-border p-5"
              >
                <label className="block text-sm font-medium text-text-primary mb-2">
                  {i + 1}. {q.question}
                </label>
                <Textarea
                  placeholder="Your answer…"
                  rows={3}
                  value={answers[q.id] ?? ''}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                />
              </motion.div>
            ))}
      </div>

      <Button
        fullWidth
        size="md"
        disabled={!allAnswered || isLoading}
        isLoading={submitMutation.isPending}
        onClick={() => submitMutation.mutate()}
      >
        {burstNum === 3 ? 'Generate my sales profile →' : 'Continue →'}
      </Button>
    </div>
  );
}