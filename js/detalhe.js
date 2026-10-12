// Imagem de alta resolução de Marte, da Lua e de Mercúrio (NASA Trek, ladrilhos em grade de latitude e longitude):
// perto da superfície, um mosaico de 6 × 6 ladrilhos em volta do ponto abaixo da câmera substitui a textura global.
// O relevo continua o global (MOLA, LOLA), com o detalhe inventado por cima.
import * as THREE from '../vendor/three.module.js';

const CAMADAS = {
  lua: { url: 'Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02', zMax: 8, credito: 'LRO WAC (NASA/GSFC/Arizona State University), via NASA Trek' },
  marte: { url: 'Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m', zMax: 8, credito: 'Viking MDIM 2.1 colorido (NASA/USGS), via NASA Trek' },
  mercurio: { url: 'Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m', zMax: 8, credito: 'MESSENGER MDIS (NASA/JHUAPL/Carnegie), via NASA Trek' },
};
const N = 6, TAM = 256; // mosaico N × N ladrilhos

export function criarDetalhe(corpo, recuo = 0) { // recuo: níveis a menos (mosaico mais largo e grosseiro, até o horizonte)
  const cfg = CAMADAS[corpo.id];
  if (!cfg) return null;
  const tela = document.createElement('canvas');
  tela.width = tela.height = N * TAM;
  const ctx = tela.getContext('2d');
  const tex = new THREE.CanvasTexture(tela);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const janela = new THREE.Vector4(0, 0, 0, 0); // u0, v0, u1, v1 na textura global
  let atual = null, carregando = 0, pronto = false, geracao = 0, nivel = 0;
  const cache = new Map();
  const imagem = (z, x, y) => {
    const k = `${z}/${x}/${y}`;
    if (!cache.has(k)) {
      cache.set(k, new Promise((ok) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => ok(im);
        im.onerror = () => ok(null);
        im.src = `https://trek.nasa.gov/tiles/${cfg.url}/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`;
      }));
      if (cache.size > 200) cache.delete(cache.keys().next().value);
    }
    return cache.get(k);
  };
  // monta o mosaico: em cada nível z há 2^(z+1) × 2^z ladrilhos (o primeiro, com 2 × 1, cobre o planeta)
  async function montar(z, x0, y0) {
    const g = ++geracao;
    carregando++;
    const ims = await Promise.all([...Array(N * N)].map((_, k) => imagem(z, x0 + (k % N), y0 + Math.floor(k / N))));
    carregando--;
    if (g !== geracao) return; // a câmera já pediu outro mosaico
    if (ims.filter(Boolean).length < N * N / 2) return; // nível sem imagem aqui: fica o anterior
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, tela.width, tela.height);
    ims.forEach((im, k) => { if (im) ctx.drawImage(im, (k % N) * TAM, Math.floor(k / N) * TAM, TAM, TAM); });
    tex.needsUpdate = true;
    const nx = 2 ** (z + 1), ny = 2 ** z;
    janela.set(x0 / nx, 1 - (y0 + N) / ny, (x0 + N) / nx, 1 - y0 / ny);
    pronto = true;
    nivel = z;
  }
  return {
    credito: cfg.credito,
    textura: tex,
    janela,
    ativo: () => pronto,
    nivel: () => nivel,
    // dirCorpo: direção da câmera no referencial do corpo; alt em km
    atualizar(dirCorpo, alt) {
      if (alt > corpo.raio * 0.6) { pronto = false; atual = null; return; }
      const lat = Math.asin(Math.max(-1, Math.min(1, dirCorpo.y))), lon = Math.atan2(-dirCorpo.z, dirCorpo.x);
      // nível pela nitidez logo abaixo da câmera: ~1 pixel da imagem para 2 da tela (60° em ~1.200 pixels)
      const grau = (Math.PI * corpo.raio) / 180; // km por grau no equador
      const kmPorPixelTela = Math.max(alt, 0.5) * 0.00087;
      const z = Math.min(cfg.zMax, Math.floor(Math.log2(((180 / TAM) * grau) / (2 * kmPorPixelTela)))) - recuo;
      if (z < 4 - (recuo ? 1 : 0)) { pronto = false; atual = null; return; } // abaixo disso, a textura global (2 mil pixels) já é tão nítida quanto
      const passo = 180 / 2 ** z, nx = 2 ** (z + 1), ny = 2 ** z;
      const cx = ((lon / Math.PI) * 180 + 180) / passo, cy = (90 - (lat / Math.PI) * 180) / passo;
      const x0 = Math.max(0, Math.min(nx - N, Math.round(cx - N / 2))), y0 = Math.max(0, Math.min(ny - N, Math.round(cy - N / 2)));
      const chave = `${z}/${x0}/${y0}`;
      if (chave !== atual) { atual = chave; montar(z, x0, y0); }
    },
  };
}
