/**
 * @fileoverview execGh / execGhText against a hermetic fake gh.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError, ErrorCode } from '@lmctl-ai/lmts/server';

import { execGh, execGhText } from '../src/exec.js';
import { FakeGh } from './helpers/fake-gh.js';

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

describe('execGh', () => {
  test('spawns gh by PATH lookup with argv, cwd and non-interactive env', async () => {
    process.env.GH2_TEST_MARKER = 'inherited';
    fake.respond([{ stdout: '{"ok":true}' }]);
    const out = await execGh<unknown>(['api', 'user'], fake.work);
    expect(out).toEqual({ ok: true });
    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual(['api', 'user']);
    expect(calls[0]!.cwd).toBe(fake.work);
    expect(calls[0]!.env).toEqual({
      GH_PROMPT_DISABLED: '1',
      NO_COLOR: '1',
      HOME: fake.home,
      GH2_TEST_MARKER: 'inherited',
    });
  });

  test('overrides inherited NO_COLOR / GH_PROMPT_DISABLED values', async () => {
    const savedNc = process.env.NO_COLOR;
    const savedGp = process.env.GH_PROMPT_DISABLED;
    process.env.NO_COLOR = '0';
    process.env.GH_PROMPT_DISABLED = '';
    try {
      await execGh<unknown>(['x'], fake.work);
      expect(fake.calls()[0]!.env['NO_COLOR']).toBe('1');
      expect(fake.calls()[0]!.env['GH_PROMPT_DISABLED']).toBe('1');
    } finally {
      if (savedNc === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = savedNc;
      if (savedGp === undefined) delete process.env.GH_PROMPT_DISABLED;
      else process.env.GH_PROMPT_DISABLED = savedGp;
    }
  });

  test('parses JSON arrays (with surrounding whitespace)', async () => {
    fake.respond([{ stdout: '\n  [1, {"a": 2}]  \n' }]);
    expect(await execGh<unknown>(['x'], fake.work)).toEqual([1, { a: 2 }]);
  });

  test('returns undefined for empty / whitespace-only stdout', async () => {
    fake.respond([{ stdout: '   \n' }]);
    expect(await execGh<unknown>(['x'], fake.work)).toBeUndefined();
    fake.respond([]);
    expect(await execGh<unknown>(['x'], fake.work)).toBeUndefined();
  });

  test('returns trimmed raw text for non-JSON stdout', async () => {
    fake.respond([{ stdout: '  hello world\n' }]);
    expect(await execGh<unknown>(['x'], fake.work)).toBe('hello world');
  });

  test('returns raw text when stdout looks like JSON but is invalid', async () => {
    fake.respond([{ stdout: '{not json' }]);
    expect(await execGh<unknown>(['x'], fake.work)).toBe('{not json');
    fake.respond([{ stdout: '[1,2' }]);
    expect(await execGh<unknown>(['x'], fake.work)).toBe('[1,2');
  });

  test('auth failure maps to FORBIDDEN with detail', async () => {
    fake.respond([{ stderr: 'To get started with GitHub CLI, please run:  gh auth login\nnot logged in to any hosts', exit: 4 }]);
    const err = await caught(execGh(['api', 'user'], fake.work));
    expect(err.code).toBe(ErrorCode.Forbidden);
    expect(err.exitCode).toBe(6);
    expect(err.message).toBe('gh authentication failed. Run "gh auth login" first.');
    expect(String(err.data?.['detail'])).toContain('not logged in');
  });

  test('HTTP 401 maps to FORBIDDEN', async () => {
    fake.respond([{ stderr: 'gh: Bad credentials (HTTP 401)', exit: 1 }]);
    expect((await caught(execGh(['api', 'user'], fake.work))).code).toBe(ErrorCode.Forbidden);
  });

  test('not found maps to COMMAND_FAILED carrying stderr', async () => {
    fake.respond([{ stderr: 'gh: Not Found (HTTP 404)', exit: 1 }]);
    const err = await caught(execGh(['api', 'repos/o/r'], fake.work));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain('Not Found (HTTP 404)');
    expect(err.message).toContain('Exit Code: 1');
  });

  test('rate limit maps to COMMAND_FAILED', async () => {
    fake.respond([{ stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)', exit: 1 }]);
    const err = await caught(execGh(['api', 'user'], fake.work));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toContain('rate limit exceeded');
  });

  test('timeout text maps to TIMEOUT', async () => {
    fake.respond([{ stderr: 'request timed out', exit: 1 }]);
    const err = await caught(execGh(['x'], fake.work));
    expect(err.code).toBe(ErrorCode.Timeout);
    expect(err.exitCode).toBe(7);
  });

  test('"command not found" text maps to COMMAND_NOT_FOUND', async () => {
    fake.respond([{ stderr: 'sh: gh-ext: command not found', exit: 127 }]);
    const err = await caught(execGh(['x'], fake.work));
    expect(err.code).toBe(ErrorCode.CommandNotFound);
    expect(err.exitCode).toBe(127);
    expect(err.message).toContain('gh CLI not found');
  });

  test('missing gh binary (empty PATH) surfaces COMMAND_FAILED from Bun.spawn', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gh2-empty-'));
    process.env.PATH = empty;
    try {
      const err = await caught(execGh(['x'], fake.work));
      // Bun reports 'Executable not found in $PATH: "gh"', which does not match
      // the ENOENT/command-not-found pattern, so it is a generic failure.
      expect(err.code).toBe(ErrorCode.CommandFailed);
      expect(err.message).toContain('not found');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(fake.calls()).toHaveLength(0);
  });

  test('allowNonZeroExit returns parsed stdout instead of throwing', async () => {
    fake.respond([{ stdout: '{"partial":1}', stderr: 'warn', exit: 2 }]);
    expect(await execGh<unknown>(['x'], fake.work, { allowNonZeroExit: true })).toEqual({ partial: 1 });
  });
});

describe('execGhText', () => {
  test('returns trimmed text without JSON parsing', async () => {
    fake.respond([{ stdout: '  {"a":1}\n' }]);
    expect(await execGhText(['x'], fake.work)).toBe('{"a":1}');
    expect(fake.calls()[0]!.env['GH_PROMPT_DISABLED']).toBe('1');
    expect(fake.calls()[0]!.env['NO_COLOR']).toBe('1');
  });

  test('empty stdout yields empty string', async () => {
    expect(await execGhText(['x'], fake.work)).toBe('');
  });

  test('non-zero exit throws mapped error (no allowNonZeroExit)', async () => {
    fake.respond([{ stderr: 'HTTP 401: Unauthorized', exit: 1 }]);
    expect((await caught(execGhText(['x'], fake.work))).code).toBe(ErrorCode.Forbidden);
  });

  test('allowNonZeroExit still throws CommandFailed with argv/stderr/stdout data', async () => {
    fake.respond([{ stdout: 'out', stderr: 'Unknown JSON field: "reviewThreads"', exit: 1 }]);
    const err = await caught(execGhText(['pr', 'view'], fake.work, { allowNonZeroExit: true }));
    expect(err.code).toBe(ErrorCode.CommandFailed);
    expect(err.message).toBe('gh exited non-zero: 1');
    expect(err.data).toEqual({
      argv: ['pr', 'view'],
      stderr: 'Unknown JSON field: "reviewThreads"',
      stdout: 'out',
    });
  });

  test('allowNonZeroExit with zero exit returns text', async () => {
    fake.respond([{ stdout: 'fine\n' }]);
    expect(await execGhText(['x'], fake.work, { allowNonZeroExit: true })).toBe('fine');
  });
});
