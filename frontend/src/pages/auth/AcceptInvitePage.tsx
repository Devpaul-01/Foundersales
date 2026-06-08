// ============================================================
// FILE: src/pages/auth/AcceptInvitePage.tsx
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { userApi } from '@/api/user';
import { onboardingApi } from '@/api/onboarding';
import { queryClient } from '@/lib/queryClient';
import { ROUTES } from '@/lib/constants';
import { Spinner } from '@/components/common/index';
import { Button } from '@/components/ui/Button';
import { AppError } from '@/api/types';

// ── Quick-fill chips ────────────────────────────────────────
const GOAL_SUGGESTIONS = [
  { label: 'Close more deals',           icon: '🤝', description: 'Increase conversion rates' },
  { label: 'Build my outreach pipeline', icon: '🚀', description: 'Generate more leads' },
  { label: 'Sharpen my sales skills',    icon: '📈', description: 'Improve sales techniques' },
  { label: 'Manage and coach my team',   icon: '👥', description: 'Lead sales teams effectively' },
  { label: 'Track my sales activity',    icon: '📊', description: 'Monitor performance metrics' },
] as const;

const EXPERIENCE_LEVELS = [
  { label: 'Just starting out', value: 'beginner',     icon: '🌱' },
  { label: '1–2 years',         value: 'intermediate', icon: '📗' },
  { label: '3–5 years',         value: 'experienced',  icon: '💼' },
  { label: '5+ years',          value: 'expert',       icon: '🏆' },
] as const;

type PageStatus =
  | 'loading'
  | 'needs_goal'
  | 'submitting'
  | 'success'
  | 'already_member'
  | 'error';

export default function AcceptInvitePage() {
  const [searchParams]  = useSearchParams();
  const token           = searchParams.get('token');
  const navigate        = useNavigate();
  const { isAuthenticated, isLoading, refreshUser, user } = useAuth();

  const [status, setStatus]               = useState<PageStatus>('loading');
  const [message, setMessage]             = useState('');
  const [workspaceName, setWorkspaceName] = useState('');

  // ── Form state ───────────────────────────────────────────
  const [userName,         setUserName]         = useState('');
  const [goalText,         setGoalText]         = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  const [experienceLevel,  setExperienceLevel]  = useState('');
  const [bio,              setBio]              = useState('');
  const [websites,         setWebsites]         = useState<string[]>([]);
  const [websiteInput,     setWebsiteInput]     = useState('');

  const nameInputRef  = useRef<HTMLInputElement>(null);
  const textareaRef   = useRef<HTMLTextAreaElement>(null);
  const bioRef        = useRef<HTMLTextAreaElement>(null);

  // ── Auto-grow textareas ──────────────────────────────────
  const growEl = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // ── Accept invite once auth state is known ───────────────
  useEffect(() => {
    if (isLoading) return;

    if (!token) {
      setStatus('error');
      setMessage('No invite token provided. Please check your invite link.');
      return;
    }

    if (!isAuthenticated) {
      localStorage.setItem('pending_invite_token', token);
      navigate(`${ROUTES.LOGIN}?invite=1`, { replace: true });
      return;
    }

    const accept = async () => {
      try {
        const { data } = await userApi.acceptInvite(token);
        await refreshUser();
        queryClient.clear();
        setWorkspaceName(data.workspace.name);

        if (data.needs_profile_setup) {
          if (user?.name) setUserName(user.name);
          setStatus('needs_goal');
          setTimeout(() => nameInputRef.current?.focus(), 50);
        } else {
          setStatus('success');
          setMessage(`Welcome to ${data.workspace.name}!`);
          setTimeout(() => navigate(ROUTES.HOME, { replace: true }), 1500);
        }
      } catch (err) {
        if (err instanceof AppError) {
          if (err.code === 'ALREADY_A_MEMBER') {
            setStatus('already_member');
          } else if (err.code === 'INVALID_OR_EXPIRED_TOKEN') {
            setStatus('error');
            setMessage('This invite link has expired or is invalid.');
          } else {
            setStatus('error');
            setMessage(err.message || 'Failed to accept invite. Please try again.');
          }
        } else {
          setStatus('error');
          setMessage('An unexpected error occurred.');
        }
      }
    };

    accept();
  }, [isLoading, isAuthenticated, token, navigate, refreshUser]);

  // ── Website helpers ──────────────────────────────────────
  const addWebsite = () => {
    const trimmed = websiteInput.trim();
    if (!trimmed) return;
    // Normalise: prepend https:// if no protocol
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!websites.includes(url)) setWebsites(prev => [...prev, url]);
    setWebsiteInput('');
  };

  const removeWebsite = (url: string) =>
    setWebsites(prev => prev.filter(w => w !== url));

  const handleWebsiteKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addWebsite(); }
  };

  // ── Submit ───────────────────────────────────────────────
  const handleGoalSubmit = async () => {
    const trimmedGoal = goalText.trim();
    const trimmedName = userName.trim();
    if (!trimmedGoal || status === 'submitting') return;
    setStatus('submitting');
    try {
      await onboardingApi.submitAbbreviated({
        primary_goal: trimmedGoal,
        ...(trimmedName      ? { name: trimmedName }                       : {}),
        ...(experienceLevel  ? { experience_level: experienceLevel }       : {}),
        ...(bio.trim()       ? { bio: bio.trim() }                         : {}),
        ...(websites.length  ? { websites }                                : {}),
      });
    } catch {
      // Non-fatal — profile setup failure shouldn't block app access.
    }
    navigate(ROUTES.HOME, { replace: true });
  };

  const handleSuggestionClick = (suggestionLabel: string) => {
    setSelectedSuggestion(suggestionLabel);
    setGoalText(suggestionLabel);
    textareaRef.current?.focus();
    setTimeout(() => growEl(textareaRef.current), 0);
  };

  const handleCustomInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setGoalText(e.target.value);
    setSelectedSuggestion(null);
    growEl(e.target);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGoalSubmit();
    }
  };

  // ── Loading ──────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-text-muted">Accepting your invitation…</p>
      </div>
    );
  }

  // ── Profile setup step ───────────────────────────────────
  if (status === 'needs_goal' || status === 'submitting') {
    const canSubmit = goalText.trim().length > 0;

    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* Header */}
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🎉</div>
            <h2 className="text-xl font-bold text-text-primary mb-1">
              You've joined {workspaceName}
            </h2>
            <p className="text-sm text-text-muted">
              A few quick things to get you started
            </p>
          </div>

          {/* ── Name ─────────────────────────────────────── */}
          <label className="block text-sm font-medium text-text-primary mb-2">
            What's your name?
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); textareaRef.current?.focus(); }
            }}
            placeholder="e.g., Alex Johnson"
            disabled={status === 'submitting'}
            className={[
              'w-full rounded-lg border px-3.5 py-3 text-sm mb-5',
              'text-text-primary placeholder:text-text-muted/60',
              'outline-none transition-all duration-150',
              'focus:border-brand focus:ring-2 focus:ring-brand/20',
              'disabled:opacity-50',
              userName.trim()
                ? 'border-brand/60 bg-brand-50/30'
                : 'border-surface-border bg-white',
            ].join(' ')}
          />

          {/* ── Experience level ──────────────────────────── */}
          <label className="block text-sm font-medium text-text-primary mb-2">
            How much sales experience do you have?
          </label>
          <div className="flex flex-wrap gap-2 mb-5">
            {EXPERIENCE_LEVELS.map(lvl => (
              <button
                key={lvl.value}
                type="button"
                disabled={status === 'submitting'}
                onClick={() => setExperienceLevel(
                  experienceLevel === lvl.value ? '' : lvl.value
                )}
                className={[
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium',
                  'transition-all duration-100 outline-none',
                  'focus-visible:ring-2 focus-visible:ring-brand/40',
                  'disabled:opacity-50',
                  experienceLevel === lvl.value
                    ? 'border-brand bg-brand text-white'
                    : 'border-surface-border hover:border-brand/40 hover:bg-surface-hover text-text-primary',
                ].join(' ')}
              >
                <span>{lvl.icon}</span>
                <span>{lvl.label}</span>
              </button>
            ))}
          </div>

          {/* ── Primary goal ──────────────────────────────── */}
          <label className="block text-sm font-medium text-text-primary mb-2">
            What's your primary goal? <span className="text-brand">*</span>
          </label>
          <textarea
            ref={textareaRef}
            rows={2}
            value={goalText}
            onChange={handleCustomInput}
            onKeyDown={handleKeyDown}
            placeholder="e.g., close more enterprise deals this quarter, improve team performance…"
            disabled={status === 'submitting'}
            className={[
              'w-full resize-none rounded-lg border px-3.5 py-3 text-sm',
              'text-text-primary placeholder:text-text-muted/60',
              'outline-none transition-all duration-150 overflow-hidden',
              'focus:border-brand focus:ring-2 focus:ring-brand/20',
              'disabled:opacity-50',
              canSubmit && !selectedSuggestion
                ? 'border-brand/60 bg-brand-50/30'
                : 'border-surface-border bg-white',
            ].join(' ')}
          />

          {goalText.length > 0 ? (
            <p className="text-xs text-text-muted mt-1.5 mb-3">
              {goalText.length} characters • {canSubmit ? '✓ Ready' : 'Keep going…'}
            </p>
          ) : (
            <p className="text-xs text-text-muted mt-1.5 mb-3">
              Write your own or pick from the suggestions below
            </p>
          )}

          {/* Goal suggestion chips */}
          <div className="mb-5">
            <p className="text-xs font-medium text-text-muted mb-2">Suggested goals:</p>
            <div className="flex flex-wrap gap-2">
              {GOAL_SUGGESTIONS.map(s => (
                <button
                  key={s.label}
                  type="button"
                  disabled={status === 'submitting'}
                  onClick={() => handleSuggestionClick(s.label)}
                  className={[
                    'group flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-lg border text-left',
                    'transition-all duration-100 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-brand/40',
                    selectedSuggestion === s.label
                      ? 'border-brand bg-brand text-white'
                      : 'border-surface-border hover:border-brand/40 hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{s.icon}</span>
                    <span className="text-xs font-medium">{s.label}</span>
                  </div>
                  <span className={`text-[11px] ${
                    selectedSuggestion === s.label ? 'text-white/80' : 'text-text-muted'
                  }`}>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Bio ──────────────────────────────────────── */}
          <label className="block text-sm font-medium text-text-primary mb-1">
            Short bio{' '}
            <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <p className="text-xs text-text-muted mb-2">
            A sentence about what you do — helps Clutch personalise outreach for you.
          </p>
          <textarea
            ref={bioRef}
            rows={2}
            value={bio}
            onChange={e => { setBio(e.target.value); growEl(bioRef.current); }}
            placeholder="e.g., I'm an AE at a B2B SaaS company selling to mid-market ops teams."
            disabled={status === 'submitting'}
            className={[
              'w-full resize-none rounded-lg border px-3.5 py-3 text-sm mb-5',
              'text-text-primary placeholder:text-text-muted/60',
              'outline-none transition-all duration-150 overflow-hidden',
              'focus:border-brand focus:ring-2 focus:ring-brand/20',
              'disabled:opacity-50',
              bio.trim()
                ? 'border-brand/60 bg-brand-50/30'
                : 'border-surface-border bg-white',
            ].join(' ')}
          />

          {/* ── Websites ─────────────────────────────────── */}
          <label className="block text-sm font-medium text-text-primary mb-1">
            Your website(s){' '}
            <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <p className="text-xs text-text-muted mb-2">
            LinkedIn, personal site, company URL — press Enter or Add to include each one.
          </p>
          <div className="flex gap-2 mb-2">
            <input
              type="url"
              value={websiteInput}
              onChange={e => setWebsiteInput(e.target.value)}
              onKeyDown={handleWebsiteKeyDown}
              placeholder="https://yoursite.com"
              disabled={status === 'submitting'}
              className={[
                'flex-1 rounded-lg border px-3.5 py-2.5 text-sm',
                'text-text-primary placeholder:text-text-muted/60',
                'outline-none transition-all duration-150',
                'focus:border-brand focus:ring-2 focus:ring-brand/20',
                'disabled:opacity-50 border-surface-border bg-white',
              ].join(' ')}
            />
            <button
              type="button"
              onClick={addWebsite}
              disabled={!websiteInput.trim() || status === 'submitting'}
              className={[
                'px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all duration-100',
                'outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                websiteInput.trim()
                  ? 'border-brand text-brand hover:bg-brand hover:text-white'
                  : 'border-surface-border text-text-muted cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              Add
            </button>
          </div>

          {/* Website pills */}
          {websites.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {websites.map(url => (
                <span
                  key={url}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50/40 border border-brand/20 text-xs text-brand"
                >
                  <span className="truncate max-w-[180px]">{url}</span>
                  <button
                    type="button"
                    onClick={() => removeWebsite(url)}
                    disabled={status === 'submitting'}
                    className="text-brand/60 hover:text-brand transition-colors ml-0.5"
                    aria-label={`Remove ${url}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* ── Submit ───────────────────────────────────── */}
          <Button
            fullWidth
            onClick={handleGoalSubmit}
            disabled={!canSubmit}
            isLoading={status === 'submitting'}
            size="md"
          >
            {selectedSuggestion
              ? `Get started with "${selectedSuggestion}"`
              : 'Get started'}
          </Button>

          <p className="text-center text-xs text-text-muted mt-3">
            ⌘ + Enter to submit • You can update all of this later in settings
          </p>
        </div>
      </div>
    );
  }

  // ── Terminal states ──────────────────────────────────────
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-8 text-center">
      {status === 'success' && (
        <>
          <div className="text-4xl mb-3">🎉</div>
          <h2 className="font-semibold text-text-primary mb-2">{message}</h2>
          <p className="text-sm text-text-muted">Redirecting you…</p>
        </>
      )}

      {status === 'already_member' && (
        <>
          <div className="text-4xl mb-3">✅</div>
          <h2 className="font-semibold text-text-primary mb-2">You're already a member</h2>
          <p className="text-sm text-text-muted mb-4">
            You already have access to this workspace.
          </p>
          <Link to={ROUTES.HOME}>
            <Button size="sm">Go to dashboard</Button>
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="text-4xl mb-3">⚠️</div>
          <h2 className="font-semibold text-text-primary mb-2">Invite failed</h2>
          <p className="text-sm text-text-muted mb-6">{message}</p>
          <Link to={ROUTES.LOGIN}>
            <Button variant="secondary" size="sm">Back to sign in</Button>
          </Link>
        </>
      )}
    </div>
  );
}
