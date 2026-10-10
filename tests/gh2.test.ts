/**
 * @fileoverview Tests for gh2: policy behavior and read-only/dry-run
 * semantics. Live gh calls are avoided in unit tests; behavior is verified
 * through dry-run command construction and policy errors.
 */

import { describe, expect, test } from 'bun:test';

import { ErrorCode, isDryRunResult } from '@lmctl-ai/lmts/server';

import { Gh2 } from '../src/api.js';

describe('policy: dry-run', () => {
  test('write ops are simulated and return the resolved gh command', async () => {
    const gh = new Gh2({ policy: { dryRun: true } });
    const result = await gh.createIssue({
      owner: 'octocat',
      repo: 'Hello-World',
      title: 'demo',
      body: 'hello',
    });
    expect(isDryRunResult(result)).toBe(true);
    const cmd = (result as { command?: string[] }).command;
    expect(cmd?.[0]).toBe('gh');
    expect(cmd).toContain('issue');
    expect(cmd).toContain('create');
    expect(cmd).toContain('--title');
    expect(cmd).toContain('demo');
  });

  test('create_branch dry-run does not resolve the source SHA', async () => {
    const gh = new Gh2({ policy: { dryRun: true } });
    const result = await gh.createBranch({
      owner: 'octocat',
      repo: 'Hello-World',
      branchName: 'f1',
      fromBranch: 'main',
    });
    expect(isDryRunResult(result)).toBe(true);
    // If it had executed, it would have hit the network to resolve the SHA.
  });
});

describe('policy: read-only', () => {
  test('write ops throw ReadOnlyViolation', async () => {
    const gh = new Gh2({ policy: { readOnly: true } });
    await expect(
      gh.mergePullRequest({ owner: 'o', repo: 'r', prNumber: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.ReadOnlyViolation });
    await expect(
      gh.createRelease({ owner: 'o', repo: 'r', tag: 'v1' }),
    ).rejects.toMatchObject({ code: ErrorCode.ReadOnlyViolation });
  });
});
