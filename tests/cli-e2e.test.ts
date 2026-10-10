/**
 * @fileoverview End-to-end tests: spawn `bun src/cli.ts ...` with a fake gh
 * first on PATH, a temp HOME and a temp cwd. Nothing from the real
 * environment is inherited.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { FakeGh, json, type GhRule } from './helpers/fake-gh.js';

const CLI = resolve(import.meta.dir, '../src/cli.ts');

let fake: FakeGh;

beforeAll(() => {
  fake = new FakeGh();
});
afterAll(() => fake.cleanup());
beforeEach(() => fake.reset());

interface Res {
  status: number;
  stdout: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function gh2(args: string[], rules: GhRule[] = [], extraEnv: Record<string, string> = {}): Res {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: fake.work,
    env: fake.env(rules, extraEnv),
    encoding: 'utf-8',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    parsed = undefined;
  }
  return { status: r.status ?? -1, stdout: r.stdout, json: parsed };
}

const CREATE_ISSUE = ['create_issue', '--owner', 'o', '--repo', 'r', '--title', 'T'];

describe('end to end: reads and writes', () => {
  test('read op: argv, env and parsed output', () => {
    const r = gh2(['get_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '7'], [json({ number: 7, title: 't' })], {
      GH2_TEST_MARKER: 'm',
    });
    expect(r.status).toBe(0);
    expect(r.json).toEqual({ number: 7, title: 't' });
    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual([
      'issue', 'view', '7', '--repo', 'o/r', '--json', 'number,title,state,createdAt,author,body,labels,assignees,comments,url',
    ]);
    expect(calls[0]!.cwd).toBe(fake.work);
    expect(calls[0]!.env).toEqual({ GH_PROMPT_DISABLED: '1', NO_COLOR: '1', HOME: fake.home, GH2_TEST_MARKER: 'm' });
  });

  test('get_file_contents uses gh api contents + base64d jq', () => {
    const r = gh2(['get_file_contents', '--owner', 'o', '--repo', 'r', '--path', 'a/b.txt'], [{ stdout: 'plain text\n' }]);
    expect(r.status).toBe(0);
    expect(r.json).toBe('plain text');
    expect(fake.onlyArgv()).toEqual(['api', 'repos/o/r/contents/a/b.txt', '--jq', '.content | @base64d']);
  });

  test('write op returns {success,url}', () => {
    const r = gh2(CREATE_ISSUE, [{ stdout: 'https://github.com/o/r/issues/1\n' }]);
    expect(r.status).toBe(0);
    expect(r.json).toEqual({ success: true, url: 'https://github.com/o/r/issues/1' });
    expect(fake.onlyArgv()).toEqual(['issue', 'create', '--repo', 'o/r', '--title', 'T']);
  });

  test('merge returns {success,output}', () => {
    const r = gh2(['merge_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', '2', '--merge-method', 'rebase'], [
      { stdout: 'Rebased and merged\n' },
    ]);
    expect(r.json).toEqual({ success: true, output: 'Rebased and merged' });
    expect(fake.onlyArgv()).toEqual(['pr', 'merge', '2', '--repo', 'o/r', '--rebase']);
  });
});

describe('end to end: error mapping', () => {
  test('auth failure -> FORBIDDEN, exit 6', () => {
    const r = gh2(['get_me'], [{ stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\nnot logged in', exit: 4 }]);
    expect(r.status).toBe(6);
    expect(r.json.success).toBe(false);
    expect(r.json.error.code).toBe('FORBIDDEN');
    expect(r.json.error.message).toBe('gh authentication failed. Run "gh auth login" first.');
  });

  test('not found -> COMMAND_FAILED, exit 1', () => {
    const r = gh2(['get_repository', '--owner', 'o', '--repo', 'nope'], [{ stderr: 'GraphQL: Could not resolve to a Repository', exit: 1 }]);
    expect(r.status).toBe(1);
    expect(r.json.error.code).toBe('COMMAND_FAILED');
    expect(r.json.error.message).toContain('Could not resolve to a Repository');
  });

  test('rate limit -> COMMAND_FAILED, exit 1', () => {
    const r = gh2(['list_releases', '--owner', 'o', '--repo', 'r'], [{ stderr: 'API rate limit exceeded (HTTP 403)', exit: 1 }]);
    expect(r.status).toBe(1);
    expect(r.json.error.code).toBe('COMMAND_FAILED');
  });

  test('invalid JSON stdout from gh is passed through as a string', () => {
    const r = gh2(['list_releases', '--owner', 'o', '--repo', 'r'], [{ stdout: '[{"tagName": ' }]);
    expect(r.status).toBe(0);
    expect(r.json).toBe('[{"tagName":');
  });

  test('gh missing from PATH -> UNSUPPORTED_PRODUCT_VERSION, exit 10', () => {
    const r = spawnSync(process.execPath, [CLI, 'get_me'], {
      cwd: fake.work,
      env: { PATH: fake.home, HOME: fake.home },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(10);
    const j = JSON.parse(r.stdout) as { error: { code: string; message: string } };
    expect(j.error.code).toBe('UNSUPPORTED_PRODUCT_VERSION');
    expect(j.error.message).toContain('not found on PATH');
  });
});

describe('end to end: policy', () => {
  test('--dryrun returns a simulated result and records no gh call', () => {
    const r = gh2([...CREATE_ISSUE, '--dryrun']);
    expect(r.status).toBe(0);
    expect(r.json).toEqual({
      success: true,
      dryRun: true,
      simulated: 'create_issue',
      command: ['gh', 'issue', 'create', '--repo', 'o/r', '--title', 'T'],
    });
    expect(fake.calls()).toHaveLength(0);
  });

  test('--dry-run alias before the op name', () => {
    const r = gh2(['--dry-run', 'create_branch', '--owner', 'o', '--repo', 'r', '--branch-name', 'b']);
    expect(r.status).toBe(0);
    expect(r.json.dryRun).toBe(true);
    expect(fake.calls()).toHaveLength(0);
  });

  test('--readonly refuses write ops: exit 6, READONLY_VIOLATION, no gh call', () => {
    const r = gh2([...CREATE_ISSUE, '--readonly']);
    expect(r.status).toBe(6);
    expect(r.json.success).toBe(false);
    expect(r.json.error.code).toBe('READONLY_VIOLATION');
    expect(r.json.error.data.operation).toBe('create_issue');
    expect(fake.calls()).toHaveLength(0);
  });

  test('--readonly wins over --dryrun', () => {
    const r = gh2([...CREATE_ISSUE, '--readonly', '--dryrun']);
    expect(r.status).toBe(6);
    expect(fake.calls()).toHaveLength(0);
  });

  test('--readonly still runs read ops', () => {
    const r = gh2(['get_me', '--read-only'], [json({ login: 'me' })]);
    expect(r.status).toBe(0);
    expect(r.json).toEqual({ login: 'me' });
    expect(fake.onlyArgv()).toEqual(['api', 'user']);
  });

  test('--dryrun still runs read ops', () => {
    const r = gh2(['list_workflows', '--owner', 'o', '--repo', 'r', '--dryrun'], [json([])]);
    expect(r.status).toBe(0);
    expect(r.json).toEqual([]);
    expect(fake.calls()).toHaveLength(1);
  });

  test('GH2_READONLY=1 env floor refuses writes', () => {
    const r = gh2(CREATE_ISSUE, [], { GH2_READONLY: '1' });
    expect(r.status).toBe(6);
    expect(r.json.error.code).toBe('READONLY_VIOLATION');
    expect(fake.calls()).toHaveLength(0);
  });

  test('GH2_DRYRUN=on env floor simulates writes', () => {
    const r = gh2(CREATE_ISSUE, [], { GH2_DRYRUN: 'on' });
    expect(r.status).toBe(0);
    expect(r.json.dryRun).toBe(true);
    expect(fake.calls()).toHaveLength(0);
  });

  test('GH2_READONLY=0 is not a floor', () => {
    const r = gh2(CREATE_ISSUE, [{ stdout: 'u' }], { GH2_READONLY: '0', GH2_DRYRUN: 'no' });
    expect(r.status).toBe(0);
    expect(r.json).toEqual({ success: true, url: 'u' });
    expect(fake.calls()).toHaveLength(1);
  });
});

describe('end to end: input forms', () => {
  test('--input-json document equals argv flags', () => {
    const viaJson = gh2(['get_issue', '--input-json', JSON.stringify({ owner: 'o', repo: 'r', issueNumber: 3 })], [json({ n: 3 })]);
    const jsonArgv = fake.onlyArgv();
    fake.reset();
    const viaFlags = gh2(['get_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '3'], [json({ n: 3 })]);
    expect(viaJson.status).toBe(0);
    expect(viaJson.json).toEqual(viaFlags.json);
    expect(jsonArgv).toEqual(fake.onlyArgv());
  });

  test('--input-json envelope at root infers the op', () => {
    const doc = { op: 'create_issue', params: { owner: 'o', repo: 'r', title: 'T' } };
    const r = gh2(['--input-json', JSON.stringify(doc), '--dryrun']);
    expect(r.status).toBe(0);
    expect(r.json.simulated).toBe('create_issue');
    expect(fake.calls()).toHaveLength(0);
  });

  test('--input-file reads a JSON document from the temp cwd', () => {
    const file = join(fake.work, 'input.json');
    writeFileSync(file, JSON.stringify({ owner: 'o', repo: 'r', tag: 'v9' }));
    const r = gh2(['get_release', '--input-file', file], [json({ tagName: 'v9' })]);
    expect(r.status).toBe(0);
    expect(fake.onlyArgv().slice(0, 3)).toEqual(['release', 'view', 'v9']);
  });

  test('mixing --input-json with op flags is a VALIDATION_ERROR', () => {
    const r = gh2(['get_issue', '--owner', 'o', '--input-json', '{"repo":"r","issueNumber":1}']);
    expect(r.status).toBe(2);
    expect(r.json.error.code).toBe('VALIDATION_ERROR');
    expect(r.json.error.data.issues[0].code).toBe('MIXED_INPUT');
    expect(fake.calls()).toHaveLength(0);
  });
});

describe('end to end: validation and discovery', () => {
  test('missing required param -> exit 2, MISSING_REQUIRED', () => {
    const r = gh2(['get_issue', '--owner', 'o', '--repo', 'r']);
    expect(r.status).toBe(2);
    expect(r.json.error.code).toBe('VALIDATION_ERROR');
    expect(r.json.error.data.issues[0]).toMatchObject({ code: 'MISSING_REQUIRED', param: 'issueNumber' });
    expect(fake.calls()).toHaveLength(0);
  });

  test('unknown param -> exit 2, UNKNOWN_PARAM', () => {
    const r = gh2(['get_me', '--bogus', 'x']);
    expect(r.status).toBe(2);
    expect(r.json.error.data.issues[0]).toMatchObject({ code: 'UNKNOWN_PARAM', param: 'bogus' });
    expect(fake.calls()).toHaveLength(0);
  });

  test('type mismatch -> exit 2', () => {
    const r = gh2(['get_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', 'abc']);
    expect(r.status).toBe(2);
    expect(r.json.error.data.issues[0].code).toBe('TYPE_MISMATCH');
  });

  test('enum violation -> exit 2', () => {
    const r = gh2(['list_issues', '--owner', 'o', '--repo', 'r', '--state', 'weird']);
    expect(r.status).toBe(2);
    expect(r.json.error.code).toBe('VALIDATION_ERROR');
    expect(fake.calls()).toHaveLength(0);
  });

  test('unknown op -> exit 2, INVALID_REQUEST', () => {
    const r = gh2(['frobnicate']);
    expect(r.status).toBe(2);
    expect(r.json.error).toMatchObject({ code: 'INVALID_REQUEST', message: 'Unknown operation: frobnicate' });
  });

  test('no op -> exit 2', () => {
    const r = gh2(['--dryrun']);
    expect(r.status).toBe(2);
    expect(r.json.error.message).toBe('No operation specified');
  });

  test('--list lists 28 ops with access', () => {
    const r = gh2(['--list']);
    expect(r.status).toBe(0);
    expect(r.json).toHaveLength(28);
    const access = Object.fromEntries((r.json as Array<{ name: string; access: string }>).map((o) => [o.name, o.access]));
    expect(access['get_me']).toBe('read');
    expect(access['pr_triage']).toBe('read');
    expect(access['create_issue']).toBe('write');
  });

  test('--schema publishes the tool schema with version', () => {
    const r = gh2(['--schema']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"gh2"');
    expect(r.stdout).toContain('0.1.0');
    expect(r.stdout).toContain('get_file_contents');
  });

  test('--explain op (json and text)', () => {
    const j = gh2(['--explain', 'get_issue']);
    expect(j.status).toBe(0);
    expect(j.json.name).toBe('get_issue');
    expect(j.json.access).toBe('read');
    const t = gh2(['--explain', 'get_issue', '--format', 'text']);
    expect(t.status).toBe(0);
    expect(t.stdout).toContain('gh2 get_issue');
    expect(t.stdout).toContain('--issue-number');
  });

  test('--explain errors', () => {
    expect(gh2(['--explain']).status).toBe(2);
    const r = gh2(['--explain', 'nope']);
    expect(r.status).toBe(2);
    expect(r.json.error.message).toBe('Unknown operation for --explain: nope');
  });

  test('--help, no args, and per-op --help', () => {
    for (const args of [['--help'], [], ['-h']]) {
      const r = gh2(args);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('gh2');
      expect(r.stdout).toContain('pr_triage');
    }
    const op = gh2(['create_release', '--help']);
    expect(op.status).toBe(0);
    expect(op.stdout).toContain('gh2 create_release');
    expect(fake.calls()).toHaveLength(0);
  });
});

describe('end to end: pr_triage', () => {
  test('reviewThreads fallback with warning', () => {
    const r = gh2(['pr_triage', '--url', 'https://github.com/o/r/pull/4'], [
      { match: 'reviewThreads', stderr: 'Unknown JSON field: "reviewThreads"', exit: 1 },
      json({ title: 'T', author: { login: 'a' } }),
    ]);
    expect(r.status).toBe(0);
    expect(r.json.warnings[0].code).toBe('GITHUB_CLI_REVIEW_THREADS_UNSUPPORTED');
    expect(r.json.status).toEqual({ title: 'T', author: 'a', draft: false });
    expect(fake.calls()).toHaveLength(2);
    expect(fake.calls()[1]!.argv.at(-1)).toBe(
      'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews',
    );
  });

  test('bad URL -> INVALID_REQUEST exit 2, no gh call', () => {
    const r = gh2(['pr_triage', '--url', 'https://example.com/x']);
    expect(r.status).toBe(2);
    expect(r.json.error.code).toBe('INVALID_REQUEST');
    expect(fake.calls()).toHaveLength(0);
  });

  test('gh failure -> COMMAND_FAILED exit 1', () => {
    const r = gh2(['pr_triage', '--url', 'https://github.com/o/r/pull/4'], [{ stderr: 'boom', exit: 1 }]);
    expect(r.status).toBe(1);
    expect(r.json.error).toMatchObject({ code: 'COMMAND_FAILED', data: { url: 'https://github.com/o/r/pull/4' } });
  });
});
