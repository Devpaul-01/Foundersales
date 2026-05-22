// test-exa.js
// ─────────────────────────────────────────────────────────────
// Standalone Exa API tester — no Supabase, no Groq, no app deps.
// Simulates exactly what perplexity.js does for a real user.
// ─────────────────────────────────────────────────────────────
// Usage:
//   EXA_API_KEY=your_key node test-exa.js
//   OR add EXA_API_KEY to your .env and run: node test-exa.js

import Exa from 'exa-js';
import 'dotenv/config';

const EXA_API_KEY = "340fbacc-b678-4ccc-a6b0-56fae8875325";

if (!EXA_API_KEY?.trim()) {
  console.error('❌  EXA_API_KEY is not set. Add it to your .env or prefix the command.');
  process.exit(1);
}

const exa = new Exa(EXA_API_KEY);

// ─────────────────────────────────────────────────────────────
// 🔧 EDIT THIS to match your actual user profile
// ─────────────────────────────────────────────────────────────
const TEST_USER = {
  product_description: 'A lead discovery platform that helps startup sales reps find and identify high-intent prospects to reach out to daily',
  target_audience:     'Sales reps and SDRs at early-stage startups who struggle to fill their pipeline with qualified leads',
  icp_trigger:         'people complaining about not having enough leads, struggling to find prospects, empty pipeline, or spending too much time manually sourcing contacts',
  preferred_platforms: ['reddit', 'linkedin', 'indiehackers'],
};
// ─────────────────────────────────────────────────────────────

// Maps platform name → domains (mirrors perplexity.js exactly)
const PLATFORM_DOMAINS = {
  reddit:       ['reddit.com'],
  linkedin:     ['linkedin.com'],
  twitter:      ['twitter.com', 'x.com'],
  indiehackers: ['indiehackers.com'],
  hackernews:   ['news.ycombinator.com'],
};

// Detects platform from a URL
const detectPlatform = (url = '') => {
  if (/reddit\.com/i.test(url))                   return 'reddit';
  if (/linkedin\.com/i.test(url))                 return 'linkedin';
  if (/twitter\.com|x\.com/i.test(url))           return 'twitter';
  if (/indiehackers\.com/i.test(url))             return 'indiehackers';
  if (/news\.ycombinator\.com/i.test(url))        return 'hackernews';
  return 'other';
};

// Builds query configs — same logic as buildSearchQueries() in perplexity.js
const buildQueries = (user) => {
  const product    = user.product_description.slice(0, 100);
  const audience   = user.target_audience.slice(0, 80);
  const icpTrigger = user.icp_trigger?.slice(0, 80) || audience;
  const platforms  = (user.preferred_platforms || ['reddit']).slice(0, 2);

  return platforms.map(p => ({
    platform: p,
    query:    `${icpTrigger} ${product.slice(0, 50)}`,
    domains:  PLATFORM_DOMAINS[p] || [],
  }));
};

// Calls Exa — mirrors callExa() in perplexity.js
const callExa = async (query, domains = []) => {
  const result = await exa.searchAndContents(query, {
    type: 'neural',
    numResults: 10,
    ...(domains.length > 0 && { includeDomains: domains }),
    text: { maxCharacters: 600 },
    useAutoprompt: true,
  });
  return result.results || [];
};

// Parses results — mirrors parseSearchResults() in perplexity.js
const parseResults = (results) =>
  results
    .filter(r => r?.url && r?.text)
    .map(r => ({
      platform:       detectPlatform(r.url),
      source_url:     r.url,
      title:          r.title || '(no title)',
      target_context: r.text?.slice(0, 600) || '',
    }))
    .filter(r => r.target_context.length > 30);

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('━'.repeat(60));
  console.log('🔍  EXA API TEST');
  console.log('━'.repeat(60));
  console.log('📋  Test profile:');
  console.log(`    Product:   ${TEST_USER.product_description}`);
  console.log(`    Audience:  ${TEST_USER.target_audience}`);
  console.log(`    Trigger:   ${TEST_USER.icp_trigger}`);
  console.log(`    Platforms: ${TEST_USER.preferred_platforms.join(', ')}`);
  console.log('');

  const queryConfigs = buildQueries(TEST_USER);
  const seen         = new Set();
  const allResults   = [];

  for (const { platform, query, domains } of queryConfigs) {
    console.log(`━`.repeat(60));
    console.log(`🌐  Searching [${platform.toUpperCase()}]`);
    console.log(`    Query:   "${query}"`);
    console.log(`    Domains: ${domains.join(', ') || 'any'}`);
    console.log('');

    try {
      const start   = Date.now();
      const results = await callExa(query, domains);
      const elapsed = Date.now() - start;

      console.log(`    ⏱  ${elapsed}ms — ${results.length} raw result(s) returned`);

      const parsed = parseResults(results);

      // Deduplicate across queries
      const fresh = parsed.filter(r => !seen.has(r.source_url));
      fresh.forEach(r => seen.add(r.source_url));

      console.log(`    ✅  ${fresh.length} unique result(s) after dedup\n`);

      for (const [i, r] of fresh.entries()) {
        console.log(`    [${i + 1}] ${r.platform.toUpperCase()} — ${r.title}`);
        console.log(`        URL:     ${r.source_url}`);
        console.log(`        Snippet: ${r.target_context.slice(0, 200).replace(/\n/g, ' ')}...`);
        console.log('');
      }

      allResults.push(...fresh);
      if (allResults.length >= 10) break;

    } catch (err) {
      console.error(`    ❌  Exa call failed: ${err.message}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────
  console.log('━'.repeat(60));
  console.log('📊  SUMMARY');
  console.log('━'.repeat(60));
  console.log(`    Total unique opportunities found: ${allResults.length}`);

  const byPlatform = allResults.reduce((acc, r) => {
    acc[r.platform] = (acc[r.platform] || 0) + 1;
    return acc;
  }, {});

  for (const [platform, count] of Object.entries(byPlatform)) {
    console.log(`    ${platform.padEnd(15)} ${count} result(s)`);
  }

  if (allResults.length === 0) {
    console.log('\n⚠️   Zero results — try tweaking TEST_USER.icp_trigger or product_description');
  } else {
    console.log('\n✅  Exa is working. These results match what your users would see.');
  }

  console.log('━'.repeat(60));
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
