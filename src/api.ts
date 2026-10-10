/**
 * @fileoverview gh2 operations — 26 GitHub operations migrated from the Java
 * gh_mcp_server (GithubService.java). Every read operation requests --json
 * (or --jq where the upstream tool did), so results are structured by
 * construction.
 * @module gh2/api
 */

import { checkPolicy, isDryRunResult, type Access, type DryRunResult, type Policy } from '@lmctl-ai/lmts/server';

import { execGh, execGhText } from './exec.js';

export interface Gh2Options {
  policy?: Partial<Policy>;
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Default branch for createBranch when fromBranch is omitted. */
  defaultBranch?: string;
}

export class Gh2 {
  readonly policy: Policy;
  readonly cwd: string;
  readonly defaultBranch: string;

  constructor(options: Gh2Options = {}) {
    this.policy = {
      dryRun: options.policy?.dryRun ?? false,
      readOnly: options.policy?.readOnly ?? false,
    };
    this.cwd = options.cwd ?? process.cwd();
    this.defaultBranch = options.defaultBranch ?? 'main';
  }

  private guard(access: Access, name: string, command: string[]): DryRunResult | undefined {
    return checkPolicy(access, this.policy, {
      name,
      command: ['gh', ...command],
    });
  }

  // ----------------------------------------------------------------------
  // Repository operations
  // ----------------------------------------------------------------------

  async getCommitHistory(input: { owner: string; repo: string; limit?: number }) {
    const limit = input.limit && input.limit > 0 ? input.limit : 30;
    const args = [
      'api',
      `repos/${input.owner}/${input.repo}/commits`,
      '--jq',
      `.[:${limit}] | [.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]`,
    ];
    this.guard('read', 'get_commit_history', args);
    return execGh(args, this.cwd);
  }

  async listRepositories(input: { visibility?: 'all' | 'public' | 'private' } = {}) {
    const args = ['repo', 'list'];
    if (input.visibility) {
      args.push('--visibility', input.visibility);
    }
    args.push('--json', 'name,owner,description,isPrivate,url,updatedAt');
    this.guard('read', 'list_repositories', args);
    return execGh(args, this.cwd);
  }

  async searchRepositories(input: { query: string; limit?: number }) {
    const limit = Math.max(input.limit ?? 0, 10);
    const args = [
      'search', 'repos', input.query,
      '--json', 'name,owner,description,url,stargazersCount',
      '--limit', String(limit),
    ];
    this.guard('read', 'search_repositories', args);
    return execGh(args, this.cwd);
  }

  async createRepository(input: {
    owner: string;
    repo: string;
    private?: boolean;
    description?: string;
  }) {
    // Org repos go through the REST org endpoint; user repos use /user/repos.
    const endpoint =
      input.owner === '@me' || input.owner === ''
        ? 'user/repos'
        : `orgs/${input.owner}/repos`;
    const args = [
      'api', endpoint,
      '--method', 'POST',
      '--field', `name=${input.repo}`,
      '--field', `private=${input.private === false ? 'false' : 'true'}`,
      '--jq',
      '{fullName: .full_name, url: .html_url, private: .private, defaultBranch: .default_branch}',
    ];
    if (input.description) {
      args.push('--field', `description=${input.description}`);
    }
    const simulated = this.guard('write', 'create_repository', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    return execGh(args, this.cwd);
  }

  async getRepository(input: { owner: string; repo: string }) {
    const args = [
      'repo', 'view', `${input.owner}/${input.repo}`,
      '--json',
      'name,description,owner,isPrivate,defaultBranchRef,primaryLanguage,repositoryTopics,stargazerCount,forkCount,createdAt,updatedAt,url',
    ];
    this.guard('read', 'get_repository', args);
    return execGh(args, this.cwd);
  }

  async listBranches(input: { owner: string; repo: string }) {
    const args = ['api', `repos/${input.owner}/${input.repo}/branches`];
    this.guard('read', 'list_branches', args);
    return execGh(args, this.cwd);
  }

  async createBranch(input: {
    owner: string;
    repo: string;
    branchName: string;
    fromBranch?: string;
  }) {
    const source = input.fromBranch ?? this.defaultBranch;
    const simulated = this.guard('write', 'create_branch', [
      'api', `repos/${input.owner}/${input.repo}/git/refs`,
      '--method', 'POST',
      '--field', `ref=refs/heads/${input.branchName}`,
    ]);
    if (simulated && isDryRunResult(simulated)) return simulated;

    // Resolve the source branch SHA first.
    const sha = await execGhText(
      ['api', `repos/${input.owner}/${input.repo}/git/ref/heads/${source}`, '--jq', '.object.sha'],
      this.cwd,
    );
    if (!sha || sha.startsWith('Error:')) {
      throw new Error(`Failed to resolve SHA for branch "${source}": ${sha}`);
    }

    const args = [
      'api', `repos/${input.owner}/${input.repo}/git/refs`,
      '--method', 'POST',
      '--field', `ref=refs/heads/${input.branchName}`,
      '--field', `sha=${sha.trim()}`,
    ];
    return execGh(args, this.cwd);
  }

  async getFileContents(input: { owner: string; repo: string; path: string; branch?: string }) {
    let endpoint = `repos/${input.owner}/${input.repo}/contents/${input.path}`;
    if (input.branch) {
      endpoint += `?ref=${encodeURIComponent(input.branch)}`;
    }
    const args = ['api', endpoint, '--jq', '.content | @base64d'];
    this.guard('read', 'get_file_contents', args);
    return execGhText(args, this.cwd);
  }

  // ----------------------------------------------------------------------
  // Issue operations
  // ----------------------------------------------------------------------

  async listIssues(input: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' }) {
    const args = [
      'issue', 'list',
      '--repo', `${input.owner}/${input.repo}`,
      '--state', input.state ?? 'open',
      '--json', 'number,title,state,createdAt,author,body,labels,assignees,url',
    ];
    this.guard('read', 'list_issues', args);
    return execGh(args, this.cwd);
  }

  async getIssue(input: { owner: string; repo: string; issueNumber: number }) {
    const args = [
      'issue', 'view', String(input.issueNumber),
      '--repo', `${input.owner}/${input.repo}`,
      '--json', 'number,title,state,createdAt,author,body,labels,assignees,comments,url',
    ];
    this.guard('read', 'get_issue', args);
    return execGh(args, this.cwd);
  }

  async createIssue(input: { owner: string; repo: string; title: string; body?: string }) {
    const args = ['issue', 'create', '--repo', `${input.owner}/${input.repo}`, '--title', input.title];
    if (input.body && input.body.trim()) {
      args.push('--body', input.body);
    }
    const simulated = this.guard('write', 'create_issue', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  async closeIssue(input: { owner: string; repo: string; issueNumber: number }) {
    const args = ['issue', 'close', String(input.issueNumber), '--repo', `${input.owner}/${input.repo}`];
    const simulated = this.guard('write', 'close_issue', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  async commentOnIssue(input: { owner: string; repo: string; issueNumber: number; body: string }) {
    const args = [
      'issue', 'comment', String(input.issueNumber),
      '--repo', `${input.owner}/${input.repo}`,
      '--body', input.body,
    ];
    const simulated = this.guard('write', 'comment_on_issue', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  async editIssue(input: { owner: string; repo: string; issueNumber: number; title?: string; body?: string }) {
    const args = ['issue', 'edit', String(input.issueNumber), '--repo', `${input.owner}/${input.repo}`];
    if (input.title) args.push('--title', input.title);
    if (input.body) args.push('--body', input.body);
    const simulated = this.guard('write', 'edit_issue', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  // ----------------------------------------------------------------------
  // Pull request operations
  // ----------------------------------------------------------------------

  async listPullRequests(input: { owner: string; repo: string; state?: 'open' | 'closed' | 'all' | 'merged' | 'draft' }) {
    const args = [
      'pr', 'list',
      '--repo', `${input.owner}/${input.repo}`,
      '--state', input.state ?? 'open',
      '--json', 'number,title,state,createdAt,author,headRefName,baseRefName,url',
    ];
    this.guard('read', 'list_pull_requests', args);
    return execGh(args, this.cwd);
  }

  async getPullRequest(input: { owner: string; repo: string; prNumber: number }) {
    const args = [
      'pr', 'view', String(input.prNumber),
      '--repo', `${input.owner}/${input.repo}`,
      '--json', 'number,title,state,createdAt,author,body,headRefName,baseRefName,mergeable,url',
    ];
    this.guard('read', 'get_pull_request', args);
    return execGh(args, this.cwd);
  }

  async createPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    head: string;
    base: string;
  }) {
    const args = [
      'pr', 'create',
      '--repo', `${input.owner}/${input.repo}`,
      '--title', input.title,
      '--head', input.head,
      '--base', input.base,
    ];
    if (input.body && input.body.trim()) {
      args.push('--body', input.body);
    }
    const simulated = this.guard('write', 'create_pull_request', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  async mergePullRequest(input: {
    owner: string;
    repo: string;
    prNumber: number;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
  }) {
    const method = (input.mergeMethod ?? 'merge').toLowerCase();
    const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge';
    const args = ['pr', 'merge', String(input.prNumber), '--repo', `${input.owner}/${input.repo}`, flag];
    const simulated = this.guard('write', 'merge_pull_request', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const out = await execGhText(args, this.cwd);
    return { success: true, output: out };
  }

  async closePullRequest(input: { owner: string; repo: string; prNumber: number }) {
    const args = ['pr', 'close', String(input.prNumber), '--repo', `${input.owner}/${input.repo}`];
    const simulated = this.guard('write', 'close_pull_request', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  async commentOnPullRequest(input: { owner: string; repo: string; prNumber: number; body: string }) {
    const args = [
      'pr', 'comment', String(input.prNumber),
      '--repo', `${input.owner}/${input.repo}`,
      '--body', input.body,
    ];
    const simulated = this.guard('write', 'comment_on_pull_request', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  // ----------------------------------------------------------------------
  // Workflow / Actions operations
  // ----------------------------------------------------------------------

  async listWorkflows(input: { owner: string; repo: string }) {
    const args = ['workflow', 'list', '--repo', `${input.owner}/${input.repo}`, '--json', 'name,state,id,path'];
    this.guard('read', 'list_workflows', args);
    return execGh(args, this.cwd);
  }

  async listWorkflowRuns(input: { owner: string; repo: string; workflowId?: string; status?: string }) {
    const args = ['run', 'list', '--repo', `${input.owner}/${input.repo}`];
    if (input.workflowId) args.push('--workflow', input.workflowId);
    if (input.status) args.push('--status', input.status);
    args.push('--json', 'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt');
    this.guard('read', 'list_workflow_runs', args);
    return execGh(args, this.cwd);
  }

  async getWorkflowRun(input: { owner: string; repo: string; runId: number }) {
    const args = [
      'run', 'view', String(input.runId),
      '--repo', `${input.owner}/${input.repo}`,
      '--json',
      'databaseId,name,displayTitle,status,conclusion,workflowName,headBranch,createdAt,updatedAt,url',
    ];
    this.guard('read', 'get_workflow_run', args);
    return execGh(args, this.cwd);
  }

  // ----------------------------------------------------------------------
  // Release operations
  // ----------------------------------------------------------------------

  async listReleases(input: { owner: string; repo: string }) {
    const args = [
      'release', 'list',
      '--repo', `${input.owner}/${input.repo}`,
      '--json', 'tagName,name,createdAt,publishedAt,isDraft,isPrerelease,isLatest',
    ];
    this.guard('read', 'list_releases', args);
    return execGh(args, this.cwd);
  }

  async getRelease(input: { owner: string; repo: string; tag: string }) {
    const args = [
      'release', 'view', input.tag,
      '--repo', `${input.owner}/${input.repo}`,
      '--json', 'tagName,name,body,createdAt,publishedAt,isDraft,isPrerelease,author,assets,url',
    ];
    this.guard('read', 'get_release', args);
    return execGh(args, this.cwd);
  }

  async createRelease(input: {
    owner: string;
    repo: string;
    tag: string;
    title?: string;
    notes?: string;
    draft?: boolean;
    prerelease?: boolean;
  }) {
    const args = ['release', 'create', input.tag, '--repo', `${input.owner}/${input.repo}`];
    if (input.title) args.push('--title', input.title);
    if (input.notes) args.push('--notes', input.notes);
    if (input.draft) args.push('--draft');
    if (input.prerelease) args.push('--prerelease');
    const simulated = this.guard('write', 'create_release', args);
    if (simulated && isDryRunResult(simulated)) return simulated;
    const url = await execGhText(args, this.cwd);
    return { success: true, url };
  }

  // ----------------------------------------------------------------------
  // User operations
  // ----------------------------------------------------------------------

  async getMe() {
    const args = ['api', 'user'];
    this.guard('read', 'get_me', args);
    return execGh(args, this.cwd);
  }
}
