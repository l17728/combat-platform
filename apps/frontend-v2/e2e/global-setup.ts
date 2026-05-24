import { rmSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup() {
  const base = join(process.cwd(), '..', 'backend');
  for (const f of ['combat.sqlite', 'combat.sqlite-wal', 'combat.sqlite-shm']) {
    try {
      rmSync(join(base, f), { force: true });
    } catch {}
  }
}
