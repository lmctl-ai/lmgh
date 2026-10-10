/**
 * @fileoverview gh CLI execution for gh2. Uses the shared spawnCommand from
 * @lmctl-ai/lmts/server with gh-appropriate environment and error mapping.
 * @module gh2/exec
 */

import { CliError, ErrorCode, spawnCommand } from '@lmctl-ai/lmts/server';

const GH_COMMAND_TIMEOUT_MS = 60000;

function buildGhEnv(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GH_PROMPT_DISABLED: '1', // never prompt interactively
    NO_COLOR: '1',
  };
}

function mapGhError(error: unknown): never {
  if (error instanceof CliError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (/command not found|ENOENT|spawn gh/i.test(message)) {
    throw new CliError(
      ErrorCode.CommandNotFound,
      'gh CLI not found. Install it from https://cli.github.com/ and authenticate with "gh auth login".',
      undefined,
      { cause: error },
    );
  }
  if (/not logged in|authentication|Unauthorized|401/.test(message)) {
    throw new CliError(
      ErrorCode.Forbidden,
      'gh authentication failed. Run "gh auth login" first.',
      { detail: message },
      { cause: error },
    );
  }
  if (/timed out|timeout/i.test(message)) {
    throw new CliError(ErrorCode.Timeout, message, undefined, { cause: error });
  }
  throw new CliError(ErrorCode.CommandFailed, message, undefined, { cause: error });
}

export interface ExecGhOptions {
  allowNonZeroExit?: boolean;
}

/**
 * Execute a gh command. Returns parsed stdout when it looks like JSON,
 * otherwise the raw text. Throws CliError on failure.
 */
export async function execGh<T = unknown>(
  args: string[],
  cwd: string,
  options: ExecGhOptions = {},
): Promise<T> {
  try {
    const result = await spawnCommand(
      'gh',
      args,
      cwd,
      buildGhEnv(),
      GH_COMMAND_TIMEOUT_MS,
      undefined,
      options.allowNonZeroExit,
    );
    return parseMaybeJson<T>(result.stdout);
  } catch (error) {
    mapGhError(error);
  }
}

/** Parse stdout as JSON when possible; return raw text otherwise. */
function parseMaybeJson<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (trimmed === '') return undefined as T;
  const first = trimmed[0];
  if (first === '{' || first === '[') {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // fall through and return raw text
    }
  }
  return trimmed as T;
}

/**
 * Run a gh command and return the raw text (no JSON parsing).
 *
 * `allowNonZeroExit` only suppresses the throw on process exit; it does not
 * change the semantics that callers still need error detail. When gh exits
 * non-zero, a CliError is thrown carrying stderr/stdout in `data` so retry
 * logic (e.g. the reviewThreads fallback in pr_triage) can branch on it.
 */
export async function execGhText(
  args: string[],
  cwd: string,
  options: ExecGhOptions = {},
): Promise<string> {
  try {
    const result = await spawnCommand(
      'gh',
      args,
      cwd,
      buildGhEnv(),
      GH_COMMAND_TIMEOUT_MS,
      undefined,
      options.allowNonZeroExit,
    );
    if (result.exitCode !== 0) {
      throw new CliError(
        ErrorCode.CommandFailed,
        `gh exited non-zero: ${result.exitCode}`,
        { argv: args, stderr: result.stderr, stdout: result.stdout },
      );
    }
    return result.stdout.trim();
  } catch (error) {
    mapGhError(error);
  }
}
