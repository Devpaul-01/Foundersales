// ============================================================
// FILE: src/pages/auth/RegisterPage.tsx
// ============================================================
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterSchema } from '@/lib/schemas';
import { authApi } from '@/api/auth';
import { Button } from '@/components/ui/Button';
import { Input }  from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { ROUTES } from '@/lib/constants';
import { CheckCircle2, Mail } from 'lucide-react';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [serverError, setServerError]   = useState('');
  const [verifyEmail,  setVerifyEmail]  = useState('');

  const {
    register, handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<RegisterSchema>({ resolver: zodResolver(registerSchema) });

  const password = watch('password', '');
  const strength =
    password.length === 0 ? 0 :
    password.length < 8   ? 1 :
    /[A-Z]/.test(password) && /[0-9]/.test(password) ? 3 : 2;

  const onSubmit = async (data: RegisterSchema) => {
    setServerError('');
    try {
      const res = await authApi.register(data);
      if (res.data.needsVerification) {
        setVerifyEmail(res.data.email);
      } else {
        navigate(ROUTES.LOGIN);
      }
    } catch (err) {
      showToast(`Register raw error: ${err}`); // ← add this
  setServerError(err instanceof AppError ? err.message : 'Registration failed.');
}
    
  };

  // ── Verification sent state ──────────────────────────────
  if (verifyEmail) {
    return (
      <div className="text-center py-4">
        <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-4">
          <Mail className="text-brand" size={22} />
        </div>
        <h2 className="text-lg font-bold text-text-primary mb-2">Check your email</h2>
        <p className="text-sm text-text-muted mb-1">
          We sent a verification link to
        </p>
        <p className="text-sm font-medium text-text-primary mb-6">{verifyEmail}</p>
        <p className="text-xs text-text-muted mb-4">
          Click the link in your email to activate your account, then sign in.
        </p>
        <Button variant="secondary" size="sm" onClick={() => authApi.resendVerification(verifyEmail)}>
          Resend email
        </Button>
        <div className="mt-6">
          <Link to={ROUTES.LOGIN} className="text-sm text-brand hover:underline font-medium">
            Back to sign in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-xl font-bold text-text-primary mb-1">Create your account</h2>
      <p className="text-sm text-text-muted mb-6">Start your free Foundersales account</p>

      {serverError && (
        <InlineAlert type="error" message={serverError} className="mb-4" onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="Name"
          type="text"
          autoComplete="name"
          placeholder="Jane Doe"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          required
          {...register('email')}
        />
        <div>
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 characters"
            error={errors.password?.message}
            required
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
        <Button type="submit" fullWidth isLoading={isSubmitting} size="md">
          Create account
        </Button>
      </form>

      <p className="text-center text-xs text-text-muted mt-4">
        By creating an account you agree to our Terms of Service.
      </p>

      <p className="text-center text-sm text-text-muted mt-4">
        Already have an account?{' '}
        <Link to={ROUTES.LOGIN} className="text-brand font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
