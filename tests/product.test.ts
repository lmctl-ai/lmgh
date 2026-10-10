/**
 * @fileoverview Hermetic tests for product compatibility checking in gh2.
 * Verifies that gh2 enforces its product range (gh >=2.45.0 <3.0.0),
 * accepts tested versions, rejects incompatible/missing binaries with exit 10,
 * runs --schema/--list/--help unconditionally, and caches version detection.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const CLI_PATH = resolve(REPO_ROOT, 'src/cli.ts');

const REAL_GH_VERSION_OUTPUT = `gh version 2.45.0 (2025-07-18 Ubuntu 2.45.0-1ubuntu0.3)
https://github.com/cli/cli/releases/tag/v2.45.0
`;
const GH_PATTERN = 'gh version (\\d+\\.\\d+\\.\\d+)';
const SUPPORTED_RANGE = '>=2.45.0 <3.0.0';

describe('gh2 product compatibility', () => {
  let tempBinDir: string;
  let counterFile: string;

  beforeEach(() => {
    tempBinDir = mkdtempSync(join(tmpdir(), 'gh2-product-test-'));
    counterFile = join(tempBinDir, 'call-count.txt');
  });

  afterEach(() => {
    rmSync(tempBinDir, { recursive: true, force: true });
  });

  function createFakeGh(output: string, exitCode = 0, trackCount = false) {
    const ghPath = join(tempBinDir, 'gh');
    const countSnippet = trackCount ? `echo "call" >> "${counterFile}"` : '';
    const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  ${countSnippet}
  cat <<'EOF'
${output}
EOF
  exit ${exitCode}
fi

# Fallback JSON output for any other gh command
echo '{"login":"testuser"}'
exit 0
`;
    writeFileSync(ghPath, script);
    chmodSync(ghPath, 0o755);
  }

  function runGh2(args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${tempBinDir}:/usr/bin:/bin`,
        ...extraEnv,
      },
    });
  }

  test('verified: REAL gh --version output matches pattern and satisfies range', () => {
    const match = REAL_GH_VERSION_OUTPUT.match(new RegExp(GH_PATTERN));
    expect(match).not.toBeNull();
    expect(match![1]).toBe('2.45.0');

    createFakeGh(REAL_GH_VERSION_OUTPUT);
    const proc = runGh2(['get_me']);
    expect(proc.status).toBe(0);
  });

  test('supported version (>=2.45.0 <3.0.0) allows operation to run', () => {
    createFakeGh('gh version 2.50.0 (2025-08-01)\n');
    const proc = runGh2(['get_me']);
    expect(proc.status).toBe(0);
  });

  test('too old version (<2.45.0) refuses operation with exit 10 and UNSUPPORTED_PRODUCT_VERSION', () => {
    createFakeGh('gh version 2.44.0\n');
    const proc = runGh2(['get_me']);
    expect(proc.status).toBe(10);

    const payload = JSON.parse(proc.stdout);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('UNSUPPORTED_PRODUCT_VERSION');
    expect(payload.error.data).toEqual({
      product: 'gh',
      found: '2.44.0',
      supported: SUPPORTED_RANGE,
    });
  });

  test('too new version (>=3.0.0) refuses operation with exit 10 and UNSUPPORTED_PRODUCT_VERSION', () => {
    createFakeGh('gh version 3.0.0\n');
    const proc = runGh2(['get_me']);
    expect(proc.status).toBe(10);

    const payload = JSON.parse(proc.stdout);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('UNSUPPORTED_PRODUCT_VERSION');
    expect(payload.error.data).toEqual({
      product: 'gh',
      found: '3.0.0',
      supported: SUPPORTED_RANGE,
    });
  });

  test('garbage/unparseable output refuses operation with exit 10 and found: null', () => {
    createFakeGh('gh version unknown-string-without-semver\n');
    const proc = runGh2(['get_me']);
    expect(proc.status).toBe(10);

    const payload = JSON.parse(proc.stdout);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('UNSUPPORTED_PRODUCT_VERSION');
    expect(payload.error.data).toEqual({
      product: 'gh',
      found: null,
      supported: SUPPORTED_RANGE,
    });
  });

  test('missing gh binary on isolated PATH refuses operation with exit 10 and found: null', () => {
    // Isolated PATH containing only an empty directory
    const proc = spawnSync(process.execPath, [CLI_PATH, 'get_me'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: tempBinDir, // no gh binary in here
      },
    });

    expect(proc.status).toBe(10);
    const payload = JSON.parse(proc.stdout);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('UNSUPPORTED_PRODUCT_VERSION');
    expect(payload.error.data).toEqual({
      product: 'gh',
      found: null,
      supported: SUPPORTED_RANGE,
    });
  });

  test('--schema, --list, and --help succeed regardless of product version check', () => {
    // Set up an incompatible gh version that would fail any operation
    createFakeGh('gh version 1.9.0\n');

    const schemaProc = runGh2(['--schema']);
    expect(schemaProc.status).toBe(0);
    const schemaDoc = JSON.parse(schemaProc.stdout);
    expect(schemaDoc.tool).toBe('gh2');
    expect(schemaDoc.product).toBeDefined();
    expect(schemaDoc.product.name).toBe('gh');
    expect(schemaDoc.product.supported).toBe(SUPPORTED_RANGE);

    const listProc = runGh2(['--list']);
    expect(listProc.status).toBe(0);
    expect(listProc.stdout).toContain('get_me');

    const helpProc = runGh2(['--help']);
    expect(helpProc.status).toBe(0);
    expect(helpProc.stdout).toContain('Structured GitHub CLI');
  });

  test('version detection command is spawned only once per process', () => {
    createFakeGh(REAL_GH_VERSION_OUTPUT, 0, true);

    const productJson = JSON.stringify({
      name: 'gh',
      supported: SUPPORTED_RANGE,
      detect: {
        argv: ['gh', '--version'],
        pattern: GH_PATTERN,
      },
    });

    const testScript = `
import { checkProductVersion } from '@lmctl-ai/lmts/server';
const product = ${productJson};
const res1 = await checkProductVersion(product);
const res2 = await checkProductVersion(product);
if (!res1.ok || !res2.ok) {
  console.error('res1:', res1, 'res2:', res2);
  process.exit(1);
}
process.exit(0);
`;
    const res = spawnSync(process.execPath, ['-e', testScript], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${tempBinDir}:/usr/bin:/bin`,
      },
    });

    expect(res.status).toBe(0);
    const countData = readFileSync(counterFile, 'utf-8');
    const count = countData.trim().split('\n').filter(Boolean).length;
    expect(count).toBe(1);
  });
});
