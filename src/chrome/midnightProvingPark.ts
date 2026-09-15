/**
 * "Proof server needed": park a dApp proof whose server does not answer.
 *
 * On Gero Cloud a dApp proof falls back to the network's default local URL
 * (see resolveDappProvingTarget); when nothing listens there the user only
 * ever saw the dApp's own "deposit failed". This module keeps the proof
 * waiting, asks the panel (retry / cancel), and re-runs the same op when
 * the user has started a server. One prompt per site: concurrent circuits
 * of one transaction share it and retry together.
 *
 * Chrome-free: the health check, the panel prompt and the clock are injected.
 */

import type { DappProvingTarget } from '@/chains/midnight/midnightProvingTarget';

/** How long a proof may wait for a server, from its first failure. A Docker image pull takes minutes. */
export const DAPP_PROVING_PARK_MS = 600_000;

export type ParkAnswer = 'retry' | 'cancel';

export interface ProvingParkPayload {
  website: string;
  url: string;
  source: DappProvingTarget['source'];
  /** The prover client's own error text or the failed health URL. Never a payload. */
  detail: string;
  attempt: number;
}

export interface ProvingParkContext {
  origin: string;
  tabId: number;
  target: DappProvingTarget;
}

export interface ParkDeps {
  preflight(target: DappProvingTarget): Promise<boolean>;
  prompt(ctx: ProvingParkContext, payload: ProvingParkPayload): Promise<ParkAnswer>;
  isUnreachable(error: unknown): boolean;
  now(): number;
}

/** The user cancelled, the wait expired, or the tab closed. `message` is the last failure detail. */
export class ProvingParkCancelled extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ProvingParkCancelled';
  }
}

interface OpenPrompt {
  promise: Promise<ParkAnswer>;
  cancel: () => void;
  tabId: number;
}

export class ProvingPark {
  private readonly prompts = new Map<string, OpenPrompt>();

  constructor(private readonly deps: ParkDeps) {}

  async run<T>(ctx: ProvingParkContext, op: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let firstFailureAt: number | undefined;
    for (;;) {
      let detail: string;
      if (!(await this.deps.preflight(ctx.target))) {
        detail = `no answer from ${ctx.target.url}/health`;
      } else {
        try {
          return await op();
        } catch (error) {
          if (!this.deps.isUnreachable(error)) throw error;
          detail = error instanceof Error ? error.message : String(error);
        }
      }
      attempt += 1;
      firstFailureAt ??= this.deps.now();
      if (this.deps.now() - firstFailureAt > DAPP_PROVING_PARK_MS) throw new ProvingParkCancelled(detail);
      const answer = await this.ask(ctx, { website: ctx.origin, url: ctx.target.url, source: ctx.target.source, detail, attempt });
      if (answer === 'cancel') throw new ProvingParkCancelled(detail);
    }
  }

  /** Cancel whatever prompt is parked for a closed tab. */
  cancelTab(tabId: number): void {
    for (const [origin, open] of [...this.prompts]) {
      if (open.tabId !== tabId) continue;
      this.prompts.delete(origin);
      open.cancel();
    }
  }

  private ask(ctx: ProvingParkContext, payload: ProvingParkPayload): Promise<ParkAnswer> {
    const existing = this.prompts.get(ctx.origin);
    if (existing) return existing.promise;
    let cancel: () => void = () => undefined;
    const cancelled = new Promise<ParkAnswer>((resolve) => { cancel = () => resolve('cancel'); });
    const answered = this.deps.prompt(ctx, payload).catch((): ParkAnswer => 'cancel');
    const open: OpenPrompt = { promise: Promise.race([answered, cancelled]), cancel, tabId: ctx.tabId };
    open.promise = open.promise.finally(() => {
      if (this.prompts.get(ctx.origin) === open) this.prompts.delete(ctx.origin);
    });
    this.prompts.set(ctx.origin, open);
    return open.promise;
  }
}
