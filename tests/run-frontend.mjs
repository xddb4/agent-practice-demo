import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The same tests work from the repository root and through npm in code/frontend.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('./unit/', import.meta.url))
  .filter((name) => /^frontend_.*\.test\.cjs$/.test(name))
  .map((name) => `tests/unit/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
