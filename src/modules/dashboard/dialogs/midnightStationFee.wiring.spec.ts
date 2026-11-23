import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires: both send surfaces offer Gero's fee station through the one
// shared composable and component, and route a station-paid send through the
// station pipeline, never through the DUST-balancing one. Behaviour is tested in
// useMidnightStationFee.spec.ts, MidnightStationFeeNote.spec.ts and
// midnightStationSend.service.spec.ts.
const src = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');

describe('fee station on the Midnight send surfaces', () => {
  it.each([
    ['dashboard dialog', 'modules/dashboard/dialogs/MidnightSendDialog.vue'],
    ['side panel sheet', 'sidepanel/components/flows/MidnightSendSheet.vue'],
  ])('%s: shared state, shared note, station pipeline', (_name, path) => {
    const file = read(path);
    expect(file).toContain("import { useMidnightStationFee } from '@/shared/composables/useMidnightStationFee';");
    expect(file.split('useMidnightStationFee({').length - 1).toBe(1);
    expect(file.split('<MidnightStationFeeNote').length - 1).toBe(1);
    expect(file).toContain(':use-station="!stationOptedOut"');
    // The choice is captured when the send starts, and decides the pipeline.
    expect(file).toContain("const viaStation = feeSource.value === 'station';");
    expect(file).toMatch(/viaStation\s*\?\s*await sendUnshieldedViaStation\(/);
    // The station never pays a shielded send: where a surface has that path, it does not mention the station.
    const start = file.indexOf('async function sendShielded(');
    if (start >= 0) {
      const shielded = file.slice(start);
      expect(shielded.slice(0, shielded.indexOf('\n}\n'))).not.toContain('sendUnshieldedViaStation');
    }
    // The review says who pays.
    expect(file).toContain("midnight.station.feeLine");
  });
});
