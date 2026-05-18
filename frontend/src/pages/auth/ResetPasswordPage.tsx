// src/pages/auth/ResetPasswordPage.tsx
import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { Lock, CheckCircle, AlertCircle } from 'lucide-react';

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isTokenValid, setIsTokenValid] = useState(true);
  const [isVerifying, setIsVerifying] = useState(true);

  const accessToken = searchParams.get('token');

  useEffect(() => {
    // Verify token is present
    if (!accessToken) {
      setIsTokenValid(false);
      setIsVerifying(false);
    } else {
      setIsVerifying(false);
    }
  }, [accessToken]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordSchema>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const password = watch('password', '');
  const strength =
    password.length === 0 ? 0
    : password.length < 8 ? 1
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 3
    : 2;

  const onSubmit = async (data: ResetPasswordSchema) => {
    if (!accessToken) {
      setServerError('Invalid or missing reset token. Please request a new link.');
      return;
    }

    setServerError('');
    try {
      await authApi.resetPassword(accessToken, data.password);
      setIsSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (err) {
      setServerError(err instanceof AppError ? err.message : 'Failed to reset password. The link may have expired.');
    }
  };

  if (isVerifying) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
        <p className="text-sm text-text-muted mt-4">Verifying reset link...</p>
      </div>
    );
  }

  if (!isTokenValid) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="text-red-600" size={22} />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-2">Invalid reset link</h2>
        <p className="text-sm text-text-muted mb-6">
          This password reset link is invalid or has expired.
        </p>
        <Link to="/forgot-password" className="text-sm text-brand hover:underline font-medium">
          Request a new reset link →
        </Link>
        <div className="mt-4">
          <Link to="/login" className="text-sm text-text-muted hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-600" size={22} />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-2">Password reset successful!</h2>
        <p className="text-sm text-text-muted mb-4">
          Your password has been updated. You can now sign in with your new password.
        </p>
        <Button onClick={() => navigate('/login')} size="md">
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold text-text-primary mb-1">Create new password</h2>
      <p className="text-sm text-text-muted mb-6">
        Enter your new password below.
      </p>

      {serverError && (
        <InlineAlert type="error" message={serverError} className="mb-4" onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            error={errors.password?.message}
            {...register('password')}
            leftIcon={<Lock size={16} className="text-text-muted" />}
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
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm your password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        <Button type="submit" fullWidth isLoading={isSubmitting} size="md">
          Reset password
        </Button>
      </form>

      <p className="text-center text-sm text-text-muted mt-6">
        <Link to="/login" className="text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}