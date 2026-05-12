// ============================================================
// FILE: src/pages/auth/AcceptInvitePage.tsx
// ============================================================
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { userApi } from '@/api/user';
import { onboardingApi } from '@/api/onboarding';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { queryClient } from '@/lib/queryClient';
import { ROUTES } from '@/lib/constants';
import { Spinner } from '@/components/common/index';
import { Button } from '@/components/ui/Button';
import { AppError } from '@/api/types';

export default function AcceptInvitePage() {
  const { token }        = useParams<{ token: string }>();
  const navigate         = useNavigate();
  const { isAuthenticated, isLoading, refreshUser } = useAuth();
  const { switchWorkspace } = useWorkspaceContext();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'already_member'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Store token and redirect to login
      sessionStorage.setItem('pending_invite_token', token ?? '');
      navigate(`${ROUTES.LOGIN}?invite=1`, { replace: true });
      return;
    }

    const accept = async () => {
      try {
        const { data } = await userApi.acceptInvite(token!);
        // Set active workspace
        await refreshUser();
        queryClient.clear();

        if (data.needs_profile_setup) {
          await onboardingApi.submitAbbreviated({});
        }
        setStatus('success');
        setMessage(`Welcome to ${data.workspace.name}!`);
        setTimeout(() => navigate(ROUTES.HOME, { replace: true }), 1500);
      } catch (err) {
        if (err instanceof AppError) {
          if (err.code === 'ALREADY_A_MEMBER') {
            setStatus('already_member');
          } else if (err.code === 'INVALID_OR_EXPIRED_TOKEN') {
            setStatus('error');
            setMessage('This invite link has expired or is invalid.');
          } else {
            setStatus('error');
            setMessage(err.message);
          }
        }
      }
    };
    accept();
  }, [isLoading, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-text-muted">Accepting your invitation…</p>
      </div>
    );
  }

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
          <Link to={ROUTES.HOME}>
            <Button size="sm" className="mt-4">Go to dashboard</Button>
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