// Builds the town you drive through: wet painted ground that reacts to headlights, instanced buildings
// with lit windows, landmarks, street lamps with light cones, loot markers, hideouts and labels.
import * as THREE from '../vendor/three.module.min.js';
import { N, CS, T, LANE, hash2 } from './world.js';
import { buildHideout, kindFor } from './hideouts.js';
import { CFG } from './config.js';

const FONT = '"Baloo 2","Trebuchet MS","Segoe UI",sans-serif';

export const COLORS = {
  fog: 0x0a0f1c, loot: 0xf3b43f, locked: 0xb04a4a, escape: 0x3bc98b, hide: 0xad90ff,
  police: 0x6a98ff, route: 0xff6f9f, alarm: 0xff4040,
};

// ---------------------------------------------------------------- ground painting (three maps)
function drawLanes(l, S, map, W, clipMask) {
  l.lineCap = 'round'; l.lineJoin = 'round';
  const path = pts => { l.beginPath(); pts.forEach((p, k) => k ? l.lineTo(p.x * S, p.y * S) : l.moveTo(p.x * S, p.y * S)); };
  const stroke = (pts, w, col, dash) => { path(pts); l.lineWidth = w * S; l.strokeStyle = col; l.setLineDash(dash ? dash.map(d => d * S) : []); l.stroke(); l.setLineDash([]); };
  // park grass with darker and lighter patches
  l.fillStyle = '#132a1c'; l.fillRect(24 * S, 52 * S, 24 * S, 24 * S);
  for (let k = 0; k < 280; k++) {
    const x = 24.5 + hash2(k, 3) * 23, y = 52.5 + hash2(k, 9) * 23, r = 0.4 + hash2(k, 17) * 1.3;
    l.fillStyle = hash2(k, 23) > 0.5 ? 'rgba(34,78,46,0.35)' : 'rgba(6,18,10,0.4)'; l.beginPath(); l.arc(x * S, y * S, r * S, 0, 7); l.fill();
  }
  // thana yard paving and bus-stand bays
  l.fillStyle = '#30364a'; l.fillRect(53 * S, 37 * S, 10 * S, 10 * S);
  l.strokeStyle = 'rgba(255,255,255,0.05)'; l.lineWidth = 1;
  for (let v = 53.5; v < 63; v += 1) { l.beginPath(); l.moveTo(v * S, 37 * S); l.lineTo(v * S, 47 * S); l.stroke(); l.beginPath(); l.moveTo(53 * S, (v - 16) * S); l.lineTo(63 * S, (v - 16) * S); l.stroke(); }
  l.fillStyle = '#272a33'; l.fillRect(88 * S, 44 * S, 10 * S, 18 * S);
  l.strokeStyle = 'rgba(240,220,140,0.2)'; l.lineWidth = 0.08 * S;
  for (let v = 45.5; v < 62; v += 1.6) { l.beginPath(); l.moveTo(88.6 * S, v * S); l.lineTo(90.2 * S, v * S); l.stroke(); l.beginPath(); l.moveTo(95.8 * S, v * S); l.lineTo(97.4 * S, v * S); l.stroke(); }
  const alleyCol = { kotwali: '#282f42', sarafa: '#2f2b2b', patri: '#2c2a24', afsar: '#252d40', basti: '#322922', ghat: '#263333', bagh: '#2e312c' };
  const kinds = k => map.roads.filter(r => r.kind === k);
  for (const r of kinds('drain')) { const p = r.points.map(q => ({ x: q.x, y: Math.min(q.y, 93.2) })); stroke(p, 2.5, '#454e64'); stroke(p, 2.1, '#0b0e17'); stroke(p, 0.3, 'rgba(70,110,150,0.3)', [0.9, 1.7]); }
  for (const r of kinds('alley')) stroke(r.points, 1.64, alleyCol[W.districtAt(r.points[0].x, r.points[0].y)]);
  for (const r of map.special_routes) if (r.name === 'Tirpal Surang') stroke(r.points, 1.64, '#2a2626');
  for (const g of W.galis) { stroke(g.points, 1.54, '#2a2228'); }
  for (const r of kinds('street')) stroke(r.points, 2.04, r.name === 'Bagh ki Pagdandi' ? '#3d3c35' : '#2e3447');
  for (const r of kinds('plank')) { stroke(r.points, 1.6, '#5e4a34'); stroke(r.points, 1.6, 'rgba(0,0,0,0.25)', [0.12, 0.3]); }
  for (const r of kinds('main')) stroke(r.points, 3.06, '#3a4259');
  for (const r of kinds('main')) { stroke(r.points, 2.76, '#30374b'); stroke(r.points, 0.1, '#9aa1b8', [1.0, 1.4]); }
  for (const r of kinds('bridge')) stroke(r.points, 3.06, '#40485f');
  if (clipMask) { l.globalCompositeOperation = 'destination-in'; l.drawImage(clipMask, 0, 0); l.globalCompositeOperation = 'source-over'; }
}

export function paintGround(size, map, W) {
  const S = size / 100, px = CS * S;
  const mk = (w = size) => { const c = document.createElement('canvas'); c.width = c.height = w; return c; };
  // ---- colour
  const alb = mk(), c = alb.getContext('2d');
  c.fillStyle = '#070a12'; c.fillRect(0, 0, size, size);
  const base = { kotwali: '#262d3f', sarafa: '#2c292a', patri: '#2a2822', afsar: '#232b3d', basti: '#2d251f', ghat: '#222e2e', bagh: '#152a1c' };
  const mask = mk(), m = mask.getContext('2d'); m.fillStyle = '#fff';
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = W.type[j * N + i], x = (i + 0.5) * CS, y = (j + 0.5) * CS;
    if (t === T.WALK || t === T.CAGE || t === T.BAY || (t === T.PROP && W.inPark(x, y))) { c.fillStyle = base[W.districtAt(x, y)]; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); m.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
    else if (t === T.WATER) { c.fillStyle = '#0b2644'; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
    else if (t === T.RAIL) { c.fillStyle = '#17181d'; c.fillRect(i * px, j * px, px + 0.6, px + 0.6); }
  }
  const lay = mk(); drawLanes(lay.getContext('2d'), S, map, W, mask); c.drawImage(lay, 0, 0);
  // hideout bay floors: oil-stained concrete
  for (const h of W.hides) if (h.bay && !h.grove) { c.fillStyle = '#1d2029'; c.fillRect(h.bay.x0 * S, h.bay.y0 * S, (h.bay.x1 - h.bay.x0) * S, (h.bay.y1 - h.bay.y0) * S); c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(h.x * S, h.y * S, 0.35 * S, 0.5 * S, 0, 0, 7); c.fill(); }
  // rails and river detail
  c.strokeStyle = '#2a2420'; c.lineWidth = 0.12 * S;
  for (let x = 0; x < 100; x += 0.55) { c.beginPath(); c.moveTo(x * S, 3.6 * S); c.lineTo(x * S, 4.4 * S); c.stroke(); }
  c.strokeStyle = '#7b8196'; c.lineWidth = 0.06 * S;
  for (const y of [3.82, 4.18]) { c.beginPath(); c.moveTo(0, y * S); c.lineTo(100 * S, y * S); c.stroke(); }
  c.strokeStyle = 'rgba(120,170,220,0.16)'; c.lineWidth = 0.06 * S;
  for (let k = 0; k < 150; k++) { const x = hash2(k, 51) * 100, y = 94.9 + hash2(k, 57) * 4.9, w = 0.6 + hash2(k, 61) * 1.8; c.beginPath(); c.moveTo(x * S, y * S); c.lineTo((x + w) * S, y * S); c.stroke(); }
  c.fillStyle = '#1b2134'; c.fillRect(W.cage.x0 * S, W.cage.y0 * S, (W.cage.x1 - W.cage.x0) * S, (W.cage.y1 - W.cage.y0) * S);
  // soft dark edges where the road meets a wall (cheap ambient occlusion); skipped where canvas blur is missing
  if ('filter' in c) {
    const ao = mk(400), a = ao.getContext('2d'); a.fillStyle = '#000';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const t = W.type[j * N + i]; if (t === T.BLDG || t === T.MARK) a.fillRect(i * 2, j * 2, 2, 2); }
    c.save(); c.filter = `blur(${(0.5 * S).toFixed(1)}px)`; c.globalAlpha = 0.6; c.drawImage(ao, 0, 0, size, size); c.restore();
  }
  // ---- light (emissive): lamp pools, markers, shortcut trails
  const emi = mk(), e = emi.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  e.lineCap = 'round';
  for (const g of W.galis) { e.beginPath(); g.points.forEach((p, k) => k ? e.lineTo(p.x * S, p.y * S) : e.moveTo(p.x * S, p.y * S)); e.lineWidth = 0.13 * S; e.strokeStyle = 'rgba(255,111,159,0.55)'; e.setLineDash([0.45 * S, 0.45 * S]); e.stroke(); e.setLineDash([]); }
  const ring = (x, y, r, col, w, dash) => { e.beginPath(); e.arc(x * S, y * S, r * S, 0, Math.PI * 2); e.lineWidth = w * S; e.strokeStyle = col; e.setLineDash(dash ? dash.map(d => d * S) : []); e.stroke(); e.setLineDash([]); };
  for (const s of W.sites) { ring(s.x, s.y, 1.1, 'rgba(243,180,63,0.8)', 0.08); ring(s.x, s.y, 0.85, 'rgba(243,180,63,0.3)', 0.05, [0.3, 0.2]); }
  for (const x of W.escapes) { ring(x.x, x.y, 1.35, 'rgba(59,201,139,0.9)', 0.1); ring(x.x, x.y, 1.0, 'rgba(59,201,139,0.35)', 0.06, [0.35, 0.25]); }
  for (const v of W.levers) ring(v.x, v.y, 0.6, 'rgba(106,152,255,0.9)', 0.07);
  for (const h of W.hides) { // violet chevrons on the lane, pointing at each hideout door
    const nx = h.bay.nx, ny = h.bay.ny, tx = -ny, ty = nx;
    e.strokeStyle = 'rgba(173,144,255,0.9)'; e.lineWidth = 0.08 * S; e.lineJoin = 'round';
    for (const off of [-0.75, -0.4]) { const cx = h.mouth.x + nx * off, cy = h.mouth.y + ny * off; e.beginPath(); e.moveTo((cx + tx * 0.4 - nx * 0.2) * S, (cy + ty * 0.4 - ny * 0.2) * S); e.lineTo((cx + nx * 0.12) * S, (cy + ny * 0.12) * S); e.lineTo((cx - tx * 0.4 - nx * 0.2) * S, (cy - ty * 0.4 - ny * 0.2) * S); e.stroke(); }
  }
  e.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col, a) => {
    const g = e.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
    const rr = (col >> 16) & 255, gg = (col >> 8) & 255, bb = col & 255;
    g.addColorStop(0, `rgba(${rr},${gg},${bb},${a})`); g.addColorStop(0.45, `rgba(${rr},${gg},${bb},${a * 0.38})`); g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    e.fillStyle = g; e.fillRect((x - r) * S, (y - r) * S, 2 * r * S, 2 * r * S);
  };
  for (const p of W.lamps) glow(p.x + p.dx * 0.5, p.y + p.dy * 0.5, p.r, p.c, p.post ? 0.3 : 0.17);
  for (const s of W.sites) glow(s.x, s.y, 2.0, 0xf3b43f, 0.16);
  for (const x of W.escapes) glow(x.x, x.y, 2.6, 0x3bc98b, 0.16);
  for (const p of W.posts) glow(p.x, p.y, 2.6, 0x6a98ff, 0.22);
  glow(58, 42, 5.5, 0xcfd8ff, 0.16); glow(50, 50, 4.5, 0xfff0b0, 0.22); glow(42, 51, 3.2, 0xff5fa0, 0.24); glow(50, 7, 4, 0xffe2a0, 0.2);
  e.globalCompositeOperation = 'destination-in'; e.drawImage(mask, 0, 0); e.globalCompositeOperation = 'source-over';   // light only falls on open ground
  // ---- wetness (roughness): mostly damp, with puddles on the roads
  const rsz = Math.min(1024, size), rs = rsz / 100, rgh = mk(rsz), r = rgh.getContext('2d');
  r.fillStyle = '#9c9c9c'; r.fillRect(0, 0, rsz, rsz);
  for (let k = 0; k < 900; k++) {
    const x = hash2(k, 71) * 100, y = hash2(k, 73) * 100; if (!W.walkable(x, y)) continue;
    const lk = W.laneAt(x, y), big = lk === LANE.MAIN || lk === LANE.STREET, rad = (big ? 0.5 : 0.28) + hash2(k, 79) * (big ? 1.1 : 0.4);
    const g = r.createRadialGradient(x * rs, y * rs, 0, x * rs, y * rs, rad * rs); g.addColorStop(0, 'rgba(38,38,38,0.95)'); g.addColorStop(0.7, 'rgba(60,60,60,0.5)'); g.addColorStop(1, 'rgba(120,120,120,0)');
    r.fillStyle = g; r.beginPath(); r.ellipse(x * rs, y * rs, rad * rs, rad * rs * (0.5 + hash2(k, 83) * 0.5), hash2(k, 89) * 3, 0, 7); r.fill();
  }
  return { alb, emi, rgh };
}

export function paintMini(cv, map, W) {
  const S = cv.width / 100, c = cv.getContext('2d'), px = CS * S;
  c.fillStyle = '#0a0f1c'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#13281b'; c.fillRect(24 * S, 52 * S, 24 * S, 24 * S);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, t = W.type[k];
    if (t === T.WALK) c.fillStyle = W.inPark((i + 0.5) * CS, (j + 0.5) * CS) ? '#1f4a30' : (W.ai[k] ? '#414c6b' : '#8a4a6e');
    else if (t === T.BAY) c.fillStyle = '#7a62c9';
    else if (t === T.WATER) c.fillStyle = '#143a63';
    else if (t === T.RAIL) c.fillStyle = '#1c1e26';
    else if (t === T.CAGE) c.fillStyle = '#3a56a8';
    else continue;
    c.fillRect(i * px, j * px, px + 0.5, px + 0.5);
  }
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#6f7da3'; c.lineWidth = 2.6 * S;
  for (const r of map.roads) if (r.kind === 'main') { c.beginPath(); r.points.forEach((p, k) => k ? c.lineTo(p.x * S, p.y * S) : c.moveTo(p.x * S, p.y * S)); c.stroke(); }
}

// ---------------------------------------------------------------- labels
export const LABELS = [];
export function makeLabel(text, opts = {}) {
  const fs = 46, pad = 16, cv = document.createElement('canvas'), c = cv.getContext('2d');
  c.font = `700 ${fs}px ${FONT}`;
  cv.width = Math.ceil(c.measureText(text).width) + pad * 2; cv.height = Math.ceil(fs * 1.5);
  c.font = `700 ${fs}px ${FONT}`; c.textBaseline = 'middle';
  const r = 14, w = cv.width, h = cv.height;
  c.beginPath(); c.moveTo(r, 0); c.arcTo(w, 0, w, h, r); c.arcTo(w, h, 0, h, r); c.arcTo(0, h, 0, 0, r); c.arcTo(0, 0, w, 0, r); c.closePath();
  c.fillStyle = opts.bg || 'rgba(8,12,22,0.78)'; c.fill();
  if (opts.border) { c.lineWidth = 4; c.strokeStyle = opts.border; c.stroke(); }
  c.fillStyle = opts.color || '#ffffff'; c.fillText(text, pad, h / 2 + 3);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: true }));
  const hh = opts.h || 0.55; sp.scale.set(hh * w / h, hh, 1); sp.renderOrder = 20;
  sp.userData.base = hh; sp.userData.ratio = w / h; LABELS.push(sp);
  return sp;
}

// ---------------------------------------------------------------- building material: lit windows + see-through circle around the player's car
export function makeBuildingMaterial(U, windows) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uCut = U.uCut; sh.uniforms.uRes = U.uRes;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONormal;\nvarying float vDepthC;\nvarying vec4 vRoof;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wpC = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          wpC = instanceMatrix * wpC;
          vec2 scC = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
          vRoof = vec4( position.x * scC.x, position.z * scC.y, scC );
        #else
          vRoof = vec4( 0.0, 0.0, 1000.0, 1000.0 );
        #endif
        vWPos = ( modelMatrix * wpC ).xyz;
        vONormal = normal;
        vDepthC = - mvPosition.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vONormal;\nvarying float vDepthC;\nvarying vec4 vRoof;\nuniform vec3 uCut;\nuniform vec2 uRes;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 spC = gl_FragCoord.xy / uRes;
          float cdC = length( ( spC - uCut.xy ) * vec2( uRes.x / uRes.y, 1.0 ) );
          if ( vDepthC < uCut.z - 0.2 && cdC < 0.15 ) {
            if ( cdC < 0.105 || mod( floor( gl_FragCoord.x ) + floor( gl_FragCoord.y ), 2.0 ) < 0.5 ) discard;
          }
          if ( vONormal.y > 0.5 ) {
            // flat roofs: patchy slabs with seams, a parapet round the edge, now and then a lit skylight
            float eC = min( vRoof.z * 0.5 - abs( vRoof.x ), vRoof.w * 0.5 - abs( vRoof.y ) );
            vec3 wallC = diffuseColor.rgb;
            vec3 roofC = wallC * 0.42 + vec3( 0.02, 0.022, 0.03 );
            vec2 rgC = vWPos.xz * 1.1; vec2 ridC = floor( rgC ); vec2 rfC = fract( rgC );
            float rhC = fract( sin( dot( ridC, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            float farC = clamp( ( vDepthC - 14.0 ) / 14.0, 0.0, 1.0 );   // detail fades with distance so it never shimmers
            roofC *= mix( 0.8 + 0.4 * rhC, 1.0, farC );
            roofC *= 1.0 - 0.22 * ( 1.0 - farC ) * max( step( rfC.x, 0.07 ), step( rfC.y, 0.07 ) );
            float rimC = step( eC, 0.1 );
            roofC *= 1.0 - 0.45 * ( 1.0 - rimC ) * ( 1.0 - smoothstep( 0.1, 0.3, eC ) );
            roofC = mix( roofC, wallC * 0.78 + vec3( 0.03 ), rimC );
            float skyC = step( 0.955, rhC ) * step( 0.55, eC ) * step( 0.25, rfC.x ) * step( rfC.x, 0.75 ) * step( 0.3, rfC.y ) * step( rfC.y, 0.7 );
            totalEmissiveRadiance += vec3( 1.0, 0.8, 0.5 ) * skyC * 0.55;
            diffuseColor.rgb = roofC;
          }
          ${windows ? `else if ( abs( vONormal.y ) < 0.5 ) {
            float uC = abs( vONormal.x ) > 0.5 ? vWPos.z : vWPos.x;
            float sideC = abs( vONormal.x ) > 0.5 ? floor( vWPos.x * 2.0 ) : floor( vWPos.z * 2.0 ) + 31.0;
            vec2 gC = vec2( uC * 3.1, vWPos.y * 3.4 );
            vec2 idC = floor( gC ); vec2 fC = fract( gC );
            float hC = fract( sin( dot( idC + sideC * 0.37, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
            float winC = step( 0.22, fC.x ) * step( fC.x, 0.78 ) * step( 0.3, fC.y ) * step( fC.y, 0.8 ) * step( 0.34, vWPos.y );
            float litC = step( 0.84, hC );
            vec3 wcolC = mix( vec3( 1.0, 0.74, 0.38 ), vec3( 0.7, 0.84, 1.0 ), step( 0.965, hC ) );
            totalEmissiveRadiance += wcolC * winC * litC * 0.95;
            diffuseColor.rgb *= 1.0 - 0.35 * winC * ( 1.0 - litC );
            // ground floor: a band of shop shutters, a few of them lit
            float shopC = step( vWPos.y, 0.3 ) * step( 0.04, vWPos.y );
            float sgC = fract( uC * 1.15 ); float shC = fract( sin( floor( uC * 1.15 ) * 91.7 + sideC ) * 4375.85 );
            float doorC = shopC * step( 0.1, sgC ) * step( sgC, 0.9 );
            diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.55 + 0.25 * step( 0.5, fract( vWPos.y * 22.0 ) ) ), doorC );
            totalEmissiveRadiance += vec3( 1.0, 0.82, 0.5 ) * doorC * step( 0.9, shC ) * 0.4;
          }` : ''}
        }`);
  };
  mat.customProgramCacheKey = () => 'bldg3' + (windows ? 1 : 0);
  return mat;
}

// ---------------------------------------------------------------- scene
export function buildScene(scene, map, W, U, quality) {
  const H = { siteVis: [], escVis: [], leverVis: [], hideVis: [] };
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
  const bas = (color, extra) => new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
  const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const cyl = (rt, rb, h, seg, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; };
  const cutMat = c => { const m = makeBuildingMaterial(U, false); m.color.setHex(c); return m; };
  H.cutMat = cutMat;

  // ground: wet tarmac that picks up headlights and sirens
  const maps = paintGround(quality.ground, map, W);
  const tex = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = quality.aniso; return t; };
  const gmat = quality.wet
    ? new THREE.MeshStandardMaterial({ map: tex(maps.alb, true), emissiveMap: tex(maps.emi, true), emissive: 0xffffff, emissiveIntensity: 2.1, roughnessMap: tex(maps.rgh, false), roughness: 1, metalness: 0.0 })
    : new THREE.MeshLambertMaterial({ map: tex(maps.alb, true), emissiveMap: tex(maps.emi, true), emissive: 0xffffff, emissiveIntensity: 2.1 });
  gmat.color.setRGB(1.62, 1.55, 1.48);   // the painted tarmac is dark; lift it so moonlight and headlights read on it
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), gmat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(50, 0, 50); scene.add(ground);
  H.ground = ground;
  const under = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), bas(0x04060b)); under.rotation.x = -Math.PI / 2; under.position.set(50, -0.05, 50); scene.add(under);

  // buildings
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  for (const win of [1, 0]) {
    const list = W.boxes.filter(b => !!b.win === !!win);
    const im = new THREE.InstancedMesh(unit, makeBuildingMaterial(U, !!win), list.length);
    list.forEach((b, k) => {
      dummy.position.set(b.x + b.w / 2, b.h / 2, b.y + b.d / 2); dummy.scale.set(b.w, b.h, b.d); dummy.updateMatrix();
      im.setMatrixAt(k, dummy.matrix); im.setColorAt(k, col.setHex(b.c));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false; scene.add(im);
  }

  // landmark footprints: merge marked cells into boxes
  const cellBoxes = (r, hFn, mat) => {
    const i0 = Math.floor(r.x0 / CS), i1 = Math.ceil(r.x1 / CS), j0 = Math.floor(r.y0 / CS), j1 = Math.ceil(r.y1 / CS);
    for (let j = j0; j < j1; j++) {
      let run = -1;
      for (let i = i0; i <= i1; i++) {
        const on = i < i1 && W.type[j * N + i] === T.MARK && (i + 0.5) * CS >= r.x0 && (i + 0.5) * CS <= r.x1 && (j + 0.5) * CS >= r.y0 && (j + 0.5) * CS <= r.y1;
        if (on && run < 0) run = i;
        if (!on && run >= 0) { const w = (i - run) * CS, h = hFn(run, j); box(w, h, CS, mat, run * CS + w / 2, h / 2, j * CS + CS / 2); run = -1; }
      }
    }
  };
  const M = W.marks;
  // thana and its impound yard
  cellBoxes(M.thana, () => 1.5, cutMat(0x8d7d55));
  box(3.1, 0.18, 5.6, bas(0x3d6ae0), 61, 1.2, 40.75);
  const thanaLamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bas(0x8fb4ff)); thanaLamp.position.set(59.6, 1.75, 43.4); scene.add(thanaLamp);
  const tl = makeLabel('KOTWALI THANA', { color: '#9dbcff', h: 0.46 }); tl.position.set(58.5, 2.6, 42); scene.add(tl);
  const barMat = bas(0xaab4c8);
  const cg = W.cage, bars = [];
  for (let x = cg.x0; x <= cg.x1 + 0.01; x += 0.35) { bars.push([x, cg.y0]); bars.push([x, cg.y1]); }
  for (let y = cg.y0 + 0.35; y < cg.y1; y += 0.35) { bars.push([cg.x0, y]); bars.push([cg.x1, y]); }
  const barIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), barMat, bars.length);
  bars.forEach((b, k) => { dummy.position.set(b[0], 0.35, b[1]); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); barIM.setMatrixAt(k, dummy.matrix); });
  scene.add(barIM);
  box(cg.x1 - cg.x0 + 0.1, 0.06, 0.06, barMat, (cg.x0 + cg.x1) / 2, 0.7, cg.y0); box(cg.x1 - cg.x0 + 0.1, 0.06, 0.06, barMat, (cg.x0 + cg.x1) / 2, 0.7, cg.y1);
  box(0.06, 0.06, cg.y1 - cg.y0, barMat, cg.x0, 0.7, (cg.y0 + cg.y1) / 2); box(0.06, 0.06, cg.y1 - cg.y0, barMat, cg.x1, 0.7, (cg.y0 + cg.y1) / 2);
  const jl = makeLabel('IMPOUND', { color: '#c9d4ee', h: 0.4 }); jl.position.set(55.2, 1.4, 38.5); scene.add(jl);
  // clock tower
  const stone = cutMat(0x8a8272);
  box(1, 4.6, 1, stone, 50, 2.3, 50); box(1.25, 0.2, 1.25, stone, 50, 3.4, 50);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 4), cutMat(0x5a4038)); roof.position.set(50, 5.05, 50); roof.rotation.y = Math.PI / 4; scene.add(roof);
  const face = bas(0xfff2b4);
  for (const [dx, dz, ry] of [[0, 0.51, 0], [0, -0.51, Math.PI], [0.51, 0, Math.PI / 2], [-0.51, 0, -Math.PI / 2]]) { const f = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), face); f.position.set(50 + dx, 4.0, 50 + dz); f.rotation.y = ry; scene.add(f); }
  const cl = makeLabel('Ghanta Ghar', { color: '#fff2b4', h: 0.42 }); cl.position.set(50, 5.9, 50); scene.add(cl);
  // station, water tower, chimney, mandir, talkies, ruin, scrap
  cellBoxes(M.station, () => 1.25, cutMat(0x93804c));
  box(4.2, 0.3, 0.1, bas(0xffe2a0), 46, 1.1, 7.66);
  const sl = makeLabel('Jugnupur Station', { color: '#ffe2a0', h: 0.5 }); sl.position.set(46, 2.2, 6.5); scene.add(sl);
  cellBoxes(M.tank, () => 0.3, cutMat(0x555a66));
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) box(0.08, 2.4, 0.08, lam(0x6c7280), 10 + dx, 1.2, 6 + dz);
  cyl(0.55, 0.55, 0.8, 12, lam(0x7a8496), 10, 2.8, 6); box(0.9, 0.12, 0.12, bas(0xffe27a), 10, 3.35, 6);
  cellBoxes(M.chimney, () => 0.5, cutMat(0x6a4a40));
  cyl(0.3, 0.48, 6, 10, cutMat(0x8a5444), 5, 3, 46); box(0.3, 0.3, 0.3, bas(0xffa860), 5, 6.2, 46);
  const ml = makeLabel('Mill', { color: '#ffb880', h: 0.45 }); ml.position.set(5, 7, 46); scene.add(ml);
  cellBoxes(M.mandir, () => 0.7, cutMat(0xd8cfc0));
  box(1.0, 0.5, 1.0, lam(0xe2d8c8), 54, 0.95, 93); const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 8), lam(0xe8a05a)); spire.position.set(54, 1.85, 93); scene.add(spire);
  for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [0, -0.95]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), bas(0xffc860)); d.position.set(54 + dx, 0.78, 93 + dz); scene.add(d); }
  cellBoxes(M.talkies, () => 1.5, cutMat(0x7c3350));
  box(6.6, 0.42, 0.25, bas(0xff5fa0), 42, 1.75, 51.75);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 5), bas(0xfff0a0), 14);
  for (let k = 0; k < 14; k++) { dummy.position.set(38.9 + k * 0.48, 2.02, 51.6); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); bulbs.setMatrixAt(k, dummy.matrix); } scene.add(bulbs);
  const tk = makeLabel('TIMTIM TALKIES', { color: '#ffb3d1', h: 0.42 }); tk.position.set(42, 2.6, 51.8); scene.add(tk);
  cellBoxes(M.ruin, (i, j) => 0.3 + hash2(i, j) * 1.3, cutMat(0x7d7466));
  box(0.9, 2.8, 0.9, cutMat(0x6f685c), 90.0, 1.4, 9.9); box(0.25, 0.25, 0.25, bas(0xf2f6ff), 90.0, 2.95, 9.9);
  cellBoxes(M.scrap, (i, j) => 0.2 + hash2(i * 3, j * 5) * 0.6, cutMat(0x6a665e));
  box(0.14, 3.2, 0.14, lam(0x8a6a2a), 14.2, 1.6, 86.2); box(2.4, 0.12, 0.12, lam(0x8a6a2a), 13.2, 3.1, 86.2); box(0.26, 0.26, 0.26, bas(0xffa860), 14.2, 3.35, 86.2);
  // Tota Darwaza: the old gate over the ring road
  const sand = cutMat(0xa5845a);
  box(0.7, 2.5, 0.7, sand, 29, 1.25, 20.0); box(0.7, 2.5, 0.7, sand, 29, 1.25, 24.0); box(0.8, 0.55, 4.7, sand, 29, 2.7, 22);
  box(0.84, 0.12, 4.74, bas(0x49c46a), 29, 2.36, 22);
  const gl = makeLabel('Tota Darwaza', { color: '#b8f2c6', h: 0.45 }); gl.position.set(29, 3.6, 22); scene.add(gl);
  // buses, wagon, mail coach
  for (const p of W.solidProps) {
    const w = p.x1 - p.x0, d = p.y1 - p.y0, cx = (p.x0 + p.x1) / 2, cz = (p.y0 + p.y1) / 2;
    if (p.kind === 'bus') { box(w, 0.62, d, cutMat(p.c), cx, 0.39, cz); box(w * 0.92, 0.18, d + 0.02, bas(0x6f8796), cx, 0.5, cz); box(w * 0.96, 0.05, d * 0.9, lam(0xdedede), cx, 0.72, cz); }
    else if (p.kind === 'wagon') { box(w, 0.42, d, cutMat(p.c), cx, 0.33, cz); box(w * 0.94, 0.06, d * 0.8, lam(0x2a1a12), cx, 0.5, cz); }
    else { box(w, 0.7, d, cutMat(p.c), cx, 0.45, cz); box(w * 0.9, 0.16, d + 0.02, bas(0xffe9a8), cx, 0.55, cz); }
  }
  const boat = W.escapes.find(e => /Naav/.test(e.name));
  if (boat) { const b = box(1.9, 0.22, 0.7, lam(0x6a4a30), boat.x + 0.2, 0.08, boat.y + 1.75); b.rotation.y = 0.15; box(0.05, 0.9, 0.05, lam(0x554433), boat.x + 0.2, 0.5, boat.y + 1.75); box(0.14, 0.14, 0.14, bas(0x7dffa8), boat.x + 0.2, 1.0, boat.y + 1.75); }

  // park trees
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6), lam(0x4a3626), W.trees.length);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.62, 1.5, 7), cutMat(0x1e5a32), W.trees.length);
  W.trees.forEach((t, k) => {
    dummy.position.set(t.x, 0.3, t.y); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); trunks.setMatrixAt(k, dummy.matrix);
    dummy.position.set(t.x, 0.6 + 0.75 * t.s, t.y); dummy.scale.set(t.s, t.s, t.s); dummy.updateMatrix(); crowns.setMatrixAt(k, dummy.matrix);
  });
  crowns.frustumCulled = trunks.frustumCulled = false; scene.add(trunks); scene.add(crowns);

  // street lamps: post, arm over the road, bulb, and a faint cone of light in the damp air
  const posts = W.lamps.filter(p => p.post);
  const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), lam(0x3a4050), posts.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), lam(0x3a4050), posts.length);
  const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), posts.length);
  const coneGeo = new THREE.CylinderGeometry(0.06, 0.85, 1.45, 12, 1, true); coneGeo.translate(0, -0.725, 0);
  const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), posts.length);
  posts.forEach((p, k) => {
    dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    dummy.position.set(p.x, 0.75, p.y); dummy.updateMatrix(); poles.setMatrixAt(k, dummy.matrix);
    dummy.position.set(p.x + p.dx * 0.25, 1.5, p.y + p.dy * 0.25); dummy.rotation.y = Math.atan2(p.dx, p.dy); dummy.updateMatrix(); arms.setMatrixAt(k, dummy.matrix);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(p.x + p.dx * 0.5, 1.46, p.y + p.dy * 0.5); dummy.updateMatrix(); bulb.setMatrixAt(k, dummy.matrix); cones.setMatrixAt(k, dummy.matrix);
    bulb.setColorAt(k, col.setHex(p.c)); cones.setColorAt(k, col.setHex(p.c));
  });
  bulb.instanceColor.needsUpdate = true; cones.instanceColor.needsUpdate = true;
  poles.frustumCulled = arms.frustumCulled = bulb.frustumCulled = cones.frustumCulled = false; cones.renderOrder = 3;
  scene.add(poles); scene.add(arms); scene.add(bulb); if (quality.cones) scene.add(cones);

  // police posts
  for (const p of W.posts) {
    box(0.6, 0.85, 0.6, lam(0x2c4a9a), p.x - 0.75, 0.42, p.y - 0.75); box(0.7, 0.1, 0.7, lam(0xe8ecf5), p.x - 0.75, 0.9, p.y - 0.75);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bas(0x7fa6ff)); b.position.set(p.x - 0.75, 1.05, p.y - 0.75); scene.add(b);
    const lb = makeLabel(p.name, { color: '#9dbcff', h: 0.4 }); lb.position.set(p.x - 0.75, 1.75, p.y - 0.75); scene.add(lb);
  }

  // places to rob: a floating gold gem in a beam, so a car can park right on the ring
  const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 3, 14, 1, true); beamGeo.translate(0, 1.5, 0);
  const beamMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const gemGeo = new THREE.OctahedronGeometry(0.22, 0);
  for (const s of W.sites) {
    const sc = s.tier === 3 ? 1.5 : s.tier === 2 ? 1.15 : 0.9;
    const g = new THREE.Group(); g.position.set(s.x, 0, s.y); scene.add(g);
    const gem = new THREE.Mesh(gemGeo, bas(COLORS.loot)); gem.position.y = 0.95; gem.scale.setScalar(sc); g.add(gem);
    const beam = new THREE.Mesh(beamGeo, beamMat(COLORS.loot)); beam.scale.set(sc, 1, sc); g.add(beam);
    const label = makeLabel(`${s.name}  ₹${CFG.VALUE[s.tier] || s.value}`, { color: '#ffd98a', h: s.tier === 3 ? 0.5 : 0.4, border: s.tier === 3 ? 'rgba(243,180,63,0.9)' : null });
    label.position.set(0, 1.75 + sc * 0.2, 0); g.add(label);
    const lock = makeLabel('LOCKED', { color: '#ff9c9c', h: 0.3 }); lock.position.set(0, 1.35, 0); lock.visible = false; g.add(lock);
    H.siteVis.push({ g, gem, beam, label, lock, state: -1, sc });
  }
  for (const e of W.escapes) {
    const g = new THREE.Group(); g.position.set(e.x, 0, e.y); scene.add(g);
    const beam = new THREE.Mesh(beamGeo, beamMat(COLORS.escape)); beam.scale.set(2.2, 1.25, 2.2); g.add(beam);
    const label = makeLabel(e.name, { color: '#8df0c0', h: 0.46, border: 'rgba(59,201,139,0.8)' }); label.position.set(0, 2.5, 0); g.add(label);
    H.escVis.push({ g, beam, label });
  }
  for (const v of W.levers) {
    const g = new THREE.Group(); g.position.set(v.x, 0, v.y); scene.add(g);
    box(0.16, 0.7, 0.16, lam(0x4a5266), 0, 0.35, 0, g);
    const arm = box(0.06, 0.4, 0.06, lam(0xc8ccd8), 0.12, 0.72, 0, g); arm.rotation.z = -0.7;
    const bulbM = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), bas(COLORS.police)); bulbM.position.set(0, 0.86, 0); g.add(bulbM);
    const label = makeLabel('Impound lever', { color: '#9dbcff', h: 0.38 }); label.position.set(0, 1.45, 0); g.add(label);
    H.leverVis.push({ g, bulb: bulbM, arm, label });
  }
  // bollards at the mouths of the tang galis: a small car squeezes through, a jeep does not
  const bolls = [];
  for (const g of W.galis) for (const end of [g.points[0], g.points[g.points.length - 1]]) bolls.push(end);
  const bollIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8), lam(0xd8c040), bolls.length * 2);
  bolls.forEach((p, k) => { for (const s of [-1, 1]) { const horiz = W.walkable(p.x + 1, p.y) || W.walkable(p.x - 1, p.y); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.position.set(p.x + (horiz ? 0 : s * 0.62), 0.16, p.y + (horiz ? s * 0.62 : 0)); dummy.updateMatrix(); bollIM.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), dummy.matrix); } });
  scene.add(bollIM);

  // hideouts: real places to drive into
  const hctx = { cutMat, makeLabel };
  for (const h of W.hides) {
    const kind = h.grove ? 'grove' : kindFor(h.kind);
    const ho = buildHideout({ kind, w: h.bay.w, d: h.bay.d, seed: h.i * 7 + 3 }, hctx);
    ho.setClosed(1);   // every door is shut unless someone is going in or out, so a shut door tells the police nothing
    ho.g.position.set(h.x, 0, h.y); ho.g.rotation.y = h.a; scene.add(ho.g);
    const label = makeLabel(ho.name || kind, { color: '#d9ccff', h: 0.34 }); label.position.set(h.x, 1.35, h.y); scene.add(label);
    h.hkind = kind; h.name = ho.name || kind;
    H.hideVis.push({ ho, label, closed: 1, search: 0 });
  }

  H.thanaLamp = thanaLamp;
  return H;
}

export function setSiteVisual(v, state) { // 0 available, 1 locked, 2 robbed
  if (v.state === state) return;
  v.state = state;
  v.beam.visible = state !== 2; v.label.visible = state !== 2; v.lock.visible = state === 1; v.gem.visible = state !== 2;
  v.beam.material.color.setHex(state === 1 ? COLORS.locked : COLORS.loot);
  v.gem.material.color.setHex(state === 0 ? COLORS.loot : 0x7a5a3a);
}
