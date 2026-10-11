import * as THREE from '../vendor/three.module.js';
import { C, UA, AL, PC, GRAU, distancia, duracao, velocidade, data, jdAgora, sig } from './unidades.js';
import { CORPOS, PORID, atualizarPosicoes, pontosOrbita } from './corpos.js';
import { eixos, mouse, ligarMouse, aoTeclar, teclas } from './controles.js';
import * as S from './shaders.js';
import { riscos, atualizarDobra } from './dobra.js';
import { criarGalaxias, carregar2MRS } from './galaxias.js';
import { criarTerra, CREDITOS } from './terra.js';
import { criarCamadas } from './camadas.js';
import { zonaDoLugar, deslocamento, rotuloUTC, utcDeHoraLocal } from './fuso.js';
import { criarMissoes, raioComa } from './missoes.js';
import { criarSatelites } from './satelites.js';
import { radecParaCena, carregarEfemeridesLuas, velocidadePlaneta, equatorialParaCena } from './corpos.js';
import { estadoSom, ligarAudioNoPrimeiroGesto, atualizarSom, somDobra, mudarMusica, ajustarVolume, proximaFaixa, nomeFaixa } from './som.js';
import { criarVR } from './vr.js';
import { cat, carregarEstrelas, estrelaObj, maisProximas, criarCeu, DESTAQUES } from './estrelas.js';

// ---------------------------------------------------------------------------
// Escala: tudo é guardado em km com precisão dupla (números do JavaScript).
// A câmera fica sempre na origem da cena; cada objeto é posto relativo a ela.
// Além de R0, a distância é comprimida em log ao longo do raio de visão —
// o objeto continua no mesmo lugar da tela e com o mesmo tamanho aparente.
// ---------------------------------------------------------------------------
const R0 = 1e8;
const comprimir = (d) => (d <= R0 ? 1 : (R0 * (1 + Math.log(d / R0))) / d);
const ALTURA_OLHO = 0.0018; // km
const GASOSOS = ['jupiter', 'saturno', 'urano', 'netuno'];

const tela = document.getElementById('tela');
const renderer = new THREE.WebGLRenderer({ canvas: tela, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 1e-7, 1e11);

function redimensionar() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', redimensionar);
tela.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const el = document.createElement('div');
  el.className = 'painel';
  el.style.cssText = 'top:40%;left:50%;transform:translate(-50%,-50%);z-index:20;max-width:420px;text-align:center';
  let ultima = 0;
  try { ultima = +sessionStorage.getItem('viagemRecarga') || 0; } catch { /* sem armazenamento */ }
  const repetida = Date.now() - ultima < 60000;
  el.textContent = repetida
    ? 'A placa de vídeo ficou sem memória de novo. Feche outras abas pesadas e recarregue a página (Cmd+R).'
    : 'A placa de vídeo ficou sem memória (comum depois de muito tempo voando baixo sobre a Terra). Recarregando no mesmo lugar e na mesma data…';
  document.body.append(el);
  if (repetida) return;
  try {
    sessionStorage.setItem('viagemRecarga', String(Date.now()));
    sessionStorage.setItem('viagemEstado', JSON.stringify({
      t: Date.now(), jd: estado.jd, ref: estado.ref?.id ?? null, local: estado.local.toArray(), q: estado.q.toArray(),
      epoca: $('selEpoca').value, ma: estado.epocaMa, nivel: estado.nivelMar, v: estado.v,
    }));
  } catch { /* sem armazenamento: recomeça do início */ }
  setTimeout(() => location.reload(), 2500);
});
// Óculos de realidade virtual (js/vr.js): a câmera vai para um suporte que gira com estado.q
const vr = criarVR(renderer, cena, camera, {
  aoEntrar: () => entrarVR(), aoSair: () => sairVR(),
  textoPainel: () => textoPainelVR(),
  escolherNaDirecao: (dir) => { const c = alvoNaDirecao(dir); if (c) { escolherAlvo(c); aviso(`Alvo: ${c.nome}`); } else aviso('Nada nessa direção.'); },
  direcaoAlvo: (out) => (estado.alvo && estado.alvo !== estado.embarcado ? out.copy(estado.alvo.abs).sub(camAbs()).normalize() : null),
  nomeAlvo: () => estado.alvo?.nome ?? '',
  multiplicarV: (f) => definirV(estado.v * f),
  embarcarOuDesembarcar: () => {
    if (estado.embarcado) { desembarcar(); escolherRef(); aviso('Desembarcou.'); }
    else if (estado.alvo && missoes.objetos.includes(estado.alvo)) embarcar(estado.alvo);
    else aviso(estado.alvo ? `Não dá para embarcar ${com('em', estado.alvo)}.` : 'Escolha um alvo primeiro (gatilho direito).');
  },
  irAoAlvo: () => { if (estado.alvo) irPara(estado.alvo); else aviso('Escolha um alvo primeiro (gatilho direito).'); },
  parar: () => { pararTudo(); aviso('Parado.'); },
  trocarEfeito: () => { trocarEfeito(); aviso(EFEITOS[estado.efeito]); },
});
camera.add(riscos);
redimensionar();

// ------------------------------- estado -------------------------------
const estado = {
  jd: jdAgora(),
  orbitasMovem: true,
  ritmo: 1,
  v: 1000,                    // velocidade escolhida, km/s
  ref: null,                  // corpo que a câmera acompanha (null = espaço fixo, origem no Sol)
  local: new THREE.Vector3(), // posição da câmera relativa ao referencial, km
  q: new THREE.Quaternion(),
  cruzeiro: false,
  piloto: null,               // viagem automática em curso
  alvo: null,                 // destino escolhido
  pousado: null,              // corpo em que se está caminhando
  nomes: true, linhas: true, freio: true, cinturoes: true,
  nivelar: true, giraJunto: true, exagero: 1, texturas: true, inventado: true, ceuRealcado: false, efeito: 'dobra', bolha: true, cidades: 'grandes', fronteiras: true, nomesTerra: true, picos: true, aviao: false, altAviao: 1, epocaMa: 0, nivelMar: 0, gelo: false, ceuModo: false, telescopio: false, zoom: 10, rastrear: true, atmFisica: true, constelacoes: false, linhasConst: false, ilustrativas: true,
};

// ------------------------------- texturas -------------------------------
const carregador = new THREE.TextureLoader();
function textura(nome, cor = true) {
  const t = carregador.load(`texturas/${nome}`);
  if (cor) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Alturas na CPU (mesma amostragem da GPU) para pousar e não atravessar o chão
function carregarAlturas(c) {
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const h = new Float32Array(img.width * img.height);
    for (let i = 0; i < h.length; i++) h[i] = px[i * 4] / 255;
    c.alturas = { w: img.width, h: img.height, dados: h };
  };
  img.src = `texturas/${c.relevo[0]}`;
}
function amostraAltura(c, u, v) {
  const A = c.alturas;
  const x = u * A.w - 0.5, y = (1 - v) * A.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (i) => ((i % A.w) + A.w) % A.w, py = (j) => Math.min(Math.max(j, 0), A.h - 1);
  const g = (i, j) => A.dados[py(j) * A.w + px(i)];
  const t = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  const h = c.relevo[1] + (c.relevo[2] - c.relevo[1]) * t;
  return c.pisoMar !== undefined ? Math.max(h, c.pisoMar) : h;
}

// ------------------------------- geometria -------------------------------
const SEG = [96, 48], SEG_REL = [1024, 512];
const esfera = new THREE.SphereGeometry(1, SEG[0], SEG[1]);
const esferaRelevo = new THREE.SphereGeometry(1, SEG_REL[0], SEG_REL[1]);

const _qi = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _qe1 = new THREE.Vector3(), _qe2 = new THREE.Vector3(), _qp = new THREE.Vector3(), _qs = new THREE.Vector3(), _qq = new THREE.Vector3(), _dl = new THREE.Vector3();
function verticeGrade(c, ix, iy, out) {
  const W = SEG_REL[0], H = SEG_REL[1];
  const u = ix / W, v = 1 - iy / H;
  const phi = u * 2 * Math.PI, th = (iy / H) * Math.PI;
  out.set(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
  return out.multiplyScalar(1 + (amostraAltura(c, u, v) * estado.exagero) / c.raio);
}
// Interseção do raio (origem no centro, direção dir) com o triângulo abc; devolve a distância
function raioTriangulo(dir, a, b, c) {
  const e1 = _qe1.subVectors(b, a), e2 = _qe2.subVectors(c, a);
  const p = _qp.crossVectors(dir, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-14) return null;
  const s = _qs.copy(a).negate();
  const u = s.dot(p) / det;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = _qq.crossVectors(s, e1);
  const v = dir.dot(q) / det;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  return e2.dot(q) / det;
}

// Raio da superfície desenhada (km) na direção dada (direção na cena, a partir do centro)
function raioSuperficie(c, dirCena) {
  if (c.id === 'terra') {
    if (terra.ativo) {
      const dl = _dl.copy(dirCena).normalize().applyQuaternion(_qi.copy(c.qOri).invert());
      return c.raio + terra.altura(dl, estado.nivelMar / 1000) * estado.exagero;
    }
    if (!c.relevo) return c.raio; // Terra antiga: segue pelo caminho do relevo, abaixo
  }
  if (!c.relevo || !c.alturas) return c.raio;
  const dl = _dl.copy(dirCena).normalize().applyQuaternion(_qi.copy(c.qOri).invert());
  const th = Math.acos(Math.min(Math.max(dl.y, -1), 1));
  let phi = Math.atan2(dl.z, -dl.x);
  if (phi < 0) phi += 2 * Math.PI;
  const ix = Math.min(Math.floor((phi / (2 * Math.PI)) * SEG_REL[0]), SEG_REL[0] - 1);
  const iy = Math.min(Math.floor((th / Math.PI) * SEG_REL[1]), SEG_REL[1] - 1);
  verticeGrade(c, ix + 1, iy, _a); verticeGrade(c, ix, iy, _b); verticeGrade(c, ix, iy + 1, _c); verticeGrade(c, ix + 1, iy + 1, _d);
  const t = raioTriangulo(dl, _a, _b, _d) ?? raioTriangulo(dl, _b, _c, _d);
  if (t) return t * c.raio;
  return c.raio + amostraAltura(c, phi / (2 * Math.PI), 1 - th / Math.PI) * estado.exagero;
}

// Latitude e longitude (graus) do ponto abaixo da câmera
function latLon(c, dirCena) {
  const dl = _dl.copy(dirCena).normalize().applyQuaternion(_qi.copy(c.qOri).invert());
  return [Math.asin(Math.max(-1, Math.min(1, dl.y))) / GRAU, Math.atan2(-dl.z, dl.x) / GRAU];
}

// ------------------------------- corpos -------------------------------
// Coeficientes por km (Terra: valores clássicos de Bruneton e Hillaire, com o ozônio, que absorve o laranja e deixa o zênite azul no poente; Marte: poeira em suspensão, profundidade óptica ~0,45,
// que espalha mais o vermelho e absorve o azul, e um pouco de CO2). g = quanto a poeira espalha para a frente (por cor).
const ATM_FISICA = {
  terra: { topoKm: 100, HR: 8, HM: 1.2, betaR: [5.8e-3, 13.5e-3, 33.1e-3], betaMs: [4.0e-3, 4.0e-3, 4.0e-3], betaMe: [4.4e-3, 4.4e-3, 4.4e-3], betaO: [1.22e-3, 3.53e-3, 0.16e-3], g: [0.76, 0.76, 0.76], intensidade: 22, multiplo: 0.1 },
  marte: { topoKm: 80, HR: 11.1, HM: 11, betaR: [1.2e-4, 2.7e-4, 6.6e-4], betaMs: [0.038, 0.034, 0.029], betaMe: [0.040, 0.045, 0.052], g: [0.56, 0.64, 0.77], intensidade: 6, multiplo: 0.15 },
};
for (const c of CORPOS) {
  c.cor3 = new THREE.Color(c.cor);
  if (c.tipo === 'galaxia' || c.tipo === 'marco') continue;
  const estrela = c.tipo === 'estrela';
  const temRelevo = !!c.relevo;
  if (temRelevo) carregarAlturas(c);
  const mat = new THREE.ShaderMaterial({
    vertexShader: S.PLANETA_V,
    fragmentShader: S.PLANETA_F,
    uniforms: {
      mapa: { value: c.textura ? textura(c.textura) : null },
      noite: { value: c.noite ? textura(c.noite) : null },
      relevo: { value: temRelevo ? textura(c.relevo[0], false) : null },
      temMapa: { value: c.textura ? 1 : 0 },
      temNoite: { value: c.noite ? 1 : 0 },
      temRelevo: { value: temRelevo ? 1 : 0 },
      hMin: { value: temRelevo ? c.relevo[1] : 0 },
      hMax: { value: temRelevo ? c.relevo[2] : 0 },
      texel: { value: new THREE.Vector2(c.id === 'marte' ? 1 / 4096 : 1 / 1024, c.id === 'marte' ? 1 / 2048 : 1 / 512) },
      exagero: { value: 1 },
      raio: { value: c.raio },
      detalhe: { value: c.rochoso ? 1 : 0 },
      kmPorUnidade: { value: 1 },
      usarTextura: { value: 1 },
      emissivo: { value: estrela ? 1 : 0 },
      corBase: { value: c.cor3.clone().convertSRGBToLinear() },
      luz: { value: new THREE.Vector3(1, 0, 0) },
      polo: { value: new THREE.Vector3(0, 1, 0) },
      usarPiso: { value: 0 }, pisoMar: { value: 0 }, exposicao: { value: 1 },
      camOct: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
      paraCorpo: { value: new THREE.Matrix3() },
    },
    // O Sol entra na fila dos transparentes para ser desenhado por cima do céu diurno
    transparent: estrela,
  });
  c.malha = new THREE.Mesh(temRelevo ? esferaRelevo : esfera, mat);
  if (estrela) c.malha.renderOrder = 5;
  cena.add(c.malha);

  if (c.atm) {
    c.atmMalha = new THREE.Mesh(esfera, new THREE.ShaderMaterial({
      vertexShader: S.SIMPLES_V, fragmentShader: S.ATM_F,
      uniforms: {
        cor: { value: new THREE.Color(c.atm[0], c.atm[1], c.atm[2]) },
        luz: { value: new THREE.Vector3() }, centro: { value: new THREE.Vector3() },
        dentro: { value: 0 }, densidade: { value: 1 }, luar: { value: 0 },
      },
      transparent: true, depthWrite: false,
    }));
    c.atmMalha.renderOrder = 3;
    cena.add(c.atmMalha);
    const fis = ATM_FISICA[c.id];
    if (fis) {
      const R = c.raio;
      c.atmFis = { topo: 1 + fis.topoKm / R, mat: new THREE.ShaderMaterial({
        vertexShader: S.SIMPLES_V, fragmentShader: S.ATM_FIS_F,
        uniforms: {
          luz: { value: new THREE.Vector3() }, centro: { value: new THREE.Vector3() }, raioR: { value: R },
          topo: { value: 1 + fis.topoKm / R }, HR: { value: fis.HR / R }, HM: { value: fis.HM / R },
          betaR: { value: new THREE.Vector3(...fis.betaR).multiplyScalar(R) },
          betaMs: { value: new THREE.Vector3(...fis.betaMs).multiplyScalar(R) },
          betaMe: { value: new THREE.Vector3(...fis.betaMe).multiplyScalar(R) },
          betaO: { value: new THREE.Vector3(...(fis.betaO || [0, 0, 0])).multiplyScalar(R) },
          gM: { value: new THREE.Vector3(...fis.g) }, intensidade: { value: fis.intensidade }, exposicao: { value: 1 }, luar: { value: 0 }, multiplo: { value: fis.multiplo },
        },
        transparent: true, depthWrite: false, premultipliedAlpha: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      }) };
      c.atmSimples = c.atmMalha.material;
    }
  }
  if (c.nuvens) {
    c.nuvMalha = new THREE.Mesh(esfera, new THREE.ShaderMaterial({
      vertexShader: S.SIMPLES_V, fragmentShader: S.NUVENS_F,
      uniforms: { mapa: { value: textura(c.nuvens, false) }, luz: { value: new THREE.Vector3() }, opac: { value: 1 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    c.nuvMalha.renderOrder = 2;
    cena.add(c.nuvMalha);
  }
  if (c.aneis) {
    const [ri, re] = c.aneis;
    const geo = new THREE.RingGeometry(ri / c.raio, re / c.raio, 512, 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const rr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) rr[i] = (Math.hypot(pos.getX(i), pos.getZ(i)) - ri / c.raio) / ((re - ri) / c.raio);
    geo.setAttribute('raioRel', new THREE.BufferAttribute(rr, 1));
    const t = carregador.load('texturas/2k_saturn_ring_alpha.png');
    t.colorSpace = THREE.SRGBColorSpace;
    c.anelMalha = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: S.ANEIS_V, fragmentShader: S.ANEIS_F,
      uniforms: { mapa: { value: t }, luz: { value: new THREE.Vector3() }, centro: { value: new THREE.Vector3() }, raioP: { value: 1 }, polo: { value: c.base.p } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    c.anelMalha.renderOrder = 2;
    cena.add(c.anelMalha);
  }
}

// Vagas para as estrelas do catálogo mais próximas da câmera: ganham esfera, brilho e nome
const NV = 6;
const vagas = [];
let lista = CORPOS.slice(); // corpos do Sistema Solar + estrelas nas vagas (para referencial e proximidade)
for (let j = 0; j < NV; j++) {
  const mat = PORID.sol.malha.material.clone();
  mat.uniforms.temMapa.value = 0;
  mat.uniforms.corBase.value = new THREE.Color();
  const malha = new THREE.Mesh(esfera, mat);
  malha.renderOrder = 5;
  malha.visible = false;
  cena.add(malha);
  vagas.push({ malha, obj: null });
}

// Camada de brilhos: um ponto por corpo (e por vaga)
const nB = CORPOS.length + NV;
const geoBrilho = new THREE.BufferGeometry();
const posB = new Float32Array(nB * 3), corB = new Float32Array(nB * 3), tamB = new Float32Array(nB), alfaB = new Float32Array(nB);
geoBrilho.setAttribute('position', new THREE.BufferAttribute(posB, 3).setUsage(THREE.DynamicDrawUsage));
geoBrilho.setAttribute('cor', new THREE.BufferAttribute(corB, 3));
geoBrilho.setAttribute('tamanho', new THREE.BufferAttribute(tamB, 1).setUsage(THREE.DynamicDrawUsage));
geoBrilho.setAttribute('alfa', new THREE.BufferAttribute(alfaB, 1).setUsage(THREE.DynamicDrawUsage));
CORPOS.forEach((c, i) => c.cor3.toArray(corB, i * 3));
const brilhos = new THREE.Points(geoBrilho, new THREE.ShaderMaterial({
  vertexShader: S.BRILHO_V, fragmentShader: S.BRILHO_F,
  uniforms: { escalaPx: { value: renderer.getPixelRatio() }, beta: { value: new THREE.Vector3() } },
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
brilhos.frustumCulled = false;
brilhos.renderOrder = 4;
cena.add(brilhos);

// Cinturões: asteroides, troianos de Júpiter e Kuiper — órbitas calculadas na GPU
function criarCinturao(n, gerar, cor, alfa, tamanho) {
  const orb = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) orb.set(gerar(), i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('orb', new THREE.BufferAttribute(orb, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: S.CINTURAO_V, fragmentShader: S.CINTURAO_F,
    uniforms: {
      solRel: { value: new THREE.Vector3() }, dias: { value: 0 }, R0: { value: R0 },
      escalaPx: { value: renderer.getPixelRatio() }, tamanho: { value: tamanho },
      cor: { value: new THREE.Color(cor) }, alfa: { value: alfa }, beta: { value: new THREE.Vector3() },
    },
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 1;
  pts.userData.alfa = alfa;
  cena.add(pts);
  return pts;
}
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());
const LACUNAS = [2.5, 2.82, 2.95]; // lacunas de Kirkwood (UA)
const cinturoes = [
  criarCinturao(16000, () => {
    let a;
    do a = 2.1 + Math.random() * 1.2; while (LACUNAS.some((l) => Math.abs(a - l) < 0.025));
    return [a * UA, Math.random() * 2 * Math.PI, Math.abs(gauss()) * 7 * GRAU, Math.random() * 2 * Math.PI];
  }, 0xb8a993, 0.55, 1.6),
  criarCinturao(3000, () => {
    const lado = Math.random() < 0.5 ? 60 : -60; // pontos L4 e L5 de Júpiter
    return [(5.2026 + gauss() * 0.05) * UA, (34.4 + lado + gauss() * 12) * GRAU, Math.abs(gauss()) * 12 * GRAU, Math.random() * 2 * Math.PI];
  }, 0xa89880, 0.5, 1.5),
  criarCinturao(9000, () => {
    const a = Math.random() < 0.25 ? 39.4 + gauss() * 0.3 : 42 + Math.random() * 6;
    return [a * UA, Math.random() * 2 * Math.PI, Math.abs(gauss()) * 9 * GRAU, Math.random() * 2 * Math.PI];
  }, 0x9fb0c8, 0.45, 1.5),
];

// Via Láctea, galáxias e borda do universo
const gal = criarGalaxias(cena, S);
// Sondas e cometas com trajetórias reais (JPL Horizons)
const missoes = criarMissoes(cena, PORID, PORID.fobos.malha.material);
const satelites = criarSatelites(PORID, PORID.terra.raio); // ISS, Hubble e Tiangong em tempo real
missoes.usarVelPlaneta((id, jd) => (id === '67p' ? missoes.porId['67p']?.vel.clone() ?? new THREE.Vector3() : velocidadePlaneta(id, jd)));
const terra = criarTerra(cena, S, PORID.terra.raio); // Terra em ladrilhos (relevo e satélite), perto do chão
let mrs = null; // catálogo real de galáxias (carrega em segundo plano)
carregar2MRS(gal.brilho).then((pts) => { mrs = pts; cena.add(pts); });

// Bolha do rádio humano: até onde chegaram as transmissões de rádio desde 1920
const bolha = new THREE.Mesh(esfera, new THREE.ShaderMaterial({
  vertexShader: S.SIMPLES_V, fragmentShader: S.BOLHA_F,
  uniforms: { cor: { value: new THREE.Color(0.35, 0.8, 1.0) }, forca: { value: 0.6 } },
  blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
}));
bolha.renderOrder = 3;
cena.add(bolha);
const anoSim = (jd) => 2000 + (jd - 2451545) / 365.25;
const raioBolha = () => Math.max(anoSim(estado.jd) - 1920, 0) * AL;
let dentroBolha = true;

// Linhas de órbita (vértices recalculados a cada quadro, relativos à câmera)
const orbitas = [];
function criarOrbitas(jd) {
  for (const o of orbitas) { cena.remove(o.linha); o.linha.geometry.dispose(); }
  orbitas.length = 0;
  for (const c of CORPOS) {
    if (!c.paiObj) continue;
    const pts = pontosOrbita(c.id, jd, c.tipo === 'lua' ? 180 : 512);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c.cor3, transparent: true, opacity: 0.3, depthWrite: false }));
    linha.frustumCulled = false;
    cena.add(linha);
    orbitas.push({ corpo: c, pts, linha, jd });
  }
}

atualizarPosicoes(estado.jd);
atualizarPosicoes(estado.jd);
criarOrbitas(estado.jd);
carregarEfemeridesLuas().then(() => criarOrbitas(estado.jd)); // luas na posição exata (JPL)

// ------------------------------- referencial -------------------------------
const camAbs = (out = new THREE.Vector3()) => (estado.ref ? out.copy(estado.ref.abs).add(estado.local) : out.copy(estado.local));
let saltoRef = false;

function mudarRef(novo) {
  if (novo === estado.ref) return;
  const abs = camAbs();
  estado.ref = novo;
  estado.local.copy(novo ? abs.sub(novo.abs) : abs);
  saltoRef = true;
}

const soiDe = (c) => c.soi ?? (c.tipo === 'lua' ? c.raio * 12 : 0);
// Corpo dominante: a menor esfera de influência que contém a câmera
function escolherRef() {
  const abs = camAbs();
  let melhor = null;
  for (const c of lista) {
    const soi = soiDe(c);
    if (soi && abs.distanceTo(c.abs) < soi && (!melhor || soi < soiDe(melhor))) melhor = c;
  }
  mudarRef(melhor);
}

const distChegada = (c) =>
  c.tipo === 'sonda' ? 0.05 : c.tipo === 'cometa' ? c.raio * 60 : c.tipo === 'galaxia' ? c.raio * 2.6 : c.tipo === 'marco' ? (c.id === 'centro' ? 40 * AL : c.id === 'borda' ? 3e9 * AL : c.raio * 2) : c.tipo === 'estrela' ? Math.max(c.raio * 8, 2e5) : c.aneis ? c.raio * 6 : Math.max(c.raio * 4, 30);

// Direção de chegada: do lado iluminado, um pouco acima do plano
function direcaoBonita(c) {
  if (c.normal) return c.normal.clone().multiplyScalar(Math.cos(35 * GRAU)).addScaledVector(c.eixoMaior, Math.sin(35 * GRAU)).normalize();
  if (c.id === 'borda') return PORID.terra.abs.clone().sub(c.abs).normalize(); // por dentro, olhando para fora
  if (c.tipo === 'estrela' || c.tipo === 'galaxia' || c.tipo === 'marco') return new THREE.Vector3(0.35, 0.3, 1).normalize();
  const s = PORID.sol.abs.clone().sub(c.abs).normalize();
  if (c.aneis) {
    // do lado iluminado dos anéis, ~30° acima do plano deles
    const polo = c.base.p.clone().multiplyScalar(Math.sign(c.base.p.dot(s)) || 1);
    const noPlano = s.clone().addScaledVector(polo, -s.dot(polo)).normalize().applyAxisAngle(polo, 35 * GRAU);
    return noPlano.multiplyScalar(Math.cos(30 * GRAU)).addScaledVector(polo, Math.sin(30 * GRAU)).normalize();
  }
  return s.applyAxisAngle(new THREE.Vector3(0, 1, 0), 38 * GRAU).add(new THREE.Vector3(0, c.aneis ? 0.45 : 0.28, 0)).normalize();
}

const _m = new THREE.Matrix4(), _up = new THREE.Vector3(), ORIGEM = new THREE.Vector3();
// Artigos: "ao Sol", "à Lua", "da Terra", "na Lua", "em Marte"
const FEM = ['terra', 'lua'], MASC = ['sol'];
function com(prep, c) {
  const f = FEM.includes(c.id) || /^(Galáxia|Via Láctea|Grande Nuvem|Pequena Nuvem|Estrela|Borda)/.test(c.nome);
  const m = MASC.includes(c.id) || /^(Centro|Aglomerado|Grande Atrator|Quasar)/.test(c.nome);
  const t = { a: f ? 'à' : m ? 'ao' : 'a', de: f ? 'da' : m ? 'do' : 'de', em: f ? 'na' : m ? 'no' : 'em' }[prep];
  return `${t} ${c.nome}`;
}
function quatOlhando(dir, out = new THREE.Quaternion(), up = null) {
  if (up) _up.copy(up); else _up.set(0, 1, 0).applyQuaternion(estado.q);
  if (!Number.isFinite(_up.x + _up.y + _up.z) || _up.lengthSq() < 1e-12) _up.set(0, 1, 0);
  if (!Number.isFinite(dir.x + dir.y + dir.z) || dir.lengthSq() === 0) return out;
  if (Math.abs(_up.dot(dir.clone().normalize())) > 0.995) _up.set(0, 0, 1).applyQuaternion(estado.q);
  _m.lookAt(ORIGEM, dir, _up);
  return out.setFromRotationMatrix(_m);
}

function restaurarV() { if (estado.vAntes !== undefined) { definirV(estado.vAntes); estado.vAntes = undefined; } }
function teleportar(c) {
  if (estado.embarcado) desembarcar();
  if (estado.ceuModo) sairDoCeu();
  restaurarV();
  estado.piloto = null;
  estado.cruzeiro = false;
  estado.pousado = null;
  estado.ref = c;
  const dir = direcaoBonita(c);
  estado.local.copy(dir).multiplyScalar(distChegada(c));
  estado.q.identity();
  quatOlhando(dir.clone().negate(), estado.q);
  saltoRef = true;
  atualizarVagas();
  escolherRef();
}

function iniciarViagem(c) {
  if (!c) return;
  if (estado.ceuModo) sairDoCeu();
  restaurarV();
  estado.cruzeiro = false;
  estado.pousado = null;
  const modo = document.querySelector('input[name=modo]:checked').value;
  const d0 = camAbs().distanceTo(c.abs);
  if (modo === 'tempo') {
    mudarRef(c);
    estado.piloto = {
      modo, alvo: c, t: 0, dur: Math.max(1, +$('segundos').value || 12),
      d0, d1: distChegada(c), dir0: estado.local.clone().normalize(), dir1: direcaoBonita(c),
    };
  } else {
    estado.piloto = { modo, alvo: c };
  }
}

function pousar() {
  // Pousa no corpo dominante (o que enche a vista), não numa luazinha que esteja mais perto
  const r = estado.ref;
  const c = r && ['planeta', 'lua', 'anao'].includes(r.tipo) ? r : proximo;
  const altC = c === proximo ? altProx : camAbs().distanceTo(c.abs) - raioSuperficie(c, camAbs().sub(c.abs));
  if (!c || !['planeta', 'lua', 'anao'].includes(c.tipo)) return aviso('Chegue perto de um planeta ou lua para pousar.');
  if (GASOSOS.includes(c.id)) return aviso(`${c.nome} é um gigante gasoso: não tem chão para pousar.`);
  if (altC > c.raio * 30) return aviso(`Chegue mais perto ${com('de', c)} para pousar (menos de ${distancia(c.raio * 30)}).`);
  mudarRef(c);
  estado.cruzeiro = false;
  const dirCena = estado.local.clone().normalize();
  const alt0 = Math.max(altC, ALTURA_OLHO * 2);
  estado.piloto = {
    modo: 'pouso', alvo: c, t: 0, dur: 4 + Math.log10(alt0 / ALTURA_OLHO) * 1.1, alt0,
    dirCorpo: dirCena.applyQuaternion(c.qOri.clone().invert()),
  };
}

function pararTudo() {
  estado.piloto = null;
  estado.cruzeiro = false;
}

// ------------------------------- interface -------------------------------
const $ = (id) => document.getElementById(id);
let avisoAte = 0;
function aviso(txt) { $('aviso').textContent = txt; avisoAte = performance.now() + 4500; }

const slider = $('velSlider');
const PRESETS = [
  ['a pé', 5 / 3600], ['carro', 100 / 3600], ['avião', 900 / 3600], ['sonda Parker', 192], ['90% da luz', 0.9 * C], ['99% da luz', 0.99 * C], ['luz', C],
  ['1 ano-luz/s', AL], ['mil anos-luz/s', 1e3 * AL], ['1 milhão de anos-luz/s', 1e6 * AL], ['1 bilhão de anos-luz/s', 1e9 * AL],
];
for (const [nome, v] of PRESETS) {
  const b = document.createElement('button');
  b.textContent = nome;
  b.onclick = () => definirV(v);
  $('presets').append(b);
}
function definirV(v) {
  estado.v = Math.min(Math.max(v, 1e-3), 10 ** +slider.max);
  slider.value = Math.log10(estado.v);
  const f = velocidade(estado.v);
  $('velEsc').textContent = f.principal;
  $('velEscSub').textContent = f.secundaria;
}
slider.oninput = () => definirV(10 ** +slider.value);
definirV(estado.v);

const GRUPOS = [
  ['Sol e planetas', (c) => c.tipo === 'planeta' || c.tipo === 'anao' || c.id === 'sol'],
  ['Luas', (c) => c.tipo === 'lua'],
  ['Estrelas', (c) => c.tipo === 'estrela' && c.id !== 'sol'],
  ['Via Láctea', (c) => c.grupo === 'Via Láctea'],
  ['Grupo Local', (c) => c.grupo === 'Grupo Local'],
  ['Galáxias próximas', (c) => c.grupo === 'Galáxias próximas'],
  ['Além', (c) => c.grupo === 'Além'],
];
for (const sel of [$('selDestino'), $('selPartida')]) {
  for (const [nome, f] of GRUPOS) {
    const g = document.createElement('optgroup');
    g.label = nome;
    for (const c of CORPOS.filter(f)) g.append(new Option(c.nome + (c.tipo === 'lua' ? ` (${c.paiObj.nome})` : ''), c.id));
    if (nome === 'Estrelas') g.id = `${sel.id}Estrelas`;
    if (g.children.length || nome === 'Estrelas') sel.append(g);
  }
}
$('selPartida').value = 'terra';
$('selDestino').value = 'lua';
estado.alvo = null;
const obterCorpo = (id) => PORID[id] ?? missoes.porId[id] ?? (id && id.startsWith('hyg') ? estrelaObj(+id.slice(3)) : null);
$('selDestino').onchange = () => (estado.alvo = obterCorpo($('selDestino').value));
$('btIr').onclick = () => iniciarViagem(obterCorpo($('selDestino').value));
$('btParar').onclick = pararTudo;
$('btPousar').onclick = pousar;
$('btPartir').onclick = () => { const c = obterCorpo($('selPartida').value); if (c && (c.tipo === 'sonda' || c.tipo === 'cometa')) embarcar(c); else teleportar(c); };

// Escolhe um corpo como destino (garante que ele esteja na lista)
function escolherAlvo(c) {
  estado.alvo = c;
  const sel = $('selDestino');
  if (![...sel.options].some((o) => o.value === c.id)) $('selDestinoEstrelas').append(new Option(c.nome, c.id));
  sel.value = c.id;
}
function preencherEstrelas() {
  for (const sel of [$('selDestino'), $('selPartida')]) {
    const g = $(`${sel.id}Estrelas`);
    for (const nome of DESTAQUES) if (cat.porNome.has(nome)) g.append(new Option(nome, `hyg${cat.porNome.get(nome)}`));
  }
  for (const { i, nome } of cat.nomes) addBusca(`${nome} · estrela`, nome, 1e9, () => irPara(estrelaObj(i)));
}

// Busca única: corpos do céu, estrelas e lugares da Terra. Aceita o nome sem acento, só o começo ou
// uma palavra do nome ("andromeda", "rio de jan", "everest"); Enter escolhe o melhor resultado.
const indiceBusca = [], vistosBusca = new Set();
const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function addBusca(texto, nome, peso, acao) {
  if (vistosBusca.has(texto)) return;
  vistosBusca.add(texto);
  indiceBusca.push({ texto, chave: semAcento(nome), chaveTexto: semAcento(texto), peso, acao });
  $('listaEstrelas').append(new Option(texto));
}
function irPara(c) {
  escolherAlvo(c);
  if (estado.ceuModo) return apontar(c); // olhando o céu, a busca aponta em vez de viajar
  iniciarViagem(c); aviso(`Indo para ${c.nome}…`);
}
// Vira a câmera para um astro (no modo céu, mantendo o horizonte embaixo)
function apontar(c) {
  if (!c) return aviso('Escolha um alvo: clique num nome no céu ou use a busca.');
  const up = estado.local.clone().normalize();
  const dir = c.abs.clone().sub(camAbs());
  quatOlhando(dir, estado.q, up);
  if (estado.ceuModo && dir.normalize().dot(up) < 0) aviso(`${c.nome} está abaixo do horizonte agora.`);
  else aviso(`Apontando para ${c.nome}.`);
}
// Limite de magnitude: o olho (6,5), o "céu realçado" (9,5) e, no telescópio, quanto mais aumento, mais abertura
function limiteMag() {
  return (estado.ceuRealcado ? 9.5 : 6.5) + (estado.telescopio ? Math.min(3 * Math.log10(estado.zoom), 7) : 0);
}
const TIPO_CORPO = { estrela: 'estrela', planeta: 'planeta', anao: 'planeta anão', galaxia: 'galáxia', marco: 'lugar do universo' };
for (const c of CORPOS) addBusca(`${c.nome} · ${c.tipo === 'lua' ? `lua ${com('de', c.paiObj)}` : TIPO_CORPO[c.tipo]}`, c.nome, 1e13, () => irPara(c));
const TIPO_LUGAR = { cidade: 'cidade', pais: 'país', mar: 'mar', pico: 'pico', regiao: 'região' };
const PESO_LUGAR = { mar: 3e6, pico: 2e6, regiao: 1e5 }; // países: pelo tamanho (abaixo); metrópoles vencem mares
function preencherLugares(itens) {
  for (const it of itens) {
    const extra = it.tipo === 'cidade' ? [it.estado, it.pais].filter(Boolean).join(', ') : it.tipo === 'pico' ? `${it.elev.toLocaleString('pt-BR')} m` : '';
    const peso = it.tipo === 'cidade' ? it.pop : it.tipo === 'pais' ? 3e7 / (it.rank || 5) ** 2 : PESO_LUGAR[it.tipo];
    addBusca(`${it.nome} · ${TIPO_LUGAR[it.tipo]}${extra ? `, ${extra}` : ''}`, it.nome, peso, () => voarPara(it));
  }
}
const APELIDOS = { atlas: '3i/atlas', '3i': '3i/atlas', sp: 'sao paulo', rj: 'rio de janeiro', bh: 'belo horizonte', ny: 'nova york', titan: 'tita', poa: 'porto alegre', bsb: 'brasilia' };
function buscar(v) {
  let q = semAcento(v);
  q = APELIDOS[q] || q;
  if (!q) return null;
  const melhor = (lista) => lista.reduce((m, e) => (!m || e.peso > m.peso ? e : m), null);
  return indiceBusca.find((e) => e.chaveTexto === q)
    || melhor(indiceBusca.filter((e) => e.chave === q))
    || melhor(indiceBusca.filter((e) => e.chave.startsWith(q)))
    || melhor(indiceBusca.filter((e) => e.chave.split(/[ (-]/).some((p) => p.startsWith(q)) || e.chave.includes(q)));
}
$('busca').onchange = () => {
  const e = buscar($('busca').value);
  if (!e) return aviso('Não encontrei esse nome entre os corpos do céu, as estrelas e os lugares da Terra.');
  $('busca').value = '';
  $('busca').blur();
  e.acao();
};

// Voar até um lugar da Terra: chega um pouco ao sul dele, olhando para ele de cima
const ALT_CHEGADA = { cidade: 18, pais: 1500, mar: 1200, pico: 7, regiao: 400 };
function voarPara(it, depois = null) {
  const T = PORID.terra;
  if (estado.ceuModo) sairDoCeu();
  const altFinal = depois ? 8 : it.tipo === 'cidade' && it.pop < 1e6 ? 6 : ALT_CHEGADA[it.tipo];
  const norte = new THREE.Vector3(0, 1, 0).addScaledVector(it.dir, -it.dir.y);
  const dirCam = it.dir.clone();
  if (norte.lengthSq() > 1e-6 && !depois) dirCam.addScaledVector(norte.normalize(), -(altFinal * 1.3) / T.raio).normalize(); // para pousar, chega bem em cima
  estado.cruzeiro = false;
  estado.pousado = null;
  mudarRef(T);
  const d0 = estado.local.length();
  const d1 = T.raio + altFinal;
  estado.piloto = {
    modo: 'lugar', alvo: T, lugar: it, depois, t: 0, altFinal, dirLocal: dirCam, d0, dir0: estado.local.clone().normalize(),
    dur: Math.min(Math.max(6 + 1.6 * Math.log10(Math.max(d0 / d1, 1)), 6), 22),
  };
  aviso(`Voando para ${it.nome}…`);
}

// Modo avião: segue o relevo a uma altitude constante; ↑↓ sobem e descem, ←→ viram
function alternarAviao() {
  if (estado.aviao) { estado.aviao = false; restaurarV(); return; }
  const r = estado.ref;
  if (!r || !r.malha || r.tipo === 'estrela' || altRef > 300) return aviso('Desça a menos de 300 km de um planeta ou lua para voar de avião.');
  estado.aviao = true;
  estado.pousado = null;
  estado.piloto = null;
  estado.altAviao = Math.min(Math.max(altRef, 0.3), 30);
  if (estado.vAntes === undefined) estado.vAntes = estado.v;
  if (estado.v > 0.6 || estado.v < 0.02) definirV((estado.altAviao < 1 ? 300 : 900) / 3600);
  // visada quase horizontal (10° abaixo do horizonte), para o voo começar vendo a paisagem
  const up = estado.local.clone().normalize();
  const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q).addScaledVector(up, 0);
  fr.addScaledVector(up, -fr.dot(up));
  if (fr.lengthSq() < 1e-8) fr.copy(eixosLocais(up).norte);
  fr.normalize().multiplyScalar(Math.cos(10 * GRAU)).addScaledVector(up, -Math.sin(10 * GRAU));
  estado.q.setFromRotationMatrix(_m.lookAt(ORIGEM, fr, up));
}

// Chaves de duas posições
function chave(id, rotulos, ler, alternar, tecla) {
  const b = $(id);
  const pintar = () => { b.textContent = rotulos[ler() ? 0 : 1]; b.classList.toggle('ativo', !!ler()); };
  const f = () => { alternar(); pintar(); };
  b.onclick = f;
  if (tecla) aoTeclar(tecla, f);
  pintar();
}
chave('btOrbitas', ['Órbitas em movimento', 'Órbitas paradas'], () => estado.orbitasMovem, () => (estado.orbitasMovem = !estado.orbitasMovem), 'KeyT');
chave('btRelevo', ['Relevo exagerado ×10', 'Relevo real'], () => estado.exagero > 1, () => (estado.exagero = estado.exagero > 1 ? 1 : 10), 'KeyX');
chave('btAparencia', ['Aparência: fotos', 'Aparência: procedural'], () => estado.texturas, () => (estado.texturas = !estado.texturas), 'KeyV');
chave('btNivelar', ['Nivelar horizonte', 'Horizonte livre'], () => estado.nivelar, () => (estado.nivelar = !estado.nivelar), 'KeyN');
chave('btAtm', ['Atmosfera: física', 'Atmosfera: simples'], () => estado.atmFisica, () => (estado.atmFisica = !estado.atmFisica));
chave('btInventado', ['Detalhe inventado', 'Só dado real'], () => estado.inventado, () => (estado.inventado = !estado.inventado), 'KeyI');
chave('btCeu', ['Céu realçado', 'Céu a olho nu'], () => estado.ceuRealcado, () => (estado.ceuRealcado = !estado.ceuRealcado), 'KeyK');
// Efeito visual da velocidade: dobra (cinema) → relatividade (física real) → nenhum
const EFEITOS = { dobra: 'Efeito: dobra (cinema)', relatividade: 'Efeito: relatividade (real)', nenhum: 'Efeito: nenhum' };
function pintarEfeito() { $('btDobra').textContent = EFEITOS[estado.efeito]; $('btDobra').classList.toggle('ativo', estado.efeito !== 'nenhum'); }
function trocarEfeito() {
  const ordem = Object.keys(EFEITOS);
  estado.efeito = ordem[(ordem.indexOf(estado.efeito) + 1) % ordem.length];
  if (vr.ativo && estado.efeito === 'dobra') estado.efeito = ordem[1]; // a dobra é um efeito de tela: não vale nos óculos
  pintarEfeito();
}
$('btDobra').onclick = trocarEfeito;
aoTeclar('KeyB', trocarEfeito);
pintarEfeito();
chave('btSom', ['Som ligado', 'Som desligado'], () => estadoSom.ligado, () => { estadoSom.ligado = !estadoSom.ligado; ajustarVolume(); }, 'KeyM');
$('volume').oninput = (e) => { estadoSom.volume = +e.target.value; ajustarVolume(); };
$('selMusica').onchange = async (e) => { const a = await mudarMusica(e.target.value); if (a) aviso(a); $('btProxima').hidden = e.target.value !== 'minhas' || !!a; };
$('btProxima').onclick = proximaFaixa;
$('ckBolha').onchange = (e) => (estado.bolha = e.target.checked);
ligarAudioNoPrimeiroGesto();

// Telas pequenas e de toque: painéis recolhíveis e botões para andar e mudar a velocidade
$('btPaineis').onclick = () => document.body.classList.toggle('semPaineis');
if (innerWidth <= 760) document.body.classList.add('semPaineis');
for (const b of document.querySelectorAll('#toque button')) {
  const tecla = b.dataset.tecla, acao = b.dataset.acao;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (tecla) teclas.add(tecla);
    if (acao) definirV(estado.v * (acao === 'mais' ? 4 : 0.25));
  });
  const soltar = () => tecla && teclas.delete(tecla);
  b.addEventListener('pointerup', soltar);
  b.addEventListener('pointercancel', soltar);
  b.addEventListener('pointerleave', soltar);
}

// Modo foto: esconde o painel; Enter (ou o botão) salva a imagem
function modoFoto() { document.body.classList.toggle('foto'); }
function salvarImagem() {
  desenhar();
  tela.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `viagem-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}
$('btFoto').onclick = modoFoto;
$('btSalvar').onclick = salvarImagem;
aoTeclar('Tab', (e) => { e.preventDefault(); modoFoto(); });
aoTeclar('Enter', () => document.body.classList.contains('foto') && salvarImagem());
function clarao() { const el = $('clarao'); el.style.transition = 'none'; el.style.opacity = 0.8; requestAnimationFrame(() => { el.style.transition = 'opacity .9s ease-out'; el.style.opacity = 0; }); }

chave('btIlustr', ['Galáxias distantes: ilustrativas', 'Só galáxias catalogadas'], () => estado.ilustrativas, () => (estado.ilustrativas = !estado.ilustrativas), 'KeyU');
chave('btAviao', ['Modo avião ligado', 'Modo avião'], () => estado.aviao, alternarAviao, 'KeyY');

// ------------------------------- Terra no tempo -------------------------------
const EPOCAS = {
  hoje: { ma: 0, nivel: 0, gelo: false, texto: '' },
  glacial: { ma: 0, nivel: -120, gelo: true, texto: 'Há ~20 mil anos, no auge da última glaciação: o mar estava ~120 m mais baixo. Dava para andar da Sibéria ao Alasca (Beríngia) e da França à Inglaterra. Mantos de gelo cobriam o Canadá e o norte da Europa (contornos aproximados).' },
  k: { ma: 66, nivel: 0, texto: 'Há ~66 milhões de anos, no fim do Cretáceo: o asteroide de Chicxulub cai no atual México e extingue os dinossauros. Mares rasos cobrem partes dos continentes e o Atlântico ainda é estreito.' },
  pangeia: { ma: 250, nivel: 0, texto: 'Há ~250 milhões de anos: quase toda a terra firme forma um só supercontinente, a Pangeia, cercado pelo oceano Pantalassa. É a época da maior extinção da história.' },
  cambriano: { ma: 500, nivel: 0, texto: 'Há ~500 milhões de anos, no Cambriano: continentes espalhados e praticamente sem vida em terra firme, enquanto a vida complexa se diversifica nos mares.' },
};
const PERIODOS = [[2.6, 'Quaternário'], [23, 'Neógeno'], [66, 'Paleógeno'], [145, 'Cretáceo'], [201, 'Jurássico'], [252, 'Triássico'], [299, 'Permiano'], [359, 'Carbonífero'], [419, 'Devoniano'], [444, 'Siluriano'], [485, 'Ordoviciano'], [541, 'Cambriano']];
const periodo = (ma) => (PERIODOS.find(([fim]) => ma < fim) || PERIODOS[PERIODOS.length - 1])[1];
let indicePaleo = null, texDiaTerra = null, texNoiteTerra = null, pedidoPaleo = 0;
fetch('dados/paleo/indice.json').then((r) => r.json()).then((j) => (indicePaleo = j));

// Cores ilustrativas por altitude (mar fundo → raso → planície → serra → montanha → neve)
const PALETA = [[-6000, [8, 30, 70]], [-200, [30, 95, 150]], [0, [70, 140, 175]], [1, [92, 128, 70]], [600, [130, 140, 80]], [1500, [140, 115, 80]], [3000, [125, 105, 95]], [4500, [235, 235, 238]]];
function corAltitude(h) {
  if (h <= PALETA[0][0]) return PALETA[0][1];
  for (let i = 1; i < PALETA.length; i++) if (h <= PALETA[i][0]) {
    const [h0, c0] = PALETA[i - 1], [h1, c1] = PALETA[i], t = (h - h0) / (h1 - h0);
    return c0.map((v, k) => v + (c1[k] - v) * t);
  }
  return PALETA[PALETA.length - 1][1];
}

function aplicarNivel() {
  const E = PORID.terra;
  if (E.pisoMar !== undefined) { E.pisoMar = estado.nivelMar / 1000; E.malha.material.uniforms.pisoMar.value = E.pisoMar; recolorirPaleo(); }
  $('nivelMarTxt').textContent = `${estado.nivelMar > 0 ? '+' : ''}${estado.nivelMar} m`;
  $('nivelMar').value = estado.nivelMar;
}
let paleoAtual = null;
function recolorirPaleo() {
  if (!paleoAtual) return;
  const { alturas, cv } = paleoAtual, W = cv.width, H = cv.height, g = cv.getContext('2d');
  const img = g.createImageData(W, H), A = alturas, nivel = estado.nivelMar;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    const fx = u * A.w - 0.5, fy = v * A.h - 0.5, x0 = Math.floor(fx), y0 = Math.max(Math.min(Math.floor(fy), A.h - 2), 0);
    const tx = fx - x0, ty = Math.min(Math.max(fy - y0, 0), 1), px = (i) => ((i % A.w) + A.w) % A.w;
    const gv = (i, j) => A.dados[j * A.w + px(i)];
    const t = (gv(x0, y0) * (1 - tx) + gv(x0 + 1, y0) * tx) * (1 - ty) + (gv(x0, y0 + 1) * (1 - tx) + gv(x0 + 1, y0 + 1) * tx) * ty;
    const h = (-11000 + 20000 * t) - nivel;
    const c = corAltitude(h);
    const k = (y * W + x) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  paleoAtual.tex.needsUpdate = true;
}

async function aplicarEpoca(id, maLivre) {
  const ep = id === 'livre' ? { ma: maLivre, nivel: 0, texto: '' } : EPOCAS[id];
  const E = PORID.terra, u = E.malha.material.uniforms;
  if (!texDiaTerra) { texDiaTerra = u.mapa.value; texNoiteTerra = u.noite.value; }
  estado.epocaMa = ep.ma;
  estado.gelo = !!ep.gelo;
  estado.nivelMar = ep.nivel;
  $('tempoMa').value = ep.ma;
  $('tempoMaTxt').textContent = ep.ma ? `há ${ep.ma} milhões de anos · ${periodo(ep.ma)}` : 'hoje';
  $('textoEpoca').textContent = ep.texto || (ep.ma ? `Há ${ep.ma} milhões de anos (${periodo(ep.ma)}).` : '');
  $('fonteEpoca').hidden = !ep.ma;
  if (!ep.ma) {
    paleoAtual = null;
    E.relevo = undefined; E.alturas = undefined; E.pisoMar = undefined;
    E.malha.geometry = esfera;
    u.mapa.value = texDiaTerra; u.noite.value = texNoiteTerra; u.temNoite.value = 1; u.temRelevo.value = 0; u.usarPiso.value = 0;
    aplicarNivel();
    return;
  }
  // Mapa PALEOMAP mais próximo da idade pedida
  const pedido = ++pedidoPaleo;
  const [, nome] = indicePaleo.mapas.reduce((m, x) => (Math.abs(x[0] - ep.ma) < Math.abs(m[0] - ep.ma) ? x : m));
  const img = new Image();
  img.src = `dados/paleo/${nome}`;
  await img.decode();
  if (pedido !== pedidoPaleo) return;
  const cv0 = document.createElement('canvas');
  cv0.width = img.width; cv0.height = img.height;
  const g0 = cv0.getContext('2d', { willReadFrequently: true });
  g0.drawImage(img, 0, 0);
  const px = g0.getImageData(0, 0, img.width, img.height).data;
  const dados = new Float32Array(img.width * img.height);
  for (let i = 0; i < dados.length; i++) dados[i] = px[i * 4] / 255;
  const alturas = { w: img.width, h: img.height, dados };
  const cv = document.createElement('canvas');
  cv.width = 1440; cv.height = 720;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  paleoAtual = { alturas, cv, tex };
  recolorirPaleo();
  const rel = new THREE.Texture(img);
  rel.wrapS = THREE.RepeatWrapping;
  rel.needsUpdate = true;
  E.relevo = [null, -11, 9];
  E.alturas = alturas;
  E.pisoMar = estado.nivelMar / 1000;
  E.malha.geometry = esferaRelevo;
  u.mapa.value = tex; u.relevo.value = rel; u.temRelevo.value = 1; u.hMin.value = -11; u.hMax.value = 9;
  u.texel.value.set(1 / img.width, 1 / img.height); u.temNoite.value = 0; u.usarPiso.value = 1; u.pisoMar.value = E.pisoMar;
  aplicarNivel();
}
$('selEpoca').onchange = (e) => aplicarEpoca(e.target.value);
$('tempoMa').oninput = (e) => {
  const ma = +e.target.value;
  $('selEpoca').value = ma === 0 ? 'hoje' : 'livre';
  aplicarEpoca(ma === 0 ? 'hoje' : 'livre', ma);
};
$('nivelMar').oninput = (e) => { estado.nivelMar = +e.target.value; aplicarNivel(); };
for (const b of document.querySelectorAll('[data-nivel]')) b.onclick = () => { estado.nivelMar = +b.dataset.nivel; aplicarNivel(); };

// ------------------------------- olhar para o céu -------------------------------
// Pousa no ponto da Terra abaixo da câmera, olha para o céu (norte, 35° acima do horizonte), sem nuvens
// e sem luzes de cidade; o tempo corre normalmente e dá para escolher hora e data.
let antesDoCeu = null;
function pintarGira() { $('btGira').textContent = estado.giraJunto ? 'Girar com o planeta' : 'Não girar com o planeta'; $('btGira').classList.toggle('ativo', estado.giraJunto); }
function eixosLocais(d) {
  const E = PORID.terra;
  const polo = new THREE.Vector3(0, 1, 0).applyQuaternion(E.qOri);
  const norte = polo.clone().addScaledVector(d, -polo.dot(d));
  if (norte.lengthSq() < 1e-9) norte.set(1, 0, 0).addScaledVector(d, -d.x);
  norte.normalize();
  return { up: d, norte, leste: new THREE.Vector3().crossVectors(norte, d) };
}
function olharCeu() {
  if (estado.ceuModo) return sairDoCeu();
  const E = PORID.terra;
  if (estado.ref !== E || altRef > E.raio * 3) return aviso('Vá até a Terra (ou busque uma cidade) para olhar o céu de lá.');
  estado.piloto = null; estado.cruzeiro = false; estado.aviao = false;
  let d = estado.local.clone().normalize();
  const ul = estado.ultimoLugar;
  if (ul) {
    const dl = ul.dir.clone().applyQuaternion(E.qOri);
    if (dl.angleTo(d) < 0.03) d = dl; // acabou de voar até um lugar: fica no próprio lugar, não no ponto de chegada
  }
  estado.local.copy(d).multiplyScalar(raioSuperficie(E, d) + ALTURA_OLHO);
  estado.pousado = E;
  const { norte } = eixosLocais(d);
  estado.q.setFromRotationMatrix(_m.lookAt(ORIGEM, norte.clone().multiplyScalar(Math.cos(35 * GRAU)).addScaledVector(d, Math.sin(35 * GRAU)), d));
  antesDoCeu = { giraJunto: estado.giraJunto, linhas: estado.linhas, cinturoes: estado.cinturoes, bolha: estado.bolha, ritmo: estado.ritmo, efeito: estado.efeito, constelacoes: estado.constelacoes, linhasConst: estado.linhasConst };
  estado.giraJunto = true; pintarGira(); // no chão, quem olha o céu gira com o planeta
  estado.linhas = false; estado.cinturoes = false; estado.bolha = false; estado.constelacoes = true; estado.linhasConst = true; estado.efeito = 'nenhum';
  pintarCeuBotoes();
  estado.ritmo = 1; estado.orbitasMovem = true;
  $('selRitmo').value = '1';
  pintarEfeito();
  estado.ceuModo = true;
  document.body.classList.add('modoCeu');
  if (estado.vAntes === undefined) estado.vAntes = estado.v;
  definirV(5 / 3600);
  estado.zonaCache = null;
}
function sairDoCeu() {
  restaurarV();
  if (estado.telescopio) alternarTelescopio();
  if (Math.abs(estado.jd - jdAgora()) > 1) aviso(`A simulação continua em ${data(estado.jd)}. Use "Agora" para voltar ao presente.`);
  estado.ceuModo = false;
  document.body.classList.remove('modoCeu');
  if (antesDoCeu) {
    Object.assign(estado, { giraJunto: antesDoCeu.giraJunto, linhas: antesDoCeu.linhas, cinturoes: antesDoCeu.cinturoes, bolha: antesDoCeu.bolha, ritmo: antesDoCeu.ritmo, efeito: antesDoCeu.efeito, constelacoes: antesDoCeu.constelacoes, linhasConst: antesDoCeu.linhasConst });
    $('selRitmo').value = String(antesDoCeu.ritmo);
    pintarCeuBotoes();
    pintarGira();
    pintarEfeito();
  }
}
$('btCeu2').onclick = olharCeu;
// Telescópio: aumento variável (campo de visão menor), mais estrelas fracas e, se quiser, acompanhando o céu
function definirZoom(z) {
  estado.zoom = Math.min(Math.max(z, 1), 500);
  $('zoomSlider').value = Math.log10(estado.zoom);
  const campo = 60 / estado.zoom * (innerWidth / innerHeight); // campo horizontal aproximado
  $('zoomTxt').textContent = `${Math.round(estado.zoom)}× · campo de ${campo >= 1 ? `${sig(campo)}°` : `${Math.round(campo * 60)}'`}`;
  hudTelescopio();
}
function alternarTelescopio() {
  estado.telescopio = !estado.telescopio;
  if (estado.telescopio && !estado.ceuModo) { estado.telescopio = false; return aviso('O telescópio é usado no modo céu (Z).'); }
  document.body.classList.toggle('telescopio', estado.telescopio);
  $('ocular').hidden = !estado.telescopio;
  for (const id of ['linhaZoom', 'linhaTel', 'zoomTxt']) $(id).hidden = !estado.telescopio;
  if (estado.telescopio) { definirZoom(estado.zoom); hudTelescopio(); }
  $('btTelescopio').textContent = estado.telescopio ? 'Telescópio: ligado' : 'Telescópio: desligado';
  $('btTelescopio').classList.toggle('ativo', estado.telescopio);
}
chave('btTelescopio', ['Telescópio: ligado', 'Telescópio: desligado'], () => estado.telescopio, alternarTelescopio);
chave('btRastrear', ['Acompanhar as estrelas', 'Telescópio parado'], () => estado.rastrear, () => (estado.rastrear = !estado.rastrear));
$('zoomSlider').oninput = (e) => definirZoom(10 ** +e.target.value);
$('btApontar').onclick = () => apontar(estado.alvo);
// Dados e botões nas bordas escuras da ocular
const pintarRastrear = () => { $('hudRastrear').textContent = estado.rastrear ? 'Acompanhando as estrelas' : 'Telescópio parado'; $('hudRastrear').classList.toggle('ativo', estado.rastrear); $('btRastrear').textContent = estado.rastrear ? 'Acompanhar as estrelas' : 'Telescópio parado'; $('btRastrear').classList.toggle('ativo', estado.rastrear); };
$('hudMenos').onclick = () => definirZoom(estado.zoom / 1.5);
$('hudMais').onclick = () => definirZoom(estado.zoom * 1.5);
$('hudApontar').onclick = () => apontar(estado.alvo);
$('hudRastrear').onclick = () => { estado.rastrear = !estado.rastrear; pintarRastrear(); };
$('btRastrear').addEventListener('click', pintarRastrear);
$('hudSair').onclick = () => alternarTelescopio();
function hudTelescopio() {
  if (!estado.telescopio) return;
  const campo = 60 / estado.zoom * (innerWidth / Math.max(innerHeight, 1));
  $('hudZoom').textContent = `${Math.round(estado.zoom)}×`;
  $('hudCampo').textContent = `Campo: ${campo >= 1 ? `${sig(campo)}°` : `${Math.max(1, Math.round(campo * 60))}'`}`;
  $('hudLim').textContent = `Estrelas até a magnitude ${limiteMag().toFixed(1).replace('.', ',')}`;
  const a = estado.alvo;
  if (a && a.abs) {
    const up = estado.local.clone().normalize(), { norte, leste } = eixosLocais(up);
    const d = a.abs.clone().sub(camAbs()).normalize();
    const alt = Math.asin(Math.max(-1, Math.min(1, d.dot(up)))) / GRAU;
    const az = ((Math.atan2(d.dot(leste), d.dot(norte)) / GRAU) + 360) % 360;
    const fora = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q).angleTo(d) / GRAU > campo / 2;
    $('hudAlvo').textContent = `Alvo: ${a.nome} · ${Math.round(alt)}° de altura, ${PONTOS[Math.round(az / 22.5) % 16]} (${Math.round(az)}°)${alt < 0 ? ' · abaixo do horizonte' : fora ? ' · fora do campo' : ''}`;
  } else $('hudAlvo').textContent = 'Sem alvo: clique num nome no céu';
  $('hudHora').textContent = $('ceuHoraLocal').textContent;
  pintarRastrear();
}
for (const id of ['linhaZoom', 'linhaTel', 'zoomTxt']) $(id).hidden = true;
$('btSairCeu').onclick = sairDoCeu;
aoTeclar('KeyZ', olharCeu);
$('ckConst').onchange = (e) => { estado.constelacoes = e.target.checked; pintarCeuBotoes(); };

// Hora solar local do lugar (pela longitude) e controles de tempo
function lonAqui() {
  const E = PORID.terra;
  const [, lo] = latLon(E, estado.local);
  return lo;
}
const DIA = 1;
$('ceuAgora').onclick = () => (estado.jd = jdAgora());
$('ceuMenosHora').onclick = () => (estado.jd -= DIA / 24);
$('ceuMaisHora').onclick = () => (estado.jd += DIA / 24);
$('ceuMenosMes').onclick = () => (estado.jd -= 30.4375);
$('ceuMaisMes').onclick = () => (estado.jd += 30.4375);
// Fuso do lugar onde se está (pela cidade mais próxima), recalculado se o observador mudar de lugar
function zonaAqui() {
  const E = PORID.terra;
  const [la, lo] = latLon(E, estado.local);
  const z = estado.zonaCache;
  if (z && Math.abs(z.la - la) < 0.5 && Math.abs(z.lo - lo) < 0.5) return z;
  let perto = null, melhor = Infinity;
  if (camadas) {
    const d = estado.local.clone().normalize().applyQuaternion(E.qOri.clone().invert());
    for (const it of camadas.itens) if (it.tipo === 'cidade') { const a = it.dir.angleTo(d); if (a < melhor) { melhor = a; perto = it; } }
  }
  const { zona, estimada } = zonaDoLugar(melhor < 0.12 ? perto : null, la, lo);
  estado.zonaCache = { la, lo, zona, estimada, cidade: melhor < 0.12 ? perto : null };
  return estado.zonaCache;
}
const usarOficial = () => $('ceuModoHora').value === 'oficial';
function definirHoraLocal(ano, mes, dia, hh, mm) {
  let ms;
  if (usarOficial()) ms = utcDeHoraLocal(zonaAqui().zona, ano, mes, dia, hh, mm);
  else ms = Date.UTC(ano, mes - 1, dia, hh, mm) - (lonAqui() / 15) * 3600000;
  estado.jd = ms / 86400000 + 2440587.5;
}
// data e hora "de parede" do lugar agora (oficial ou solar)
function horaLocalAgora() {
  const ms = (estado.jd - 2440587.5) * 86400000;
  const desl = usarOficial() ? deslocamento(zonaAqui().zona, ms) * 60000 : (lonAqui() / 15) * 3600000;
  return new Date(ms + desl);
}
$('ceuModoHora').onchange = () => { painelCeu(); };
$('ceuNoite').onclick = () => {
  const t = horaLocalAgora();
  let dia = t.getUTCDate();
  if (t.getUTCHours() < 6) dia -= 1; // de madrugada, "esta noite" é a que começou ontem
  definirHoraLocal(t.getUTCFullYear(), t.getUTCMonth() + 1, dia, 22, 0);
};
$('ceuRapido').onclick = () => {
  estado.ritmo = estado.ritmo === 600 ? 1 : 600;
  $('selRitmo').value = String(estado.ritmo);
  $('ceuRapido').classList.toggle('ativo', estado.ritmo === 600);
};
$('ceuData').onchange = $('ceuHora').onchange = () => {
  const d = $('ceuData').value, h = $('ceuHora').value || '22:00';
  if (!d) return;
  const [ano, mes, dia] = d.split('-').map(Number), [hh, mm] = h.split(':').map(Number);
  definirHoraLocal(ano, mes, dia, hh, mm);
};

// Linhas das constelações (d3-celestial, © 2015 Olaf Frohn, licença BSD): ligar para se orientar, desligar para só apreciar
let linhasConst = null;
fetch('dados/constelacoes_linhas.bin').then((r) => r.arrayBuffer()).then((buf) => {
  const p = new Float32Array(buf).map((v) => v * 1e9); // "no infinito", além de qualquer objeto
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  linhasConst = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
    vertexShader: S.LINHA_CEU_V, fragmentShader: S.LINHA_CEU_F,
    uniforms: { opac: { value: 0.35 }, beta: { value: new THREE.Vector3() } },
    transparent: true, depthWrite: false,
  }));
  linhasConst.frustumCulled = false;
  linhasConst.renderOrder = 4;
  linhasConst.visible = false;
  cena.add(linhasConst);
});
function pintarCeuBotoes() {
  $('btLinhasConst').textContent = estado.linhasConst ? 'Desenho das constelações: ligado' : 'Desenho das constelações: desligado';
  $('btLinhasConst').classList.toggle('ativo', estado.linhasConst);
  $('btNomesConst').textContent = estado.constelacoes ? 'Nomes das constelações: ligados' : 'Nomes das constelações: desligados';
  $('btNomesConst').classList.toggle('ativo', estado.constelacoes);
  $('ckLinhasConst').checked = estado.linhasConst;
  $('ckConst').checked = estado.constelacoes;
}
$('btLinhasConst').onclick = () => { estado.linhasConst = !estado.linhasConst; pintarCeuBotoes(); };
$('btNomesConst').onclick = () => { estado.constelacoes = !estado.constelacoes; pintarCeuBotoes(); };
$('ckLinhasConst').onchange = (e) => { estado.linhasConst = e.target.checked; pintarCeuBotoes(); };
pintarCeuBotoes();

// Constelações (nomes no centro de cada uma, como vistas do Sistema Solar)
let constelacoes = [];
fetch('dados/constelacoes.json').then((r) => r.json()).then((lista) => {
  constelacoes = lista.map(([nome, x, y, z]) => {
    const el = document.createElement('div');
    el.className = 'constelacao';
    el.textContent = nome;
    el.style.display = 'none';
    camadaRot.append(el);
    return { nome, dir: new THREE.Vector3(x, y, z), el };
  });
  // na busca: "orion", "escorpiao"… vira a câmera para a constelação e liga o desenho e os nomes
  for (const c of constelacoes) addBusca(`${c.nome} · constelação`, c.nome, 1e10, () => {
    estado.constelacoes = true; estado.linhasConst = true; pintarCeuBotoes();
    const up = estado.ceuModo ? estado.local.clone().normalize() : null;
    quatOlhando(c.dir.clone(), estado.q, up);
    if (estado.ceuModo && c.dir.dot(up) < 0) aviso(`${c.nome} está abaixo do horizonte agora.`);
    else aviso(`Olhando para ${c.nome}.`);
  });
});
// ------------------------------- sondas e cometas: embarcar, momentos e fotos -------------------------------
const nM = 24;
const geoM = new THREE.BufferGeometry();
const posM = new Float32Array(nM * 3), corM = new Float32Array(nM * 3), tamM = new Float32Array(nM), alfaM = new Float32Array(nM);
geoM.setAttribute('position', new THREE.BufferAttribute(posM, 3).setUsage(THREE.DynamicDrawUsage));
geoM.setAttribute('cor', new THREE.BufferAttribute(corM, 3));
geoM.setAttribute('tamanho', new THREE.BufferAttribute(tamM, 1).setUsage(THREE.DynamicDrawUsage));
geoM.setAttribute('alfa', new THREE.BufferAttribute(alfaM, 1).setUsage(THREE.DynamicDrawUsage));
const marcasMissoes = new THREE.Points(geoM, brilhos.material.clone());
marcasMissoes.frustumCulled = false;
marcasMissoes.renderOrder = 4;
cena.add(marcasMissoes);
const rotulosMissoes = [];
const TIPO_EMBARQUE = { sonda: 'sonda espacial (embarcar)', cometa: 'cometa (embarcar)', satelite: 'satélite, agora (embarcar)' };
function registrarEmbarcaveis(lista, grupos) {
  for (const o of lista) {
    if (missoes.objetos.includes(o) && rotulosMissoes[missoes.objetos.indexOf(o)]) continue;
    if (!missoes.objetos.includes(o)) { missoes.objetos.push(o); missoes.porId[o.id] = o; }
    const i = missoes.objetos.indexOf(o);
    new THREE.Color(o.cor).toArray(corM, i * 3);
    const el = novoRotulo(o.tipo === 'cometa' ? 'cometa' : 'sonda');
    el.textContent = o.nome;
    el.corpo = o;
    el.onclick = () => escolherAlvo(o);
    el.ondblclick = () => embarcar(o);
    rotulosMissoes[i] = el;
    addBusca(`${o.nome} · ${TIPO_EMBARQUE[o.tipo]}`, o.nome, 1e12, () => embarcar(o));
  }
  geoM.attributes.cor.needsUpdate = true;
  for (const sel of [$('selDestino'), $('selPartida')]) {
    for (const [titulo, tipo] of grupos) {
      const g = document.createElement('optgroup');
      g.label = titulo;
      for (const o of lista.filter((x) => x.tipo === tipo)) g.append(new Option(o.nome, o.id));
      sel.append(g);
    }
  }
}
missoes.pronto.then(() => registrarEmbarcaveis(missoes.objetos.slice(), [['Sondas espaciais', 'sonda'], ['Cometas', 'cometa']]));
Promise.all([missoes.pronto, satelites.pronto]).then(() => registrarEmbarcaveis(satelites.objetos, [['Satélites (agora)', 'satelite']]));

// a Terra está entre o observador e o ponto? (satélites do outro lado do planeta não aparecem)
const _lvX = new THREE.Vector3(), _lvY = new THREE.Vector3(), _lvZ = new THREE.Vector3(), _lvM = new THREE.Matrix4();
const _ocT = new THREE.Vector3(), _odT = new THREE.Vector3();
function atrasDaTerra(de, ate) {
  const E = PORID.terra;
  const d = _odT.copy(ate).sub(de), L = d.length();
  const m = _ocT.copy(E.abs).sub(de), t = m.dot(d) / (L * L);
  if (t <= 0 || t >= 1) return false;
  return m.addScaledVector(d, -t).length() < E.raio * 0.998;
}
function desenharMissoes(abs, postos, pxPorRad) {
  const sol = PORID.sol.abs;
  missoes.objetos.forEach((o, i) => {
    const el = rotulosMissoes[i];
    const rel = tmpV.copy(o.abs).sub(abs), d = rel.length(), s = comprimir(d);
    o.oculto = o.ativo && atrasDaTerra(abs, o.abs);
    let tam = 0, alfa = 0;
    if (o.tipo === 'cometa') {
      const mag = missoes.desenharCometa(o, rel, d, s, sol, pxPorRad, renderer.getPixelRatio(), diaNoCeu);
      if (o.ativo) {
        const brilho = 10 ** (-0.4 * (mag - limiteMag()));
        tam = Math.min(Math.max(2.4 * brilho ** 0.22, 3), 40);
        alfa = Math.min(Math.max(brilho, 0.35), 1) * (1 - diaNoCeu);
      }
    } else if (o.tipo === 'satelite') {
      if (o.ativo && !o.oculto && o !== estado.embarcado) { tam = o.sombra ? 2 : 5; alfa = (o.sombra ? 0.12 : 1) * (1 - diaNoCeu); }
    } else if (o.ativo && !o.oculto && o !== estado.embarcado) { tam = 4; alfa = 0.85 * (1 - diaNoCeu); }
    aberrarJS(projetado.copy(rel).multiplyScalar(s)).toArray(posM, i * 3);
    tamM[i] = tam; alfaM[i] = alfa;
    if (!el) return;
    let mostrar = o.ativo && !o.oculto && o !== estado.embarcado && ((estado.nomes && diaNoCeu < 0.5) || o === estado.alvo);
    if (mostrar) {
      projetado.applyMatrix4(camera.matrixWorldInverse);
      if (projetado.z >= 0) mostrar = false;
      else {
        projetado.applyMatrix4(camera.projectionMatrix);
        const x = (projetado.x * 0.5 + 0.5) * innerWidth + 4, y = (-projetado.y * 0.5 + 0.5) * innerHeight;
        const caixa = [x, y - 8, x + o.nome.length * 6.5 + 12, y + 8];
        if (x < 0 || x > innerWidth || y < 0 || y > innerHeight || (o !== estado.alvo && postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1]))) mostrar = false;
        else { postos.push(caixa); el.style.left = `${x}px`; el.style.top = `${y}px`; }
      }
    }
    el.style.display = mostrar ? '' : 'none';
    el.classList.toggle('alvo', o === estado.alvo);
  });
  geoM.attributes.position.needsUpdate = true;
  geoM.attributes.tamanho.needsUpdate = true;
  geoM.attributes.alfa.needsUpdate = true;
  marcasMissoes.material.uniforms.beta.value.copy(betaVec);
}

// Embarcar: a câmera passa a andar com a sonda (ou perto do núcleo do cometa); o tempo é controlado no painel da missão
function embarcar(o) {
  if (!o) return;
  if (estado.ceuModo) sairDoCeu();
  restaurarV();
  estado.piloto = null; estado.pousado = null; estado.aviao = false; estado.cruzeiro = false;
  if (!(estado.jd >= o.jd0 && estado.jd <= o.jd1)) estado.jd = o.tipo === 'satelite' ? jdAgora() : o.momentos[0]?.jd ?? o.jd0 + 1;
  atualizarPosicoes(estado.jd);
  missoes.atualizar(estado.jd);
  satelites.atualizar(estado.jd);
  estado.embarcado = o;
  estado.ref = o;
  o.qLv = null;
  const paraSol = PORID.sol.abs.clone().sub(o.abs).normalize();
  if (o.tipo === 'cometa') {
    // longe do Sol o cometa é só um núcleo escuro: começa no primeiro momento em que ele está ativo
    if (o.abs.distanceTo(PORID.sol.abs) > 5 * UA && o.momentos[0]) { estado.jd = o.momentos[0].jd; atualizarPosicoes(estado.jd); missoes.atualizar(estado.jd); }
    enquadrarCometa(o);
  } else if (o.tipo === 'satelite') {
    // vista da janela: a Terra embaixo e o horizonte à frente, no sentido do movimento
    estado.local.set(0.001, 0, 0);
    const paraTerra = PORID.terra.abs.clone().sub(o.abs).normalize();
    const frente = equatorialParaCena(o.velEq.x, o.velEq.y, o.velEq.z).normalize();
    quatOlhando(frente.multiplyScalar(0.8).addScaledVector(paraTerra, 0.6), estado.q, paraTerra.clone().negate());
  } else {
    estado.local.set(0.001, 0, 0);
    quatOlhando(o.vel.lengthSq() ? o.vel.clone() : paraSol, estado.q);
  }
  saltoRef = true;
  estado.ritmo = 1; estado.orbitasMovem = true; $('selRitmo').value = '1';
  montarPainelMissao(o);
  document.body.classList.add('embarcado');
  aviso(`A bordo ${o.tipo === 'sonda' ? 'da sonda' : o.tipo === 'satelite' ? (o.id === 'hubble' ? 'do' : 'da') : 'do'} ${o.nome}.`);
}
// Vista de lado em relação ao Sol, fora da coma: núcleo, coma e cauda (que aponta para longe do Sol) de perfil
function enquadrarCometa(o) {
  const paraSol = PORID.sol.abs.clone().sub(o.abs).normalize();
  const lado = new THREE.Vector3().crossVectors(paraSol, new THREE.Vector3(0, 1, 0)).normalize();
  const rc = raioComa(o, o.abs.distanceTo(PORID.sol.abs) / UA);
  const dist = Math.max(rc * 3, o.raio * 40);
  estado.local.copy(lado).multiplyScalar(dist).addScaledVector(paraSol, dist * 0.15);
  quatOlhando(paraSol.clone().multiplyScalar(-dist * 0.3).sub(estado.local), estado.q); // núcleo perto do centro, cauda saindo para o lado
}
function desembarcar() {
  estado.embarcado = null;
  document.body.classList.remove('embarcado');
  $('foto').hidden = true;
}
function montarPainelMissao(o) {
  $('mNome').textContent = o.nome;
  const lin = $('mLinha');
  lin.min = o.jd0; lin.max = o.jd1; lin.step = 0.25;
  const lista = $('mMomentos');
  lista.textContent = '';
  for (const m of o.momentos) {
    const b = document.createElement('button');
    b.className = 'momento';
    b.textContent = `${new Date((m.jd - 2440587.5) * 86400000).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · ${m.titulo}${m.foto ? ' 📷' : ''}`;
    b.onclick = () => irMomento(o, m);
    lista.append(b);
  }
  $('mAgora').hidden = !(jdAgora() >= o.jd0 && jdAgora() <= o.jd1);
  $('mMomentosTit').hidden = !o.momentos.length;
  // satélites dão uma volta em hora e meia: ritmos curtos; sondas e cometas, ritmos de dias a anos
  const ritmos = o.tipo === 'satelite' ? [[1, 'tempo real'], [60, '1 min/s'], [3600, '1 h/s'], [86400, '1 dia/s']]
    : [[1, 'tempo real'], [86400, '1 dia/s'], [2629800, '1 mês/s'], [31557600, '1 ano/s']];
  document.querySelectorAll('#pMissao [data-ritmo]').forEach((b, i) => { b.dataset.ritmo = ritmos[i][0]; b.textContent = ritmos[i][1]; });
}
function irMomento(o, m) {
  estado.jd = m.jd;
  atualizarPosicoes(estado.jd);
  missoes.atualizar(estado.jd);
  estado.ritmo = 1; $('selRitmo').value = '1';
  if (m.olhar === 'cometa') { enquadrarCometa(o); $('mTexto').textContent = m.texto; if (m.foto) mostrarFoto(m); else $('foto').hidden = true; return; }
  const alvo = m.olhar ? (PORID[m.olhar] || missoes.porId[m.olhar]) : null;
  const dir = m.olharRaDec ? radecParaCena(m.olharRaDec[0], m.olharRaDec[1], 1) : alvo ? alvo.abs.clone().sub(camAbs()) : null;
  if (dir) quatOlhando(dir, estado.q);
  $('mTexto').textContent = m.texto;
  if (m.foto) mostrarFoto(m); else $('foto').hidden = true;
}
function mostrarFoto(m) {
  $('fotoImg').src = `dados/fotos/${m.foto}.jpg`;
  $('fotoImg').alt = m.fotoInfo?.titulo || m.titulo;
  $('fotoTitulo').textContent = m.titulo;
  $('fotoTexto').textContent = m.texto;
  $('fotoCredito').textContent = `Foto real: ${m.credito || 'NASA'}${m.fotoInfo?.titulo ? ` · "${m.fotoInfo.titulo}"` : ''}. Ao fundo, a cena simulada do mesmo momento.`;
  $('foto').hidden = false;
}
let jdAnteriorMomentos = 0;
function avisarMomentos() {
  const o = estado.embarcado;
  if (o && estado.ritmo > 1) for (const m of o.momentos) if (jdAnteriorMomentos < m.jd && m.jd <= estado.jd) aviso(`${m.titulo}: veja em "Momentos" no painel da missão.`);
  jdAnteriorMomentos = estado.jd;
}
function painelMissao() {
  const o = estado.embarcado, abs = camAbs();
  $('mData').textContent = data(estado.jd);
  if (!o.ativo) {
    $('mInfo').textContent = o.tipo === 'satelite' ? `Os elementos orbitais valem perto de ${data(o.epoca)} (±${Math.round(o.jd1 - o.epoca)} dias). Use "Agora".` : `Fora do período com dados (${data(o.jd0)} a ${data(o.jd1)}).`;
  } else if (o.tipo === 'satelite') {
    const periodo = (2 * Math.PI) / o.rec.no; // minutos
    const la = o.lat / GRAU, lo = o.lon / GRAU;
    $('mInfo').textContent = `Altitude ${sig(o.alt)} km · ${sig(o.velTerra * 3600)} km/h em relação à Terra · uma volta na Terra a cada ${Math.round(periodo)} min · sobre ${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'}, ${sig(Math.abs(lo))}° ${lo >= 0 ? 'L' : 'O'} · ${o.sombra ? 'na sombra da Terra' : o.id === 'hubble' ? 'iluminado pelo Sol' : 'iluminada pelo Sol'}${o.reserva ? ' · sem internet: elementos guardados, menos precisos' : ''}`;
  } else {
    const dT = abs.distanceTo(PORID.terra.abs);
    $('mInfo').textContent = `Do Sol: ${distancia(o.abs.distanceTo(PORID.sol.abs))} · da Terra: ${distancia(dT)} · velocidade em relação ao Sol: ${sig(o.vel.length())} km/s · ${o.tipo === 'sonda' ? 'um sinal daqui leva' : 'a luz daqui leva'} ${duracao(dT / C)} até a Terra`;
  }
  if (document.activeElement !== $('mLinha')) $('mLinha').value = estado.jd;
}
$('mLinha').oninput = (e) => { estado.jd = +e.target.value; };
for (const b of document.querySelectorAll('#pMissao [data-ritmo]')) b.onclick = () => { estado.ritmo = +b.dataset.ritmo; estado.orbitasMovem = estado.ritmo !== 0; if (estado.ritmo === 0) estado.ritmo = 1; $('selRitmo').value = String(estado.ritmo); };
$('mPausa').onclick = () => { estado.orbitasMovem = false; };
$('mAgora').onclick = () => { estado.jd = jdAgora(); estado.ritmo = 1; estado.orbitasMovem = true; $('selRitmo').value = '1'; };
$('mSair').onclick = () => { desembarcar(); escolherRef(); };
$('btEmbarcar').onclick = () => { const c = obterCorpo($('selDestino').value); if (c && (c.tipo === 'sonda' || c.tipo === 'cometa')) embarcar(c); else aviso('Escolha uma sonda ou um cometa no destino para embarcar.'); };
$('fotoFechar').onclick = () => ($('foto').hidden = true);

let bussola = []; // criada depois da camada de rótulos
function criarBussola() {
  bussola = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'].map((t, i) => {
    const el = document.createElement('div');
    el.className = 'bussola';
    el.textContent = t;
    el.style.display = 'none';
    camadaRot.append(el);
    return { az: i * 45, el };
  });
}
$('selCidades').onchange = (e) => (estado.cidades = e.target.value);
$('ckFronteiras').onchange = (e) => (estado.fronteiras = e.target.checked);
$('ckNomesTerra').onchange = (e) => (estado.nomesTerra = e.target.checked);
$('ckPicos').onchange = (e) => (estado.picos = e.target.checked);
chave('btGira', ['Girar com o planeta', 'Não girar com o planeta'], () => estado.giraJunto, () => (estado.giraJunto = !estado.giraJunto), 'KeyJ');
$('btAgora').onclick = () => (estado.jd = jdAgora());
$('selRitmo').onchange = () => (estado.ritmo = +$('selRitmo').value);
$('ckNomes').onchange = (e) => (estado.nomes = e.target.checked);
$('ckLinhas').onchange = (e) => (estado.linhas = e.target.checked);
$('ckFreio').onchange = (e) => (estado.freio = e.target.checked);
$('ckCint').onchange = (e) => (estado.cinturoes = e.target.checked);
const ajuda = () => $('ajuda').classList.toggle('aberta');
$('btAjuda').onclick = ajuda;
$('btFecharAjuda').onclick = ajuda;

aoTeclar('Space', pararTudo);
aoTeclar('KeyC', () => { estado.cruzeiro = !estado.cruzeiro; estado.piloto = null; });
aoTeclar('KeyG', () => iniciarViagem(estado.alvo ?? obterCorpo($('selDestino').value)));
aoTeclar('KeyP', pousar);
aoTeclar('KeyH', ajuda);
aoTeclar('KeyL', () => ($('ckNomes').checked = estado.nomes = !estado.nomes));
aoTeclar('KeyO', () => ($('ckLinhas').checked = estado.linhas = !estado.linhas));
aoTeclar('Equal', () => definirV(estado.v * 2));
aoTeclar('NumpadAdd', () => definirV(estado.v * 2));
aoTeclar('Minus', () => definirV(estado.v / 2));
aoTeclar('NumpadSubtract', () => definirV(estado.v / 2));
aoTeclar('Escape', () => { if (estado.telescopio) alternarTelescopio(); else $('ajuda').classList.remove('aberta'); });
ligarMouse(tela);
document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });

// Rótulos
const camadaRot = $('rotulos');
for (const c of CORPOS) {
  const el = document.createElement('div');
  el.className = `rot ${c.tipo}`;
  el.textContent = c.nome;
  el.onclick = () => escolherAlvo(c);
  el.ondblclick = () => { escolherAlvo(c); iniciarViagem(c); };
  camadaRot.append(el);
  c.rotulo = el;
}
// Rótulos das vagas e das estrelas com nome mais brilhantes
function novoRotulo(classe) {
  const el = document.createElement('div');
  el.className = `rot ${classe}`;
  el.style.display = 'none';
  el.onclick = () => el.corpo && escolherAlvo(el.corpo);
  el.ondblclick = () => { if (el.corpo) { escolherAlvo(el.corpo); iniciarViagem(el.corpo); } };
  camadaRot.append(el);
  return el;
}
for (const v of vagas) v.rotulo = novoRotulo('estrela');
const rotulosCeu = Array.from({ length: 30 }, () => novoRotulo('estrela'));
let estrelasRotuladas = [];

// Céu do catálogo (carrega em segundo plano)
criarBussola();

// Camadas da Terra (cidades, países, fronteiras…): clicar num nome voa até lá
let camadas = null;
criarCamadas(cena, PORID.terra.raio, camadaRot, voarPara).then((c) => { camadas = c; preencherLugares(c.itens); preencherCidades(c.itens); });

// Pousar numa cidade escolhida (e, se quiser, já olhar o céu de lá)
const cidadesPorTexto = new Map();
let cidadesLista = [];
function preencherCidades(itens) {
  cidadesLista = itens.filter((it) => it.tipo === 'cidade').sort((a, b) => b.pop - a.pop);
  const dl = $('listaCidades');
  for (const it of cidadesLista) {
    const t = `${it.nome} · ${[it.estado, it.pais].filter(Boolean).join(', ')}`;
    if (cidadesPorTexto.has(t)) continue;
    cidadesPorTexto.set(t, it);
    dl.append(new Option(t));
  }
}
function acharCidade(txt) {
  if (cidadesPorTexto.has(txt)) return cidadesPorTexto.get(txt);
  const q = semAcento(txt.split('·')[0].trim());
  const qq = APELIDOS[q] || q;
  if (!qq) return null;
  return cidadesLista.find((it) => semAcento(it.nome) === qq) || cidadesLista.find((it) => semAcento(it.nome).startsWith(qq)) || null;
}
function pousarNaCidade(txt, ceu) {
  const it = acharCidade(txt);
  if (!it) return aviso(txt ? `Não achei a cidade "${txt}". Escolha uma da lista.` : 'Escreva o nome de uma cidade.');
  const E = PORID.terra;
  if (estado.ceuModo) {
    // já no modo céu: muda de lugar na hora, no mesmo instante
    estado.ultimoLugar = it;
    const d = it.dir.clone().applyQuaternion(E.qOri);
    estado.local.copy(d).multiplyScalar(raioSuperficie(E, d) + ALTURA_OLHO);
    const { norte } = eixosLocais(d);
    estado.q.setFromRotationMatrix(_m.lookAt(ORIGEM, norte.clone().multiplyScalar(Math.cos(35 * GRAU)).addScaledVector(d, Math.sin(35 * GRAU)), d));
    estado.zonaCache = null;
    aviso(`Céu de ${it.nome}${it.pais ? `, ${it.pais}` : ''}`);
    return;
  }
  if (estado.embarcado) desembarcar();
  voarPara(it, ceu ? 'ceu' : 'pousar');
}
$('btPousarCidade').onclick = () => pousarNaCidade($('cidadePouso').value, false);
$('btCeuCidade').onclick = () => pousarNaCidade($('cidadePouso').value, true);
$('cidadePouso').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); pousarNaCidade(e.target.value, false); e.target.blur(); } };
$('btCeuMudar').onclick = () => { pousarNaCidade($('ceuCidade').value, true); $('ceuCidade').value = ''; };
$('ceuCidade').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('btCeuMudar').click(); e.target.blur(); } };

let ceu = null;
carregarEstrelas().then(() => {
  ceu = criarCeu(S);
  ceu.material.uniforms.escalaPx.value = renderer.getPixelRatio();
  cena.add(ceu);
  preencherEstrelas();
  atualizarVagas();
});

// Põe nas vagas as estrelas mais próximas (mantendo as que continuam próximas na mesma vaga)
function atualizarVagas() {
  if (!cat.n) return;
  const novos = maisProximas(camAbs(), NV).map(estrelaObj);
  for (const v of vagas) if (v.obj && !novos.includes(v.obj)) { v.obj.malha = v.obj.rotulo = null; v.obj = null; }
  for (const o of novos) {
    if (vagas.some((v) => v.obj === o)) continue;
    const j = vagas.findIndex((v) => !v.obj);
    const v = vagas[j];
    v.obj = o;
    o.malha = v.malha;
    o.rotulo = v.rotulo;
    v.rotulo.textContent = o.nome;
    v.rotulo.corpo = o;
    // a superfície vista de perto tem a cor mais intensa que o ponto visto de longe
    v.malha.material.uniforms.corBase.value.copy(o.cor3).offsetHSL(0, 0.35, -0.12).convertSRGBToLinear();
    v.malha.material.uniforms.raio.value = o.raio;
    o.cor3.toArray(corB, (CORPOS.length + j) * 3);
  }
  geoBrilho.attributes.cor.needsUpdate = true;
  lista = CORPOS.concat(vagas.filter((v) => v.obj).map((v) => v.obj));
  if (ceu) {
    const oc = ceu.material.uniforms.ocultos.value;
    oc.fill(-1);
    vagas.forEach((v, j) => (oc[j] = v.obj ? v.obj.hyg : -1));
  }
}

// As estrelas com nome mais brilhantes vistas daqui recebem rótulo
function escolherRotulosEstrelas() {
  if (!cat.n) return;
  const abs = camAbs(), d = cat.dados, lim = limiteMag();
  const x = abs.x / PC, y = abs.y / PC, z = abs.z / PC;
  const nasVagas = new Set(vagas.filter((v) => v.obj).map((v) => v.obj.hyg));
  estrelasRotuladas = cat.nomes
    .filter(({ i }) => !nasVagas.has(i))
    .map(({ i }) => {
      const k = i * 5, dist = Math.hypot(d[k] - x, d[k + 1] - y, d[k + 2] - z);
      return { i, m: d[k + 3] + 5 * Math.log10(Math.max(dist, 1e-12)) - 5 };
    })
    .filter((e) => e.m < Math.min(lim, 3.5 + (lim - 6.5)))
    .sort((a, b) => a.m - b.m)
    .slice(0, rotulosCeu.length);
  rotulosCeu.forEach((el, k) => {
    const e = estrelasRotuladas[k];
    el.corpo = e ? estrelaObj(e.i) : null;
    el.textContent = el.corpo ? el.corpo.nome : '';
  });
}

// De dentro da Via Láctea, só ganham nome as galáxias visíveis a olho nu (e o centro galáctico)
const OLHO_NU = new Set(['andromeda', 'triangulo', 'gnm', 'pnm', 'centro']);
function nomeFazSentido(c, abs) {
  if (c.tipo !== 'galaxia' && c.tipo !== 'marco') return true;
  return OLHO_NU.has(c.id) || abs.distanceTo(PORID.centro.abs) > 1.5e5 * AL;
}
// Uma lua só aparece (nome, marcador, órbita) quando se está perto do planeta dela
const luaVisivel = (c, abs) => c.tipo !== 'lua' || abs.distanceTo(c.paiObj.abs) < Math.max(c.paiObj.soi * 3, c.orbita ? c.orbita[0] * 8 : 0);

// ------------------------------- laço -------------------------------
teleportar(PORID.terra);
// Volta ao lugar e à data de antes, se a página acabou de recarregar por falta de memória da placa de vídeo
try {
  const salvo = JSON.parse(sessionStorage.getItem('viagemEstado') || 'null');
  sessionStorage.removeItem('viagemEstado');
  if (salvo && Date.now() - salvo.t < 60000) {
    estado.jd = salvo.jd;
    estado.ref = salvo.ref ? obterCorpo(salvo.ref) : null;
    estado.local.fromArray(salvo.local);
    estado.q.fromArray(salvo.q);
    definirV(salvo.v);
    if (salvo.epoca && salvo.epoca !== 'hoje') setTimeout(() => { $('selEpoca').value = salvo.epoca; aplicarEpoca(salvo.epoca, salvo.ma); }, 500);
    estado.nivelMar = salvo.nivel || 0;
    saltoRef = true;
  }
} catch { /* nada salvo */ }
// ------------------------------- óculos de realidade virtual -------------------------------
// Modo leve nos óculos: sem Terra em ladrilhos (em desenhar), atmosfera simples, sem a dobra (efeito de tela)
let antesVR = null;
function entrarVR() {
  antesVR = { atm: estado.atmFisica, efeito: estado.efeito };
  estado.atmFisica = false;
  if (estado.efeito === 'dobra') estado.efeito = 'relatividade';
  pintarVR();
  aviso('Óculos: modo leve (sem Terra em ladrilhos, atmosfera simples, sem a dobra).');
}
function sairVR() {
  if (antesVR) {
    estado.atmFisica = antesVR.atm;
    if (antesVR.efeito === 'dobra' && estado.efeito === 'relatividade') estado.efeito = 'dobra';
  }
  antesVR = null;
  pintarVR();
}
function pintarVR() {
  $('btAtm').textContent = estado.atmFisica ? 'Atmosfera: física' : 'Atmosfera: simples';
  $('btAtm').classList.toggle('ativo', estado.atmFisica);
  pintarEfeito();
}
function textoPainelVR() {
  const vel = velocidade(velMedida);
  const a = estado.alvo;
  const linhas = [
    vel.principal,
    a ? `Alvo: ${a.nome}` : 'Alvo: nenhum (aponte + gatilho direito)',
    a && a !== estado.embarcado ? `a ${distancia(Math.max(camAbs().distanceTo(a.abs) - (a.raio ?? 0), 0))}` : '',
    data(estado.jd),
    estado.embarcado ? `A bordo: ${estado.embarcado.nome} · A desembarca` : a && missoes.objetos.includes(a) ? 'A embarca · B vai até o alvo' : 'B vai até o alvo',
    performance.now() < avisoAte ? $('aviso').textContent : 'Gatilho esq. acelera · aperto freia · X para',
  ];
  return linhas;
}
// O que está na direção apontada: corpos, sondas, cometas e satélites primeiro; senão a estrela visível mais próxima
const _dirA = new THREE.Vector3();
function alvoNaDirecao(dir) {
  const abs = camAbs();
  let melhor = null, nota = Infinity;
  for (const c of [...CORPOS, ...missoes.objetos]) {
    if (c === estado.embarcado || !c.abs || (c.tipo === 'lua' && !luaVisivel(c, abs))) continue;
    if (c.tipo === 'satelite' && (!c.ativo || atrasDaTerra(abs, c.abs))) continue;
    const rel = _dirA.copy(c.abs).sub(abs), d = rel.length();
    if (!(d > (c.raio ?? 0) * 1.5)) continue; // de dentro (Via Láctea, borda do universo) não se aponta
    // distância angular até a borda do disco; um disco grande perde para um ponto pequeno apontado na frente dele
    const angR = Math.atan((c.raio ?? 0) / d), n = Math.max(rel.angleTo(dir) - angR, 0) / (3 * GRAU) + (angR > GRAU ? 0.3 : 0);
    if (n < 1 && n < nota) { nota = n; melhor = c; }
  }
  if (cat.n) {
    const dd = cat.dados, x = abs.x / PC, y = abs.y / PC, z = abs.z / PC, lim = 2 * GRAU, cosLim = Math.cos(lim);
    for (let i = 0; i < cat.n; i++) {
      const k = i * 5, dx = dd[k] - x, dy = dd[k + 1] - y, dz = dd[k + 2] - z, dist = Math.hypot(dx, dy, dz);
      if (!(dist > 0)) continue;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      if (cos < cosLim || dd[k + 3] + 5 * Math.log10(dist) - 5 > limiteMag()) continue;
      const n = Math.acos(Math.min(cos, 1)) / lim + 0.15;
      if (n < nota) { nota = n; melhor = i; }
    }
  }
  return typeof melhor === 'number' ? estrelaObj(melhor) : melhor;
}

let tAnterior = performance.now();
const ultimoLocal = new THREE.Vector3();
let luar = 0, velMedida = 0, freando = false, proximo = null, altProx = Infinity, altRef = Infinity, quadro = 0, diaNoCeu = 0;
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), eixoX = new THREE.Vector3(1, 0, 0), eixoY = new THREE.Vector3(0, 1, 0), eixoZ = new THREE.Vector3(0, 0, 1);
const _delta = new THREE.Quaternion(), velVetor = new THREE.Vector3(), betaVec = new THREE.Vector3();
// Mesma aberração dos shaders, para os rótulos acompanharem as estrelas
function aberrarJS(p) {
  const b = betaVec.length();
  if (b < 1e-4) return p;
  const L = p.length(), c = p.dot(betaVec) / (L * b);
  const c2 = (c + b) / (1 + b * c);
  const perp = _perp.copy(p).multiplyScalar(1 / L).addScaledVector(betaVec, -c / b);
  const pl = perp.length();
  if (pl < 1e-7) return p;
  return p.copy(betaVec).multiplyScalar(c2 / b).addScaledVector(perp, Math.sqrt(Math.max(1 - c2 * c2, 0)) / pl).multiplyScalar(L);
}
const _perp = new THREE.Vector3();

function medirProximo() {
  const abs = camAbs();
  const rf = estado.ref;
  altRef = rf ? estado.local.length() - (rf.malha ? raioSuperficie(rf, estado.local) : rf.raio) : Infinity;
  proximo = null; altProx = Infinity;
  for (const c of lista) {
    if (c.tipo === 'galaxia' || c.tipo === 'marco') continue;
    const alt = abs.distanceTo(c.abs) - c.raio;
    if (alt < altProx) { altProx = alt; proximo = c; }
  }
  if (proximo && (proximo.relevo || (proximo.id === 'terra' && terra.ativo))) {
    const rel = abs.sub(proximo.abs);
    altProx = rel.length() - raioSuperficie(proximo, rel);
  }
}

function passo() {
  const agora = performance.now();
  const dt = Math.min((agora - tAnterior) / 1000, 0.1);
  tAnterior = agora;
  quadro++;

  // Tempo da simulação e posições
  if (estado.orbitasMovem) estado.jd += (dt * estado.ritmo) / 86400;
  atualizarPosicoes(estado.jd);
  missoes.atualizar(estado.jd);
  satelites.atualizar(estado.jd);
  avisarMomentos();
  for (const o of orbitas) if (Math.abs(estado.jd - o.jd) > 3650) { criarOrbitas(estado.jd); break; }

  // Perto da superfície, a câmera gira junto com o corpo (como quem está no chão)
  const r = estado.ref;
  if (r && estado.giraJunto && r.malha && r.tipo !== 'estrela' && (estado.pousado || altRef < r.raio * 1.5)) {
    _delta.copy(r.qOri).multiply(tmpQ.copy(r.qOriAnt).invert());
    estado.local.applyQuaternion(_delta);
    ultimoLocal.applyQuaternion(_delta);
    if (!(estado.telescopio && estado.rastrear)) estado.q.premultiply(_delta); // o motor do telescópio acompanha as estrelas
  }
  // a bordo de um satélite, a vista acompanha a órbita (a estação mantém a Terra embaixo, como a ISS de verdade)
  const sb = estado.embarcado;
  if (sb && sb.tipo === 'satelite' && sb.ativo) {
    const x = _lvX.copy(sb.abs).sub(PORID.terra.abs).normalize();
    const y = equatorialParaCena(sb.velEq.x, sb.velEq.y, sb.velEq.z, _lvY);
    y.addScaledVector(x, -y.dot(x)).normalize();
    _lvM.makeBasis(x, y, _lvZ.crossVectors(x, y));
    const qAgora = tmpQ.setFromRotationMatrix(_lvM);
    if (sb.qLv && estado.giraJunto) {
      _delta.copy(qAgora).multiply(sb.qLv.invert());
      if (Number.isFinite(_delta.w)) estado.q.premultiply(_delta);
    }
    (sb.qLv ??= new THREE.Quaternion()).copy(qAgora);
  }

  if (mouse.roda) { if (estado.telescopio) definirZoom(estado.zoom * 1.18 ** -mouse.roda); else definirV(estado.v * 1.25 ** -mouse.roda); mouse.roda = 0; }

  // Rotação: mouse e teclas
  const ex = eixos();
  const mvVR = vr.entrada(dt, estado.q);
  if (mvVR.frente || mvVR.lado) { ex.frente = mvVR.frente; ex.lado = mvVR.lado; }
  const giro = 1.4 * dt * (estado.telescopio ? 1 / estado.zoom : 1); // no telescópio, as setas movem devagar
  if (mouse.dx || mouse.dy) {
    const k = (camera.fov * GRAU) / innerHeight;
    estado.q.multiply(tmpQ.setFromAxisAngle(eixoY, -mouse.dx * k));
    estado.q.multiply(tmpQ.setFromAxisAngle(eixoX, -mouse.dy * k));
    mouse.dx = mouse.dy = 0;
    if (estado.piloto) estado.piloto.olharLivre = true;
  }
  if (ex.guinada) estado.q.multiply(tmpQ.setFromAxisAngle(eixoY, ex.guinada * giro));
  if (ex.arfagem) estado.q.multiply(tmpQ.setFromAxisAngle(eixoX, ex.arfagem * giro));
  if (ex.rolagem) estado.q.multiply(tmpQ.setFromAxisAngle(eixoZ, ex.rolagem * giro));
  estado.q.normalize();
  if (!Number.isFinite(estado.q.x + estado.q.y + estado.q.z + estado.q.w)) estado.q.identity(); // nunca fica preso num valor inválido
  if (!Number.isFinite(estado.local.x + estado.local.y + estado.local.z)) estado.local.set(0, 0, 1000);

  medirProximo();
  const abs = camAbs();

  // Movimento
  freando = false;
  const p = estado.piloto;
  if (p && p.modo === 'tempo') {
    p.t += dt;
    const u = Math.min(p.t / p.dur, 1);
    const e = u * u * (3 - 2 * u);
    const d = p.d0 > p.d1 ? p.d0 * (p.d1 / p.d0) ** e : p.d0 + (p.d1 - p.d0) * e;
    const virar = Math.min(Math.max((u - 0.55) / 0.45, 0), 1);
    const dir = p.dir0.clone().lerp(p.dir1, virar * virar * (3 - 2 * virar)).normalize();
    estado.local.copy(dir).multiplyScalar(d);
    if (!p.olharLivre) estado.q.slerp(quatOlhando(dir.clone().negate(), tmpQ), 1 - Math.exp(-dt * 4));
    if (u >= 1) estado.piloto = null;
  } else if (p && p.modo === 'vel') {
    const alvoAbs = p.alvo.abs;
    const deAlvo = abs.clone().sub(alvoAbs);
    const chegada = alvoAbs.clone().addScaledVector(deAlvo, distChegada(p.alvo) / deAlvo.length());
    const rumo = chegada.clone().sub(abs);
    const resta = rumo.length();
    const freioMax = resta * (1 - Math.exp(-dt * 2.5));
    let passoKm = estado.v * dt;
    if (passoKm > freioMax) { passoKm = freioMax; freando = true; }
    estado.local.addScaledVector(rumo, passoKm / resta);
    if (!p.olharLivre) estado.q.slerp(quatOlhando(alvoAbs.clone().sub(abs), tmpQ), 1 - Math.exp(-dt * 3));
    p.resta = resta;
    if (resta < Math.max(distChegada(p.alvo) * 0.01, 0.01)) { estado.piloto = null; mudarRef(p.alvo); }
  } else if (p && p.modo === 'pouso') {
    p.t += dt;
    const u = Math.min(p.t / p.dur, 1);
    const e = u * u * (3 - 2 * u);
    const alt = p.alt0 * (ALTURA_OLHO / p.alt0) ** e;
    const dir = p.dirCorpo.clone().applyQuaternion(p.alvo.qOri);
    estado.local.copy(dir).multiplyScalar(raioSuperficie(p.alvo, dir) + alt);
    // Termina olhando o horizonte
    const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
    let tang = fr.clone().addScaledVector(dir, -fr.dot(dir));
    if (tang.lengthSq() < 1e-8) {
      const cima = new THREE.Vector3(0, 1, 0).applyQuaternion(estado.q);
      tang = cima.addScaledVector(dir, -cima.dot(dir));
    }
    const olhar = tang.normalize().addScaledVector(dir, -0.03);
    if (!p.olharLivre) estado.q.slerp(quatOlhando(olhar, tmpQ, dir), 1 - Math.exp(-dt * 2.2));
    if (u >= 1) {
      estado.piloto = null; estado.pousado = p.alvo; if (estado.vAntes === undefined) estado.vAntes = estado.v; definirV(5 / 3600);
      aviso(p.lugar ? `Pouso em ${p.lugar.nome}. Ande com as setas; R para decolar; Z para olhar o céu.` : `Pouso ${com('em', p.alvo)}. Ande com as setas; R para decolar.`);
      if (p.depois === 'ceu') olharCeu();
    }
  } else if (p && p.modo === 'lugar') {
    p.t += dt;
    const u = Math.min(p.t / p.dur, 1), e = u * u * (3 - 2 * u);
    const T = p.alvo;
    const dirAlvo = p.dirLocal.clone().applyQuaternion(T.qOri);
    const w = Math.min(u / 0.8, 1), ws = w * w * (3 - 2 * w);
    const dir = p.dir0.clone().applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(p.dir0, dirAlvo), ws));
    const d1 = raioSuperficie(T, dirAlvo) + p.altFinal;
    const d = p.d0 > d1 ? p.d0 * (d1 / p.d0) ** e : p.d0 + (d1 - p.d0) * e;
    estado.local.copy(dir).multiplyScalar(d);
    const pontoW = p.lugar.dir.clone().applyQuaternion(T.qOri);
    pontoW.multiplyScalar(raioSuperficie(T, pontoW));
    if (!p.olharLivre) estado.q.slerp(quatOlhando(pontoW.sub(estado.local), tmpQ, dir), u >= 1 ? 1 : 1 - Math.exp(-dt * (3 + 14 * u * u)));
    if (u >= 1) {
      estado.piloto = null; estado.ultimoLugar = p.lugar; aviso(`${p.lugar.nome}${p.lugar.pais ? `, ${p.lugar.pais}` : ''}`);
      if (p.depois) { // desce até o chão bem no lugar
        const alt0 = estado.local.length() - raioSuperficie(T, estado.local);
        estado.piloto = { modo: 'pouso', alvo: T, t: 0, dur: 3 + Math.log10(Math.max(alt0, 0.01) / ALTURA_OLHO) * 0.8, alt0: Math.max(alt0, ALTURA_OLHO * 2), dirCorpo: p.lugar.dir.clone(), depois: p.depois, lugar: p.lugar };
      }
    }
  } else if (estado.aviao && estado.ref && estado.ref.malha && estado.ref.tipo !== 'estrela' && altRef < 300) {
    // Avião: anda no plano horizontal e acompanha o relevo na altitude escolhida
    const up = estado.local.clone().normalize();
    if (ex.frente) estado.altAviao = Math.min(Math.max(estado.altAviao * (1 + ex.frente * 0.9 * dt), 0.03), 300);
    const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
    fr.addScaledVector(up, -fr.dot(up));
    if (fr.lengthSq() > 1e-8) estado.local.addScaledVector(fr.normalize(), estado.v * dt);
    const dAv = estado.local.clone().normalize();
    const chao = raioSuperficie(estado.ref, dAv);
    let rAv = estado.local.length();
    rAv += (chao + estado.altAviao - rAv) * (1 - Math.exp(-dt * 1.2));
    estado.local.copy(dAv).multiplyScalar(Math.max(rAv, chao + 0.02));
  } else if (estado.pousado) {
    // Caminhada: anda no plano do chão e acompanha o relevo
    const c = estado.pousado;
    if (ex.vertical > 0 || estado.ref !== c) { estado.pousado = null; restaurarV(); }
    else {
      const up = estado.local.clone().normalize();
      const frente = estado.cruzeiro ? 1 : ex.frente;
      if (frente || ex.lado) {
        const v = estado.freio ? Math.min(estado.v, 0.05) : estado.v;
        if (v < estado.v) freando = true;
        const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
        const di = new THREE.Vector3(1, 0, 0).applyQuaternion(estado.q);
        fr.addScaledVector(up, -fr.dot(up)).normalize();
        di.addScaledVector(up, -di.dot(up)).normalize();
        estado.local.addScaledVector(fr, frente * v * dt).addScaledVector(di, ex.lado * v * dt);
      }
      const d = estado.local.clone().normalize();
      // quando chega um ladrilho mais detalhado, a altura do chão muda: acompanha suavemente (sobe rápido, desce devagar)
      const alvoR = raioSuperficie(c, d) + ALTURA_OLHO, rAt = estado.local.length();
      const novoR = rAt + (alvoR - rAt) * (1 - Math.exp(-dt * (alvoR > rAt ? 12 : 2.5)));
      estado.local.copy(d).multiplyScalar(Math.max(novoR, alvoR - 0.01));
    }
  } else {
    const frente = estado.cruzeiro ? 1 : ex.frente;
    if (frente || ex.lado || ex.vertical) {
      let v = estado.v;
      if (estado.freio && proximo && v > altProx * 0.9) { v = Math.max(altProx * 0.9, 0.0005); freando = true; }
      tmpV.set(ex.lado, ex.vertical, -frente).normalize().applyQuaternion(vr.ativo ? vr.qOlhar() : estado.q); // nos óculos, para onde se olha
      estado.local.addScaledVector(tmpV, v * dt);
    }
  }

  // Não atravessar superfícies
  if (proximo && !(p && p.modo === 'pouso')) {
    const rel = camAbs().sub(proximo.abs);
    const minimo = raioSuperficie(proximo, rel) + (proximo.tipo === 'estrela' ? 2000 : GASOSOS.includes(proximo.id) ? 50 : ALTURA_OLHO);
    if (rel.length() < minimo) {
      rel.setLength(minimo);
      camAbs(tmpV);
      estado.local.add(proximo.abs.clone().add(rel).sub(tmpV));
    }
  }

  // Nivelar com o horizonte perto de um corpo
  if (estado.nivelar && estado.ref && estado.ref.tipo !== 'estrela' && altRef < estado.ref.raio * 2 && !(p && p.modo !== 'pouso')) {
    const up = estado.local.clone().normalize();
    const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
    if (Math.abs(fr.dot(up)) < 0.98) {
      const desejado = up.clone().addScaledVector(fr, -fr.dot(up)).normalize();
      const atual = new THREE.Vector3(0, 1, 0).applyQuaternion(estado.q);
      const ang = Math.atan2(fr.dot(new THREE.Vector3().crossVectors(atual, desejado)), atual.dot(desejado));
      estado.q.premultiply(tmpQ.setFromAxisAngle(fr, ang * (1 - Math.exp(-dt * 3))));
    }
  }

  if (estado.embarcado) { if (estado.ref !== estado.embarcado) mudarRef(estado.embarcado); }
  else if (!estado.piloto || estado.piloto.modo === 'vel') escolherRef();

  // Velocidade medida em relação ao referencial
  if (!saltoRef && dt > 0) {
    const inst = estado.local.distanceTo(ultimoLocal) / dt;
    if (inst === 0) velMedida = velMedida < 1e-6 ? 0 : velMedida * 0.6;
    else { velMedida += (inst - velMedida) * (1 - Math.exp(-dt * 10)); velVetor.subVectors(estado.local, ultimoLocal).normalize(); }
  }
  saltoRef = false;
  ultimoLocal.copy(estado.local);

  // Dobra (acima da luz) e som
  const alvoW = estado.efeito === 'dobra' && !vr.ativo ? Math.min(Math.max(Math.log10(Math.max(velMedida, 1e-9) / C) / 2.5, 0), 1) : 0;
  const ev = atualizarDobra(alvoW, tmpV.copy(velVetor).applyQuaternion(tmpQ.copy(estado.q).invert()), dt);
  if (ev) { clarao(); somDobra(ev === 'entrou'); }
  // Relatividade: velocidade como fração de c (acima de c, mostra como se fosse 99,5% de c)
  const bAlvo = estado.efeito === 'relatividade' ? Math.min(velMedida / C, 0.995) : 0;
  betaVec.lerp(tmpV.copy(velVetor).multiplyScalar(bAlvo), 1 - Math.exp(-dt * 6));
  if (betaVec.lengthSq() < 1e-10) betaVec.set(0, 0, 0);
  let dentroAtm = 0;
  if (estado.ref && estado.ref.atm && altRef < estado.ref.raio * estado.ref.atm[3]) dentroAtm = 1 - altRef / (estado.ref.raio * estado.ref.atm[3]);
  atualizarSom(velMedida, velMedida / Math.max(altProx, 1e-6), dentroAtm);
  const dSol = camAbs().distanceTo(PORID.sol.abs);
  estadoSom.regiao = dSol < 0.1 * AL ? 'sistema' : dSol < 3000 * AL ? 'interestelar' : 'galactico';

  desenhar();
  if (quadro % 6 === 0) painel();
  if (quadro % 30 === 0) { atualizarVagas(); escolherRotulosEstrelas(); }
}

// Mesma rotação por oitava usada no shader (GLSL guarda a matriz por colunas)
const GIRO = new THREE.Matrix3().set(0.36, -0.8, 0.48, 0.48, 0.6, 0.64, -0.8, 0, 0.6);
const camAltoPc = new THREE.Vector3(), camBaixoPc = new THREE.Vector3();
const _relT = new THREE.Vector3(), _camT = new THREE.Vector3(), _luzT = new THREE.Vector3();
const projetado = new THREE.Vector3(), polo = new THREE.Vector3(), _cb = new THREE.Vector3(), _oc = new THREE.Vector3(), _m4 = new THREE.Matrix4();
function desenhar() {
  const abs = camAbs();
  if (vr.ativo) { vr.rig.quaternion.copy(estado.q); vr.rig.updateMatrixWorld(true); } // a cabeça gira por conta própria dentro do suporte
  else {
    camera.quaternion.copy(estado.q);
    const fov = estado.telescopio ? 60 / estado.zoom : 60;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }
  const qVista = vr.ativo ? vr.qOlhar() : camera.quaternion;
  const pxPorRad = vr.ativo ? vr.pxPorRad() / renderer.getPixelRatio() : innerHeight / (camera.fov * GRAU);
  const sol = PORID.sol;
  const rotulosPostos = [];

  // Céu diurno: se estamos dentro de uma atmosfera iluminada, as estrelas somem
  diaNoCeu = 0;
  luar = 0;
  const ra = estado.ref;
  if (ra && ra.atm) {
    const rel = abs.clone().sub(ra.abs);
    const alt = rel.length() - ra.raio, esp = ra.raio * ra.atm[3];
    if (alt < esp) {
      const dens = (1 - Math.max(alt, 0) / esp) ** 2;
      const elev = rel.normalize().dot(sol.abs.clone().sub(ra.abs).normalize());
      diaNoCeu = dens * Math.min(Math.max((elev + 0.2) / 0.2, 0), 1); // estrelas só depois que o Sol se põe (as primeiras com ele ~4° abaixo)
      // Luar: a Lua acima do horizonte, conforme a fase, clareia o céu e apaga as estrelas fracas e a Via Láctea
      if (ra.id === 'terra') {
        const L = PORID.lua, up = rel; // rel já está normalizado
        const vL = L.abs.clone().sub(abs).normalize(), altL = vL.dot(up);
        if (altL > 0) {
          const fase = (1 + L.abs.clone().sub(sol.abs).normalize().negate().dot(abs.clone().sub(L.abs).normalize())) / 2;
          luar = dens * fase ** 3 * Math.min(altL * 4, 1) * (1 - diaNoCeu);
        }
      }
    }
  }

  // Terra em ladrilhos: liga abaixo de 3 raios de altitude (com a aparência "fotos")
  const T = PORID.terra;
  const relT = _relT.copy(T.abs).sub(abs);
  const altT = relT.length() - T.raio;
  terra.ativo = estado.texturas && altT < T.raio * 3 && estado.epocaMa === 0 && !vr.ativo; // nos óculos, modo leve: sem ladrilhos
  const oclusor = estado.ref && estado.ref.malha ? estado.ref : estado.ref?.tipo === 'satelite' ? PORID.terra : null; // a bordo de satélite, a Terra esconde o que está atrás
  if (oclusor) _oc.copy(oclusor.abs).sub(abs);
  const corpoQuadro = (c, i) => {
    const rel = tmpV.copy(c.abs).sub(abs);
    const d = rel.length();
    const s = comprimir(d);
    const diamPx = (2 * Math.atan(c.raio / Math.max(d, c.raio * 1.0001))) * pxPorRad;
    const visivel = luaVisivel(c, abs);

    if (c.malha) {
      const u = c.malha.material.uniforms;
      aberrarJS(c.malha.position.copy(rel).multiplyScalar(s));
      c.malha.scale.setScalar(c.raio * s);
      c.malha.quaternion.copy(c.qOri);
      c.malha.visible = diamPx > 0.5;
      const luz = u.luz.value.copy(sol.abs).sub(c.abs).normalize();
      u.kmPorUnidade.value = 1 / s;
      u.exagero.value = estado.exagero;
      u.usarTextura.value = estado.texturas ? 1 : 0;
      u.detalhe.value = c.rochoso && estado.inventado ? 1 : 0;
      u.exposicao.value = c.id === 'lua' && diaNoCeu < 1 && ra && ra.id === 'terra' && d > c.raio * 20 ? 3.2 : 1; // vista do chão à noite, a Lua brilha como de verdade
      u.polo.value.copy(polo.set(0, 1, 0).applyQuaternion(c.qOri));
      if (c.rochoso && d - c.raio < 3000) {
        // Posição da câmera no corpo, reduzida ao período do ruído em cada oitava (precisão dupla)
        const inv = tmpQ.copy(c.qOri).invert();
        u.paraCorpo.value.setFromMatrix4(_m4.makeRotationFromQuaternion(inv));
        const cb = _cb.copy(abs).sub(c.abs).applyQuaternion(inv);
        let k = 1 / 40;
        for (const o of u.camOct.value) {
          o.set(((cb.x * k) % 289 + 289) % 289, ((cb.y * k) % 289 + 289) % 289, ((cb.z * k) % 289 + 289) % 289);
          cb.applyMatrix3(GIRO);
          k *= 2;
        }
      }
      if (c.atmMalha) {
        const fis = estado.atmFisica && c.atmFis;
        if (c.atmFis) c.atmMalha.material = fis ? c.atmFis.mat : c.atmSimples;
        const au = c.atmMalha.material.uniforms;
        const fator = fis ? c.atmFis.topo : 1 + c.atm[3];
        c.atmMalha.position.copy(c.malha.position);
        c.atmMalha.scale.setScalar(c.raio * fator * s);
        c.atmMalha.visible = c.malha.visible;
        const dentro = d < c.raio * fator;
        au.luar.value = c.id === 'terra' ? luar : 0;
        if (!fis) {
          au.dentro.value = dentro ? 1 : 0;
          au.densidade.value = dentro ? (1 - Math.max(d - c.raio, 0) / (c.raio * c.atm[3])) ** 2 : 1;
        }
        c.atmMalha.material.side = dentro ? THREE.BackSide : THREE.FrontSide;
        au.luz.value.copy(luz);
        au.centro.value.copy(c.malha.position);
        if (fis) {
          // por dentro, a casca de trás fica atrás do chão: desliga o teste de profundidade e o shader para o raio no chão
          c.atmMalha.material.depthTest = !dentro;
          au.raioR.value = c.raio * s;
          // olho adaptado: no chão, o céu é a cena toda (exposição maior); do espaço, o planeta iluminado domina
          const noChao = Math.min(Math.max(1 - (d - c.raio) / 60, 0), 1);
          const eSol = _lvZ.copy(c.malha.position).negate().normalize().dot(luz); // altura do Sol vista daqui (seno)
          const crepusculo = 1 - THREE.MathUtils.smoothstep(eSol, -0.1, 0.35); // no fim da tarde a pupila abre
          au.exposicao.value = 1 + noChao * (2 + 6 * crepusculo);
        }
      }
      if (c.id === 'terra' && terra.ativo) c.malha.scale.setScalar((c.raio - 6) * s); // esfera de base sob os ladrilhos
      if (c.nuvMalha) {
        c.nuvMalha.material.uniforms.opac.value = c.id === 'terra' ? Math.min(Math.max((d - c.raio - 15) / 60, 0), 1) : 1;
        c.nuvMalha.position.copy(c.malha.position);
        c.nuvMalha.scale.setScalar((c.raio + 8) * s);
        c.nuvMalha.quaternion.copy(c.qOri).multiply(tmpQ.setFromAxisAngle(eixoY, ((estado.jd % 400) / 400) * 2 * Math.PI));
        c.nuvMalha.visible = c.malha.visible && estado.texturas && estado.epocaMa === 0 && !estado.gelo && !estado.ceuModo;
        c.nuvMalha.material.uniforms.luz.value.copy(luz);
      }
      if (c.anelMalha) {
        const au = c.anelMalha.material.uniforms;
        c.anelMalha.position.copy(c.malha.position);
        c.anelMalha.scale.setScalar(c.raio * s);
        c.anelMalha.quaternion.copy(c.base.quat);
        c.anelMalha.visible = diamPx > 0.2;
        au.luz.value.copy(luz);
        au.centro.value.copy(c.malha.position);
        au.raioP.value = c.raio * s;
      }
    }

    // Brilho / marcador, posto na frente da superfície para não ser escondido pelo próprio corpo
    const frente = d > c.raio ? (d - c.raio * 1.001) / d : 0;
    projetado.copy(rel).multiplyScalar(frente * comprimir(d * frente));
    projetado.toArray(posB, i * 3);
    let tam = 0, alfa = 0;
    if (c.lum) {
      const dpc = Math.max(d / PC, 1e-12);
      const mag = 4.83 - 2.5 * Math.log10(c.lumV ?? c.lum) + 5 * Math.log10(dpc) - 5;
      const brilho = 10 ** (-0.4 * (mag - 6.5));
      tam = Math.min(Math.max(2.2 * brilho ** 0.22, 1.5), 90);
      alfa = Math.min(Math.max(brilho, 0.08), 1);
      if (c.tipo === 'galaxia') { tam = diamPx < 8 ? Math.max(3, diamPx) : 0; alfa = 0.7 * (1 - diamPx / 8); }
      else if (c.tipo === 'marco') { tam = Math.min(Math.max(tam, 3), 10); alfa = Math.max(alfa, 0.6); }
      else tam = Math.max(tam, diamPx * 2.6);
      if (c !== sol && c.id !== 'lua') alfa *= (1 - diaNoCeu) * (1 - 0.5 * luar);
    } else if (diamPx < 4 && visivel) {
      tam = 4; alfa = 0.9 * (1 - diaNoCeu);
    }
    if (c.id === 'lua' && luar > 0) { tam = Math.max(tam, diamPx * 4); alfa = Math.max(alfa, 0.55 * luar); } // halo do luar
    tamB[i] = tam; alfaB[i] = alfa;

    // Rótulo
    const el = c.rotulo;
    let mostrar = (estado.nomes && visivel && nomeFazSentido(c, abs)) || c === estado.alvo;
    if (mostrar && c === estado.ref && d < c.raio * (c.id === 'terra' ? 5 : 1.2)) mostrar = false; // perto, sem o nome do próprio corpo (na Terra, os nomes são dos lugares)
    if (mostrar && c.tipo === 'galaxia' && d < c.raio * 1.5 && c !== estado.alvo) mostrar = false; // dentro da galáxia
    if (mostrar && diaNoCeu > 0.5 && c !== sol && c.id !== 'lua' && c.tipo !== 'planeta' && c !== estado.alvo && c !== estado.ref) mostrar = false; // de dia, só o que se vê de dia
    if (mostrar && oclusor && c !== oclusor) {
      // escondido atrás do corpo em que estamos?
      const t = _oc.dot(rel) / d;
      if (t > 0 && t < d && _oc.lengthSq() - t * t < oclusor.raio * oclusor.raio) mostrar = false;
    }
    if (mostrar) {
      aberrarJS(projetado.copy(rel).multiplyScalar(s)).applyMatrix4(camera.matrixWorldInverse);
      if (projetado.z >= 0) mostrar = false;
      else {
        projetado.applyMatrix4(camera.projectionMatrix);
        const x = (projetado.x * 0.5 + 0.5) * innerWidth;
        const y = (-projetado.y * 0.5 + 0.5) * innerHeight;
        const px = x + Math.max(diamPx / 2, 0) * 0.7, py = y;
        if (px < -50 || px > innerWidth + 10 || py < -20 || py > innerHeight + 20) mostrar = false;
        else {
          const w = c.nome.length * 6.5 + 12;
          const caixa = [px, py - 8, px + w, py + 8];
          const prioridade = c === estado.alvo || c === estado.ref;
          if (!prioridade && rotulosPostos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) mostrar = false;
          else {
            rotulosPostos.push(caixa);
            el.style.left = `${px}px`;
            el.style.top = `${py}px`;
          }
        }
      }
    }
    el.style.display = mostrar ? '' : 'none';
    el.classList.toggle('alvo', c === estado.alvo || (c.hyg !== undefined && c.hyg === estado.alvo?.hyg));
  };
  CORPOS.forEach(corpoQuadro);
  vagas.forEach((v, j) => {
    if (v.obj) return corpoQuadro(v.obj, CORPOS.length + j);
    v.malha.visible = false;
    tamB[CORPOS.length + j] = 0;
    v.rotulo.style.display = 'none';
  });

  // Rótulos das estrelas brilhantes (depois dos corpos, que têm prioridade)
  rotulosCeu.forEach((el) => {
    const o = el.corpo;
    let mostrar = !!o && (estado.nomes || o.hyg === estado.alvo?.hyg) && diaNoCeu < 0.5;
    if (mostrar) {
      projetado.copy(o.abs).sub(abs);
      const d = projetado.length();
      if (oclusor) {
        const t = _oc.dot(projetado) / d;
        if (t > 0 && t < d && _oc.lengthSq() - t * t < oclusor.raio * oclusor.raio) mostrar = false;
      }
      aberrarJS(projetado.multiplyScalar(comprimir(d))).applyMatrix4(camera.matrixWorldInverse);
      if (mostrar && projetado.z < 0) {
        projetado.applyMatrix4(camera.projectionMatrix);
        const px = (projetado.x * 0.5 + 0.5) * innerWidth + 4, py = (-projetado.y * 0.5 + 0.5) * innerHeight;
        const caixa = [px, py - 8, px + o.nome.length * 6.5 + 12, py + 8];
        if (px < -50 || px > innerWidth || py < 0 || py > innerHeight || rotulosPostos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) mostrar = false;
        else { rotulosPostos.push(caixa); el.style.left = `${px}px`; el.style.top = `${py}px`; }
      } else mostrar = false;
    }
    el.style.display = mostrar ? '' : 'none';
    el.classList.toggle('alvo', !!o && o.hyg === estado.alvo?.hyg);
  });

  const sT = comprimir(relT.length());
  const camLocal = _camT.copy(relT).negate().applyQuaternion(_qi.copy(T.qOri).invert());
  relT.multiplyScalar(sT);
  if (terra.ativo) terra.atualizar(camLocal, relT, T.qOri, _luzT.copy(sol.abs).sub(T.abs).normalize(), estado.exagero, estado.atmFisica ? 0 : Math.min(Math.max(1.2 - altT / 300, 0), 1), estado.nivelMar / 1000, estado.gelo ? 1 : 0, camera, estado.ceuModo, estado.ceuModo);
  else terra.esconder();
  if (camadas) {
    camadas.atualizar(camLocal, relT, T.qOri, sT, camera, rotulosPostos,
      estado.epocaMa || estado.gelo || estado.ceuModo ? { cidades: 'nenhuma', fronteiras: false, nomes: false, picos: false } // camadas de hoje não valem no passado nem no céu
        : { cidades: estado.nomes ? estado.cidades : 'nenhuma', fronteiras: estado.fronteiras, nomes: estado.nomes && estado.nomesTerra, picos: estado.nomes && estado.picos },
      (dir) => (terra.ativo ? terra.altura(dir, estado.nivelMar / 1000) * estado.exagero : 0));
  }
  desenharCeu(abs, rotulosPostos);
  desenharMissoes(abs, rotulosPostos, pxPorRad);
  $('pTerra').style.display = altT < T.raio * 10 && !document.body.classList.contains('foto') ? '' : 'none';
  $('creditos').textContent = terra.ativo ? (estado.ceuModo ? 'Terreno: EOX/Sentinel-2 · NASA · Mapzen/AWS · Natural Earth (créditos completos no manual)' : CREDITOS) : '';

  // Bolha do rádio (centrada na Terra); escala escolhida para caber inteira na profundidade
  const rb = raioBolha();
  const relB = tmpV.copy(PORID.terra.abs).sub(abs);
  const dB = relB.length();
  bolha.visible = estado.bolha && rb > 0 && dB > 0.02 * AL;
  if (bolha.visible) {
    const sB = comprimir(dB + rb);
    bolha.position.copy(relB).multiplyScalar(sB);
    bolha.scale.setScalar(rb * sB);
    // de dentro, só aparece perto da borda; de fora, inteira
    const perto = dB < rb ? Math.min(Math.max((dB / rb - 0.85) / 0.15, 0), 1) : 1;
    bolha.material.uniforms.forca.value = 0.6 * perto * (1 - diaNoCeu);
  }
  const agoraDentro = dB < rb;
  if (agoraDentro !== dentroBolha && rb > 0) {
    aviso(agoraDentro ? 'De volta à bolha do rádio: aqui já chegam as transmissões humanas.' : `Você saiu da bolha do rádio: nenhum sinal humano chegou aqui ainda (${Math.round(rb / AL)} anos-luz da Terra).`);
    dentroBolha = agoraDentro;
  }

  // Câmera em parsecs, partida em parte alta + baixa (precisão dupla emulada nos shaders)
  for (const k of ['x', 'y', 'z']) {
    const v = abs[k] / PC, alto = Math.fround(v);
    camAltoPc[k] = alto;
    camBaixoPc[k] = v - alto;
  }
  brilhos.material.uniforms.beta.value.copy(betaVec);
  if (mrs) mrs.visible = true;
  // Perto do Sol, a Via Láctea vem do mapa do céu; longe, do modelo em partículas (transição entre 300 e 1.500 pc)
  const dSolPc = abs.distanceTo(sol.abs) / PC;
  const fCeu = gal.ceuVia.material.uniforms.mapa.value ? 1 - Math.min(Math.max((dSolPc - 300) / 1200, 0), 1) : 0;
  gal.ceuVia.visible = fCeu > 0;
  gal.ceuVia.scale.setScalar(5e10);
  gal.ceuVia.material.uniforms.forca.value = 0.85 * fCeu * (1 - diaNoCeu) * (1 - 0.85 * luar);
  gal.ceuVia.material.uniforms.beta.value.copy(betaVec);
  gal.brilho.material.uniforms.ganho.value = 3.2 * (1 - fCeu);
  gal.poeira.material.uniforms.ganho.value = 1 - fCeu;
  for (const nv of [gal.brilho, gal.poeira, gal.campo, mrs].filter(Boolean)) {
    nv.material.uniforms.beta.value.copy(betaVec);
    const u = nv.material.uniforms;
    u.camAlto.value.copy(camAltoPc);
    u.camBaixo.value.copy(camBaixoPc);
    u.pxPorRad.value = pxPorRad;
    u.escalaPx.value = renderer.getPixelRatio();
    u.apagar.value = Math.max(diaNoCeu, luar * 0.85);
  }
  gal.campo.visible = estado.ilustrativas;
  for (const c of gal.planos) {
    const rel = tmpV.copy(c.abs).sub(abs);
    const d = rel.length(), sG = comprimir(d);
    const diam = (2 * c.raio / d) * pxPorRad;
    c.plano.visible = diam > 2;
    if (!c.plano.visible) continue;
    aberrarJS(c.plano.position.copy(rel).multiplyScalar(sG));
    c.plano.scale.setScalar(c.raio * sG);
    c.plano.quaternion.copy(c.plano.userData.quat ?? qVista);
    // do chão, as galáxias são manchas tênues (brilho de superfície baixo): o desenho fica bem apagado
    const doChao = estado.ceuModo ? 0.16 * (1 - luar * 0.85) : 1;
    c.plano.material.color.setScalar(0.9 * doChao * (c.brilhoPlano ?? 1) * (1 - diaNoCeu) * Math.min(1, (diam - 2) / 6));
  }
  const relBorda = tmpV.copy(PORID.terra.abs).sub(abs);
  const rBorda = PORID.borda.dist, dBorda = relBorda.length();
  const fB = Math.min(Math.max((dBorda / AL - 1e9) / 1.9e10, 0), 1);
  gal.borda.visible = fB > 0;
  if (gal.borda.visible) {
    const sB = comprimir(dBorda + rBorda);
    gal.borda.position.copy(relBorda).multiplyScalar(sB);
    gal.borda.scale.setScalar(rBorda * sB);
    gal.borda.material.uniforms.forca.value = 0.55 * fB;
  }

  if (ceu) {
    const u = ceu.material.uniforms;
    u.beta.value.copy(betaVec);
    u.camAlto.value.copy(camAltoPc);
    u.camBaixo.value.copy(camBaixoPc);
    u.limite.value = limiteMag();
    u.limiteTam.value = Math.min(limiteMag(), (estado.ceuRealcado ? 9.5 : 6.5) + 1.5);
    u.apagar.value = Math.max(diaNoCeu, luar * 0.6);
  }
  geoBrilho.attributes.position.needsUpdate = true;
  geoBrilho.attributes.tamanho.needsUpdate = true;
  geoBrilho.attributes.alfa.needsUpdate = true;

  // Cinturões: só perto do Sistema Solar
  const solRel = tmpV.copy(sol.abs).sub(abs);
  const verCint = estado.cinturoes && solRel.length() < 2000 * UA;
  for (const ci of cinturoes) {
    ci.visible = verCint;
    const u = ci.material.uniforms;
    u.solRel.value.copy(solRel);
    u.dias.value = estado.jd - 2451545;
    u.beta.value.copy(betaVec);
    // de dentro do Sistema Solar interno os cinturões ficam discretos; de longe aparecem inteiros
    u.alfa.value = ci.userData.alfa * (1 - diaNoCeu) * Math.min(Math.max((solRel.length() / UA - 1.2) / 8, 0.1), 1) * Math.min(1, (15 / Math.max(solRel.length() / UA, 1)) ** 1.5); // de muito longe, quase invisíveis
  }

  for (const o of orbitas) {
    o.linha.visible = estado.linhas && luaVisivel(o.corpo, abs);
    if (!o.linha.visible) continue;
    const arr = o.linha.geometry.attributes.position.array;
    const base = o.corpo.paiObj.abs;
    for (let k = 0; k < o.pts.length; k++) {
      tmpV.copy(base).add(o.pts[k]).sub(abs);
      aberrarJS(tmpV.multiplyScalar(comprimir(tmpV.length()))).toArray(arr, k * 3);
    }
    o.linha.geometry.attributes.position.needsUpdate = true;
    o.linha.material.opacity = (o.corpo.tipo === 'lua' ? 0.22 : 0.3) * (1 - diaNoCeu);
  }

  vr.desenhar();
  renderer.render(cena, camera);
}

// Quando partiu da Terra a luz que chega aqui agora, e o que acontecia na Terra nessa época
const ERAS = [
  [1990, 'a era da internet'], [1957, 'a era espacial'], [1914, 'as guerras mundiais'], [1760, 'a Revolução Industrial'],
  [1500, 'as Grandes Navegações'], [476, 'a Idade Média'], [-27, 'o Império Romano'], [-800, 'a Grécia antiga'],
  [-3200, 'as primeiras civilizações, com a escrita'], [-10000, 'o início da agricultura'], [-300000, 'a Pré-História do Homo sapiens'],
  [-2.6e6, 'os primeiros humanos e suas ferramentas de pedra'], [-66e6, 'a era dos mamíferos, logo depois dos dinossauros'],
  [-252e6, 'a era dos dinossauros'], [-541e6, 'a explosão da vida complexa nos mares'], [-2.4e9, 'a vida só microscópica'],
  [-4.54e9, 'a Terra recém-formada'],
];
// Distância comóvel → tempo de viagem da luz (o universo se expandiu no caminho). Tabela calculada uma vez.
const COSMO = (() => {
  const H0 = 67.7, Om = 0.31, OL = 0.69, cH = (299792.458 / H0) * 3.2616e6; // c/H0 em anos-luz
  const tH = (977.8 / H0) * 1e9; // 1/H0 em anos
  const E = (z) => Math.sqrt(Om * (1 + z) ** 3 + OL);
  const pts = [[0, 0]];
  let dc = 0, tl = 0, z = 0;
  while (z < 1e4) {
    const dz = Math.max(z * 0.01, 1e-4);
    const zm = z + dz / 2;
    dc += (cH * dz) / E(zm);
    tl += (tH * dz) / ((1 + zm) * E(zm));
    z += dz;
    pts.push([dc, tl]);
  }
  return pts;
})();
function tempoLuzAnos(distAl) {
  if (distAl < 1e8) return distAl;
  let i = 1;
  while (i < COSMO.length - 1 && COSMO[i][0] < distAl) i++;
  const [d0, t0] = COSMO[i - 1], [d1, t1] = COSMO[i];
  return t0 + ((t1 - t0) * Math.min(Math.max((distAl - d0) / (d1 - d0), 0), 1));
}
function quandoSaiu(seg) {
  if (seg < 1) return ['agora mesmo', ''];
  if (seg < 365.25 * 86400) return [`há ${duracao(seg)}`, ''];
  const ano = anoSim(estado.jd) - seg / (365.25 * 86400);
  let quando;
  if (ano >= 1) quando = `no ano ${Math.floor(ano)}${ano < 1000 ? ' d.C.' : ''}`;
  else if (ano > -10000) quando = `no ano ${Math.max(Math.ceil(-ano), 1)} a.C.`;
  else quando = `há ${duracao(seg)}`;
  const era = ERAS.find(([inicio]) => ano >= inicio);
  return [quando, era ? `na Terra: ${era[1]}` : 'antes de a Terra existir'];
}

// Nomes das constelações (perto do Sol), bússola e informações do céu no modo "olhar para o céu"
function desenharCeu(abs, postos) {
  if (linhasConst) {
    const dSolAl = abs.distanceTo(PORID.sol.abs) / AL;
    const longe = Math.min(Math.max((dSolAl - 50) / 150, 0), 1); // somem entre 50 e 200 anos-luz do Sol
    const op = 0.38 * (1 - longe) * (1 - Math.min(diaNoCeu * 1.6, 1));
    linhasConst.visible = estado.linhasConst && op > 0.01;
    linhasConst.material.uniforms.opac.value = op;
    linhasConst.material.uniforms.beta.value.copy(betaVec);
  }
  const verConst = estado.constelacoes && estado.nomes && abs.distanceTo(PORID.sol.abs) < 100 * AL && diaNoCeu < 0.6;
  const up = estado.ceuModo ? estado.local.clone().normalize() : null;
  for (const c of constelacoes) {
    let mostrar = verConst && (!up || c.dir.dot(up) > 0.02);
    if (mostrar) {
      aberrarJS(projetado.copy(c.dir).multiplyScalar(1e9)).applyMatrix4(camera.matrixWorldInverse);
      if (projetado.z >= 0) mostrar = false;
      else {
        projetado.applyMatrix4(camera.projectionMatrix);
        const x = (projetado.x * 0.5 + 0.5) * innerWidth, y = (-projetado.y * 0.5 + 0.5) * innerHeight;
        const w = c.nome.length * 7.5 + 10, caixa = [x - w / 2, y - 8, x + w / 2, y + 8];
        if (x < 0 || x > innerWidth || y < 0 || y > innerHeight || postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) mostrar = false;
        else { postos.push(caixa); c.el.style.left = `${x}px`; c.el.style.top = `${y}px`; }
      }
    }
    c.el.style.display = mostrar ? '' : 'none';
  }
  for (const b of bussola) {
    let mostrar = estado.ceuModo;
    if (mostrar) {
      const { norte, leste } = eixosLocais(up);
      const dir = norte.clone().multiplyScalar(Math.cos(b.az * GRAU)).addScaledVector(leste, Math.sin(b.az * GRAU)).addScaledVector(up, 0.01);
      projetado.copy(dir).multiplyScalar(1e6).applyMatrix4(camera.matrixWorldInverse);
      if (projetado.z >= 0) mostrar = false;
      else {
        projetado.applyMatrix4(camera.projectionMatrix);
        b.el.style.left = `${(projetado.x * 0.5 + 0.5) * innerWidth}px`;
        b.el.style.top = `${(-projetado.y * 0.5 + 0.5) * innerHeight}px`;
      }
    }
    b.el.style.display = mostrar ? '' : 'none';
  }
}

const PONTOS = ['N', 'NNE', 'NE', 'LNE', 'L', 'LSE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const pontoCardeal = (az) => PONTOS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
function painelCeu() {
  const E = PORID.terra;
  const d = estado.local.clone().normalize();
  const [la, lo] = latLon(E, estado.local);
  const { up, norte, leste } = eixosLocais(d);
  // hora solar local
  const msUTC = (estado.jd - 2440587.5) * 86400000;
  const solar = new Date(msUTC + (lo / 15) * 3600000);
  const dt = horaLocalAgora();
  const h2 = (x) => String(x).padStart(2, '0');
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  $('ceuHoraLocal').textContent = `${h2(dt.getUTCHours())}:${h2(dt.getUTCMinutes())} · ${dt.getUTCDate()} de ${meses[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`;
  if (usarOficial()) {
    const z = zonaAqui();
    $('ceuTipoHora').textContent = `hora oficial (${rotuloUTC(deslocamento(z.zona, msUTC))}${z.estimada ? ', fuso estimado pela longitude' : z.cidade ? `, fuso de ${z.cidade.nome}` : ''}) · hora solar ${h2(solar.getUTCHours())}:${h2(solar.getUTCMinutes())}`;
  } else $('ceuTipoHora').textContent = 'hora solar média do lugar (pela longitude)';
  // estação do ano (hemisfério do lugar)
  const diaAno = (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(dt.getUTCFullYear(), 0, 0)) / 86400000;
  const norteEst = diaAno < 79 || diaAno >= 355 ? 'inverno' : diaAno < 172 ? 'primavera' : diaAno < 265 ? 'verão' : 'outono';
  const oposto = { inverno: 'verão', verão: 'inverno', primavera: 'outono', outono: 'primavera' };
  $('ceuEstacao').textContent = `${la >= 0 ? norteEst : oposto[norteEst]} no hemisfério ${la >= 0 ? 'norte' : 'sul'} · ${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'}, ${sig(Math.abs(lo))}° ${lo >= 0 ? 'L' : 'O'}`;
  // para onde se olha
  const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
  const alt = Math.asin(Math.max(-1, Math.min(1, fr.dot(up)))) / GRAU;
  const az = Math.atan2(fr.dot(leste), fr.dot(norte)) / GRAU;
  $('ceuOlhando').textContent = `${pontoCardeal(az)} (${Math.round(((az % 360) + 360) % 360)}°), ${Math.round(alt)}° ${alt >= 0 ? 'acima' : 'abaixo'} do horizonte`;
  // o que está acima do horizonte agora
  const abs = camAbs(), lista = [];
  for (const c of CORPOS) {
    if (c === E || !['planeta', 'lua', 'estrela', 'anao'].includes(c.tipo) || (c.tipo === 'lua' && c.id !== 'lua')) continue;
    if (c.id === 'plutao') continue;
    const v = c.abs.clone().sub(abs).normalize();
    const a = Math.asin(v.dot(up)) / GRAU;
    if (a < 0) continue;
    const z = Math.atan2(v.dot(leste), v.dot(norte)) / GRAU;
    lista.push(`${c.nome}: ${pontoCardeal(z)}, ${Math.round(a)}°${c.id === 'urano' || c.id === 'netuno' ? ' (só com telescópio)' : ''}`);
  }
  $('ceuVisiveis').textContent = lista.length ? lista.join(' · ') : 'nenhum planeta acima do horizonte agora';
  const ano = 2000 + (estado.jd - 2451545) / 365.25;
  const sol = PORID.sol.abs.clone().sub(abs).normalize(), aSol = Math.asin(sol.dot(up)) / GRAU;
  $('ceuSituacao').textContent = (ano < 1800 || ano > 2050 ? 'Atenção: fora de 1800–2050 as posições ficam menos precisas. ' : '')
    + (aSol > 0 ? 'Dia: o céu claro esconde as estrelas.' : aSol > -6 ? 'Crepúsculo civil: só os astros mais brilhantes.' : aSol > -18 ? 'Crepúsculo: as estrelas vão aparecendo.'
      : luar > 0.3 ? 'Noite com luar forte: a Lua apaga as estrelas fracas e a Via Láctea.' : luar > 0.05 ? 'Noite com algum luar.' : 'Noite fechada: céu escuro, sem nuvens e sem luzes de cidade.');
}

function painel() {
  if (estado.ceuModo) { painelCeu(); hudTelescopio(); }
  if (estado.embarcado) painelMissao();
  const abs = camAbs();
  const vr = velocidade(velMedida);
  if (estado.pousado && !estado.cruzeiro && !eixos().frente && !eixos().lado) velMedida = 0; // parado no chão é parado
  $('velReal').textContent = velMedida < 1e-6 ? 'parado' : vr.principal;
  const relA = estado.ref ? `em relação ${com('a', estado.ref)}` : '';
  $('velRealSub').textContent = velMedida < 1e-6 ? '' : [vr.secundaria, freando ? 'freando' : '', relA].filter(Boolean).join(' · ');

  let rel = '';
  if (estado.efeito === 'relatividade' && velMedida > 0.01 * C) {
    if (velMedida < C) {
      const g = 1 / Math.sqrt(1 - (velMedida / C) ** 2);
      rel = `γ = ${sig(g)} · 1 s a bordo = ${duracao(g)} na Terra`;
    } else rel = 'Acima de c não há física real: o céu é mostrado como a 99,5% de c';
  }
  $('relInfo').textContent = rel;
  $('refFrame').textContent = (estado.ref ? estado.ref.nome : 'espaço (fixo)') + (estado.pousado ? ' · pousado' : '');
  $('maisPerto').textContent = proximo ? proximo.nome : '—';
  $('altitude').textContent = proximo ? distancia(Math.max(altProx, 0)) : '—';
  if (proximo && altProx < proximo.raio * 2 && proximo.tipo !== 'estrela') {
    const [la, lo] = latLon(proximo, abs.clone().sub(proximo.abs));
    $('coord').textContent = `${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'} · ${sig(Math.abs(lo))}° ${lo >= 0 ? 'L' : 'O'}`;
  } else $('coord').textContent = '—';
  const dT = abs.distanceTo(PORID.terra.abs);
  $('daTerra').textContent = distancia(dT);
  const segLuz = tempoLuzAnos(dT / AL) * 365.25 * 86400;
  $('luzTerra').textContent = dT > 1e8 * AL ? `${duracao(segLuz)} para a luz daqui chegar à Terra (com a expansão do universo)` : duracao(segLuz) + (dT > 1e8 * AL ? ' (com a expansão do universo)' : '');
  const [quando, epoca] = quandoSaiu(segLuz);
  $('luzSaiu').textContent = quando;
  $('epoca').textContent = epoca;
  $('faixa').textContent = nomeFaixa();
  $('doSol').textContent = distancia(abs.distanceTo(PORID.sol.abs));
  $('dataSim').textContent = data(estado.jd);
  const ano = 2000 + (estado.jd - 2451545) / 365.25;
  $('avisoData').textContent = ano < 1800 || ano > 2050 ? 'Fora de 1800–2050: posições dos planetas menos precisas; estrelas sem o movimento próprio.' : '';
  const fz = -new Date().getTimezoneOffset() / 60;
  $('fusoTxt').textContent = `hora do seu computador (UTC${fz >= 0 ? '+' : '−'}${Math.abs(fz)})`;

  const p = estado.piloto;
  let st = '';
  if (p && p.modo === 'vel') {
    const t = (p.resta || 0) / Math.max(velMedida, 1e-9);
    const bordo = estado.efeito === 'relatividade' && velMedida < C ? ` (a bordo: ${duracao(t * Math.sqrt(1 - (velMedida / C) ** 2))})` : '';
    st = `A caminho ${com('de', p.alvo)}: faltam ${distancia(p.resta || 0)} · chegada em ${duracao(t)}${bordo}`;
  }
  else if (p && p.modo === 'tempo') st = `A caminho ${com('de', p.alvo)}: ${distancia(abs.distanceTo(p.alvo.abs))} · ${duracao(Math.max(p.dur - p.t, 0))} restantes`;
  else if (p && p.modo === 'pouso') st = `Pousando ${com('em', p.alvo)}: altitude ${distancia(Math.max(altProx, 0))}`;
  else if (p && p.modo === 'lugar') st = `Voando para ${p.lugar.nome}: ${distancia(Math.max(altProx, 0))} de altitude`;
  else if (estado.aviao) st = `Modo avião: ${distancia(estado.altAviao)} sobre o chão · ↑↓ sobe/desce · ←→ vira · Y desliga`;
  else if (estado.pousado) st = `No chão ${com('de', estado.pousado)}. Setas para andar, R para decolar.`;
  else if (estado.alvo) {
    const dc = distChegada(estado.alvo);
    const d = abs.distanceTo(estado.alvo.abs) - dc;
    st = d < dc * 0.02 ? `Você está ${com('em', estado.alvo)}.` : `${estado.alvo.nome}: ${distancia(d)} · na velocidade escolhida, ${duracao(d / estado.v)}`;
  }
  if (estado.cruzeiro) st = st ? `Cruzeiro ligado (C para desligar) · ${st}` : 'Cruzeiro ligado (C para desligar)';
  $('statusViagem').textContent = st;
  if (performance.now() > avisoAte) $('aviso').textContent = '';
}

renderer.setAnimationLoop(passo); // (e não requestAnimationFrame: nos óculos quem dá o ritmo é a sessão WebXR)
window.__sim = { vr, alvoNaDirecao, textoPainelVR, satelites, embarcar: (o) => embarcar(o), estado, PORID, camAbs, cat, estrelaObj, vagas, THREE, terra, buscar, indiceBusca, missoes, atualizarPosicoes };
