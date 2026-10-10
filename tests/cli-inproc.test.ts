/**
 * @fileoverview In-process tests for src/cli.ts. The module's `main()` hands
 * its RunnerConfig to `runCli`; we wrap runCli to capture that config, then
 * drive the real runner in-process (fake gh on PATH, temp HOME/cwd) so every
 * op adapter in makeOps() is exercised and measured.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import * as lmtsServer from '@lmctl-ai/lmts/server';
import type { RunnerConfig } from '@lmctl-ai/lmts/server';

import { ALL_GH2_SCHEMAS } from '../src/schemas.js';
import { FakeGh, json } from './helpers/fake-gh.js';

const realServer = { ...lmtsServer };
const realRunCli = realServer.runCli;
let captured: RunnerConfig<unknown> | undefined;
let capturedArgv: string[] | undefined;

let fake: FakeGh;

interface Run {
  code: number;
  out: string;
  json: unknown;
}

async function gh2(argv: string[]): Promise<Run> {
  if (!captured) throw new Error('config not captured');
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = await realRunCli(captured, argv);
  } finally {
    process.stdout.write = orig;
  }
  const out = chunks.join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    parsed = undefined;
  }
  return { code, out, json: parsed };
}

beforeAll(async () => {
  fake = new FakeGh();
  mock.module('@lmctl-ai/lmts/server', () => ({
    ...realServer,
    runCli: async (config: RunnerConfig<unknown>, argv: string[]) => {
      captured = config;
      capturedArgv = argv;
      return 0;
    },
  }));
  const savedArgv = process.argv;
  const savedExit = process.exit;
  let exited!: (code: number) => void;
  const exitP = new Promise<number>((r) => (exited = r));
  process.argv = [process.execPath, 'cli.ts', '--list'];
  process.exit = ((code?: number) => {
    exited(code ?? 0);
  }) as typeof process.exit;
  try {
    await import('../src/cli.js');
    expect(await exitP).toBe(0);
  } finally {
    process.argv = savedArgv;
    process.exit = savedExit;
    mock.module('@lmctl-ai/lmts/server', () => realServer);
  }
});
afterAll(() => fake.cleanup());
beforeEach(() => {
  fake.install();
  fake.reset();
});
afterEach(() => fake.uninstall());

describe('main()', () => {
  test('passes argv[2..] and a config built from package.json', () => {
    expect(capturedArgv).toEqual(['--list']);
    expect(captured?.toolName).toBe('gh2');
    expect(captured?.version).toBe('0.1.0');
    expect(captured?.ops).toHaveLength(28);
  });

  test('every op uses its authored schema and description', () => {
    const byName = new Map(ALL_GH2_SCHEMAS.map((s) => [s.name, s]));
    for (const op of captured!.ops) {
      const s = byName.get(op.name);
      expect(s).toBeDefined();
      expect(op.inputSchema).toBe(s!);
      expect(op.access).toBe(s!.access as 'read' | 'write');
      if (op.name === 'pr_triage') {
        // pr_triage carries its own (longer) description rather than the schema's.
        expect(op.description.startsWith(s!.description!)).toBe(true);
        expect(op.description).toContain('lmprobe');
      } else {
        expect(op.description).toBe(s!.description!);
      }
    }
  });

  test('buildContext wires the policy into Gh2', () => {
    const ctx = captured!.buildContext({ dryRun: true, readOnly: false }) as { gh: { policy: unknown; cwd: string } };
    expect(ctx.gh.policy).toEqual({ dryRun: true, readOnly: false });
    expect(ctx.gh.cwd).toBe(fake.work);
  });
});

// One invocation per op: [argv, expected gh argv, canned stdout, expected result]
interface OpCase {
  argv: string[];
  gh: string[][];
  stdout?: string | ((i: number) => string);
  rules?: Parameters<FakeGh['respond']>[0];
  result: unknown;
}

const OBJ = { ok: 1 };
const S = JSON.stringify(OBJ);

const CASES: Record<string, OpCase> = {
  get_commit_history: {
    argv: ['get_commit_history', '--owner', 'o', '--repo', 'r', '--limit', '3'],
    gh: [['api', 'repos/o/r/commits', '--jq', '.[:3] | [.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]']],
    result: OBJ,
  },
  list_repositories: {
    argv: ['list_repositories', '--visibility', 'public'],
    gh: [['repo', 'list', '--visibility', 'public', '--json', 'name,owner,description,isPrivate,url,updatedAt']],
    result: OBJ,
  },
  search_repositories: {
    argv: ['search_repositories', '--query', 'bun'],
    gh: [['search', 'repos', 'bun', '--json', 'name,owner,description,url,stargazersCount', '--limit', '10']],
    result: OBJ,
  },
  get_repository: {
    argv: ['get_repository', '--owner', 'o', '--repo', 'r'],
    gh: [['repo', 'view', 'o/r', '--json', 'name,description,owner,isPrivate,defaultBranchRef,primaryLanguage,repositoryTopics,stargazerCount,forkCount,createdAt,updatedAt,url']],
    result: OBJ,
  },
  create_repository: {
    argv: ['create_repository', '--owner', '@me', '--repo', 'x', '--description', 'd'],
    gh: [['api', 'user/repos', '--method', 'POST', '--field', 'name=x', '--field', 'private=true', '--jq', '{fullName: .full_name, url: .html_url, private: .private, defaultBranch: .default_branch}', '--field', 'description=d']],
    result: OBJ,
  },
  list_branches: {
    argv: ['list_branches', '--owner', 'o', '--repo', 'r'],
    gh: [['api', 'repos/o/r/branches']],
    result: OBJ,
  },
  create_branch: {
    argv: ['create_branch', '--owner', 'o', '--repo', 'r', '--branch-name', 'f', '--from-branch', 'dev'],
    rules: [{ match: 'git/ref/heads/dev', stdout: 'deadbeef\n' }, { stdout: S }],
    gh: [
      ['api', 'repos/o/r/git/ref/heads/dev', '--jq', '.object.sha'],
      ['api', 'repos/o/r/git/refs', '--method', 'POST', '--field', 'ref=refs/heads/f', '--field', 'sha=deadbeef'],
    ],
    result: OBJ,
  },
  get_file_contents: {
    argv: ['get_file_contents', '--owner', 'o', '--repo', 'r', '--path', 'README.md', '--branch', 'dev'],
    stdout: '# Title\n',
    gh: [['api', 'repos/o/r/contents/README.md?ref=dev', '--jq', '.content | @base64d']],
    result: '# Title',
  },
  list_issues: {
    argv: ['list_issues', '--owner', 'o', '--repo', 'r', '--state', 'all'],
    gh: [['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'number,title,state,createdAt,author,body,labels,assignees,url']],
    result: OBJ,
  },
  get_issue: {
    argv: ['get_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '4'],
    gh: [['issue', 'view', '4', '--repo', 'o/r', '--json', 'number,title,state,createdAt,author,body,labels,assignees,comments,url']],
    result: OBJ,
  },
  create_issue: {
    argv: ['create_issue', '--owner', 'o', '--repo', 'r', '--title', 'T', '--body', 'B'],
    stdout: 'https://github.com/o/r/issues/9\n',
    gh: [['issue', 'create', '--repo', 'o/r', '--title', 'T', '--body', 'B']],
    result: { success: true, url: 'https://github.com/o/r/issues/9' },
  },
  close_issue: {
    argv: ['close_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '9'],
    stdout: 'closed',
    gh: [['issue', 'close', '9', '--repo', 'o/r']],
    result: { success: true, url: 'closed' },
  },
  comment_on_issue: {
    argv: ['comment_on_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '9', '--body', 'hi'],
    stdout: 'u',
    gh: [['issue', 'comment', '9', '--repo', 'o/r', '--body', 'hi']],
    result: { success: true, url: 'u' },
  },
  edit_issue: {
    argv: ['edit_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '9', '--title', 'N'],
    stdout: 'u',
    gh: [['issue', 'edit', '9', '--repo', 'o/r', '--title', 'N']],
    result: { success: true, url: 'u' },
  },
  list_pull_requests: {
    argv: ['list_pull_requests', '--owner', 'o', '--repo', 'r', '--state', 'draft'],
    gh: [['pr', 'list', '--repo', 'o/r', '--state', 'draft', '--json', 'number,title,state,createdAt,author,headRefName,baseRefName,url']],
    result: OBJ,
  },
  get_pull_request: {
    argv: ['get_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', '2'],
    gh: [['pr', 'view', '2', '--repo', 'o/r', '--json', 'number,title,state,createdAt,author,body,headRefName,baseRefName,mergeable,url']],
    result: OBJ,
  },
  create_pull_request: {
    argv: ['create_pull_request', '--owner', 'o', '--repo', 'r', '--title', 'T', '--head', 'f', '--base', 'main'],
    stdout: 'https://github.com/o/r/pull/3',
    gh: [['pr', 'create', '--repo', 'o/r', '--title', 'T', '--head', 'f', '--base', 'main']],
    result: { success: true, url: 'https://github.com/o/r/pull/3' },
  },
  merge_pull_request: {
    argv: ['merge_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', '3', '--merge-method', 'squash'],
    stdout: 'merged',
    gh: [['pr', 'merge', '3', '--repo', 'o/r', '--squash']],
    result: { success: true, output: 'merged' },
  },
  close_pull_request: {
    argv: ['close_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', '3'],
    stdout: 'closed',
    gh: [['pr', 'close', '3', '--repo', 'o/r']],
    result: { success: true, url: 'closed' },
  },
  comment_on_pull_request: {
    argv: ['comment_on_pull_request', '--owner', 'o', '--repo', 'r', '--pr-number', '3', '--body', 'x'],
    stdout: 'u',
    gh: [['pr', 'comment', '3', '--repo', 'o/r', '--body', 'x']],
    result: { success: true, url: 'u' },
  },
  list_workflows: {
    argv: ['list_workflows', '--owner', 'o', '--repo', 'r'],
    gh: [['workflow', 'list', '--repo', 'o/r', '--json', 'name,state,id,path']],
    result: OBJ,
  },
  list_workflow_runs: {
    argv: ['list_workflow_runs', '--owner', 'o', '--repo', 'r', '--workflow-id', 'ci', '--status', 'success'],
    gh: [['run', 'list', '--repo', 'o/r', '--workflow', 'ci', '--status', 'success', '--json', 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt']],
    result: OBJ,
  },
  get_workflow_run: {
    argv: ['get_workflow_run', '--owner', 'o', '--repo', 'r', '--run-id', '77'],
    gh: [['run', 'view', '77', '--repo', 'o/r', '--json', 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt,updatedAt,url']],
    result: OBJ,
  },
  list_releases: {
    argv: ['list_releases', '--owner', 'o', '--repo', 'r'],
    gh: [['release', 'list', '--repo', 'o/r', '--json', 'tagName,name,createdAt,publishedAt,isDraft,isPrerelease,isLatest']],
    result: OBJ,
  },
  get_release: {
    argv: ['get_release', '--owner', 'o', '--repo', 'r', '--tag', 'v1'],
    gh: [['release', 'view', 'v1', '--repo', 'o/r', '--json', 'tagName,name,body,createdAt,publishedAt,isDraft,isPrerelease,author,assets,url']],
    result: OBJ,
  },
  create_release: {
    argv: ['create_release', '--owner', 'o', '--repo', 'r', '--tag', 'v1', '--draft', '--prerelease'],
    stdout: 'u',
    gh: [['release', 'create', 'v1', '--repo', 'o/r', '--draft', '--prerelease']],
    result: { success: true, url: 'u' },
  },
  get_me: {
    argv: ['get_me'],
    gh: [['api', 'user']],
    result: OBJ,
  },
  pr_triage: {
    argv: ['pr_triage', '--url', 'https://github.com/o/r/pull/5', '--since', 'all', '--compact'],
    stdout: '{"title":"T","comments":[{"createdAt":"2024-01-01T00:00:00Z","body":"x"}]}',
    gh: [['pr', 'view', '5', '--repo', 'o/r', '--json', 'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews,reviewThreads']],
    result: {
      target: { owner: 'o', repo: 'r', number: 5, url: 'https://github.com/o/r/pull/5' },
      since: 'all',
      compact: true,
      exitStatus: 'matched',
      status: { title: 'T', draft: false },
      checks: [],
      checkSummary: { total: 0, passing: 0, failing: 0, skipped_neutral: 0, pending: 0 },
      evidence: [{ kind: 'comment', author: 'unknown', createdAt: '2024-01-01T00:00:00Z', bodyExcerpt: 'x', actionTerms: [] }],
      warnings: [],
    },
  },
};

describe('every op through the runner', () => {
  test('the case table covers all 28 ops', () => {
    expect(Object.keys(CASES).sort()).toEqual(captured!.ops.map((o) => o.name).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    test(`${name}: argv -> gh argv -> JSON result`, async () => {
      fake.respond(c.rules ?? [{ stdout: typeof c.stdout === 'string' ? c.stdout : S }]);
      const r = await gh2(c.argv);
      expect(r.code).toBe(0);
      expect(r.json).toEqual(c.result);
      expect(fake.calls().map((x) => x.argv)).toEqual(c.gh);
      for (const call of fake.calls()) {
        expect(call.cwd).toBe(fake.work);
        expect(call.env['GH_PROMPT_DISABLED']).toBe('1');
        expect(call.env['NO_COLOR']).toBe('1');
        expect(call.env['HOME']).toBe(fake.home);
      }
    });
  }
});

describe('policy through the runner (in-process)', () => {
  test('--dryrun simulates writes and does not call gh', async () => {
    const r = await gh2(['close_issue', '--owner', 'o', '--repo', 'r', '--issue-number', '1', '--dryrun']);
    expect(r.code).toBe(0);
    expect(r.json).toEqual({
      success: true,
      dryRun: true,
      simulated: 'close_issue',
      command: ['gh', 'issue', 'close', '1', '--repo', 'o/r'],
    });
    expect(fake.calls()).toHaveLength(0);
  });

  test('--readonly refuses writes with exit 6', async () => {
    const r = await gh2(['create_issue', '--owner', 'o', '--repo', 'r', '--title', 't', '--readonly']);
    expect(r.code).toBe(6);
    expect((r.json as { error: { code: string } }).error.code).toBe('READONLY_VIOLATION');
    expect(fake.calls()).toHaveLength(0);
  });

  test('GH2_READONLY / GH2_DRYRUN env floors', async () => {
    process.env.GH2_READONLY = 'yes';
    const ro = await gh2(['create_issue', '--owner', 'o', '--repo', 'r', '--title', 't']);
    expect(ro.code).toBe(6);
    delete process.env.GH2_READONLY;
    process.env.GH2_DRYRUN = 'true';
    const dr = await gh2(['create_issue', '--owner', 'o', '--repo', 'r', '--title', 't']);
    expect(dr.code).toBe(0);
    expect((dr.json as { dryRun?: boolean }).dryRun).toBe(true);
    expect(fake.calls()).toHaveLength(0);
  });

  test('gh errors become JSON error envelopes with mapped exit codes', async () => {
    fake.respond([{ stderr: 'HTTP 401: Bad credentials', exit: 1 }]);
    const r = await gh2(['get_me']);
    expect(r.code).toBe(6);
    expect(r.json).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});

describe('pr_triage adapter', () => {
  test('defaults since=last-author-comment and compact=false', async () => {
    fake.respond([{ stdout: '{}' }]);
    const r = await gh2(['pr_triage', '--url', 'https://github.com/o/r/pull/5']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ since: 'last-author-comment', compact: false });
  });

  test('run() rejects a missing url when called without schema validation', async () => {
    const op = captured!.ops.find((o) => o.name === 'pr_triage')!;
    const ctx = captured!.buildContext({ dryRun: false, readOnly: false });
    await expect(op.run({}, ctx)).rejects.toThrow('--url is required (full GitHub PR URL)');
    expect(fake.calls()).toHaveLength(0);
  });
});
