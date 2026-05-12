// scripts/seed-test-user.js
// ============================================================
// Creates a fully-onboarded test user with a rich food business
// profile so Perplexity has enough signal to return quality leads.
//
// Usage:
//   node scripts/seed-test-user.js
//
// Prerequisites:
//   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env
//   - Run from the project root so dotenv picks up .env
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqemZmc2xqdm1tc3Nsb2RveHZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU2OTkzMiwiZXhwIjoyMDg3MTQ1OTMyfQ.BgLnsswYmT6f8nQso6lnzlrPmS_TRYyxaqYH4lSmm0A';
const SUPABASE_URL = 'https://ujzffsljvmmsslodoxvr.supabase.co';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Test user config ──────────────────────────────────────────────────────────
const TEST_EMAIL    = 'testchef.usa@foundersales.dev';
const TEST_PASSWORD = 'TestPassword123!';
const TEST_USER = {
  // Basic info
  name:                'Marcus Webb',
  business_name:       'Prep & Plate',
  product_description: 'A weekly meal prep and delivery service for busy professionals in Austin, TX. We cook 10–14 chef-quality meals per week using locally sourced ingredients, portioned and refrigerated for grab-and-go convenience. Customers skip grocery shopping and cooking entirely while eating restaurant-quality food at home.',
  target_audience:     'Busy working professionals aged 28–45 in Austin, TX who work long hours, care about eating healthy, and hate the hassle of meal planning and grocery runs. Typically earn $80k+ and already spend money on convenience (DoorDash, gym memberships). They want the health of home-cooked food without any of the time cost.',
  bio:                 'Former line cook turned entrepreneur. Spent 8 years in professional kitchens before launching Prep & Plate in 2022. We now serve 140 active weekly subscribers in the Austin area and have a 94% retention rate.',
  role:                'founder',
  industry:            'food',
  experience_level:    'intermediate',
  business_stage:      'growing',
  primary_goal:        'Get 50 new subscribers this month through outreach on Reddit and Instagram',
  preferred_platforms: ['reddit', 'instagram', 'facebook'],
  country:             'United States',
  state:               'Texas',
  website:             'https://prepandplate.com',
  websites:            ['https://prepandplate.com'],
  tier:                'free',
  archetype:           'seller',

  // Onboarding answers (simulates completed burst 1–3)
  onboarding_answers: {
    'What do people usually like most about what you offer?':
      'They love not having to think about food during the week. Multiple customers have told us it saves them 6–8 hours a week between shopping, cooking, and cleaning. The most common compliment is that our food actually tastes like something they would order at a restaurant — not like typical meal prep.',
    'Have any customers said something positive about your product or service?':
      'One customer, a software engineer who works 60+ hour weeks, told us he lost 18 pounds in 3 months just because he stopped eating fast food out of desperation. Another customer, a nurse, said she was able to start cooking healthy lunches for her kids because we handle dinner. We get a lot of those stories.',
    'When do people usually decide to buy or reach out to you?':
      'Almost always after a particularly exhausting week — Sunday night when they realize they have nothing to eat for the week ahead, or right after a stressful period at work. We also get a spike every January when people make health resolutions.',
    'Why do people usually come to you or need what you offer?':
      'Time is the #1 reason. People are burned out from work and they do not want to spend their limited free time meal prepping. A close second is health — they are eating out too much and feel guilty about it but do not have the energy to cook.',
    'What sometimes stops people from buying at first?':
      'Price is the biggest hesitation. We are $185 per week which feels expensive until they realize they are spending $60–80 per week on DoorDash anyway. The other hesitation is not knowing if they will actually like the food — which is why we offer a trial week.',
    'What usually makes them finally decide to buy?':
      'Trying the sample box. Once someone eats the food, the conversion rate is over 85%. A lot of people also decide after a particularly bad week — they get to Sunday night with no food in the house and just sign up.',
    'How do you usually talk to customers when they message you?':
      'Very casual and direct. I talk to people like a friend who happens to be a chef. No corporate language. I usually ask a couple of questions about their schedule before pitching anything.',
    'What kind of posts or messages get the most response from people?':
      'Before and after photos of what a week of meals looks like. Real customer stories especially about weight loss or time saved. Honest posts about the cost compared to DoorDash. People respond really well to specifics and numbers.',
    'How do you normally convince someone to try your product or service?':
      'I offer them the trial week at a discount — $120 instead of $185 — and tell them they can cancel anytime. I focus on the time math: if your time is worth anything, we are cheaper than cooking yourself when you factor in grocery runs and prep time.',
  },

  // Voice profile — built from the above answers
  voice_profile: {
    unique_value_prop:           'Chef-quality weekly meals delivered so busy Austin professionals never cook or grocery shop again',
    icp_trigger:                 'When they hit Sunday night with nothing in the fridge after an exhausting week and realize they need a real solution',
    target_customer_description: 'Austin professionals aged 28–45 working 50+ hour weeks who already spend heavily on convenience but feel guilty about their diet. They have disposable income and will pay for something that genuinely removes friction from their lives.',
    main_objection:              'The $185/week price feels expensive before they do the math on what they already spend on DoorDash and takeout',
    objection_reframe:           'Most customers are already spending $250–350/month on food delivery — Prep & Plate is actually cheaper and they eat healthier. The trial week removes all the risk.',
    best_proof_point:            '94% monthly retention rate with 140 active subscribers — and a customer who lost 18 pounds in 3 months by replacing fast food with our meals',
    voice_style:                 'direct, friendly, chef-to-neighbor',
    outreach_persona:            'Local Austin chef who genuinely wants to solve your dinner problem — not a corporate subscription box',
    avoid_phrases:               ['meal kit', 'disrupting', 'synergy', 'just checking in', 'hope this finds you well'],
  },
};

async function seedTestUser() {
  console.log('\n🌱 Seed Test User — Prep & Plate (Austin, TX)\n');
  console.log(`📧 Email: ${TEST_EMAIL}`);
  console.log(`🔑 Password: ${TEST_PASSWORD}\n`);

  // ── Step 1: Check if already exists ────────────────────────────────────────
  console.log('Step 1: Checking if user already exists...');
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(u => u.email === TEST_EMAIL);

  let userId;

  if (existing) {
    console.log(`  ⚠️  Auth user already exists: ${existing.id}`);
    console.log('  Deleting and recreating for a clean slate...\n');

    // Clean up old profile first
    await supabase.from('users').delete().eq('id', existing.id);
    await supabase.auth.admin.deleteUser(existing.id);
  }

  // ── Step 2: Create auth user (email pre-confirmed, no verification needed) ─
  console.log('Step 2: Creating Supabase auth user (pre-confirmed)...');
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email:            TEST_EMAIL,
    password:         TEST_PASSWORD,
    email_confirm:    true, // skip email verification — key for testing
    user_metadata:    { name: TEST_USER.name },
  });

  if (authError) {
    console.error('❌ Auth user creation failed:', authError.message);
    process.exit(1);
  }

  userId = authData.user.id;
  console.log(`  ✅ Auth user created: ${userId}\n`);

  // ── Step 3: Try RPC first (matches prod flow), fall back to direct insert ──
  console.log('Step 3: Creating user profile via RPC...');
  const { error: rpcError } = await supabase.rpc('create_user_profile', {
    p_id:    userId,
    p_email: TEST_EMAIL,
    p_name:  TEST_USER.name,
    p_tier:  'free',
  });

  if (rpcError) {
    console.warn(`  ⚠️  RPC failed (${rpcError.message}) — falling back to direct INSERT`);

    const { error: insertError } = await supabase.from('users').insert({
      id:    userId,
      email: TEST_EMAIL,
      name:  TEST_USER.name,
      tier:  'free',
    });

    if (insertError) {
      console.error('❌ Direct insert also failed:', insertError.message);
      await supabase.auth.admin.deleteUser(userId);
      process.exit(1);
    }
    console.log('  ✅ Profile created via direct INSERT\n');
  } else {
    console.log('  ✅ Profile created via RPC\n');
  }

  // ── Step 4: Update with full business profile ──────────────────────────────
  console.log('Step 4: Writing full business profile...');
  const { error: updateError } = await supabase.from('users').update({
    name:                 TEST_USER.name,
    business_name:        TEST_USER.business_name,
    product_description:  TEST_USER.product_description,
    target_audience:      TEST_USER.target_audience,
    bio:                  TEST_USER.bio,
    role:                 TEST_USER.role,
    industry:             TEST_USER.industry,
    experience_level:     TEST_USER.experience_level,
    business_stage:       TEST_USER.business_stage,
    primary_goal:         TEST_USER.primary_goal,
    preferred_platforms:  TEST_USER.preferred_platforms,
    country:              TEST_USER.country,
    state:                TEST_USER.state,
    website:              TEST_USER.website,
    websites:             TEST_USER.websites,
    tier:                 TEST_USER.tier,
    archetype:            TEST_USER.archetype,
    onboarding_answers:   TEST_USER.onboarding_answers,
    voice_profile:        TEST_USER.voice_profile,
    onboarding_completed: true,
    onboarding_step:      3,
  }).eq('id', userId);

  if (updateError) {
    console.error('❌ Profile update failed:', updateError.message);
    console.log('  Hint: If columns like `websites` or `archetype` do not exist yet, run the relevant migrations first.');
    await supabase.auth.admin.deleteUser(userId);
    process.exit(1);
  }

  console.log('  ✅ Full profile written\n');

  // ── Step 5: Verify ──────────────────────────────────────────────────────────
  console.log('Step 5: Verifying saved profile...');
  const { data: saved } = await supabase
    .from('users')
    .select('id, name, business_name, product_description, country, state, preferred_platforms, voice_profile, onboarding_completed, archetype')
    .eq('id', userId)
    .single();

  if (!saved) {
    console.error('❌ Could not read back saved profile — something went wrong');
    process.exit(1);
  }

  console.log('  ✅ Profile verified:\n');
  console.log(`     Name:         ${saved.name}`);
  console.log(`     Business:     ${saved.business_name}`);
  console.log(`     Country:      ${saved.country}, ${TEST_USER.state}`);
  console.log(`     Archetype:    ${saved.archetype}`);
  console.log(`     Platforms:    ${(saved.preferred_platforms || []).join(', ')}`);
  console.log(`     Onboarded:    ${saved.onboarding_completed}`);
  console.log(`     ICP Trigger:  ${saved.voice_profile?.icp_trigger}`);
  console.log(`     Differentiator: ${saved.voice_profile?.unique_value_prop}`);

  console.log('\n' + '─'.repeat(60));
  console.log('✅ TEST USER READY\n');
  console.log(`   Email:    ${TEST_EMAIL}`);
  console.log(`   Password: ${TEST_PASSWORD}`);
  console.log(`   User ID:  ${userId}`);
  console.log('\n   Log in via your app and hit the opportunities refresh.');
  console.log('   Watch your server logs for:');
  console.log('   [Perplexity] Raw API response: N citations, model=sonar-pro');
  console.log('─'.repeat(60) + '\n');
}

seedTestUser().catch(err => {
  console.error('\n❌ Seed script crashed:', err.message);
  process.exit(1);
});
