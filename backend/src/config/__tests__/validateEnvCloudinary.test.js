import { describe, it, expect, vi, beforeEach } from 'vitest';

const REQUIRED_ENV = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' };
let warns;
const runWith = async (env) => {
  for (const k of Object.keys(process.env)) if (k.startsWith('CLOUDINARY')) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  warns = [];
  vi.spyOn(console, 'warn').mockImplementation((m) => warns.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => {});
  (await import('../validateEnv.js')).validateEnv();
  return warns.join('\n');
};
beforeEach(() => vi.restoreAllMocks());

describe('validateEnv — Cloudinary warning', () => {
  it('warns when no Cloudinary config is present', async () => {
    expect(await runWith({})).toMatch(/CLOUDINARY_URL/);
  });
  it('is quiet with CLOUDINARY_URL', async () => {
    expect(await runWith({ CLOUDINARY_URL: 'cloudinary://k:s@c' })).not.toMatch(/CLOUDINARY/);
  });
  it('is quiet with all three discrete vars', async () => {
    expect(await runWith({ CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' })).not.toMatch(/CLOUDINARY/);
  });
  it('warns when only some discrete vars are set', async () => {
    expect(await runWith({ CLOUDINARY_CLOUD_NAME: 'c' })).toMatch(/CLOUDINARY_URL/);
  });
});
