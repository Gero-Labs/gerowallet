import { describe, expect, it } from 'vitest';
import { ISO_SCENES } from './isoScenes';

// A card slab's top face, followed by the artwork that has to cover it.
const CARD = /<polygon fill="url\(#__UID__-graphite\)" points="([^"]+)"\/><image class="iso-card-art"[^>]*?width="([\d.]+)" height="([\d.]+)"[^>]*?transform="matrix\(([^)]+)\)"\/>/g;

describe('isoScenes', () => {
  it('lays the card artwork exactly on its slab in every scene', () => {
    const cards = Object.entries(ISO_SCENES).flatMap(([name, scene]) =>
      [scene.body, scene.live ?? ''].flatMap(markup => [...markup.matchAll(CARD)].map(match => ({ name, match }))));
    expect(cards.length).toBeGreaterThan(0);

    for (const { name, match } of cards) {
      const face = match[1].split(' ').map(point => point.split(',').map(Number));
      const [w, h] = [Number(match[2]), Number(match[3])];
      const [a, b, c, d, e, f] = match[4].split(' ').map(Number);
      // Image corners in the face's order: (0,0), (w,0), (w,h), (0,h).
      const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => [a * u + c * v + e, b * u + d * v + f]);
      corners.forEach(([x, y], i) => {
        expect(x, `${name} corner ${i} x`).toBeCloseTo(face[i][0], 1);
        expect(y, `${name} corner ${i} y`).toBeCloseTo(face[i][1], 1);
      });
    }
  });
});
