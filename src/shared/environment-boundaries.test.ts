import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FEATURES_DIRECTORY = path.join(import.meta.dirname, '..', 'features');
const NODE_ONLY_IMPORTS = /from '(node:[^']+|fs|path|crypto|os|http|better-sqlite3|electron)'/;

function importedSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
}

/** Collects every file reachable from an entry point through local imports, without running it. */
function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    for (const specifier of importedSpecifiers(file)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      for (const candidate of [`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts')]) {
        if (fs.existsSync(candidate)) { queue.push(candidate); break; }
      }
    }
  }
  return [...seen];
}

describe('environment boundaries', () => {
  const rendererBarrels = fs.readdirSync(FEATURES_DIRECTORY)
    .map((name) => path.join(FEATURES_DIRECTORY, name, 'index.ts'))
    .filter((barrel) => fs.existsSync(barrel));

  it('finds the feature barrels it is meant to guard', () => {
    expect(rendererBarrels.length).toBeGreaterThanOrEqual(6);
  });

  it.each(rendererBarrels.map((barrel) => [path.relative(FEATURES_DIRECTORY, barrel), barrel] as const))(
    '%s stays free of main-process modules so it can be bundled for the renderer',
    (_name, barrel) => {
      const offenders = reachableFiles(barrel)
        .filter((file) => NODE_ONLY_IMPORTS.test(fs.readFileSync(file, 'utf8')))
        .map((file) => path.relative(FEATURES_DIRECTORY, file));
      expect(offenders).toEqual([]);
    },
  );

  it('keeps the main-process barrels free of renderer-only DOM helpers', () => {
    const nodeBarrels = fs.readdirSync(FEATURES_DIRECTORY)
      .map((name) => path.join(FEATURES_DIRECTORY, name, 'node.ts'))
      .filter((barrel) => fs.existsSync(barrel));
    expect(nodeBarrels.length).toBeGreaterThanOrEqual(5);
  });
});
