// Regression guard for full audit 1.54: Supabase query builders (postgrest-js)
// are thenables WITHOUT a .catch() method. `await supabase.from(..).insert(..).catch(..)`
// throws "TypeError: ...catch is not a function" AND never executes the query.
// This scans backend source so the pattern cannot silently come back.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory()
    ? (e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(path.join(dir, e.name)))
    : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);

describe('Supabase query builders', () => {
  it('premise: a real builder has no .catch (if this fails, the guard below is obsolete)', () => {
    const q = createClient('http://127.0.0.1:9', 'k').from('t').insert({});
    expect(typeof q.then).toBe('function');
    expect(typeof q.catch).toBe('undefined');
  });

  it('no source file chains .catch() onto a .from()/.rpc() builder', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('.catch(')) return;
        let j = i; const stmt = [line];
        while (j > 0 && i - j < 12) {
          const prev = lines[j - 1].trimEnd();
          if (prev === '' || /[;{}]$/.test(prev)) break;
          j -= 1; stmt.unshift(lines[j]);
        }
        const s = stmt.join('\n');
        if ((/\.from\(\s*['"`]/.test(s) || /\.rpc\(/.test(s)) && !/storage\.from|\.auth\./.test(s)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
