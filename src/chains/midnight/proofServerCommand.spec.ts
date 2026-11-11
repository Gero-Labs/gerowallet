import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { Network } from '@/models/types';
import { PROOF_SERVER_DOCKER_COMMAND, midnightProofServerCommand } from './midnightConfig';

/**
 * The proof server command the wallet tells users to copy. Verbose mode writes
 * request contents, including private transaction inputs, to the container log,
 * so no suggested command may turn it on.
 */

/** Every network the Settings → Proof server page can be opened on, plus "no wallet". */
const NETWORKS: Array<string | undefined> = [Network.MAINNET, Network.PREPROD, Network.STAGENET, 'midnight-stagenet', undefined];

/** Built from parts so this file does not match its own guard. */
const VERBOSE_FLAG = new RegExp(['midnight-proof-server', '\\s+(?:-v|--verbose)\\b'].join(''));
const VERBOSE_ENV = new RegExp(['MIDNIGHT_PROOF_SERVER', '_VERBOSE'].join(''));

describe('suggested proof server command', () => {
  it.each(NETWORKS.map((n) => [String(n), n]))('has no verbose flag for %s', (_label, network) => {
    const command = midnightProofServerCommand(network);
    expect(command).not.toMatch(/(?:^|\s)-v(?:\s|$)/);
    expect(command).not.toContain('--verbose');
    expect(command).not.toMatch(VERBOSE_ENV);
    expect(command).toMatch(/midnight-proof-server$/);
  });

  it.each(NETWORKS.map((n) => [String(n), n]))('removes the container on stop and binds loopback for %s', (_label, network) => {
    const command = midnightProofServerCommand(network);
    expect(command).toContain('docker run --rm ');
    expect(command).toMatch(/-p 127\.0\.0\.1:\d+:6300 /);
  });

  it('shows the remote signing dialog the same command Settings shows for Mainnet and Preprod', () => {
    // Cross-Device Proving serves from the ledger-8 server (localProverProfile.ts).
    expect(PROOF_SERVER_DOCKER_COMMAND).toBe(midnightProofServerCommand(Network.MAINNET));
    expect(PROOF_SERVER_DOCKER_COMMAND).toBe(midnightProofServerCommand(Network.PREPROD));
    expect(PROOF_SERVER_DOCKER_COMMAND).not.toMatch(/(?:^|\s)-v(?:\s|$)/);
  });
});

describe('verbose proof server guard', () => {
  const ROOT = resolve(__dirname, '../../..');
  const SCANNED = ['src', 'scripts', 'docs'];
  const TEXT = new Set(['.ts', '.vue', '.js', '.mjs', '.cjs', '.json', '.md', '.html', '.yml', '.yaml', '.sh', '.css', '.scss', '.txt']);

  function textFiles(dir: string): string[] {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return []; }
    return entries.flatMap((name) => {
      if (name === 'node_modules' || name.startsWith('.')) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return textFiles(path);
      return TEXT.has(extname(name)) ? [path] : [];
    });
  }

  it('finds no verbose proof server command in src, scripts, docs or the top-level docs', () => {
    const files = [
      ...SCANNED.flatMap((d) => textFiles(join(ROOT, d))),
      ...readdirSync(ROOT).filter((n) => n.endsWith('.md')).map((n) => join(ROOT, n)),
    ];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return VERBOSE_FLAG.test(text) || VERBOSE_ENV.test(text);
    }).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
