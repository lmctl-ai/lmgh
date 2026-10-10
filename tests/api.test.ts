/**
 * @fileoverview Gh2 operations: exact gh argv, output parsing, write
 * envelopes, policy gates and error mapping, against a hermetic fake gh.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { CliError, ErrorCode, isDryRunResult } from '@lmctl-ai/lmts/server';

import { Gh2 } from '../src/api.js';
import { FakeGh, json } from './helpers/fake-gh.js';

let fake: FakeGh;
let gh: Gh2;

beforeAll(() => {
  fake = new FakeGh();
});
afterAll(() => fake.cleanup());
beforeEach(() => {
  fake.install();
  fake.reset();
  gh = new Gh2({ cwd: fake.work });
});
afterEach(() => fake.uninstall());

async function caught(p: Promise<unknown>): Promise<CliError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CliError);
    return e as CliError;
  }
  throw new Error('expected rejection');
}

describe('Gh2 constructor', () => {
  test('defaults: policy off, cwd = process.cwd(), defaultBranch main', () => {
    const g = new Gh2();
    expect(g.policy).toEqual({ dryRun: false, readOnly: false });
    expect(g.cwd).toBe(process.cwd());
    expect(g.defaultBranch).toBe('main');
  });

  test('explicit options', () => {
    const g = new Gh2({ policy: { dryRun: true }, cwd: '/x', defaultBranch: 'trunk' });
    expect(g.policy).toEqual({ dryRun: true, readOnly: false });
    expect(g.cwd).toBe('/x');
    expect(g.defaultBranch).toBe('trunk');
  });
});

// ---------------------------------------------------------------------------
// Read operations: exact argv + JSON parsing
// ---------------------------------------------------------------------------

interface ReadCase {
  name: string;
  call: (g: Gh2) => Promise<unknown>;
  argv: string[];
  out: unknown;
}

const READS: ReadCase[] = [
  {
    name: 'getCommitHistory (default limit 30)',
    call: (g) => g.getCommitHistory({ owner: 'o', repo: 'r' }),
    argv: [
      'api', 'repos/o/r/commits', '--jq',
      '.[:30] | [.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]',
    ],
    out: [{ sha: 'abc1234', message: 'm', author: 'a', date: '2024-01-01T00:00:00Z' }],
  },
  {
    name: 'getCommitHistory (limit 5)',
    call: (g) => g.getCommitHistory({ owner: 'o', repo: 'r', limit: 5 }),
    argv: [
      'api', 'repos/o/r/commits', '--jq',
      '.[:5] | [.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]',
    ],
    out: [],
  },
  {
    name: 'getCommitHistory (non-positive limit falls back to 30)',
    call: (g) => g.getCommitHistory({ owner: 'o', repo: 'r', limit: -2 }),
    argv: [
      'api', 'repos/o/r/commits', '--jq',
      '.[:30] | [.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]',
    ],
    out: [],
  },
  {
    name: 'listRepositories (no visibility)',
    call: (g) => g.listRepositories(),
    argv: ['repo', 'list', '--json', 'name,owner,description,isPrivate,url,updatedAt'],
    out: [{ name: 'r', owner: { login: 'o' }, description: '', isPrivate: false, url: 'u', updatedAt: 't' }],
  },
  {
    name: 'listRepositories (visibility private)',
    call: (g) => g.listRepositories({ visibility: 'private' }),
    argv: ['repo', 'list', '--visibility', 'private', '--json', 'name,owner,description,isPrivate,url,updatedAt'],
    out: [],
  },
  {
    name: 'searchRepositories (limit floors at 10)',
    call: (g) => g.searchRepositories({ query: 'lang:ts cli' }),
    argv: ['search', 'repos', 'lang:ts cli', '--json', 'name,owner,description,url,stargazersCount', '--limit', '10'],
    out: [{ name: 'x', owner: { login: 'y' }, description: null, url: 'u', stargazersCount: 3 }],
  },
  {
    name: 'searchRepositories (limit 25)',
    call: (g) => g.searchRepositories({ query: 'q', limit: 25 }),
    argv: ['search', 'repos', 'q', '--json', 'name,owner,description,url,stargazersCount', '--limit', '25'],
    out: [],
  },
  {
    name: 'searchRepositories (limit 3 raised to 10)',
    call: (g) => g.searchRepositories({ query: 'q', limit: 3 }),
    argv: ['search', 'repos', 'q', '--json', 'name,owner,description,url,stargazersCount', '--limit', '10'],
    out: [],
  },
  {
    name: 'getRepository',
    call: (g) => g.getRepository({ owner: 'o', repo: 'r' }),
    argv: [
      'repo', 'view', 'o/r', '--json',
      'name,description,owner,isPrivate,defaultBranchRef,primaryLanguage,repositoryTopics,stargazerCount,forkCount,createdAt,updatedAt,url',
    ],
    out: { name: 'r', defaultBranchRef: { name: 'main' }, stargazerCount: 1 },
  },
  {
    name: 'listBranches',
    call: (g) => g.listBranches({ owner: 'o', repo: 'r' }),
    argv: ['api', 'repos/o/r/branches'],
    out: [{ name: 'main', commit: { sha: 'abc' }, protected: true }],
  },
  {
    name: 'listIssues (default open)',
    call: (g) => g.listIssues({ owner: 'o', repo: 'r' }),
    argv: ['issue', 'list', '--repo', 'o/r', '--state', 'open', '--json', 'number,title,state,createdAt,author,body,labels,assignees,url'],
    out: [{ number: 1, title: 't', state: 'OPEN', author: { login: 'a' }, labels: [], assignees: [] }],
  },
  {
    name: 'listIssues (closed)',
    call: (g) => g.listIssues({ owner: 'o', repo: 'r', state: 'closed' }),
    argv: ['issue', 'list', '--repo', 'o/r', '--state', 'closed', '--json', 'number,title,state,createdAt,author,body,labels,assignees,url'],
    out: [],
  },
  {
    name: 'getIssue',
    call: (g) => g.getIssue({ owner: 'o', repo: 'r', issueNumber: 42 }),
    argv: ['issue', 'view', '42', '--repo', 'o/r', '--json', 'number,title,state,createdAt,author,body,labels,assignees,comments,url'],
    out: { number: 42, comments: [{ body: 'hi' }] },
  },
  {
    name: 'listPullRequests (default open)',
    call: (g) => g.listPullRequests({ owner: 'o', repo: 'r' }),
    argv: ['pr', 'list', '--repo', 'o/r', '--state', 'open', '--json', 'number,title,state,createdAt,author,headRefName,baseRefName,url'],
    out: [{ number: 7, headRefName: 'f', baseRefName: 'main' }],
  },
  {
    name: 'listPullRequests (merged)',
    call: (g) => g.listPullRequests({ owner: 'o', repo: 'r', state: 'merged' }),
    argv: ['pr', 'list', '--repo', 'o/r', '--state', 'merged', '--json', 'number,title,state,createdAt,author,headRefName,baseRefName,url'],
    out: [],
  },
  {
    name: 'getPullRequest',
    call: (g) => g.getPullRequest({ owner: 'o', repo: 'r', prNumber: 7 }),
    argv: ['pr', 'view', '7', '--repo', 'o/r', '--json', 'number,title,state,createdAt,author,body,headRefName,baseRefName,mergeable,url'],
    out: { number: 7, mergeable: 'MERGEABLE' },
  },
  {
    name: 'listWorkflows',
    call: (g) => g.listWorkflows({ owner: 'o', repo: 'r' }),
    argv: ['workflow', 'list', '--repo', 'o/r', '--json', 'name,state,id,path'],
    out: [{ name: 'CI', state: 'active', id: 1, path: '.github/workflows/ci.yml' }],
  },
  {
    name: 'listWorkflowRuns (no filters)',
    call: (g) => g.listWorkflowRuns({ owner: 'o', repo: 'r' }),
    argv: ['run', 'list', '--repo', 'o/r', '--json', 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt'],
    out: [{ databaseId: 9, status: 'completed', conclusion: 'success' }],
  },
  {
    name: 'listWorkflowRuns (workflow + status)',
    call: (g) => g.listWorkflowRuns({ owner: 'o', repo: 'r', workflowId: 'ci.yml', status: 'failure' }),
    argv: [
      'run', 'list', '--repo', 'o/r', '--workflow', 'ci.yml', '--status', 'failure',
      '--json', 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt',
    ],
    out: [],
  },
  {
    name: 'getWorkflowRun',
    call: (g) => g.getWorkflowRun({ owner: 'o', repo: 'r', runId: 123 }),
    argv: [
      'run', 'view', '123', '--repo', 'o/r', '--json',
      'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt,updatedAt,url',
    ],
    out: { databaseId: 123, url: 'u' },
  },
  {
    name: 'listReleases',
    call: (g) => g.listReleases({ owner: 'o', repo: 'r' }),
    argv: ['release', 'list', '--repo', 'o/r', '--json', 'tagName,name,createdAt,publishedAt,isDraft,isPrerelease,isLatest'],
    out: [{ tagName: 'v1', isLatest: true }],
  },
  {
    name: 'getRelease',
    call: (g) => g.getRelease({ owner: 'o', repo: 'r', tag: 'v1.2.3' }),
    argv: ['release', 'view', 'v1.2.3', '--repo', 'o/r', '--json', 'tagName,name,body,createdAt,publishedAt,isDraft,isPrerelease,author,assets,url'],
    out: { tagName: 'v1.2.3', assets: [] },
  },
  {
    name: 'getMe',
    call: (g) => g.getMe(),
    argv: ['api', 'user'],
    out: { login: 'octocat', id: 1 },
  },
];

describe('read operations', () => {
  for (const c of READS) {
    test(`${c.name}: argv and parsed result`, async () => {
      fake.respond([json(c.out)]);
      const result = await c.call(gh);
      expect(fake.onlyArgv()).toEqual(c.argv);
      expect(result).toEqual(c.out);
      const call = fake.calls()[0]!;
      expect(call.cwd).toBe(fake.work);
      expect(call.env['GH_PROMPT_DISABLED']).toBe('1');
      expect(call.env['NO_COLOR']).toBe('1');
    });
  }

  test('read ops still run under dryRun and readOnly policy', async () => {
    const g = new Gh2({ cwd: fake.work, policy: { dryRun: true, readOnly: true } });
    fake.respond([json({ login: 'me' })]);
    expect(await g.getMe()).toEqual({ login: 'me' });
    expect(fake.onlyArgv()).toEqual(['api', 'user']);
  });
});

describe('getFileContents', () => {
  test('uses gh api contents with base64 decode jq and returns raw text', async () => {
    fake.respond([{ stdout: '{"name": "pkg"}\n' }]);
    const out = await gh.getFileContents({ owner: 'o', repo: 'r', path: 'package.json' });
    expect(fake.onlyArgv()).toEqual(['api', 'repos/o/r/contents/package.json', '--jq', '.content | @base64d']);
    // execGhText: not JSON-parsed even though it looks like JSON
    expect(out).toBe('{"name": "pkg"}');
  });

  test('branch is URL-encoded into ?ref=', async () => {
    fake.respond([{ stdout: 'hello\n' }]);
    const out = await gh.getFileContents({ owner: 'o', repo: 'r', path: 'docs/a b.md', branch: 'feature/x y' });
    expect(fake.onlyArgv()).toEqual([
      'api', 'repos/o/r/contents/docs/a b.md?ref=feature%2Fx%20y', '--jq', '.content | @base64d',
    ]);
    expect(out).toBe('hello');
  });

  test('not found maps to COMMAND_FAILED', async () => {
    fake.respond([{ stderr: 'gh: Not Found (HTTP 404)', exit: 1 }]);
    const err = await caught(gh.getFileContents({ owner: 'o', repo: 'r', path: 'nope' }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('HTTP 404');
  });
});

describe('read error mapping', () => {
  test('auth failure -> FORBIDDEN', async () => {
    fake.respond([{ stderr: 'gh: Requires authentication (HTTP 401)', exit: 1 }]);
    const err = await caught(gh.getMe());
    expect(err.code).toBe(ErrorCode.Forbidden);
  });

  test('repo not found -> COMMAND_FAILED with stderr in message', async () => {
    fake.respond([{ stderr: "GraphQL: Could not resolve to a Repository with the name 'o/nope'. (repository)", exit: 1 }]);
    const err = await caught(gh.getRepository({ owner: 'o', repo: 'nope' }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('Could not resolve to a Repository');
  });

  test('rate limit -> COMMAND_FAILED', async () => {
    fake.respond([{ stderr: 'API rate limit exceeded (HTTP 403)', exit: 1 }]);
    const err = await caught(gh.listIssues({ owner: 'o', repo: 'r' }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('rate limit');
  });

  test('invalid JSON on stdout is returned as raw text (not thrown)', async () => {
    fake.respond([{ stdout: '{"truncated": ' }]);
    expect(await gh.listReleases({ owner: 'o', repo: 'r' })).toBe('{"truncated":');
  });
});

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

interface WriteCase {
  name: string;
  op: string;
  call: (g: Gh2) => Promise<unknown>;
  argv: string[];
  stdout: string;
  result: unknown;
}

const URL = 'https://github.com/o/r/issues/5';

const WRITES: WriteCase[] = [
  {
    name: 'createIssue with body',
    op: 'create_issue',
    call: (g) => g.createIssue({ owner: 'o', repo: 'r', title: 'T', body: 'B' }),
    argv: ['issue', 'create', '--repo', 'o/r', '--title', 'T', '--body', 'B'],
    stdout: `${URL}\n`,
    result: { success: true, url: URL },
  },
  {
    name: 'createIssue with whitespace body omits --body',
    op: 'create_issue',
    call: (g) => g.createIssue({ owner: 'o', repo: 'r', title: 'T', body: '   ' }),
    argv: ['issue', 'create', '--repo', 'o/r', '--title', 'T'],
    stdout: URL,
    result: { success: true, url: URL },
  },
  {
    name: 'closeIssue',
    op: 'close_issue',
    call: (g) => g.closeIssue({ owner: 'o', repo: 'r', issueNumber: 5 }),
    argv: ['issue', 'close', '5', '--repo', 'o/r'],
    stdout: '',
    result: { success: true, url: '' },
  },
  {
    name: 'commentOnIssue',
    op: 'comment_on_issue',
    call: (g) => g.commentOnIssue({ owner: 'o', repo: 'r', issueNumber: 5, body: 'LGTM' }),
    argv: ['issue', 'comment', '5', '--repo', 'o/r', '--body', 'LGTM'],
    stdout: `${URL}#issuecomment-1\n`,
    result: { success: true, url: `${URL}#issuecomment-1` },
  },
  {
    name: 'editIssue title+body',
    op: 'edit_issue',
    call: (g) => g.editIssue({ owner: 'o', repo: 'r', issueNumber: 5, title: 'N', body: 'NB' }),
    argv: ['issue', 'edit', '5', '--repo', 'o/r', '--title', 'N', '--body', 'NB'],
    stdout: URL,
    result: { success: true, url: URL },
  },
  {
    name: 'editIssue with nothing to change',
    op: 'edit_issue',
    call: (g) => g.editIssue({ owner: 'o', repo: 'r', issueNumber: 5 }),
    argv: ['issue', 'edit', '5', '--repo', 'o/r'],
    stdout: URL,
    result: { success: true, url: URL },
  },
  {
    name: 'createPullRequest with body',
    op: 'create_pull_request',
    call: (g) => g.createPullRequest({ owner: 'o', repo: 'r', title: 'T', body: 'B', head: 'f', base: 'main' }),
    argv: ['pr', 'create', '--repo', 'o/r', '--title', 'T', '--head', 'f', '--base', 'main', '--body', 'B'],
    stdout: 'https://github.com/o/r/pull/8\n',
    result: { success: true, url: 'https://github.com/o/r/pull/8' },
  },
  {
    name: 'createPullRequest without body',
    op: 'create_pull_request',
    call: (g) => g.createPullRequest({ owner: 'o', repo: 'r', title: 'T', head: 'f', base: 'main' }),
    argv: ['pr', 'create', '--repo', 'o/r', '--title', 'T', '--head', 'f', '--base', 'main'],
    stdout: 'https://github.com/o/r/pull/8',
    result: { success: true, url: 'https://github.com/o/r/pull/8' },
  },
  {
    name: 'mergePullRequest default --merge',
    op: 'merge_pull_request',
    call: (g) => g.mergePullRequest({ owner: 'o', repo: 'r', prNumber: 8 }),
    argv: ['pr', 'merge', '8', '--repo', 'o/r', '--merge'],
    stdout: '✓ Merged pull request #8\n',
    result: { success: true, output: '✓ Merged pull request #8' },
  },
  {
    name: 'mergePullRequest squash',
    op: 'merge_pull_request',
    call: (g) => g.mergePullRequest({ owner: 'o', repo: 'r', prNumber: 8, mergeMethod: 'squash' }),
    argv: ['pr', 'merge', '8', '--repo', 'o/r', '--squash'],
    stdout: 'ok',
    result: { success: true, output: 'ok' },
  },
  {
    name: 'mergePullRequest rebase (case-insensitive)',
    op: 'merge_pull_request',
    call: (g) => g.mergePullRequest({ owner: 'o', repo: 'r', prNumber: 8, mergeMethod: 'REBASE' as 'rebase' }),
    argv: ['pr', 'merge', '8', '--repo', 'o/r', '--rebase'],
    stdout: 'ok',
    result: { success: true, output: 'ok' },
  },
  {
    name: 'closePullRequest',
    op: 'close_pull_request',
    call: (g) => g.closePullRequest({ owner: 'o', repo: 'r', prNumber: 8 }),
    argv: ['pr', 'close', '8', '--repo', 'o/r'],
    stdout: '✓ Closed pull request #8',
    result: { success: true, url: '✓ Closed pull request #8' },
  },
  {
    name: 'commentOnPullRequest',
    op: 'comment_on_pull_request',
    call: (g) => g.commentOnPullRequest({ owner: 'o', repo: 'r', prNumber: 8, body: 'nit' }),
    argv: ['pr', 'comment', '8', '--repo', 'o/r', '--body', 'nit'],
    stdout: 'https://github.com/o/r/pull/8#issuecomment-2',
    result: { success: true, url: 'https://github.com/o/r/pull/8#issuecomment-2' },
  },
  {
    name: 'createRelease minimal',
    op: 'create_release',
    call: (g) => g.createRelease({ owner: 'o', repo: 'r', tag: 'v1' }),
    argv: ['release', 'create', 'v1', '--repo', 'o/r'],
    stdout: 'https://github.com/o/r/releases/tag/v1',
    result: { success: true, url: 'https://github.com/o/r/releases/tag/v1' },
  },
  {
    name: 'createRelease full',
    op: 'create_release',
    call: (g) => g.createRelease({ owner: 'o', repo: 'r', tag: 'v2', title: 'Two', notes: 'N', draft: true, prerelease: true }),
    argv: ['release', 'create', 'v2', '--repo', 'o/r', '--title', 'Two', '--notes', 'N', '--draft', '--prerelease'],
    stdout: 'https://github.com/o/r/releases/tag/v2',
    result: { success: true, url: 'https://github.com/o/r/releases/tag/v2' },
  },
];

describe('write operations: execution', () => {
  for (const c of WRITES) {
    test(`${c.name}: argv and {success,url|output} envelope`, async () => {
      fake.respond([{ stdout: c.stdout }]);
      expect(await c.call(gh)).toEqual(c.result as Record<string, unknown>);
      expect(fake.onlyArgv()).toEqual(c.argv);
    });
  }

  test('write failure maps the gh error (auth)', async () => {
    fake.respond([{ stderr: 'HTTP 401: Bad credentials', exit: 1 }]);
    const err = await caught(gh.createIssue({ owner: 'o', repo: 'r', title: 't' }));
    expect(err.code).toBe(ErrorCode.Forbidden);
  });

  test('write failure maps the gh error (generic)', async () => {
    fake.respond([{ stderr: 'pull request #8 is not mergeable', exit: 1 }]);
    const err = await caught(gh.mergePullRequest({ owner: 'o', repo: 'r', prNumber: 8 }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('not mergeable');
  });
});

describe('write operations: dry-run', () => {
  for (const c of WRITES) {
    test(`${c.name}: simulated, no gh call`, async () => {
      const g = new Gh2({ cwd: fake.work, policy: { dryRun: true } });
      const r = await c.call(g);
      expect(r).toEqual({ success: true, dryRun: true, simulated: c.op, command: ['gh', ...c.argv] });
      expect(fake.calls()).toHaveLength(0);
    });
  }
});

describe('write operations: read-only', () => {
  for (const c of WRITES) {
    test(`${c.name}: READONLY_VIOLATION, no gh call`, async () => {
      const g = new Gh2({ cwd: fake.work, policy: { readOnly: true, dryRun: true } });
      const err = await caught(c.call(g));
      expect(err.code).toBe(ErrorCode.ReadOnlyViolation);
      expect(err.exitCode).toBe(6);
      expect(err.data?.['operation']).toBe(c.op);
      expect(err.data?.['command']).toEqual(['gh', ...c.argv]);
      expect(fake.calls()).toHaveLength(0);
    });
  }
});

describe('createRepository', () => {
  const JQ = '{fullName: .full_name, url: .html_url, private: .private, defaultBranch: .default_branch}';

  test('@me -> user/repos, private default true, parses JSON', async () => {
    const out = { fullName: 'me/x', url: 'https://github.com/me/x', private: true, defaultBranch: 'main' };
    fake.respond([json(out)]);
    expect(await gh.createRepository({ owner: '@me', repo: 'x' })).toEqual(out);
    expect(fake.onlyArgv()).toEqual([
      'api', 'user/repos', '--method', 'POST', '--field', 'name=x', '--field', 'private=true', '--jq', JQ,
    ]);
  });

  test('empty owner -> user/repos', async () => {
    fake.respond([json({})]);
    await gh.createRepository({ owner: '', repo: 'x' });
    expect(fake.onlyArgv()[1]).toBe('user/repos');
  });

  test('org owner, public, description appended after --jq', async () => {
    fake.respond([json({ fullName: 'acme/x' })]);
    await gh.createRepository({ owner: 'acme', repo: 'x', private: false, description: 'Desc' });
    expect(fake.onlyArgv()).toEqual([
      'api', 'orgs/acme/repos', '--method', 'POST', '--field', 'name=x', '--field', 'private=false', '--jq', JQ,
      '--field', 'description=Desc',
    ]);
  });

  test('dry-run and read-only', async () => {
    const d = await new Gh2({ cwd: fake.work, policy: { dryRun: true } }).createRepository({ owner: '@me', repo: 'x' });
    expect(isDryRunResult(d)).toBe(true);
    expect((d as { simulated?: string }).simulated).toBe('create_repository');
    const err = await caught(new Gh2({ cwd: fake.work, policy: { readOnly: true } }).createRepository({ owner: '@me', repo: 'x' }));
    expect(err.code).toBe(ErrorCode.ReadOnlyViolation);
    expect(fake.calls()).toHaveLength(0);
  });
});

describe('createBranch', () => {
  test('resolves source SHA then POSTs ref (explicit fromBranch)', async () => {
    fake.respond([
      { match: 'git/ref/heads/develop', stdout: '0123456789abcdef\n' },
      json({ ref: 'refs/heads/feat', object: { sha: '0123456789abcdef' } }, 'git/refs'),
    ]);
    const out = await gh.createBranch({ owner: 'o', repo: 'r', branchName: 'feat', fromBranch: 'develop' });
    expect(out).toEqual({ ref: 'refs/heads/feat', object: { sha: '0123456789abcdef' } });
    expect(fake.calls().map((c) => c.argv)).toEqual([
      ['api', 'repos/o/r/git/ref/heads/develop', '--jq', '.object.sha'],
      ['api', 'repos/o/r/git/refs', '--method', 'POST', '--field', 'ref=refs/heads/feat', '--field', 'sha=0123456789abcdef'],
    ]);
  });

  test('defaults to the configured default branch', async () => {
    const g = new Gh2({ cwd: fake.work, defaultBranch: 'trunk' });
    fake.respond([{ match: 'heads/trunk', stdout: 'abc' }, json({})]);
    await g.createBranch({ owner: 'o', repo: 'r', branchName: 'b' });
    expect(fake.calls()[0]!.argv[1]).toBe('repos/o/r/git/ref/heads/trunk');
    expect(fake.calls()).toHaveLength(2);
  });

  test('empty SHA -> error, no POST', async () => {
    fake.respond([{ stdout: '' }]);
    await expect(gh.createBranch({ owner: 'o', repo: 'r', branchName: 'b' })).rejects.toThrow(
      'Failed to resolve SHA for branch "main": ',
    );
    expect(fake.calls()).toHaveLength(1);
  });

  test('"Error:" SHA output -> error, no POST', async () => {
    fake.respond([{ stdout: 'Error: nope' }]);
    await expect(gh.createBranch({ owner: 'o', repo: 'r', branchName: 'b' })).rejects.toThrow(
      'Failed to resolve SHA for branch "main": Error: nope',
    );
    expect(fake.calls()).toHaveLength(1);
  });

  test('source branch not found -> mapped COMMAND_FAILED', async () => {
    fake.respond([{ stderr: 'gh: Not Found (HTTP 404)', exit: 1 }]);
    const err = await caught(gh.createBranch({ owner: 'o', repo: 'r', branchName: 'b', fromBranch: 'gone' }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(fake.calls()).toHaveLength(1);
  });

  test('dry-run returns the POST command without resolving the SHA', async () => {
    const g = new Gh2({ cwd: fake.work, policy: { dryRun: true } });
    expect(await g.createBranch({ owner: 'o', repo: 'r', branchName: 'b' })).toEqual({
      success: true,
      dryRun: true,
      simulated: 'create_branch',
      command: ['gh', 'api', 'repos/o/r/git/refs', '--method', 'POST', '--field', 'ref=refs/heads/b'],
    });
    expect(fake.calls()).toHaveLength(0);
  });

  test('read-only refuses before resolving the SHA', async () => {
    const g = new Gh2({ cwd: fake.work, policy: { readOnly: true } });
    expect((await caught(g.createBranch({ owner: 'o', repo: 'r', branchName: 'b' }))).code).toBe(
      ErrorCode.ReadOnlyViolation,
    );
    expect(fake.calls()).toHaveLength(0);
  });
});
