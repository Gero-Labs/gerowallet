// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import { execPath } from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { eslintEntry, eslintStdinArgs, lintStaged } from './precommit-lint.mjs';

describe('eslintEntry', () => {
  it("is ESLint's own JS entry, not the npx/.cmd shim Node 22 refuses to spawn", () => {
    const entry = eslintEntry();
    expect(entry.split(sep).slice(-3).join('/')).toBe('eslint/bin/eslint.js');
    expect(existsSync(entry)).toBe(true);
  });

  it('reads a string `bin` too', () => {
    const require = Object.assign((p) => (p.endsWith('package.json') ? { bin: './cli.js' } : undefined), {
      resolve: () => '/x/node_modules/eslint/package.json',
    });
    expect(eslintEntry(require).split(sep).slice(-3).join('/')).toBe('node_modules/eslint/cli.js');
  });
});

describe('eslintStdinArgs', () => {
  it('names the entry first and lints the index blob under the staged path', () => {
    expect(eslintStdinArgs('/x/eslint.js', 'src/a.ts')).toEqual([
      '/x/eslint.js', '--stdin', '--stdin-filename', 'src/a.ts', '--no-warn-ignored',
    ]);
  });
});

describe('lintStaged', () => {
  const blob = (file) => Buffer.from(`// ${file}`);
  const exitStatus = (status) => Object.assign(new Error(`exit ${status}`), { status });
  const spawnFailure = (code) => Object.assign(new Error(code), { code });

  it('is clean when every file lints', () => {
    const runEslint = vi.fn();
    expect(lintStaged(['a.ts', 'b.ts'], { indexContent: blob, runEslint })).toBe('clean');
    expect(runEslint).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a file with errors so every offender is shown', () => {
    const runEslint = vi.fn((file) => {
      if (file === 'a.ts') throw exitStatus(1);
    });
    expect(lintStaged(['a.ts', 'b.ts'], { indexContent: blob, runEslint })).toBe('errors');
    expect(runEslint.mock.calls.map(([file]) => file)).toEqual(['a.ts', 'b.ts']);
  });

  it.each(['EINVAL', 'ENOENT', 'EACCES'])('stops and says so when ESLint cannot start (%s)', (code) => {
    const report = vi.fn();
    const runEslint = vi.fn(() => { throw spawnFailure(code); });
    expect(lintStaged(['a.ts', 'b.ts'], { indexContent: blob, runEslint, report })).toBe('cannot-run');
    expect(runEslint).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining(code));
  });

  it('skips a path the index cannot show', () => {
    const runEslint = vi.fn();
    const indexContent = (file) => {
      if (file === 'gone.ts') throw new Error('fatal: path not in index');
      return blob(file);
    };
    expect(lintStaged(['gone.ts', 'b.ts'], { indexContent, runEslint })).toBe('clean');
    expect(runEslint.mock.calls.map(([file]) => file)).toEqual(['b.ts']);
  });
});

// The regression itself: spawn ESLint exactly as the hook does, on the Node
// running this suite (CI pins 22; `execPath` comes from node:process because
// vitest's worker leaves the global process.execPath undefined). Before the
// fix this threw EINVAL on Windows
// before ESLint ever started, and the hook reported nothing.
describe('spawning ESLint on this Node', () => {
  const run = (file, input) => {
    try {
      execFileSync(execPath, eslintStdinArgs(eslintEntry(), file), { input, stdio: 'pipe' });
      return { status: 0, output: '' };
    } catch (err) {
      return { status: err.status, code: err.code, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('reports a staged `any` as a lint error, with output', { timeout: 60_000 }, () => {
    const result = run('src/precommit-lint.probe.ts', 'export const probe: any = 1;\n');
    expect(result.code).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-explicit-any');
  });

  it('passes clean content', { timeout: 60_000 }, () => {
    expect(run('src/precommit-lint.probe.ts', 'export const probe = 1;\n')).toEqual({ status: 0, output: '' });
  });
});
