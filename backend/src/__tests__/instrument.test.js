// Full audit 1.72: Sentry must initialize BEFORE the app's modules load.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (env, code) => execFileSync(process.execPath, ['--import', './src/instrument.js', '-e', code], { cwd: backendDir, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

describe('src/instrument.js', () => {
  it('runs before the main program (no DSN: logs "disabled", then main runs)', () => {
    const out = run({}, "console.log('MAIN')");
    expect(out.indexOf('SENTRY_DSN not set')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('SENTRY_DSN not set')).toBeLessThan(out.indexOf('MAIN'));
  });

  it('with a DSN, the Sentry client exists before any app import happens', () => {
    const out = run({ SENTRY_DSN: 'https://abc@o0.ingest.sentry.io/0' }, "import('@sentry/node').then(S => { console.log('CLIENT=' + !!S.getClient()); process.exit(0); })");
    expect(out).toContain('CLIENT=true');
  });

  it('is wired into the start and dev scripts', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8')).scripts;
    expect(scripts.start).toContain('--import ./src/instrument.js');
    expect(scripts.dev).toContain('--import ./src/instrument.js');
  });
});
