/**
 * @fileoverview Port of lmctl-ai/lmprobe `pr_triage.rs` — normalize a GitHub pull
 * request URL, fetch status/checks/reviews via `gh pr view --json`, emit
 * triage evidence. Preserves the reviewThreads fallback (older/newer gh
 * builds may not support that field).
 * @module gh2/pr-triage
 */

import { CliError, ErrorCode } from '@lmctl-ai/lmts/server';

import { execGh } from './exec.js';

const GH_FIELDS =
  'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews,reviewThreads';
const GH_FIELDS_NO_REVIEW_THREADS =
  'number,url,title,state,isDraft,mergeable,reviewDecision,author,statusCheckRollup,comments,reviews';

const ACTION_TERMS = [
  'changes requested',
  'failed',
  'failing',
  'error',
  'dco',
  'cla',
  'template',
  'nitpick',
  'quick win',
  'does not verify',
  'would still pass',
] as const;

export interface PrTriageTarget {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface PrTriageStatus {
  title?: string;
  author?: string;
  state?: string;
  mergeable?: string;
  reviewDecision?: string;
  draft: boolean;
}

export interface PrCheckEvidence {
  name: string;
  status?: string;
  conclusion?: string;
  state?: string;
  bucket: 'failing' | 'passing' | 'skipped_neutral' | 'pending';
  url?: string;
}

export interface PrCheckSummary {
  total: number;
  passing: number;
  failing: number;
  skipped_neutral: number;
  pending: number;
}

export interface PrReviewEvidence {
  kind: 'comment' | 'review' | 'review_comment';
  author: string;
  authorAssociation?: string;
  createdAt: string;
  bodyExcerpt: string;
  actionTerms: string[];
  reviewState?: string;
  path?: string;
  line?: number;
  url?: string;
}

export interface PrTriageResult {
  target: PrTriageTarget;
  since: 'last-author-comment' | 'all';
  compact: boolean;
  exitStatus: 'matched' | 'error';
  status?: PrTriageStatus;
  checks: PrCheckEvidence[];
  checkSummary: PrCheckSummary;
  evidence: PrReviewEvidence[];
  warnings: Array<{ code: string; message: string; hint?: string }>;
}

export interface PrTriageOptions {
  since?: 'last-author-comment' | 'all';
  compact?: boolean;
  cwd?: string;
}

/** Parse https://github.com/owner/repo/pull/N (with optional scheme/www/query). */
export function parseGitHubPrUrl(input: string): PrTriageTarget {
  const trimmed = input.trim();
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const withoutWww = withoutScheme.replace(/^www\./i, '');
  const path = withoutWww.startsWith('github.com/')
    ? withoutWww.slice('github.com/'.length)
    : undefined;
  if (path === undefined) {
    throw new CliError(
      ErrorCode.InvalidRequest,
      'expected GitHub pull request URL: https://github.com/<owner>/<repo>/pull/<number>',
      { url: input },
    );
  }
  const noQuery = path.split(/[?#]/)[0] ?? path;
  const parts = noQuery.replace(/\/+$/, '').split('/');
  if (parts.length !== 4 || parts[2] !== 'pull') {
    throw new CliError(
      ErrorCode.InvalidRequest,
      'expected GitHub pull request URL: https://github.com/<owner>/<repo>/pull/<number>',
      { url: input, parts },
    );
  }
  const number = Number(parts[3]);
  if (!Number.isInteger(number) || number <= 0) {
    throw new CliError(ErrorCode.InvalidRequest, 'pull request number must be a positive integer', {
      url: input,
      number: parts[3],
    });
  }
  const [owner, repo] = parts as [string, string, string, string];
  return {
    owner,
    repo,
    number,
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  };
}

function truncate(input: string, limit: number): string {
  const out = input.trim().replace(/\n/g, ' ');
  if (out.length <= limit) return out;
  return out.slice(0, Math.max(0, limit - 3)) + '...';
}

function stringField(v: unknown, key: string): string | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const x = (v as Record<string, unknown>)[key];
  return typeof x === 'string' ? x : undefined;
}

function boolField(v: unknown, key: string): boolean {
  if (v === null || typeof v !== 'object') return false;
  return (v as Record<string, unknown>)[key] === true;
}

function checkBucket(status?: string, conclusion?: string, state?: string): PrCheckEvidence['bucket'] {
  const c = (conclusion ?? '').toLowerCase();
  const s = (status ?? '').toLowerCase();
  const st = (state ?? '').toLowerCase();
  if (
    ['failure', 'failed', 'timed_out', 'timed out', 'action_required', 'cancelled'].includes(c) ||
    ['failure', 'error', 'failed'].includes(st)
  ) {
    return 'failing';
  }
  if (c === 'success' || st === 'success') return 'passing';
  if (c === 'neutral' || c === 'skipped') return 'skipped_neutral';
  if (['queued', 'in_progress', 'requested', 'pending'].includes(s) || ['pending', 'expected'].includes(st)) {
    return 'pending';
  }
  return 'pending';
}

function actionTerms(body: string): string[] {
  const lower = body.toLowerCase();
  return ACTION_TERMS.filter((t) => lower.includes(t));
}

function lastAuthorCommentAt(payload: Record<string, unknown>): string | undefined {
  const author = (payload['author'] as Record<string, unknown> | undefined)?.['login'];
  if (typeof author !== 'string') return undefined;
  const comments = payload['comments'];
  if (!Array.isArray(comments)) return undefined;
  let best: string | undefined;
  for (const c of comments) {
    const login = (c as Record<string, unknown>)?.['author'] as Record<string, unknown> | undefined;
    const createdAt = (c as Record<string, unknown>)?.['createdAt'];
    if (
      login?.['login'] === author &&
      typeof createdAt === 'string' &&
      (best === undefined || createdAt > best)
    ) {
      best = createdAt;
    }
  }
  return best;
}

export async function prTriage(url: string, options: PrTriageOptions = {}): Promise<PrTriageResult> {
  const opts = { since: options.since ?? 'last-author-comment', compact: options.compact ?? false };
  const target = parseGitHubPrUrl(url);
  const warnings: PrTriageResult['warnings'] = [];
  const cwd = options.cwd ?? process.cwd();

  const fetchPr = async (
    fields: string,
  ): Promise<
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: string; stderr?: string }
  > => {
    const args = [
      'pr', 'view', String(target.number),
      '--repo', `${target.owner}/${target.repo}`,
      '--json', fields,
    ];
    const { execGhText } = await import('./exec.js');
    try {
      // Use execGhText to distinguish "gh returned empty/invalid" from
      // "gh returned valid JSON that happens to be an empty object".
      const text = await execGhText(args, cwd, { allowNonZeroExit: true });
      const trimmed = text.trim();
      if (trimmed === '') {
        return { ok: false, error: 'gh returned empty output' };
      }
      const first = trimmed[0];
      if (first !== '{' && first !== '[') {
        return { ok: false, error: `gh output is not JSON: ${trimmed.slice(0, 200)}` };
      }
      try {
        return { ok: true, data: JSON.parse(trimmed) as Record<string, unknown> };
      } catch (err) {
        return { ok: false, error: `gh output is not valid JSON: ${String(err)}` };
      }
    } catch (error) {
      const err = error as { code?: string; message?: string; data?: { stderr?: string } };
      return {
        ok: false,
        error: err.message ?? String(error),
        ...(err.data?.stderr !== undefined ? { stderr: err.data.stderr } : {}),
      };
    }
  };

  // First attempt includes reviewThreads; fall back if gh doesn't support it.
  let includeReviewThreads = true;
  let fetched = await fetchPr(GH_FIELDS);
  const errText = (fetched.ok === false ? `${fetched.error}\n${fetched.stderr ?? ''}` : '');
  if (!fetched.ok && errText.includes('Unknown JSON field: "reviewThreads"')) {
    warnings.push({
      code: 'GITHUB_CLI_REVIEW_THREADS_UNSUPPORTED',
      message: 'GitHub CLI does not support reviewThreads; continuing without inline review comments',
    });
    includeReviewThreads = false;
    fetched = await fetchPr(GH_FIELDS_NO_REVIEW_THREADS);
  }
  if (!fetched.ok) {
    throw new CliError(ErrorCode.CommandFailed, `gh pr view failed: ${fetched.error}`, {
      url: target.url,
    });
  }
  const payload = fetched.data;

  const status: PrTriageStatus = {
    ...(stringField(payload, 'title') !== undefined ? { title: stringField(payload, 'title') } : {}),
    ...((() => {
      const a = payload['author'] as Record<string, unknown> | undefined;
      const login = a?.['login'];
      return typeof login === 'string' ? { author: login } : {};
    })()),
    ...(stringField(payload, 'state') !== undefined ? { state: stringField(payload, 'state') } : {}),
    ...(stringField(payload, 'mergeable') !== undefined ? { mergeable: stringField(payload, 'mergeable') } : {}),
    ...(stringField(payload, 'reviewDecision') !== undefined
      ? { reviewDecision: stringField(payload, 'reviewDecision') }
      : {}),
    draft: boolField(payload, 'isDraft'),
  };

  const checksRaw = Array.isArray(payload['statusCheckRollup'])
    ? (payload['statusCheckRollup'] as Array<Record<string, unknown>>)
    : [];
  const checks: PrCheckEvidence[] = checksRaw.map((c) => {
    const status_ = stringField(c, 'status');
    const conclusion = stringField(c, 'conclusion');
    const state = stringField(c, 'state');
    return {
      name: stringField(c, 'name') ?? stringField(c, 'context') ?? 'check',
      ...(status_ !== undefined ? { status: status_ } : {}),
      ...(conclusion !== undefined ? { conclusion } : {}),
      ...(state !== undefined ? { state } : {}),
      bucket: checkBucket(status_, conclusion, state),
      ...(stringField(c, 'detailsUrl') !== undefined
        ? { url: stringField(c, 'detailsUrl') }
        : stringField(c, 'targetUrl') !== undefined
          ? { url: stringField(c, 'targetUrl') }
          : {}),
    };
  });

  const checkSummary: PrCheckSummary = {
    total: checks.length,
    passing: 0,
    failing: 0,
    skipped_neutral: 0,
    pending: 0,
  };
  for (const c of checks) {
    if (c.bucket === 'passing') checkSummary.passing++;
    else if (c.bucket === 'failing') checkSummary.failing++;
    else if (c.bucket === 'skipped_neutral') checkSummary.skipped_neutral++;
    else checkSummary.pending++;
  }

  const cutoff = opts.since === 'last-author-comment' ? lastAuthorCommentAt(payload) : undefined;
  const evidence: PrReviewEvidence[] = [];
  const excerpt = opts.compact ? 80 : 240;

  const pushEvent = (
    kind: PrReviewEvidence['kind'],
    item: Record<string, unknown>,
    reviewState?: string,
    path?: string,
    line?: number,
  ): void => {
    const createdAt =
      stringField(item, 'createdAt') ?? stringField(item, 'submittedAt') ?? '';
    if (cutoff !== undefined && createdAt !== '' && createdAt <= cutoff) return;
    const body = stringField(item, 'body') ?? '';
    const author = (() => {
      const a = item['author'] as Record<string, unknown> | undefined;
      const login = a?.['login'];
      return typeof login === 'string' ? login : 'unknown';
    })();
    evidence.push({
      kind,
      author,
      ...(stringField(item, 'authorAssociation') !== undefined
        ? { authorAssociation: stringField(item, 'authorAssociation') }
        : {}),
      createdAt,
      bodyExcerpt: truncate(body, excerpt),
      actionTerms: actionTerms(body),
      ...(reviewState !== undefined ? { reviewState } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(stringField(item, 'url') !== undefined ? { url: stringField(item, 'url') } : {}),
    });
  };

  for (const c of (Array.isArray(payload['comments']) ? payload['comments'] : []) as Array<Record<string, unknown>>) {
    pushEvent('comment', c);
  }
  for (const r of (Array.isArray(payload['reviews']) ? payload['reviews'] : []) as Array<Record<string, unknown>>) {
    pushEvent('review', r, stringField(r, 'state'));
  }
  if (includeReviewThreads) {
    for (const t of (Array.isArray(payload['reviewThreads']) ? payload['reviewThreads'] : []) as Array<Record<string, unknown>>) {
      const comments = Array.isArray(t['comments']) ? (t['comments'] as Array<Record<string, unknown>>) : [];
      for (const c of comments) {
        pushEvent(
          'review_comment',
          c,
          undefined,
          stringField(c, 'path'),
          typeof c['line'] === 'number' ? (c['line'] as number) : undefined,
        );
      }
    }
  }
  evidence.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    target,
    since: opts.since,
    compact: opts.compact,
    exitStatus: 'matched',
    status,
    checks,
    checkSummary,
    evidence,
    warnings,
  };
}
