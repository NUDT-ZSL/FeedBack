import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'verification', 'golden', 'eclipse-cases.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return process.cwd();
}

export function verificationPath(...seg: string[]): string {
  return join(repoRoot(), 'verification', ...seg);
}
