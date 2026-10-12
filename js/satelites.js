// Satélites em tempo real: ISS, Hubble e Tiangong, pelos elementos orbitais (TLE) atualizados do CelesTrak
// e o modelo padrão SGP4 (biblioteca satellite.js, MIT). Sem internet, usa uma cópia guardada; o modelo só
// é confiável a algumas semanas da data dos elementos.
import * as THREE from '../vendor/three.module.js';
import * as sat from '../vendor/satellite.js';
import { t } from './idioma.js';

const LISTA = [
  { id: 'iss', nome: t('Estação Espacial Internacional (ISS)'), catnr: 25544, cor: 0xffffff },
  { id: 'hubble', nome: t('Telescópio Hubble'), catnr: 20580, cor: 0xdfe8ff },
  { id: 'tiangong', nome: t('Estação Tiangong'), catnr: 48274, cor: 0xffe6d0 },
];
const VALIDADE = 20; // dias para cada lado da data dos elementos

// O CelesTrak atualiza os elementos a cada ~2 h e bloqueia quem baixa de novo antes disso: guarda no navegador
const GUARDA = 'viagemTLE', VALE_MS = 2 * 3600 * 1000;
async function baixar(s) {
  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem(GUARDA) || 'null'); } catch { /* sem armazenamento */ }
  const g = guardado?.[s.catnr];
  if (g && Date.now() - g.t < VALE_MS) return g.txt;
  // até 6 s: se o CelesTrak não responder, segue com a cópia guardada (senão os satélites demorariam minutos a aparecer)
  const txt = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${s.catnr}&FORMAT=TLE`, AbortSignal.timeout ? { signal: AbortSignal.timeout(6000) } : {})
    .then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (txt.includes('\n1 ')) {
    try { localStorage.setItem(GUARDA, JSON.stringify({ ...guardado, [s.catnr]: { t: Date.now(), txt } })); } catch { /* sem armazenamento */ }
    return txt;
  }
  return g && Date.now() - g.t < 3 * 86400000 ? g.txt : ''; // bloqueado ou sem rede: o guardado recente, senão a reserva do site (atualizada todo dia)
}
async function lerTLEs() {
  const textos = await Promise.all(LISTA.map(baixar));
  let reserva = null;
  return Promise.all(LISTA.map(async (s, i) => {
    let t = textos[i];
    if (!t.includes('\n1 ')) {
      reserva ??= await fetch('dados/tle_reserva.txt').then((r) => r.text()).catch(() => '');
      const linhas = reserva.split('\n');
      const k = linhas.findIndex((l) => l.startsWith(`1 ${String(s.catnr).padStart(5, '0')}`));
      t = k > 0 ? `${linhas[k - 1]}\n${linhas[k]}\n${linhas[k + 1]}` : '';
      s.reserva = true;
    }
    const l = t.split('\n').map((x) => x.trim()).filter(Boolean);
    const i1 = l.findIndex((x) => x.startsWith('1 '));
    return i1 >= 0 ? [l[i1], l[i1 + 1]] : null;
  }));
}

export function criarSatelites(PORID, raioTerra) {
  const objetos = [];
  const pronto = lerTLEs().then((tles) => {
    LISTA.forEach((s, i) => {
      if (!tles[i]) return;
      const rec = sat.twoline2satrec(tles[i][0], tles[i][1]);
      const epoca = rec.jdsatepoch + (rec.jdsatepochF || 0);
      objetos.push({
        ...s, tipo: 'satelite', rec, epoca, jd0: epoca - VALIDADE, jd1: epoca + VALIDADE, raio: 0.05,
        abs: new THREE.Vector3(), vel: new THREE.Vector3(), ativo: false, momentos: [], qOri: new THREE.Quaternion(), qOriAnt: new THREE.Quaternion(),
        lat: 0, lon: 0, alt: 0, sombra: false, segmentos: [],
      });
    });
  });
  const _d = new THREE.Vector3(), _p = new THREE.Vector3();
  function posicao(o, jd, out) {
    if (jd < o.jd0 || jd > o.jd1) return false;
    const data = new Date((jd - 2440587.5) * 86400000);
    const pv = sat.propagate(o.rec, data);
    if (!pv || !pv.position) return false;
    const g = sat.eciToGeodetic(pv.position, sat.gstime(data));
    o.lat = g.latitude; o.lon = g.longitude; o.alt = g.height;
    o.velTerra = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z); // km/s em relação à Terra
    o.velEq = pv.velocity;
    // mesma convenção da Terra da simulação: longitude 0 em +x, leste em −z, norte em +y
    _d.set(Math.cos(g.latitude) * Math.cos(g.longitude), Math.sin(g.latitude), -Math.cos(g.latitude) * Math.sin(g.longitude));
    const E = PORID.terra;
    out.copy(_d).multiplyScalar(raioTerra + g.height).applyQuaternion(E.qOri).add(E.abs);
    return true;
  }
  return {
    pronto, objetos,
    atualizar(jd) {
      const E = PORID.terra, sol = PORID.sol.abs;
      for (const o of objetos) {
        o.ativo = posicao(o, jd, o.abs);
        if (!o.ativo) continue;
        if (posicao(o, jd + 1 / 86400, _p)) o.vel.copy(_p).sub(o.abs); // km/s (em relação ao Sol, ~igual à da Terra + órbita)
        // na sombra da Terra? (sombra cilíndrica, suficiente para dizer se o satélite brilha)
        const r = _p.copy(o.abs).sub(E.abs), s = _d.copy(sol).sub(E.abs).normalize();
        const ao = r.dot(s);
        o.sombra = ao < 0 && r.clone().addScaledVector(s, -ao).length() < raioTerra;
      }
    },
  };
}

// ------------------------------- frota: muitos satélites como pontos -------------------------------
// grupos do CelesTrak: 'visual' (~150 mais brilhantes) ou 'active' (~11 mil). Cada satélite é recalculado com o SGP4
// em rodízio (alguns milhares por quadro) e brilha só quando está ao Sol.
async function lerGrupo(grupo) {
  // guardado no cache do navegador (aceita os ~2 MB do grupo completo); o CelesTrak só libera um download a cada 2 h
  const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${grupo}&FORMAT=tle`;
  let cache = null, guardado = null;
  try { cache = await caches.open('viagem-tle'); guardado = await cache.match(url); } catch { /* sem cache */ }
  const quando = guardado ? +guardado.headers.get('x-guardado') : 0;
  if (guardado && Date.now() - quando < VALE_MS) return guardado.text();
  const txt = await fetch(url, AbortSignal.timeout ? { signal: AbortSignal.timeout(20000) } : {})
    .then((r) => (r.ok ? r.text() : '')).catch(() => '');
  if (txt.includes('\n1 ')) {
    try { await cache?.put(url, new Response(txt, { headers: { 'x-guardado': String(Date.now()) } })); } catch { /* sem espaço */ }
    return txt;
  }
  if (guardado) return guardado.text(); // o guardado, mesmo antigo
  return grupo === 'visual' ? fetch('dados/tle_visual.txt').then((r) => r.text()).catch(() => '') : '';
}
export function criarFrota(PORID, raioTerra) {
  const frota = { n: 0, rec: [], nome: [], pos: null, luz: null, grupo: null, carregando: false, prox: 0 };
  const excluir = new Set(LISTA.map((s) => s.catnr)); // a ISS, o Hubble e a Tiangong já têm o seu próprio desenho
  async function carregar(grupo) {
    if (frota.grupo === grupo || frota.carregando) return;
    frota.carregando = true;
    const txt = grupo ? await lerGrupo(grupo) : '';
    const l = txt.split('\n').map((x) => x.trimEnd());
    const rec = [], nome = [];
    for (let i = 0; i + 2 < l.length; i++) {
      if (!l[i + 1].startsWith('1 ') || !l[i + 2].startsWith('2 ')) continue;
      const num = +l[i + 1].slice(2, 7);
      if (!excluir.has(num)) { try { rec.push(sat.twoline2satrec(l[i + 1], l[i + 2])); nome.push(l[i].trim()); } catch { /* elemento inválido */ } }
      i += 2;
    }
    if (!rec.length && grupo === 'active') { frota.carregando = false; frota.falhou = true; return carregar('visual'); }
    const n = rec.length;
    Object.assign(frota, { n, rec, nome, pos: new Float32Array(n * 3), luz: new Uint8Array(n), grupo, prox: 0, eci: new Float64Array(n * 6), jd0: new Float64Array(n).fill(NaN) });
    frota.carregando = false;
  }
  const _p = new THREE.Vector3(), _v = new THREE.Vector3();
  // recalcula com o SGP4 até "porQuadro" satélites (posição e velocidade inerciais); os demais avançam pela velocidade
  function atualizar(jd, porQuadro) {
    if (!frota.n) return;
    const data = new Date((jd - 2440587.5) * 86400000);
    const total = Math.min(porQuadro, frota.n);
    for (let k = 0; k < total; k++) {
      const i = frota.prox; frota.prox = (frota.prox + 1) % frota.n;
      const pv = sat.propagate(frota.rec[i], data);
      if (!pv || !pv.position || isNaN(pv.position.x)) { frota.jd0[i] = NaN; continue; }
      frota.eci.set([pv.position.x, pv.position.y, pv.position.z, pv.velocity.x, pv.velocity.y, pv.velocity.z], i * 6);
      frota.jd0[i] = jd;
    }
    // posição de todos agora (inercial → preso à Terra → eixos da cena) e se estão ao Sol
    const g = sat.gstime(data), cg = Math.cos(g), sg = Math.sin(g);
    const E = PORID.terra, sol = _p.copy(PORID.sol.abs).sub(E.abs).normalize();
    const e = frota.eci;
    for (let i = 0; i < frota.n; i++) {
      const j0 = frota.jd0[i];
      if (j0 !== j0 || Math.abs(jd - j0) * 86400 > 90) { frota.pos[i * 3] = NaN; continue; } // mais de 1,5 min sem recalcular (tempo acelerado): espera o próximo cálculo
      const dt = (jd - j0) * 86400, k = i * 6;
      const x = e[k] + e[k + 3] * dt, y = e[k + 1] + e[k + 4] * dt, z = e[k + 2] + e[k + 5] * dt;
      const X = x * cg + y * sg, Y = -x * sg + y * cg; // eixos da simulação: x = longitude 0, y = norte, z = −longitude 90° L
      _v.set(X, z, -Y).applyQuaternion(E.qOri);
      frota.pos[i * 3] = _v.x; frota.pos[i * 3 + 1] = _v.y; frota.pos[i * 3 + 2] = _v.z;
      const ao = _v.dot(sol);
      frota.luz[i] = ao > 0 || _v.addScaledVector(sol, -ao).length() > raioTerra ? 1 : 0; // fora da sombra cilíndrica da Terra
    }
  }
  return { frota, carregar, atualizar };
}
