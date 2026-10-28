// Nomes do relevo (crateras, montes, vales, mares...) no chão dos corpos do Sistema Solar, da lista oficial da UAI
// (Gazetteer of Planetary Nomenclature, USGS; dados/gerar_nomes.py). Os nomes aparecem quando o lugar fica grande o
// bastante na tela, dos maiores para os menores, sem se sobrepor; clicar abre a ficha.
// Cada nome: [nome, tipo, diâmetro (km), lat, lon leste, índice da origem, id no Gazetteer].
import * as THREE from '../vendor/three.module.js';

const MAX = 70; // rótulos ao mesmo tempo
const _p = new THREE.Vector3(), _n = new THREE.Vector3();

// direção no referencial do corpo (a mesma convenção do resto do programa: lon para leste)
export const dirLatLon = (lat, lon, out = new THREE.Vector3()) => {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
};

// tamanho nominal dos lugares que a lista dá sem diâmetro (pontos de pouso, regiões, plumas)
const tamanho = (f, raio) => f[2] > 0 ? f[2] : ['RE', 'AL', 'TA'].includes(f[1]) ? raio * 0.4 : f[1] === 'ER' || f[1] === 'PU' ? 60 : 3;

export function criarNomesRelevo(camada, aoClicar) {
  const dados = new Map(); // corpo → lista (ou promessa)
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const el = document.createElement('div');
    el.className = 'lugar relevo';
    el.style.display = 'none';
    el.onclick = () => el.f && aoClicar(el.corpo, el.f);
    camada.append(el);
    pool.push(el);
  }
  const carregar = (c) => {
    if (!dados.has(c.id)) dados.set(c.id, fetch(`dados/nomes/${c.id}.json`).then((r) => r.json()).then((l) => dados.set(c.id, l)).catch(() => dados.set(c.id, [])));
    const d = dados.get(c.id);
    return Array.isArray(d) ? d : null;
  };
  let usados = 0;
  const esconder = () => { for (let i = 0; i < usados; i++) pool[i].style.display = 'none'; usados = 0; };

  return {
    esconder,
    lista: (c) => carregar(c),
    // c: o corpo de referência (ou null); camLocal: câmera no referencial do corpo (km); qOri: orientação do corpo;
    // paraTela(dirCorpo, raioKm) → [x, y] na tela ou null; raioSup(dirCorpo) → raio do chão; postos: caixas ocupadas
    atualizar(c, camLocal, paraTela, raioSup, pxPorRad, postos) {
      if (!c) return esconder();
      const lista = carregar(c);
      if (!lista) return esconder();
      let k = 0;
      for (const f of lista) {
        if (k >= MAX) break;
        const tam = tamanho(f, c.raio);
        dirLatLon(f[3], f[4], _n);
        // de frente para a câmera e grande o bastante na tela
        _p.copy(_n).multiplyScalar(c.raio);
        const dist = _p.distanceTo(camLocal);
        const px = (tam / Math.max(dist, 1e-6)) * pxPorRad;
        if (px < 40 && !(px > 14 && f[2] === 0)) continue;
        _p.copy(_n).multiplyScalar(raioSup(_n));
        if (_p.clone().sub(camLocal).dot(_n) > 0) continue; // atrás do horizonte (a câmera vê o chão "de baixo")
        const xy = paraTela(_n, _p.length());
        if (!xy) continue;
        const [x, y] = xy;
        if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
        const w = f[0].length * 6.6 + 14;
        const caixa = [x - w / 2, y - 8, x + w / 2, y + 8]; // o rótulo fica centrado no lugar
        if (postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) continue;
        postos.push(caixa);
        const el = pool[k++];
        if (el.f !== f) { el.f = f; el.textContent = f[0]; }
        el.corpo = c;
        el.style.left = `${x}px`; el.style.top = `${y}px`;
        el.style.display = '';
      }
      for (let i = k; i < usados; i++) pool[i].style.display = 'none';
      usados = k;
    },
  };
}
