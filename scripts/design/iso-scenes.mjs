// Generates src/shared/components/iso/isoScenes.ts, the isometric illustrations used by
// the Gero Card screens. Run `node scripts/design/iso-scenes.mjs` after changing a scene.
//
// 2:1 dimetric projection (the Nexus / gerowallet.io / Midnight-deck grammar):
//   screen.x = x - y, screen.y = (x + y) / 2 - z
// Each scene is one world. Rails run on the floor grid and turn with rounded iso corners
// (a quadratic Bezier stays exact under this affine projection), packets and coins are
// centred on a point of a rail, and glyph markers stand on the vertical through the centre
// of a top face, lifted clear of every silhouette beneath them.
// Faces carry classes only (iso-<tone>-l / -r, top = url(#__UID__-<tone>)); the colours
// come from the --g-iso-* tokens in src/shared/styles/iso.css.
import { writeFileSync } from 'node:fs';

const R = n => Math.round(n * 100) / 100;
const P = (x, y, z = 0) => [x - y, (x + y) / 2 - z];
const xy = p => `${R(p[0])},${R(p[1])}`;
const pts = a => a.map(xy).join(' ');

// Glyphs on a 24-unit box centred on the origin, so a translate() puts their centre exactly.
const GLYPHS = {
  person: 'M-4.5,-5 a4.5,4.5 0 1,0 9,0 a4.5,4.5 0 1,0 -9,0 M-8.5,9.5 c0,-4.6 3.8,-7.5 8.5,-7.5 s8.5,2.9 8.5,7.5',
  shield: 'M0,-10.5 l9,3.4 v6.1 c0,5.6 -3.9,9.4 -9,11.5 c-5.1,-2.1 -9,-5.9 -9,-11.5 v-6.1 z M-4,0.2 l3,3 l5.4,-6',
  clock: 'M-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 M0,-5.5 v5.5 l3.8,2.6',
  check: 'M-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 M-4.6,0.2 l3.2,3.2 l6.2,-6.6',
  warning: 'M0,-9.5 l10.5,18.5 h-21 z M0,-3 v5 M0,5.6 v0.2',
  pin: 'M0,11.2 c-5.5,-6 -8.5,-9.8 -8.5,-13.8 a8.5,8.5 0 1,1 17,0 c0,4 -3,7.8 -8.5,13.8 z M-3.2,-2.6 a3.2,3.2 0 1,0 6.4,0 a3.2,3.2 0 1,0 -6.4,0',
  key: 'M-11,0 a4.5,4.5 0 1,0 9,0 a4.5,4.5 0 1,0 -9,0 M-2,0 h13 M6.5,0 v4 M10,0 v3',
};

const TONES = ['cyan', 'navy', 'green', 'amber', 'violet', 'graphite', 'slate'];
const COIN_T = 2.4; // coin thickness, world units (= screen px vertically)

function makeWorld() {
  const used = new Set();
  const floors = [];
  const rails = [];
  const objects = [];
  const marks = [];
  const shapes = []; // silhouettes, for lifting markers clear of them
  const B = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = ([px, py]) => {
    B.x0 = Math.min(B.x0, px); B.y0 = Math.min(B.y0, py);
    B.x1 = Math.max(B.x1, px); B.y1 = Math.max(B.y1, py);
  };

  function boxSvg({ x = 0, y = 0, z = 0, w, d, h, tone, edge = true }) {
    used.add(tone);
    shapes.push({ kind: 'box', x, y, z, w, d, h });
    const L = [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)];
    const Rt = [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)];
    const T = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
    [...L, ...Rt, ...T].forEach(grow);
    return `<polygon class="iso-${tone}-l" points="${pts(L)}"/>`
      + `<polygon class="iso-${tone}-r" points="${pts(Rt)}"/>`
      + `<polygon fill="url(#__UID__-${tone})" points="${pts(T)}"/>`
      + (edge ? `<polyline class="iso-edge" points="${pts([T[3], T[2], T[1]])}"/>` : '');
  }

  function quadSvg({ x, y, z, w, d, cls }) {
    return `<polygon class="${cls}" points="${pts([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)])}"/>`;
  }

  // A coin lying flat, centred on (wx, wy), its top face at height z; rho is the world radius.
  function coinSvg(wx, wy, z, rho = 5, tone = 'cyan') {
    used.add(tone);
    const c = P(wx, wy, z);
    const rx = rho * Math.SQRT2;
    const ry = rx / 2;
    shapes.push({ kind: 'coin', cx: c[0], cy: c[1], rx, ry });
    grow([c[0] - rx, c[1] - ry]); grow([c[0] + rx, c[1] + ry + COIN_T]);
    return `<g class="iso-coin"><path class="iso-${tone}-r" d="M${xy([c[0] - rx, c[1]])} v${COIN_T} a${R(rx)},${R(ry)} 0 0 0 ${R(2 * rx)},0 v-${COIN_T} Z"/>`
      + `<ellipse fill="url(#__UID__-${tone})" cx="${R(c[0])}" cy="${R(c[1])}" rx="${R(rx)}" ry="${R(ry)}"/>`
      + `<ellipse class="iso-coin-ring" cx="${R(c[0])}" cy="${R(c[1])}" rx="${R(rx * 0.58)}" ry="${R(ry * 0.58)}"/></g>`;
  }

  // A payment card slab: graphite body, gold chip, accent stripe.
  function cardSvg({ x, y, z, s = 1, tone = 'graphite' }) {
    const w = 54 * s;
    const d = 34 * s;
    return boxSvg({ x, y, z, w, d, h: 2 * s, tone })
      + quadSvg({ x: x + 6 * s, y: y + 6 * s, z: z + 2 * s, w: 9 * s, d: 7 * s, cls: 'iso-chip' })
      + quadSvg({ x: x + 6 * s, y: y + 25 * s, z: z + 2 * s, w: 40 * s, d: 2.2 * s, cls: 'iso-stripe' });
  }

  function upperY(sh, sx) {
    if (sh.kind === 'coin') {
      const u = (sx - sh.cx) / sh.rx;
      return Math.abs(u) > 1 ? Infinity : sh.cy - sh.ry * Math.sqrt(1 - u * u);
    }
    const top = sh.z + sh.h;
    const [lx, ly] = P(sh.x, sh.y + sh.d, top);
    const [bx, by] = P(sh.x, sh.y, top);
    const [rx, ry] = P(sh.x + sh.w, sh.y, top);
    if (sx < lx || sx > rx) return Infinity;
    return sx <= bx ? ly + (by - ly) * (sx - lx) / (bx - lx) : by + (ry - by) * (sx - bx) / (rx - bx);
  }

  const world = {
    used,
    floor({ x, y, w, d, k = 0.8 }) {
      const c = P(x + w / 2, y + d / 2, 0);
      const rx = (w + d) * k;
      floors.push(`<ellipse class="iso-floor" cx="${R(c[0])}" cy="${R(c[1])}" rx="${R(rx)}" ry="${R(rx / 2)}" fill="url(#__UID__-floor)"/>`);
    },
    // A rail on the floor through world points joined by axis-aligned segments.
    rail(points, { r = 6, partner = false } = {}) {
      let d = `M${xy(P(...points[0]))}`;
      for (let i = 1; i < points.length - 1; i++) {
        const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
        const lin = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const lout = Math.hypot(c[0] - b[0], c[1] - b[1]);
        const rr = Math.min(r, i === 1 ? lin : lin / 2, i === points.length - 2 ? lout : lout / 2);
        const p1 = [b[0] - (b[0] - a[0]) / lin * rr, b[1] - (b[1] - a[1]) / lin * rr];
        const p2 = [b[0] + (c[0] - b[0]) / lout * rr, b[1] + (c[1] - b[1]) / lout * rr];
        d += ` L${xy(P(...p1))} Q${xy(P(...b))} ${xy(P(...p2))}`;
      }
      d += ` L${xy(P(...points[points.length - 1]))}`;
      points.forEach(p => grow(P(...p)));
      rails.push(`<path class="iso-rail-base" d="${d}"/><path class="iso-rail${partner ? ' iso-rail--partner' : ''}" d="${d}"/>`);
    },
    // A stack drawn bottom-up; depth = centre of its footprint (painter's order between stacks).
    stack({ x, y, w, d }, build) {
      const parts = [];
      build({
        box: b => parts.push(boxSvg(b)),
        quad: q => parts.push(quadSvg(q)),
        coin: (...a) => parts.push(coinSvg(...a)),
        card: c => parts.push(cardSvg(c)),
      });
      objects.push({ depth: x + w / 2 + y + d / 2, svg: parts.join('') });
    },
    // A data packet: a true cube centred on a floor point (a rail point).
    packet([wx, wy], { a = 3.4, tone = 'cyan', z = 0 } = {}) {
      objects.push({ depth: wx + wy, svg: `<g class="iso-packet">${boxSvg({ x: wx - a / 2, y: wy - a / 2, z, w: a, d: a, h: a, tone, edge: false })}</g>` });
    },
    // A coin centred on a floor point (a rail point), lying on the floor.
    coinAt([wx, wy], { rho = 5, tone = 'cyan' } = {}) {
      objects.push({ depth: wx + wy, svg: coinSvg(wx, wy, COIN_T, rho, tone) });
    },
    // A glyph on the vertical through the centre of a box's top face.
    mark({ on, glyph, tone = '', size = 22, gap = 5 }) {
      marks.push({ on, glyph, tone, size, gap });
    },
    render([vw, vh], margin = 10) {
      const markSvg = marks.map(({ on, glyph, tone, size, gap }) => {
        const [ax, ay] = P(on.x + on.w / 2, on.y + on.d / 2, on.z + on.h);
        const spotRx = 4 * Math.SQRT2;
        const spotRy = spotRx / 2;
        let clear = Infinity;
        for (let i = 0; i <= 16; i++) {
          const sx = ax - size / 2 - 1 + (size + 2) * i / 16;
          for (const sh of shapes) clear = Math.min(clear, upperY(sh, sx));
        }
        const bottom = Math.min(clear - gap, ay - spotRy - 8);
        const cy = bottom - size / 2;
        grow([ax - size / 2, cy - size / 2]); grow([ax + size / 2, cy + size / 2]);
        return `<g class="iso-mark${tone ? ` iso-mark--${tone}` : ''}">`
          + `<ellipse class="iso-mark-spot" cx="${R(ax)}" cy="${R(ay)}" rx="${R(spotRx)}" ry="${R(spotRy)}"/>`
          + `<line class="iso-mark-beam" x1="${R(ax)}" y1="${R(ay - spotRy)}" x2="${R(ax)}" y2="${R(bottom + 1)}"/>`
          + `<path class="iso-mark-glyph" transform="translate(${R(ax)} ${R(cy)})" d="${GLYPHS[glyph]}"/>`
          + '</g>';
      });
      const cw = B.x1 - B.x0;
      const ch = B.y1 - B.y0;
      if (cw > vw - 2 * margin || ch > vh - 2 * margin) {
        console.warn(`  ! content ${R(cw)}x${R(ch)} exceeds ${vw}x${vh} minus ${margin}px margins`);
      }
      const tx = vw / 2 - (B.x0 + B.x1) / 2;
      const ty = vh / 2 - (B.y0 + B.y1) / 2;
      objects.sort((a, b) => a.depth - b.depth);
      const g = [...used].filter(t => TONES.includes(t)).map(t =>
        `<linearGradient id="__UID__-${t}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="iso-${t}-s1"/><stop offset="1" class="iso-${t}-s2"/></linearGradient>`);
      g.push('<radialGradient id="__UID__-floor"><stop offset="0" class="iso-floor-s1"/><stop offset="1" class="iso-floor-s2"/></radialGradient>');
      return {
        viewBox: `0 0 ${vw} ${vh}`,
        body: `<defs>${g.join('')}</defs><g transform="translate(${R(tx)} ${R(ty)})">`
          + floors.join('') + rails.join('') + objects.map(o => o.svg).join('') + markSvg.join('') + '</g>',
      };
    },
  };
  return world;
}

// ---------------------------------------------------------------------------------
const scenes = {};
function scene(name, size, build, margin = 10) {
  const w = makeWorld();
  build(w);
  scenes[name] = w.render(size, margin);
}

// Card hub hero: three chain tiles feed a bus into the Gero plinth carrying the card;
// the partner rail leaves its right face for the Zione plinth.
scene('hero', [320, 200], s => {
  // Tiles 36 apart along y, so their silhouettes never overlap on screen.
  for (const [y, tone] of [[-15, 'cyan'], [21, 'navy'], [57, 'cyan']]) {
    s.stack({ x: -70, y, w: 18, d: 18 }, p => p.box({ x: -70, y, z: 0, w: 18, d: 18, h: 8, tone }));
  }
  s.rail([[-52, 30], [0, 30]]);
  s.rail([[-52, -6], [-40, -6], [-40, 30], [-34, 30]]);
  s.rail([[-52, 66], [-40, 66], [-40, 30], [-34, 30]]);
  s.packet([-40, 12]);
  s.packet([-17, 30]);
  s.floor({ x: 0, y: 0, w: 88, d: 60, k: 0.95 });
  s.stack({ x: 0, y: 0, w: 88, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 88, d: 60, h: 14, tone: 'navy' });
    p.box({ x: 10, y: 8, z: 14, w: 68, d: 44, h: 5, tone: 'cyan' });
    p.card({ x: 16, y: 13, z: 32, s: 1.08 });
  });
  s.rail([[88, 30], [114, 30]], { partner: true });
  s.packet([101, 30], { tone: 'green' });
  s.floor({ x: 114, y: 12, w: 36, d: 36 });
  s.stack({ x: 114, y: 12, w: 36, d: 36 }, p => {
    p.box({ x: 114, y: 12, z: 0, w: 36, d: 36, h: 12, tone: 'navy' });
    p.box({ x: 122, y: 20, z: 12, w: 20, d: 20, h: 10, tone: 'slate' });
  });
}, 8);

// Register: account blocks stacking up, the person on top.
scene('register', [200, 140], s => {
  const top = { x: 20, y: 20, z: 22, w: 20, d: 20, h: 18 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 12, tone: 'slate' });
    p.box({ x: 10, y: 10, z: 12, w: 40, d: 40, h: 10, tone: 'navy' });
    p.box({ ...top, tone: 'cyan' });
  });
  s.mark({ on: top, glyph: 'person' });
});

// Verify: a shield over the scan plate.
scene('verify', [200, 140], s => {
  const plate = { x: 12, y: 12, z: 10, w: 36, d: 36, h: 6 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    p.box({ ...plate, tone: 'cyan' });
  });
  s.mark({ on: plate, glyph: 'shield' });
});

// Review: a pending tower with the clock (amber).
scene('review', [200, 140], s => {
  const tower = { x: 18, y: 18, z: 10, w: 24, d: 24, h: 26 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    p.box({ ...tower, tone: 'slate' });
  });
  s.mark({ on: tower, glyph: 'clock', tone: 'warm' });
});

// Approved / success: the check over a green plate.
scene('approved', [200, 140], s => {
  const plate = { x: 12, y: 12, z: 10, w: 36, d: 36, h: 8 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    p.box({ ...plate, tone: 'green' });
  });
  s.mark({ on: plate, glyph: 'check', tone: 'ok' });
});

// Needs attention: the warning over an amber plate that sits out of line.
scene('attention', [200, 140], s => {
  const plate = { x: 6, y: 24, z: 10, w: 30, d: 30, h: 6 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    p.box({ x: 40, y: 6, z: 10, w: 14, d: 14, h: 14, tone: 'slate' });
    p.box({ ...plate, tone: 'amber' });
  });
  s.mark({ on: plate, glyph: 'warning', tone: 'warm' });
});

// Virtual card: issued over the wire; the card hovers above its emitter.
scene('virtual', [200, 140], s => {
  s.stack({ x: -54, y: 15, w: 16, d: 16 }, p => p.box({ x: -54, y: 15, z: 0, w: 16, d: 16, h: 6, tone: 'cyan' }));
  s.rail([[-38, 23], [0, 23]]);
  s.packet([-19, 23]);
  s.floor({ x: 0, y: 0, w: 62, d: 46 });
  s.stack({ x: 0, y: 0, w: 62, d: 46 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 62, d: 46, h: 8, tone: 'navy' });
    p.box({ x: 8, y: 6, z: 8, w: 46, d: 34, h: 3, tone: 'cyan' });
    p.card({ x: 4, y: 6, z: 26, s: 1 });
  });
});

// Physical card: the card lies behind the parcel it ships in.
scene('physical', [200, 140], s => {
  s.floor({ x: 0, y: 0, w: 64, d: 56 });
  s.stack({ x: 0, y: 0, w: 64, d: 56 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 64, d: 56, h: 8, tone: 'navy' });
    p.card({ x: 28, y: 0, z: 8, s: 0.62 });
    p.box({ x: 6, y: 22, z: 8, w: 34, d: 28, h: 22, tone: 'amber' });
    p.quad({ x: 6, y: 34, z: 30, w: 34, d: 4, cls: 'iso-tape' });
  });
});

// Shipping / tracker: the parcel's rail turns twice on its way to the destination pin.
scene('shipping', [200, 140], s => {
  const dest = { x: 70, y: 22, z: 0, w: 26, d: 26, h: 6 };
  s.rail([[34, 15], [52, 15], [52, 35], [70, 35]]);
  s.packet([52, 25], { tone: 'amber' });
  s.floor({ x: 0, y: 0, w: 34, d: 30 });
  s.stack({ x: 0, y: 0, w: 34, d: 30 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 34, d: 30, h: 6, tone: 'navy' });
    p.box({ x: 6, y: 6, z: 6, w: 22, d: 18, h: 16, tone: 'amber' });
  });
  s.stack(dest, p => p.box({ ...dest, tone: 'navy' }));
  s.mark({ on: dest, glyph: 'pin' });
});

// Payment / top-up: ADA leaves the wallet tile and rides the rail into the card.
scene('payment', [220, 140], s => {
  s.stack({ x: -58, y: 13, w: 18, d: 18 }, p => {
    p.box({ x: -58, y: 13, z: 0, w: 18, d: 18, h: 6, tone: 'slate' });
    p.coin(-49, 22, 6 + COIN_T, 5, 'cyan');
    p.coin(-49, 22, 6 + 2 * COIN_T, 5, 'cyan');
  });
  s.rail([[-40, 22], [0, 22]]);
  s.coinAt([-28, 22]);
  s.coinAt([-13, 22]);
  s.floor({ x: 0, y: 0, w: 60, d: 44 });
  s.stack({ x: 0, y: 0, w: 60, d: 44 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 44, h: 8, tone: 'navy' });
    p.card({ x: 4, y: 6, z: 8, s: 0.96 });
  });
});

// Activate: the card on its dock, the key over the card.
scene('activate', [200, 140], s => {
  const card = { x: 5, y: 6, z: 12, s: 0.98 };
  s.floor({ x: 0, y: 0, w: 64, d: 46 });
  s.stack({ x: 0, y: 0, w: 64, d: 46 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 64, d: 46, h: 10, tone: 'navy' });
    p.box({ x: 4, y: 4, z: 10, w: 56, d: 38, h: 2, tone: 'cyan' });
    p.card(card);
  });
  s.mark({ on: { x: card.x, y: card.y, z: card.z, w: 54 * card.s, d: 34 * card.s, h: 2 * card.s }, glyph: 'key' });
});

// PIN: a keypad of nine keys, one pressed.
scene('pin', [200, 140], s => {
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 8, tone: 'navy' });
    const keys = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) keys.push([i, j]);
    keys.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [i, j] of keys) {
      const lit = i === 1 && j === 2;
      p.box({ x: 6 + i * 17, y: 6 + j * 17, z: 8, w: 14, d: 14, h: lit ? 7 : 4, tone: lit ? 'cyan' : 'slate', edge: false });
    }
  });
});

// Empty: an outlined slot on a plate.
scene('empty', [200, 140], s => {
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 8, tone: 'navy' });
    p.quad({ x: 12, y: 12, z: 8, w: 36, d: 36, cls: 'iso-slot' });
  });
});

// Partnership: the Gero plinth and the Zione plinth joined by the partner rail.
scene('bridge', [240, 120], s => {
  s.floor({ x: 0, y: 0, w: 40, d: 40 });
  s.stack({ x: 0, y: 0, w: 40, d: 40 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 40, d: 40, h: 12, tone: 'navy' });
    p.box({ x: 8, y: 8, z: 12, w: 24, d: 24, h: 12, tone: 'cyan' });
  });
  s.rail([[40, 20], [70, 20]], { partner: true });
  s.packet([55, 20], { tone: 'green' });
  s.floor({ x: 70, y: 0, w: 40, d: 40 });
  s.stack({ x: 70, y: 0, w: 40, d: 40 }, p => {
    p.box({ x: 70, y: 0, z: 0, w: 40, d: 40, h: 12, tone: 'navy' });
    p.box({ x: 78, y: 8, z: 12, w: 24, d: 24, h: 12, tone: 'slate' });
  });
});

// Tracker stage: a tiny cube.
scene('stage', [24, 24], s => {
  s.stack({ x: 0, y: 0, w: 7, d: 7 }, p => p.box({ x: 0, y: 0, z: 0, w: 7, d: 7, h: 7, tone: 'cyan', edge: false }));
}, 2);

const names = Object.keys(scenes);
const out = `// GENERATED by scripts/design/iso-scenes.mjs. Do not edit by hand.
// Class-only SVG markup; __UID__ is replaced per instance by IsoScene.vue.

export type IsoSceneName = ${names.map(n => `'${n}'`).join(' | ')};

export interface IsoSceneMarkup {
  viewBox: string;
  body: string;
}

export const ISO_SCENES: Record<IsoSceneName, IsoSceneMarkup> = {
${names.map(n => `  ${n}: {\n    viewBox: '${scenes[n].viewBox}',\n    body: '${scenes[n].body}',\n  },`).join('\n')}
};
`;
writeFileSync(new URL('../../src/shared/components/iso/isoScenes.ts', import.meta.url), out);
console.log(names.map(k => `${k}: ${scenes[k].body.length}b`).join('\n'));
