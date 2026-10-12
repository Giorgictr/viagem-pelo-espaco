// Terra em ladrilhos com nível de detalhe: relevo real (Terrain Tiles da AWS, ~30 m) e imagem de satélite
// Sentinel-2 sem nuvens (EOX, ~10 m), baixados durante o voo. Mesmo esquema de ladrilhos dos mapas da web
// (Web Mercator z/x/y); cada ladrilho vira uma malha curva sobre a esfera, com vértices relativos ao seu
// próprio centro (precisão de centímetros mesmo com a câmera no chão).
import * as THREE from '../vendor/three.module.js';

const N = 32;               // segmentos por lado de cada ladrilho
const Z_MIN = 2, Z_MAX = 15, Z_IMG = 14;
const MAX_SIMULTANEOS = 8, MAX_LADRILHOS = 450;
const URL_IMG = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/${z}/${y}/${x}.jpg`;
const URL_NOITE = (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
const Z_NOITE = 8;
const URL_REL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const CREDITOS = 'Imagens: Sentinel-2 cloudless 2023 © EOX IT Services GmbH (dados Copernicus Sentinel modificados, CC BY-NC-SA 4.0) · Luzes noturnas: NASA Black Marble · Relevo: Terrain Tiles (Mapzen/AWS: SRTM, GMTED, ETOPO1 e outros) · Lugares: Natural Earth';

const latDe = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
const lonDe = (x, z) => (x / 2 ** z) * 2 * Math.PI - Math.PI;
// Direção no referencial da Terra: longitude 0 em +x, leste em −z, norte em +y (igual às texturas)
const direcao = (lat, lon, out) => out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));

export function criarTerra(cena, S, raio) {
  const nos = new Map();
  const fila = [];
  let carregando = 0, quadro = 0;
  const grupo = new THREE.Group();
  cena.add(grupo);
  const noite = new THREE.TextureLoader().load('texturas/2k_earth_nightmap.jpg');
  noite.colorSpace = THREE.SRGBColorSpace;
  const comum = {
    luz: { value: new THREE.Vector3(1, 0, 0) }, noite: { value: noite }, exagero: { value: 1 },
    kmPorUnidade: { value: 1 }, corCeu: { value: new THREE.Color(0.32, 0.58, 1.0) }, nevoa: { value: 1 },
    nivelMar: { value: 0 }, gelo: { value: 0 }, semLuzes: { value: 0 },
    eclOcl: { value: new THREE.Vector3() }, eclRaio: { value: 1737.4 }, eclSolAng: { value: 0.00465 }, eclAtivo: { value: 0 }, eclVermelho: { value: 0 },
  };
  const _v = new THREE.Vector3();

  function no(z, x, y) {
    const k = `${z}/${x}/${y}`;
    let n = nos.get(k);
    if (!n) {
      const lat0 = latDe(y, z), lat1 = latDe(y + 1, z), lon0 = lonDe(x, z), lon1 = lonDe(x + 1, z);
      const centro = direcao((lat0 + lat1) / 2, (lon0 + lon1) / 2, new THREE.Vector3()).multiplyScalar(raio);
      const canto = direcao(lat0, lon0, new THREE.Vector3()).multiplyScalar(raio);
      n = { k, z, x, y, lat0, lat1, lon0, lon1, centro, raioB: centro.distanceTo(canto) * 1.05 + 9, estado: 'vazio', usado: 0 };
      nos.set(k, n);
    }
    return n;
  }

  // Baixa relevo e imagem; monta a malha quando os dois chegam
  // Texturas compartilhadas: vários ladrilhos finos usam a mesma imagem do nível de cima (z14 da imagem,
  // z8 das luzes); cada imagem vira UMA textura na placa de vídeo, liberada quando ninguém mais a usa
  const texturas = new Map();
  function pegarTextura(url) {
    let e = texturas.get(url);
    if (!e) {
      e = { refs: 0 };
      e.p = lerImagem(url).then((img) => {
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.needsUpdate = true;
        return t;
      });
      e.p.catch(() => texturas.delete(url));
      texturas.set(url, e);
    }
    e.refs++;
    return e.p;
  }
  function soltarTextura(url) {
    const e = url && texturas.get(url);
    if (!e) return;
    if (--e.refs <= 0) { texturas.delete(url); e.p.then((t) => t.dispose()).catch(() => {}); }
  }

  async function carregar(n) {
    if (n.estado === 'carregando' || n.estado === 'pronto') return;
    n.estado = 'carregando';
    carregando++;
    const zi = Math.min(n.z, Z_IMG), f = 2 ** (n.z - zi);
    const zn = Math.min(n.z, Z_NOITE), fn = 2 ** (n.z - zn);
    const urlImg = URL_IMG(zi, Math.floor(n.x / f), Math.floor(n.y / f));
    const urlNoite = URL_NOITE(zn, Math.floor(n.x / fn), Math.floor(n.y / fn));
    let temImg = false, temNoite = false;
    try {
      const [alturas, tex, texNoite] = await Promise.all([
        lerRelevo(n.z, n.x, n.y),
        pegarTextura(urlImg).then((t) => { temImg = true; return t; }),
        pegarTextura(urlNoite).then((t) => { temNoite = true; return t; }).catch(() => null),
      ]);
      montar(n, alturas, tex, f, texNoite, fn);
      n.urlImg = urlImg;
      n.urlNoite = temNoite ? urlNoite : null;
      n.estado = 'pronto';
    } catch {
      if (temImg) soltarTextura(urlImg);
      if (temNoite) soltarTextura(urlNoite);
      n.estado = 'erro';
      n.tentarDepois = quadro + 300;
    }
    carregando--;
  }

  async function lerRelevo(z, x, y) {
    const r = await fetch(URL_REL(z, x, y));
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const h = new Float32Array(bmp.width * bmp.height);
    for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return { w: bmp.width, h: bmp.height, dados: h };
  }

  function lerImagem(url) {
    return new Promise((ok, falha) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => ok(im);
      im.onerror = falha;
      im.src = url;
    });
  }

  function amostra(A, u, v) {
    if (!A) return 0;
    const x = u * (A.w - 1), y = v * (A.h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, A.w - 1), y1 = Math.min(y0 + 1, A.h - 1);
    const fx = x - x0, fy = y - y0, d = A.dados, w = A.w;
    return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
  }

  // Grade (N+3)² com uma borda extra rebaixada ("saia") que esconde as frestas entre níveis diferentes
  function montar(n, A, tex, f, texNoite, fn) {
    const M = N + 3, pos = new Float32Array(M * M * 3), uv = new Float32Array(M * M * 2);
    const dirAlt = new Float32Array(M * M * 4), agua = new Float32Array(M * M), glob = new Float32Array(M * M * 2), uvN = new Float32Array(M * M * 2);
    const nx = (n.x % fn) / fn, ny = (n.y % fn) / fn;
    n.grade = new Float32Array((N + 1) * (N + 1)); // altura (km, mar = 0) nos vértices, para pousar
    const saia = n.raioB * 0.04;
    const sx = (n.x % f) / f, sy = (n.y % f) / f;
    for (let jj = 0; jj < M; jj++) {
      for (let ii = 0; ii < M; ii++) {
        const i = Math.min(Math.max(ii - 1, 0), N), j = Math.min(Math.max(jj - 1, 0), N);
        const borda = ii === 0 || jj === 0 || ii === M - 1 || jj === M - 1;
        const u = i / N, v = j / N;
        const lon = n.lon0 + (n.lon1 - n.lon0) * u;
        const lat = latDe(n.y + v, n.z);
        const hBruto = amostra(A, u, v) / 1000; // inclui o fundo do mar (negativo)
        const mar = hBruto <= 0;
        const h = Math.max(hBruto, 0);
        if (!borda) n.grade[j * (N + 1) + i] = hBruto;
        direcao(lat, lon, _v);
        const k = jj * M + ii;
        dirAlt.set([_v.x, _v.y, _v.z, hBruto], k * 4);
        _v.multiplyScalar(raio + h).sub(n.centro); // a saia desce depois de calcular as normais
        pos.set([_v.x, _v.y, _v.z], k * 3);
        uv.set([sx + u / f, 1 - (sy + v / f)], k * 2);
        uvN.set([nx + u / fn, 1 - (ny + v / fn)], k * 2);
        glob.set([(lon + Math.PI) / (2 * Math.PI), 0.5 + lat / Math.PI], k * 2);
        agua[k] = mar ? 1 : 0;
      }
    }
    const idx = [];
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
      const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('dirAlt', new THREE.BufferAttribute(dirAlt, 4));
    geo.setAttribute('agua', new THREE.BufferAttribute(agua, 1));
    geo.setAttribute('glob', new THREE.BufferAttribute(glob, 2));
    geo.setAttribute('uvN', new THREE.BufferAttribute(uvN, 2));
    geo.setIndex(idx);
    // normais com a saia ainda no lugar da borda (senão a borda herda a inclinação da saia e vira uma faixa escura)
    geo.computeVertexNormals();
    for (let jj = 0; jj < M; jj++) for (let ii = 0; ii < M; ii++) {
      if (ii > 0 && jj > 0 && ii < M - 1 && jj < M - 1) continue;
      const k = jj * M + ii;
      for (let c = 0; c < 3; c++) pos[k * 3 + c] -= dirAlt[k * 4 + c] * saia;
    }
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      vertexShader: S.TERRA_V, fragmentShader: S.TERRA_F,
      uniforms: { ...comum, imagem: { value: tex }, noiteTile: { value: texNoite }, temNoiteTile: { value: texNoite ? 1 : 0 } },
      side: THREE.DoubleSide, // as saias ficam de lado; sem isso, somem e deixam frestas
    });
    n.malha = new THREE.Mesh(geo, mat);
    n.malha.visible = false;
    n.malha.frustumCulled = true;
    grupo.add(n.malha);
  }

  function liberar(n) {
    if (!n.malha) return;
    grupo.remove(n.malha);
    n.malha.geometry.dispose();
    soltarTextura(n.urlImg);
    soltarTextura(n.urlNoite);
    n.malha.material.dispose();
    n.malha = null;
    n.grade = null;
    n.estado = 'vazio';
  }

  const pedir = (n) => { if (n.estado === 'vazio' || (n.estado === 'erro' && quadro > n.tentarDepois)) fila.push(n); };
  const filhos = (n) => [no(n.z + 1, n.x * 2, n.y * 2), no(n.z + 1, n.x * 2 + 1, n.y * 2), no(n.z + 1, n.x * 2, n.y * 2 + 1), no(n.z + 1, n.x * 2 + 1, n.y * 2 + 1)];

  let cb, alcanceHorizonte, mostrados = [], zMax = Z_MAX;
  const vista = new THREE.Frustum(), _mvp = new THREE.Matrix4(), _esf = new THREE.Sphere();
  let qAtual, posAtual;
  const prontoOuFora = (n) => n.estado === 'pronto' || fora(n);
  function fora(n) {
    // atrás do horizonte?
    if (cb.distanceTo(n.centro) - n.raioB > alcanceHorizonte) return true;
    // fora do campo de visão da câmera?
    _esf.center.copy(n.centro).applyQuaternion(qAtual).add(posAtual);
    _esf.radius = n.raioB;
    return !vista.intersectsSphere(_esf);
  }
  function deveDividir(n) {
    if (n.z >= zMax) return false;
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
    else pedir(n);
  }

  const raizes = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) raizes.push(no(Z_MIN, x, y));

  return {
    ativo: false,
    eclipse: comum, // uniforms da sombra da Lua (eclipse solar)
    prontaRaiz: () => raizes.every((r) => r.estado === 'pronto'),
    // camLocal: câmera no referencial da Terra (km); posTerra: centro da Terra relativo à câmera (km, na cena)
    atualizar(camLocal, posTerra, qOri, luzMundo, exagero, nevoa, nivelMar = 0, gelo = 0, camera = null, curto = false, semLuzes = false) {
      comum.semLuzes.value = semLuzes ? 1 : 0;
      quadro++;
      cb = camLocal;
      const dist = cb.length();
      const altitude = dist - raio;
      // além do horizonte só entram montanhas; perto do chão (e olhando o céu) basta uma margem curta
      alcanceHorizonte = Math.sqrt(Math.max(dist * dist - raio * raio, 0)) + (curto ? 40 : altitude > 20 ? 400 : 120);
      zMax = curto ? 13 : Z_MAX;
      qAtual = qOri; posAtual = posTerra;
      if (camera) vista.setFromProjectionMatrix(_mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const n of mostrados) n.malha.visible = false;
      mostrados = [];
      fila.length = 0;
      raizes.forEach(visitar);
      // carrega primeiro os mais grosseiros e mais próximos
      // escolhe só os poucos próximos da fila (sem ordenar milhares de itens a cada quadro)
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
      comum.luz.value.copy(luzMundo);
      comum.exagero.value = exagero;
      comum.nevoa.value = nevoa;
      comum.nivelMar.value = nivelMar;
      comum.gelo.value = gelo;
      for (const n of mostrados) {
        n.malha.visible = true;
        n.malha.quaternion.copy(qOri);
        n.malha.position.copy(n.centro).applyQuaternion(qOri).add(posTerra);
      }
      // descarta os mais antigos quando há ladrilhos demais
      if (nos.size > MAX_LADRILHOS * 1.3) {
        const velhos = [...nos.values()].filter((n) => n.usado < quadro - 120 && n.z > Z_MIN).sort((a, b) => a.usado - b.usado);
        for (const n of velhos.slice(0, nos.size - MAX_LADRILHOS)) { liberar(n); nos.delete(n.k); }
      }
    },
    esconder() { for (const n of mostrados) n.malha.visible = false; mostrados = []; },
    // Altura do chão (km) na direção dada (referencial da Terra), pelo ladrilho mais detalhado já carregado;
    // abaixo do nível do mar, a altura é a da superfície da água
    altura(dirLocal, nivelMar = 0) {
      const lat = Math.asin(Math.max(-1, Math.min(1, dirLocal.y))), lon = Math.atan2(-dirLocal.z, dirLocal.x);
      const yf = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
      for (let z = Z_MAX; z >= Z_MIN; z--) {
        const m = 2 ** z, fx = ((lon + Math.PI) / (2 * Math.PI)) * m, fy = yf * m;
        const n = nos.get(`${z}/${Math.floor(fx)}/${Math.floor(fy)}`);
        if (!n || !n.grade) continue;
        const gx = (fx - Math.floor(fx)) * N, gy = (fy - Math.floor(fy)) * N;
        const x0 = Math.min(Math.floor(gx), N - 1), y0 = Math.min(Math.floor(gy), N - 1), tx = gx - x0, ty = gy - y0, g = n.grade, W = N + 1;
        return Math.max(nivelMar, (g[y0 * W + x0] * (1 - tx) + g[y0 * W + x0 + 1] * tx) * (1 - ty) + (g[(y0 + 1) * W + x0] * (1 - tx) + g[(y0 + 1) * W + x0 + 1] * tx) * ty);
      }
      return Math.max(nivelMar, 0);
    },
    // nível do ladrilho mais detalhado com relevo já carregado nessa direção
    zAltura(dirLocal) {
      const lat = Math.asin(Math.max(-1, Math.min(1, dirLocal.y))), lon = Math.atan2(-dirLocal.z, dirLocal.x);
      const yf = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
      for (let z = Z_MAX; z >= Z_MIN; z--) {
        const m = 2 ** z, n = nos.get(`${z}/${Math.floor(((lon + Math.PI) / (2 * Math.PI)) * m)}/${Math.floor(yf * m)}`);
        if (n && n.grade) return z;
      }
      return 0;
    },
    carregandoAgora: () => carregando + fila.length,
  };
}
