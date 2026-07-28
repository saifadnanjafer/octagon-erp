import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceMigrations = path.join(repoRoot, 'database', 'migrations');

export function stageMigrationTree(parentDir, name, maxNumber) {
  const root = path.join(parentDir, name);
  const stagedMigrations = path.join(root, 'database', 'migrations');
  fs.mkdirSync(stagedMigrations, { recursive: true });
  for (const file of fs.readdirSync(sourceMigrations)) {
    const match = file.match(/^(\d+)_.+\.mjs$/);
    if (!match || Number(match[1]) > maxNumber) continue;
    fs.copyFileSync(path.join(sourceMigrations, file), path.join(stagedMigrations, file));
  }
  for (const relative of [
    path.join('platform', 'server', 'governance-collections.mjs'),
    path.join('platform', 'identity', 'users', 'index.mjs'),
    path.join('platform', 'identity', 'passwords', 'index.mjs'),
    path.join('platform', 'kernel', 'entities', 'default-entities.json'),
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relative), target);
  }
  return stagedMigrations;
}
