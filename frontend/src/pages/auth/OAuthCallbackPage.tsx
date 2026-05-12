// ============================================================
// FILE: src/pages/auth/OAuthCallbackPage.tsx
// ============================================================
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
        // Supabase sets the session in the URL hash; use the Supabase client to extract it
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY,
        );
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData?.session;

        if (!session?.access_token) throw new Error('No session');

        // Store tokens from Supabase OAuth session
        setTokens(
          session.access_token,
          session.refresh_token ?? '',
          session.expires_in ?? 3600,
        );
        scheduleRefresh(session.expires_in ?? 3600);

        // Ensure profile exists (creates workspace if new user)
        const { data } = await authApi.ensureProfile({
          name:     session.user?.user_metadata?.full_name,
          provider: 'google',
        });

        await refreshUser();

        if (data.isNewUser) {
          navigate(ROUTES.ONBOARDING_BASIC, { replace: true });
        } else {
          navigate(ROUTES.HOME, { replace: true });
        }
      } catch (err) {
        setError('Authentication failed. Please try again.');
      }
    };
    handle();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
