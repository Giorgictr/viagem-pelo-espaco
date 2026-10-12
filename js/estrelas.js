// Catálogo HYG v4.1 (Hipparcos + Yale + Gliese): ~109 mil estrelas com posição 3D real.
// dados/estrelas.bin: por estrela, x, y, z (parsecs, já no sistema da cena), magnitude absoluta, índice de cor B−V.
import * as THREE from '../vendor/three.module.js';
import { PC, AL, UA, OBLIQUIDADE } from './unidades.js';

export const cat = { n: 0, dados: null, nomes: [], porNome: new Map() };

const APELIDOS = {
  'Rigil Kentaurus': 'Alfa Centauri A', Toliman: 'Alfa Centauri B', Polaris: 'Polaris (Estrela Polar)',
};
export const DESTAQUES = ['Proxima Centauri', 'Alfa Centauri A', 'Estrela de Barnard', 'Sirius', 'Procyon', 'Altair', 'Vega',
  'Fomalhaut', 'Arcturus', 'Pollux', 'Capella', 'Aldebaran', 'Regulus', 'Spica', 'Polaris (Estrela Polar)', 'Antares',
  'Betelgeuse', 'Rigel', 'Canopus', 'Deneb', 'Achernar'];

const traduzir = (n) => APELIDOS[n] ?? n.replace(/^(.+)'s Star$/, 'Estrela de $1');

export async function carregarEstrelas() {
  const [bin, nomes] = await Promise.all([
    fetch('dados/estrelas.bin').then((r) => r.arrayBuffer()),
    fetch('dados/estrelas_nomes.json').then((r) => r.json()),
  ]);
  cat.dados = new Float32Array(bin);
  cat.n = cat.dados.length / 5;
  cat.nomeDe = new Map();
  for (const [i, n] of nomes) {
    const nome = traduzir(n);
    cat.nomes.push({ i, nome });
    cat.porNome.set(nome, i);
    cat.nomeDe.set(i, nome);
  }
  cat.nomes.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

// Temperatura pela cor (Ballesteros 2012) e cor RGB de corpo negro (aproximação de Tanner Helland)
const TABELA_M = [[1.4, 3900], [1.5, 3600], [1.6, 3400], [1.7, 3200], [1.8, 3050], [1.9, 2900], [2.0, 2800]];
const interp = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
};
export function temperatura(bv) {
  bv = Math.min(Math.max(bv, -0.4), 2.0);
  if (bv > 1.4) return interp(TABELA_M, bv);
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}
export function corDeTemperatura(T, out = new THREE.Color()) {
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = (x) => Math.min(Math.max(x, 0), 255) / 255;
  // suaviza a saturação: estrelas parecem mais brancas a olho nu do que o corpo negro puro
  const R = c(r), G = c(g), B = c(b);
  const m = (R + G + B) / 3;
  return out.setRGB(m + (R - m) * 0.75, m + (G - m) * 0.75, m + (B - m) * 0.75);
}

// Luminosidade total (com correção bolométrica) e raio estimado
function fisica(absmag, bv) {
  const T = temperatura(bv);
  const x = Math.log10(T) - 4;
  const BC_M = [[2800, -4.6], [3000, -3.8], [3200, -3.1], [3400, -2.5], [3600, -1.9], [3800, -1.4], [4000, -1.0]];
  const bc = T < 4000 ? interp(BC_M, T) : Math.max(-6, Math.min(0.1, -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x ** 2 - 3.901 * x - 0.438));
  const lum = 10 ** (-0.4 * (absmag + bc - 4.74));
  const raio = 695700 * Math.sqrt(lum) * (5772 / T) ** 2;
  return { T, lum, raio };
}

// Objeto "corpo" para uma estrela do catálogo (criado sob demanda e reaproveitado)
const cache = new Map();
export function estrelaObj(i) {
  if (cache.has(i)) return cache.get(i);
  const d = cat.dados, k = i * 5;
  const { T, lum, raio } = fisica(d[k + 3], d[k + 4]);
  const o = {
    id: `hyg${i}`, hyg: i, tipo: 'estrela', nome: cat.nomeDe.get(i) ?? `Estrela sem nome (HYG ${i})`,
    abs: new THREE.Vector3(d[k], d[k + 1], d[k + 2]).multiplyScalar(PC),
    raio, lum, T, cor: corDeTemperatura(T).getHex(),
    soi: Math.min(Math.max(2000 * UA * Math.sqrt(lum), 0.05 * AL), 1 * AL),
    absmag: d[k + 3], lumV: 10 ** (-0.4 * (d[k + 3] - 4.83)),
    qOri: new THREE.Quaternion(), qOriAnt: new THREE.Quaternion(),
  };
  o.cor3 = new THREE.Color(o.cor);
  cache.set(i, o);
  return o;
}

// As k estrelas mais próximas de um ponto (km), por força bruta — ~1 ms para o catálogo todo
export function maisProximas(abs, k) {
  const d = cat.dados, x = abs.x / PC, y = abs.y / PC, z = abs.z / PC;
  const melhores = [];
  for (let i = 0; i < cat.n; i++) {
    const j = i * 5, dx = d[j] - x, dy = d[j + 1] - y, dz = d[j + 2] - z;
    const q = dx * dx + dy * dy + dz * dz;
    if (melhores.length < k || q < melhores[melhores.length - 1][1]) {
      melhores.push([i, q]);
      melhores.sort((a, b) => a[1] - b[1]);
      if (melhores.length > k) melhores.pop();
    }
  }
  return melhores.map(([i]) => i);
}

// Gaia DR3: ~1,1 milhão de estrelas a mais (até a magnitude 11, sem as que já estão no HYG), 10 bytes cada:
// ascensão reta e declinação em 24 bits, distância em escala log (16 bits), magnitude absoluta V e B−V (8 bits cada).
// Usam o mesmo material das estrelas do HYG; não viram "corpos" visitáveis.
export async function carregarGaia(material) {
  const buf = await fetch('dados/gaia.bin').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
  const b = new Uint8Array(buf), n = Math.floor(b.length / 10);
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), cor = new Float32Array(n * 3), temp = new Float32Array(n);
  const ce = Math.cos(OBLIQUIDADE), se = Math.sin(OBLIQUIDADE), L = Math.log10(30000), G = Math.PI / 180;
  const c = new THREE.Color();
  for (let i = 0, k = 0; i < n; i++, k += 10) {
    const ra = ((b[k] | (b[k + 1] << 8) | (b[k + 2] << 16)) / 16777215) * 360 * G;
    const dec = (((b[k + 3] | (b[k + 4] << 8) | (b[k + 5] << 16)) / 16777215) * 180 - 90) * G;
    const d = 10 ** (((b[k + 6] | (b[k + 7] << 8)) / 65535) * L);
    const x = d * Math.cos(dec) * Math.cos(ra), y = d * Math.cos(dec) * Math.sin(ra), z = d * Math.sin(dec);
    pos[i * 3] = x; pos[i * 3 + 1] = -y * se + z * ce; pos[i * 3 + 2] = -(y * ce + z * se); // equatorial → cena
    mag[i] = (b[k + 8] / 255) * 25.5 - 10;
    temp[i] = temperatura((b[k + 9] / 255) * 2.55 - 0.5);
    corDeTemperatura(temp[i], c).toArray(cor, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('absmag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  geo.setAttribute('temp', new THREE.BufferAttribute(temp, 1));
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  pts.userData.n = n;
  return pts;
}

// Nuvem de pontos com todas as estrelas; brilho e posição calculados na GPU
export function criarCeu(S) {
  const d = cat.dados;
  const pos = new Float32Array(cat.n * 3), mag = new Float32Array(cat.n), cor = new Float32Array(cat.n * 3), temp = new Float32Array(cat.n);
  const c = new THREE.Color();
  for (let i = 0; i < cat.n; i++) {
    pos[i * 3] = d[i * 5]; pos[i * 3 + 1] = d[i * 5 + 1]; pos[i * 3 + 2] = d[i * 5 + 2];
    mag[i] = d[i * 5 + 3];
    temp[i] = temperatura(d[i * 5 + 4]);
    corDeTemperatura(temp[i], c).toArray(cor, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('absmag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  geo.setAttribute('temp', new THREE.BufferAttribute(temp, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: S.CEU_V, fragmentShader: S.BRILHO_F,
    uniforms: {
      camAlto: { value: new THREE.Vector3() }, camBaixo: { value: new THREE.Vector3() },
      PCKM: { value: PC }, R0: { value: 1e8 }, limite: { value: 6.5 }, limiteTam: { value: 6.5 }, escalaPx: { value: 1 }, apagar: { value: 0 },
      ocultos: { value: new Int32Array(8).fill(-1) }, beta: { value: new THREE.Vector3() }, zenite: { value: new THREE.Vector3(0, 1, 0) }, refr: { value: 0 },
    },
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}
