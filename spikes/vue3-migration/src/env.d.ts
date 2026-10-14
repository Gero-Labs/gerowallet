declare const __PILOT_TARGET__: string;
interface PilotSnapshot { revision: number; locked: boolean; wallet: string; network: string; approvals: number }
interface PilotMessage { namespace?: string; type: string; state?: PilotSnapshot; revision?: number; amount?: number }
interface PilotResponse { ok: boolean; state?: PilotSnapshot; reason?: string }
