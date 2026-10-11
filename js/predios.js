// Construções em 3D: contornos e alturas do OpenStreetMap (ladrilhos vetoriais do OpenFreeMap, sem chave),
// erguidos como blocos sobre o relevo perto do chão. Sem altura no mapa, o prédio ganha uma altura padrão baixa.
import * as THREE from '../vendor/three.module.js';
import { lerCamada } from './mvt.js';

const Z = 14;                 // o nível com todos os prédios
const ALT_MAX = 6;            // km de altitude: acima disso, os prédios somem
const RAIO_TILES = 1;         // ladrilhos em volta (3 × 3)
const MAX_CACHE = 14;
const ALTURA_PADRAO = 0.006;  // km (dois andares)
const PALETA = [[0.55, 0.54, 0.52], [0.63, 0.61, 0.56], [0.48, 0.49, 0.51], [0.68, 0.64, 0.56], [0.57, 0.46, 0.39], [0.40, 0.43, 0.47], [0.72, 0.70, 0.65], [0.60, 0.57, 0.50]];

const latDe = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
const lonDe = (x, z) => (x / 2 ** z) * 2 * Math.PI - Math.PI;
const direcao = (lat, lon, out) => out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 cor; attribute vec2 fachada;
  varying vec3 vCor, vN; varying vec2 vFach;
  void main() {
    vCor = cor; vFach = fachada;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 luz, cima; uniform float semLuzes;
  varying vec3 vCor, vN; varying vec2 vFach;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    float dia = smoothstep(-0.12, 0.12, dot(cima, luz));
    float sol = max(dot(n, luz), 0.0) * dia;
    float ceu = 0.22 + 0.12 * max(dot(n, cima), 0.0);
    vec3 c = vCor * (ceu * (0.15 + 0.85 * dia) + 0.7 * sol);
    // janelas nas fachadas (vFach.x = metros ao longo da parede, vFach.y = metros de altura; 65535 no telhado)
    if (vFach.y < 65000.0) {
      vec2 cel = vec2(vFach.x / 3.2, vFach.y / 3.1);
      vec2 f = fract(cel);
      float janela = step(0.25, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.8) * step(1.0, vFach.y);
      c = mix(c, c * 0.6 + vec3(0.03, 0.04, 0.05) * dia, janela * 0.5);
      float acesa = step(0.55, h21(floor(cel) + floor(vCor.rg * 97.0)));
      c += janela * acesa * (1.0 - dia) * (1.0 - semLuzes) * vec3(0.55, 0.42, 0.24);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function criarPredios(cena, raio, terra) {
  const grupo = new THREE.Group();
  cena.add(grupo);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { luz: { value: new THREE.Vector3(1, 0, 0) }, cima: { value: new THREE.Vector3(0, 1, 0) }, semLuzes: { value: 0 } },
  });
  let modelo = null;
  const pronto = fetch('https://tiles.openfreemap.org/planet').then((r) => r.json()).then((j) => { modelo = j.tiles[0]; }).catch(() => {});
  const cache = new Map();
  let quadro = 0, carregando = 0;

  // monta a malha de um ladrilho: paredes e telhados, com o chão de cada prédio tirado do relevo já carregado
  function montar(x, y, dados) {
    const { extent, feicoes } = dados;
    const lat0 = latDe(y, Z), lat1 = latDe(y + 1, Z), lon0 = lonDe(x, Z), lon1 = lonDe(x + 1, Z);
    const latC = (lat0 + lat1) / 2, lonC = (lon0 + lon1) / 2;
    const up = direcao(latC, lonC, new THREE.Vector3());
    const hC = terra.altura(up);
    const centro = up.clone().multiplyScalar(raio + hC);
    const leste = new THREE.Vector3(-Math.sin(lonC), 0, -Math.cos(lonC));
    const norte = new THREE.Vector3().crossVectors(up, leste);
    // geometria compacta e indexada: posição em float, normal e cor em bytes, fachada em inteiros de 16 bits
    const pos = [], nor = [], cor = [], fach = [], idx = [];
    const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3();
    const ponto = (px, py, hKm, out) => {
      const lat = latDe(y + py / extent, Z), lon = lonDe(x + px / extent, Z);
      return direcao(lat, lon, out).multiplyScalar(raio + hKm).sub(centro);
    };
    const vert = (v, n, c, fu, fh) => {
      pos.push(v.x, v.y, v.z);
      nor.push(Math.round(n.x * 127), Math.round(n.y * 127), Math.round(n.z * 127));
      cor.push(c[0], c[1], c[2]);
      fach.push(Math.min(Math.round(fu) % 60000, 60000), fh);
      return pos.length / 3 - 1;
    };
    const areaDe = (a) => { let s = 0; for (let i = 0, n = a.length / 2; i < n; i++) { const j = (i + 1) % n; s += a[2 * i] * a[2 * j + 1] - a[2 * j] * a[2 * i + 1]; } return s / 2; };
    const mPorUnid = ((lon1 - lon0) * raio * Math.cos(latC) * 1000) / extent; // metros por unidade do ladrilho
    const TELHADO = 65535;
    let nPredios = 0;
    for (const f of feicoes) {
      if (f.tipo !== 3 || f.props.hide_3d) continue;
      const hTopo = f.props.render_height ? f.props.render_height / 1000 : ALTURA_PADRAO;
      const hBase = f.props.render_min_height ? f.props.render_min_height / 1000 : 0;
      if (hTopo <= hBase) continue;
      // separa em polígonos: contorno externo (área positiva, y para baixo) seguido dos buracos
      const polis = [];
      for (const a of f.aneis) {
        if (a.length < 6) continue;
        const ar = areaDe(a);
        if (ar > 0) polis.push({ ext: a, buracos: [] });
        else if (polis.length) polis[polis.length - 1].buracos.push(a);
      }
      for (const { ext, buracos } of polis) {
        let cx = 0, cy = 0;
        const n = ext.length / 2;
        for (let i = 0; i < n; i++) { cx += ext[2 * i]; cy += ext[2 * i + 1]; }
        cx /= n; cy /= n;
        if (cx < 0 || cy < 0 || cx > extent || cy > extent) continue; // pedaço que pertence ao vizinho
        direcao(latDe(y + cy / extent, Z), lonDe(x + cx / extent, Z), _d);
        const chao = terra.altura(_d);
        const b = chao + hBase, t = chao + hTopo;
        // cor: concreto, reboco claro, tijolo, vidro escuro (sorteada pelo contorno, sempre a mesma)
        const sorteio = ((ext[0] * 73856093) ^ (ext[1] * 19349663)) >>> 0;
        const base = PALETA[sorteio % PALETA.length], var_ = 0.9 + ((sorteio >> 8) % 20) / 100;
        const cP = base.map((v) => Math.round(Math.min(v * var_, 1) * 255));
        const cT = cP.map((v) => Math.round(v * 0.78));
        // paredes
        for (const anel of [ext, ...buracos]) {
          const m = anel.length / 2;
          let u = 0;
          for (let i = 0; i < m; i++) {
            const j = (i + 1) % m;
            const x0 = anel[2 * i], y0 = anel[2 * i + 1], x1 = anel[2 * j], y1 = anel[2 * j + 1];
            const de = x1 - x0, dn = -(y1 - y0); // leste/norte
            const comp = Math.hypot(de, dn);
            if (comp < 1e-6) continue;
            // externo no sentido horário e buracos no anti-horário: nos dois, (−dn, de) aponta para fora do prédio
            _n.copy(leste).multiplyScalar(-dn / comp).addScaledVector(norte, de / comp);
            const u1 = u + comp * mPorUnid, hb = Math.round(hBase * 1000), ht = Math.round(hTopo * 1000);
            const k0 = vert(ponto(x0, y0, b, _p), _n, cP, u, hb);
            vert(ponto(x1, y1, b, _p), _n, cP, u1, hb);
            vert(ponto(x1, y1, t, _p), _n, cP, u1, ht);
            vert(ponto(x0, y0, t, _p), _n, cP, u, ht);
            idx.push(k0, k0 + 2, k0 + 1, k0, k0 + 3, k0 + 2); // anti-horário visto de fora (a face de trás é descartada)
            u = u1;
          }
        }
        // telhado
        const v2 = (a) => { const r = []; for (let i = 0; i < a.length / 2; i++) r.push(new THREE.Vector2(a[2 * i], a[2 * i + 1])); return r; };
        const contorno = v2(ext), furos = buracos.map(v2);
        const tris = THREE.ShapeUtils.triangulateShape(contorno, furos);
        const todos = contorno.concat(...furos);
        const k0 = pos.length / 3;
        for (const q of todos) vert(ponto(q.x, q.y, t, _p), up, cT, 0, TELHADO);
        for (const tri of tris) {
          // telhado virado para cima
          const a = todos[tri[0]], b2 = todos[tri[1]], c = todos[tri[2]];
          const cruz = (b2.x - a.x) * (c.y - a.y) - (b2.y - a.y) * (c.x - a.x); // no ladrilho, y para baixo
          if (cruz < 0) idx.push(k0 + tri[0], k0 + tri[1], k0 + tri[2]); else idx.push(k0 + tri[0], k0 + tri[2], k0 + tri[1]);
        }
        nPredios++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Int8BufferAttribute(nor, 3, true));
    geo.setAttribute('cor', new THREE.Uint8BufferAttribute(cor, 3, true));
    geo.setAttribute('fachada', new THREE.Uint16BufferAttribute(fach, 2));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const malha = new THREE.Mesh(geo, material);
    malha.frustumCulled = false;
    malha.renderOrder = 4; // depois da atmosfera: a névoa dela é calculada até o chão distante e lavaria os prédios de perto
    malha.visible = false;
    grupo.add(malha);
    return { malha, centro, nPredios };
  }

  function carregar(k, x, y) {
    const e = { estado: 'baixando', usado: quadro };
    cache.set(k, e);
    carregando++;
    fetch(modelo.replace('{z}', Z).replace('{x}', x).replace('{y}', y))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((buf) => { e.dados = lerCamada(buf, 'building'); e.estado = 'esperando'; })
      .catch(() => { e.estado = 'erro'; e.t = performance.now(); })
      .finally(() => { carregando--; });
  }

  let ultimo = [];
  return {
    pronto,
    visiveis: () => ultimo.length > 0,
    total: () => [...cache.values()].reduce((s, e) => s + (e.nPredios || 0), 0),
    // camLocal: câmera no referencial da Terra (km); posTerra: centro da Terra relativo à câmera
    atualizar(camLocal, posTerra, qOri, luzMundo, ligado, semLuzes = false) {
      quadro++;
      for (const m of ultimo) m.visible = false;
      ultimo = [];
      const alt = camLocal.length() - raio;
      if (!ligado || !modelo || alt > ALT_MAX) return;
      const d = camLocal.clone().normalize();
      const lat = Math.asin(d.y), lon = Math.atan2(-d.z, d.x);
      const m = 2 ** Z;
      const tx = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * m);
      const ty = Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2 * m);
      material.uniforms.luz.value.copy(luzMundo);
      material.uniforms.cima.value.copy(d).applyQuaternion(qOri);
      material.uniforms.semLuzes.value = semLuzes ? 1 : 0;
      let montados = 0;
      for (let dx = -RAIO_TILES; dx <= RAIO_TILES; dx++) {
        for (let dy = -RAIO_TILES; dy <= RAIO_TILES; dy++) {
          const x = (((tx + dx) % m) + m) % m, y = ty + dy;
          if (y < 0 || y >= m) continue;
          const k = `${x}/${y}`;
          let e = cache.get(k);
          if (!e || (e.estado === 'erro' && performance.now() - e.t > 15000)) { if (carregando < 4) carregar(k, x, y); continue; }
          e.usado = quadro;
          // monta só quando o relevo de perto já chegou (senão os prédios flutuariam ou afundariam), um por quadro
          if (e.estado === 'esperando' && montados === 0 && terra.zAltura(direcao(latDe(y + 0.5, Z), lonDe(x + 0.5, Z), new THREE.Vector3())) >= 13) {
            Object.assign(e, montar(x, y, e.dados));
            e.dados = null; e.estado = 'pronto'; montados++;
          }
          if (e.estado !== 'pronto') continue;
          e.malha.visible = true;
          e.malha.quaternion.copy(qOri);
          e.malha.position.copy(e.centro).applyQuaternion(qOri).add(posTerra);
          ultimo.push(e.malha);
        }
      }
      if (cache.size > MAX_CACHE) {
        const velhos = [...cache.entries()].filter(([, e]) => e.estado === 'pronto' || e.estado === 'esperando' || e.estado === 'erro').sort((a, b) => a[1].usado - b[1].usado);
        for (const [k, e] of velhos.slice(0, cache.size - MAX_CACHE)) {
          if (e.malha) { grupo.remove(e.malha); e.malha.geometry.dispose(); }
          cache.delete(k);
        }
      }
    },
  };
}
