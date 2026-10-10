import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ALL_GH2_SCHEMAS } from '../src/schemas.js';

const GH2_CLI = resolve(import.meta.dir, '../src/cli.ts');
// Hermetic: a temp HOME/cwd and a PATH with only bun, so no real gh, config or working tree is touched.
const SANDBOX = mkdtempSync(join(tmpdir(), 'gh2-schemas-'));
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

function runGh2(args: string[]) {
  const res = spawnSync(process.execPath, [GH2_CLI, ...args], {
    encoding: 'utf-8',
    cwd: SANDBOX,
    env: { PATH: dirname(process.execPath), HOME: SANDBOX, NO_COLOR: '1' },
  });
  return {
    status: res.status ?? 0,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

describe('gh2 authored schemas', () => {
  test('(a) every op in --list has an authored schema and --schema has 0 derived ops', () => {
    // 1. Check --schema output
    const schemaRes = runGh2(['--schema']);
    expect(schemaRes.status).toBe(0);
    const derivedMatches = schemaRes.stdout.match(/"derived"\s*:\s*true/g) ?? [];
    expect(derivedMatches.length).toBe(0);

    // 2. Check --list output
    const listRes = runGh2(['--list']);
    expect(listRes.status).toBe(0);
    const ops = JSON.parse(listRes.stdout) as Array<{ name: string; schema?: unknown }>;
    expect(ops.length).toBe(28);
    for (const op of ops) {
      expect(op.schema).toBeDefined();
    }
  });

  test('(b) every op has a non-empty description and every param has a description', () => {
    expect(ALL_GH2_SCHEMAS.length).toBe(28);
    for (const schema of ALL_GH2_SCHEMAS) {
      expect(schema.name).toBeTruthy();
      expect(typeof schema.description).toBe('string');
      expect(schema.description!.trim().length).toBeGreaterThan(0);
      for (const param of schema.params) {
        expect(param.name).toBeTruthy();
        expect(typeof param.description).toBe('string');
        expect(param.description!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('(c) at least 5 ops pass validation with minimal valid input', () => {
    const opsToTest: Array<{ args: string[]; name: string }> = [
      { name: 'create_repository', args: ['create_repository', '--owner', '@me', '--repo', 'test-repo', '--dryrun'] },
      { name: 'create_issue', args: ['create_issue', '--owner', 'o', '--repo', 'r', '--title', 'test', '--dryrun'] },
      { name: 'create_branch', args: ['create_branch', '--owner', 'o', '--repo', 'r', '--branch-name', 'feat', '--dryrun'] },
      { name: 'create_pull_request', args: ['create_pull_request', '--owner', 'o', '--repo', 'r', '--title', 't', '--head', 'feat', '--base', 'main', '--dryrun'] },
      { name: 'create_release', args: ['create_release', '--owner', 'o', '--repo', 'r', '--tag', 'v1.0', '--dryrun'] },
    ];

    for (const { name, args } of opsToTest) {
      const res = runGh2(args);
      expect(res.status).toBe(0);
      expect(res.stdout).not.toContain('VALIDATION_ERROR');
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toBeDefined();
    }
  });
});
