import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal `.env` loader (§65).
 *
 * The repository keeps one `.env` at its root and every workspace package runs
 * from its own directory, so `process.env` was empty for anything started with
 * `pnpm --filter`. This walks up from the current directory to find the file.
 *
 * Values already present in the real environment always win: a container that
 * injects DATABASE_URL must not be overridden by a checked-out file.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const match = LINE.exec(line);
    if (!match) continue;

    const [, key] = match;
    let value = match[2];

    // Quoted values keep their spaces and any trailing `#`; unquoted values
    // stop at the first unescaped comment marker.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }

    out[key] = value;
  }
  return out;
}

/** Search upwards for `.env`, load it, and return the file that was used. */
export function loadEnv(startDir = process.cwd(), fileName = '.env'): string | null {
  let dir = resolve(startDir);

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, fileName);
    if (existsSync(candidate)) {
      const parsed = parseEnv(readFileSync(candidate, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return candidate;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
