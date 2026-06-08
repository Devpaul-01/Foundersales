// src/pages/auth/OAuthCallbackPage.tsx (REFINED)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { authApi } from '@/api/auth';
import { setTokens, scheduleRefresh } from '@/lib/auth';
import { ROUTES } from '@/lib/constants';
import { Spinner } from '@/components/common/index';

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const handle = async () => {
      try {
        // ✅ Tokens are in the hash — parse them directly, no Supabase client needed
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const expires_in = parseInt(params.get('expires_in') || '3600', 10);

        if (!access_token) throw new Error('No access token in callback URL');

        const response = await authApi.googleCallback({
          access_token,
          refresh_token: refresh_token ?? undefined,
          expires_in,
        });

        setTokens(response.access_token, response.refresh_token || '', response.expires_in || 3600);
        scheduleRefresh(response.expires_in || 3600);
        await refreshUser();

        console.log('[OAuth Callback Response]', JSON.stringify(response, null, 2));

        // ✅ Decouple password flag from isNewUser timing window
        if (response.user?.has_password === false) {
          localStorage.setItem('needs_password_set', 'true');
        } else {
          localStorage.removeItem('needs_password_set');
        }

        // 🔥 CHECK FOR PENDING INVITE TOKEN
        const pendingInviteToken = localStorage.getItem('pending_invite_token');

        if (pendingInviteToken) {
          // Clear it immediately to avoid loops
          localStorage.removeItem('pending_invite_token');
          // Redirect to accept invite with the token
          navigate(`${ROUTES.ACCEPT_INVITE}?token=${pendingInviteToken}`, { replace: true });
          return;
        }

        // If no pending invite, proceed with normal onboarding flow
        if (response.isNewUser) {
          navigate(ROUTES.ONBOARDING_BASIC, { replace: true });
        } else {
          if (response.onboarding?.completed) {
            navigate(ROUTES.HOME, { replace: true });
          } else if (response.onboarding?.step === 0) {
            navigate(ROUTES.ONBOARDING_BASIC, { replace: true });
          } else if (response.onboarding?.step === 1) {
            navigate('/onboarding/q/2', { replace: true });
          } else if (response.onboarding?.step === 2) {
            navigate('/onboarding/q/3', { replace: true });
          } else {
            navigate(ROUTES.HOME, { replace: true });
          }
        }
      } catch (err) {
        console.error('[OAuth] Error:', err);
        setError('Authentication failed. Please try again.');
      }
    };
    handle();
  }, [navigate, refreshUser]);

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-8 text-center">
        <div className="text-4xl mb-3">⚠️</div>
        <h2 className="font-semibold text-text-primary mb-2">Authentication failed</h2>
        <p className="text-sm text-text-muted mb-6">{error}</p>
        <a href={ROUTES.LOGIN} className="text-brand text-sm font-medium hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
      <Spinner size="lg" />
      <p className="text-sm text-text-muted">Setting up your account…</p>
    </div>
  );
}