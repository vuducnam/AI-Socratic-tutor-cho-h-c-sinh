import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Client Component (file có 'use client') không bao giờ import src/server (CLAUDE.md › Quy ước Next.js).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'generated' ? [] : walk(full);
    return /\.(tsx?|jsx?)$/.test(name) ? [full] : [];
  });
}

describe('Client Component không import src/server', () => {
  it('không có file "use client" nào import @/server hoặc đường dẫn server/', () => {
    const offenders = walk('src').filter((file) => {
      const src = readFileSync(file, 'utf8');
      if (!/^\s*['"]use client['"]/.test(src)) return false;
      return /from\s+['"](@\/server|[./]+(?:\.\.\/)*server\/)/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
