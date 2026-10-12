// Relevo de alta resolução da Lua, de Marte e de Mercúrio em ladrilhos com nível de detalhe, perto da superfície.
// Dados: ladrilhos gerados por dados/gerar_relevo.py dos mosaicos globais do USGS (LOLA 118 m, HRSC+MOLA 200 m,
// MESSENGER 665 m): o globo inteiro até zGlobal e as regiões de destaque até a resolução nativa.
// Grade de latitude e longitude igual à do NASA Trek (no nível z, 2^(z+1) × 2^z ladrilhos), então cada ladrilho
// usa a imagem do Trek com o mesmo endereço. A malha vai mais fundo que os dados (interpolados) para ficar lisa
// perto do chão; a inclinação de cada amostra vai numa textura e ilumina o relevo com o detalhe todo dos dados.
import * as THREE from '../vendor/three.module.js';
import { CAMADAS } from './detalhe.js';

const N = 32;                  // segmentos por lado da malha de cada ladrilho
const A = 259;                 // amostras por lado do ladrilho de dados (257 nos cantos + 1 de borda de cada lado)
const Z_MALHA = 13;
const MAX_SIMULTANEOS = 6, MAX_NOS = 500;
// os ladrilhos ficam num site à parte (repositório relevo-planetas); no computador, na pasta dados/relevo
const BASE = location.hostname === 'localhost' ? 'dados/relevo/' : 'https://giorgictr.github.io/relevo-planetas/';

// Direção no referencial do corpo: longitude 0 em +x, leste em −z, norte em +y (igual às texturas)
const direcao = (lat, lon, out) => out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));

export async function lerManifesto(id) {
  try {
    const r = await fetch(`${BASE}${id}.json`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// uniformsCorpo: os uniforms do material da esfera do corpo (compartilhados: luz, eclipse, detalhe inventado...)
export function criarSolo(corpo, S, man, uniformsCorpo) {
  const raio = corpo.raio;
  const zDadoMax = man.zMax;
  const img = CAMADAS[corpo.id];
  const hMaxKm = Math.max(Math.abs(man.mapaGlobal[1]), Math.abs(man.mapaGlobal[2]));
  const grupo = new THREE.Group();
  const nos = new Map(), fila = [];
  let carregando = 0, quadro = 0;
  const _v = new THREE.Vector3();

  const temDado = (z, x, y) => z <= man.zGlobal || man.regioes.some((r) => {
    const f = r.niveis[z];
    return f && x >= f[0] && x <= f[1] && y >= f[2] && y <= f[3];
  });
  // nível de dados mais detalhado que cobre o ladrilho (z, x, y) da malha
  function zDado(z, x, y) {
    for (let zd = Math.min(z, zDadoMax); zd > man.zGlobal; zd--) if (temDado(zd, x >> (z - zd), y >> (z - zd))) return zd;
    return Math.min(z, man.zGlobal);
  }

  function no(z, x, y) {
    const k = `${z}/${x}/${y}`;
    let n = nos.get(k);
    if (!n) {
      const vao = Math.PI / 2 ** z;
      const lon0 = x * vao - Math.PI, lat1 = Math.PI / 2 - y * vao; // lat1 = borda norte
      const centro = direcao(lat1 - vao / 2, lon0 + vao / 2, new THREE.Vector3()).multiplyScalar(raio);
      let raioB = 0;
      for (const [la, lo] of [[lat1, lon0], [lat1, lon0 + vao], [lat1 - vao, lon0], [lat1 - vao, lon0 + vao], [lat1 - vao / 2, lon0]]) {
        raioB = Math.max(raioB, centro.distanceTo(direcao(la, lo, _v).multiplyScalar(raio)));
      }
      n = { k, z, x, y, vao, lon0, lat1, centro, raioB: raioB * 1.02, estado: 'vazio', usado: 0 };
      nos.set(k, n);
    }
    return n;
  }

  // ------- dados de relevo: alturas (km) para a malha e inclinações (textura) para a luz; compartilhados -------
  const dados = new Map();
  function pegarDados(zd, xd, yd) {
    const k = `${zd}/${xd}/${yd}`;
    let e = dados.get(k);
    if (!e) {
      e = { refs: 0 };
      e.p = lerDados(zd, xd, yd);
      e.p.catch(() => dados.delete(k));
      dados.set(k, e);
    }
    e.refs++;
    return e.p;
  }
  function soltarDados(k) {
    const e = k && dados.get(k);
    if (!e) return;
    if (--e.refs <= 0) { dados.delete(k); e.p.then((d) => d.tex.dispose()).catch(() => {}); }
  }
  async function lerDados(zd, xd, yd) {
    const r = await fetch(`${BASE}${corpo.id}/${zd}/${xd}/${yd}.${man.formato}`);
    if (!r.ok) throw new Error('sem relevo');
    const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const px = g.getImageData(0, 0, A, A).data;
    const h = new Float32Array(A * A);
    const passoKm = man.passo[zd] / 1000; // o passo de altura cresce com o espaçamento entre pontos
    for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1] - 32768) * passoKm;
    // inclinação (adimensional) para leste e para o norte nos 257 × 257 cantos, por diferença central
    const passo = Math.PI / 2 ** zd / 256, lat1 = Math.PI / 2 - yd * Math.PI / 2 ** zd;
    const M = A - 2, inc = new Uint16Array(M * M * 2), toH = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < M; j++) {
      const coslat = Math.max(Math.cos(lat1 - j * passo), 0.02);
      const dx = 2 * raio * coslat * passo, dy = 2 * raio * passo;
      for (let i = 0; i < M; i++) {
        const c = (j + 1) * A + i + 1;
        inc[(j * M + i) * 2] = toH((h[c + 1] - h[c - 1]) / dx);
        inc[(j * M + i) * 2 + 1] = toH((h[c - A] - h[c + A]) / dy);
      }
    }
    const tex = new THREE.DataTexture(inc, M, M, THREE.RGFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return { h, tex };
  }

  // ------- imagens do NASA Trek no mesmo esquema de ladrilhos (compartilhadas entre os ladrilhos finos) -------
  const imagens = new Map();
  function pegarImagem(url) {
    let e = imagens.get(url);
    if (!e) {
      e = { refs: 0 };
      e.p = new Promise((ok, falha) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          const t = new THREE.Texture(im);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          t.needsUpdate = true;
          ok(t);
        };
        im.onerror = falha;
        im.src = url;
      });
      e.p.catch(() => {}); // a falha fica guardada: o Trek não tem todos os níveis, e não adianta pedir de novo
      imagens.set(url, e);
    }
    e.refs++;
    return e.p;
  }
  function soltarImagem(url) {
    const e = url && imagens.get(url);
    if (!e) return;
    if (--e.refs <= 0) { imagens.delete(url); e.p.then((t) => t.dispose()).catch(() => {}); }
  }

  async function carregar(n) {
    if (n.estado === 'carregando' || n.estado === 'pronto') return;
    n.estado = 'carregando';
    carregando++;
    const zd = zDado(n.z, n.x, n.y), sd = n.z - zd, xd = n.x >> sd, yd = n.y >> sd;
    const chaveDados = `${zd}/${xd}/${yd}`;
    let urlImg = null, si = 0;
    // imagem do nível mais fino que existir (se faltar, tenta até três níveis acima)
    async function imagem() {
      for (let zi = Math.min(n.z, img.zMax), k = 0; k < 4 && zi >= 0; zi--, k++) {
        const s = n.z - zi, url = `https://trek.nasa.gov/tiles/${img.url}/1.0.0/default/default028mm/${zi}/${n.y >> s}/${n.x >> s}.jpg`;
        try { const t = await pegarImagem(url); urlImg = url; si = s; return t; } catch { /* tenta o de cima */ }
      }
      return null;
    }
    try {
      const [D, tex] = await Promise.all([pegarDados(zd, xd, yd), img ? imagem() : null]);
      montar(n, D, 2 ** sd, xd, yd, tex, 2 ** si);
      n.chaveDados = chaveDados;
      n.urlImg = urlImg;
      n.estado = 'pronto';
    } catch {
      soltarDados(chaveDados);
      soltarImagem(urlImg);
      n.estado = 'erro';
      n.tentarDepois = quadro + 300;
    }
    carregando--;
  }

  // Grade (N+3)² com uma borda extra rebaixada ("saia") que esconde as frestas entre níveis diferentes.
  // A altura vai num atributo (o shader aplica o exagero); a posição é a da esfera, relativa ao centro do ladrilho.
  function montar(n, D, f, xd, yd, texImg, fi) {
    const M = N + 3;
    const pos = new Float32Array(M * M * 3), dirAlt = new Float32Array(M * M * 4), uv = new Float32Array(M * M * 2), uvT = new Float32Array(M * M * 2);
    n.grade = new Float32Array((N + 1) * (N + 1));
    const ox = n.x - xd * f, oy = n.y - yd * f; // posição do ladrilho dentro do ladrilho de dados
    const saia = n.raioB * 0.03 + 0.2;
    const h = D.h;
    for (let jj = 0; jj < M; jj++) {
      for (let ii = 0; ii < M; ii++) {
        const i = Math.min(Math.max(ii - 1, 0), N), j = Math.min(Math.max(jj - 1, 0), N);
        const borda = ii === 0 || jj === 0 || ii === M - 1 || jj === M - 1;
        const u = i / N, v = j / N;
        const lon = n.lon0 + n.vao * u, lat = n.lat1 - n.vao * v;
        // amostra bilinear no ladrilho de dados (índice 0 é a borda extra)
        const sx = 1 + ((ox + u) / f) * 256, sy = 1 + ((oy + v) / f) * 256;
        const x0 = Math.min(Math.floor(sx), A - 2), y0 = Math.min(Math.floor(sy), A - 2), tx = sx - x0, ty = sy - y0;
        const c = y0 * A + x0;
        const alt = (h[c] * (1 - tx) + h[c + 1] * tx) * (1 - ty) + (h[c + A] * (1 - tx) + h[c + A + 1] * tx) * ty;
        if (!borda) n.grade[j * (N + 1) + i] = alt;
        direcao(lat, lon, _v);
        const k = jj * M + ii;
        dirAlt.set([_v.x, _v.y, _v.z, borda ? alt - saia : alt], k * 4);
        _v.multiplyScalar(raio).sub(n.centro);
        pos.set([_v.x, _v.y, _v.z], k * 3);
        uv.set([(lon + Math.PI) / (2 * Math.PI), 0.5 + lat / Math.PI], k * 2);
        uvT.set([u, v], k * 2);
      }
    }
    const idx = [];
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
      const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('dirAlt', new THREE.BufferAttribute(dirAlt, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('uvT', new THREE.BufferAttribute(uvT, 2));
    geo.setIndex(idx);
    // a inclinação: amostra no canto (k + 0,5)/257 da textura; a imagem do Trek tem o norte em cima (v = 1)
    const eR = 256 / 257 / f, eI = 1 / fi, oxi = n.x % fi, oyi = n.y % fi;
    const mat = new THREE.ShaderMaterial({
      vertexShader: S.PLANETA_V, fragmentShader: S.PLANETA_F,
      defines: { LADRILHO: '' },
      uniforms: {
        ...uniformsCorpo,
        relTile: { value: D.tex },
        janelaRel: { value: new THREE.Vector4(ox * eR + 0.5 / 257, oy * eR + 0.5 / 257, eR, eR) },
        imgTile: { value: texImg },
        temImg: { value: texImg ? 1 : 0 },
        janelaImg: { value: new THREE.Vector4(oxi * eI, 1 - oyi * eI, eI, -eI) },
      },
      side: THREE.DoubleSide, // as saias ficam de lado; sem isso, somem e deixam frestas
    });
    n.malha = new THREE.Mesh(geo, mat);
    n.malha.visible = false;
    n.malha.frustumCulled = false; // o recorte é feito aqui, com folga para o relevo exagerado
    grupo.add(n.malha);
  }

  function liberar(n) {
    if (!n.malha) return;
    grupo.remove(n.malha);
    n.malha.geometry.dispose();
    n.malha.material.dispose();
    soltarDados(n.chaveDados);
    soltarImagem(n.urlImg);
    n.malha = null;
    n.grade = null;
    n.estado = 'vazio';
  }

  const pedir = (n) => { if (n.estado === 'vazio' || (n.estado === 'erro' && quadro > n.tentarDepois)) fila.push(n); };
  const filhos = (n) => [no(n.z + 1, n.x * 2, n.y * 2), no(n.z + 1, n.x * 2 + 1, n.y * 2), no(n.z + 1, n.x * 2, n.y * 2 + 1), no(n.z + 1, n.x * 2 + 1, n.y * 2 + 1)];

  let cb, alcance, folga, mostrados = [], furo = true;
  const vista = new THREE.Frustum(), _mvp = new THREE.Matrix4(), _esf = new THREE.Sphere();
  let qAtual, posAtual;
  const prontoOuFora = (n) => n.estado === 'pronto' || fora(n);
  function fora(n) {
    if (cb.distanceTo(n.centro) - n.raioB - folga > alcance) return true; // atrás do horizonte
    _esf.center.copy(n.centro).applyQuaternion(qAtual).add(posAtual);
    _esf.radius = n.raioB + folga;
    return !vista.intersectsSphere(_esf);
  }
  function deveDividir(n) {
    if (n.z >= Z_MALHA) return false;
    const d = Math.max(cb.distanceTo(n.centro) - n.raioB, 0.001);
    return d < n.raioB * 3.0;
  }
  function visitar(n) {
    n.usado = quadro;
    if (fora(n)) return;
    if (deveDividir(n)) {
      const fs = filhos(n);
      fs.forEach((f) => { f.usado = quadro; if (!fora(f)) pedir(f); });
      if (fs.every(prontoOuFora)) { fs.forEach(visitar); return; }
    }
    if (n.estado === 'pronto') mostrados.push(n);
    else { pedir(n); furo = true; }
  }

  const raizes = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 2; y++) raizes.push(no(1, x, y));
  const _lat = (d) => Math.asin(Math.max(-1, Math.min(1, d.y))), _lon = (d) => Math.atan2(-d.z, d.x);

  return {
    grupo,
    ativo: false,
    credito: man.credito,
    completo: () => !furo, // no último quadro, nenhum pedaço visível ficou sem ladrilho
    // camLocal: câmera no referencial do corpo (km); posCorpo: centro do corpo relativo à câmera (na cena);
    // mostrar = false só carrega (enquanto a esfera ainda aparece)
    atualizar(camLocal, posCorpo, qOri, camera, exagero, mostrar) {
      quadro++;
      cb = camLocal;
      const dist = cb.length();
      folga = hMaxKm * exagero + 1;
      // além do horizonte só aparecem montanhas: o alcance cresce com a altura máxima do relevo
      alcance = Math.sqrt(Math.max(dist * dist - raio * raio, 0)) + Math.sqrt(2 * raio * folga) + 20;
      qAtual = qOri; posAtual = posCorpo;
      vista.setFromProjectionMatrix(_mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const n of mostrados) n.malha.visible = false;
      mostrados = [];
      fila.length = 0;
      furo = false;
      raizes.forEach(visitar);
      // carrega primeiro os mais grosseiros e mais próximos (só os poucos melhores, sem ordenar a fila toda)
      const vagas = MAX_SIMULTANEOS - carregando, melhores = [];
      const nota = (n) => n.z * 1e6 + cb.distanceTo(n.centro);
      for (const n of fila) {
        if (vagas <= 0) break;
        if (n.estado !== 'vazio' && n.estado !== 'erro') continue;
        const v = nota(n);
        if (melhores.length < vagas || v < melhores[melhores.length - 1][0]) {
          melhores.push([v, n]);
          melhores.sort((a, b) => a[0] - b[0]);
          if (melhores.length > vagas) melhores.pop();
        }
      }
      for (const [, n] of melhores) carregar(n);
      if (mostrar) {
        for (const n of mostrados) {
          n.malha.visible = true;
          n.malha.quaternion.copy(qOri);
          n.malha.position.copy(n.centro).applyQuaternion(qOri).add(posCorpo);
        }
      } else mostrados = [];
      if (nos.size > MAX_NOS * 1.3) {
        const velhos = [...nos.values()].filter((n) => n.usado < quadro - 120 && n.z > 1).sort((a, b) => a.usado - b.usado);
        for (const n of velhos.slice(0, nos.size - MAX_NOS)) { liberar(n); nos.delete(n.k); }
      }
    },
    esconder() { for (const n of mostrados) n.malha.visible = false; mostrados = []; },
    // Altura do chão (km, sem exagero) na direção dada (referencial do corpo), pela malha mais detalhada já
    // carregada (a mesma interpolação da malha desenhada, para pousar sem atravessar o chão); null se nenhuma
    altura(dirLocal) {
      const lat = _lat(dirLocal), lon = _lon(dirLocal);
      for (let z = Z_MALHA; z >= 1; z--) {
        const vao = Math.PI / 2 ** z;
        const fx = (lon + Math.PI) / vao, fy = (Math.PI / 2 - lat) / vao;
        const n = nos.get(`${z}/${Math.min(Math.floor(fx), 2 ** (z + 1) - 1)}/${Math.min(Math.floor(fy), 2 ** z - 1)}`);
        if (!n || !n.grade) continue;
        const gx = (fx - n.x) * N, gy = (fy - n.y) * N;
        const x0 = Math.min(Math.floor(gx), N - 1), y0 = Math.min(Math.floor(gy), N - 1), tx = gx - x0, ty = gy - y0, g = n.grade, W = N + 1;
        // os mesmos dois triângulos da malha (diagonal de b para c)
        const a = g[y0 * W + x0], b = g[y0 * W + x0 + 1], c = g[(y0 + 1) * W + x0], d = g[(y0 + 1) * W + x0 + 1];
        return tx + ty <= 1 ? a + (b - a) * tx + (c - a) * ty : d + (c - d) * (1 - tx) + (b - d) * (1 - ty);
      }
      return null;
    },
    // nível de dados (e resolução em metros) no ponto abaixo da câmera, para o painel
    resolucao(dirLocal) {
      const lat = _lat(dirLocal), lon = _lon(dirLocal);
      const z = zDado(Z_MALHA, Math.floor((lon + Math.PI) / (Math.PI / 2 ** Z_MALHA)), Math.floor((Math.PI / 2 - lat) / (Math.PI / 2 ** Z_MALHA)));
      return { z, metros: (raio * 1000 * Math.PI) / 2 ** z / 256 };
    },
    carregandoAgora: () => carregando + fila.length,
  };
}
