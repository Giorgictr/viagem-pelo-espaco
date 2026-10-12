// Camadas da Terra (Natural Earth): cidades, países, mares, picos, regiões e fronteiras.
// Nomes no idioma da interface quando o Natural Earth os tem (dados/gerar_lugares_idiomas.py). Tudo fica guardado no projeto (sem internet).
import * as THREE from '../vendor/three.module.js';
import { idioma, LOCALE } from './idioma.js';

const GRAU = Math.PI / 180;
// Mesma convenção da Terra: longitude 0 em +x, leste em −z, norte em +y
export const dirLatLon = (latG, lonG, out = new THREE.Vector3()) => {
  const la = latG * GRAU, lo = lonG * GRAU;
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
};

const FRONTEIRA_V = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 camLocal; uniform float raio;
  varying float vAlfa;
  void main() {
    // visível só no hemisfério voltado para a câmera (acima do horizonte)
    float a = (dot(position, camLocal) - raio * raio) / (raio * length(camLocal));
    vAlfa = smoothstep(0.0, 0.01, a);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const FRONTEIRA_F = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float opac;
  varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(1.0, 0.92, 0.6, vAlfa * opac);
  }`;

export async function criarCamadas(cena, raio, camadaRot, aoClicar) {
  const [dados, bin, nomes] = await Promise.all([
    fetch('dados/terra_camadas.json').then((r) => r.json()),
    fetch('dados/fronteiras.bin').then((r) => r.arrayBuffer()),
    idioma === 'pt' ? null : fetch(`dados/idiomas/lugares.${idioma}.json`).then((r) => r.json()).catch(() => null),
  ]);
  if (nomes) {
    for (const tipo of ['cidades', 'paises', 'mares', 'picos', 'regioes']) dados[tipo].forEach((it, i) => { if (nomes[tipo]?.[i]) it[0] = nomes[tipo][i]; });
    dados.cidades.forEach((it, i) => { it[6] = it[4]; if (nomes.paisDasCidades?.[i]) it[4] = nomes.paisDasCidades[i]; }); // o fuso horário procura o país em português
  }
  // Fronteiras: segmentos lat/lon → pontos na esfera, 300 m acima do mar
  const ll = new Float32Array(bin), pos = new Float32Array((ll.length / 2) * 3), v = new THREE.Vector3();
  for (let i = 0; i < ll.length / 2; i++) dirLatLon(ll[i * 2], ll[i * 2 + 1], v).multiplyScalar(raio + 0.3).toArray(pos, i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fronteiras = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
    vertexShader: FRONTEIRA_V, fragmentShader: FRONTEIRA_F,
    uniforms: { camLocal: { value: new THREE.Vector3() }, raio: { value: raio }, opac: { value: 0.55 } },
    transparent: true, depthTest: false, depthWrite: false,
  }));
  fronteiras.frustumCulled = false;
  fronteiras.renderOrder = 6;
  cena.add(fronteiras);

  // Itens rotuláveis
  const itens = [];
  const add = (tipo, nome, lat, lon, extra) => itens.push({ tipo, nome, dir: dirLatLon(lat, lon), lat, lon, ...extra });
  for (const [nome, lat, lon, rank] of dados.paises) add('pais', nome, lat, lon, { rank });
  for (const [nome, lat, lon, rank] of dados.mares) add('mar', nome, lat, lon, { rank });
  for (const [nome, lat, lon, pop, pais, estado, paisPt] of dados.cidades) add('cidade', nome, lat, lon, { pop, pais, estado, paisPt: paisPt ?? pais });
  for (const [nome, lat, lon, elev, rank] of dados.picos) add('pico', nome, lat, lon, { elev, rank });
  for (const [nome, lat, lon, cla, rank] of dados.regioes) add('regiao', nome, lat, lon, { rank, cla });

  // Rótulos: um conjunto fixo de elementos reaproveitados
  const pool = Array.from({ length: 90 }, () => {
    const el = document.createElement('div');
    el.style.display = 'none';
    el.onclick = () => el.item && aoClicar(el.item);
    camadaRot.append(el);
    return el;
  });

  const _p = new THREE.Vector3(), _w = new THREE.Vector3();
  const minPop = { nenhuma: Infinity, grandes: 1e6, medias: 1e5, todas: 0 };

  return {
    itens,
    fronteiras,
    // Desenha fronteiras e rótulos. cfg: { cidades, fronteiras, nomes, picos }; alturaEm(dir) → km
    atualizar(camLocal, posTerra, qOri, sTerra, camera, postos, cfg, alturaEm) {
      const dist = camLocal.length(), alt = dist - raio;
      const perto = alt < raio * 10;
      fronteiras.visible = perto && cfg.fronteiras;
      if (fronteiras.visible) {
        fronteiras.position.copy(posTerra);
        fronteiras.quaternion.copy(qOri);
        fronteiras.scale.setScalar(sTerra);
        fronteiras.material.uniforms.camLocal.value.copy(camLocal);
        fronteiras.material.uniforms.opac.value = alt < 50 ? 0.35 : 0.55;
      }
      let k = 0;
      if (perto) {
        const popMin = Math.max(minPop[cfg.cidades] ?? 1e6, alt > 6000 ? 8e6 : alt > 2500 ? 2e6 : alt > 800 ? 5e5 : alt > 200 ? 1e5 : alt > 40 ? 2e4 : 0);
        const rankPais = alt > 8000 ? 2 : alt > 3000 ? 4 : alt > 800 ? 6 : 9;
        const rankMar = alt > 6000 ? 0 : alt > 2000 ? 1 : alt > 500 ? 3 : 6;
        for (const it of itens) {
          if (k >= pool.length) break;
          if (it.tipo === 'pais' && (!cfg.nomes || alt < 150 || it.rank > rankPais)) continue;
          if (it.tipo === 'mar' && (!cfg.nomes || alt < 100 || it.rank > rankMar)) continue;
          if (it.tipo === 'cidade' && it.pop < popMin) continue;
          if (it.tipo === 'pico' && (!cfg.picos || alt > 400 || it.rank > (alt > 100 ? 4 : 8))) continue;
          if (it.tipo === 'regiao' && (!cfg.picos || alt < 60 || alt > 4000 || it.rank > 4)) continue;
          if (it.dir.dot(camLocal) < raio) continue; // atrás do horizonte
          const h = it.tipo === 'cidade' || it.tipo === 'pico' ? alturaEm(it.dir) : 0;
          _p.copy(it.dir).multiplyScalar(raio + h);
          _w.copy(_p).applyQuaternion(qOri).multiplyScalar(sTerra).add(posTerra).applyMatrix4(camera.matrixWorldInverse);
          if (_w.z >= 0) continue;
          _w.applyMatrix4(camera.projectionMatrix);
          const x = (_w.x * 0.5 + 0.5) * innerWidth, y = (-_w.y * 0.5 + 0.5) * innerHeight;
          if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
          const texto = it.tipo === 'pico' ? `▲ ${it.nome} · ${it.elev.toLocaleString(LOCALE)} m` : it.tipo === 'pais' ? it.nome.toUpperCase() : it.nome;
          const w = texto.length * (it.tipo === 'pais' ? 8 : 6.5) + 14;
          const caixa = it.tipo === 'cidade' || it.tipo === 'pico' ? [x, y - 8, x + w, y + 8] : [x - w / 2, y - 9, x + w / 2, y + 9];
          if (postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) continue;
          postos.push(caixa);
          const el = pool[k++];
          if (el.item !== it) { el.item = it; el.textContent = texto; el.className = `lugar ${it.tipo}`; }
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
          el.style.display = '';
        }
      }
      for (; k < pool.length; k++) if (pool[k].style.display !== 'none') { pool[k].style.display = 'none'; pool[k].item = null; }
    },
  };
}
