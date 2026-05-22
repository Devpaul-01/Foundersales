// ============================================================
// FILE: src/pages/auth/LoginPage.tsx
// ============================================================
import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginSchema } from '@/lib/schemas';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input }  from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { ROUTES } from '@/lib/constants';
import { authApi } from '@/api/auth';
import { onboardingApi } from '@/api/onboarding';

export default function LoginPage() {
  const { login }       = useAuth();
  const navigate        = useNavigate();
  const location        = useLocation();
  const from            = (location.state as { from?: string })?.from ?? ROUTES.HOME;
  const [serverError, setServerError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register, handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginSchema>({ resolver: zodResolver(loginSchema) });

  // src/pages/auth/LoginPage.tsx
const onSubmit = async (data: LoginSchema) => {
  setServerError('');
  try {
    // ✅ Login now returns onboarding status directly
    const result = await login(data.email, data.password);
    const status = result.onboarding;
    
    console.log('[Login] Onboarding status:', status);
    
    // Redirect based on onboarding step
    if (status.completed) {
      navigate(from, { replace: true });
    } else if (status.step === 0) {
      navigate('/onboarding/basic', { replace: true });
    } else if (status.step === 1) {
      navigate('/onboarding/q/2', { replace: true });
    } else if (status.step === 2) {
      navigate('/onboarding/q/3', { replace: true });
    } else {
      navigate('/onboarding/q/3', { replace: true });
    }
  } catch (err) {
    setServerError(err instanceof AppError ? err.message : 'Login failed. Please try again.');
  }
};

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const { data } = await authApi.getGoogleOAuthUrl();
      window.location.href = data.url;
    } catch {
      setServerError('Could not start Google sign-in. Please try again.');
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold text-text-primary mb-1">Welcome back</h2>
      <p className="text-sm text-text-muted mb-6">Sign in to your Foundersales account</p>

      {serverError && (
        <InlineAlert type="error" message={serverError} className="mb-4" onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" fullWidth isLoading={isSubmitting} size="md">
          Sign in
        </Button>

<div className="text-right">
  <Link to="/forgot-password" className="text-xs text-brand hover:underline">
    Forgot password?
  </Link>
</div>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-surface-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-xs text-text-muted">or continue with</span>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        fullWidth
        isLoading={googleLoading}
        onClick={handleGoogle}
        leftIcon={
          <svg viewBox="0 0 24 24" className="w-4 h-4">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        }
      >
        Continue with Google
      </Button>

      <p className="text-center text-sm text-text-muted mt-6">
        Don't have an account?{' '}
        <Link to={ROUTES.REGISTER} className="text-brand font-medium hover:underline">
          Sign up
        </Link>
      </p>
    </>
  );
}
