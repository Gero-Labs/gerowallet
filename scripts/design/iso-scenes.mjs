// Generates src/shared/components/iso/isoScenes.ts, the isometric illustrations used by
// the Gero Card, Earn and Help Center screens. Run `node scripts/design/iso-scenes.mjs` after changing a scene
// (`--json <file>` also writes the scenes as JSON, for the design canvas).
//
// 2:1 dimetric projection (the Nexus / gerowallet.io / Midnight-deck grammar):
//   screen.x = x - y, screen.y = (x + y) / 2 - z
// Each scene is one world. Rails run on the floor grid and turn with rounded iso corners
// (a quadratic Bezier stays exact under this affine projection), packets and coins are
// centred on a point of a rail, and glyph markers stand on the vertical through the centre
// of a top face, lifted clear of every silhouette beneath them. A card slab carries the real
// card artwork (__CARD_IMG__), mapped onto its top face by the same affine projection. The
// RealFi mark is painted flat on a top face the same way (drawn, not shipped as an asset).
//
// Every scene has a still `body`. Scenes that move also get `live`: the rail dashes march
// with the flow, packets and coins travel the rails (drawn under every object, so they
// slide out of the source and into the target), a floating card bobs and a key presses.
// The motion is SVG (SMIL); IsoScene.vue only uses it when asked and when the user has not
// asked for reduced motion.
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
  // Help Center: the question over the help plinth, the open guide, and the conversation.
  question: 'M-5.5,-4.5 a5.5,5.5 0 1,1 9,4.3 c-2.3,1.6 -3.5,2.7 -3.5,5.4 M0,9.6 v0.2',
  book: 'M-10,-7 c3,-1.6 6.5,-1.3 10,0.8 c3.5,-2.1 7,-2.4 10,-0.8 v14 c-3,-1.6 -6.5,-1.3 -10,0.8 c-3.5,-2.1 -7,-2.4 -10,-0.8 z M0,-6.2 v14',
  chat: 'M-10,-7.5 h20 v12 h-10.5 l-5,4.5 v-4.5 h-4.5 z M-4,-1.5 v0.2 M0,-1.5 v0.2 M4,-1.5 v0.2',
  // Help Center home: the email route and the news feed.
  mail: 'M-10,-7 h20 v14 h-20 z M-10,-6.5 l10,7.5 l10,-7.5',
  feed: 'M-7.5,7.5 v0.2 M-8,-1 a9,9 0 0,1 9,9 M-8,-9 a17,17 0 0,1 17,17',
};

const TONES = ['cyan', 'navy', 'green', 'amber', 'violet', 'graphite', 'slate'];
const COIN_T = 2.4; // coin thickness, world units (= screen px vertically)
const COIN_RING = 0.58; // a coin face's inner ring, as a share of the coin's radius
const CARD_ART = { w: 1080, h: 692 }; // src/assets/front_card_no_mcx2.png
const DASH_PERIOD = 7; // .iso-rail stroke-dasharray 2 5
const FLOW_SPEED = 26; // screen units per second
const EASE = 'calcMode="spline" keyTimes="0;0.5;1" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"';

/** A part that differs between the still and the live drawing. */
const both = (still, live) => isLive => (isLive ? live : still);
const draw = (part, isLive) => (typeof part === 'function' ? part(isLive) : part);

/**
 * A card's box: 54 units wide at s = 1, with the artwork's own proportions so the image is
 * never stretched. `over` centres it on that box's footprint instead of a hand-set x/y.
 */
function cardBox({ x, y, z, s = 1, over }) {
  const w = 54 * s;
  const d = w * CARD_ART.h / CARD_ART.w;
  return {
    x: over ? over.x + (over.w - w) / 2 : x,
    y: over ? over.y + (over.d - d) / 2 : y,
    z,
    w,
    d,
    h: 2 * s,
  };
}

function railPath(points, r) {
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
  return `${d} L${xy(P(...points[points.length - 1]))}`;
}

/** Screen length of an axis-aligned world polyline (each world unit is sqrt(1.25) on screen). */
const screenLength = points =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0) * Math.sqrt(1.25);

function makeWorld() {
  const used = new Set();
  const floors = [];
  const rails = [];
  const flows = [];
  const objects = [];
  const marks = [];
  const shapes = []; // silhouettes, for lifting markers clear of them
  const B = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = ([px, py]) => {
    B.x0 = Math.min(B.x0, px); B.y0 = Math.min(B.y0, py);
    B.x1 = Math.max(B.x1, px); B.y1 = Math.max(B.y1, py);
  };

  function boxFaces({ x = 0, y = 0, z = 0, w, d, h, tone }, track = true) {
    used.add(tone);
    const L = [P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)];
    const Rt = [P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)];
    const T = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
    if (track) {
      shapes.push({ kind: 'box', x, y, z, w, d, h });
      [...L, ...Rt, ...T].forEach(grow);
    }
    return {
      faces: `<polygon class="iso-${tone}-l" points="${pts(L)}"/>`
        + `<polygon class="iso-${tone}-r" points="${pts(Rt)}"/>`
        + `<polygon fill="url(#__UID__-${tone})" points="${pts(T)}"/>`,
      edge: `<polyline class="iso-edge" points="${pts([T[3], T[2], T[1]])}"/>`,
    };
  }

  function boxSvg(b) {
    const { faces, edge } = boxFaces(b);
    return faces + (b.edge === false ? '' : edge);
  }

  function quadSvg({ x, y, z, w, d, cls }) {
    return `<polygon class="${cls}" points="${pts([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)])}"/>`;
  }

  // A coin lying flat, centred on (wx, wy), its top face at height z; rho is the world radius.
  function coinSvg(wx, wy, z, rho = 5, tone = 'cyan', track = true) {
    used.add(tone);
    const c = P(wx, wy, z);
    const rx = rho * Math.SQRT2;
    const ry = rx / 2;
    if (track) {
      shapes.push({ kind: 'coin', cx: c[0], cy: c[1], rx, ry });
      grow([c[0] - rx, c[1] - ry]); grow([c[0] + rx, c[1] + ry + COIN_T]);
    }
    return `<g class="iso-coin"><path class="iso-${tone}-r" d="M${xy([c[0] - rx, c[1]])} v${COIN_T} a${R(rx)},${R(ry)} 0 0 0 ${R(2 * rx)},0 v-${COIN_T} Z"/>`
      + `<ellipse fill="url(#__UID__-${tone})" cx="${R(c[0])}" cy="${R(c[1])}" rx="${R(rx)}" ry="${R(ry)}"/>`
      + `<ellipse class="iso-coin-ring" cx="${R(c[0])}" cy="${R(c[1])}" rx="${R(rx * COIN_RING)}" ry="${R(ry * COIN_RING)}"/></g>`;
  }

  // A payment card slab with the real card artwork on its top face. The image is laid out in
  // world units (its width along x, its height along y) and placed by the projection's own
  // matrix, so its corners are the face's corners exactly. Scaling the 1080 px artwork in the
  // matrix instead would need more precision than R() keeps: rounded to 0.05 / 0.03, the
  // terms skew the image off the slab.
  // A floating card (`hover`, centred `over` a box) casts its shadow straight down onto it.
  function cardSvg({ tone = 'graphite', hover = false, ...placement }) {
    const b = cardBox(placement);
    const { faces, edge } = boxFaces({ ...b, tone });
    const [e, f] = P(b.x, b.y, b.z + b.h);
    const art = `<image class="iso-card-art" href="__CARD_IMG__" width="${R(b.w)}" height="${R(b.d)}" preserveAspectRatio="none" transform="matrix(1 0.5 -1 0.5 ${R(e)} ${R(f)})"/>`;
    const slab = faces + art + edge;
    if (!hover) return slab;
    const shadow = placement.over ? shadowSvg(b, placement.over) : '';
    return both(shadow + slab, `${shadow}<g>${slab}<animateTransform attributeName="transform" type="translate" values="0 0;0 -2.5;0 0" ${EASE} dur="4s" repeatCount="indefinite"/></g>`);
  }

  // The RealFi mark, painted flat on the centre of a box's top face (`on`) or on a coin's
  // (`coin: [wx, wy, z, rho]`, the coin's own arguments): RealFi's ring, three hairline
  // ellipses of one height whose widths differ by about a tenth (one ellipse with `rings: 1`,
  // for small marks), and the rule through it, 1.28 times the ring's height (25 / 19.6 in
  // RealFi's logo), so it overshoots at both ends. A circle of radius r on a top face
  // projects to a 2:1 ellipse, as a coin does; the rule runs along the face diagonal that
  // projects to the screen vertical, so it stands upright as it does in the logo. On a coin
  // the mark takes the coin's own ring, so the face does not carry two.
  function realfiSvg({ on, coin, r, rings = 3 }) {
    if (coin) {
      const [wx, wy, z, rho] = coin;
      return realfiSvg({ on: { x: wx, y: wy, z, w: 0, d: 0, h: 0 }, r: rho * COIN_RING, rings: 1 });
    }
    const [cx, cy] = P(on.x + on.w / 2, on.y + on.d / 2, on.z + on.h);
    const rx = r * Math.SQRT2;
    const ry = rx / 2;
    const widths = rings === 1 ? [1] : [0.9, 1, 1.1];
    const half = ry * 1.28;
    return '<g class="iso-realfi">'
      + widths.map(k => `<ellipse cx="${R(cx)}" cy="${R(cy)}" rx="${R(rx * k)}" ry="${R(ry)}"/>`).join('')
      + `<line x1="${R(cx)}" y1="${R(cy - half)}" x2="${R(cx)}" y2="${R(cy + half)}"/></g>`;
  }

  // The part of a footprint that falls on the top face of the box beneath it.
  function shadowSvg(b, under) {
    const x0 = Math.max(b.x, under.x);
    const y0 = Math.max(b.y, under.y);
    const x1 = Math.min(b.x + b.w, under.x + under.w);
    const y1 = Math.min(b.y + b.d, under.y + under.d);
    return quadSvg({ x: x0, y: y0, z: under.z + under.h, w: x1 - x0, d: y1 - y0, cls: 'iso-shadow' });
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
    // A rail on the floor through world points joined by axis-aligned segments. Live, its
    // dashes march from the first point to the last.
    rail(points, { r = 6, partner = false } = {}) {
      const d = railPath(points, r);
      points.forEach(p => grow(P(...p)));
      const cls = `iso-rail${partner ? ' iso-rail--partner' : ''}`;
      const march = `<animate attributeName="stroke-dashoffset" values="${DASH_PERIOD};0" dur="0.9s" repeatCount="indefinite"/>`;
      rails.push(both(
        `<path class="iso-rail-base" d="${d}"/><path class="${cls}" d="${d}"/>`,
        `<path class="iso-rail-base" d="${d}"/><path class="${cls}" d="${d}">${march}</path>`,
      ));
    },
    // Live only: packets or coins travelling a route (normally the rails' own points).
    // `dur` pins the cycle and `phase` (0..1) offsets it, so routes that merge can be timed
    // to reach the junction apart.
    flow(points, { kind = 'packet', tone = 'cyan', count = 1, a = 3.4, rho = 5, r = 6, dur: fixed, phase = 0 } = {}) {
      const d = railPath(points, r);
      const dur = fixed ?? Math.max(1.6, screenLength(points) / FLOW_SPEED);
      const mover = kind === 'coin'
        ? coinSvg(0, 0, COIN_T, rho, tone, false)
        : boxFaces({ x: -a / 2, y: -a / 2, z: 0, w: a, d: a, h: a, tone }, false).faces;
      for (let i = 0; i < count; i++) {
        const begin = R(-dur * (phase + i / count));
        flows.push(`<g class="iso-flow">${mover}<animateMotion path="${d}" dur="${R(dur)}s" begin="${begin}s" repeatCount="indefinite"/></g>`);
      }
    },
    // A stack drawn bottom-up; depth = centre of its footprint (painter's order between stacks).
    stack({ x, y, w, d }, build) {
      const parts = [];
      build({
        box: b => {
          const svg = boxSvg(b);
          parts.push(b.press
            ? both(svg, `<g>${svg}<animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0" ${EASE} dur="2.4s" repeatCount="indefinite"/></g>`)
            : svg);
        },
        quad: q => parts.push(quadSvg(q)),
        coin: (...args) => parts.push(coinSvg(...args)),
        card: c => parts.push(cardSvg(c)),
        realfi: m => parts.push(realfiSvg(m)),
      });
      objects.push({ depth: x + w / 2 + y + d / 2, parts });
    },
    // A data packet: a true cube centred on a floor point (a rail point). `still` packets are
    // left out of the live drawing, where packets travel instead.
    packet([wx, wy], { a = 3.4, tone = 'cyan', z = 0, still = false } = {}) {
      const svg = `<g class="iso-packet">${boxSvg({ x: wx - a / 2, y: wy - a / 2, z, w: a, d: a, h: a, tone, edge: false })}</g>`;
      objects.push({ depth: wx + wy, parts: [still ? both(svg, '') : svg] });
    },
    // A coin centred on a floor point (a rail point), lying on the floor.
    coinAt([wx, wy], { rho = 5, tone = 'cyan', still = false } = {}) {
      const svg = coinSvg(wx, wy, COIN_T, rho, tone);
      objects.push({ depth: wx + wy, parts: [still ? both(svg, '') : svg] });
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
      const defs = `<defs>${g.join('')}</defs>`;
      const bodyOf = isLive => `${defs}<g transform="translate(${R(tx)} ${R(ty)})">`
        + floors.join('')
        + rails.map(part => draw(part, isLive)).join('')
        + (isLive ? flows.join('') : '')
        + objects.map(o => o.parts.map(part => draw(part, isLive)).join('')).join('')
        + markSvg.join('') + '</g>';
      const body = bodyOf(false);
      const live = bodyOf(true);
      return { viewBox: `0 0 ${vw} ${vh}`, body, ...(live !== body ? { live } : {}) };
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
  const bus = [
    [[-52, -6], [-40, -6], [-40, 30], [0, 30]],
    [[-52, 30], [0, 30]],
    [[-52, 66], [-40, 66], [-40, 30], [0, 30]],
  ];
  s.rail(bus[1]);
  s.rail([[-52, -6], [-40, -6], [-40, 30], [-34, 30]]);
  s.rail([[-52, 66], [-40, 66], [-40, 30], [-34, 30]]);
  // One shared cycle; the phases put the three packets at the junction a third of a cycle apart.
  [0, 0.47, 0.33].forEach((phase, i) => s.flow(bus[i], { dur: 3.6, phase }));
  s.packet([-40, 12], { still: true });
  s.packet([-17, 30], { still: true });
  const pad = { x: 10, y: 8, z: 14, w: 68, d: 44, h: 5 };
  s.floor({ x: 0, y: 0, w: 88, d: 60, k: 0.95 });
  s.stack({ x: 0, y: 0, w: 88, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 88, d: 60, h: 14, tone: 'navy' });
    p.box({ ...pad, tone: 'cyan' });
    p.card({ over: pad, z: 32, s: 1.08, hover: true });
  });
  s.rail([[88, 30], [114, 30]], { partner: true });
  s.flow([[88, 30], [114, 30]], { tone: 'green' });
  s.packet([101, 30], { tone: 'green', still: true });
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
  s.flow([[-38, 23], [0, 23]], { count: 2 });
  s.packet([-19, 23], { still: true });
  // The emitter is larger than the card, so a lit rim shows around the card's shadow.
  const emitter = { x: 6, y: 6, z: 8, w: 50, d: 34, h: 3 };
  s.floor({ x: 0, y: 0, w: 62, d: 46 });
  s.stack({ x: 0, y: 0, w: 62, d: 46 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 62, d: 46, h: 8, tone: 'navy' });
    p.box({ ...emitter, tone: 'cyan' });
    p.card({ over: emitter, z: 26, s: 0.84, hover: true });
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
  s.flow([[-40, 22], [0, 22]], { kind: 'coin', count: 2 });
  s.coinAt([-28, 22], { still: true });
  s.coinAt([-13, 22], { still: true });
  const wallet = { x: 0, y: 0, z: 0, w: 60, d: 44, h: 8 };
  s.floor({ x: 0, y: 0, w: 60, d: 44 });
  s.stack({ x: 0, y: 0, w: 60, d: 44 }, p => {
    p.box({ ...wallet, tone: 'navy' });
    p.card({ over: wallet, z: 8, s: 0.96 });
  });
});

// Activate: the card on its dock, the key over the card.
scene('activate', [200, 140], s => {
  const dock = { x: 4, y: 4, z: 10, w: 56, d: 38, h: 2 };
  const card = { over: dock, z: 12, s: 0.98 };
  s.floor({ x: 0, y: 0, w: 64, d: 46 });
  s.stack({ x: 0, y: 0, w: 64, d: 46 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 64, d: 46, h: 10, tone: 'navy' });
    p.box({ ...dock, tone: 'cyan' });
    p.card(card);
  });
  s.mark({ on: cardBox(card), glyph: 'key' });
});

// PIN: a keypad of nine keys; live, the lit key presses.
scene('pin', [200, 140], s => {
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 8, tone: 'navy' });
    const keys = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) keys.push([i, j]);
    keys.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [i, j] of keys) {
      const lit = i === 1 && j === 2;
      p.box({ x: 6 + i * 17, y: 6 + j * 17, z: 8, w: 14, d: 14, h: lit ? 7 : 4, tone: lit ? 'cyan' : 'slate', edge: false, press: lit });
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
  s.flow([[40, 20], [70, 20]], { tone: 'green' });
  s.packet([55, 20], { tone: 'green', still: true });
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

// ── Earn (RealFi) ─────────────────────────────────────────────────────────────
// Gero is navy and cyan, RealFi is green: a cyan coin is USDCx, a green coin is USDrf, and
// green stacked in the vault is the stake.

// Earn hero: USDCx rides the rail into the Gero vault, where it sits as a green stack; the
// RealFi plinth feeds yield back over the partner rail.
scene('earnHero', [320, 200], s => {
  s.stack({ x: -60, y: 21, w: 18, d: 18 }, p => {
    p.box({ x: -60, y: 21, z: 0, w: 18, d: 18, h: 6, tone: 'slate' });
    p.coin(-51, 30, 6 + COIN_T, 5, 'cyan');
    p.coin(-51, 30, 6 + 2 * COIN_T, 5, 'cyan');
  });
  s.rail([[-42, 30], [0, 30]]);
  s.flow([[-42, 30], [0, 30]], { kind: 'coin', count: 2 });
  // Resting coins stay left of x = -20: nearer the vault, its left face covers them.
  s.coinAt([-33, 30], { still: true });
  s.coinAt([-21, 30], { still: true });
  const pad = { x: 10, y: 8, z: 14, w: 68, d: 44, h: 5 };
  s.floor({ x: 0, y: 0, w: 88, d: 60, k: 0.95 });
  s.stack({ x: 0, y: 0, w: 88, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 88, d: 60, h: 14, tone: 'navy' });
    p.box({ ...pad, tone: 'cyan' });
    for (let i = 1; i <= 6; i++) p.coin(44, 30, pad.z + pad.h + i * COIN_T, 10, 'green');
    p.realfi({ coin: [44, 30, pad.z + pad.h + 6 * COIN_T, 10] });
  });
  s.rail([[114, 30], [88, 30]], { partner: true });
  s.flow([[114, 30], [88, 30]], { tone: 'green', count: 2 });
  s.packet([101, 30], { tone: 'green', still: true });
  // The RealFi plinth wears RealFi's mark on its green block.
  const realfi = { x: 118, y: 16, z: 12, w: 28, d: 28, h: 8 };
  s.floor({ x: 114, y: 12, w: 36, d: 36 });
  s.stack({ x: 114, y: 12, w: 36, d: 36 }, p => {
    p.box({ x: 114, y: 12, z: 0, w: 36, d: 36, h: 12, tone: 'navy' });
    p.box({ ...realfi, tone: 'green' });
    p.realfi({ on: realfi, r: 10 });
  });
}, 8);

// Where RealFi is available: four plots; one lit with the pin, one restricted (amber, sunk).
scene('earnRegion', [200, 140], s => {
  const lit = { x: 33, y: 9, z: 10, w: 18, d: 18, h: 10 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    // Back to front (x + y), so nearer plots are painted over farther ones.
    p.box({ x: 9, y: 9, z: 10, w: 18, d: 18, h: 4, tone: 'slate' });
    p.box({ ...lit, tone: 'cyan' });
    p.box({ x: 9, y: 33, z: 10, w: 18, d: 18, h: 2, tone: 'amber' });
    p.box({ x: 33, y: 33, z: 10, w: 18, d: 18, h: 4, tone: 'slate' });
  });
  s.mark({ on: lit, glyph: 'pin' });
});

// A swap: `from` coins leave their tile, pass the swap block and arrive as `to` coins.
function swapScene(name, from, to) {
  scene(name, [220, 140], s => {
    s.stack({ x: -66, y: 13, w: 18, d: 18 }, p => {
      p.box({ x: -66, y: 13, z: 0, w: 18, d: 18, h: 6, tone: 'slate' });
      p.coin(-57, 22, 6 + COIN_T, 5, from);
      p.coin(-57, 22, 6 + 2 * COIN_T, 5, from);
    });
    s.rail([[-48, 22], [-20, 22]]);
    s.flow([[-48, 22], [-20, 22]], { kind: 'coin', tone: from, count: 1 });
    s.coinAt([-34, 22], { tone: from, still: true });
    s.floor({ x: -20, y: 10, w: 24, d: 24 });
    s.stack({ x: -20, y: 10, w: 24, d: 24 }, p => {
      p.box({ x: -20, y: 10, z: 0, w: 24, d: 24, h: 12, tone: 'navy' });
      p.box({ x: -14, y: 16, z: 12, w: 12, d: 12, h: 6, tone: 'cyan' });
    });
    s.rail([[4, 22], [30, 22]]);
    s.flow([[4, 22], [30, 22]], { kind: 'coin', tone: to, count: 1 });
    s.coinAt([17, 22], { tone: to, still: true });
    s.stack({ x: 30, y: 13, w: 18, d: 18 }, p => {
      p.box({ x: 30, y: 13, z: 0, w: 18, d: 18, h: 6, tone: 'slate' });
      p.coin(39, 22, 6 + COIN_T, 5, to);
      p.coin(39, 22, 6 + 2 * COIN_T, 5, to);
      p.coin(39, 22, 6 + 3 * COIN_T, 5, to);
    });
  });
}

// Get USDCx: graphite ADA in, cyan USDCx out. (On the RealFi page cyan is USDCx and green is
// USDrf, so ADA takes the neutral tone here rather than the card scenes' cyan.)
swapScene('earnUsdcx', 'graphite', 'cyan');
// Get USDrf: cyan USDCx in, green USDrf out.
swapScene('earnSwap', 'cyan', 'green');

// Stake: green USDrf rides into the vault and stacks up as the stake.
scene('earnStake', [200, 140], s => {
  s.stack({ x: -54, y: 13, w: 18, d: 18 }, p => {
    p.box({ x: -54, y: 13, z: 0, w: 18, d: 18, h: 6, tone: 'slate' });
    p.coin(-45, 22, 6 + COIN_T, 5, 'green');
  });
  s.rail([[-36, 22], [0, 22]]);
  s.flow([[-36, 22], [0, 22]], { kind: 'coin', tone: 'green', count: 2 });
  s.coinAt([-18, 22], { tone: 'green', still: true });
  const pad = { x: 8, y: 8, z: 12, w: 36, d: 28, h: 4 };
  s.floor({ x: 0, y: 0, w: 52, d: 44 });
  s.stack({ x: 0, y: 0, w: 52, d: 44 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 52, d: 44, h: 12, tone: 'navy' });
    p.box({ ...pad, tone: 'cyan' });
    for (let i = 1; i <= 4; i++) p.coin(26, 22, pad.z + pad.h + i * COIN_T, 8, 'green');
    // USDrf is RealFi's coin: the top of the stake carries RealFi's mark.
    p.realfi({ coin: [26, 22, pad.z + pad.h + 4 * COIN_T, 8] });
  });
});

// ── Help Center ───────────────────────────────────────────────────────────────

// Help hero: the user's tile feeds the help plinth, where three steps climb to the
// question; from the plinth one rail leads to the guides tile (the open book) and the
// other to a person (the conversation).
scene('helpHero', [320, 200], s => {
  // The user, arriving with a question.
  const user = { x: -52, y: 21, z: 0, w: 18, d: 18, h: 6 };
  s.stack({ x: -52, y: 21, w: 18, d: 18 }, p => p.box({ ...user, tone: 'slate' }));
  s.mark({ on: user, glyph: 'person' });
  s.rail([[-34, 30], [0, 30]]);
  s.flow([[-34, 30], [0, 30]], { count: 2 });
  s.packet([-17, 30], { still: true });
  // The help plinth: a dark tray on the navy base, and three steps that rise towards the
  // viewer and brighten as they climb (painted in x order, so each nearer step covers the
  // one behind it); the question stands over the top step.
  const pad = { x: 10, y: 8, z: 14, w: 68, d: 44, h: 5 };
  const top = { x: 52, y: 16, z: 19, w: 16, d: 28, h: 15 };
  s.floor({ x: 0, y: 0, w: 88, d: 60, k: 0.95 });
  s.stack({ x: 0, y: 0, w: 88, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 88, d: 60, h: 14, tone: 'navy' });
    p.box({ ...pad, tone: 'graphite' });
    p.box({ x: 16, y: 16, z: 19, w: 16, d: 28, h: 5, tone: 'navy' });
    p.box({ x: 34, y: 16, z: 19, w: 16, d: 28, h: 10, tone: 'slate' });
    p.box({ ...top, tone: 'cyan' });
  });
  s.mark({ on: top, glyph: 'question' });
  // Two ways out: guides and a person. The rails share the plinth's exit, then part. Both
  // tiles stand clear of the plinth on screen (centre x past the plinth's right corner), so
  // their markers sit just over their own tiles instead of being lifted over the plinth.
  const guides = { x: 130, y: -4, z: 0, w: 18, d: 18, h: 8 };
  const person = { x: 150, y: 46, z: 0, w: 18, d: 18, h: 8 };
  const toGuides = [[88, 30], [104, 30], [104, 5], [130, 5]];
  const toPerson = [[88, 30], [104, 30], [104, 55], [150, 55]];
  s.rail(toGuides);
  s.rail(toPerson);
  s.flow(toGuides, { dur: 3.4, phase: 0 });
  s.flow(toPerson, { dur: 3.4, phase: 0.5 });
  s.packet([104, 17], { still: true });
  s.packet([127, 55], { still: true });
  s.stack({ x: 130, y: -4, w: 18, d: 18 }, p => p.box({ ...guides, tone: 'cyan' }));
  s.stack({ x: 150, y: 46, w: 18, d: 18 }, p => p.box({ ...person, tone: 'navy' }));
  s.mark({ on: guides, glyph: 'book' });
  s.mark({ on: person, glyph: 'chat' });
}, 8);

// Help support: the person's tile, where the route forks. One rail climbs to the support
// desk (the conversation), the other runs down to the mail tile (email, open to everyone).
scene('helpSupport', [220, 140], s => {
  const you = { x: -40, y: 11, z: 0, w: 18, d: 18, h: 6 };
  s.stack({ x: -40, y: 11, w: 18, d: 18 }, p => p.box({ ...you, tone: 'slate' }));
  s.mark({ on: you, glyph: 'person' });
  const toDesk = [[-22, 20], [-8, 20], [-8, 0], [10, 0]];
  const toMail = [[-22, 20], [-8, 20], [-8, 45], [14, 45]];
  s.rail(toDesk);
  s.rail(toMail);
  s.flow(toDesk, { dur: 3, phase: 0 });
  s.flow(toMail, { dur: 3, phase: 0.5 });
  s.packet([-8, 9], { still: true });
  s.packet([3, 45], { still: true });
  const desk = { x: 18, y: -9, z: 10, w: 18, d: 18, h: 10 };
  s.floor({ x: 10, y: -17, w: 34, d: 34 });
  s.stack({ x: 10, y: -17, w: 34, d: 34 }, p => {
    p.box({ x: 10, y: -17, z: 0, w: 34, d: 34, h: 10, tone: 'navy' });
    p.box({ ...desk, tone: 'cyan' });
  });
  s.mark({ on: desk, glyph: 'chat' });
  const mail = { x: 14, y: 36, z: 0, w: 18, d: 18, h: 8 };
  s.stack({ x: 14, y: 36, w: 18, d: 18 }, p => p.box({ ...mail, tone: 'graphite' }));
  s.mark({ on: mail, glyph: 'mail' });
});

// Help tutorial: three steps rise towards the viewer on the navy base and brighten as they
// climb, as in the hero; the open guide stands over the top step.
scene('helpTutorial', [200, 140], s => {
  const top = { x: 40, y: 12, z: 10, w: 12, d: 36, h: 18 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 10, tone: 'navy' });
    p.box({ x: 8, y: 12, z: 10, w: 12, d: 36, h: 6, tone: 'graphite' });
    p.box({ x: 24, y: 12, z: 10, w: 12, d: 36, h: 12, tone: 'slate' });
    p.box({ ...top, tone: 'cyan' });
  });
  s.mark({ on: top, glyph: 'book' });
});

// Help updates: the sources (the Gero blog, chain news, posts on X) feed one bus into the
// updates hub, which carries the feed. The packets reach the junction a third of a cycle apart.
scene('helpUpdates', [240, 150], s => {
  for (const [y, tone] of [[-15, 'cyan'], [21, 'slate'], [57, 'graphite']]) {
    s.stack({ x: -70, y, w: 18, d: 18 }, p => p.box({ x: -70, y, z: 0, w: 18, d: 18, h: 8, tone }));
  }
  const bus = [
    [[-52, -6], [-40, -6], [-40, 30], [0, 30]],
    [[-52, 30], [0, 30]],
    [[-52, 66], [-40, 66], [-40, 30], [0, 30]],
  ];
  s.rail(bus[1]);
  s.rail([[-52, -6], [-40, -6], [-40, 30], [-34, 30]]);
  s.rail([[-52, 66], [-40, 66], [-40, 30], [-34, 30]]);
  [0, 0.47, 0.33].forEach((phase, i) => s.flow(bus[i], { dur: 3.6, phase }));
  s.packet([-40, 12], { still: true });
  s.packet([-17, 30], { still: true });
  const hub = { x: 12, y: 12, z: 12, w: 36, d: 36, h: 10 };
  s.floor({ x: 0, y: 0, w: 60, d: 60 });
  s.stack({ x: 0, y: 0, w: 60, d: 60 }, p => {
    p.box({ x: 0, y: 0, z: 0, w: 60, d: 60, h: 12, tone: 'navy' });
    p.box({ ...hub, tone: 'cyan' });
  });
  s.mark({ on: hub, glyph: 'feed' });
}, 8);

const names = Object.keys(scenes);
const quote = text => `'${text}'`;
const out = `// GENERATED by scripts/design/iso-scenes.mjs. Do not edit by hand.
// Class-only SVG markup; IsoScene.vue replaces __UID__ per instance and __CARD_IMG__ with the
// card artwork. \`live\` is the animated drawing, for scenes that move.

export type IsoSceneName = ${names.map(n => `'${n}'`).join(' | ')};

export interface IsoSceneMarkup {
  viewBox: string;
  body: string;
  live?: string;
}

export const ISO_SCENES: Record<IsoSceneName, IsoSceneMarkup> = {
${names.map(n => `  ${n}: {\n    viewBox: '${scenes[n].viewBox}',\n    body: ${quote(scenes[n].body)},${scenes[n].live ? `\n    live: ${quote(scenes[n].live)},` : ''}\n  },`).join('\n')}
};
`;
writeFileSync(new URL('../../src/shared/components/iso/isoScenes.ts', import.meta.url), out);

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0 && process.argv[jsonAt + 1]) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(scenes, null, 1));

console.log(names.map(k => `${k}: ${scenes[k].body.length}b${scenes[k].live ? ` (+live ${scenes[k].live.length}b)` : ''}`).join('\n'));
