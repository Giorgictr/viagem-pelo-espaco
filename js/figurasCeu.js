// Figuras das constelações desenhadas no próprio céu, clarinhas, atrás do traçado (ilustrações de Johan Meuris,
// Stellarium, Free Art License). Cada ilustração vira uma malha curva sobre a esfera do céu, encaixada pelas três
// estrelas de referência: (posição na imagem) → plano tangente (projeção gnomônica, afim pelas três estrelas) → direção.
// As 85 imagens vão para um só mosaico de um canal (256 px cada, ~8 MB na placa de vídeo), montado só na primeira vez
// que a chave é ligada.
import * as THREE from '../vendor/three.module.js';
import { FIGURA_CEU_V, FIGURA_CEU_F } from './shaders.js';
import { radecParaCena } from './corpos.js';

const C = 256, COLS = 10, N = 10; // tamanho de cada imagem no mosaico, colunas, divisões da malha

export function criarFiguras(cena) {
  const material = new THREE.ShaderMaterial({
    vertexShader: FIGURA_CEU_V, fragmentShader: FIGURA_CEU_F,
    uniforms: { atlas: { value: null }, opac: { value: 0 }, beta: { value: new THREE.Vector3() }, zenite: { value: new THREE.Vector3(0, 1, 0) }, refr: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  let malha = null, pedido = false;

  async function montar() {
    pedido = true;
    const d = await fetch('dados/constelacoes_fichas.json').then((r) => r.json());
    const figs = [], vistas = new Set();
    for (const c of Object.values(d.lista)) { // Popa e Vela usam o navio Argo da Quilha; a Serpente, a figura do Serpentário
      if (c.figura && !vistas.has(c.figura.arq)) { vistas.add(c.figura.arq); figs.push(c.figura); }
    }
    const ims = await Promise.all(figs.map((f) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `texturas/constelacoes/${f.arq}`; })));
    const linhas = Math.ceil(figs.length / COLS), W = COLS * C, H = linhas * C;
    const tela = document.createElement('canvas');
    tela.width = W; tela.height = H;
    const ctx = tela.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

    const pos = [], uv = [], idx = [];
    const c0 = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), t = new THREE.Vector3();
    figs.forEach((f, k) => {
      const im = ims[k];
      if (!im) return;
      const col = k % COLS, lin = Math.floor(k / COLS);
      ctx.drawImage(im, col * C + 1, lin * C + 1, C - 2, C - 2); // 1 px de margem contra vazamento entre vizinhas
      // plano tangente no centro das três estrelas
      const dirs = f.anc.map(([, , ra, dec]) => radecParaCena(ra, dec, 1));
      c0.set(0, 0, 0); for (const a of dirs) c0.add(a); c0.normalize();
      u.crossVectors(Math.abs(c0.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), c0).normalize();
      v.crossVectors(c0, u);
      const plano = dirs.map((a) => { t.copy(a).divideScalar(a.dot(c0)).sub(c0); return [t.dot(u), t.dot(v)]; });
      // afim (px, py) → (x, y) pelas três estrelas
      const [[p1x, p1y], [p2x, p2y], [p3x, p3y]] = f.anc;
      const det = p1x * (p2y - p3y) + p2x * (p3y - p1y) + p3x * (p1y - p2y);
      if (Math.abs(det) < 1e-9) return;
      const resolve = (v1, v2, v3) => [
        (v1 * (p2y - p3y) + v2 * (p3y - p1y) + v3 * (p1y - p2y)) / det,
        (v1 * (p3x - p2x) + v2 * (p1x - p3x) + v3 * (p2x - p1x)) / det,
        (v1 * (p2x * p3y - p3x * p2y) + v2 * (p3x * p1y - p1x * p3y) + v3 * (p1x * p2y - p2x * p1y)) / det,
      ];
      const ax = resolve(plano[0][0], plano[1][0], plano[2][0]), ay = resolve(plano[0][1], plano[1][1], plano[2][1]);
      const base = pos.length / 3, [fw, fh] = f.tam;
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const px = (i / N) * fw, py = (j / N) * fh;
          const x = ax[0] * px + ax[1] * py + ax[2], y = ay[0] * px + ay[1] * py + ay[2];
          t.copy(c0).addScaledVector(u, x).addScaledVector(v, y).normalize().multiplyScalar(1e9); // "no infinito"
          pos.push(t.x, t.y, t.z);
          uv.push((col * C + 1 + (i / N) * (C - 2)) / W, 1 - (lin * C + 1 + (j / N) * (C - 2)) / H);
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = base + j * (N + 1) + i, b = a + 1, cc = a + N + 1, dd = cc + 1;
          idx.push(a, cc, b, b, cc, dd);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(tela);
    tex.format = THREE.RedFormat; // as ilustrações são em cinza: um canal só
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    material.uniforms.atlas.value = tex;
    malha = new THREE.Mesh(geo, material);
    malha.frustumCulled = false;
    malha.renderOrder = 3; // antes das linhas
    malha.visible = false;
    cena.add(malha);
  }

  return {
    // opac: 0 esconde; beta, zenite e refr: os mesmos do traçado (velocidade da luz, refração no modo céu)
    atualizar(ligada, opac, beta, zenite, refr) {
      if (ligada && !pedido) montar().catch(() => { pedido = false; });
      if (!malha) return;
      malha.visible = ligada && opac > 0.005;
      material.uniforms.opac.value = opac;
      material.uniforms.beta.value.copy(beta);
      material.uniforms.zenite.value.copy(zenite);
      material.uniforms.refr.value = refr;
    },
  };
}
