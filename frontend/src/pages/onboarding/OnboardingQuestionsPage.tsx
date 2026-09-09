import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { motion } from 'framer-motion';
import { SLIDE_UP } from '@/lib/animations';

const BURST_NUM = 2;
const TOTAL_BURSTS = 3;

const DEMO_QUESTIONS = [
  {
    id: 'q1',
    question: 'Walk us through how a typical customer discovers they have this problem.',
    answer:
      "Usually it's a Friday afternoon — a stakeholder asks for updated numbers 'by Monday morning' and whoever owns reporting realizes they're about to spend hours manually pulling data from four different tools instead of enjoying their weekend.",
  },
  {
    id: 'q2',
    question: "What's the moment a prospect goes from 'interested' to 'ready to buy'?",
    answer:
      'It usually clicks during the live dashboard audit — when they see their actual data populate a report in real time and realize they never have to build that deck by hand again.',
  },
  {
    id: 'q3',
    question: 'What do competitors get wrong that you get right?',
    answer:
      "Most BI tools assume clean data is already sitting in a warehouse. We built the messy first mile — pulling from scattered tools and cleaning it — which is the part that actually eats people's time.",
  },
];

export default function OnboardingQuestionsPage() {
  const burstNum = BURST_NUM;
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(DEMO_QUESTIONS.map((q) => [q.id, q.answer])),
  );
  const [serverError] = useState('');
  const [showCelebration, setShowCelebration] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const questions = DEMO_QUESTIONS;
  const allAnswered = questions.every((q) => (answers[q.id] ?? '').trim().length > 0);

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      if (burstNum === TOTAL_BURSTS) {
        setShowCelebration(true);
      }
      // Static demo — no navigation/network side effects otherwise.
    }, 600);
  };

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
          Round {burstNum} of {TOTAL_BURSTS} — these answers shape your Clutch AI coaching.
        </p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} />
      )}

      <div className="space-y-4">
        {questions.map((q, i) => (
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
        disabled={!allAnswered}
        isLoading={isSubmitting}
        onClick={handleSubmit}
      >
        {burstNum === TOTAL_BURSTS ? 'Generate my sales profile →' : 'Continue →'}
      </Button>
    </div>
  );
}
