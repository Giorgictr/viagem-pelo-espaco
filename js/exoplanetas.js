// Exoplanetas confirmados (NASA Exoplanet Archive, gerado por dados/baixar_exoplanetas.py).
// As estrelas hospedeiras que não estão no HYG entram no catálogo de estrelas; perto de uma hospedeira, os planetas
// viram corpos visitáveis em órbitas keplerianas. Quando o planeta transita, a fase vem do horário do trânsito
// (o planeta passa na frente da estrela, visto da Terra); a orientação da órbita no céu (nodo) não é medida e fica
// arbitrária, e a inclinação, quando não medida, é a de um trânsito (89°) ou um valor típico (60°).
import * as THREE from '../vendor/three.module.js';
import { UA } from './unidades.js';
import { cat } from './estrelas.js';
import { equatorialParaCena } from './corpos.js';

export const exo = { porHyg: new Map(), estrelas: [], planetas: 0, fonte: '', data: '' };
const RAIO_TERRA = 6371, MASSA_SOL_EM_TERRAS = 332946;
const GRAU = Math.PI / 180;

const nomeEstrela = (n) => n.replace(/^(.+)'s [Ss]tar$/, 'Estrela de $1');

// Acrescenta as hospedeiras ao catálogo (antes de o céu ser montado)
export async function carregarExoplanetas() {
  const j = await fetch('dados/exoplanetas.json').then((r) => r.json());
  const extras = j.estrelas.filter((e) => e.h < 0);
  const dados = new Float32Array((cat.n + extras.length) * 5);
  dados.set(cat.dados.subarray(0, cat.n * 5));
  extras.forEach((e, k) => {
    e.h = cat.n + k;
    dados.set([e.p[0], e.p[1], e.p[2], e.M, e.bv], e.h * 5);
  });
  cat.dados = dados;
  cat.n += extras.length;
  for (const e of j.estrelas) {
    exo.porHyg.set(e.h, e);
    if (!cat.nomeDe.has(e.h)) cat.nomeDe.set(e.h, nomeEstrela(e.n));
    e.nome = cat.nomeDe.get(e.h);
  }
  exo.estrelas = j.estrelas;
  exo.planetas = j.estrelas.reduce((s, e) => s + e.pl.length, 0);
  exo.fonte = j.fonte;
  exo.data = j.data;
}

// Tipo e cor (ilustrativos): pelo raio e pela temperatura de equilíbrio
export function tipoPlaneta(p) {
  const T = p.Teq ?? 300;
  if (p.R < 1.6) return T > 1000 ? ['rochoso e incandescente', 0x8a4a32] : T > 330 ? ['rochoso e quente', 0x9c7b62] : T > 180 ? ['rochoso, temperado', 0x8c8274] : ['rochoso e gelado', 0xa9b2bd];
  if (p.R < 4) return T > 800 ? ['mininetuno quente', 0x8c8fa8] : ['mininetuno', 0x7fa6c4];
  if (p.R < 8) return T > 800 ? ['netuno quente', 0x6f86b3] : ['gigante de gelo', 0x5b8fc7];
  return T > 1000 ? ['júpiter quente', 0x6e4a3c] : T > 400 ? ['gigante gasoso morno', 0xb59a78] : ['gigante gasoso', 0xc9b08a];
}

// Kepler: anomalia excêntrica pela média
function anomaliaE(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };

// Órbita de um planeta: base no plano do céu (z para a Terra), elementos e fase
export function prepararOrbita(p, estrela) {
  const e = Math.min(p.e ?? 0, 0.97), w = (p.w ?? 90) * GRAU;
  const i = (p.i ?? (p.met === 'Transit' ? 89 : 60)) * GRAU;
  const paraTerra = estrela.abs.clone().negate().normalize();
  const norteCeu = equatorialParaCena(0, 0, 1, new THREE.Vector3());
  const N = norteCeu.addScaledVector(paraTerra, -norteCeu.dot(paraTerra)).normalize(); // norte no plano do céu (nodo)
  const L = new THREE.Vector3().crossVectors(paraTerra, N); // leste
  const n = (2 * Math.PI) / p.P;
  let M0, t0;
  if (p.tm) {
    // no trânsito, o planeta está entre a estrela e a Terra: argumento da latitude u = ω + ν = 90°
    const nu = Math.PI / 2 - w;
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M0 = E - e * Math.sin(E); t0 = p.tm;
  } else { M0 = hash(p.n) * 2 * Math.PI; t0 = 2451545; }
  const normal = new THREE.Vector3().crossVectors(N, L.clone().multiplyScalar(Math.cos(i)).addScaledVector(paraTerra, Math.sin(i))).normalize();
  return { a: p.a * UA, e, w, i, n, M0, t0, N, L, Z: paraTerra, normal, faseConhecida: !!p.tm, iMedida: p.i != null };
}
// Posição relativa à estrela (km, eixos da cena) no dia juliano jd
export function posicaoOrbita(o, jd, out = new THREE.Vector3()) {
  const M = o.M0 + o.n * (jd - o.t0);
  return pontoOrbita(o, anomaliaE(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), o.e), out);
}
export function pontoOrbita(o, E, out = new THREE.Vector3()) {
  const r = o.a * (1 - o.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + o.e) * Math.sin(E / 2), Math.sqrt(1 - o.e) * Math.cos(E / 2));
  const u = o.w + nu;
  // nodo ascendente no norte do céu (Ω = 0): x = norte, y = leste, z = para a Terra
  return out.set(0, 0, 0).addScaledVector(o.N, r * Math.cos(u)).addScaledVector(o.L, r * Math.sin(u) * Math.cos(o.i)).addScaledVector(o.Z, r * Math.sin(u) * Math.sin(o.i));
}

// Objeto "corpo" de um planeta (reaproveitado enquanto o sistema estiver ativo)
export function corpoPlaneta(p, estrela) {
  const [tipo, cor] = tipoPlaneta(p);
  const raio = p.R * RAIO_TERRA;
  const massaSol = p.M / MASSA_SOL_EM_TERRAS;
  const o = {
    id: `exo:${p.n}`, nome: p.n, tipo: 'planeta', exo: p, tipoExo: tipo, estrela, raio,
    cor, cor3: new THREE.Color(cor), rochoso: p.R < 1.6, gasoso: p.R >= 1.6,
    // esfera de Hill (com folga para chegar perto)
    soi: Math.max(p.a * UA * Math.cbrt(massaSol / (3 * (estrela.massa ?? 1))), raio * 30),
    abs: new THREE.Vector3(), qOri: new THREE.Quaternion(), qOriAnt: new THREE.Quaternion(),
  };
  o.orbita = prepararOrbita(p, estrela);
  return o;
}

// Texto curto para o painel
export function resumoPlaneta(c, fmt) {
  const p = c.exo;
  const partes = [c.tipoExo + ' (aparência ilustrativa)'];
  partes.push(`${fmt(p.R)} vez${p.R >= 2 ? 'es' : ''} o raio da Terra${p.est & 1 ? ' (estimado pela massa)' : ''}`);
  if (!(p.est & 2)) partes.push(`${fmt(p.M)} massa${p.M >= 2 ? 's' : ''} da Terra`);
  if (p.P) partes.push(p.P < 2 ? `ano de ${fmt(p.P * 24)} horas` : p.P < 1000 ? `ano de ${fmt(p.P)} dias` : `ano de ${fmt(p.P / 365.25)} anos`);
  if (p.Teq) partes.push(`cerca de ${String(Math.round(p.Teq - 273)).replace('-', '−')} °C (temperatura de equilíbrio, sem atmosfera)`);
  partes.push(`descoberto em ${p.ano} por ${METODO[p.met] ?? p.met}`);
  return partes.join(' · ');
}
const METODO = {
  'Transit': 'trânsito', 'Radial Velocity': 'velocidade radial', 'Microlensing': 'microlente gravitacional', 'Imaging': 'imagem direta',
  'Transit Timing Variations': 'variação no horário dos trânsitos', 'Eclipse Timing Variations': 'variação no horário dos eclipses',
  'Orbital Brightness Modulation': 'variação de brilho na órbita', 'Pulsar Timing': 'pulsos de um pulsar', 'Astrometry': 'astrometria',
  'Pulsation Timing Variations': 'variação nas pulsações da estrela', 'Disk Kinematics': 'movimento do disco de gás',
};
