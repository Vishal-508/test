// Post-processing: bloom so lamps, neon and sirens glow, then a colour grade with vignette.
// Falls back to plain rendering when the device cannot do it (or the player picks low quality).
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.85 }, uHide: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVig; uniform float uHide; uniform float uFlash; varying vec2 vUv;
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      vec2 d = vUv - 0.5; float r2 = dot( d, d );
      float l = dot( c.rgb, vec3( 0.299, 0.587, 0.114 ) );
      c.rgb = mix( c.rgb * vec3( 0.95, 0.98, 1.06 ), c.rgb * vec3( 1.06, 1.0, 0.94 ), smoothstep( 0.0, 0.55, l ) );   // cold shadows, warm lights
      c.rgb = mix( vec3( l ), c.rgb, 1.14 - 0.55 * uHide );                                                        // colour drains while you hide
      c.rgb *= 1.0 - uVig * smoothstep( 0.1, 0.6, r2 ) * ( 1.0 + 0.8 * uHide );
      c.rgb += vec3( 0.42, 0.47, 0.62 ) * uFlash;                                                                   // lightning
      gl_FragColor = c;
    }`,
};

export function makePost(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  const gl = renderer.getContext();
  const canFloat = renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const P = { ok: canFloat, enabled: false, uniforms: GradeShader.uniforms, composer: null, bloom: null };
  let grade = null;
  function build() {
    const size = renderer.getSize(new THREE.Vector2());
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));
    P.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.5, 0.9);
    composer.addPass(P.bloom);
    grade = new ShaderPass(GradeShader); P.uniforms = grade.uniforms; composer.addPass(grade);
    composer.addPass(new OutputPass());
    P.composer = composer;
  }
  P.setEnabled = on => {
    on = !!on && P.ok;
    if (on && !P.composer) { try { build(); } catch (e) { console.warn('post-processing unavailable', e); P.ok = false; on = false; } }
    P.enabled = on;
  };
  P.setSize = (w, h) => { if (P.composer) { P.composer.setPixelRatio(renderer.getPixelRatio()); P.composer.setSize(w, h); } };
  P.render = dt => { if (P.enabled && P.composer) P.composer.render(dt); else renderer.render(scene, camera); };
  return P;
}
