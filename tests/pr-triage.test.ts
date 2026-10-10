/**
 * @fileoverview pr_triage: URL parsing, gh invocation, reviewThreads
 * fallback, normalization of checks/reviews/comments.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

import { CliError, ErrorCode } from '@lmctl-ai/lmts/server';

import { parseGitHubPrUrl, prTriage } from '../src/pr-triage.js';
import { FakeGh, json, type GhRule } from './helpers/fake-gh.js';

const FIELDS =
  'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews,reviewThreads';
const FIELDS_NO_RT =
  'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews';
const PR_URL = 'https://github.com/octo/demo/pull/12';
const UNKNOWN_RT: GhRule = {
  match: 'reviewThreads',
  stderr: 'Unknown JSON field: "reviewThreads"\nAvailable fields:\n  additions\n  ...',
  exit: 1,
};

let fake: FakeGh;

beforeAll(() => {
  fake = new FakeGh();
});
afterAll(() => fake.cleanup());
beforeEach(() => {
  fake.install();
  fake.reset();
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

describe('parseGitHubPrUrl', () => {
  test('canonical URL', () => {
    expect(parseGitHubPrUrl(PR_URL)).toEqual({ owner: 'octo', repo: 'demo', number: 12, url: PR_URL });
  });

  test('scheme-less, www, http, trailing slash, query and fragment', () => {
    for (const u of [
      'github.com/octo/demo/pull/12',
      'www.github.com/octo/demo/pull/12',
      'HTTP://WWW.github.com/octo/demo/pull/12/',
      '  https://github.com/octo/demo/pull/12?foo=bar  ',
      'https://github.com/octo/demo/pull/12#discussion_r1',
    ]) {
      expect(parseGitHubPrUrl(u)).toEqual({ owner: 'octo', repo: 'demo', number: 12, url: PR_URL });
    }
  });

  test('non-GitHub host is INVALID_REQUEST', () => {
    try {
      parseGitHubPrUrl('https://gitlab.com/o/r/pull/1');
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe(ErrorCode.InvalidRequest);
      expect((e as CliError).data).toEqual({ url: 'https://gitlab.com/o/r/pull/1' });
    }
  });

  test('wrong shape is INVALID_REQUEST with parts', () => {
    for (const u of ['https://github.com/o/r/issues/1', 'https://github.com/o/r/pull', 'https://github.com/o/r/pull/1/files']) {
      try {
        parseGitHubPrUrl(u);
        throw new Error('no throw');
      } catch (e) {
        expect((e as CliError).code).toBe(ErrorCode.InvalidRequest);
        expect((e as CliError).data?.['parts']).toBeDefined();
      }
    }
  });

  test('non-positive / non-integer number is INVALID_REQUEST', () => {
    for (const n of ['0', '-1', 'abc', '1.5']) {
      try {
        parseGitHubPrUrl(`https://github.com/o/r/pull/${n}`);
        throw new Error('no throw');
      } catch (e) {
        expect((e as CliError).code).toBe(ErrorCode.InvalidRequest);
        expect((e as CliError).message).toBe('pull request number must be a positive integer');
        expect((e as CliError).data).toEqual({ url: `https://github.com/o/r/pull/${n}`, number: n });
      }
    }
  });
});

const FULL_PAYLOAD = {
  number: 12,
  url: PR_URL,
  title: 'Add feature',
  state: 'OPEN',
  isDraft: true,
  mergeable: 'CONFLICTING',
  reviewDecision: 'CHANGES_REQUESTED',
  author: { login: 'alice' },
  statusCheckRollup: [
    { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/build' },
    { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/lint' },
    { context: 'legacy/ci', state: 'ERROR', targetUrl: 'https://ci/legacy' },
    { context: 'status/ok', state: 'SUCCESS' },
    { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { name: 'opt', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { name: 'slow', status: 'IN_PROGRESS' },
    { context: 'ext', state: 'PENDING' },
    { name: 'weird', status: 'COMPLETED', conclusion: 'STALE' },
    { name: 'timeout', conclusion: 'TIMED_OUT' },
    { name: 'cancel', conclusion: 'CANCELLED' },
    { name: 'act', conclusion: 'ACTION_REQUIRED' },
    {},
  ],
  comments: [
    { author: { login: 'bob' }, authorAssociation: 'MEMBER', createdAt: '2024-01-01T00:00:00Z', body: 'old comment', url: 'u1' },
    { author: { login: 'alice' }, createdAt: '2024-01-02T00:00:00Z', body: 'author reply' },
    { author: { login: 'alice' }, createdAt: '2024-01-01T12:00:00Z', body: 'earlier author reply' },
    { author: { login: 'carol' }, createdAt: '2024-01-05T00:00:00Z', body: 'CI is FAILING and the DCO check is missing' },
    { author: null, createdAt: '2024-01-06T00:00:00Z', body: 'ghost' },
  ],
  reviews: [
    { author: { login: 'dave' }, state: 'CHANGES_REQUESTED', submittedAt: '2024-01-04T00:00:00Z', body: 'Changes requested: nitpick here' },
    { author: { login: 'erin' }, state: 'APPROVED', submittedAt: '2024-01-01T06:00:00Z', body: '' },
    { state: 'COMMENTED', body: 'no timestamp, no author' },
  ],
  reviewThreads: [
    {
      comments: [
        { author: { login: 'frank' }, createdAt: '2024-01-03T00:00:00Z', body: 'quick win: rename', path: 'src/a.ts', line: 10, url: 'u2' },
        { author: { login: 'frank' }, createdAt: '2024-01-03T01:00:00Z', body: 'outdated', path: 'src/b.ts', line: null },
      ],
    },
    { comments: 'not-an-array' },
    {},
  ],
};

describe('prTriage: normal path', () => {
  test('invokes gh pr view with the full field set, normalizes everything', async () => {
    fake.respond([json(FULL_PAYLOAD)]);
    const r = await prTriage(PR_URL, { cwd: fake.work });

    expect(fake.onlyArgv()).toEqual(['pr', 'view', '12', '--repo', 'octo/demo', '--json', FIELDS]);
    expect(fake.calls()[0]!.cwd).toBe(fake.work);
    expect(fake.calls()[0]!.env['GH_PROMPT_DISABLED']).toBe('1');

    expect(r.target).toEqual({ owner: 'octo', repo: 'demo', number: 12, url: PR_URL });
    expect(r.since).toBe('last-author-comment');
    expect(r.compact).toBe(false);
    expect(r.exitStatus).toBe('matched');
    expect(r.warnings).toEqual([]);
    expect(r.status).toEqual({
      title: 'Add feature',
      author: 'alice',
      state: 'OPEN',
      mergeable: 'CONFLICTING',
      reviewDecision: 'CHANGES_REQUESTED',
      draft: true,
    });

    expect(r.checks).toEqual([
      { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', bucket: 'passing', url: 'https://ci/build' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', bucket: 'failing', url: 'https://ci/lint' },
      { name: 'legacy/ci', state: 'ERROR', bucket: 'failing', url: 'https://ci/legacy' },
      { name: 'status/ok', state: 'SUCCESS', bucket: 'passing' },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED', bucket: 'skipped_neutral' },
      { name: 'opt', status: 'COMPLETED', conclusion: 'NEUTRAL', bucket: 'skipped_neutral' },
      { name: 'slow', status: 'IN_PROGRESS', bucket: 'pending' },
      { name: 'ext', state: 'PENDING', bucket: 'pending' },
      { name: 'weird', status: 'COMPLETED', conclusion: 'STALE', bucket: 'pending' },
      { name: 'timeout', conclusion: 'TIMED_OUT', bucket: 'failing' },
      { name: 'cancel', conclusion: 'CANCELLED', bucket: 'failing' },
      { name: 'act', conclusion: 'ACTION_REQUIRED', bucket: 'failing' },
      { name: 'check', bucket: 'pending' },
    ]);
    expect(r.checkSummary).toEqual({ total: 13, passing: 2, failing: 5, skipped_neutral: 2, pending: 4 });

    // since=last-author-comment: cutoff = alice's latest comment (2024-01-02).
    // Items at/before the cutoff are dropped; items without a timestamp are kept.
    expect(r.evidence).toEqual([
      {
        kind: 'review',
        author: 'unknown',
        createdAt: '',
        bodyExcerpt: 'no timestamp, no author',
        actionTerms: [],
        reviewState: 'COMMENTED',
      },
      {
        kind: 'review_comment',
        author: 'frank',
        createdAt: '2024-01-03T00:00:00Z',
        bodyExcerpt: 'quick win: rename',
        actionTerms: ['quick win'],
        path: 'src/a.ts',
        line: 10,
        url: 'u2',
      },
      {
        kind: 'review_comment',
        author: 'frank',
        createdAt: '2024-01-03T01:00:00Z',
        bodyExcerpt: 'outdated',
        actionTerms: [],
        path: 'src/b.ts',
      },
      {
        kind: 'review',
        author: 'dave',
        createdAt: '2024-01-04T00:00:00Z',
        bodyExcerpt: 'Changes requested: nitpick here',
        actionTerms: ['changes requested', 'nitpick'],
        reviewState: 'CHANGES_REQUESTED',
      },
      {
        kind: 'comment',
        author: 'carol',
        createdAt: '2024-01-05T00:00:00Z',
        bodyExcerpt: 'CI is FAILING and the DCO check is missing',
        actionTerms: ['failing', 'dco'],
      },
      {
        kind: 'comment',
        author: 'unknown',
        createdAt: '2024-01-06T00:00:00Z',
        bodyExcerpt: 'ghost',
        actionTerms: [],
      },
    ]);
  });

  test('since=all keeps everything, sorted by createdAt', async () => {
    fake.respond([json(FULL_PAYLOAD)]);
    const r = await prTriage(PR_URL, { cwd: fake.work, since: 'all' });
    expect(r.since).toBe('all');
    expect(r.evidence).toHaveLength(10);
    expect(r.evidence.map((e) => e.createdAt)).toEqual([...r.evidence.map((e) => e.createdAt)].sort());
    const bob = r.evidence.find((e) => e.author === 'bob');
    expect(bob).toEqual({
      kind: 'comment',
      author: 'bob',
      authorAssociation: 'MEMBER',
      createdAt: '2024-01-01T00:00:00Z',
      bodyExcerpt: 'old comment',
      actionTerms: [],
      url: 'u1',
    });
    const erin = r.evidence.find((e) => e.author === 'erin');
    expect(erin?.createdAt).toBe('2024-01-01T06:00:00Z'); // submittedAt fallback
  });

  test('excerpt truncation: 240 default, 80 compact, newlines flattened', async () => {
    const long = 'line one\n' + 'x'.repeat(400);
    fake.respond([json({ comments: [{ createdAt: '2024-01-01T00:00:00Z', body: long }] })]);
    const full = await prTriage(PR_URL, { cwd: fake.work });
    expect(full.evidence[0]!.bodyExcerpt).toHaveLength(240);
    expect(full.evidence[0]!.bodyExcerpt.startsWith('line one x')).toBe(true);
    expect(full.evidence[0]!.bodyExcerpt.endsWith('...')).toBe(true);
    const compact = await prTriage(PR_URL, { cwd: fake.work, compact: true });
    expect(compact.compact).toBe(true);
    expect(compact.evidence[0]!.bodyExcerpt).toHaveLength(80);
  });

  test('empty object payload: minimal status, no checks, no evidence', async () => {
    fake.respond([{ stdout: '{}' }]);
    const r = await prTriage(PR_URL, { cwd: fake.work });
    expect(r.status).toEqual({ draft: false });
    expect(r.checks).toEqual([]);
    expect(r.checkSummary).toEqual({ total: 0, passing: 0, failing: 0, skipped_neutral: 0, pending: 0 });
    expect(r.evidence).toEqual([]);
  });

  test('wrong-typed fields are ignored', async () => {
    fake.respond([
      json({
        title: 5,
        author: { login: 7 },
        state: null,
        isDraft: 'yes',
        statusCheckRollup: { not: 'array' },
        comments: 'nope',
        reviews: null,
        reviewThreads: 3,
      }),
    ]);
    const r = await prTriage(PR_URL, { cwd: fake.work });
    expect(r.status).toEqual({ draft: false });
    expect(r.checks).toEqual([]);
    expect(r.evidence).toEqual([]);
  });

  test('author with no own comments => no cutoff; comments with missing author/body', async () => {
    fake.respond([
      json({
        author: { login: 'alice' },
        comments: [
          { createdAt: '2024-01-01T00:00:00Z' },
          { author: { login: 'bob' }, body: 'no date' },
          { author: { login: 'alice' }, body: 'author, no date' },
        ],
      }),
    ]);
    const r = await prTriage(PR_URL, { cwd: fake.work });
    expect(r.evidence.map((e) => [e.author, e.createdAt, e.bodyExcerpt])).toEqual([
      ['bob', '', 'no date'],
      ['alice', '', 'author, no date'],
      ['unknown', '2024-01-01T00:00:00Z', ''],
    ]);
  });

  test('null author on the PR itself: no status.author, no cutoff', async () => {
    fake.respond([json({ author: null, comments: [{ createdAt: '2024-01-01T00:00:00Z', body: 'x' }] })]);
    const r = await prTriage(PR_URL, { cwd: fake.work });
    expect(r.status).toEqual({ draft: false });
    expect(r.evidence).toHaveLength(1);
  });

  test('defaults cwd to process.cwd() (temp work dir here)', async () => {
    fake.respond([{ stdout: '{}' }]);
    await prTriage('github.com/a/b/pull/3');
    expect(fake.calls()[0]!.cwd).toBe(fake.work);
    expect(fake.onlyArgv()).toEqual(['pr', 'view', '3', '--repo', 'a/b', '--json', FIELDS]);
  });

  test('invalid URL throws before calling gh', async () => {
    const err = await caught(prTriage('not a url'));
    expect(err.code).toBe(ErrorCode.InvalidRequest);
    expect(fake.calls()).toHaveLength(0);
  });
});

describe('prTriage: reviewThreads fallback', () => {
  test('retries with reduced fields and surfaces a warning', async () => {
    fake.respond([
      UNKNOWN_RT,
      json({ ...FULL_PAYLOAD, reviewThreads: undefined }),
    ]);
    const r = await prTriage(PR_URL, { cwd: fake.work, since: 'all' });
    expect(fake.calls().map((c) => c.argv)).toEqual([
      ['pr', 'view', '12', '--repo', 'octo/demo', '--json', FIELDS],
      ['pr', 'view', '12', '--repo', 'octo/demo', '--json', FIELDS_NO_RT],
    ]);
    expect(r.warnings).toEqual([
      {
        code: 'GITHUB_CLI_REVIEW_THREADS_UNSUPPORTED',
        message: 'GitHub CLI does not support reviewThreads; continuing without inline review comments',
      },
    ]);
    expect(r.evidence.some((e) => e.kind === 'review_comment')).toBe(false);
    expect(r.status?.title).toBe('Add feature');
  });

  test('reviewThreads in the fallback payload are ignored', async () => {
    fake.respond([UNKNOWN_RT, json(FULL_PAYLOAD)]);
    const r = await prTriage(PR_URL, { cwd: fake.work, since: 'all' });
    expect(r.evidence.some((e) => e.kind === 'review_comment')).toBe(false);
  });

  test('fallback that also fails -> COMMAND_FAILED', async () => {
    fake.respond([UNKNOWN_RT, { stderr: 'HTTP 502', exit: 1 }]);
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toBe('gh pr view failed: gh exited non-zero: 1');
    expect(err.data).toEqual({ url: PR_URL });
    expect(fake.calls()).toHaveLength(2);
  });

  test('other gh failures do not fall back', async () => {
    fake.respond([{ stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 12.', exit: 1 }]);
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toBe('gh pr view failed: gh exited non-zero: 1');
    expect(fake.calls()).toHaveLength(1);
  });

  test('auth failure does not fall back', async () => {
    fake.respond([{ stderr: 'not logged in', exit: 4 }]);
    await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(fake.calls()).toHaveLength(1);
  });
});

describe('prTriage: bad gh output', () => {
  test('empty output', async () => {
    fake.respond([{ stdout: '  \n' }]);
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.message).toBe('gh pr view failed: gh returned empty output');
    expect(fake.calls()).toHaveLength(1);
  });

  test('non-JSON output', async () => {
    fake.respond([{ stdout: 'hello there' }]);
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.message).toBe('gh pr view failed: gh output is not JSON: hello there');
  });

  test('invalid JSON output', async () => {
    fake.respond([{ stdout: '{"number": 12,' }]);
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message.startsWith('gh pr view failed: gh output is not valid JSON:')).toBe(true);
  });

  test('missing gh binary', async () => {
    process.env.PATH = fake.home; // no gh here
    const err = await caught(prTriage(PR_URL, { cwd: fake.work }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('gh pr view failed:');
  });
});
