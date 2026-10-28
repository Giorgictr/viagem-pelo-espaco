// Buracos negros visitáveis: o disco de gás dos que estão engolindo matéria e a lente gravitacional (calculada aqui e
// aplicada na imagem inteira por js/brilho.js). Distâncias em km; raio do corpo = raio de Schwarzschild (rs).
// Lente: aproximação de lente pontual, θ_E = √(2 rs / D) (fontes ao fundo, no infinito); a sombra tem √27/2 ≈ 2,6 rs
// de raio. O disco vai de 3 rs (a última órbita estável) a ~22 rs, com o brilho de um disco fino (Shakura–Sunyaev),
// a cor indo de branco-azulado (quente, por dentro) a laranja, e o efeito Doppler relativístico: o lado que vem na
// nossa direção brilha mais.
import * as THREE from '../vendor/three.module.js';
import { DISCO_V, DISCO_F } from './shaders.js';

const SOMBRA = 2.598, R_IN = 3, R_OUT = 22;

export function criarBuracosNegros(cena, lista) {
  const geo = new THREE.RingGeometry(R_IN * 0.9, R_OUT, 160, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: DISCO_V, fragmentShader: DISCO_F,
    uniforms: { brilho: { value: 1 }, olho: { value: new THREE.Vector3() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const disco = new THREE.Mesh(geo, mat);
  disco.frustumCulled = false;
  disco.visible = false;
  disco.renderOrder = 5;
  cena.add(disco);
  // orientação do disco de cada um: quase de lado para quem chega pela direção padrão (~80° de inclinação)
  const chegada = new THREE.Vector3(0.35, 0.3, 1).normalize();
  for (const c of lista) {
    const n = new THREE.Vector3().crossVectors(chegada, new THREE.Vector3(1, 0, 0)).normalize();
    n.multiplyScalar(Math.cos(10 * Math.PI / 180)).addScaledVector(chegada, Math.sin(10 * Math.PI / 180)).normalize();
    c.bn.q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }
  const _r = new THREE.Vector3(), _p = new THREE.Vector3(), _qi = new THREE.Quaternion();

  return {
    // devolve a lente do buraco negro mais "forte" na tela, ou null; posiciona o disco dele
    atualizar(abs, camera, comprimir, aberrar, alturaTela) {
      let melhor = null, kMin = Infinity;
      for (const c of lista) {
        const D = _r.copy(c.abs).sub(abs).length();
        const k = D / c.raio;
        if (k < kMin) { kMin = k; melhor = c; }
      }
      disco.visible = false;
      if (!melhor || kMin > 1e7) return null;
      const c = melhor, rs = c.raio;
      const rel = _r.copy(c.abs).sub(abs), D = rel.length();
      // disco
      if (c.bn.disco > 0 && kMin < 2e5) {
        const s = comprimir(D);
        aberrar(disco.position.copy(rel).multiplyScalar(s));
        disco.scale.setScalar(rs * s);
        disco.quaternion.copy(c.bn.q);
        mat.uniforms.brilho.value = c.bn.disco;
        mat.uniforms.olho.value.copy(rel).negate().divideScalar(rs).applyQuaternion(_qi.copy(c.bn.q).invert()); // câmera no referencial do disco (em rs)
        disco.visible = true;
      }
      // lente: centro na tela e raios em fração da altura da tela
      _p.copy(rel).normalize().multiplyScalar(1e3);
      aberrar(_p).applyMatrix4(camera.matrixWorldInverse);
      if (_p.z >= 0) return null;
      _p.applyMatrix4(camera.projectionMatrix);
      const tanMeio = Math.tan((camera.fov * Math.PI) / 360);
      const ang = (a) => Math.tan(Math.min(a, 1.45)) / (2 * tanMeio);
      const thE = Math.sqrt((2 * rs) / Math.max(D, 3 * rs));
      const thS = Math.asin(Math.min(1, (SOMBRA * rs) / D));
      if (ang(thE) * alturaTela < 0.7) return null; // menos de um pixel: sem efeito
      return { x: _p.x * 0.5 + 0.5, y: _p.y * 0.5 + 0.5, re: ang(thE), sombra: ang(thS), c };
    },
  };
}
