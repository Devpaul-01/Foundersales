import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { InlineAlert } from '@/components/common/index';
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

const DEMO_PRODUCT_DESCRIPTION =
  "Northbeam Analytics is a reporting layer for data teams — it pulls metrics from your warehouse, ad platforms, and CRM into live dashboards, so nobody has to manually rebuild a slide deck every Monday.";

const DEMO_TARGET_AUDIENCE =
  "Heads of data or ops at B2B SaaS companies with 15–40 person teams, currently stitching together weekly reports by hand across 3+ tools.";

const DEMO_BIO =
  "Ex-data engineer turned founder. Spent four years watching teams burn entire afternoons on reporting and decided to fix it.";

export default function OnboardingBasicPage() {
  const [serverError] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'linkedin', 'reddit', 'producthunt',
  ]);
  const [selectedCountry, setSelectedCountry] = useState<string>('United States');
  const [otherCountry, setOtherCountry] = useState<string>('');

  const [name, setName] = useState('Priya Sharma');
  const [businessName, setBusinessName] = useState('Northbeam Analytics');
  const [website, setWebsite] = useState('https://northbeam.io');
  const [state, setState] = useState('California');
  const [productDescription, setProductDescription] = useState(DEMO_PRODUCT_DESCRIPTION);
  const [targetAudience, setTargetAudience] = useState(DEMO_TARGET_AUDIENCE);
  const [primaryGoal, setPrimaryGoal] = useState('Book 10 qualified discovery calls this month');
  const [role, setRole] = useState('founder');
  const [industry, setIndustry] = useState('saas');
  const [experienceLevel, setExperienceLevel] = useState('intermediate');
  const [businessStage, setBusinessStage] = useState('Early-stage, $8k MRR');
  const [bio, setBio] = useState(DEMO_BIO);
  const [isSubmitting] = useState(false);

  const togglePlatform = (p: string) =>
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedCountry(value);
    if (value === 'Other') {
      setOtherCountry('');
    }
  };

  const handleOtherCountryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOtherCountry(e.target.value);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Static demo — no submission/network side effects.
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
        <InlineAlert type="error" message={serverError} />
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Personal */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Personal info</h2>
          <Input
            label="Your name"
            placeholder="Jane Doe"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Business name"
            placeholder="Acme Inc."
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
          <Input
            label="Website"
            type="url"
            placeholder="https://yoursite.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />

          {/* Location Section */}
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
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Product */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Your product / service</h2>
          <Textarea
            label="Product description"
            placeholder="Describe what you sell, who it's for, and what problem it solves..."
            rows={4}
            maxLength={2000}
            showCount
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
          />
          <Textarea
            label="Target audience"
            placeholder="Who are your ideal customers? E.g. B2B SaaS founders with 10–50 employees..."
            rows={3}
            maxLength={1000}
            showCount
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
          />
          <Textarea
            label="Primary goal"
            placeholder="What's your #1 sales goal right now?"
            value={primaryGoal}
            onChange={(e) => setPrimaryGoal(e.target.value)}
          />
        </div>

        {/* Role & Industry */}
        <div className="bg-white rounded-lg border border-surface-border p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Role & background</h2>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Your role"
              options={USER_ROLES as unknown as Array<{value:string;label:string}>}
              placeholder="Select role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
            <Select
              label="Industry"
              options={INDUSTRIES as unknown as Array<{value:string;label:string}>}
              placeholder="Select industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
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
            value={experienceLevel}
            onChange={(e) => setExperienceLevel(e.target.value)}
          />
          <Input
            label="Business stage"
            placeholder="Pre-revenue, early-stage, growth..."
            value={businessStage}
            onChange={(e) => setBusinessStage(e.target.value)}
          />
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
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>

        <Button type="submit" fullWidth size="md" isLoading={isSubmitting}>
          Continue →
        </Button>
      </form>
    </div>
  );
}
