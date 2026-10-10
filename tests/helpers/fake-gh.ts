/**
 * @fileoverview Hermetic fake `gh` executable for tests.
 *
 * A FakeGh owns a private temp tree:
 *   <root>/bin/gh      executable script (shebang = absolute path of the running bun)
 *   <root>/home        throwaway HOME
 *   <root>/work        throwaway cwd
 *   <root>/calls.jsonl one JSON line per gh invocation (argv, cwd, selected env)
 *
 * Responses are chosen per invocation from FAKE_GH_RULES (a JSON array of
 * rules). The first rule whose `match` substring occurs in the space-joined
 * argv (or that has no `match`) wins; no matching rule => empty stdout, exit 0.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface GhRule {
  /** Substring of argv.join(' '); omitted = match everything. */
  match?: string;
  stdout?: string;
  stderr?: string;
  exit?: number;
}

export interface GhCall {
  argv: string[];
  cwd: string;
  env: Record<string, string | null>;
}

/** Env vars the fake records for each call. */
export const RECORDED_ENV = ['GH_PROMPT_DISABLED', 'NO_COLOR', 'HOME', 'GH2_TEST_MARKER'] as const;

const SCRIPT = `
const fs = require('node:fs');
const argv = process.argv.slice(2);
const keys = ${JSON.stringify(RECORDED_ENV)};
const rec = process.env.FAKE_GH_RECORD;
const isVersionCheck = argv.includes('--version');
if (rec && !isVersionCheck) {
  const env = {};
  for (const k of keys) env[k] = process.env[k] === undefined ? null : process.env[k];
  fs.appendFileSync(rec, JSON.stringify({ argv, cwd: process.cwd(), env }) + '\\n');
}
const rules = JSON.parse(process.env.FAKE_GH_RULES || '[]');
const joined = argv.join(' ');
const rule = rules.find((r) => r.match !== undefined && joined.includes(r.match));
if (rule) {
  if (rule.stdout) fs.writeSync(1, rule.stdout);
  if (rule.stderr) fs.writeSync(2, rule.stderr);
  process.exit(rule.exit === undefined ? 0 : rule.exit);
}
if (isVersionCheck) {
  fs.writeSync(1, 'gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3)\\nhttps://github.com/cli/cli/releases/tag/v2.45.0\\n');
  process.exit(0);
}
const fallback = rules.find((r) => r.match === undefined) || {};
if (fallback.stdout) fs.writeSync(1, fallback.stdout);
if (fallback.stderr) fs.writeSync(2, fallback.stderr);
process.exit(fallback.exit === undefined ? 0 : fallback.exit);
`;

export class FakeGh {
  readonly root: string;
  readonly binDir: string;
  readonly home: string;
  readonly work: string;
  readonly recordFile: string;
  private saved: Record<string, string | undefined> = {};
  private savedCwd: string | undefined;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'gh2-fake-'));
    this.binDir = join(this.root, 'bin');
    this.home = join(this.root, 'home');
    this.work = join(this.root, 'work');
    this.recordFile = join(this.root, 'calls.jsonl');
    for (const d of [this.binDir, this.home, this.work]) mkdirSync(d, { recursive: true });
    const gh = join(this.binDir, 'gh');
    writeFileSync(gh, `#!${process.execPath}\n${SCRIPT}`);
    chmodSync(gh, 0o755);
    writeFileSync(this.recordFile, '');
  }

  /** PATH containing only the fake gh dir and the dir of the running bun. */
  get path(): string {
    return `${this.binDir}:${dirname(process.execPath)}`;
  }

  /** Env for a spawned gh2 subprocess (does not inherit the real env). */
  env(rules: GhRule[] = [], extra: Record<string, string> = {}): Record<string, string> {
    return {
      PATH: this.path,
      HOME: this.home,
      FAKE_GH_RECORD: this.recordFile,
      FAKE_GH_RULES: JSON.stringify(rules),
      ...extra,
    };
  }

  /** Point the current process at the fake (PATH/HOME/cwd); undo with uninstall(). */
  install(): void {
    for (const k of ['PATH', 'HOME', 'FAKE_GH_RECORD', 'FAKE_GH_RULES', 'GH2_READONLY', 'GH2_DRYRUN', 'GH2_TEST_MARKER']) {
      this.saved[k] = process.env[k];
    }
    process.env.PATH = this.path;
    process.env.HOME = this.home;
    process.env.FAKE_GH_RECORD = this.recordFile;
    process.env.FAKE_GH_RULES = '[]';
    delete process.env.GH2_READONLY;
    delete process.env.GH2_DRYRUN;
    delete process.env.GH2_TEST_MARKER;
    this.savedCwd = process.cwd();
    process.chdir(this.work);
  }

  uninstall(): void {
    for (const [k, v] of Object.entries(this.saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    this.saved = {};
    if (this.savedCwd !== undefined) process.chdir(this.savedCwd);
    this.savedCwd = undefined;
  }

  /** Set the canned responses for in-process calls. */
  respond(rules: GhRule[]): void {
    process.env.FAKE_GH_RULES = JSON.stringify(rules);
  }

  /** Forget recorded calls. */
  reset(): void {
    writeFileSync(this.recordFile, '');
    if (process.env.FAKE_GH_RULES !== undefined) process.env.FAKE_GH_RULES = '[]';
  }

  calls(): GhCall[] {
    if (!existsSync(this.recordFile)) return [];
    return readFileSync(this.recordFile, 'utf-8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as GhCall);
  }

  /** argv of the only recorded call (fails loudly otherwise). */
  onlyArgv(): string[] {
    const c = this.calls();
    if (c.length !== 1) throw new Error(`expected exactly 1 gh call, got ${c.length}: ${JSON.stringify(c)}`);
    return c[0]!.argv;
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Convenience: JSON stdout rule. */
export function json(value: unknown, match?: string): GhRule {
  return { ...(match !== undefined ? { match } : {}), stdout: JSON.stringify(value) };
}
