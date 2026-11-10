// js/fx.js : particles and weather for the night car chase.
//
//   const fx = new Fx(scene, { quality: 'high' });      // 'high' | 'low'
//   fx.update(dt, time, { x, z });                       // once a frame, before rendering
//   fx.smoke(x, y, z, strength)        fx.dust(x, y, z, strength)        fx.flame(x, y, z, dx, dz)
//   fx.sparks(x, y, z, nx, nz, strength)                 fx.skid(x0, z0, x1, z1, width, alpha)
//   fx.setRain(level)    fx.lightning()    fx.flash      fx.setQuality('low')    fx.dispose()
//
// Everything is simulated in the vertex shaders from a spawn record (position, velocity, birth time), so a frame costs
// a handful of uniform writes on the CPU and an emit call only writes one slot of a fixed ring buffer. At most five
// draw calls (tyre marks, splashes, smoke + dust, sparks + flames, rain), and a layer with nothing to show is not drawn.
import * as THREE from '../vendor/three.module.min.js';

const SMOKE_CAP = 320, SMOKE_STRIDE = 16;      // smoke and dust puffs share one pool
const SPARK_CAP = 256, SPARK_STRIDE = 12;      // sparks, crash flashes and backfire flames share one pool
const SKID_CAP = 2048;                         // tyre-mark quads in the ring buffer
const SKID_FADE = 14;                          // seconds until a mark is gone
const SKID_MIN_LEN = 0.09;                     // a mark quad is stretched until it is this long (saves quads at high frame rates)
const TRAILS = 16, TRAIL_STRIDE = 8;           // wheels that can be laying a continuous mark at the same time
const TRAIL_END = 0.1;                         // a mark not continued for this long has ended and gets a tapered tip
const RAIN_MAX = 2100, SPLASH_MAX = 280;       // streaks and splash rings at level 1 on high quality
// The rain box is only as tall as the chase camera ever flies (about 5 to 7 units up, looking down), so the streaks
// are spent where they can be seen instead of in the air above the view.
const RAIN_BOX = 26, RAIN_HEIGHT = 9, SPLASH_AREA = 20;
const GRAVITY = 6;                             // for sparks, units / s^2 (exaggerated so the arcs read at chase-camera distance)
const REBASE = 2048;                           // the internal clock wraps here so shader floats stay precise for hours
// Draw order among the see-through things in the scene (three.js sorts transparent objects by renderOrder first).
// Tyre marks, splashes and rain go early: after the cars' own ground shadow and light pools (-3, -2) but before the
// things that stand on the ground without writing depth, above all the hideout doors (0). Seen from inside a hideout
// the weather outside is then covered by the door planks and shows only through the gaps, instead of being painted
// over the door. Smoke and sparks go late, over car glass (0) and lamp cones (3) and under the labels (20).
const ORDER_SKID = -1.6, ORDER_SPLASH = -1.5, ORDER_RAIN = -1.2, ORDER_SMOKE = 6, ORDER_SPARKS = 7;

// ---------------------------------------------------------------------------------------------------------- shaders
// alpha-style fog for things that should thin out with distance rather than turn fog-coloured
const FOG_FADE = `
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fxFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fxFog = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  #else
    float fxFog = 0.0;
  #endif`;

const SMOKE_VS = `
attribute vec4 aPos;    // xyz spawn point, w birth time
attribute vec4 aVel;    // xyz first push, w life
attribute vec4 aMisc;   // x start size, y end size, z opacity, w seed
attribute vec4 aCol;    // rgb colour (linear), w rise speed
uniform float uTime;
uniform float uFlash;
uniform vec2 uWind;
varying vec2 vUv;
varying vec4 vColor;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aPos.w;
  float u = clamp( age / aVel.w, 0.0, 1.0 );
  float live = step( 0.0, age ) * step( age, aVel.w );
  float drag = ( 1.0 - exp( - age * 2.4 ) ) / 2.4;
  vec3 c = aPos.xyz + aVel.xyz * drag + vec3( uWind.x, aCol.w, uWind.y ) * age * live;
  float size = mix( aMisc.x, aMisc.y, 1.0 - ( 1.0 - u ) * ( 1.0 - u ) ) * live;
  c.y = max( c.y, size * 0.34 );                        // keep the billboard out of the road
  float seed = aMisc.w;
  float rot = seed * 6.2832 + age * live * ( seed - 0.5 ) * 1.5;
  float cs = cos( rot ), sn = sin( rot );
  vec2 q = vec2( position.x * cs - position.y * sn, position.x * sn + position.y * cs );
  vec4 mvPosition = modelViewMatrix * vec4( c, 1.0 );
  mvPosition.xy += q * size;
  gl_Position = projectionMatrix * mvPosition;
  float cell = floor( fract( seed * 7.31 ) * 4.0 );     // one of the four puff shapes in the atlas
  vUv = ( position.xy + 0.5 + vec2( mod( cell, 2.0 ), floor( cell * 0.5 ) ) ) * 0.5;
  vShade = 0.82 + 0.5 * q.y;                            // a little lighter on top
  float fade = smoothstep( 0.0, 0.045, u ) * pow( 1.0 - u, 1.35 );
  vColor = vec4( aCol.rgb * ( 1.0 + uFlash * 2.5 ), aMisc.z * fade );
  #include <fog_vertex>
}`;

const SMOKE_FS = `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( uMap, vUv );                      // r = density, g = mottling
  gl_FragColor = vec4( vColor.rgb * vShade * ( 0.7 + 0.6 * t.g ), vColor.a * t.r );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const SPARK_VS = `
attribute vec4 aPos;    // xyz spawn point, w birth time
attribute vec4 aVel;    // xyz velocity, w life
attribute vec4 aMisc;   // x half width (spark) or radius (glow), y kind: 0 spark, 1 round glow, z seed, w brightness
uniform float uTime;
varying vec2 vC;
varying vec3 vColor;
varying float vKind;
#include <fog_pars_vertex>
const float G = ${GRAVITY.toFixed(1)};
void main() {
  float age = uTime - aPos.w;
  float u = clamp( age / aVel.w, 0.0, 1.0 );
  float live = step( 0.0, age ) * step( age, aVel.w );
  float kind = aMisc.y;
  vec3 v0 = aVel.xyz;
  // spark: thrown, falls, bounces once off the road
  float t1 = ( v0.y + sqrt( v0.y * v0.y + 2.0 * G * max( aPos.y - 0.02, 0.0 ) ) ) / G;
  float ta = clamp( age, 0.0, t1 ), tb = clamp( age - t1, 0.0, 4.0 ), hit = step( t1, age );
  float vyB = ( G * t1 - v0.y ) * 0.38;
  vec3 p = vec3( aPos.x + v0.x * ( ta + tb * 0.5 ), 0.0, aPos.z + v0.z * ( ta + tb * 0.5 ) );
  p.y = mix( aPos.y + v0.y * ta - 0.5 * G * ta * ta, 0.02 + max( vyB * tb - 0.5 * G * tb * tb, 0.0 ), hit );
  vec3 v = vec3( v0.x, mix( v0.y - G * ta, vyB - G * tb, hit ), v0.z );
  v.xz *= 1.0 - 0.5 * hit;
  // glow: drifts and slows down
  p = mix( p, aPos.xyz + v0 * ( u * aVel.w ) * ( 1.0 - 0.5 * u ), kind );
  vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
  vec3 vv = ( modelViewMatrix * vec4( v, 0.0 ) ).xyz;
  float sp = length( vv.xy );
  vec2 dir = sp > 0.0001 ? vv.xy / sp : vec2( 1.0, 0.0 );
  float w = max( aMisc.x, 0.0015 * - mvPosition.z );    // never thinner than about a pixel
  float len = max( w, sp * 0.035 );                     // a streak along its flight
  vec2 c = position.xy * 2.0;
  vec2 offSpark = dir * ( c.x * len ) + vec2( - dir.y, dir.x ) * ( c.y * w );
  vec2 offGlow = c * aMisc.x * ( 0.55 + 0.9 * u );
  mvPosition.xy += mix( offSpark, offGlow, kind ) * live;
  gl_Position = projectionMatrix * mvPosition;
  vC = c;
  vKind = kind;
  float cool = 1.0 - u;
  vec3 hot = mix( vec3( 1.0, 0.24, 0.03 ), vec3( 1.0, 0.58, 0.17 ), cool * cool );   // orange, cooling to red
  float twinkle = 0.8 + 0.2 * sin( age * 55.0 + aMisc.z * 40.0 );
  vColor = hot * aMisc.w * mix( pow( cool, 0.8 ) * twinkle, cool * cool, kind );
  #include <fog_vertex>
}`;

const SPARK_FS = `
varying vec2 vC;
varying vec3 vColor;
varying float vKind;
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - vC.y * vC.y;
  float streak = across * across * smoothstep( - 1.0, 0.45, vC.x ) * ( 1.0 - smoothstep( 0.6, 1.0, vC.x ) );
  float rr = max( 0.0, 1.0 - dot( vC, vC ) );
  float m = mix( streak, rr * rr * rr, vKind );
  vec3 heat = mix( mix( vec3( 0.85, 0.6, 0.4 ), vec3( 1.3, 1.3, 1.2 ), smoothstep( - 0.3, 0.75, vC.x ) ), vec3( 1.0 ), vKind );   // white-hot head
  ${FOG_FADE}
  gl_FragColor = vec4( vColor * heat * m * ( 1.0 - fxFog ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SKID_VS = `
attribute vec2 aData;   // x opacity, y time it was laid
attribute float aSide;  // -1 / +1 across the mark
uniform float uTime;
uniform float uFade;
varying float vA;
varying float vSide;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aData.y;
  vA = aData.x * ( 1.0 - smoothstep( uFade * 0.3, uFade, age ) );
  vSide = aSide;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SKID_FS = `
uniform vec3 uColor;
varying float vA;
varying float vSide;
#include <fog_pars_fragment>
void main() {
  float s = abs( vSide );
  ${FOG_FADE}
  gl_FragColor = vec4( uColor, vA * ( 1.0 - smoothstep( 0.45, 1.0, s ) ) * ( 1.0 - fxFog ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RAIN_VS = `
attribute vec3 aC;      // x 0 head / 1 tail, y side -1 / +1, z random
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uFall;     // velocity of the drops; y is negative
uniform float uLen;
uniform float uWidth;
uniform float uAlpha;
varying vec2 vC;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float rnd = aC.z;
  float speed = - uFall.y * ( 0.8 + 0.4 * rnd );
  float fy = fract( position.y - uTime * speed / uBox.y );          // 1 at the top of the box, 0 on the road
  float tFall = ( 1.0 - fy ) * uBox.y / speed;                       // seconds since the drop left the top
  vec2 xz = position.xz * uBox.xz + uFall.xz * tFall;
  vec2 mid = uCenter.xz + ( cameraPosition.xz - uCenter.xz ) * 0.3;  // lean the box a little toward the camera
  xz = mid + mod( xz - mid + 0.5 * uBox.xz, uBox.xz ) - 0.5 * uBox.xz;
  vec3 dirW = normalize( vec3( uFall.x, - speed, uFall.z ) );
  vec3 pW = vec3( xz.x, fy * uBox.y, xz.y ) - dirW * ( uLen * ( 0.7 + 0.6 * rnd ) * aC.x );
  vec4 mvPosition = viewMatrix * vec4( pW, 1.0 );
  vec3 dirV = ( viewMatrix * vec4( dirW, 0.0 ) ).xyz;
  vec3 sideV = cross( dirV, mvPosition.xyz );
  float dist = - mvPosition.z;
  float w = max( uWidth, 0.0015 * dist );                             // at least about a pixel wide
  mvPosition.xyz += sideV * ( aC.y * 0.5 * w / max( length( sideV ), 0.0001 ) );
  gl_Position = projectionMatrix * mvPosition;
  vC = aC.xy;
  vA = uAlpha * ( 0.5 + 0.5 * fract( rnd * 7.31 ) ) * smoothstep( 1.3, 4.6, dist );   // none right in front of the lens
  #include <fog_vertex>
}`;

const RAIN_FS = `
uniform vec3 uColor;
uniform float uFlash;
varying vec2 vC;
varying float vA;
#include <fog_pars_fragment>
void main() {
  ${FOG_FADE}
  float a = vA * ( 1.0 - vC.y * vC.y ) * ( 1.0 - 0.8 * vC.x ) * ( 1.0 - fxFog ) * ( 1.0 + uFlash );
  gl_FragColor = vec4( uColor * ( 1.0 + uFlash * 3.0 ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SPLASH_VS = `
attribute vec3 aC;      // xy corner -1..1, z random
uniform float uTime;
uniform vec3 uCenter;
uniform float uArea;
uniform float uY;
uniform float uAlpha;
varying vec2 vC;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float rnd = aC.z;
  float cyc = uTime / ( 0.3 + 0.24 * rnd ) + position.y * 31.0;
  float k = mod( floor( cyc ), 251.0 );
  float u = fract( cyc );
  vec2 sd = vec2( k + rnd * 37.0, k * 1.37 + position.x * 53.0 );      // a new spot every cycle
  vec2 h = fract( sin( vec2( dot( sd, vec2( 12.9898, 78.233 ) ), dot( sd, vec2( 39.3468, 11.1351 ) ) ) ) * 43758.5453 );
  vec2 xz = ( position.xz + h ) * uArea;
  xz = uCenter.xz + mod( xz - uCenter.xz + 0.5 * uArea, uArea ) - 0.5 * uArea;
  vec4 mvPosition = modelViewMatrix * vec4( xz.x, uY, xz.y, 1.0 );
  float r = max( mix( 0.02, 0.055 + 0.075 * rnd, sqrt( u ) ), 0.002 * - mvPosition.z );   // a dot that opens into a ring
  mvPosition += modelViewMatrix * vec4( aC.x * r, 0.0, aC.y * r, 0.0 );
  gl_Position = projectionMatrix * mvPosition;
  vC = aC.xy;
  vA = uAlpha * pow( 1.0 - u, 1.5 ) * ( 0.55 + 0.45 * rnd );
  #include <fog_vertex>
}`;

const SPLASH_FS = `
uniform vec3 uColor;
uniform float uFlash;
varying vec2 vC;
varying float vA;
#include <fog_pars_fragment>
void main() {
  float d = length( vC );
  float ring = smoothstep( 0.3, 0.72, d ) * ( 1.0 - smoothstep( 0.8, 1.0, d ) );
  ${FOG_FADE}
  gl_FragColor = vec4( uColor * ( 1.0 + uFlash * 2.0 ), vA * ring * ( 1.0 - fxFog ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------------------------------------- helpers
const QUAD = [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0];
const QUAD_INDEX = [0, 1, 2, 2, 1, 3];

// Math.random() hands back a freshly boxed number on every call (about 50 MB of garbage per 100,000 puffs when
// measured), so the emitters draw from a table of random numbers instead: no call, no allocation.
const RND = new Float32Array(4096);
for (let i = 0; i < RND.length; i++) RND[i] = Math.random();
let rndAt = 0;
function rnd() { rndAt = (rndAt + 1) & 4095; return RND[rndAt]; }

// colours are given in sRGB like everywhere else and converted once, here, to the linear values the shaders work in
const lin = hex => new THREE.Color(hex);
const SMOKE_RGB = lin(0xa3a9b4), DUST_RGB = lin(0x94785a);
const SKID_RGB = lin(0x050506), RAIN_RGB = lin(0xa9bcdc), SPLASH_RGB = lin(0x93a7c8);

// the uniforms three.js fills in for a material with fog: true
function fogUniforms() {
  return { fogColor: { value: new THREE.Color(0x000000) }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogDensity: { value: 0.00025 } };
}

// Grow the one update range of a dynamic buffer to include array elements [lo, hi), so only the touched part is
// uploaded. The renderer empties buf.updateRanges after each upload; the range object is ours and is reused.
function markDirty(buf, range, lo, hi) {
  const list = buf.updateRanges;
  if (list) {
    if (list.length !== 1 || list[0] !== range) { list.length = 0; range.start = lo; range.count = hi - lo; list.push(range); }
    else { const end = Math.max(range.start + range.count, hi); if (lo < range.start) range.start = lo; range.count = end - range.start; }
  }
  buf.needsUpdate = true;
}

// A 256 px atlas of four lumpy smoke puffs. Red is density, green is light/dark mottling: it is a mask and not a
// colour map, so it stays in linear (no colour space) on purpose. Built once and shared by every Fx; puffUsers counts
// the live instances so that dispose() only frees it when the last one goes.
let puffTexture = null, puffUsers = 0;
function getPuffTexture() {
  if (puffTexture) return puffTexture;
  const N = 256, C = 128, L = 16, data = new Uint8Array(N * N * 4);
  let seed = 0x2f6e2b1;
  const prng = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lat = new Float32Array(L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = prng();     // seeded, so the puffs look the same on every run
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let tx = x - xi, ty = y - yi; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = xi & (L - 1), x1 = (xi + 1) & (L - 1), y0 = (yi & (L - 1)) * L, y1 = ((yi + 1) & (L - 1)) * L;
    const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const fbm = (x, y) => noise(x, y) * 0.5 + noise(x * 2.03 + 3.1, y * 2.03 + 7.7) * 0.3 + noise(x * 4.1 + 9.2, y * 4.1 + 1.4) * 0.2;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * C, oy = (cell >> 1) * C, sx = cell * 5.3 + 1.7, sy = cell * 3.1 + 8.2;
    for (let py = 0; py < C; py++) for (let px = 0; px < C; px++) {
      const u = (px + 0.5) / C * 2 - 1, v = (py + 0.5) / C * 2 - 1, r = Math.sqrt(u * u + v * v);
      const lump = fbm(u * 1.7 + sx, v * 1.7 + sy);
      let m = 1 - sstep(0.18, 0.95, r + (lump - 0.5) * 0.75);
      m *= 1 - sstep(0.78, 0.98, r);                               // always clear at the cell border, so nothing bleeds
      const o = ((oy + py) * N + ox + px) * 4;
      data[o] = Math.round(m * 255);
      data[o + 1] = Math.round(Math.min(1, Math.max(0, fbm(u * 3.3 + sy, v * 3.3 - sx) * 1.5 - 0.25)) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  puffTexture = tex;
  return tex;
}

// n unit quads for the shader-driven weather layers: position holds three random numbers per quad, aC the corner
function weatherGeometry(n, cornerOf) {
  const pos = new Float32Array(n * 12), c = new Float32Array(n * 12), idx = new Uint16Array(n * 6);
  for (let i = 0; i < n; i++) {
    const bx = Math.random(), by = Math.random(), bz = Math.random(), r = Math.random();
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      pos[o] = bx; pos[o + 1] = by; pos[o + 2] = bz;
      c[o] = cornerOf(k, 0); c[o + 1] = cornerOf(k, 1); c[o + 2] = r;
    }
    const v = i * 4, j = i * 6;
    idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2; idx[j + 3] = v + 2; idx[j + 4] = v + 1; idx[j + 5] = v + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aC', new THREE.BufferAttribute(c, 3));
  return geo;
}

// a pool of instanced camera-facing quads fed from one interleaved, dynamic buffer
function poolGeometry(cap, stride, names) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(QUAD_INDEX);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(QUAD), 3));
  const array = new Float32Array(cap * stride);
  for (let i = 0; i < cap; i++) { array[i * stride + 3] = -1e6; array[i * stride + 7] = 1; }     // born long ago: dead
  const buf = new THREE.InstancedInterleavedBuffer(array, stride, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  for (let k = 0; k < names.length; k++) geo.setAttribute(names[k], new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  geo.instanceCount = cap;
  return { geo, buf, array };
}

function noRaycast() {}
// clamp to 0..1; a missing or NaN value becomes the fallback (a negative one is a real 0, not "missing")
function clamp01(v, fallback) { v = +v; return v >= 0 ? (v > 1 ? 1 : v) : v < 0 ? 0 : fallback; }

// two strokes of lightning: a hard flash, a dip, a second weaker one, and out by half a second
function flashCurve(t) {
  if (t >= 0.5) return 0;
  const a = Math.exp(-t / 0.04), b = t > 0.12 ? 0.8 * Math.exp(-(t - 0.12) / 0.1) : 0;
  let k = (t - 0.36) / 0.14; k = k < 0 ? 0 : k > 1 ? 1 : k;
  return (a > b ? a : b) * (1 - k * k * (3 - 2 * k));
}

// ------------------------------------------------------------------------------------------------------------- Fx
export class Fx {
  // Builds the pools and adds them (inside one group, this.group) to the scene. opts: { quality: 'high' | 'low' }.
  constructor(scene, opts) {
    this.scene = scene;
    this.quality = opts && opts.quality === 'low' ? 'low' : 'high';
    this.flash = 0;                 // 0..1, read by the game to brighten its lights during lightning
    this.rain = 0;                  // the level currently shown (eases toward what setRain asked for)
    this.skidY = 0.012;             // height the tyre marks are laid at, just above the road at y = 0
    this._t = 0;
    this._flashT = -1;
    this._rainTarget = 0;
    this._rainShown = -1;
    this._disposed = false;

    const uTime = this._uTime = { value: 0 };
    const uFlash = this._uFlash = { value: 0 };
    const uCenter = this._uCenter = { value: new THREE.Vector3(0, 0, 0) };
    const group = this.group = new THREE.Group();
    group.name = 'fx';
    group.matrixAutoUpdate = false;
    this._meshes = [];
    const add = (geo, mat, order, name) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name; m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = order; m.visible = false; m.raycast = noRaycast;
      group.add(m); this._meshes.push(m);
      return m;
    };
    const material = (vs, fs, uniforms, additive) => new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, uniforms: Object.assign(fogUniforms(), uniforms), fog: true,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    // ---- tyre marks: a ring buffer of quads in one geometry
    {
      const geo = new THREE.BufferGeometry();
      const idx = new Uint16Array(SKID_CAP * 6), side = new Float32Array(SKID_CAP * 4);
      for (let i = 0; i < SKID_CAP; i++) {
        const v = i * 4, j = i * 6;
        idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2; idx[j + 3] = v + 2; idx[j + 4] = v + 1; idx[j + 5] = v + 3;
        side[v] = 1; side[v + 1] = -1; side[v + 2] = 1; side[v + 3] = -1;
      }
      this._skidPos = new Float32Array(SKID_CAP * 12);
      this._skidData = new Float32Array(SKID_CAP * 8);
      for (let i = 1; i < this._skidData.length; i += 2) this._skidData[i] = -1e6;
      this._skidPosAttr = new THREE.BufferAttribute(this._skidPos, 3); this._skidPosAttr.setUsage(THREE.DynamicDrawUsage);
      this._skidDataAttr = new THREE.BufferAttribute(this._skidData, 2); this._skidDataAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.setAttribute('position', this._skidPosAttr);
      geo.setAttribute('aData', this._skidDataAttr);
      geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      this._skidPosRange = { start: 0, count: 0 }; this._skidDataRange = { start: 0, count: 0 };
      this._skidHead = 0; this._skidSerial = 0; this._skidUntil = -1;
      // per wheel trail: end x, end z, dir x, dir z, last quad, its serial, time, in use
      this._trails = new Float64Array(TRAILS * TRAIL_STRIDE);
      const mat = material(SKID_VS, SKID_FS, { uTime, uFade: { value: SKID_FADE }, uColor: { value: SKID_RGB.clone() } }, false);
      mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
      this._skidMesh = add(geo, mat, ORDER_SKID, 'fx-skid');
    }

    // ---- rain splashes on the road
    {
      const geo = weatherGeometry(SPLASH_MAX, (k, axis) => (axis ? (k >> 1) : (k & 1)) * 2 - 1);
      this._splashU = { uTime, uFlash, uCenter, uArea: { value: SPLASH_AREA }, uY: { value: 0.018 }, uAlpha: { value: 0 }, uColor: { value: SPLASH_RGB.clone() } };
      this._splashMesh = add(geo, material(SPLASH_VS, SPLASH_FS, this._splashU, false), ORDER_SPLASH, 'fx-splash');
    }

    // ---- smoke and dust
    {
      const p = poolGeometry(SMOKE_CAP, SMOKE_STRIDE, ['aPos', 'aVel', 'aMisc', 'aCol']);
      this._smokeArr = p.array; this._smokeBuf = p.buf; this._smokeRange = { start: 0, count: 0 };
      this._smokeHead = 0; this._smokeUntil = -1;
      this._smokeU = { uTime, uFlash, uWind: { value: new THREE.Vector2(0.14, 0.06) }, uMap: { value: getPuffTexture() } };
      puffUsers++;
      this._smokeMesh = add(p.geo, material(SMOKE_VS, SMOKE_FS, this._smokeU, false), ORDER_SMOKE, 'fx-smoke');
    }

    // ---- sparks, crash flashes and backfire flames (the only additive layer)
    {
      const p = poolGeometry(SPARK_CAP, SPARK_STRIDE, ['aPos', 'aVel', 'aMisc']);
      this._sparkArr = p.array; this._sparkBuf = p.buf; this._sparkRange = { start: 0, count: 0 };
      this._sparkHead = 0; this._sparkUntil = -1;
      this._sparkMesh = add(p.geo, material(SPARK_VS, SPARK_FS, { uTime }, true), ORDER_SPARKS, 'fx-sparks');
    }

    // ---- rain streaks
    {
      const geo = weatherGeometry(RAIN_MAX, (k, axis) => axis ? (k & 1) * 2 - 1 : k >> 1);
      this._rainU = {
        uTime, uFlash, uCenter, uBox: { value: new THREE.Vector3(RAIN_BOX, RAIN_HEIGHT, RAIN_BOX) }, uFall: { value: new THREE.Vector3(4.4, -17, 1.9) },
        uLen: { value: 0.95 }, uWidth: { value: 0.01 }, uAlpha: { value: 0 }, uColor: { value: RAIN_RGB.clone() },
      };
      this._rainMesh = add(geo, material(RAIN_VS, RAIN_FS, this._rainU, false), ORDER_RAIN, 'fx-rain');
    }

    if (scene) scene.add(group);
  }

  // Call every frame before rendering. dt in seconds; time is accepted for symmetry with the other modules but the
  // effects run on their own clock (the sum of dt), so pausing the game pauses them. focus = { x, z } is the point
  // the camera looks at: rain and splashes are drawn around it.
  update(dt, time, focus) {
    dt = dt > 0 ? (dt < 0.25 ? dt : 0.25) : 0;      // same cap as the game loop; NaN and negatives count as 0
    this._endTrails();
    let t = this._t + dt;
    if (t > REBASE) { this._rebase(REBASE); t -= REBASE; }
    this._t = t;
    this._uTime.value = t;
    if (focus) {
      const x = +focus.x, z = +(focus.z !== undefined ? focus.z : focus.y);      // a Vector2 works too
      if (x === x && z === z) { const c = this._uCenter.value; c.x = x; c.z = z; }
    }

    // lightning envelope
    if (this._flashT === 0) this._flashT = 1e-6;          // the frame it starts on is drawn at full strength, whatever dt is
    else if (this._flashT > 0) {
      this._flashT += dt;
      this.flash = flashCurve(this._flashT);
      if (this._flashT >= 0.5) { this._flashT = -1; this.flash = 0; }
    }
    this._uFlash.value = this.flash;

    // rain eases in and out instead of switching
    const target = this._rainTarget;
    if (this.rain !== target) {
      const step = dt * 0.7;
      this.rain = this.rain < target ? Math.min(target, this.rain + step) : Math.max(target, this.rain - step);
    }
    if (this.rain !== this._rainShown) this._applyRain();

    // pools with nothing alive cost no draw call
    if (this._smokeMesh.visible && t > this._smokeUntil) this._smokeMesh.visible = false;
    if (this._sparkMesh.visible && t > this._sparkUntil) this._sparkMesh.visible = false;
    if (this._skidMesh.visible && t > this._skidUntil) this._skidMesh.visible = false;
  }

  // One puff of grey-white tyre smoke at a world position. strength 0..1 scales its size and opacity.
  smoke(x, y, z, strength) {
    this._puff(x, y, z, strength, 0);
  }

  // One puff of brown dust for unpaved lanes: lower, wider and slower to clear than smoke.
  dust(x, y, z, strength) {
    this._puff(x, y, z, strength, 1);
  }

  // A burst of 6 to 20 bright orange sparks from a crash point, thrown mostly along (nx, 0, nz) with spread, falling
  // and bouncing once on the road, plus a short flash at the point itself. strength 0..1.
  sparks(x, y, z, nx, nz, strength) {
    if (!(x === x && y === y && z === z)) return;
    const s = clamp01(strength, 0.6), a = this._sparkArr, t = this._t;
    const hasDir = nx * nx + nz * nz > 1e-10, base = hasDir ? Math.atan2(nx, nz) : 0;
    const n = 6 + Math.round(14 * s), push = 0.55 + 0.65 * s;
    if (y < 0.04) y = 0.04;
    for (let k = 0; k < n; k++) {
      const ang = base + (hasDir ? (rnd() + rnd() - 1) * 1.0 : rnd() * 6.2832), sp = (0.9 + 3.1 * rnd()) * push;
      const o = this._sparkSlot();
      a[o] = x + (rnd() - 0.5) * 0.06; a[o + 1] = y + rnd() * 0.05; a[o + 2] = z + (rnd() - 0.5) * 0.06; a[o + 3] = t;
      a[o + 4] = Math.sin(ang) * sp; a[o + 5] = (0.4 + 2.3 * rnd()) * (0.6 + 0.5 * s); a[o + 6] = Math.cos(ang) * sp;
      a[o + 7] = (0.25 + 0.5 * rnd()) * (0.8 + 0.4 * s);                    // life
      a[o + 8] = 0.011 + 0.008 * rnd(); a[o + 9] = 0; a[o + 10] = rnd(); a[o + 11] = 1.2 + 1.5 * rnd();
    }
    const o = this._sparkSlot();                                                    // the flash at the point of impact
    a[o] = x; a[o + 1] = y + 0.04; a[o + 2] = z; a[o + 3] = t;
    a[o + 4] = 0; a[o + 5] = 0; a[o + 6] = 0; a[o + 7] = 0.1 + 0.06 * s;
    a[o + 8] = 0.16 + 0.24 * s; a[o + 9] = 1; a[o + 10] = 0; a[o + 11] = 0.55 + 0.55 * s;
  }

  // Lay one dark tyre-mark segment on the road from (x0, z0) to (x1, z1). width in units (about 0.06), alpha 0..1.
  // Segments that start where the last one ended (the normal case: one call per rear wheel per frame) are joined
  // into a smooth ribbon. Marks fade out over about 14 seconds.
  skid(x0, z0, x1, z1, width, alpha) {
    const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
    if (!(l2 > 1e-8 && l2 < 9)) return;                    // standing still, a teleport, or NaN
    const len = Math.sqrt(l2), ux = dx / len, uz = dz / len;
    const hw = (width > 0 ? +width : 0.06) * 0.5, px = -uz * hw, pz = ux * hw;
    const a = clamp01(alpha, 0.6), t = this._t, y = this.skidY;
    const P = this._skidPos, D = this._skidData, T = this._trails;

    // which trail does this continue? (also remember the stalest slot, to recycle if it is a new one)
    let s = -1, oldest = 0, oldestT = Infinity;
    for (let i = 0; i < TRAILS; i++) {
      const o = i * TRAIL_STRIDE;
      if (T[o + 7] > 0 && Math.abs(T[o] - x0) < 0.02 && Math.abs(T[o + 1] - z0) < 0.02) { s = o; break; }
      const tt = T[o + 7] > 0 ? T[o + 6] : -Infinity;
      if (tt < oldestT) { oldestT = tt; oldest = o; }
    }
    let q = -1;
    if (s >= 0 && this._skidSerial - T[s + 5] < SKID_CAP && t - T[s + 6] < 0.6 && ux * T[s + 2] + uz * T[s + 3] > 0.2) {
      const pq = T[s + 4] | 0, b = pq * 12;
      const lx = T[s] - (P[b] + P[b + 3]) * 0.5, lz = T[s + 1] - (P[b + 2] + P[b + 5]) * 0.5;
      if (lx * lx + lz * lz < SKID_MIN_LEN * SKID_MIN_LEN) q = pq;                 // still short: stretch it
      else {                                                                       // start the next quad on its far edge
        q = this._nextSkidQuad();
        const n = q * 12, e = b + 6, nd = q * 8, ed = pq * 8 + 4;
        P[n] = P[e]; P[n + 1] = P[e + 1]; P[n + 2] = P[e + 2]; P[n + 3] = P[e + 3]; P[n + 4] = P[e + 4]; P[n + 5] = P[e + 5];
        D[nd] = D[ed]; D[nd + 1] = D[ed + 1]; D[nd + 2] = D[ed + 2]; D[nd + 3] = D[ed + 3];
        T[s + 5] = this._skidSerial;
      }
    } else {                                                                       // a new mark: starts faint, tapers in
      if (s < 0) s = oldest;
      q = this._nextSkidQuad();
      const n = q * 12, nd = q * 8;
      P[n] = x0 + px; P[n + 1] = y; P[n + 2] = z0 + pz; P[n + 3] = x0 - px; P[n + 4] = y; P[n + 5] = z0 - pz;
      D[nd] = 0; D[nd + 1] = t; D[nd + 2] = 0; D[nd + 3] = t;
      T[s + 5] = this._skidSerial;
    }
    const e = q * 12 + 6, ed = q * 8 + 4;
    P[e] = x1 + px; P[e + 1] = y; P[e + 2] = z1 + pz; P[e + 3] = x1 - px; P[e + 4] = y; P[e + 5] = z1 - pz;
    D[ed] = a; D[ed + 1] = t; D[ed + 2] = a; D[ed + 3] = t;
    T[s] = x1; T[s + 1] = z1; T[s + 2] = ux; T[s + 3] = uz; T[s + 4] = q; T[s + 6] = t; T[s + 7] = 1;
    markDirty(this._skidPosAttr, this._skidPosRange, q * 12, q * 12 + 12);
    markDirty(this._skidDataAttr, this._skidDataRange, q * 8, q * 8 + 8);
    this._skidUntil = t + SKID_FADE;
    this._skidMesh.visible = true;
  }

  // A small additive pop of flame at (x, y, z) blown along (dx, 0, dz): exhaust backfire or a nitro lick.
  flame(x, y, z, dx, dz) {
    if (!(x === x && y === y && z === z)) return;
    const l = Math.sqrt(dx * dx + dz * dz), ok = l > 1e-5, ux = ok ? dx / l : 0, uz = ok ? dz / l : 0, a = this._sparkArr, t = this._t;
    for (let i = 0; i < 2; i++) {
      const sp = 0.9 + rnd() * 1.1, o = this._sparkSlot();
      a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = t;
      a[o + 4] = ux * sp + (rnd() - 0.5) * 0.3; a[o + 5] = 0.1 + rnd() * 0.25; a[o + 6] = uz * sp + (rnd() - 0.5) * 0.3;
      a[o + 7] = 0.1 + rnd() * 0.09;                                        // life
      a[o + 8] = 0.06 + rnd() * 0.04; a[o + 9] = 1; a[o + 10] = 0; a[o + 11] = 0.9 + rnd() * 0.5;
    }
  }

  // 0 = dry, 1 = heavy rain. The change eases in over a second or so; pass instant = true to jump straight there.
  setRain(level, instant) {
    this._rainTarget = clamp01(level, 0);
    if (instant) { this.rain = this._rainTarget; this._applyRain(); }
  }

  // Start a lightning flash: this.flash jumps to 1 and decays to 0 over about half a second with a double flicker.
  // Rain, splashes and smoke light up with it; the game brightens its own lights from fx.flash and plays the thunder.
  lightning() {
    this._flashT = 0;
    this.flash = 1;
    this._uFlash.value = 1;
  }

  // 'high' | 'low' at any time. Low draws a third of the rain streaks and fewer splashes; the pools are unchanged.
  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    this._applyRain();
  }

  // Remove everything from the scene and free the GPU resources. The instance must not be used afterwards.
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this._meshes) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this._meshes.length = 0;
    // the puff texture is shared: free it with the last instance only (a later Fx simply uploads it again)
    if (--puffUsers <= 0) { puffUsers = 0; if (puffTexture) puffTexture.dispose(); }
    this.flash = 0;
  }

  // ---- internals ----------------------------------------------------------------------------------------------

  // write one soft puff (kind 0 smoke, 1 dust) into the pool, overwriting the oldest slot
  _puff(x, y, z, strength, kind) {
    if (!(x === x && y === y && z === z)) return;
    const s = clamp01(strength, 0.6), a = this._smokeArr, i = this._smokeHead, o = i * SMOKE_STRIDE, t = this._t;
    const rgb = kind ? DUST_RGB : SMOKE_RGB, shade = 0.85 + rnd() * 0.3, spread = kind ? 0.9 : 0.5;
    const life = kind ? 1.3 + s + rnd() * 0.6 : 1.0 + 0.9 * s + rnd() * 0.5;
    this._smokeHead = i + 1 === SMOKE_CAP ? 0 : i + 1;
    a[o] = x + (rnd() - 0.5) * 0.06; a[o + 1] = y; a[o + 2] = z + (rnd() - 0.5) * 0.06; a[o + 3] = t;
    a[o + 4] = (rnd() - 0.5) * spread; a[o + 5] = 0; a[o + 6] = (rnd() - 0.5) * spread; a[o + 7] = life;
    if (kind) { a[o + 8] = 0.2 + 0.14 * s; a[o + 9] = 0.7 + 0.7 * s + rnd() * 0.3; a[o + 10] = 0.14 + 0.25 * s; a[o + 15] = 0.05 + rnd() * 0.1; }
    else { a[o + 8] = 0.2 + 0.16 * s; a[o + 9] = 0.65 + 0.8 * s + rnd() * 0.25; a[o + 10] = 0.13 + 0.27 * s; a[o + 15] = 0.22 + rnd() * 0.25; }
    a[o + 11] = rnd();                                                      // seed: rotation and puff shape
    a[o + 12] = rgb.r * shade; a[o + 13] = rgb.g * shade; a[o + 14] = rgb.b * shade;
    if (t + life > this._smokeUntil) this._smokeUntil = t + life;
    this._smokeMesh.visible = true;
    markDirty(this._smokeBuf, this._smokeRange, o, o + SMOKE_STRIDE);
  }

  // claim the next slot of the additive pool and return its offset; the caller fills in the twelve numbers:
  // x, y, z, birth, vx, vy, vz, life, size, kind (0 spark, 1 round glow), seed, brightness
  _sparkSlot() {
    const i = this._sparkHead, o = i * SPARK_STRIDE;
    this._sparkHead = i + 1 === SPARK_CAP ? 0 : i + 1;
    this._sparkUntil = this._t + 1;              // nothing in this pool lives longer than a second
    this._sparkMesh.visible = true;
    markDirty(this._sparkBuf, this._sparkRange, o, o + SPARK_STRIDE);
    return o;
  }

  // A tyre mark that has not been continued for TRAIL_END seconds is finished: fade the far edge of its last quad to
  // nothing, so it ends in a tapered tip like it began instead of a square cut, and free its trail slot. Runs once a
  // frame over the 16 trail records and touches four floats when a mark ends.
  _endTrails() {
    const T = this._trails, D = this._skidData, t = this._t;
    for (let o = 0; o < T.length; o += TRAIL_STRIDE) {
      if (T[o + 7] > 0 && t - T[o + 6] > TRAIL_END) {
        T[o + 7] = 0;
        if (this._skidSerial - T[o + 5] < SKID_CAP) {          // its last quad is still in the ring
          const ed = (T[o + 4] | 0) * 8 + 4;
          D[ed] = 0; D[ed + 2] = 0;
          markDirty(this._skidDataAttr, this._skidDataRange, ed, ed + 4);
        }
      }
    }
  }

  // take the next quad of the tyre-mark ring (the oldest one)
  _nextSkidQuad() {
    const q = this._skidHead;
    this._skidHead = q + 1 === SKID_CAP ? 0 : q + 1;
    this._skidSerial++;
    return q;
  }

  // show the current rain level: how many streaks and splashes are drawn, and how strongly
  _applyRain() {
    const r = this.rain, low = this.quality === 'low';
    this._rainShown = r;
    const on = r > 0.01 && !this._disposed;
    this._rainMesh.visible = on;
    this._splashMesh.visible = on;
    if (!on) return;
    const streaks = Math.max(1, Math.round(RAIN_MAX * (low ? 1 / 3 : 1) * r));
    const rings = Math.max(1, Math.round(SPLASH_MAX * (low ? 0.4 : 1) * r));
    this._rainMesh.geometry.setDrawRange(0, streaks * 6);
    this._splashMesh.geometry.setDrawRange(0, rings * 6);
    this._rainU.uAlpha.value = 0.2 + 0.2 * r;
    this._splashU.uAlpha.value = 0.2 + 0.16 * r;
    this._smokeU.uWind.value.set(0.14 + 0.5 * r, 0.06 + 0.22 * r);      // the storm pushes the smoke the way the rain slants
  }

  // pull every stored time back by d so the clock can wrap without anything jumping (runs about once in half an hour)
  _rebase(d) {
    const sm = this._smokeArr, sk = this._sparkArr, D = this._skidData, T = this._trails;
    for (let i = 3; i < sm.length; i += SMOKE_STRIDE) if (sm[i] > -1e5) sm[i] -= d;
    for (let i = 3; i < sk.length; i += SPARK_STRIDE) if (sk[i] > -1e5) sk[i] -= d;
    for (let i = 1; i < D.length; i += 2) if (D[i] > -1e5) D[i] -= d;
    for (let i = 6; i < T.length; i += TRAIL_STRIDE) T[i] -= d;
    this._smokeUntil -= d; this._sparkUntil -= d; this._skidUntil -= d;
    markDirty(this._smokeBuf, this._smokeRange, 0, sm.length);
    markDirty(this._sparkBuf, this._sparkRange, 0, sk.length);
    markDirty(this._skidDataAttr, this._skidDataRange, 0, D.length);
  }
}
