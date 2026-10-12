// Satélites em tempo real: ISS, Hubble e Tiangong, pelos elementos orbitais (TLE) atualizados do CelesTrak
// e o modelo padrão SGP4 (biblioteca satellite.js, MIT). Sem internet, usa uma cópia guardada; o modelo só
// é confiável a algumas semanas da data dos elementos.
import * as THREE from '../vendor/three.module.js';
import * as sat from '../vendor/satellite.js';

const LISTA = [
  { id: 'iss', nome: 'Estação Espacial Internacional (ISS)', catnr: 25544, cor: 0xffffff },
  { id: 'hubble', nome: 'Telescópio Hubble', catnr: 20580, cor: 0xdfe8ff },
  { id: 'tiangong', nome: 'Estação Tiangong', catnr: 48274, cor: 0xffe6d0 },
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
