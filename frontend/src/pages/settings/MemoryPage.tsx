// FILE: src/pages/settings/MemoryPage.tsx
// Demo build — static local data, no API calls
import React, { useState } from 'react';
import { Toggle }      from '@/components/ui/Input';
import { Brain, Trash2 } from 'lucide-react';

interface MemoryFact {
  id: string;
  content: string;
  category: string;
  created_at: string;
}

const INITIAL_FACTS: MemoryFact[] = [
  {
    id: 'fact_1',
    content: 'Runs a B2B SaaS company called Northwind Analytics, focused on marketing attribution.',
    category: 'business',
    created_at: '2026-09-05T14:22:00Z',
  },
  {
    id: 'fact_2',
    content: 'Prefers a direct, no-fluff tone in outreach — avoids exclamation points and emojis.',
    category: 'voice',
    created_at: '2026-09-03T09:10:00Z',
  },
  {
    id: 'fact_3',
    content: 'Primary target audience is Series A–B startups with 20–200 employees.',
    category: 'business',
    created_at: '2026-08-30T17:45:00Z',
  },
  {
    id: 'fact_4',
    content: 'Closed a deal with Fenwick Robotics in August — mentioned it as a reference case.',
    category: 'deals',
    created_at: '2026-08-27T11:05:00Z',
  },
  {
    id: 'fact_5',
    content: 'Usually does outreach practice sessions on weekday mornings before 10am.',
    category: 'habits',
    created_at: '2026-08-22T08:30:00Z',
  },
  {
    id: 'fact_6',
    content: 'Dislikes cold-call scripts that open with "How are you today?" — finds it robotic.',
    category: 'voice',
    created_at: '2026-08-18T15:52:00Z',
  },
  {
    id: 'fact_7',
    content: 'Competes primarily against Segment and mParticle in sales conversations.',
    category: 'business',
    created_at: '2026-08-14T13:18:00Z',
  },
  {
    id: 'fact_8',
    content: 'Goal for Q4 is to book 40 qualified demos per month, up from 25.',
    category: 'goals',
    created_at: '2026-08-09T10:40:00Z',
  },
];

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date('2026-09-08T12:00:00Z');
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks === 1) return '1 week ago';
  if (diffDays < 30) return `${weeks} weeks ago`;
  const months = Math.floor(diffDays / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export default function MemoryPage() {
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [facts, setFacts] = useState<MemoryFact[]>(INITIAL_FACTS);

  const handleDelete = (id: string) => {
    setFacts((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="page-container max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-text-primary">AI Memory</h1>

      {/* Toggle */}
      <div className="bg-white border border-surface-border rounded-lg p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-primary">Memory enabled</p>
          <p className="text-xs text-text-muted mt-0.5">
            Clutch remembers facts about you across conversations.
          </p>
        </div>
        <Toggle checked={memoryEnabled} onChange={setMemoryEnabled} />
      </div>

      {/* Facts list */}
      <div className="bg-white border border-surface-border rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-text-primary px-4 py-3 border-b border-surface-border">
          Stored facts ({facts.length})
        </p>
        {facts.map((f) => (
          <div
            key={f.id}
            className="flex items-start gap-3 px-4 py-3 border-b border-surface-border last:border-0"
          >
            <Brain size={13} className="text-brand mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary">{f.content}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {f.category && <span className="capitalize">{f.category} · </span>}
                {formatRelativeDate(f.created_at)}
              </p>
            </div>
            <button
              onClick={() => handleDelete(f.id)}
              className="p-1 text-text-muted hover:text-danger transition-colors shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
