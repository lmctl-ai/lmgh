#!/usr/bin/env bun
/**
 * @fileoverview gh2 CLI entry point.
 *
 * Usage:
 *   gh2 <operation> [options]
 *
 * All operations return structured JSON to stdout. Reads use the gh CLI's
 * --json output; writes return {success, url|output} envelopes.
 * @module gh2/cli
 */

import { runCli, type OpDef, type Policy } from '@lmctl-ai/lmts/server';
import { readFileSync } from 'node:fs';

import { Gh2 } from './api.js';
import { prTriage } from './pr-triage.js';
import { ALL_GH2_SCHEMAS } from './schemas.js';

interface Gh2Ctx {
  gh: Gh2;
}

const schemaMap = new Map(ALL_GH2_SCHEMAS.map((s) => [s.name, s]));

type Runner<P> = (gh: Gh2, p: P) => Promise<unknown>;

function op<P>(
  name: string,
  access: 'read' | 'write',
  description: string,
  run: Runner<P>,
  _params: Record<string, string> = {},
): OpDef<Gh2Ctx> {
  const inputSchema = schemaMap.get(name);
  return {
    name,
    access,
    description: inputSchema?.description ?? description,
    inputSchema,
    run: async (p, ctx) => run(ctx.gh, p as unknown as P),
  };
}

const repoParams = {
  owner: 'Repository owner (required)',
  repo: 'Repository name (required)',
};

function makeOps(): OpDef<Gh2Ctx>[] {
  return [
    // ---- Repository ----
    op('get_commit_history', 'read', 'Commit history for a repository',
      (gh, p: { owner: string; repo: string; limit?: number }) => gh.getCommitHistory(p),
      { ...repoParams, limit: 'Max commits (default 30)' }),
    op('list_repositories', 'read', 'List repositories for the authenticated user',
      (gh, p: { visibility?: 'all' | 'public' | 'private' }) => gh.listRepositories(p),
      { visibility: 'all|public|private' }),
    op('search_repositories', 'read', 'Search repositories on GitHub',
      (gh, p: { query: string; limit?: number }) => gh.searchRepositories(p),
      { query: 'Search query (required)', limit: 'Max results (default 10)' }),
    op('get_repository', 'read', 'Detailed repository information',
      (gh, p: { owner: string; repo: string }) => gh.getRepository(p), repoParams),
    op('create_repository', 'write', 'Create a repository (org or @me)',
      (gh, p: { owner: string; repo: string; private?: boolean; description?: string }) =>
        gh.createRepository(p),
      { owner: "Org name, or '@me' for the authenticated user (required)", repo: 'Repository name (required)', private: 'Private (default true)', description: 'Description' }),
    op('list_branches', 'read', 'List branches in a repository',
      (gh, p: { owner: string; repo: string }) => gh.listBranches(p), repoParams),
    op('create_branch', 'write', 'Create a branch from another branch',
      (gh, p: { owner: string; repo: string; branchName: string; fromBranch?: string }) => gh.createBranch(p),
      { ...repoParams, branchName: 'New branch name (required)', fromBranch: 'Source branch (default: main)' }),
    op('get_file_contents', 'read', 'Fetch file contents (base64-decoded)',
      (gh, p: { owner: string; repo: string; path: string; branch?: string }) => gh.getFileContents(p),
      { ...repoParams, path: 'File path in repo (required)', branch: 'Branch/ref (optional)' }),

    // ---- Issues ----
    op('list_issues', 'read', 'List issues in a repository',
      (gh, p: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' }) => gh.listIssues(p),
      { ...repoParams, state: 'open|closed|all (default open)' }),
    op('get_issue', 'read', 'Get issue details',
      (gh, p: { owner: string; repo: string; issueNumber: number }) => gh.getIssue(p),
      { ...repoParams, issueNumber: 'Issue number (required)' }),
    op('create_issue', 'write', 'Create an issue',
      (gh, p: { owner: string; repo: string; title: string; body?: string }) => gh.createIssue(p),
      { ...repoParams, title: 'Issue title (required)', body: 'Issue body' }),
    op('close_issue', 'write', 'Close an issue',
      (gh, p: { owner: string; repo: string; issueNumber: number }) => gh.closeIssue(p),
      { ...repoParams, issueNumber: 'Issue number (required)' }),
    op('comment_on_issue', 'write', 'Add a comment to an issue',
      (gh, p: { owner: string; repo: string; issueNumber: number; body: string }) => gh.commentOnIssue(p),
      { ...repoParams, issueNumber: 'Issue number (required)', body: 'Comment body (required)' }),
    op('edit_issue', 'write', 'Edit issue title/body',
      (gh, p: { owner: string; repo: string; issueNumber: number; title?: string; body?: string }) => gh.editIssue(p),
      { ...repoParams, issueNumber: 'Issue number (required)', title: 'New title', body: 'New body' }),

    // ---- Pull requests ----
    op('list_pull_requests', 'read', 'List pull requests',
      (gh, p: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' | 'merged' | 'draft' }) =>
        gh.listPullRequests(p),
      { ...repoParams, state: 'open|closed|all|merged|draft' }),
    op('get_pull_request', 'read', 'Get pull request details',
      (gh, p: { owner: string; repo: string; prNumber: number }) => gh.getPullRequest(p),
      { ...repoParams, prNumber: 'PR number (required)' }),
    op('create_pull_request', 'write', 'Create a pull request',
      (gh, p: { owner: string; repo: string; title: string; body?: string; head: string; base: string }) =>
        gh.createPullRequest(p),
      { ...repoParams, title: 'PR title (required)', body: 'PR body', head: 'Head branch (required)', base: 'Base branch (required)' }),
    op('merge_pull_request', 'write', 'Merge a pull request',
      (gh, p: { owner: string; repo: string; prNumber: number; mergeMethod?: 'merge' | 'squash' | 'rebase' }) =>
        gh.mergePullRequest(p),
      { ...repoParams, prNumber: 'PR number (required)', mergeMethod: 'merge|squash|rebase' }),
    op('close_pull_request', 'write', 'Close a pull request',
      (gh, p: { owner: string; repo: string; prNumber: number }) => gh.closePullRequest(p),
      { ...repoParams, prNumber: 'PR number (required)' }),
    op('comment_on_pull_request', 'write', 'Comment on a pull request',
      (gh, p: { owner: string; repo: string; prNumber: number; body: string }) => gh.commentOnPullRequest(p),
      { ...repoParams, prNumber: 'PR number (required)', body: 'Comment body (required)' }),

    // ---- Workflows ----
    op('list_workflows', 'read', 'List workflows in a repository',
      (gh, p: { owner: string; repo: string }) => gh.listWorkflows(p), repoParams),
    op('list_workflow_runs', 'read', 'List workflow runs',
      (gh, p: { owner: string; repo: string; workflowId?: string; status?: string }) => gh.listWorkflowRuns(p),
      { ...repoParams, workflowId: 'Filter by workflow', status: 'Filter by status' }),
    op('get_workflow_run', 'read', 'Get workflow run details',
      (gh, p: { owner: string; repo: string; runId: number }) => gh.getWorkflowRun(p),
      { ...repoParams, runId: 'Workflow run ID (required)' }),

    // ---- Releases ----
    op('list_releases', 'read', 'List releases',
      (gh, p: { owner: string; repo: string }) => gh.listReleases(p), repoParams),
    op('get_release', 'read', 'Get release details',
      (gh, p: { owner: string; repo: string; tag: string }) => gh.getRelease(p),
      { ...repoParams, tag: 'Release tag (required)' }),
    op('create_release', 'write', 'Create a release',
      (gh, p: { owner: string; repo: string; tag: string; title?: string; notes?: string; draft?: boolean; prerelease?: boolean }) =>
        gh.createRelease(p),
      { ...repoParams, tag: 'Release tag (required)', title: 'Release title', notes: 'Release notes', draft: 'Create as draft', prerelease: 'Mark as prerelease' }),

    // ---- User ----
    op('get_me', 'read', 'Get authenticated user details', (gh) => gh.getMe()),

    // ---- lmprobe-ported ops ----
    {
      name: 'pr_triage',
      access: 'read',
      description:
        'Triage a GitHub PR: normalize its URL, fetch status/checks/reviews via gh, emit evidence (ported from lmprobe pr-triage)',
      inputSchema: schemaMap.get('pr_triage'),
      run: async (p) => {
        if (typeof p['url'] !== 'string') {
          throw new Error('--url is required (full GitHub PR URL)');
        }
        return prTriage(p['url'], {
          since: p['since'] === 'all' ? 'all' : 'last-author-comment',
          compact: p['compact'] === true,
        });
      },
    },
  ];
}

async function main(): Promise<number> {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version?: string };
  return runCli<Gh2Ctx>(
    {
      toolName: 'gh2',
      version: pkg.version ?? 'unknown',
      description:
        'Structured GitHub CLI wrapping the gh binary, with dry-run and read-only policy enforcement.',
      ops: makeOps(),
      buildContext: (policy: Policy): Gh2Ctx => ({ gh: new Gh2({ policy }) }),
    },
    process.argv.slice(2),
  );
}

void main().then((code) => process.exit(code));
