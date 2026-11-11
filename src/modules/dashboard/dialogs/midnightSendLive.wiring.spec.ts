import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires: both send surfaces keep one polite live region mounted for
// their whole life (not only while sending, or its first message goes unread)
// and hand its announce to the shared timeline. What gets said is tested in
// useMidnightSendTimeline.spec.ts.
const src = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');
const REGION = '<div class="g-sr-only" aria-live="polite" aria-atomic="true" data-test="midnight-send-live">{{ liveMessage }}</div>';

describe('Midnight send live region', () => {
  it.each([
    ['dashboard dialog', 'modules/dashboard/dialogs/MidnightSendDialog.vue'],
    ['side panel sheet', 'sidepanel/components/flows/MidnightSendSheet.vue'],
  ])('%s: one region, outside the sending block, wired to the timeline', (_name, path) => {
    const file = read(path);
    expect(file.split(REGION).length - 1).toBe(1);
    const region = file.indexOf(REGION);
    const before = file.slice(Math.max(0, region - 400), region);
    expect(before).not.toMatch(/v-if="(sending|submitting)"[^>]*>\s*(<!--[\s\S]*?-->\s*)?$/);
    expect(file).toContain('const { message: liveMessage, announce } = usePoliteAnnouncer();');
    expect(file).toMatch(/useMidnightSendTimeline\([\s\S]*?\bannounce,\s*(\/\/[^\n]*\n\s*submitDetail:[^\n]*\n\s*)?\}/);
  });

  it('the side panel says to keep it open (the send runs in the panel) and nothing contrary', () => {
    const sheet = read('sidepanel/components/flows/MidnightSendSheet.vue');
    expect(sheet).toContain("{{ $t('midnight.send.keepPanelOpen') }}");
    expect(sheet).not.toContain('midnight.sponsor.keepOpen');
    expect(sheet).toContain('{ keepOpenShown: true }');
  });
});
