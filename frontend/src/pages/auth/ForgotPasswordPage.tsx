// src/pages/auth/ForgotPasswordPage.tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email'),
});
type ForgotPasswordSchema = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [serverError, setServerError] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordSchema>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordSchema) => {
    setServerError('');
    try {
      await authApi.forgotPassword(data.email);
      setSubmittedEmail(data.email);
      setIsSubmitted(true);
    } catch (err) {
      setServerError(err instanceof AppError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  if (isSubmitted) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-600" size={22} />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-2">Check your email</h2>
        <p className="text-sm text-text-muted mb-1">
          We sent a password reset link to
        </p>
        <p className="text-sm font-medium text-text-primary mb-6">{submittedEmail}</p>
        <p className="text-xs text-text-muted mb-4">
          Click the link in your email to reset your password. The link expires in 1 hour.
        </p>
        <div className="mt-6">
          <Link to="/login" className="text-sm text-brand hover:underline font-medium flex items-center justify-center gap-1">
            <ArrowLeft size={14} />
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <Link to="/login" className="text-sm text-brand hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>

      <h2 className="text-xl font-bold text-text-primary mb-1">Forgot password?</h2>
      <p className="text-sm text-text-muted mb-6">
        Enter your email address and we'll send you a link to reset your password.
      </p>

      {serverError && (
        <InlineAlert type="error" message={serverError} className="mb-4" onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...register('email')}
          leftIcon={<Mail size={16} className="text-text-muted" />}
        />

        <Button type="submit" fullWidth isLoading={isSubmitting} size="md">
          Send reset link
        </Button>
      </form>

      <p className="text-center text-sm text-text-muted mt-6">
        Remember your password?{' '}
        <Link to="/login" className="text-brand font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}