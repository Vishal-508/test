// Night dressing for Chor Police: Jugnupur ki Raat. Makes the town look lived-in after dark:
// neon shop signs on the walls that face a road, a few lamp-lit painted hoardings, the light those
// throw on wall and wet road, and rooftop clutter (water tanks, stair-heads, TV aerials).
//
//   const dressing = buildDressing(scene, W, { hash2 });   // once, after buildWorld()
//   dressing.update(dt, time);                             // every frame (time in seconds): a few signs flicker
//   dressing.dispose();                                    // removes and frees everything
//
// Optional: pass { hash2, U } with the { uCut, uRes } uniforms that js/scene.js gives its buildings, and the
// dressing opens up in the same see-through circle round the player's car as the buildings do.
//
// Everything here is decoration: nothing is solid, nothing is written to the world grid, and every
// board hangs flat on a wall so no road is narrowed.
//
// Cost: 6 draw calls (boards, wall and road glow, the lit tubes of the flickering signs, tanks, roof
// boxes, aerials) and ONE 1024 x 512 texture (2 MB before mipmaps). No lights, no per-frame allocations.
//
// How the boards stay cheap: the atlas holds white "tube" lettering on dark boards, and each quad
// tints it with a vertex colour brighter than white, so the same cell can be pink on one shop and
// cyan on the next and the bloom pass picks the tubes up. A two-word board ("Timtim" + "Sweets")
// is two cells side by side, which gives a few hundred different shop names from about fifty cells.
import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------- tuning
const ATLAS_W = 1024, ATLAS_H = 512;          // the only texture
const ROW = 44, ROWS = 11, GUT = 6;           // sign cells: 44 px tall, in 11 rows, 6 px between neighbours
const HOARD_W = 236, HOARD_H = 88;            // a hoarding cell is two rows tall
const FONT_PX = 26, PAD = 15, HALF_GAP = 4;   // lettering of the two-part boards
const SINGLE_MIN = 140;                       // narrowest one-word board, px

const SIGN_TARGET = 88;                       // shop signs wanted
const HOARDING_TARGET = 6;
const FLICKER_SHARE = 0.1;                    // one sign in ten has a failing tube
const WEIGHT = { sarafa: 2.2, kotwali: 1, patri: 0.9, basti: 0.36, afsar: 0.5 };   // how likely a wall is to get a sign, district against district (others: never)

const SIGN_W0 = 0.9, SIGN_W1 = 1.8, SIGN_H0 = 0.22, SIGN_H1 = 0.34;   // board size limits, world units
const SIGN_Y = 0.46;                          // lowest bottom edge: just above the shop shutters
const ROOF_GAP = 0.05;                        // boards stop this far below the roof line
const END_GAP = 0.12;                         // ...and this far from either end of their stretch of wall
const OFF_GLOW = 0.012, OFF_BOARD = 0.025, OFF_LIT = 0.032;   // how far each layer stands off the wall
const HOARD_SW = 1.6, HOARD_SH = 0.6, OFF_HOARD = 0.03;

const WALL_GLOW = 0.3, ROAD_GLOW = 0.12, ROAD_REACH = 0.65;  // light a sign throws on its wall and on the road below it (faint: a sheen, never a marker)
const OFF_LEVEL = 0.05;                       // how bright the tubes of a flickering sign look while they are out

const TANKS = 96, STAIRS = 80, AERIALS = 72;  // rooftop items (each tank also has a stand): 344 instances
const ROOF_EDGE = 0.07;                       // clutter keeps this far from the roof edge

// neon colours: pink, cyan, amber, green, white. `lit` is the tube colour, lifted above white so it
// blooms; `soft` is the same hue evened out to one brightness, for the glow on wall and road.
const _c = new THREE.Color();
const NEON = [0xff3d9a, 0x35e0ff, 0xffb02e, 0x4dff7a, 0xf2f4ff].map(hex => {
  _c.setHex(hex);
  const luma = 0.299 * _c.r + 0.587 * _c.g + 0.114 * _c.b, k = Math.min(3, Math.max(1.1, 1.05 / luma));
  return { lit: [_c.r * k, _c.g * k, _c.b * k], soft: [_c.r * 0.45 / luma, _c.g * 0.45 / luma, _c.b * 0.45 / luma] };
});
const PINK = 0, CYAN = 1, AMBER = 2, GREEN = 3, WHITE = 4;
const NEON_ODDS = [1.2, 1.2, 1.2, 0.8, 0.5];
const LAMP_RGB = [3.3, 2.75, 1.85];           // hoarding lamps: warm and brighter than white
const HOARD_RGB = [0.9, 0.88, 0.84];

// ---------------------------------------------------------------- what the boards say
// Made-up names for a small North Indian town; no real brands or chains. A two-part board is one
// NAME plus one TRADE. Everyday surnames are limited (`only`) to pairings picked by hand.
const NAMES = [
  { t: 'Timtim' }, { t: 'Chamakchand' }, { t: 'Lallan' }, { t: 'Pappu' }, { t: 'Chhotu' }, { t: 'Munna' },
  { t: 'Babloo' }, { t: 'Guddu' }, { t: 'Jhilmil' }, { t: 'Billu' }, { t: 'Jugnu' }, { t: 'Phoolchand' },
  { t: 'Mithailal' }, { t: 'Fatafat' }, { t: 'Chakachak' },
  { t: 'Gupta', only: ['Kirana', 'General Store'] }, { t: 'Raja', only: ['Tailors', 'Band Party'] }, { t: 'Bharat', only: ['Cycle Works', 'Lodge'] },
];
// `d`: districts where the trade is at home (picked four times as often there, or `home` times)
const TRADES = [
  { t: 'Kirana', d: ['basti', 'patri'] }, { t: 'Sweets', d: ['sarafa', 'kotwali'] }, { t: 'Tailors', d: ['sarafa', 'basti'] },
  { t: 'Jewellers', d: ['sarafa'], home: 10, tint: AMBER }, { t: 'Cycle Works', d: ['basti', 'patri'] }, { t: 'Medical', d: ['kotwali', 'afsar'], tint: GREEN },
  { t: 'Electricals', d: ['kotwali'] }, { t: 'Cloth House', d: ['sarafa'] }, { t: 'Saree Centre', d: ['sarafa'], tint: PINK },
  { t: 'Hardware', d: ['basti', 'kotwali'] }, { t: 'Photo Studio', d: ['kotwali'] }, { t: 'Bartan Bhandar', d: ['sarafa'] },
  { t: 'Hair Saloon', d: [] }, { t: 'Dairy', d: ['afsar', 'patri'] }, { t: 'General Store', d: ['afsar', 'patri'] },
  { t: 'Lodge', d: ['patri', 'kotwali'] }, { t: 'Band Party', d: ['basti'] }, { t: 'Tea Stall', d: ['patri'] },
];
// One-word boards. `alt` is drawn instead when the device has no Devanagari font; `max` is how many
// shops in town may carry it; `d` (optional) keeps it to some districts.
const SINGLES = [
  { t: 'चाय', alt: 'CHAI', max: 4, tint: AMBER }, { t: 'दवाखाना', alt: 'DAWAI', max: 3, tint: GREEN },
  { t: 'मिठाई', alt: 'MITHAI', max: 3 }, { t: 'पान', alt: 'PAAN', max: 3, tint: GREEN }, { t: 'नाई', alt: 'NAI', max: 2 },
  { t: 'किराना', alt: 'KIRANA', max: 3 }, { t: 'सुनार', alt: 'SUNAR', max: 3, d: ['sarafa'], tint: AMBER },
  { t: 'ढाबा', alt: 'DHABA', max: 2 }, { t: 'लस्सी', alt: 'LASSI', max: 2, tint: WHITE }, { t: 'भोजनालय', alt: 'BHOJAN', max: 2 },
  { t: 'दूध डेयरी', alt: 'DOODH', max: 2, tint: WHITE }, { t: 'आटा चक्की', alt: 'CHAKKI', max: 2, d: ['basti', 'patri', 'kotwali'] },
  { t: 'चाट भंडार', alt: 'CHAAT', max: 2 },
  { t: 'STD PCO', max: 3, tint: AMBER }, { t: 'TYRE PUNCTURE', max: 2, d: ['basti', 'patri', 'kotwali'] }, { t: 'CHAI NASHTA', max: 2 },
];

// Rough width of bold sans lettering in em. Cell sizes come from this estimate rather than from
// measuring, so the atlas is laid out the same on every device whatever font it ends up drawing with.
function estWidth(text) {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0x900 && c <= 0x97f) {   // Devanagari: marks above and below take no room, vowel signs beside the letter a little
      if (c <= 0x902 || c === 0x93c || (c >= 0x941 && c <= 0x948) || c === 0x94d) continue;
      w += (c === 0x903 || (c >= 0x93e && c <= 0x940) || (c >= 0x949 && c <= 0x94c)) ? 0.32 : 0.7;
    } else if (c >= 0x2e80) w += 1.0;   // Japanese and other full-width lettering
    else if (ch === ' ') w += 0.3;
    else if ('iljtfrI1.'.indexOf(ch) >= 0) w += 0.4;
    else if ('mwMW'.indexOf(ch) >= 0) w += 0.95;
    else if (ch >= 'A' && ch <= 'Z') w += 0.74;
    else w += 0.63;
  }
  return w;
}
const even = v => Math.ceil(v / 2) * 2;

// ---------------------------------------------------------------- atlas layout (no DOM needed)
// Hoardings fill the first rows, then every sign cell goes into the first row with room (widest first).
// A cell that finds no room gets rect = null and the boards that would need it are simply never chosen.
// What the boards say can come from the map file (another country, another script). null = the built-in boards above.
let VOCAB = null, DEF_VOCAB = null;
const voc = () => VOCAB || DEF_VOCAB || (DEF_VOCAB = { names: NAMES, trades: TRADES, singles: SINGLES, hoardings: HOARDINGS, weights: WEIGHT, hoardIn: ['kotwali', 'sarafa'], script: 'deva', target: SIGN_TARGET });
let LAYOUT = null;
function layout() {
  if (LAYOUT) return LAYOUT;
  const V = voc();
  const cursor = new Array(ROWS).fill(0);
  const hoardings = V.hoardings.map((art, i) => {
    const band = Math.floor(i / 4), x = GUT / 2 + (i % 4) * (HOARD_W + GUT);
    if ((band + 1) * 2 > ROWS) return { art, rect: null };
    cursor[band * 2] = cursor[band * 2 + 1] = x + HOARD_W + GUT / 2;
    return { art, rect: { x, y: band * HOARD_H, w: HOARD_W, h: HOARD_H } };
  });
  const names = V.names.map(n => ({ t: n.t, only: n.only || null, w: even(PAD + estWidth(n.t) * FONT_PX + HALF_GAP), rect: null }));
  const trades = V.trades.map(n => ({ t: n.t, d: n.d || [], home: n.home || 4, tint: n.tint, w: even(PAD + estWidth(n.t) * FONT_PX + HALF_GAP), rect: null }));
  const singles = V.singles.map(n => ({ t: n.t, alt: n.alt || null, max: n.max || 1, d: n.d || null, tint: n.tint, w: Math.max(SINGLE_MIN, even(2 * PAD + estWidth(n.t) * (FONT_PX + 1))), rect: null }));
  const all = names.concat(trades, singles).map((cell, i) => ({ cell, i })).sort((a, b) => b.cell.w - a.cell.w || a.i - b.i);
  let missing = 0;
  for (const { cell } of all) {
    for (let r = 0; r < ROWS && !cell.rect; r++) if (cursor[r] + cell.w + GUT <= ATLAS_W) { cell.rect = { x: cursor[r] + GUT / 2, y: r * ROW, w: cell.w, h: ROW }; cursor[r] += cell.w + GUT; }
    if (!cell.rect) missing++;
  }
  // the strip under the last row holds the soft glow blob and a patch of plain white
  const glow = { x: 8, y: ROWS * ROW + 2, w: 64, h: 24 }, white = { x: 96, y: ROWS * ROW + 6, w: 16, h: 16 };
  LAYOUT = { names, trades, singles, hoardings, glow, white, missing };
  return LAYOUT;
}
// texture coordinates of an atlas rectangle: [u0, v0, u1, v1] with v0 at its bottom edge
function uvOf(r) { return [(r.x + 0.5) / ATLAS_W, 1 - (r.y + r.h - 0.5) / ATLAS_H, (r.x + r.w - 0.5) / ATLAS_W, 1 - (r.y + 0.5) / ATLAS_H]; }

// ---------------------------------------------------------------- atlas painting
const BOARD = '#15161b', TUBE = '#ffffff';
const latinFont = px => `700 ${px.toFixed(1)}px "Baloo 2","Trebuchet MS","Segoe UI",system-ui,sans-serif`;
const devaFont = px => (voc().script === 'jp'
  ? `700 ${px.toFixed(1)}px "Noto Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo","Noto Sans CJK JP","MS Gothic",sans-serif`
  : `700 ${px.toFixed(1)}px "Noto Sans Devanagari","Nirmala UI","Kohinoor Devanagari","Devanagari Sangam MN","Mangal",sans-serif`);
const isDeva = text => /[^\u0000-\u024f]/.test(text);   // any lettering outside the Latin ranges (Devanagari, Japanese, ...)
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// True when this device can really draw Devanagari (two letters come out different, and not as the
// "missing glyph" box). Otherwise the boards fall back to the same words in Latin letters.
function canDrawDevanagari() {
  try {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
    const c = cv.getContext('2d', { willReadFrequently: true });
    if (!c) return false;
    const shot = ch => { c.fillStyle = '#000'; c.fillRect(0, 0, 64, 32); c.fillStyle = '#fff'; c.font = devaFont(22); c.textBaseline = 'middle'; c.fillText(ch, 6, 16); return c.getImageData(0, 0, 64, 32).data; };
    const jp = voc().script === 'jp';
    const ka = shot(jp ? '\u3042' : '\u0915'), ma = shot(jp ? '\u306e' : '\u092e'), none = shot('\uffff');   // ka, ma, and a code point no font has
    let ink = 0, differ = 0, notBox = 0;
    for (let i = 0; i < ka.length; i += 4) { if (ka[i] > 60) ink++; if (Math.abs(ka[i] - ma[i]) > 40) differ++; if (Math.abs(ka[i] - none[i]) > 40) notBox++; }
    return ink > 12 && differ > 6 && notBox > 6;
  } catch (e) { return false; }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// white tube lettering: once with a halo, once crisp on top
function tubeText(c, text, x, y, maxW) {
  c.fillStyle = TUBE; c.shadowColor = 'rgba(255,255,255,0.95)'; c.shadowBlur = 7; c.fillText(text, x, y, maxW);
  c.shadowBlur = 0; c.shadowColor = 'rgba(0,0,0,0)'; c.fillText(text, x, y, maxW);
}
// One sign cell: dark board, tube border, lettering. side: 'L' (left half, open on the right),
// 'R' (right half, open on the left) or 'F' (a whole board). The open side runs off the edge so two halves join.
function paintCell(c, rect, side, drawText) {
  const { x, y, w } = rect;
  c.save();
  c.beginPath(); c.rect(x - GUT / 2, y, w + GUT, ROW); c.clip();
  c.fillStyle = BOARD; c.fillRect(x - GUT / 2, y, w + GUT, ROW);
  const x0 = side === 'R' ? x - 60 : x + 4.5, x1 = side === 'L' ? x + w + 60 : x + w - 4.5;
  c.lineWidth = 2.2; c.strokeStyle = TUBE; c.shadowColor = 'rgba(255,255,255,0.9)'; c.shadowBlur = 5;
  roundRect(c, x0, y + 4.5, x1 - x0, ROW - 9, 7); c.stroke();
  drawText();
  c.restore();
}
function paintSigns(c, L, deva) {
  // one letter size and one baseline for every half-board, so any name sits level with any trade
  c.font = latinFont(FONT_PX);
  let fit = 1;
  for (const cell of L.names.concat(L.trades)) if (cell.rect) fit = Math.min(fit, (cell.w - PAD - HALF_GAP) / Math.max(1, c.measureText(cell.t).width));
  const px = FONT_PX * Math.max(0.7, fit);
  c.font = latinFont(px);
  const asc = num(c.measureText('H').actualBoundingBoxAscent, px * 0.7), desc = num(c.measureText('g').actualBoundingBoxDescent, px * 0.2);
  const base = ROW / 2 + (asc - desc) / 2;
  c.textBaseline = 'alphabetic';
  for (const cell of L.names) if (cell.rect) paintCell(c, cell.rect, 'L', () => { c.font = latinFont(px); c.textAlign = 'right'; tubeText(c, cell.t, cell.rect.x + cell.w - HALF_GAP, cell.rect.y + base, cell.w - PAD - HALF_GAP); });
  for (const cell of L.trades) if (cell.rect) paintCell(c, cell.rect, 'R', () => { c.font = latinFont(px); c.textAlign = 'left'; tubeText(c, cell.t, cell.rect.x + HALF_GAP, cell.rect.y + base, cell.w - PAD - HALF_GAP); });
  // one-word boards: each is fitted to its own cell and centred on its own ink
  for (const cell of L.singles) if (cell.rect) paintCell(c, cell.rect, 'F', () => {
    const text = isDeva(cell.t) && !deva ? cell.alt : cell.t, font = isDeva(text) ? devaFont : latinFont;
    const availW = cell.w - 2 * PAD, availH = ROW - (isDeva(text) ? 13 : 17);   // Devanagari may reach nearer the border: its tall vowel signs are few
    c.font = font(FONT_PX + 1);
    let m = c.measureText(text);
    const h0 = num(m.actualBoundingBoxAscent, FONT_PX * 0.72) + num(m.actualBoundingBoxDescent, FONT_PX * 0.1);
    const size = (FONT_PX + 1) * Math.min(1.3, availW / Math.max(1, m.width), availH / Math.max(1, h0));
    c.font = font(size);
    m = c.measureText(text);
    const a = num(m.actualBoundingBoxAscent, size * 0.72), d = num(m.actualBoundingBoxDescent, size * 0.1);
    c.textAlign = 'center'; tubeText(c, text, cell.rect.x + cell.w / 2, cell.rect.y + ROW / 2 + (a - d) / 2, availW);
  });
}

// lettering the way a sign painter does it: flat colour with a dark drop shadow
function word(c, text, x, y, px, fill, maxW, font) {
  c.font = (font || latinFont)(px); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillText(text, x + 1.4, y + 1.4, maxW);
  c.fillStyle = fill; c.fillText(text, x, y, maxW);
}
function star(c, x, y, r, fill) {
  c.fillStyle = fill; c.beginPath();
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, q = k % 2 ? r * 0.3 : r; c.lineTo(x + Math.sin(a) * q, y - Math.cos(a) * q); }
  c.closePath(); c.fill();
}
// Hand-painted advertisement boards for things that only exist in Jugnupur. Each draws into (0,0)-(w,h).
const HOARDINGS = [
  { name: 'Jugnu Chhaap Sarson Tel', draw(c, w, h, deva) {   // mustard oil with a firefly on the tin
    c.fillStyle = '#a07d1b'; c.fillRect(0, 0, w, h); c.fillStyle = '#6a1b16'; c.fillRect(0, h - 19, w, 19);
    c.fillStyle = '#d5cdb2'; c.fillRect(14, 20, 34, 38); c.fillRect(25, 14, 10, 6); c.fillStyle = '#6a1b16'; c.fillRect(14, 32, 34, 13);
    c.fillStyle = '#dfee70'; c.beginPath(); c.arc(31, 38.5, 4, 0, 7); c.fill();
    word(c, 'JUGNU CHHAAP', 140, 24, 18, '#15331d', 160); word(c, 'SARSON TEL', 140, 54, 29, '#741611', 164);
    word(c, deva ? 'असली स्वाद' : 'Asli Swaad', w / 2, h - 5, 13, '#e6dbb2', w - 20, deva ? devaFont : null);
  } },
  { name: 'Timtim Talkies: Chor Police', draw(c, w, h) {      // tonight's film
    c.fillStyle = '#4a111e'; c.fillRect(0, 0, w, h); c.fillStyle = '#641828';
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; c.beginPath(); c.moveTo(w / 2, 42); c.lineTo(w / 2 + Math.cos(a) * 200, 42 + Math.sin(a) * 200); c.lineTo(w / 2 + Math.cos(a + 0.26) * 200, 42 + Math.sin(a + 0.26) * 200); c.fill(); }
    word(c, 'TIMTIM TALKIES', w / 2, 17, 13, '#e2d2ab', w - 24); word(c, 'CHOR POLICE', w / 2, 52, 31, '#dfb22a', w - 18);
    word(c, 'Aaj raat \u00b7 teen show', w / 2, h - 8, 13, '#e091b0', w - 24);
  } },
  { name: 'Chamak Dant Manjan', draw(c, w, h, deva) {         // tooth powder
    c.fillStyle = '#1a5a55'; c.fillRect(0, 0, w, h);
    star(c, w - 34, 30, 19, '#ebe4c8'); star(c, w - 60, 55, 8, '#dfb22a');
    word(c, 'CHAMAK', 92, 37, 32, '#ebe2c0', 150); word(c, 'DANT MANJAN', 92, 58, 17, '#dfb22a', 150);
    word(c, deva ? 'दाँत मोती जैसे' : 'Daant moti jaise', 92, h - 6, 13, '#b9ddd0', 160, deva ? devaFont : null);
  } },
  { name: 'Tota Chhaap Chai', draw(c, w, h, deva) {           // tea, with a steaming cup
    c.fillStyle = '#1d4628'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ebe2c0'; c.beginPath(); c.moveTo(16, 38); c.lineTo(54, 38); c.lineTo(48, 64); c.lineTo(22, 64); c.closePath(); c.fill();
    c.strokeStyle = '#ebe2c0'; c.lineWidth = 3.5; c.beginPath(); c.arc(56, 48, 7, -1.3, 1.5); c.stroke();
    c.lineWidth = 2; c.lineCap = 'round'; for (const sx of [27, 37, 46]) { c.beginPath(); c.moveTo(sx, 32); c.bezierCurveTo(sx - 5, 26, sx + 5, 20, sx, 13); c.stroke(); }
    word(c, 'TOTA CHHAAP', 148, 22, 17, '#dfb22a', 150); word(c, 'CHAI', 148, 57, 37, '#ebe2c0', 150);
    word(c, deva ? 'गरम चाय' : 'Garam Chai', 148, h - 6, 13, '#bcd9a8', 150, deva ? devaFont : null);
  } },
  { name: 'Jugnupur Mela', draw(c, w, h) {                    // the town fair, with a giant wheel
    c.fillStyle = '#272055'; c.fillRect(0, 0, w, h);
    const wx = w - 40, wy = 38, wr = 27;
    c.strokeStyle = '#8f87c9'; c.lineWidth = 2; c.beginPath(); c.moveTo(wx - 16, h); c.lineTo(wx, wy); c.lineTo(wx + 16, h); c.stroke();
    c.strokeStyle = '#d684ab'; c.beginPath(); c.arc(wx, wy, wr, 0, 7); c.stroke();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, px = wx + Math.cos(a) * wr, py = wy + Math.sin(a) * wr; c.lineWidth = 1.2; c.beginPath(); c.moveTo(wx, wy); c.lineTo(px, py); c.stroke(); c.fillStyle = k % 2 ? '#dfb22a' : '#e08db0'; c.fillRect(px - 4, py - 3, 8, 7); }
    word(c, 'JUGNUPUR', 84, 26, 20, '#dfb22a', 150); word(c, 'MELA', 84, 59, 36, '#e08db0', 150);
    word(c, 'Ghat Maidan', 84, h - 6, 13, '#cfc9ee', 150);
  } },
  { name: 'Choron se Savdhan', draw(c, w, h, deva) {          // a notice from the thana: beware of thieves
    c.fillStyle = '#bdb69b'; c.fillRect(0, 0, w, h); c.fillStyle = '#691915'; c.fillRect(0, 0, w, 21);
    word(c, 'KOTWALI THANA', w / 2, 16, 13, '#e6dbb2', w - 20);
    if (deva) word(c, 'चोरों से सावधान', w / 2, 53, 27, '#19244c', w - 16, devaFont); else word(c, 'CHORON SE SAVDHAN', w / 2, 52, 22, '#19244c', w - 16);
    word(c, 'Jugnupur Police \u00b7 Dial 100', w / 2, h - 7, 12, '#19244c', w - 20);
  } },
];
function paintHoarding(c, rect, art, deva) {
  const { x, y, w, h } = rect;
  c.save();
  c.beginPath(); c.rect(x - GUT / 2, y, w + GUT, h); c.clip();
  c.fillStyle = '#0e0f13'; c.fillRect(x - GUT / 2, y, w + GUT, h);              // dark frame
  c.beginPath(); c.rect(x + 3, y + 3, w - 6, h - 6); c.clip();
  c.translate(x + 3, y + 3);
  art.draw(c, w - 6, h - 6, deva);
  c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1.5; c.strokeRect(3.5, 3.5, w - 13, h - 13);   // the painter's inner line
  // the lamps above: brightest along the top, falling off down the board, with a pool under each lamp
  const g = c.createLinearGradient(0, 0, 0, h - 6);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#c4c4c4'); g.addColorStop(1, '#6c6c6c');
  c.globalCompositeOperation = 'multiply'; c.fillStyle = g; c.fillRect(0, 0, w - 6, h - 6);
  c.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 4; k++) {
    const lx = (w - 6) * (k + 0.5) / 4, p = c.createRadialGradient(lx, -4, 0, lx, -4, 44);
    p.addColorStop(0, 'rgba(255,232,180,0.24)'); p.addColorStop(1, 'rgba(255,232,180,0)');
    c.fillStyle = p; c.fillRect(lx - 44, 0, 88, 44);
  }
  c.restore();
}
function paintGlow(c, r) {   // a soft blob that fades to nothing at the edge of its rectangle
  c.save(); c.translate(r.x + r.w / 2, r.y + r.h / 2); c.scale(r.w / 2, r.h / 2);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, 'rgb(255,255,255)'); g.addColorStop(0.3, 'rgb(200,200,200)'); g.addColorStop(0.6, 'rgb(118,118,118)'); g.addColorStop(0.85, 'rgb(46,46,46)'); g.addColorStop(1, 'rgb(0,0,0)');
  c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
}

// The atlas texture is painted once and shared by every buildDressing() on the page.
let ATLAS = null;
function takeAtlas() {
  if (ATLAS) { ATLAS.refs++; return ATLAS; }
  if (typeof document === 'undefined') return null;
  let cv = null, c = null;
  try { cv = document.createElement('canvas'); cv.width = ATLAS_W; cv.height = ATLAS_H; c = cv.getContext('2d'); } catch (e) { c = null; }
  if (!c) return null;
  const L = layout(), deva = canDrawDevanagari();
  c.fillStyle = '#000'; c.fillRect(0, 0, ATLAS_W, ATLAS_H);
  c.fillStyle = BOARD; c.fillRect(0, 0, ATLAS_W, ROWS * ROW);   // unused cells are plain board, so nothing bright bleeds into a neighbour
  for (const hb of L.hoardings) if (hb.rect) paintHoarding(c, hb.rect, hb.art, deva);
  paintSigns(c, L, deva);
  paintGlow(c, L.glow);
  c.fillStyle = '#fff'; c.fillRect(L.white.x, L.white.y, L.white.w, L.white.h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;   // most boards are seen at a slant from the chase camera
  ATLAS = { tex, deva, refs: 1 };
  return ATLAS;
}
function dropAtlas() { if (ATLAS && --ATLAS.refs <= 0) { ATLAS.tex.dispose(); ATLAS = null; } }

// ---------------------------------------------------------------- geometry helpers
// Collects textured, tinted quads and bakes them into one BufferGeometry (one draw call).
class Quads {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; this.phase = 0; this.ph = []; }
  // corners counter-clockwise as seen from the front; uv is [u0, v0, u1, v1] laid over them in that order.
  // Every quad also records this.phase (0..1), which the flicker shader reads as the sign's own rhythm.
  quad(a, b, c, d, uv, rgb) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    this.uv.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    for (let k = 0; k < 4; k++) { this.col.push(rgb[0], rgb[1], rgb[2]); this.ph.push(this.phase); }
    this.idx.push(this.n, this.n + 1, this.n + 2, this.n, this.n + 2, this.n + 3); this.n += 4;
  }
  build(withPhase) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    if (withPhase) g.setAttribute('flick', new THREE.BufferAttribute(new Float32Array(this.ph), 1));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    return g;
  }
}
// A point on (or off) a facade: s along the wall to the right as seen from the road, y up, d out from the wall.
// A wall with normal (nx, nz) has its "right" along (nz, -nx), which is what keeps the lettering unmirrored.
const at = (f, s, y, d) => [f.x + f.nz * s + f.nx * d, y, f.z - f.nx * s + f.nz * d];
const wallQuad = (Q, f, s0, s1, y0, y1, d, uv, rgb) => Q.quad(at(f, s0, y0, d), at(f, s1, y0, d), at(f, s1, y1, d), at(f, s0, y1, d), uv, rgb);
// a patch of light on the road in front of the wall; the blob's centre lies on the wall line
const roadQuad = (Q, f, s0, s1, reach, uv, rgb) => { const vm = (uv[1] + uv[3]) / 2; Q.quad(at(f, s1, 0.02, 0), at(f, s0, 0.02, 0), at(f, s0, 0.02, reach), at(f, s1, 0.02, reach), [uv[2], vm, uv[0], uv[3]], rgb); };
// a small glowing block (five faces; the one against the wall is left out)
function lampBox(Q, f, s0, s1, y0, y1, d0, d1, uv, rgb) {
  Q.quad(at(f, s0, y0, d1), at(f, s1, y0, d1), at(f, s1, y1, d1), at(f, s0, y1, d1), uv, rgb);   // front
  Q.quad(at(f, s0, y1, d1), at(f, s1, y1, d1), at(f, s1, y1, d0), at(f, s0, y1, d0), uv, rgb);   // top
  Q.quad(at(f, s0, y0, d0), at(f, s1, y0, d0), at(f, s1, y0, d1), at(f, s0, y0, d1), uv, rgb);   // underside
  Q.quad(at(f, s1, y0, d1), at(f, s1, y0, d0), at(f, s1, y1, d0), at(f, s1, y1, d1), uv, rgb);   // right
  Q.quad(at(f, s0, y0, d0), at(f, s0, y0, d1), at(f, s0, y1, d1), at(f, s0, y1, d0), uv, rgb);   // left
}
const scaled = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

// joins small indexed geometries (position + normal) into one
function merge(parts) {
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of parts) {
    const p = g.attributes.position, n = g.attributes.normal, ix = g.index;
    for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); nor.push(n.getX(k), n.getY(k), n.getZ(k)); }
    for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + base);
    base += p.count; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  out.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return out;
}
// Rooftop shapes, shared by every build. Each stands on y = 0.
let ROOF = null;
function takeRoofShapes() {
  if (ROOF) { ROOF.refs++; return ROOF; }
  const bar = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
  const body = new THREE.CylinderGeometry(0.112, 0.122, 0.17, 10); body.translate(0, 0.085, 0);
  const lid = new THREE.CylinderGeometry(0.05, 0.062, 0.028, 8); lid.translate(0, 0.184, 0);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  // a TV aerial: mast, boom and four elements that get shorter towards the front
  const aerial = merge([bar(0.02, 0.34, 0.02, 0, 0.17, 0), bar(0.26, 0.014, 0.014, 0, 0.3, 0), bar(0.013, 0.013, 0.22, -0.115, 0.3, 0), bar(0.013, 0.013, 0.18, -0.04, 0.3, 0), bar(0.013, 0.013, 0.15, 0.035, 0.3, 0), bar(0.013, 0.013, 0.12, 0.11, 0.3, 0)]);
  ROOF = { tank: merge([body, lid]), box, aerial, refs: 1 };
  return ROOF;
}
function dropRoofShapes() { if (ROOF && --ROOF.refs <= 0) { ROOF.tank.dispose(); ROOF.box.dispose(); ROOF.aerial.dispose(); ROOF = null; } }

// Small shader changes, applied through onBeforeCompile. opts:
//   U      (optional) the game cuts a see-through circle into whatever stands between the camera and the player's
//          car (js/scene.js, makeBuildingMaterial). Given the same uniforms, dressing is cut the same way, so no
//          sign or water tank is left hanging in that hole.
//   light  additive glow must fade to nothing in fog. The stock fog fades to the fog colour, and adding that on
//          top of the scene would leave faint boxes in the distance.
//   clock  { value: seconds }: the tubes of the failing signs. Each sign carries its own phase in the `flick`
//          attribute, so one draw call holds them all and yet no two stutter in step.
const FOG_TO_BLACK = `#ifdef USE_FOG
          #ifdef FOG_EXP2
            gl_FragColor.rgb *= exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            gl_FragColor.rgb *= 1.0 - smoothstep( fogNear, fogFar, vFogDepth );
          #endif
        #endif`;
// Steady for most of its cycle (4 to 6 seconds long), then a burst of stutter; every other sign also goes dark
// for a moment first. The stutter is kept gentle on the eye: ten steps a second at most, dipping to dim, not to black.
const FLICKER = `{
          float cycF = fract( uFlick * ( 0.17 + 0.08 * flick ) + flick * 7.0 );
          float rndF = fract( sin( floor( uFlick * 10.0 + flick * 53.0 ) * 12.9898 + flick * 78.233 ) * 43758.5453 );
          vFlick = cycF > 0.3 ? 1.0 : ( cycF < 0.09 * step( 0.5, flick ) ? 0.0 : mix( 0.18, 1.0, step( 0.45, rndF ) ) );
        }`;
function tweak(mat, opts) {
  const U = opts.U, light = !!opts.light, clock = opts.clock;
  if (!U && !light && !clock) return mat;
  mat.onBeforeCompile = sh => {
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    if (light) fs = fs.replace('#include <fog_fragment>', FOG_TO_BLACK);
    if (clock) {
      sh.uniforms.uFlick = clock;
      vs = vs.replace('#include <common>', '#include <common>\nattribute float flick;\nuniform float uFlick;\nvarying float vFlick;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + FLICKER);
      fs = fs.replace('#include <common>', '#include <common>\nvarying float vFlick;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFlick;');
    }
    if (U) {
      sh.uniforms.uCut = U.uCut; sh.uniforms.uRes = U.uRes;
      vs = vs.replace('#include <common>', '#include <common>\nvarying float vCutDepth;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCutDepth = - mvPosition.z;');
      fs = fs.replace('#include <common>', '#include <common>\nvarying float vCutDepth;\nuniform vec3 uCut;\nuniform vec2 uRes;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec2 spC = gl_FragCoord.xy / uRes;
          float cdC = length( ( spC - uCut.xy ) * vec2( uRes.x / uRes.y, 1.0 ) );
          if ( vCutDepth < uCut.z - 0.2 && cdC < 0.15 ) {
            if ( cdC < 0.105 || mod( floor( gl_FragCoord.x ) + floor( gl_FragCoord.y ), 2.0 ) < 0.5 ) discard;
          }
        }`);
    }
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'dressing' + (U ? 'Cut' : '') + (light ? 'Light' : '') + (clock ? 'Flicker' : '');
  return mat;
}

// same hash as js/world.js, used only when the caller passes none
function ownHash(i, j) {
  let n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- choosing where things go (no rendering)
// Picks the hoardings and shop signs for a world. Returns plain records; nothing here touches three.js.
function planSigns(W, rnd) {
  const L = layout();
  const facades = Array.isArray(W && W.facades) ? W.facades : [];
  // things a board should not hang behind: lamp posts and the mouths of hideouts
  const blocks = [];
  const block = (x0, y0, x1, y1, pad) => { if (isFinite(x0 + y0 + x1 + y1)) blocks.push({ x0, y0, x1, y1, pad }); };
  for (const p of (Array.isArray(W && W.lamps) ? W.lamps : [])) if (p && p.post !== false) block(p.x - 0.05, p.y - 0.05, p.x + 0.05, p.y + 0.05, 0.12);
  for (const h of (Array.isArray(W && W.hides) ? W.hides : [])) if (h && h.bay && !h.grove) block(h.bay.x0, h.bay.y0, h.bay.x1, h.bay.y1, 0.25);
  // how far a board centred on the facade may reach to either side
  const freeHalf = f => {
    let half = f.len / 2 - END_GAP;
    for (const o of blocks) {
      const sa = (o.x0 - f.x) * f.nz - (o.y0 - f.z) * f.nx, sb = (o.x1 - f.x) * f.nz - (o.y1 - f.z) * f.nx;
      const da = (o.x0 - f.x) * f.nx + (o.y0 - f.z) * f.nz, db = (o.x1 - f.x) * f.nx + (o.y1 - f.z) * f.nz;
      const s0 = Math.min(sa, sb), s1 = Math.max(sa, sb);
      if (Math.max(da, db) < -0.3 || Math.min(da, db) > 0.45 || s1 < -half || s0 > half) continue;
      if (s0 <= 0 && s1 >= 0) return 0;
      half = Math.min(half, (s0 > 0 ? s0 : -s1) - o.pad);
    }
    return half;
  };
  const list = [];
  facades.forEach((src, i) => {
    if (!src || !(src.len > 0) || !(src.h > 0) || (!src.nx && !src.ny) || !isFinite(src.x + src.y + src.nx + src.ny)) return;
    const side = src.nx > 0 ? 0 : src.nx < 0 ? 1 : src.ny > 0 ? 2 : 3;
    const f = { i, x: src.x, z: src.y, nx: src.nx, nz: src.ny, len: src.len, h: src.h, kind: src.kind, district: src.district, kx: Math.round(src.x * 4) + side * 4096, kz: Math.round(src.y * 4), half: 0 };
    f.half = freeHalf(f);
    list.push(f);
  });

  // --- hoardings: tall main-road walls in the two busiest districts, spread out across town
  const hoardings = [], taken = new Set();
  const arts = L.hoardings.filter(hb => hb.rect);
  for (const pass of [{ h: 1.1, gap: 9 }, { h: 1.1, gap: 5 }, { h: 1.0, gap: 3 }]) {
    const cands = list.filter(f => !taken.has(f) && f.kind === 'main' && voc().hoardIn.indexOf(f.district) >= 0 && f.h >= pass.h && f.half >= HOARD_SW / 2 + 0.05)
      .map(f => ({ f, key: rnd(f.kx, f.kz, 3) * (f.district === 'sarafa' ? 0.45 : 1) })).sort((a, b) => a.key - b.key || a.f.i - b.f.i);   // the Sarafa's walls are lower and fewer, so they go first
    for (const { f } of cands) {
      if (hoardings.length >= Math.min(HOARDING_TARGET, arts.length ? 8 : 0)) break;
      if (hoardings.some(o => Math.hypot(o.f.x - f.x, o.f.z - f.z) < pass.gap)) continue;
      const y1 = f.h - 0.13;
      hoardings.push({ f, art: arts[hoardings.length % arts.length], w: HOARD_SW, h: HOARD_SH, y0: y1 - HOARD_SH, y1 }); taken.add(f);
    }
  }

  // --- shop signs: a weighted draw over every facade with room for a board
  const pool = [];
  for (const f of list) {
    const wgt = voc().weights[f.district] || 0, hmax = Math.min(SIGN_H1, f.h - ROOF_GAP - SIGN_Y), room = Math.min(SIGN_W1, f.half * 2);
    if (taken.has(f) || wgt <= 0 || hmax < SIGN_H0 || room < SIGN_W0) continue;
    pool.push({ f, hmax, room, key: rnd(f.kx, f.kz, 1) / wgt });   // lowest key first: a wall's chance is in proportion to its district's weight
  }
  pool.sort((a, b) => a.key - b.key || a.f.i - b.f.i);
  const usedPair = new Set(), usedSingle = L.singles.map(() => 0), signs = [];
  const pickNeon = u => { let t = u * NEON_ODDS.reduce((a, b) => a + b, 0); for (let k = 0; k < NEON.length; k++) { t -= NEON_ODDS[k]; if (t <= 0) return k; } return 0; };
  for (const { f, hmax, room } of pool) {
    if (signs.length >= (voc().target || SIGN_TARGET)) break;
    // the board's width in atlas pixels must let it be 0.9 to 1.8 wide at a height of 0.22 to hmax
    const pMin = SIGN_W0 * ROW / hmax, pMax = room * ROW / SIGN_H0;
    const fits = p => p >= pMin - 1e-6 && p <= pMax + 1e-6;
    let parts = null, text = '', tint = -1;
    const trySingle = (si, anyCount) => {
      const s = L.singles[si];
      if (!s.rect || !fits(s.w) || (s.d && s.d.indexOf(f.district) < 0) || (!anyCount && usedSingle[si] >= s.max)) return false;
      usedSingle[si]++; parts = [{ cell: s }]; text = s.t; tint = s.tint === undefined ? -1 : s.tint; return true;
    };
    const tryPair = (ni, ti) => {
      const n = L.names[ni], t = L.trades[ti];
      if (!n.rect || !t.rect || !fits(n.w + t.w) || usedPair.has(ni * 100 + ti) || (n.only && n.only.indexOf(t.t) < 0)) return false;
      usedPair.add(ni * 100 + ti); parts = [{ cell: n }, { cell: t }]; text = n.t + ' ' + t.t; tint = t.tint === undefined ? -1 : t.tint; return true;
    };
    for (let a = 0; a < 12 && !parts; a++) {
      if (rnd(f.kx, f.kz, 20 + a * 4) < 0.32) trySingle(Math.floor(rnd(f.kx, f.kz, 21 + a * 4) * L.singles.length), false);
      else {
        // trades that belong in this district come up more often
        let total = 0; for (const t of L.trades) total += t.d.indexOf(f.district) >= 0 ? t.home : 1;
        let u = rnd(f.kx, f.kz, 22 + a * 4) * total, ti = 0;
        for (; ti < L.trades.length - 1; ti++) { u -= L.trades[ti].d.indexOf(f.district) >= 0 ? L.trades[ti].home : 1; if (u <= 0) break; }
        tryPair(Math.floor(rnd(f.kx, f.kz, 23 + a * 4) * L.names.length), ti);
      }
    }
    // nothing came up: take the first board that fits, searching from a spot that differs from wall to wall
    const nS = L.singles.length, nN = L.names.length, nT = L.trades.length, from = Math.floor(rnd(f.kx, f.kz, 13) * 1000);
    for (let k = 0; k < nS && !parts; k++) trySingle((k + from) % nS, false);
    for (let k = 0; k < nN * nT && !parts; k++) tryPair((Math.floor(k / nT) + from) % nN, (k + from) % nT);
    for (let k = 0; k < nS && !parts; k++) trySingle((k + from) % nS, true);
    if (!parts) continue;
    const px = parts.reduce((a, p) => a + p.cell.w, 0);
    const lo = Math.max(SIGN_H0, SIGN_W0 * ROW / px), hi = Math.max(lo, Math.min(hmax, room * ROW / px));
    const h = Math.max(lo, hi * (0.9 + 0.1 * rnd(f.kx, f.kz, 5))), w = px * h / ROW;
    const y0 = SIGN_Y + rnd(f.kx, f.kz, 6) * Math.max(0, Math.min(0.14, f.h - ROOF_GAP - h - SIGN_Y));
    if (tint < 0 || rnd(f.kx, f.kz, 7) < 0.25) tint = pickNeon(rnd(f.kx, f.kz, 8));
    parts.forEach((p, k) => { p.tint = tint; p.w = p.cell.w * h / ROW; if (k === 1 && rnd(f.kx, f.kz, 9) < 0.3) p.tint = (tint + 1 + Math.floor(rnd(f.kx, f.kz, 10) * (NEON.length - 1))) % NEON.length; });
    signs.push({ f, parts, text, tint, w, h, y0, y1: y0 + h, flicker: 0, phase: 0 });
  }
  // one in ten flickers, each to its own rhythm (phase 0..1; the upper half also black out for a moment)
  signs.map(s => ({ s, key: rnd(s.f.kx, s.f.kz, 11) })).sort((a, b) => a.key - b.key || a.s.f.i - b.s.f.i)
    .slice(0, Math.round(signs.length * FLICKER_SHARE)).forEach((o, k, all) => { o.s.flicker = 1; o.s.phase = (k + 0.5) / all.length; });
  return { signs, hoardings };
}

// Picks the rooftop clutter for a world: which roofs, what, and exactly where. Plain records again.
function planRoofs(W, rnd) {
  const boxes = Array.isArray(W && W.boxes) ? W.boxes : [];
  const roofs = boxes.filter(b => b && b.style !== 'bagh' && b.style !== 'ghat' && !b.gable && !b.noRoof && b.h >= 0.5 && b.w >= 0.5 && b.d >= 0.5);
  const ix = b => Math.round(b.x * 2), iz = b => Math.round(b.y * 2);
  const ranked = (salt, weights, minSide) => roofs.filter(b => (weights[b.style] === undefined ? 1 : weights[b.style]) > 0 && Math.min(b.w, b.d) >= minSide)
    .map((b, i) => ({ b, i, key: rnd(ix(b), iz(b), salt) / (weights[b.style] === undefined ? 1 : weights[b.style]) }))
    .sort((a, c) => a.key - c.key || a.i - c.i).map(o => o.b);
  // finds a free footprint (fw x fd) wholly on the roof of b; `corner` tucks it into a corner
  const placed = new Map();
  const place = (b, fw, fd, salt, corner) => {
    const x0 = b.x + ROOF_EDGE + fw / 2, x1 = b.x + b.w - ROOF_EDGE - fw / 2, z0 = b.y + ROOF_EDGE + fd / 2, z1 = b.y + b.d - ROOF_EDGE - fd / 2;
    if (x1 < x0 - 1e-9 || z1 < z0 - 1e-9) return null;
    const mine = placed.get(b) || [];
    for (let a = 0; a < 6; a++) {
      let u = rnd(ix(b), iz(b), salt + a * 2), v = rnd(ix(b), iz(b), salt + a * 2 + 1);
      if (corner) { u = u < 0.5 ? 0 : 1; v = v < 0.5 ? 0 : 1; }
      const x = x0 + Math.max(0, x1 - x0) * u, z = z0 + Math.max(0, z1 - z0) * v;
      if (mine.every(r => x + fw / 2 + 0.04 <= r.x0 || x - fw / 2 - 0.04 >= r.x1 || z + fd / 2 + 0.04 <= r.z0 || z - fd / 2 - 0.04 >= r.z1)) {
        mine.push({ x0: x - fw / 2, x1: x + fw / 2, z0: z - fd / 2, z1: z + fd / 2 }); placed.set(b, mine);
        return { x, z };
      }
    }
    return null;
  };
  const stairs = [], tanks = [], aerials = [];
  // stair-heads: the little room where the stairs come out, in the building's own colour
  for (const b of ranked(31, { kotwali: 1.2, sarafa: 1.2, afsar: 1, patri: 0.8, mill: 0.3, huts: 0 }, 1.0)) {
    if (stairs.length >= STAIRS) break;
    const turn = rnd(ix(b), iz(b), 32) < 0.5, a = 0.42 + 0.16 * rnd(ix(b), iz(b), 33), c = 0.52 + 0.2 * rnd(ix(b), iz(b), 34);
    const w = turn ? c : a, d = turn ? a : c, p = place(b, w, d, 40, true);
    if (p) stairs.push({ b, x: p.x, z: p.z, y: b.h, w, d, h: 0.26 + 0.07 * rnd(ix(b), iz(b), 35) });
  }
  // water tanks: a black or blue drum on a low masonry stand
  for (const b of ranked(51, { afsar: 1.3, kotwali: 1.2, sarafa: 1.2, patri: 1, mill: 0.6, huts: 0.25 }, 0.5)) {
    if (tanks.length >= TANKS) break;
    const s = 0.88 + 0.24 * rnd(ix(b), iz(b), 52), foot = 0.27 * s, p = place(b, foot, foot, 60, false);
    if (p) tanks.push({ b, x: p.x, z: p.z, y: b.h, s, foot, stand: 0.07 + 0.05 * rnd(ix(b), iz(b), 53), blue: rnd(ix(b), iz(b), 54) < 0.42 });
  }
  // TV aerials, all turned roughly the same way, towards the transmitter
  for (const b of ranked(71, { huts: 1.2 }, 0.5)) {
    if (aerials.length >= AERIALS) break;
    const s = 0.85 + 0.15 * rnd(ix(b), iz(b), 72), p = place(b, 0.33 * s, 0.33 * s, 80, false);   // 0.33: the tips of the longest element, whichever way it is turned
    if (p) aerials.push({ b, x: p.x, z: p.z, y: b.h, s, a: 0.6 + (rnd(ix(b), iz(b), 73) - 0.5) * 0.7 });
  }
  return { stairs, tanks, aerials };
}

// ---------------------------------------------------------------- the exported builder
const _dummy = new THREE.Object3D();

// Builds all the night dressing for world W and adds it to the scene.
//   W    the world from buildWorld(): uses W.facades and W.boxes (and W.lamps / W.hides, when present, to keep
//        boards from hanging behind a lamp post or beside a hideout door)
//   ctx  { hash2(i, j) } deterministic 0..1 hash, so every player sees the same town.
//        Optional: ctx.U = { uCut, uRes }, the uniforms js/scene.js gives the buildings; with them the
//        dressing gets the same see-through circle around the player's car.
// Returns { update(dt, time), dispose() } plus read-only extras: stats (counts), debug (where everything
// was put) and group (the THREE.Group holding all of it).
export function buildDressing(scene, W, ctx) {
  const cv = ctx && ctx.vocab;
  const next = cv && Array.isArray(cv.names) && Array.isArray(cv.trades) && Array.isArray(cv.singles)
    ? { names: cv.names, trades: cv.trades, singles: cv.singles, hoardings: [], weights: cv.weights || {}, hoardIn: [], script: cv.script || 'latin', target: cv.target || SIGN_TARGET } : null;
  if ((next || VOCAB) && JSON.stringify(next) !== JSON.stringify(VOCAB)) { VOCAB = next; LAYOUT = null; }
  const hash = ctx && typeof ctx.hash2 === 'function' ? ctx.hash2 : ownHash;
  const rnd = (a, b, salt) => hash(a * 3 + salt * 7919, b * 5 + salt * 104729);
  const U = ctx && ctx.U && ctx.U.uCut && ctx.U.uRes ? ctx.U : null;
  const group = new THREE.Group(); group.name = 'dressing';
  const own = [];                      // geometries, materials and instanced meshes made here
  const stats = { signs: 0, flickering: 0, hoardings: 0, glowQuads: 0, tanks: 0, stairHeads: 0, aerials: 0, roofInstances: 0, drawCalls: 0, textureBytes: 0, devanagari: false, cellsLeftOut: 0 };
  const debug = { signs: [], hoardings: [], roof: [], atlas: layout() };
  const clock = { value: 0 };          // seconds, read by the flicker shader
  let atlas = null, roofShapes = null, gone = false;
  const keep = x => { own.push(x); return x; };
  const addMesh = (geo, mat, order) => { const m = new THREE.Mesh(keep(geo), keep(mat)); m.frustumCulled = false; m.renderOrder = order; group.add(m); stats.drawCalls++; return m; };

  // ---- shop signs, hoardings and their light
  function signs() {
    const plan = planSigns(W, rnd), L = layout();
    stats.cellsLeftOut = L.missing;
    for (const s of plan.signs) debug.signs.push({ text: s.text, x: s.f.x, z: s.f.z, nx: s.f.nx, nz: s.f.nz, w: s.w, h: s.h, y0: s.y0, y1: s.y1, off: s.flicker ? OFF_LIT : OFF_BOARD, flicker: s.flicker, phase: s.phase, district: s.f.district, wallH: s.f.h, wallLen: s.f.len });
    for (const hb of plan.hoardings) debug.hoardings.push({ text: hb.art.art.name, x: hb.f.x, z: hb.f.z, nx: hb.f.nx, nz: hb.f.nz, w: hb.w, h: hb.h, y0: hb.y0, y1: hb.y1, off: OFF_HOARD, district: hb.f.district, wallH: hb.f.h, wallLen: hb.f.len });
    atlas = takeAtlas();
    if (!atlas) return;                // no canvas here (or no 2D context): the town simply goes without boards
    stats.devanagari = atlas.deva; stats.textureBytes = ATLAS_W * ATLAS_H * 4;
    const boards = new Quads(), glow = new Quads(), lit = new Quads();   // lit: the tubes (and glow) of the flickering signs
    const uvGlow = uvOf(L.glow), uvWhite = uvOf(L.white), wu = (uvWhite[0] + uvWhite[2]) / 2, wv = (uvWhite[1] + uvWhite[3]) / 2, uvDot = [wu, wv, wu, wv];
    // light on the wall around a board and on the road under it, kept inside the board's own stretch of wall
    const spill = (Q, f, w, y0, y1, rgb) => {
      const reach = Math.min(f.len / 2, w / 2 + 0.32), top = Math.min(f.h - 0.01, y1 + 0.28), bottom = Math.max(0.03, y0 - 0.42);
      wallQuad(Q, f, -reach, reach, bottom, top, OFF_GLOW, uvGlow, scaled(rgb, WALL_GLOW));
      roadQuad(Q, f, -reach, reach, ROAD_REACH, uvGlow, scaled(rgb, ROAD_GLOW));
      stats.glowQuads += 2;
    };
    for (const s of plan.signs) {
      const f = s.f, Q = s.flicker ? lit : boards;
      let x = -s.w / 2;
      lit.phase = s.phase;
      for (const p of s.parts) {
        const uv = uvOf(p.cell.rect), col = NEON[p.tint].lit;
        if (s.flicker) wallQuad(boards, f, x, x + p.w, s.y0, s.y1, OFF_BOARD, uv, scaled(col, OFF_LEVEL));   // the dead tubes stay faintly visible
        wallQuad(Q, f, x, x + p.w, s.y0, s.y1, s.flicker ? OFF_LIT : OFF_BOARD, uv, col);
        x += p.w;
      }
      spill(s.flicker ? Q : glow, f, s.w, s.y0, s.y1, NEON[s.tint].soft);
      stats.signs++; if (s.flicker) stats.flickering++;
    }
    for (const hb of plan.hoardings) {
      const f = hb.f;
      wallQuad(boards, f, -hb.w / 2, hb.w / 2, hb.y0, hb.y1, OFF_HOARD, uvOf(hb.art.rect), HOARD_RGB);
      for (let k = 0; k < 4; k++) { const s = hb.w * ((k + 0.5) / 4 - 0.5); lampBox(boards, f, s - 0.03, s + 0.03, hb.y1 + 0.025, hb.y1 + 0.06, 0.02, 0.07, uvDot, LAMP_RGB); }
      roadQuad(glow, f, -hb.w / 2 - 0.2, hb.w / 2 + 0.2, ROAD_REACH, uvGlow, scaled(LAMP_RGB, ROAD_GLOW * 0.12)); stats.glowQuads++;
      stats.hoardings++;
    }
    const base = { map: atlas.tex, vertexColors: true };
    const light = { map: atlas.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    if (boards.n) addMesh(boards.build(false), tweak(new THREE.MeshBasicMaterial(base), { U }), 0);
    if (glow.n) addMesh(glow.build(false), tweak(new THREE.MeshBasicMaterial(light), { U, light: true }), 2);
    if (lit.n) addMesh(lit.build(true), tweak(new THREE.MeshBasicMaterial(light), { U, light: true, clock }), 3);
  }

  // ---- rooftop clutter
  function roofs() {
    const plan = planRoofs(W, rnd);
    if (!plan.tanks.length && !plan.stairs.length && !plan.aerials.length) return;
    roofShapes = takeRoofShapes();
    const mat = tweak(keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), { U });
    const instanced = (geo, count) => { const im = keep(new THREE.InstancedMesh(geo, mat, count)); im.frustumCulled = false; group.add(im); stats.drawCalls++; stats.roofInstances += count; return im; };
    const put = (im, k, x, y, z, sx, sy, sz, ry, hex, dim) => {
      _dummy.position.set(x, y, z); _dummy.scale.set(sx, sy, sz); _dummy.rotation.set(0, ry, 0); _dummy.updateMatrix();
      im.setMatrixAt(k, _dummy.matrix); im.setColorAt(k, _c.setHex(hex).multiplyScalar(dim));
    };
    if (plan.tanks.length) {
      const im = instanced(roofShapes.tank, plan.tanks.length);
      plan.tanks.forEach((t, k) => {
        put(im, k, t.x, t.y + t.stand, t.z, t.s, t.s, t.s, 0, t.blue ? 0x22487a : 0x17191d, 1);
        debug.roof.push({ kind: 'tank', x0: t.x - t.foot / 2, x1: t.x + t.foot / 2, z0: t.z - t.foot / 2, z1: t.z + t.foot / 2, top: t.stand + 0.198 * t.s, box: t.b });
      });
      im.instanceColor.needsUpdate = true; stats.tanks = plan.tanks.length;
    }
    if (plan.tanks.length + plan.stairs.length) {
      const im = instanced(roofShapes.box, plan.tanks.length + plan.stairs.length);
      plan.tanks.forEach((t, k) => put(im, k, t.x, t.y, t.z, t.foot, t.stand, t.foot, 0, 0x565960, 1));
      plan.stairs.forEach((s, k) => {
        put(im, plan.tanks.length + k, s.x, s.y, s.z, s.w, s.h, s.d, 0, typeof s.b.c === 'number' ? s.b.c : 0x7a7f8c, 0.62);
        debug.roof.push({ kind: 'stair-head', x0: s.x - s.w / 2, x1: s.x + s.w / 2, z0: s.z - s.d / 2, z1: s.z + s.d / 2, top: s.h, box: s.b });
      });
      im.instanceColor.needsUpdate = true; stats.stairHeads = plan.stairs.length;
    }
    if (plan.aerials.length) {
      const im = instanced(roofShapes.aerial, plan.aerials.length);
      plan.aerials.forEach((t, k) => {
        put(im, k, t.x, t.y, t.z, t.s, t.s, t.s, t.a, 0x767c87, 1);
        debug.roof.push({ kind: 'aerial', x0: t.x - 0.165 * t.s, x1: t.x + 0.165 * t.s, z0: t.z - 0.165 * t.s, z1: t.z + 0.165 * t.s, top: 0.34 * t.s, box: t.b });
      });
      im.instanceColor.needsUpdate = true; stats.aerials = plan.aerials.length;
    }
  }

  // a fault in one half must never stop the game from starting
  try { signs(); } catch (e) { console.warn('dressing: shop signs left out', e); }
  try { roofs(); } catch (e) { console.warn('dressing: rooftop clutter left out', e); }
  if (scene && typeof scene.add === 'function') scene.add(group);

  // Flickers the failing signs: all it does is hand the time (seconds) to their shader. dt is not needed.
  // The clock wraps every 1000 s so the shader's arithmetic stays exact on phones. Allocates nothing.
  function update(dt, time) {
    const t = typeof time === 'number' && isFinite(time) ? time : 0;
    clock.value = t - 1000 * Math.floor(t / 1000);
  }

  // Takes everything out of the scene and frees it (the shared atlas and roof shapes go with the last user).
  function dispose() {
    if (gone) return;
    gone = true;
    group.removeFromParent();
    for (const x of own) x.dispose();
    own.length = 0; group.clear();
    if (atlas) dropAtlas();
    if (roofShapes) dropRoofShapes();
    atlas = roofShapes = null;
  }

  return { update, dispose, stats, debug, group };
}
