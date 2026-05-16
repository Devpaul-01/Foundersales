import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { onboardingBasicSchema, type OnboardingBasicSchema } from '@/lib/schemas';
import { onboardingApi } from '@/api/onboarding';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
import { AppError } from '@/api/types';
import { USER_ROLES, INDUSTRIES } from '@/lib/constants';
import { cn } from '@/lib/utils';

const PLATFORMS = [
  'reddit','linkedin','twitter','facebook','instagram',
  'producthunt','indiehackers','hackernews','quora','youtube',
];

const PLATFORM_LABELS: Record<string,string> = {
  reddit:'Reddit', linkedin:'LinkedIn', twitter:'X / Twitter',
  facebook:'Facebook', instagram:'Instagram', producthunt:'Product Hunt',
  indiehackers:'Indie Hackers', hackernews:'Hacker News', quora:'Quora', youtube:'YouTube',
};

// Country list for dropdown (common countries)
const COUNTRIES = [
  { value: 'United States', label: 'United States' },
  { value: 'Nigeria', label: 'Nigeria' },
  { value: 'United Kingdom', label: 'United Kingdom' },
  { value: 'Canada', label: 'Canada' },
  { value: 'Australia', label: 'Australia' },
  { value: 'Germany', label: 'Germany' },
  { value: 'France', label: 'France' },
  { value: 'India', label: 'India' },
  { value: 'Kenya', label: 'Kenya' },
  { value: 'South Africa', label: 'South Africa' },
  { value: 'Ghana', label: 'Ghana' },
  { value: 'Other', label: 'Other (please specify)' },
];

export default function OnboardingBasicPage() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [serverError, setServerError] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [otherCountry, setOtherCountry] = useState<string>('');

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm<OnboardingBasicSchema>({ resolver: zodResolver(onboardingBasicSchema) });

  const productDesc = watch('product_description', '');
  const countryValue = watch('country', '');

  const togglePlatform = (p: string) =>
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedCountry(value);
    if (value !== 'Other') {
      setValue('country', value);
      setOtherCountry('');
    } else {
      setValue('country', '');
    }
  };

  const handleOtherCountryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setOtherCountry(value);
    setValue('country', value);
  };

  const onSubmit = async (data: OnboardingBasicSchema) => {
    setServerError('');
    
    // Log the data being sent to backend
    console.log('[OnboardingBasic] Submitting data:', JSON.stringify({
      ...data,
      preferred_platforms: selectedPlatforms,
    }, null, 2));
    
    try {
      await onboardingApi.submitBasic({ ...data, preferred_platforms: selectedPlatforms });
      console.log('[OnboardingBasic] Submit successful');
      await refreshUser();
      navigate('/onboarding/q/1');
    } catch (err) {
      console.error('[OnboardingBasic] Submit error:', err);
      setServerError(err instanceof AppError ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Tell us about yourself</h1>
        <p className="text-sm text-text-muted mt-1">
          This helps Clutch AI personalise your outreach coaching.
        </p>
      </div>

      {serverError && (
        <InlineAlert type="error" message={serverError} onDismiss={() => setServerError('')} />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Personal */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Personal info</h2>
          <Input label="Your name" placeholder="Jane Doe" required error={errors.name?.message} {...register('name')} />
          <Input label="Business name" placeholder="Acme Inc." {...register('business_name')} />
          <Input label="Website" type="url" placeholder="https://yoursite.com" error={errors.website?.message} {...register('website')} />
          
          {/* Location Section - NEW */}
          <div className="pt-2 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Location</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Select
                  label="Country"
                  options={COUNTRIES}
                  placeholder="Select country"
                  value={selectedCountry}
                  onChange={handleCountryChange}
                  error={errors.country?.message}
                />
                {selectedCountry === 'Other' && (
                  <Input
                    label="Country (specify)"
                    placeholder="Enter your country"
                    value={otherCountry}
                    onChange={handleOtherCountryChange}
                    className="mt-2"
                  />
                )}
              </div>
              <Input 
                label="State / Region" 
                placeholder="e.g., California, Lagos, London" 
                error={errors.state?.message}
                {...register('state')} 
              />
            </div>
          </div>
        </div>

        {/* Product */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Your product / service</h2>
          {productDesc.length === 0 && (
            <InlineAlert
              type="warning"
              message="💡 The more detail you add here, the smarter your Clutch AI coach becomes."
            />
          )}
          <Textarea
            label="Product description"
            placeholder="Describe what you sell, who it's for, and what problem it solves..."
            rows={4}
            maxLength={2000}
            showCount
            error={errors.product_description?.message}
            {...register('product_description')}
          />
          <Textarea
            label="Target audience"
            placeholder="Who are your ideal customers? E.g. B2B SaaS founders with 10–50 employees..."
            rows={3}
            maxLength={1000}
            showCount
            {...register('target_audience')}
          />
          <Textarea label="Primary goal" placeholder="What's your #1 sales goal right now?" {...register('primary_goal')} />
        </div>

        {/* Role & Industry */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Role & background</h2>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Your role"
              options={USER_ROLES as unknown as Array<{value:string;label:string}>}
              placeholder="Select role"
              {...register('role')}
            />
            <Select
              label="Industry"
              options={INDUSTRIES as unknown as Array<{value:string;label:string}>}
              placeholder="Select industry"
              {...register('industry')}
            />
          </div>
          <Select
            label="Experience level"
            options={[
              { value:'beginner',     label:'Beginner — just starting out' },
              { value:'intermediate', label:'Intermediate — some experience' },
              { value:'advanced',     label:'Advanced — seasoned seller' },
            ]}
            placeholder="Select level"
            {...register('experience_level')}
          />
          <Input label="Business stage" placeholder="Pre-revenue, early-stage, growth..." {...register('business_stage')} />
        </div>

        {/* Platforms */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">Where do you find customers?</h2>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                  selectedPlatforms.includes(p)
                    ? 'bg-brand-50 text-brand border-brand-300'
                    : 'bg-white text-text-secondary border-surface-border hover:border-slate-300',
                )}
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Bio */}
        <div className="bg-white rounded-lg border border-surface-border p-5">
          <Textarea
            label="Short bio (optional)"
            placeholder="A sentence or two about you and your background..."
            rows={2}
            maxLength={2000}
            {...register('bio')}
          />
        </div>

        <Button type="submit" fullWidth size="md" isLoading={isSubmitting}>
          Continue →
        </Button>
      </form>
    </div>
  );
}