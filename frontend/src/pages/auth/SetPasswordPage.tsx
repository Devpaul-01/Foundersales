// src/pages/auth/SetPasswordPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { ROUTES } from '@/lib/constants';
import { getTokens } from '@/lib/auth';
import { Spinner } from '@/components/common/index';

const setPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type SetPasswordSchema = z.infer<typeof setPasswordSchema>;

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordSchema>({
    resolver: zodResolver(setPasswordSchema),
  });

  const password = watch('password', '');
  const strength =
    password.length === 0 ? 0
    : password.length < 8 ? 1
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 3
    : 2;

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace('#', '?'));
    const tokenFromHash = params.get('access_token');

    if (tokenFromHash) {
      setAccessToken(tokenFromHash);
    } else {
      const { accessToken: storedToken } = getTokens();
      if (storedToken) {
        setAccessToken(storedToken);
      } else {
        setServerError('No session found. Please sign in again.');
      }
    }
    setIsLoading(false);
  }, []);

  const onSubmit = async (data: SetPasswordSchema) => {
    if (!accessToken) {
      setServerError('No session found. Please sign in again.');
      return;
    }

    setServerError('');

    try {
      await authApi.setPassword(accessToken, data.password);
      localStorage.removeItem('needs_password_set');
      navigate(ROUTES.HOME, { replace: true });
    } catch (err) {
      setServerError(err instanceof AppError ? err.message : 'Failed to set password. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary mb-2">Set Your Password</h1>
        <p className="text-sm text-text-muted">
          Set a password so you can also sign in with email in the future.
        </p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} className="mb-4" onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            error={errors.password?.message}
            {...register('password')}
          />
          {password.length > 0 && (
            <div className="mt-1.5 flex gap-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= strength
                      ? strength === 1 ? 'bg-danger'
                      : strength === 2 ? 'bg-warning'
                      : 'bg-success'
                      : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <Input
          label="Confirm Password"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm your password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" fullWidth isLoading={isSubmitting} size="md">
          Set Password
        </Button>
      </form>
    </div>
  );
}