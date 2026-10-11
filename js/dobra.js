// Efeito cinematográfico de dobra: riscos de luz que passam pela nave no sentido do movimento.
// Vive no espaço da câmera (filho dela) e não depende da escala do universo.
import * as THREE from '../vendor/three.module.js';

const N = 900, RAIO = 60;
const pos = new Float32Array(N * 2 * 3), cor = new Float32Array(N * 2 * 3);
const p = Array.from({ length: N }, () => new THREE.Vector3());
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
geo.setAttribute('color', new THREE.BufferAttribute(cor, 3).setUsage(THREE.DynamicDrawUsage));
export const riscos = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
  vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false,
}));
riscos.frustumCulled = false;
riscos.renderOrder = 10;
riscos.visible = false;

const dir = new THREE.Vector3(0, 0, -1), _a = new THREE.Vector3(), _b = new THREE.Vector3();

// Nasce à frente (no sentido do movimento), afastado do eixo para não riscar o centro da tela
function nascer(v, longe) {
  _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(dir).normalize();
  const lateral = 1.2 + Math.random() * 9;
  v.copy(_a).multiplyScalar(lateral).addScaledVector(dir, longe ? RAIO * (0.3 + Math.random() * 0.7) : RAIO);
}
p.forEach((v) => nascer(v, true));

let w = 0, wAnt = 0;
// intensidade 0..1 e direção do movimento no espaço da câmera; devolve 'entrou' | 'saiu' | ''
export function atualizarDobra(alvo, dirCam, dt) {
  w += (alvo - w) * (1 - Math.exp(-dt * (alvo > w ? 2.5 : 4)));
  if (dirCam.lengthSq() > 0) dir.lerp(dirCam, 1 - Math.exp(-dt * 6)).normalize();
  riscos.visible = w > 0.01;
  let evento = '';
  if (wAnt < 0.35 && w >= 0.35) evento = 'entrou';
  if (wAnt >= 0.35 && w < 0.35) evento = 'saiu';
  wAnt = w;
  if (!riscos.visible) return evento;
  const vel = (25 + 160 * w) * dt, comp = 0.5 + 22 * w * w;
  for (let i = 0; i < N; i++) {
    const v = p[i];
    v.addScaledVector(dir, -vel);
    if (v.dot(dir) < -4 || v.length() > RAIO * 1.2) nascer(v, false);
    _b.copy(v).addScaledVector(dir, comp);
    v.toArray(pos, i * 6);
    _b.toArray(pos, i * 6 + 3);
    const brilho = w * Math.min(1, (RAIO - v.length()) / 10 + 0.3);
    cor[i * 6] = 0.75 * brilho; cor[i * 6 + 1] = 0.85 * brilho; cor[i * 6 + 2] = 1.0 * brilho;
    cor[i * 6 + 3] = cor[i * 6 + 4] = cor[i * 6 + 5] = 0;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.color.needsUpdate = true;
  return evento;
}
export const intensidadeDobra = () => w;
