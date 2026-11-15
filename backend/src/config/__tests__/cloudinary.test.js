// Regression test for full audit 1.58. Runs in child processes because the
// Cloudinary SDK keeps global config state that vitest's module reset cannot clear.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = `
  const { default: c } = await import('./src/config/cloudinary.js');
  const cfg = c.config();
  console.log(JSON.stringify({ cloud_name: cfg.cloud_name, api_key: cfg.api_key, has_secret: !!cfg.api_secret, secure: cfg.secure }));
`;
const configFor = (env) => {
  const clean = { PATH: process.env.PATH, ...env };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: backendDir, env: clean, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
};

describe('config/cloudinary.js', () => {
  it('works with only CLOUDINARY_URL set (the documented single-var form)', () => {
    expect(configFor({ CLOUDINARY_URL: 'cloudinary://KEY123:SECRET456@mycloud' }))
      .toEqual({ cloud_name: 'mycloud', api_key: 'KEY123', has_secret: true, secure: true });
  });

  it('works with the three discrete vars', () => {
    expect(configFor({ CLOUDINARY_CLOUD_NAME: 'c2', CLOUDINARY_API_KEY: 'k2', CLOUDINARY_API_SECRET: 's2' }))
      .toEqual({ cloud_name: 'c2', api_key: 'k2', has_secret: true, secure: true });
  });
}, 20000);
