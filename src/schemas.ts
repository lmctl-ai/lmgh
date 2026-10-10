/**
 * @fileoverview Declarative input schemas for all gh2 operations.
 * @module gh2/schemas
 */

import type { OperationSchema } from '@lmctl-ai/lmts';

const ownerParam = {
  name: 'owner',
  type: 'string' as const,
  description: 'Repository owner',
};

const repoParam = {
  name: 'repo',
  type: 'string' as const,
  description: 'Repository name',
};

export const GET_COMMIT_HISTORY_SCHEMA: OperationSchema = {
  name: 'get_commit_history',
  access: 'read',
  description: 'Commit history for a repository',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'limit',
      type: 'number',
      occurs: '?',
      default: 30,
      description: 'Max commits (default 30)',
    },
  ],
};

export const LIST_REPOSITORIES_SCHEMA: OperationSchema = {
  name: 'list_repositories',
  access: 'read',
  description: 'List repositories for the authenticated user',
  params: [
    {
      name: 'visibility',
      type: 'string',
      occurs: '?',
      enum: ['all', 'public', 'private'],
      description: 'Filter by visibility (all|public|private)',
    },
  ],
};

export const SEARCH_REPOSITORIES_SCHEMA: OperationSchema = {
  name: 'search_repositories',
  access: 'read',
  description: 'Search repositories on GitHub',
  params: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query',
    },
    {
      name: 'limit',
      type: 'number',
      occurs: '?',
      default: 10,
      description: 'Max results (default 10)',
    },
  ],
};

export const GET_REPOSITORY_SCHEMA: OperationSchema = {
  name: 'get_repository',
  access: 'read',
  description: 'Detailed repository information',
  params: [ownerParam, repoParam],
};

export const CREATE_REPOSITORY_SCHEMA: OperationSchema = {
  name: 'create_repository',
  access: 'write',
  description: 'Create a repository (org or @me)',
  params: [
    {
      name: 'owner',
      type: 'string',
      description: "Org name, or '@me' for the authenticated user",
    },
    repoParam,
    {
      name: 'private',
      type: 'boolean',
      occurs: '?',
      default: true,
      description: 'Private repository (default true)',
    },
    {
      name: 'description',
      type: 'string',
      occurs: '?',
      description: 'Repository description',
    },
  ],
};

export const LIST_BRANCHES_SCHEMA: OperationSchema = {
  name: 'list_branches',
  access: 'read',
  description: 'List branches in a repository',
  params: [ownerParam, repoParam],
};

export const CREATE_BRANCH_SCHEMA: OperationSchema = {
  name: 'create_branch',
  access: 'write',
  description: 'Create a branch from another branch',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'branchName',
      type: 'string',
      description: 'New branch name',
    },
    {
      name: 'fromBranch',
      type: 'string',
      occurs: '?',
      default: 'main',
      description: 'Source branch (default: main)',
    },
  ],
};

export const GET_FILE_CONTENTS_SCHEMA: OperationSchema = {
  name: 'get_file_contents',
  access: 'read',
  description: 'Fetch file contents (base64-decoded)',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'path',
      type: 'string',
      description: 'File path in repo',
    },
    {
      name: 'branch',
      type: 'string',
      occurs: '?',
      description: 'Branch/ref (optional)',
    },
  ],
};

export const LIST_ISSUES_SCHEMA: OperationSchema = {
  name: 'list_issues',
  access: 'read',
  description: 'List issues in a repository',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'state',
      type: 'string',
      occurs: '?',
      enum: ['open', 'closed', 'all'],
      default: 'open',
      description: 'Filter by state (open|closed|all)',
    },
  ],
};

export const GET_ISSUE_SCHEMA: OperationSchema = {
  name: 'get_issue',
  access: 'read',
  description: 'Get issue details',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'issueNumber',
      type: 'number',
      description: 'Issue number',
    },
  ],
};

export const CREATE_ISSUE_SCHEMA: OperationSchema = {
  name: 'create_issue',
  access: 'write',
  description: 'Create an issue',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'title',
      type: 'string',
      description: 'Issue title',
    },
    {
      name: 'body',
      type: 'string',
      occurs: '?',
      description: 'Issue body',
    },
  ],
};

export const CLOSE_ISSUE_SCHEMA: OperationSchema = {
  name: 'close_issue',
  access: 'write',
  description: 'Close an issue',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'issueNumber',
      type: 'number',
      description: 'Issue number',
    },
  ],
};

export const COMMENT_ON_ISSUE_SCHEMA: OperationSchema = {
  name: 'comment_on_issue',
  access: 'write',
  description: 'Add a comment to an issue',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'issueNumber',
      type: 'number',
      description: 'Issue number',
    },
    {
      name: 'body',
      type: 'string',
      description: 'Comment body',
    },
  ],
};

export const EDIT_ISSUE_SCHEMA: OperationSchema = {
  name: 'edit_issue',
  access: 'write',
  description: 'Edit issue title/body',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'issueNumber',
      type: 'number',
      description: 'Issue number',
    },
    {
      name: 'title',
      type: 'string',
      occurs: '?',
      description: 'New title',
    },
    {
      name: 'body',
      type: 'string',
      occurs: '?',
      description: 'New body',
    },
  ],
};

export const LIST_PULL_REQUESTS_SCHEMA: OperationSchema = {
  name: 'list_pull_requests',
  access: 'read',
  description: 'List pull requests',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'state',
      type: 'string',
      occurs: '?',
      enum: ['open', 'closed', 'all', 'merged', 'draft'],
      default: 'open',
      description: 'Filter by state',
    },
  ],
};

export const GET_PULL_REQUEST_SCHEMA: OperationSchema = {
  name: 'get_pull_request',
  access: 'read',
  description: 'Get pull request details',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'prNumber',
      type: 'number',
      description: 'PR number',
    },
  ],
};

export const CREATE_PULL_REQUEST_SCHEMA: OperationSchema = {
  name: 'create_pull_request',
  access: 'write',
  description: 'Create a pull request',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'title',
      type: 'string',
      description: 'PR title',
    },
    {
      name: 'head',
      type: 'string',
      description: 'Head branch',
    },
    {
      name: 'base',
      type: 'string',
      description: 'Base branch',
    },
    {
      name: 'body',
      type: 'string',
      occurs: '?',
      description: 'PR body',
    },
  ],
};

export const MERGE_PULL_REQUEST_SCHEMA: OperationSchema = {
  name: 'merge_pull_request',
  access: 'write',
  description: 'Merge a pull request',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'prNumber',
      type: 'number',
      description: 'PR number',
    },
    {
      name: 'mergeMethod',
      type: 'string',
      occurs: '?',
      enum: ['merge', 'squash', 'rebase'],
      description: 'Merge method (merge|squash|rebase)',
    },
  ],
};

export const CLOSE_PULL_REQUEST_SCHEMA: OperationSchema = {
  name: 'close_pull_request',
  access: 'write',
  description: 'Close a pull request',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'prNumber',
      type: 'number',
      description: 'PR number',
    },
  ],
};

export const COMMENT_ON_PULL_REQUEST_SCHEMA: OperationSchema = {
  name: 'comment_on_pull_request',
  access: 'write',
  description: 'Comment on a pull request',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'prNumber',
      type: 'number',
      description: 'PR number',
    },
    {
      name: 'body',
      type: 'string',
      description: 'Comment body',
    },
  ],
};

export const LIST_WORKFLOWS_SCHEMA: OperationSchema = {
  name: 'list_workflows',
  access: 'read',
  description: 'List workflows in a repository',
  params: [ownerParam, repoParam],
};

export const LIST_WORKFLOW_RUNS_SCHEMA: OperationSchema = {
  name: 'list_workflow_runs',
  access: 'read',
  description: 'List workflow runs',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'workflowId',
      type: 'string',
      occurs: '?',
      description: 'Filter by workflow',
    },
    {
      name: 'status',
      type: 'string',
      occurs: '?',
      description: 'Filter by status',
    },
  ],
};

export const GET_WORKFLOW_RUN_SCHEMA: OperationSchema = {
  name: 'get_workflow_run',
  access: 'read',
  description: 'Get workflow run details',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'runId',
      type: 'number',
      description: 'Workflow run ID',
    },
  ],
};

export const LIST_RELEASES_SCHEMA: OperationSchema = {
  name: 'list_releases',
  access: 'read',
  description: 'List releases',
  params: [ownerParam, repoParam],
};

export const GET_RELEASE_SCHEMA: OperationSchema = {
  name: 'get_release',
  access: 'read',
  description: 'Get release details',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'tag',
      type: 'string',
      description: 'Release tag',
    },
  ],
};

export const CREATE_RELEASE_SCHEMA: OperationSchema = {
  name: 'create_release',
  access: 'write',
  description: 'Create a release',
  params: [
    ownerParam,
    repoParam,
    {
      name: 'tag',
      type: 'string',
      description: 'Release tag',
    },
    {
      name: 'title',
      type: 'string',
      occurs: '?',
      description: 'Release title',
    },
    {
      name: 'notes',
      type: 'string',
      occurs: '?',
      description: 'Release notes',
    },
    {
      name: 'draft',
      type: 'boolean',
      occurs: '?',
      description: 'Create as draft',
    },
    {
      name: 'prerelease',
      type: 'boolean',
      occurs: '?',
      description: 'Mark as prerelease',
    },
  ],
};

export const GET_ME_SCHEMA: OperationSchema = {
  name: 'get_me',
  access: 'read',
  description: 'Get authenticated user details',
  params: [],
};

export const PR_TRIAGE_SCHEMA: OperationSchema = {
  name: 'pr_triage',
  access: 'read',
  description:
    'Triage a GitHub PR: normalize its URL, fetch status/checks/reviews via gh, emit evidence',
  params: [
    {
      name: 'url',
      type: 'string',
      description: 'Full GitHub PR URL: https://github.com/<owner>/<repo>/pull/<number>',
    },
    {
      name: 'since',
      type: 'string',
      occurs: '?',
      enum: ['last-author-comment', 'all'],
      default: 'last-author-comment',
      description: 'Evidence window',
    },
    {
      name: 'compact',
      type: 'boolean',
      occurs: '?',
      default: false,
      description: 'Truncate evidence excerpts to 80 chars',
    },
  ],
};

export const ALL_GH2_SCHEMAS: OperationSchema[] = [
  GET_COMMIT_HISTORY_SCHEMA,
  LIST_REPOSITORIES_SCHEMA,
  SEARCH_REPOSITORIES_SCHEMA,
  GET_REPOSITORY_SCHEMA,
  CREATE_REPOSITORY_SCHEMA,
  LIST_BRANCHES_SCHEMA,
  CREATE_BRANCH_SCHEMA,
  GET_FILE_CONTENTS_SCHEMA,
  LIST_ISSUES_SCHEMA,
  GET_ISSUE_SCHEMA,
  CREATE_ISSUE_SCHEMA,
  CLOSE_ISSUE_SCHEMA,
  COMMENT_ON_ISSUE_SCHEMA,
  EDIT_ISSUE_SCHEMA,
  LIST_PULL_REQUESTS_SCHEMA,
  GET_PULL_REQUEST_SCHEMA,
  CREATE_PULL_REQUEST_SCHEMA,
  MERGE_PULL_REQUEST_SCHEMA,
  CLOSE_PULL_REQUEST_SCHEMA,
  COMMENT_ON_PULL_REQUEST_SCHEMA,
  LIST_WORKFLOWS_SCHEMA,
  LIST_WORKFLOW_RUNS_SCHEMA,
  GET_WORKFLOW_RUN_SCHEMA,
  LIST_RELEASES_SCHEMA,
  GET_RELEASE_SCHEMA,
  CREATE_RELEASE_SCHEMA,
  GET_ME_SCHEMA,
  PR_TRIAGE_SCHEMA,
];
