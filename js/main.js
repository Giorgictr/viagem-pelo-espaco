import * as THREE from '../vendor/three.module.js';
import { t as tr, tn, LOCALE, idioma, IDIOMAS, trocarIdioma, manual as manualIdioma } from './idioma.js';
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
import { criarSatelites, criarFrota } from './satelites.js';
import { criarPredios } from './predios.js';
import { criarDetalhe, CAMADAS } from './detalhe.js';
import { criarSolo, lerManifesto } from './solo.js';
import { criarBrilho } from './brilho.js';
import { carregarFichas, montarFicha, precisaExtras, carregarExtras, textoFicha, gravidadeDe } from './fichas.js';
import { exo, carregarExoplanetas, corpoPlaneta, posicaoOrbita, pontoOrbita, resumoPlaneta } from './exoplanetas.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { DRACOLoader } from '../vendor/DRACOLoader.js';
import { radecParaCena, carregarEfemeridesLuas, velocidadePlaneta, equatorialParaCena } from './corpos.js';
import { estadoSom, ligarAudioNoPrimeiroGesto, atualizarSom, somDobra, mudarMusica, ajustarVolume, proximaFaixa, nomeFaixa } from './som.js';
import { criarVR } from './vr.js';
import { carregarGaia, cat, carregarEstrelas, estrelaObj, maisProximas, criarCeu, DESTAQUES } from './estrelas.js';

// ---------------------------------------------------------------------------
// Escala: tudo é guardado em km com precisão dupla (números do JavaScript).
// A câmera fica sempre na origem da cena; cada objeto é posto relativo a ela.
// Além de R0, a distância é comprimida em log ao longo do raio de visão —
// o objeto continua no mesmo lugar da tela e com o mesmo tamanho aparente.
// ---------------------------------------------------------------------------
const R0 = 1e8;
const comprimir = (d) => (d <= R0 ? 1 : (R0 * (1 + Math.log(d / R0))) / d);
const ALTURA_OLHO = 0.0018; // km
const TOPO_NUVENS = 50; // km acima do nível de 1 bar: onde se "pousa" (flutuando) num gigante gasoso
const GASOSOS = ['jupiter', 'saturno', 'urano', 'netuno'];

const tela = document.getElementById('tela');
const renderer = new THREE.WebGLRenderer({ canvas: tela, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const cena = new THREE.Scene();
const brilho = criarBrilho(renderer);
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
    ? tr('A placa de vídeo ficou sem memória de novo. Feche outras abas pesadas e recarregue a página (Cmd+R).')
    : tr('A placa de vídeo ficou sem memória (comum depois de muito tempo voando baixo sobre a Terra). Recarregando no mesmo lugar e na mesma data…');
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
  escolherNaDirecao: (dir) => { const c = alvoNaDirecao(dir); if (c) { escolherAlvo(c); aviso(tr('Alvo: {c}', { c })); } else aviso(tr('Nada nessa direção.')); },
  direcaoAlvo: (out) => (estado.alvo && estado.alvo !== estado.embarcado ? out.copy(estado.alvo.abs).sub(camAbs()).normalize() : null),
  nomeAlvo: () => estado.alvo?.nome ?? '',
  multiplicarV: (f) => definirV(estado.v * f),
  embarcarOuDesembarcar: () => {
    if (estado.embarcado) { desembarcar(); escolherRef(); aviso('Desembarcou.'); }
    else if (estado.alvo && missoes.objetos.includes(estado.alvo)) embarcar(estado.alvo);
    else aviso(estado.alvo ? tr('Não dá para embarcar {em:c}.', { c: estado.alvo }) : tr('Escolha um alvo primeiro (gatilho direito).'));
  },
  irAoAlvo: () => { if (estado.alvo) irPara(estado.alvo); else aviso(tr('Escolha um alvo primeiro (gatilho direito).')); },
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
  fichas: (() => { try { return localStorage.getItem('viagemFichas') !== '0'; } catch { return true; } })(), // fichas de chegada
  nivelar: true, giraJunto: true, exagero: 1, texturas: true, inventado: true, ceuRealcado: false, efeito: 'dobra', bolha: true, cidades: 'grandes', fronteiras: true, nomesTerra: true, picos: true, aviao: false, altAviao: 1, epocaMa: 0, nivelMar: 0, gelo: false, ceuModo: false, vistaFora: false, nuvensReais: true, nuvensDeriva: true, meteoros: true, meteoros10: false, bortle: 0, messier: true, refracao: true, predios: true, telescopio: false, zoom: 10, rastrear: true, atmFisica: true, constelacoes: false, linhasConst: false, ilustrativas: true, viaReal: true, nevoaTita: true, brilho: true,
};

// ------------------------------- texturas -------------------------------
const carregador = new THREE.TextureLoader();
function textura(nome, cor = true, pronta) {
  const t = carregador.load(`texturas/${nome}`, pronta);
  if (cor) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Foto de um corpo: baixada quando ele passa a aparecer como disco na tela (são dezenas; abrir a página só precisa destas)
const CEDO = ['sol', 'terra', 'lua'];
function pedirMapa(c) {
  c.mapaPedido = true;
  const u = c.malha.material.uniforms;
  u.mapa.value = textura(c.textura, true, () => { c.mapaPronto = true; if (!c.nevoa) u.temMapa.value = 1; });
}
// De perto (disco com mais de 700 pixels), a foto de 2k fica borrada: entra a de 4k, quando chegar
function pedirMapa4k(c) {
  c.mapa4kPedido = true;
  const t = textura(c.textura4k, true, () => { c.malha.material.uniforms.mapa.value = t; });
}
// Mapa de relevo global de um corpo: baixado na primeira vez que a câmera chega a menos de 3 mil raios dele
// (são até 3 MB cada; abrir a página não precisa de nenhum). Até chegar, a esfera fica lisa.
function pedirRelevo(c) {
  c.relevoPedido = true;
  carregarAlturas(c);
  const u = c.malha.material.uniforms;
  u.relevo.value = carregador.load(`texturas/${c.relevo[0]}`, () => { c.relevoPronto = true; if (!c.nevoa) u.temRelevo.value = 1; });
  u.relevo.value.anisotropy = 8;
  u.relevo.value.wrapS = THREE.RepeatWrapping;
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
    for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 65280 + px[i * 4 + 1] * 255) / (65535 * 255); // 16 bits (vermelho e verde) ou cinza
    c.alturas = { w: img.width, h: img.height, dados: h };
    if (c.malha) c.malha.material.uniforms.texel.value.set(1 / img.width, 1 / img.height);
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
  return out.multiplyScalar(Math.max(1 + (amostraAltura(c, u, v) * estado.exagero) / c.raio, 0.3)); // como no shader
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
  if (c.nevoa && nevoaPorCima(c)) return c.raio; // Titã com a névoa, vista de fora: a esfera lisa que se vê
  if (c.solo && c.solo.ativo) {
    const h = c.solo.altura(_dl.copy(dirCena).normalize().applyQuaternion(_qi.copy(c.qOri).invert()));
    if (h !== null) return c.raio + h * estado.exagero;
  }
  return raioGlobal(c, dirCena);
}
// Vênus e Titã: de fora, só as nuvens (ou a névoa); abaixo delas, o chão de verdade, no ar espesso e alaranjado
const abaixoDasNuvens = (c) => !!c.nuvensAlt && estado.ref === c && altRef < c.nuvensAlt[1];
const nevoaPorCima = (c) => estado.nevoaTita && !abaixoDasNuvens(c);
// Só o mapa global (sem os ladrilhos): o mesmo chão da esfera desenhada de longe
function raioGlobal(c, dirCena) {
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
  return Math.max(c.raio + amostraAltura(c, phi / (2 * Math.PI), 1 - th / Math.PI) * estado.exagero, c.raio * 0.3);
}

// "Para cima" de quem está perto do chão: a perpendicular à forma do corpo numa escala larga (5% do raio). Nos corpos
// pequenos e irregulares (Vesta, Fobos), o centro não fica bem embaixo: a gravidade acompanha a forma, e um horizonte
// nivelado pela direção do centro sai torto. Nos corpos redondos, dá o mesmo que a direção do centro.
const _cU = new THREE.Vector3(), _cE = new THREE.Vector3(), _cN = new THREE.Vector3(), _cP = new THREE.Vector3();
function cimaChao(c, local, out) {
  out.copy(local).normalize();
  if (!c || !c.relevo || !c.alturas || c.id === 'terra' || (c.nevoa && nevoaPorCima(c))) return out;
  const a = 0.05, R2 = 2 * a * c.raio;
  _cE.crossVectors(out, Math.abs(out.y) < 0.9 ? eixoY : eixoX).normalize();
  _cN.crossVectors(_cE, out);
  _cU.copy(out);
  const r = (t, k) => raioGlobal(c, _cP.copy(_cU).addScaledVector(t, k));
  const dE = (r(_cE, a) - r(_cE, -a)) / R2, dN = (r(_cN, a) - r(_cN, -a)) / R2;
  return out.addScaledVector(_cE, -dE).addScaledVector(_cN, -dN).normalize();
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
  const temRelevo = !!c.relevo; // o mapa de relevo só é baixado quando a câmera chega perto (pedirRelevo)
  const mat = new THREE.ShaderMaterial({
    vertexShader: S.PLANETA_V,
    fragmentShader: S.PLANETA_F,
    uniforms: {
      mapa: { value: c.textura && CEDO.includes(c.id) ? textura(c.textura) : null }, // os outros: pedirMapa, quando aparecem
      noite: { value: c.noite ? textura(c.noite) : null },
      relevo: { value: null },
      temMapa: { value: c.textura && CEDO.includes(c.id) ? 1 : 0 },
      temNoite: { value: c.noite ? 1 : 0 },
      temRelevo: { value: 0 },
      hMin: { value: temRelevo ? c.relevo[1] : 0 },
      hMax: { value: temRelevo ? c.relevo[2] : 0 },
      texel: { value: new THREE.Vector2(1 / 1024, 1 / 512) }, // corrigido quando a imagem de relevo chega
      exagero: { value: 1 },
      raio: { value: c.raio },
      detalhe: { value: c.rochoso ? 1 : 0 },
      crateraForca: { value: c.rochoso ? (c.atm ? 0.35 : c.id === 'io' || c.id === 'europa' || c.id === 'tita' ? 0.15 : 1) : 0 }, // Io e Europa: superfícies jovens, poucas crateras
      kmPorUnidade: { value: 1 },
      usarTextura: { value: 1 },
      emissivo: { value: estrela ? 1 : 0 },
      corBase: { value: c.cor3.clone().convertSRGBToLinear() },
      luz: { value: new THREE.Vector3(1, 0, 0) },
      polo: { value: new THREE.Vector3(0, 1, 0) },
      usarPiso: { value: 0 }, pisoMar: { value: 0 }, exposicao: { value: 1 },
      veuKm: { value: 0 }, difusa: { value: 0 }, nuvemDet: { value: GASOSOS.includes(c.id) ? 1 : 0 }, tingir: { value: c.id === 'marte' ? 0.7 : 0 }, corVeu: { value: new THREE.Color() }, corLuz: { value: new THREE.Color(1, 1, 1) },
      detalheMapa: { value: null }, detalheJanela: { value: new THREE.Vector4() }, detalheAtivo: { value: 0 },
      detalheMapa2: { value: null }, detalheJanela2: { value: new THREE.Vector4() }, detalheAtivo2: { value: 0 },
      eclOcl: { value: new THREE.Vector3() }, eclRaio: { value: 1 }, eclSolAng: { value: 0.00465 }, eclAtivo: { value: 0 }, eclVermelho: { value: 0 },
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
        dentro: { value: 0 }, densidade: { value: 1 }, luar: { value: 0 }, urbano: { value: 0 },
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
          gM: { value: new THREE.Vector3(...fis.g) }, intensidade: { value: fis.intensidade }, exposicao: { value: 1 }, luar: { value: 0 }, multiplo: { value: fis.multiplo }, urbano: { value: 0 }, raioCorpo: { value: R },
          eclOcl: { value: new THREE.Vector3() }, eclRaio: { value: 1 }, eclSolAng: { value: 0.00465 }, eclAtivo: { value: 0 }, eclVermelho: { value: 0 },
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
      uniforms: { mapa: { value: textura(c.nuvens, false) }, luz: { value: new THREE.Vector3() }, opac: { value: 1 },
        mapaA: { value: null }, mapaB: { value: null }, real: { value: 0 }, mistura: { value: 0 }, horas: { value: 0 }, deriva: { value: 1 } },
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
    const t = carregador.load('texturas/8k_saturn_ring_alpha.png');
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

// Vagas para os planetas do sistema de exoplanetas mais próximo (até 8 por estrela: Kepler-90)
const NEXO = 8;
const vagasExo = [];
for (let j = 0; j < NEXO; j++) {
  const mat = PORID.jupiter.malha.material.clone();
  for (const k of ['temMapa', 'temNoite', 'temRelevo', 'emissivo']) mat.uniforms[k].value = 0;
  mat.uniforms.corBase.value = new THREE.Color();
  const malha = new THREE.Mesh(esfera, mat);
  malha.visible = false;
  cena.add(malha);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(257 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }));
  linha.frustumCulled = false;
  linha.visible = false;
  cena.add(linha);
  vagasExo.push({ malha, linha, obj: null, pts: [] });
}
let sistemaExo = null; // estrela hospedeira (do catálogo de exoplanetas) cujos planetas estão nas vagas
// Zona habitável (onde a água poderia ser líquida na superfície): limites conservadores de Kopparapu et al. (2013),
// fluxo de 1,107 a 0,356 vez o que a Terra recebe; uma faixa verde no plano das órbitas
const zonaHab = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(258 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let j = 0; j < 128; j++) idx.push(2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 1, 2 * j + 3, 2 * j + 2);
  geo.setIndex(idx);
  const malha = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x3fbf6a, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
  malha.frustumCulled = false;
  malha.visible = false;
  cena.add(malha);
  return { malha, pts: [] };
})();

// Camada de brilhos: um ponto por corpo (e por vaga)
const nB = CORPOS.length + NV + NEXO;
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
const frotaSat = criarFrota(PORID, PORID.terra.raio); // os demais satélites, como pontos
missoes.usarVelPlaneta((id, jd) => (id === '67p' ? missoes.porId['67p']?.vel.clone() ?? new THREE.Vector3() : velocidadePlaneta(id, jd)));
const terra = criarTerra(cena, S, PORID.terra.raio); // Terra em ladrilhos (relevo e satélite), perto do chão
// Lua, Marte, Mercúrio, Ceres, Vesta, Titã, Plutão e Caronte: relevo de alta resolução em ladrilhos, perto da superfície
for (const id of ['lua', 'marte', 'mercurio', 'ceres', 'vesta', 'tita', 'plutao', 'caronte']) {
  lerManifesto(id).then((man) => {
    if (!man) return;
    const c = PORID[id];
    c.solo = criarSolo(c, S, man, c.malha.material.uniforms);
    cena.add(c.solo.grupo);
  });
}
const predios = criarPredios(cena, PORID.terra.raio, terra); // construções do OpenStreetMap em 3D
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
    // plano e tamanho da órbita: de dentro dela e quase no plano, ela só apareceria como um risco cruzando a tela
    const normal = new THREE.Vector3();
    for (let k = 0; k + 1 < pts.length; k += Math.max(1, Math.floor(pts.length / 16))) normal.add(new THREE.Vector3().crossVectors(pts[k], pts[k + 1]));
    normal.normalize();
    const raioMax = pts.reduce((m, v) => Math.max(m, v.length()), 0);
    orbitas.push({ corpo: c, pts, linha, jd, normal, raioMax });
  }
}

atualizarPosicoes(estado.jd);
atualizarPosicoes(estado.jd);
criarOrbitas(estado.jd);
carregarEfemeridesLuas().then(() => criarOrbitas(estado.jd)); // luas na posição exata (JPL)

// ------------------------------- referencial -------------------------------
// Arrastar sobre um planeta (de longe ou de média altura) gira a câmera em volta dele, como girar um globo na mão;
// arrastar no céu continua virando o olhar. Perto do chão, pousado, olhando o céu, no telescópio ou viajando: só o olhar.
const _gEixo = new THREE.Vector3(), _gQ = new THREE.Quaternion(), _gDir = new THREE.Vector3();
function podeGirarGlobo() {
  const r = estado.ref;
  if (!r || !r.malha || !r.raio || r.tipo === 'galaxia' || r.tipo === 'marco') return false;
  if (estado.pousado || estado.ceuModo || estado.telescopio || estado.piloto || estado.embarcado || vr.ativo) return false;
  return estado.local.length() - r.raio > r.raio * 0.2;
}
function pegouGlobo(px, py) {
  if (!podeGirarGlobo()) return false;
  const t = Math.tan((camera.fov * GRAU) / 2);
  _gDir.set(((px / innerWidth) * 2 - 1) * t * camera.aspect, (1 - (py / innerHeight) * 2) * t, -1).normalize().applyQuaternion(estado.q);
  // centro do corpo visto da câmera: −local; o raio do toque pega o planeta se passa a menos de um raio dele (com folga)
  const c = _gEixo.copy(estado.local).negate(), ao = c.dot(_gDir);
  return ao > 0 && c.lengthSq() - ao * ao < (estado.ref.raio * 1.03) ** 2;
}
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
  c.tipo === 'sonda' ? 0.05 : c.tipo === 'cometa' ? c.raio * 60 : c.tipo === 'galaxia' ? c.raio * 2.6 : c.tipo === 'marco' ? (c.id === 'centro' ? 40 * AL : c.id === 'borda' ? 3e9 * AL : c.raio * 2) : c.tipo === 'estrela' ? Math.max(c.raio * 8, 2e5, c.distExo ?? 0) : c.aneis ? c.raio * 6 : Math.max(c.raio * 4, 30);

// Direção de chegada: do lado iluminado, um pouco acima do plano
function direcaoBonita(c) {
  if (c.normal) return c.normal.clone().multiplyScalar(Math.cos(35 * GRAU)).addScaledVector(c.eixoMaior, Math.sin(35 * GRAU)).normalize();
  if (c.id === 'borda') return PORID.terra.abs.clone().sub(c.abs).normalize(); // por dentro, olhando para fora
  if (c.tipo === 'estrela' || c.tipo === 'galaxia' || c.tipo === 'marco') return new THREE.Vector3(0.35, 0.3, 1).normalize();
  const s = (c.estrela ?? PORID.sol).abs.clone().sub(c.abs).normalize();
  if (c.aneis) {
    // do lado iluminado dos anéis, ~30° acima do plano deles
    const polo = c.base.p.clone().multiplyScalar(Math.sign(c.base.p.dot(s)) || 1);
    const noPlano = s.clone().addScaledVector(polo, -s.dot(polo)).normalize().applyAxisAngle(polo, 35 * GRAU);
    return noPlano.multiplyScalar(Math.cos(30 * GRAU)).addScaledVector(polo, Math.sin(30 * GRAU)).normalize();
  }
  return s.applyAxisAngle(new THREE.Vector3(0, 1, 0), 38 * GRAU).add(new THREE.Vector3(0, c.aneis ? 0.45 : 0.28, 0)).normalize();
}

const _m = new THREE.Matrix4(), _up = new THREE.Vector3(), ORIGEM = new THREE.Vector3();
// Artigos: "ao Sol", "à Lua", "da Terra", "na Lua", "em Marte" (e os equivalentes em cada idioma, em idioma.js)
const com = (prep, c) => tr(`{${prep}:c}`, { c });
function quatOlhando(dir, out = new THREE.Quaternion(), up = null) {
  if (up) _up.copy(up); else _up.set(0, 1, 0).applyQuaternion(estado.q);
  if (!Number.isFinite(_up.x + _up.y + _up.z) || _up.lengthSq() < 1e-12) _up.set(0, 1, 0);
  if (!Number.isFinite(dir.x + dir.y + dir.z) || dir.lengthSq() === 0) return out;
  const dn = dir.clone().normalize();
  if (Math.abs(_up.dot(dn)) > 0.995) { // alvo quase na vertical: usa o "para cima" da própria câmera (ou o lado dela)
    _up.set(0, 1, 0).applyQuaternion(estado.q);
    if (Math.abs(_up.dot(dn)) > 0.995) _up.set(1, 0, 0).applyQuaternion(estado.q);
  }
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
  fecharFicha();
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
  if (!c || !['planeta', 'lua', 'anao'].includes(c.tipo)) return aviso(tr('Chegue perto de um planeta ou lua para pousar.'));
  if (c.gasoso) return aviso(tr('{c} não é rochoso ({tipo}): não tem chão para pousar.', { c, tipo: tr(c.tipoExo) }));
  if (altC > c.raio * 30) return aviso(tr('Chegue mais perto {de:c} para pousar (menos de {d}).', { c, d: distancia(c.raio * 30) }));
  mudarRef(c);
  estado.cruzeiro = false;
  const dirCena = estado.local.clone().normalize();
  const olho = alturaOlho(c), alt0 = Math.max(altC, olho * 2);
  estado.piloto = {
    modo: 'pouso', alvo: c, t: 0, dur: 4 + Math.log10(alt0 / olho) * 1.1, alt0,
    dirCorpo: dirCena.applyQuaternion(c.qOri.clone().invert()),
  };
}

// Gigantes gasosos não têm chão: o "pouso" fica flutuando no topo das nuvens
const alturaOlho = (c) => (GASOSOS.includes(c.id) ? TOPO_NUVENS : ALTURA_OLHO);

// Pouso numa encosta ou dentro de uma cratera: se a frente dá num barranco, vira para o lado mais aberto (perto do rumo)
const _cimaP = new THREE.Vector3(), _abP = new THREE.Vector3(), _abD = new THREE.Vector3();
function virarParaOAberto(c) {
  const cima = cimaChao(c, estado.local, new THREE.Vector3());
  const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q).projectOnPlane(cima).normalize();
  const lado = new THREE.Vector3().crossVectors(cima, fr);
  const olho = estado.local, alcance = Math.min(4, c.raio * 0.2);
  const barranco = (az) => { // maior elevação do chão (rad) nessa direção, até alguns km
    _abD.copy(fr).multiplyScalar(Math.cos(az)).addScaledVector(lado, Math.sin(az));
    let max = -1;
    for (let d = 0.01; d < alcance; d *= 1.5) {
      _abP.copy(olho).addScaledVector(_abD, d);
      _abP.setLength(raioSuperficie(c, _abP)).sub(olho);
      max = Math.max(max, Math.asin(Math.min(Math.max(_abP.normalize().dot(cima), -1), 1)));
    }
    return max;
  };
  if (barranco(0) < 0.1) return; // a frente já está aberta (menos de ~6° de subida)
  let melhor = 0, custo = Infinity;
  for (let i = 1; i < 24; i++) {
    const az = (i / 24) * 2 * Math.PI, giro = Math.min(az, 2 * Math.PI - az);
    const k = barranco(az) + 0.12 * giro;
    if (k < custo) { custo = k; melhor = az; }
  }
  const dir = fr.multiplyScalar(Math.cos(melhor)).addScaledVector(lado, Math.sin(melhor)).addScaledVector(cima, -0.03);
  estado.virar = quatOlhando(dir, new THREE.Quaternion(), cima);
}

// Pulo com a gravidade do lugar: o mesmo impulso (3 m/s, um bom pulo na Terra, de ~45 cm) leva meio segundo aqui,
// uns 3 m e 4 s na Lua e quase 800 m e um quarto de hora em Fobos. A gravidade cai com a distância ao centro.
const IMPULSO = 0.003; // km/s
function pular() {
  const c = estado.pousado;
  if (!c || estado.pulo) return;
  if (GASOSOS.includes(c.id)) return pararTudo();
  estado.cruzeiro = false;
  const g = gravidadeDe(c);
  estado.pulo = { c, v: IMPULSO, h: 0, gR2: (g / 1000) * c.raio * c.raio };
  const vm = IMPULSO * 1000, hT = (vm * vm) / (2 * 9.81);
  const h = (vm * vm) / (2 * g), t = (2 * vm) / g;
  aviso(tr('Pulo {em:c}: cerca de {h} de altura e {t} no ar (o mesmo pulo na Terra: {hT} e {tT}).', { c, h: distancia(h / 1000), t: duracao(t), hT: distancia(hT / 1000), tT: duracao((2 * vm) / 9.81) }), Math.min(Math.max(t * 1000, 4500), 12000));
}

function pararTudo() {
  estado.piloto = null;
  estado.cruzeiro = false;
}

// ------------------------------- interface -------------------------------
const $ = (id) => document.getElementById(id);
let avisoAte = 0;
function aviso(txt, ms = 4500) { $('aviso').textContent = txt; avisoAte = performance.now() + ms; }

const slider = $('velSlider');
const PRESETS = [
  ['a pé', 5 / 3600], ['carro', 100 / 3600], ['avião', 900 / 3600], ['sonda Parker', 192], ['90% da luz', 0.9 * C], ['99% da luz', 0.99 * C], ['luz', C],
  ['1 ano-luz/s', AL], ['mil anos-luz/s', 1e3 * AL], ['1 milhão de anos-luz/s', 1e6 * AL], ['1 bilhão de anos-luz/s', 1e9 * AL],
];
for (const [nome, v] of PRESETS) {
  const b = document.createElement('button');
  b.textContent = tr(nome);
  b.onclick = () => definirV(v);
  $('presets').append(b);
}
// Relatividade: a viagem corre no relógio de quem viaja. A uma velocidade v (medida no referencial), as distâncias se
// contraem por γ e o viajante percorre γ·v quilômetros por segundo do próprio relógio; enquanto isso, fora, passam γ
// segundos a cada um. Na velocidade da luz (ou acima, que não existe), o relógio de bordo para: a chegada é imediata.
const relativistico = () => estado.efeito === 'relatividade';
const gama = (v) => 1 / Math.sqrt(1 - Math.min(v / C, 0.999999999999) ** 2);
const passoBordo = (v) => (!relativistico() ? v : v >= C ? Infinity : v * gama(v)); // km por segundo de bordo
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
    g.label = tr(nome);
    for (const c of CORPOS.filter(f)) g.append(new Option(c.nome + (c.tipo === 'lua' ? ` (${c.paiObj.nome})` : ''), c.id));
    if (nome === 'Estrelas') g.id = `${sel.id}Estrelas`;
    if (g.children.length || nome === 'Estrelas') sel.append(g);
  }
}
$('selPartida').value = 'terra';
$('selDestino').value = 'lua';
estado.alvo = null;
const obterCorpo = (id) => PORID[id] ?? missoes.porId[id] ?? (id && id.startsWith('hyg') ? estrelaObj(+id.slice(3)) : id && id.startsWith('exo:') ? planetaPorNome.get(id.slice(4)) ?? null : null);
$('selDestino').onchange = () => (estado.alvo = obterCorpo($('selDestino').value));
$('btIr').onclick = () => iniciarViagem(obterCorpo($('selDestino').value));
$('btParar').onclick = pararTudo;
$('btPousar').onclick = pousar;
$('btPartir').onclick = () => { const c = obterCorpo($('selPartida').value); if (c && (c.tipo === 'sonda' || c.tipo === 'cometa')) embarcar(c); else { teleportar(c); chegou(c); } };

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
    for (const nome of DESTAQUES) if (cat.porNome.has(nome)) g.append(new Option(cat.nomeDe.get(cat.porNome.get(nome)), `hyg${cat.porNome.get(nome)}`));
  }
  for (const { i, nome } of cat.nomes) addBusca(`${nome} · ${tr('estrela')}`, nome, 1e9, () => irPara(estrelaObj(i)));
  // exoplanetas e suas estrelas (as mais perto pesam mais)
  for (const e of exo.estrelas) {
    const n = e.pl.length, peso = 5e8 / (1 + e.d / 10);
    addBusca(`${e.nome} · ${tn(n, 'estrela com {n} planeta', 'estrela com {n} planetas')}`, e.nome, peso, () => irPara(hospedeira(e)));
    e.pl.slice(0, NEXO).forEach((p) => addBusca(`${p.n} · ${tr('exoplaneta')}`, p.n, peso * 0.9, () => irPara(planetaExo(e, p))));
  }
}
// Estrela hospedeira e planetas como corpos (criados na primeira vez)
const planetaPorNome = new Map();
const hospedeira = (e) => { const o = estrelaObj(e.h); ajustarHospedeira(o); return o; };
function planetaExo(e, p) {
  const c = hospedeira(e).exoCorpos.find((o) => o.exo === p);
  posicaoOrbita(c.orbita, estado.jd, c.abs).add(c.estrela.abs);
  return c;
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
  if (c.soCeu) { estado.alvo = c; return apontar(c); }
  escolherAlvo(c);
  if (estado.ceuModo) return apontar(c); // olhando o céu, a busca aponta em vez de viajar
  iniciarViagem(c); aviso(tr('Indo para {c}…', { c }));
}
// Vira a câmera para um astro (no modo céu, mantendo o horizonte embaixo)
function apontar(c) {
  if (!c) return aviso(tr('Escolha um alvo: clique num nome no céu ou use a busca.'));
  const up = estado.local.clone().normalize();
  const dir = c.abs.clone().sub(camAbs());
  quatOlhando(dir, estado.q, up);
  if (estado.ceuModo && dir.normalize().dot(up) < 0) aviso(tr('{c} está abaixo do horizonte agora.', { c }));
  else aviso(tr('Apontando para {c}.', { c }));
}
// Limite de magnitude: o olho (6,5), o "céu realçado" (9,5) e, no telescópio, quanto mais aumento, mais abertura
function limiteMag() {
  // poluição luminosa (escala de Bortle): de 7,8 no campo mais escuro a ~3,8 no centro de uma metrópole
  const olho = estado.ceuModo && estado.bortle ? 7.8 - 0.5 * (estado.bortle - 1) : 6.5;
  return olho + (estado.ceuRealcado ? 3 : 0) + (estado.telescopio ? Math.min(3 * Math.log10(estado.zoom), 7) : 0);
}
// brilho do céu pelas luzes da cidade (0 a 1), só olhando o céu da Terra
const brilhoUrbano = () => (estado.ceuModo && estado.bortle ? ((estado.bortle - 1) / 8) ** 1.5 : 0);
// Refração (modo céu): o mesmo cálculo do shader, para planetas, Lua, Sol, nomes e objetos de Messier
let refrAtiva = false;
const zenRefr = new THREE.Vector3(), _rt = new THREE.Vector3();
function refratar(p) {
  if (!refrAtiva) return p;
  const L = p.length();
  if (L === 0) return p;
  const s = p.dot(zenRefr) / L;
  const h = Math.asin(Math.max(-1, Math.min(1, s))) / GRAU;
  if (h < -1.5) return p;
  const r = Math.min(1.02 / Math.tan((h + 10.3 / (h + 5.11)) * GRAU), 40) / 60 * GRAU;
  _rt.copy(zenRefr).addScaledVector(p, -s / L);
  const tl = _rt.length();
  if (tl < 1e-9) return p;
  return p.multiplyScalar(Math.cos(r)).addScaledVector(_rt, (Math.sin(r) * L) / tl);
}
const TIPO_CORPO = { estrela: 'estrela', planeta: 'planeta', anao: 'planeta anão', galaxia: 'galáxia', marco: 'lugar do universo' };
for (const c of CORPOS) addBusca(`${c.nome} · ${c.tipo === 'lua' ? tr('lua {de:p}', { p: c.paiObj }) : tr(TIPO_CORPO[c.tipo])}`, c.nome, 1e13, () => irPara(c));
const TIPO_LUGAR = { cidade: 'cidade', pais: 'país', mar: 'mar', pico: 'pico', regiao: 'região' };
const PESO_LUGAR = { mar: 3e6, pico: 2e6, regiao: 1e5 }; // países: pelo tamanho (abaixo); metrópoles vencem mares
function preencherLugares(itens) {
  for (const it of itens) {
    const extra = it.tipo === 'cidade' ? [it.estado, it.pais].filter(Boolean).join(', ') : it.tipo === 'pico' ? `${it.elev.toLocaleString(LOCALE)} m` : '';
    const peso = it.tipo === 'cidade' ? it.pop : it.tipo === 'pais' ? 3e7 / (it.rank || 5) ** 2 : PESO_LUGAR[it.tipo];
    addBusca(`${it.nome} · ${tr(TIPO_LUGAR[it.tipo])}${extra ? `, ${extra}` : ''}`, it.nome, peso, () => voarPara(it));
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
  if (!e) return aviso(tr('Não encontrei esse nome entre os corpos do céu, as estrelas e os lugares da Terra.'));
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
  aviso(tr('Voando para {c}…', { c: it.nome }));
}

// Modo avião: segue o relevo a uma altitude constante; ↑↓ sobem e descem, ←→ viram
function alternarAviao() {
  if (estado.aviao) { estado.aviao = false; restaurarV(); return; }
  const r = estado.ref;
  if (!r || !r.malha || r.tipo === 'estrela' || altRef > 300) return aviso(tr('Desça a menos de 300 km de um planeta ou lua para voar de avião.'));
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
const pintores = [];
function chave(id, rotulos, ler, alternar, tecla) {
  const b = $(id);
  const pintar = () => { b.textContent = tr(rotulos[ler() ? 0 : 1]); b.classList.toggle('ativo', !!ler()); };
  pintores.push(pintar);
  const f = () => { alternar(); pintar(); };
  b.onclick = f;
  if (tecla) aoTeclar(tecla, f);
  pintar();
}
chave('btOrbitas', ['Órbitas em movimento', 'Órbitas paradas'], () => estado.orbitasMovem, () => (estado.orbitasMovem = !estado.orbitasMovem), 'KeyT');
chave('btRelevo', ['Relevo exagerado ×10', 'Relevo real'], () => estado.exagero > 1, () => (estado.exagero = estado.exagero > 1 ? 1 : 10), 'KeyX');
chave('btAparencia', ['Aparência: fotos', 'Aparência: procedural'], () => estado.texturas, () => (estado.texturas = !estado.texturas), 'KeyV');
chave('btNivelar', ['Nivelar horizonte', 'Horizonte livre'], () => estado.nivelar, () => (estado.nivelar = !estado.nivelar), 'KeyN');
chave('btPredios', ['Construções em 3D: ligadas', 'Construções em 3D: desligadas'], () => estado.predios, () => (estado.predios = !estado.predios));
chave('btBrilho', ['Brilho das luzes: ligado', 'Brilho das luzes: desligado'], () => estado.brilho, () => (estado.brilho = !estado.brilho));
chave('btNevoaTita', ['Névoa de Titã: ligada', 'Névoa de Titã: desligada (superfície)'], () => estado.nevoaTita, () => (estado.nevoaTita = !estado.nevoaTita));
chave('btAtm', ['Atmosfera: física', 'Atmosfera: simples'], () => estado.atmFisica, () => (estado.atmFisica = !estado.atmFisica));
chave('btFichas', ['Fichas de chegada: ligadas', 'Fichas de chegada: desligadas'], () => estado.fichas, () => { estado.fichas = !estado.fichas; guardar('viagemFichas', estado.fichas ? '1' : '0'); if (!estado.fichas) fecharFicha(); });
chave('btInventado', ['Detalhe inventado', 'Só dado real'], () => estado.inventado, () => (estado.inventado = !estado.inventado), 'KeyI');
chave('btCeu', ['Céu realçado', 'Céu a olho nu'], () => estado.ceuRealcado, () => (estado.ceuRealcado = !estado.ceuRealcado), 'KeyK');
// Efeito visual da velocidade: dobra (cinema) → relatividade (física real) → nenhum
const EFEITOS = { dobra: 'Efeito: dobra (cinema)', relatividade: 'Efeito: relatividade (real)', nenhum: 'Efeito: nenhum' };
function pintarEfeito() { $('btDobra').textContent = tr(EFEITOS[estado.efeito]); $('btDobra').classList.toggle('ativo', estado.efeito !== 'nenhum'); }
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
// Modo foco: esconde os painéis (a escolha fica guardada); em tela pequena começa assim
function modoFoco() {
  const foco = document.body.classList.toggle('semPaineis');
  try { localStorage.setItem('viagemFoco', foco ? '1' : '0'); } catch { /* sem armazenamento */ }
}
$('btPaineis').onclick = () => (ehCelular() ? abrirMenuAbas() : modoFoco());
$('btFoco').onclick = () => (ehCelular() ? abrirAba(null) : modoFoco());
aoTeclar('Period', modoFoco);
aoTeclar('NumpadDecimal', modoFoco);
{
  let f = null;
  try { f = localStorage.getItem('viagemFoco'); } catch { /* sem armazenamento */ }
  if (f === '1') document.body.classList.add('semPaineis');
}

// Fichas de chegada: o essencial de cada lugar, ao chegar (e ao tocar no nome em "Onde estou")
carregarFichas();
function mostrarFicha(c) {
  if (!c || c.tipo === 'sonda' || c.tipo === 'cometa' || c.tipo === 'satelite' || c.soCeu) return;
  const terraAbs = PORID.terra.abs;
  const f = montarFicha(c, {
    sig, distancia, duracao, cat, PORID,
    dTerra: (o) => o.abs.distanceTo(terraAbs), dSol: (o) => o.abs.distanceTo(PORID.sol.abs),
    anoLuzSaiu: (km) => { const [quando, epoca] = quandoSaiu(tempoLuzAnos(km / AL) * 365.25 * 86400); return epoca ? `${quando} (${epoca})` : quando; },
  });
  $('fichaTipo').textContent = f.tipo;
  $('fichaNome').textContent = f.nome;
  $('fichaDados').textContent = '';
  for (const [titulo, linhas] of f.secoes) {
    const h4 = document.createElement('h4'), kv = document.createElement('div');
    h4.textContent = titulo; kv.className = 'kv';
    for (const [k, v] of linhas) {
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = k; b.textContent = v;
      kv.append(a, b);
    }
    $('fichaDados').append(h4, kv);
  }
  $('fichaCur').textContent = f.curiosidade;
  $('fichaFontes').textContent = '';
  if (f.fontes.length) {
    $('fichaFontes').append(tr('Fontes') + (f.consultado ? ` (${tr('consultadas em {d}', { d: new Date(f.consultado).toLocaleDateString(LOCALE, { timeZone: 'UTC' }) })})` : '') + ': ');
    f.fontes.forEach(([nome, url], i) => {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = nome;
      $('fichaFontes').append(i ? ' · ' : '', a);
    });
  }
  fichaAtual = f;
  $('ficha').hidden = false;
  if (ehCelular()) abrirAba(null); // no celular, uma coisa de cada vez
  // dados de catálogo (estrelas) e da descoberta (exoplanetas) chegam depois, na primeira vez
  if (precisaExtras(c)) carregarExtras().then(() => { if (!$('ficha').hidden && $('fichaNome').textContent === f.nome) mostrarFicha(c); });
}
let fichaAtual = null;
$('fichaCopiar').onclick = async () => {
  if (!fichaAtual) return;
  try { await navigator.clipboard.writeText(textoFicha(fichaAtual)); aviso(tr('Ficha copiada, com as fontes.')); } catch { aviso(tr('Não consegui copiar: o navegador bloqueou.')); }
};
function fecharFicha() { $('ficha').hidden = true; }
function chegou(c) { if (estado.fichas && !roteiro) mostrarFicha(c); }
$('fichaFechar').onclick = fecharFicha;
$('refFrame').onclick = () => estado.ref && mostrarFicha(estado.ref);
$('refFrame').title = tr('Ver a ficha');

// Celular (tela estreita): um painel de cada vez. O ☰ abre a lista dos painéis que fazem sentido agora;
// quando aparece um painel novo (o céu, ao apertar Z; "A bordo", ao embarcar), ele já abre.
const ABAS = ['pVel', 'pDest', 'pMissao', 'pCeu', 'pTerra', 'pPos', 'pTempo'];
const ehCelular = () => innerWidth <= 760;
function abaDisponivel(id) {
  const b = document.body.classList, el = $(id);
  if (id === 'pMissao') return b.contains('embarcado');
  if (id === 'pDest') return !b.contains('embarcado');
  if (id === 'pCeu') return b.contains('modoCeu');
  if (id === 'pTerra') return el.style.display !== 'none';
  return true;
}
const tituloAba = (id) => ($(id).querySelector(':scope > details > summary') ?? $(id).querySelector('h2'))?.textContent.trim() ?? id;
let abaAtual = null, abasAntes = new Set();
function abrirAba(id) {
  if (id) fecharFicha();
  for (const a of ABAS) $(a).classList.toggle('abaAtiva', a === id);
  abaAtual = id;
  $('menuAbas').hidden = true;
  if (id === 'pTerra') $('detTerra').open = true;
}
function abrirMenuAbas() {
  const m = $('menuAbas');
  if (!m.hidden) { m.hidden = true; return; }
  m.textContent = '';
  for (const id of ABAS.filter(abaDisponivel)) {
    const b = document.createElement('button');
    b.textContent = tituloAba(id);
    b.classList.toggle('ativo', id === abaAtual);
    b.onclick = () => abrirAba(id === abaAtual ? null : id);
    m.append(b);
  }
  const so = document.createElement('button');
  so.textContent = tr('Só a vista');
  so.onclick = () => abrirAba(null);
  m.append(so);
  m.hidden = false;
}
function vigiarAbas() {
  const cel = ehCelular();
  document.body.classList.toggle('celular', cel);
  if (!cel) { $('menuAbas').hidden = true; return; }
  const agora = new Set(ABAS.filter(abaDisponivel));
  for (const id of agora) if (!abasAntes.has(id) && (id === 'pCeu' || id === 'pMissao')) abrirAba(id);
  if (abaAtual && !agora.has(abaAtual)) abrirAba(null);
  abasAntes = agora;
}
setInterval(vigiarAbas, 400);
vigiarAbas();
for (const b of document.querySelectorAll('#toque button')) {
  const tecla = b.dataset.tecla, acao = b.dataset.acao;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (tecla) teclas.add(tecla);
    if (acao === 'pular') pular();
    else if (acao) definirV(estado.v * (acao === 'mais' ? 4 : 0.25));
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

chave('btViaReal', ['Via Láctea: mapa real (NASA)', 'Via Láctea: modelo'], () => estado.viaReal, () => (estado.viaReal = !estado.viaReal));
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
const periodo = (ma) => tr((PERIODOS.find(([fim]) => ma < fim) || PERIODOS[PERIODOS.length - 1])[1]);
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
  $('tempoMaTxt').textContent = ep.ma ? tr('há {n} milhões de anos · {p}', { n: ep.ma, p: periodo(ep.ma) }) : tr('hoje');
  $('textoEpoca').textContent = ep.texto ? tr(ep.texto) : ep.ma ? tr('Há {n} milhões de anos ({p}).', { n: ep.ma, p: periodo(ep.ma) }) : '';
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
function pintarGira() { $('btGira').textContent = tr(estado.giraJunto ? 'Girar com o planeta' : 'Não girar com o planeta'); $('btGira').classList.toggle('ativo', estado.giraJunto); }
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
  if (estado.ref !== E || altRef > E.raio * 3) return aviso(tr('Vá até a Terra (ou busque uma cidade) para olhar o céu de lá.'));
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
  aplicarCeuPendente();
}
function sairDoCeu() {
  restaurarV();
  if (estado.telescopio) alternarTelescopio();
  if (Math.abs(estado.jd - jdAgora()) > 1) aviso(tr('A simulação continua em {d}. Use "Agora" para voltar ao presente.', { d: data(estado.jd) }));
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
  $('zoomTxt').textContent = tr('{z}× · campo de {c}', { z: Math.round(estado.zoom), c: campo >= 1 ? `${sig(campo)}°` : `${Math.round(campo * 60)}'` });
  hudTelescopio();
}
function alternarTelescopio() {
  estado.telescopio = !estado.telescopio;
  if (estado.telescopio && !estado.ceuModo) { estado.telescopio = false; return aviso(tr('O telescópio é usado no modo céu (Z).')); }
  document.body.classList.toggle('telescopio', estado.telescopio);
  $('ocular').hidden = !estado.telescopio;
  for (const id of ['linhaZoom', 'linhaTel', 'zoomTxt']) $(id).hidden = !estado.telescopio;
  if (estado.telescopio) { definirZoom(estado.zoom); hudTelescopio(); }
  $('btTelescopio').textContent = tr(estado.telescopio ? 'Telescópio: ligado' : 'Telescópio: desligado');
  $('btTelescopio').classList.toggle('ativo', estado.telescopio);
}
chave('btTelescopio', ['Telescópio: ligado', 'Telescópio: desligado'], () => estado.telescopio, alternarTelescopio);
chave('btRastrear', ['Acompanhar as estrelas', 'Telescópio parado'], () => estado.rastrear, () => (estado.rastrear = !estado.rastrear));
$('zoomSlider').oninput = (e) => definirZoom(10 ** +e.target.value);
$('btApontar').onclick = () => apontar(estado.alvo);
// Dados e botões nas bordas escuras da ocular
const pintarRastrear = () => { $('hudRastrear').textContent = tr(estado.rastrear ? 'Acompanhando as estrelas' : 'Telescópio parado'); $('hudRastrear').classList.toggle('ativo', estado.rastrear); $('btRastrear').textContent = tr(estado.rastrear ? 'Acompanhar as estrelas' : 'Telescópio parado'); $('btRastrear').classList.toggle('ativo', estado.rastrear); };
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
  $('hudCampo').textContent = tr('Campo: {c}', { c: campo >= 1 ? `${sig(campo)}°` : `${Math.max(1, Math.round(campo * 60))}'` });
  $('hudLim').textContent = tr('Estrelas até a magnitude {m}', { m: limiteMag().toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  const a = estado.alvo;
  if (a && a.abs) {
    const up = estado.local.clone().normalize(), { norte, leste } = eixosLocais(up);
    const d = a.abs.clone().sub(camAbs()).normalize();
    const alt = Math.asin(Math.max(-1, Math.min(1, d.dot(up)))) / GRAU;
    const az = ((Math.atan2(d.dot(leste), d.dot(norte)) / GRAU) + 360) % 360;
    const fora = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q).angleTo(d) / GRAU > campo / 2;
    $('hudAlvo').textContent = tr('Alvo: {c} · {alt}° de altura, {ponto} ({az}°)', { c: a, alt: Math.round(alt), ponto: PONTOS[Math.round(az / 22.5) % 16], az: Math.round(az) }) + (alt < 0 ? tr(' · abaixo do horizonte') : fora ? tr(' · fora do campo') : '');
  } else $('hudAlvo').textContent = tr('Sem alvo: clique num nome no céu');
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
  // cada segmento vira uma faixa de 4 vértices (2 em cada ponta), com largura fixa na tela
  const nSeg = p.length / 6;
  const pos = new Float32Array(nSeg * 12), outra = new Float32Array(nSeg * 12), canto = new Float32Array(nSeg * 8), idx = new Uint32Array(nSeg * 6);
  for (let s = 0; s < nSeg; s++) {
    for (let v = 0; v < 4; v++) {
      const ponta = v >> 1, i = s * 4 + v; // vértices 0 e 1 na ponta A, 2 e 3 na ponta B
      for (let k = 0; k < 3; k++) { pos[i * 3 + k] = p[s * 6 + ponta * 3 + k]; outra[i * 3 + k] = p[s * 6 + (1 - ponta) * 3 + k]; }
      canto[i * 2] = ponta; canto[i * 2 + 1] = (v & 1 ? 1 : -1) * (ponta ? -1 : 1); // o lado inverte na ponta B (a direção também)
    }
    idx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('outra', new THREE.BufferAttribute(outra, 3));
  geo.setAttribute('canto', new THREE.BufferAttribute(canto, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  linhasConst = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: S.LINHA_CEU_V, fragmentShader: S.LINHA_CEU_F,
    uniforms: { opac: { value: 0.35 }, beta: { value: new THREE.Vector3() }, zenite: { value: new THREE.Vector3(0, 1, 0) }, refr: { value: 0 }, res: { value: new THREE.Vector2(1, 1) }, meia: { value: 0.6 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  linhasConst.frustumCulled = false;
  linhasConst.renderOrder = 4;
  linhasConst.visible = false;
  cena.add(linhasConst);
});
// ------------------------------- céu profundo: Messier e NGC/IC (OpenNGC, CC BY-SA 4.0) -------------------------------
// manchas suaves com o tamanho aparente real; aparecem conforme o limite de magnitude (olho, poluição, telescópio)
const TIPO_FORMA = { 'galáxia': 0, 'aglomerado globular': 1, 'aglomerado aberto': 2, 'nuvem de estrelas': 2, 'asterismo': 2, 'estrela dupla': 2, 'nebulosa planetária': 4 };
const corDoTipo = (t) => (t === 'galáxia' ? [1, 0.95, 0.85] : t === 'nebulosa planetária' ? [0.7, 1, 0.9] : t.includes('nebulosa') || t === 'resto de supernova' ? [0.8, 0.95, 0.88] : [0.95, 0.97, 1]);
const VERT_PROF = `#include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float tamanho, alfa; attribute vec4 forma; attribute vec3 cor;
  varying float vA; varying vec4 vF; varying vec3 vC;
  void main() { vA = alfa; vF = forma; vC = cor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = alfa > 0.0 ? tamanho : 0.0;
    #include <logdepthbuf_vertex>
  }`;
const FRAG_PROF = `#include <common>
  #include <logdepthbuf_pars_fragment>
  varying float vA; varying vec4 vF; varying vec3 vC;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float c = cos(vF.y), s = sin(vF.y);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    p.y /= max(vF.x, 0.08);           // achatamento (galáxias vistas de lado)
    float r = length(p), a = 0.0;
    int tipo = int(vF.z + 0.5);
    if (tipo == 0) a = exp(-r * r * 6.0) * 0.8 + exp(-r * r * 60.0) * 0.6;                // galáxia: halo e núcleo
    else if (tipo == 1) a = exp(-r * r * 9.0) * 0.6 + exp(-r * r * 40.0) * 0.9;           // globular: bola compacta
    else if (tipo == 2) a = exp(-r * r * 4.0) * 0.06; // aberto: as estrelas dele já estão no catálogo; só um véu tênue
    else if (tipo == 4) a = smoothstep(1.0, 0.55, r) * (0.55 + 0.45 * smoothstep(0.2, 0.6, r)); // planetária: disquinho
    else a = exp(-r * r * 3.0) * (0.4 + 0.6 * (0.6 * vn(p * 3.0 + vF.w * 17.0) + 0.4 * vn(p * 7.0 + vF.w * 31.0))); // nebulosa: nuvem irregular
    a *= smoothstep(1.0, 0.65, r); // borda que se dissolve
    gl_FragColor = vec4(vC * a * vA, 1.0);
  }`;
// um catálogo do céu profundo (pontos, nomes, busca), usado para os Messier e para o NGC/IC
function criarCatalogoProfundo(nMax, deveRotular) {
  const lista = [];
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(nMax * 3), tam = new Float32Array(nMax), alfa = new Float32Array(nMax), forma = new Float32Array(nMax * 4), cor = new Float32Array(nMax * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tamanho', new THREE.BufferAttribute(tam, 1));
  geo.setAttribute('alfa', new THREE.BufferAttribute(alfa, 1));
  geo.setAttribute('forma', new THREE.BufferAttribute(forma, 4));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  const pontos = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: VERT_PROF, fragmentShader: FRAG_PROF, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  pontos.frustumCulled = false; pontos.renderOrder = 2; pontos.visible = false;
  cena.add(pontos);
  function adicionar(o) {
    const i = lista.length;
    if (i >= nMax) return null;
    const dir = radecParaCena(o.ra, o.dec, 1).normalize();
    const obj = { ...o, dir, soCeu: true, el: null, get abs() { return camAbs().addScaledVector(dir, 1e15); } };
    forma.set([o.tamMin && o.tam ? o.tamMin / o.tam : 1, 0, TIPO_FORMA[o.tipo] ?? 3, (i * 0.137) % 1], i * 4);
    cor.set(corDoTipo(o.tipo), i * 3);
    lista.push(obj);
    geo.setDrawRange(0, lista.length);
    return obj;
  }
  function rotuloDe(o) { // os nomes são criados só quando aparecem pela primeira vez
    if (o.el) return o.el;
    const el = document.createElement('div');
    el.className = 'messier';
    el.textContent = o.textoRotulo;
    el.style.display = 'none';
    el.onclick = () => { estado.alvo = o; aviso(`${o.nome} · ${tr(o.tipo)}${o.mag ? `, ${tr('magnitude')} ${o.mag.toLocaleString(LOCALE)}` : ''}`); };
    camadaRot.append(el);
    o.el = el;
    return el;
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function desenhar(postos, pxPorRad, ligado) {
    const ver = ligado && lista.length && camAbs().distanceTo(PORID.sol.abs) < 1000 * UA;
    pontos.visible = !!ver;
    if (!ver) { for (const o of lista) if (o.el) o.el.style.display = 'none'; return; }
    geo.attributes.forma.needsUpdate = true; // as cores e formas iniciais também
    geo.attributes.cor.needsUpdate = true;
    const lim = limiteMag(), up = estado.ceuModo ? estado.local.clone().normalize() : null, ca = camAbs();
    const norteCeu = radecParaCena(0, 90, 1).normalize();
    for (let i = 0; i < lista.length; i++) {
      const o = lista[i];
      // visível se o brilho total passa do limite; a intensidade vem do brilho de superfície (magnitude por minuto de arco²):
      // grandes e espalhados (Hélice, Andrômeda) ficam tênues; compactos (globulares, planetárias pequenas) ficam vivos
      const m = o.mag ?? 11, t1 = o.tam || 2, t2 = o.tamMin || t1;
      const vis = Math.min(Math.max((lim - (m + 0.5) + 0.5) / 1.5, 0), 1);
      const sb = m + 2.5 * Math.log10(Math.max(0.785 * t1 * t2, 0.5));
      let a = vis ? vis * Math.min(0.5 * 10 ** (-0.4 * (sb - 12.5)), 0.9) * (1 - diaNoCeu) * (1 - luar * 0.5) : 0;
      if (a > 0 && (up ? o.dir.dot(up) < -0.02 : atrasDaTerra(ca, _b.copy(o.dir).multiplyScalar(1e7).add(ca)))) a = 0; // abaixo do horizonte
      const px = Math.max(((o.tam || 2) / 60) * GRAU * pxPorRad, 5);
      if (px > 900) a *= Math.max(0, 1 - (px - 900) / 300); // grande demais para um ponto: some (galáxias grandes têm desenho próprio)
      alfa[i] = a > 0.015 ? a : 0;
      if (o.el) o.el.style.display = 'none';
      if (!alfa[i]) continue;
      aberrarJS(_a.copy(o.dir).multiplyScalar(1e9)).toArray(pos, i * 3);
      tam[i] = Math.min(px, 1200) * renderer.getPixelRatio();
      if (o.ang != null) { // orientação na tela: ângulo de posição medido a partir do norte celeste
        const p0 = _b.copy(o.dir).multiplyScalar(1e9).applyMatrix4(camera.matrixWorldInverse);
        const p1 = _a.copy(o.dir).addScaledVector(norteCeu, 1e-3).normalize().multiplyScalar(1e9).applyMatrix4(camera.matrixWorldInverse);
        forma[i * 4 + 1] = Math.atan2(p1.y / -p1.z - p0.y / -p0.z, p1.x / -p1.z - p0.x / -p0.z) - Math.PI / 2 + o.ang * GRAU;
      }
      if (!(estado.nomes && diaNoCeu < 0.5 && (o === estado.alvo || deveRotular(o, a)))) continue;
      projetado.copy(o.dir).multiplyScalar(1e9);
      aberrarJS(projetado).applyMatrix4(camera.matrixWorldInverse);
      if (projetado.z >= 0) continue;
      projetado.applyMatrix4(camera.projectionMatrix);
      const x = (projetado.x * 0.5 + 0.5) * innerWidth, y = (-projetado.y * 0.5 + 0.5) * innerHeight;
      if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
      const caixa = [x, y - 8, x + o.textoRotulo.length * 6.2 + 12, y + 8];
      if (o !== estado.alvo && postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) continue;
      postos.push(caixa);
      const el = rotuloDe(o);
      el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.display = '';
      el.classList.toggle('alvo', o === estado.alvo);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.tamanho.needsUpdate = true;
    geo.attributes.alfa.needsUpdate = true;
  }
  return { lista, adicionar, desenhar };
}
const irParaProfundo = (obj) => { estado.alvo = obj; if (estado.ceuModo) apontar(obj); else aviso(tr('{c}: olhe o céu de um lugar da Terra (Z) e use o telescópio.', { c: obj.nome })); };
// Messier: todos com nome quando visíveis
const catMessier = criarCatalogoProfundo(110, (o, a) => a > 0.06);
const messier = catMessier.lista;
fetch('dados/messier.json').then((r) => r.json()).then((lista) => {
  for (const o of lista) {
    if (o.nome) o.nome = tr(o.nome);
    const rotulo = `M${o.m}${o.nome ? ` · ${o.nome}` : ''}`;
    const obj = catMessier.adicionar({ ...o, id: `m${o.m}`, nome: rotulo, textoRotulo: o.nome ? `M${o.m} ${o.nome}` : `M${o.m}` });
    addBusca(`${rotulo} · ${tr(o.tipo)} (Messier)`, `m${o.m}`, 1e10, () => irParaProfundo(obj));
    if (o.nome) addBusca(`${o.nome} · M${o.m}`, o.nome, 1e10, () => irParaProfundo(obj));
  }
});
// NGC e IC: só os famosos (com nome) ou, no telescópio, os bem visíveis ganham o nome escrito
const catNGC = criarCatalogoProfundo(6000, (o, a) => (o.nomePt ? a > 0.08 : estado.telescopio && a > 0.3));
fetch('dados/ngc.json').then((r) => r.json()).then(({ tipos, objetos }) => {
  for (const [ra, dec, mag, tam, tamMin, ang, t, id, nomeOriginal] of objetos) {
    const nomePt = nomeOriginal && tr(nomeOriginal); // (nome no idioma da interface)
    const nome = nomePt ? `${id} · ${nomePt}` : id;
    const obj = catNGC.adicionar({ ra, dec, mag, tam, tamMin, ang, tipo: tipos[t], id: id.replace(' ', '').toLowerCase(), nome, nomePt, textoRotulo: nomePt || id });
    if (!obj) break;
    addBusca(`${nome} · ${tr(tipos[t])}`, id, nomePt ? 5e9 : 1e6, () => irParaProfundo(obj));
    if (nomePt) addBusca(`${nomePt} · ${id}`, nomePt, 5e9, () => irParaProfundo(obj));
  }
});
function desenharMessier(postos, pxPorRad) {
  catMessier.desenhar(postos, pxPorRad, estado.messier);
  catNGC.desenhar(postos, pxPorRad, estado.messier);
}
chave('btMessier', ['Céu profundo (Messier, NGC, IC): ligado', 'Céu profundo: desligado'], () => estado.messier, () => (estado.messier = !estado.messier));
chave('btRefracao', ['Refração: ligada', 'Refração: desligada'], () => estado.refracao, () => (estado.refracao = !estado.refracao));
$('selPoluicao').onchange = (e) => { estado.bortle = +e.target.value; e.target.blur(); };
// ------------------------------- chuvas de meteoros (calendário da Organização Internacional de Meteoros) -------------------------------
// [início], [fim], [pico] = [mês, dia]; zhr = taxa por hora com o radiante no zênite num céu perfeito; v = km/s; larg = dias (queda da atividade)
const CHUVAS = [
  { nome: 'Quadrântidas', ini: [12, 28], fim: [1, 12], pico: [1, 3], zhr: 80, ra: 230, dec: 49, v: 41, larg: 0.6 },
  { nome: 'Líridas', ini: [4, 14], fim: [4, 30], pico: [4, 22], zhr: 18, ra: 271, dec: 34, v: 49, larg: 1.5 },
  { nome: 'Eta Aquáridas', ini: [4, 19], fim: [5, 28], pico: [5, 6], zhr: 50, ra: 338, dec: -1, v: 66, larg: 5 },
  { nome: 'Delta Aquáridas do Sul', ini: [7, 12], fim: [8, 23], pico: [7, 30], zhr: 25, ra: 340, dec: -16, v: 41, larg: 5 },
  { nome: 'Alfa Capricornídeas', ini: [7, 3], fim: [8, 15], pico: [7, 30], zhr: 5, ra: 307, dec: -10, v: 23, larg: 6 },
  { nome: 'Perseidas', ini: [7, 17], fim: [8, 24], pico: [8, 12], zhr: 100, ra: 48, dec: 58, v: 59, larg: 2.5 },
  { nome: 'Draconídeas', ini: [10, 6], fim: [10, 10], pico: [10, 8], zhr: 10, ra: 262, dec: 54, v: 20, larg: 0.5 },
  { nome: 'Táuridas do Sul', ini: [9, 10], fim: [11, 20], pico: [10, 10], zhr: 5, ra: 32, dec: 9, v: 27, larg: 15 },
  { nome: 'Oriônidas', ini: [10, 2], fim: [11, 7], pico: [10, 21], zhr: 20, ra: 95, dec: 16, v: 66, larg: 4 },
  { nome: 'Táuridas do Norte', ini: [10, 20], fim: [12, 10], pico: [11, 12], zhr: 5, ra: 58, dec: 22, v: 29, larg: 12 },
  { nome: 'Leônidas', ini: [11, 6], fim: [11, 30], pico: [11, 17], zhr: 15, ra: 152, dec: 22, v: 71, larg: 1.5 },
  { nome: 'Geminídeas', ini: [12, 4], fim: [12, 20], pico: [12, 14], zhr: 150, ra: 112, dec: 33, v: 35, larg: 1.2 },
  { nome: 'Úrsidas', ini: [12, 17], fim: [12, 26], pico: [12, 22], zhr: 10, ra: 217, dec: 76, v: 33, larg: 1 },
].map((c) => ({ ...c, dir: radecParaCena(c.ra, c.dec, 1).normalize() }));
const diaDoAno = (m, d) => Date.UTC(2001, m - 1, d) / 86400000 - Date.UTC(2001, 0, 1) / 86400000;
// dias até o pico (com sinal), se a chuva estiver ativa nesta data; senão null
function diasDoPico(c) {
  const t = new Date((estado.jd - 2440587.5) * 86400000);
  const hoje = diaDoAno(t.getUTCMonth() + 1, t.getUTCDate()) + t.getUTCHours() / 24;
  const dentro = (x, a, b) => (a <= b ? x >= a && x <= b + 1 : x >= a || x <= b + 1);
  if (!dentro(hoje, diaDoAno(...c.ini), diaDoAno(...c.fim))) return null;
  let d = hoje - diaDoAno(...c.pico);
  if (d > 182) d -= 365; else if (d < -182) d += 365;
  return d;
}
const limOlho = () => (estado.bortle ? 7.8 - 0.5 * (estado.bortle - 1) : 6.5) - luar * 2;
// taxa visível por hora de cada chuva ativa agora (radiante acima do horizonte, céu escuro)
function taxasMeteoros() {
  const up = estado.local.clone().normalize(), lim = limOlho(), r = 2.5;
  return CHUVAS.map((c) => {
    const d = diasDoPico(c);
    if (d === null) return null;
    const zhr = c.zhr * Math.exp(-Math.abs(d) / c.larg);
    const h = c.dir.dot(up);
    return { c, d, zhr, hr: Math.max(h, 0) * zhr * r ** (lim - 6.5) };
  }).filter(Boolean);
}
function textoMeteoros() {
  const t = taxasMeteoros().sort((a, b) => b.zhr - a.zhr);
  if (!t.length) return tr('nenhuma chuva ativa; só os esporádicos (~5 por hora num céu escuro)');
  return t.slice(0, 3).map(({ c, d, hr }) => {
    const pico = Math.abs(d) < 0.6 ? tr('no pico') : d < 0 ? tn(Math.round(-d), 'pico em {n} dia', 'pico em {n} dias') : tn(Math.round(d), 'pico há {n} dia', 'pico há {n} dias');
    return `${tr(c.nome)} (${pico}; ${hr < 0.5 ? tr('radiante baixo ou abaixo do horizonte agora') : tr('~{n} por hora agora', { n: Math.round(hr) })})`;
  }).join(' · ');
}
// desenho: riscos que saem do radiante (linhas) com a cabeça brilhante (ponto)
const N_MET = 48;
const geoMet = new THREE.BufferGeometry(), geoCab = new THREE.BufferGeometry();
const posMet = new Float32Array(N_MET * 6), alfaMet = new Float32Array(N_MET * 2), posCab = new Float32Array(N_MET * 3), tamCab = new Float32Array(N_MET);
geoMet.setAttribute('position', new THREE.BufferAttribute(posMet, 3));
geoMet.setAttribute('alfa', new THREE.BufferAttribute(alfaMet, 1));
geoCab.setAttribute('position', new THREE.BufferAttribute(posCab, 3));
geoCab.setAttribute('tamanho', new THREE.BufferAttribute(tamCab, 1));
const vMet = '#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float alfa; attribute float tamanho; varying float vA;\nvoid main() { vA = alfa; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = tamanho;\n#include <logdepthbuf_vertex>\n}';
const fMet = '#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vA; uniform float ponto;\nvoid main() {\n#include <logdepthbuf_fragment>\n float a = vA; if (ponto > 0.5) { vec2 p = gl_PointCoord * 2.0 - 1.0; a = exp(-dot(p, p) * 3.0); }\n gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * a, 1.0);\n}';
const linhasMet = new THREE.LineSegments(geoMet, new THREE.ShaderMaterial({ vertexShader: vMet, fragmentShader: fMet, uniforms: { ponto: { value: 0 } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
geoCab.setAttribute('alfa', new THREE.BufferAttribute(new Float32Array(N_MET).fill(1), 1));
const cabecasMet = new THREE.Points(geoCab, new THREE.ShaderMaterial({ vertexShader: vMet, fragmentShader: fMet, uniforms: { ponto: { value: 1 } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
for (const o of [linhasMet, cabecasMet]) { o.frustumCulled = false; o.renderOrder = 5; o.visible = false; cena.add(o); }
const meteoros = [];
let tMet = performance.now();
function rodar(v, eixo, ang) { return v.clone().applyAxisAngle(eixo, ang); }
function novoMeteoro(radiante, vel, up) {
  // ponto do céu acima de 15°, afastado do radiante; o risco anda para longe dele, ao longo de um grande círculo
  for (let k = 0; k < 20; k++) {
    const p = new THREE.Vector3().randomDirection();
    if (p.dot(up) < 0.26) continue;
    const dr = radiante ? Math.acos(Math.min(1, p.dot(radiante))) : 1;
    if (radiante && (dr < 0.08 || dr > 1.9)) continue;
    const eixo = radiante ? new THREE.Vector3().crossVectors(radiante, p).normalize() : new THREE.Vector3().randomDirection().cross(p).normalize();
    const comp = (0.1 + 0.35 * Math.sin(Math.min(dr, Math.PI / 2))) * (0.5 + Math.random() * 0.7); // radianos
    const lim = limOlho(), mag = lim - Math.log(Math.random()) / Math.log(2.5) * -1;
    const brilho = Math.min(1, 10 ** (-0.4 * (Math.min(mag, lim) - lim + 1.2)));
    meteoros.push({ p, eixo, comp, t: 0, dur: 0.25 + 1.1 * (1 - (vel - 11) / 61) * (0.6 + Math.random() * 0.6), brilho, mag });
    return;
  }
}
function desenharMeteoros() {
  const agora = performance.now(), dt = window.__congelarMeteoros ? 0 : Math.min((agora - tMet) / 1000, 0.1); // (congelar: só para testes)
  tMet = agora;
  const ligado = estado.ceuModo && estado.meteoros && diaNoCeu < 0.5 && !estado.telescopio;
  linhasMet.visible = cabecasMet.visible = ligado && meteoros.length > 0;
  if (!ligado) { meteoros.length = 0; return; }
  const up = estado.local.clone().normalize(), fator = estado.meteoros10 ? 10 : 1;
  // novos meteoros (processo de Poisson): chuvas ativas + esporádicos (~5 por hora)
  if (meteoros.length < N_MET) {
    for (const { c, hr } of taxasMeteoros()) if (Math.random() < (hr * fator / 3600) * dt) novoMeteoro(c.dir, c.v, up);
    if (Math.random() < (5 * fator * 2.5 ** (limOlho() - 6.5) / 3600) * dt) novoMeteoro(null, 30 + Math.random() * 40, up);
  }
  let k = 0;
  for (let i = meteoros.length - 1; i >= 0; i--) {
    const m = meteoros[i];
    m.t += dt / m.dur;
    if (m.t >= 1 || k >= N_MET) { meteoros.splice(i, 1); continue; }
    const fade = Math.sin(Math.PI * Math.min(m.t, 1)) ** 0.7;
    const cabeca = rodar(m.p, m.eixo, m.comp * m.t), cauda = rodar(m.p, m.eixo, m.comp * Math.max(m.t - 0.35, 0));
    aberrarJS(cabeca.multiplyScalar(1e9)).toArray(posMet, k * 6);
    aberrarJS(cauda.multiplyScalar(1e9)).toArray(posMet, k * 6 + 3);
    alfaMet[k * 2] = m.brilho * fade; alfaMet[k * 2 + 1] = 0;
    posCab.set(posMet.subarray(k * 6, k * 6 + 3), k * 3);
    tamCab[k] = (2 + 6 * m.brilho * (m.mag < 0 ? 2 : 1)) * fade * renderer.getPixelRatio();
    k++;
  }
  for (let j = k; j < N_MET; j++) { alfaMet[j * 2] = alfaMet[j * 2 + 1] = 0; tamCab[j] = 0; }
  geoMet.setDrawRange(0, k * 2); geoCab.setDrawRange(0, k);
  geoMet.attributes.position.needsUpdate = true; geoMet.attributes.alfa.needsUpdate = true;
  geoCab.attributes.position.needsUpdate = true; geoCab.attributes.tamanho.needsUpdate = true;
}
chave('btMeteoros', ['Meteoros: ligados', 'Meteoros: desligados'], () => estado.meteoros, () => (estado.meteoros = !estado.meteoros));
chave('btMeteoros10', ['Meteoros: 10× mais', 'Meteoros: taxa real'], () => estado.meteoros10, () => (estado.meteoros10 = !estado.meteoros10));
// ------------------------------- nuvens do dia (NASA GIBS: VIIRS desde 2015, MODIS desde 2000) -------------------------------
// uma foto do planeta inteiro por dia; entre um dia e o seguinte, as duas se misturam (e, com a chave, derivam com ventos ilustrativos)
const nuvensCache = new Map(); // 'AAAA-MM-DD' → { tex, estado }
let nuvemPedidaEm = 0;
const diaTexto = (ms) => new Date(ms).toISOString().slice(0, 10);
function pedirNuvens(dia) {
  let e = nuvensCache.get(dia);
  if (e) return e;
  if (performance.now() - nuvemPedidaEm < 400) return null; // não inunda o servidor quando o tempo corre rápido
  nuvemPedidaEm = performance.now();
  const camada = dia >= '2015-11-24' ? 'VIIRS_SNPP_CorrectedReflectance_TrueColor' : 'MODIS_Terra_CorrectedReflectance_TrueColor';
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${camada}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg&TIME=${dia}`;
  e = { estado: 'baixando', tex: null };
  nuvensCache.set(dia, e);
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; e.tex = t;
    e.estado = fotoCompleta(t.image) ? 'pronto' : 'incompleta';
  }, undefined, () => { e.estado = 'erro'; });
  if (nuvensCache.size > 6) { const [k, v] = nuvensCache.entries().next().value; v.tex?.dispose(); nuvensCache.delete(k); }
  return e;
}
// A foto de um dia recente pode vir com faixas sem dado (preto) enquanto a NASA ainda processa as órbitas:
// conta os pixels pretos entre as latitudes ±60° (os polos ficam pretos de verdade na noite polar)
function fotoCompleta(img) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 256, 128);
  const px = g.getImageData(0, 21, 256, 86).data;
  let pretos = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 24) pretos++;
  return pretos / (px.length / 4) < 0.02;
}
// a foto mais recente que estiver completa, a partir do dia pedido e recuando até 4 dias
function fotoUsavel(meio) {
  for (let k = 0; k < 5; k++) {
    const e = pedirNuvens(diaTexto(meio - k * 86400000));
    if (!e || e.estado === 'baixando') return null;
    if (e.estado === 'pronto') return { e, meio: meio - k * 86400000 };
  }
  return null;
}
// devolve true se as nuvens reais estão prontas e preenche os uniforms
function nuvensDoDia(u) {
  u.real.value = 0;
  if (!estado.nuvensReais) return false;
  const ms = (estado.jd - 2440587.5) * 86400000;
  if (ms < Date.UTC(2000, 1, 24)) return false; // antes das fotos diárias: nuvens genéricas
  const ontem = Date.now() - 86400000 * 1.2; // a foto de hoje ainda pode não estar pronta
  const msUsado = Math.min(ms, ontem);
  // cada foto vale para o meio-dia (UTC) do dia dela
  const meio = Math.floor((msUsado - 43200000) / 86400000) * 86400000 + 43200000;
  const achado = fotoUsavel(meio);
  if (!achado) return false;
  const A = achado.e, recuou = achado.meio !== meio;
  const B = ms < ontem && !recuou ? pedirNuvens(diaTexto(meio + 86400000)) : A;
  u.mapaA.value = A.tex;
  u.mapaB.value = B && B.estado === 'pronto' ? B.tex : A.tex;
  const horas = (msUsado - meio) / 3600000;
  u.mistura.value = B && B.estado === 'pronto' ? horas / 24 : 0;
  u.horas.value = horas;
  u.deriva.value = estado.nuvensDeriva ? 1 : 0;
  u.real.value = 1;
  return true;
}
chave('btNuvens', ['Nuvens: do dia (NASA)', 'Nuvens: genéricas'], () => estado.nuvensReais, () => (estado.nuvensReais = !estado.nuvensReais));
chave('btNuvensDeriva', ['Nuvens em movimento (ilustrativo)', 'Nuvens paradas'], () => estado.nuvensDeriva, () => (estado.nuvensDeriva = !estado.nuvensDeriva));
// ------------------------------- sondas em 3D (NASA 3D Resources, livres de direitos) -------------------------------
const MODELOS = { voyager1: 'voyager', voyager2: 'voyager', cassini: 'cassini', juno: 'juno', jwst: 'jwst', parker: 'parker', hubble: 'hubble', iss: 'iss', pioneer10: 'pioneer10', pioneer11: 'pioneer10', rosetta: 'rosetta',
  dawn: 'dawn', deepimpact: 'deepimpact', galileo: 'galileo', kepler: 'kepler', messenger: 'messenger', osirisrex: 'osirisrex', spitzer: 'spitzer', ulysses: 'ulysses', stardust: 'stardust' };
const TAMANHO_M = { voyager: 13, cassini: 6.8, juno: 20, jwst: 21, parker: 3, hubble: 13.2, iss: 109, pioneer10: 5, rosetta: 32,
  dawn: 19.7, deepimpact: 7.5, galileo: 11, kepler: 4.7, messenger: 6, osirisrex: 6.2, spitzer: 4.5, ulysses: 6, stardust: 5 }; // maior dimensão real, em metros
const luzModelo = new THREE.DirectionalLight(0xffffff, 3.2);
const luzAmbModelo = new THREE.AmbientLight(0x8090a0, 0.25);
cena.add(luzModelo, luzModelo.target, luzAmbModelo);
const modelos = new Map();
const carregadorGLTF = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('vendor/draco/')); // modelos da NASA vêm comprimidos (Draco)
function modeloDe(nome) {
  let m = modelos.get(nome);
  if (m) return m;
  m = { grupo: new THREE.Group(), pronto: false };
  modelos.set(nome, m);
  m.grupo.visible = false;
  cena.add(m.grupo);
  carregadorGLTF.load(`modelos/${nome}.glb`, (g) => {
    const caixa = new THREE.Box3().setFromObject(g.scene), tam = caixa.getSize(new THREE.Vector3()), centro = caixa.getCenter(new THREE.Vector3());
    g.scene.position.sub(centro); // centraliza
    const esc = (TAMANHO_M[nome] / 1000) / Math.max(tam.x, tam.y, tam.z); // em km, no tamanho real
    m.grupo.scale.setScalar(esc);
    m.grupo.add(g.scene);
    m.pronto = true;
  }, undefined, () => { m.erro = true; });
  return m;
}
const _fr = new THREE.Vector3();
function desenharModelo(abs) {
  for (const m of modelos.values()) m.grupo.visible = false;
  const o = estado.embarcado, nome = o && MODELOS[o.id];
  $('mVista').hidden = !nome;
  if (!nome) return;
  const m = modeloDe(nome);
  if (!m.pronto || !estado.vistaFora) return;
  const rel = o.abs.clone().sub(abs);
  m.grupo.position.copy(rel);
  // a antena (ou o lado de cima do modelo) aproximadamente voltada para a Terra
  m.grupo.lookAt(_fr.copy(rel).add(PORID.terra.abs).sub(o.abs));
  m.grupo.visible = true;
  luzModelo.position.copy(rel).add(_fr.copy(PORID.sol.abs).sub(o.abs).normalize());
  luzModelo.target.position.copy(rel);
}
// de fora: a câmera fica atrás do olhar, a ~2,5 vezes o tamanho da sonda; arrastar gira em volta dela
function posicionarVistaFora() {
  const o = estado.embarcado, nome = o && MODELOS[o.id];
  if (!nome || !estado.vistaFora) return;
  const dist = (TAMANHO_M[nome] / 1000) * 2.5;
  estado.local.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q)).multiplyScalar(-dist);
}
function pintarVista() { $('mVista').textContent = tr(estado.vistaFora ? 'Vista: de fora (sonda em 3D)' : 'Vista: de dentro'); $('mVista').classList.toggle('ativo', estado.vistaFora); }
$('mVista').onclick = () => {
  estado.vistaFora = !estado.vistaFora;
  if (!estado.vistaFora) estado.local.set(0.001, 0, 0);
  else if (estado.embarcado) modeloDe(MODELOS[estado.embarcado.id]);
  pintarVista();
};
pintarVista();
// ------------------------------- frota de satélites (pontos) -------------------------------
const geoFrota = new THREE.BufferGeometry();
let capFrota = 0;
const pontosFrota = new THREE.Points(geoFrota, new THREE.ShaderMaterial({
  vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float alfa; varying float vA; uniform float tam;\nvoid main() { vA = alfa; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = alfa > 0.0 ? tam * (0.6 + 0.8 * alfa) : 0.0;\n#include <logdepthbuf_vertex>\n}',
  fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vA;\nvoid main() {\n#include <logdepthbuf_fragment>\n vec2 p = gl_PointCoord * 2.0 - 1.0; gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * vA * exp(-dot(p, p) * 2.5), 1.0);\n}',
  uniforms: { tam: { value: 3 } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
}));
pontosFrota.frustumCulled = false; pontosFrota.renderOrder = 4; pontosFrota.visible = false;
cena.add(pontosFrota);
estado.satGrupo = 'visual';
$('selSatelites').onchange = (e) => { estado.satGrupo = e.target.value; e.target.blur(); };
function desenharFrota(abs) {
  const E = PORID.terra, d = abs.distanceTo(E.abs);
  const perto = d < 2e6 && estado.ref !== null;
  if (!perto || !estado.satGrupo) { pontosFrota.visible = false; if (!estado.satGrupo && frotaSat.frota.grupo) frotaSat.carregar(null); return; }
  frotaSat.carregar(estado.satGrupo);
  const f = frotaSat.frota;
  if (f.falhou) { f.falhou = false; estado.satGrupo = 'visual'; $('selSatelites').value = 'visual'; aviso(tr('O CelesTrak só libera a lista completa a cada 2 horas; por enquanto, os satélites mais brilhantes.')); }
  if (!f.n) { pontosFrota.visible = false; return; }
  if (capFrota < f.n) {
    capFrota = f.n;
    geoFrota.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capFrota * 3), 3));
    geoFrota.setAttribute('alfa', new THREE.BufferAttribute(new Float32Array(capFrota), 1));
  }
  // os mais brilhantes: todos a cada quadro; os 11 mil: em rodízio (o tempo acelerado demais deixaria todos atrasados)
  frotaSat.atualizar(estado.jd, f.grupo === 'visual' ? f.n : 1000); // 11 mil: mil recalculados por quadro, os outros avançam pela velocidade
  const P = geoFrota.attributes.position.array, A = geoFrota.attributes.alfa.array;
  const lim = estado.ceuModo ? limOlho() : 7.5, base = f.grupo === 'visual' ? 4.5 : 6.5;
  const rel = _e2.copy(E.abs).sub(abs);
  for (let i = 0; i < f.n; i++) {
    const x = f.pos[i * 3];
    if (x !== x || (estado.ceuModo && !f.luz[i])) { A[i] = 0; continue; }
    const px = rel.x + x, py = rel.y + f.pos[i * 3 + 1], pz = rel.z + f.pos[i * 3 + 2];
    P[i * 3] = px; P[i * 3 + 1] = py; P[i * 3 + 2] = pz;
    if (!estado.ceuModo) { A[i] = f.luz[i] ? 0.55 : 0.12; continue; } // do espaço: todos como pontinhos (apagados na sombra da Terra)
    const dist = Math.sqrt(px * px + py * py + pz * pz);
    const m = base + 5 * Math.log10(Math.max(dist, 200) / 1000);
    A[i] = Math.min(1, 10 ** (-0.4 * (m - lim))) * (1 - diaNoCeu);
    if (A[i] < 0.03) A[i] = 0;
  }
  geoFrota.setDrawRange(0, f.n);
  geoFrota.attributes.position.needsUpdate = true; geoFrota.attributes.alfa.needsUpdate = true;
  pontosFrota.material.uniforms.tam.value = (estado.ceuModo ? 3 : 2) * renderer.getPixelRatio();
  pontosFrota.visible = true;
}
// ------------------------------- asteroides e cometas (JPL Small-Body Database) -------------------------------
// cada um na própria órbita (dois corpos, elementos osculantes); brilho pelo sistema H-G (asteroides) ou M1/K1 (cometas)
const pequenos = []; // { nome, tipo, el, abs, mag, ... }
const geoPeq = new THREE.BufferGeometry();
let posPeq = null, alfaPeq = null, tamPeq = null;
const pontosPeq = new THREE.Points(geoPeq, new THREE.ShaderMaterial({
  vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nattribute float alfa, tamanho; varying float vA;\nvoid main() { vA = alfa; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = alfa > 0.0 ? tamanho : 0.0;\n#include <logdepthbuf_vertex>\n}',
  fragmentShader: '#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying float vA;\nvoid main() {\n#include <logdepthbuf_fragment>\n vec2 p = gl_PointCoord * 2.0 - 1.0; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vA * exp(-dot(p, p) * 3.0), 1.0);\n}',
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
}));
pontosPeq.frustumCulled = false; pontosPeq.renderOrder = 4; pontosPeq.visible = false;
cena.add(pontosPeq);
const K_GAUSS = 0.01720209895; // constante gravitacional de Gauss (UA, dias)
// posição heliocêntrica (km, eixos da cena) a partir de q (periélio, UA), e, i, Ω, ω (graus) e tempo desde o periélio (dias)
function posOrbital(q, e, i, om, w, dtPeri, out) {
  let x, y;
  if (e < 0.98) { // elíptica
    const a = q / (1 - e), n = K_GAUSS / Math.sqrt(a * a * a);
    let M = (n * dtPeri) % (2 * Math.PI), E = M + e * Math.sin(M);
    for (let k = 0; k < 12; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-10) break; }
    x = a * (Math.cos(E) - e); y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else { // quase parabólica ou hiperbólica: equação de Barker (parábola) como aproximação suficiente para o brilho e a posição no céu
    const W = 3 * K_GAUSS / Math.sqrt(2 * q * q * q) * dtPeri;
    const Y = Math.cbrt(W + Math.sqrt(W * W + 1));
    const tv2 = Y - 1 / Y; // tan(ν/2)
    const nu = 2 * Math.atan(tv2), r = q * (1 + tv2 * tv2);
    x = r * Math.cos(nu); y = r * Math.sin(nu);
  }
  const O = om * GRAU, W2 = w * GRAU, I = i * GRAU;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(W2), sw = Math.sin(W2), ci = Math.cos(I), si = Math.sin(I);
  const X = (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y;
  const Yv = (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y;
  const Z = (sw * si) * x + (cw * si) * y;
  return out.set(X * UA, Z * UA, -Yv * UA).add(PORID.sol.abs); // eclíptica J2000 → cena
}
Promise.all([fetch('dados/asteroides.json').then((r) => r.json()), fetch('dados/cometas.json').then((r) => r.json())]).then(([a, c]) => {
  for (const [nome, sa, e, i, om, w, ma, ep, H, G] of a.dados) {
    if (nome === '1 Ceres' || nome === '4 Vesta') continue; // são corpos de verdade (js/corpos.js)
    const q = sa * (1 - e), n = K_GAUSS / Math.sqrt(sa ** 3);
    const tp = ep - (ma * GRAU) / n; // instante do periélio equivalente
    pequenos.push({ nome, tipo: 'asteroide', q, e, i, om, w, tp, H, G, abs: new THREE.Vector3(), soCeu: true, textoRotulo: nome.replace(/^\d+ /, '') });
  }
  for (const [nome, q, e, i, om, w, tp, M1, K1] of c.dados) pequenos.push({ nome, tipo: 'cometa ', q, e, i, om, w, tp, M1, K1, abs: new THREE.Vector3(), soCeu: true, textoRotulo: nome });
  const n = pequenos.length;
  posPeq = new Float32Array(n * 3); alfaPeq = new Float32Array(n); tamPeq = new Float32Array(n);
  geoPeq.setAttribute('position', new THREE.BufferAttribute(posPeq, 3));
  geoPeq.setAttribute('alfa', new THREE.BufferAttribute(alfaPeq, 1));
  geoPeq.setAttribute('tamanho', new THREE.BufferAttribute(tamPeq, 1));
  for (const o of pequenos) {
    if (o.tipo === 'asteroide' ? o.H < 7.5 : false) addBusca(`${o.textoRotulo} · asteroide`, o.textoRotulo, 2e9, () => irParaProfundo(o));
  }
  for (const o of pequenos) if (o.tipo !== 'asteroide') addBusca(`${o.nome} · cometa`, o.nome, 1e8, () => irParaProfundo(o));
});
let iPeq = 0;
const _pq = new THREE.Vector3();
function magnitudePequeno(o, camPos) {
  const r = o.abs.distanceTo(PORID.sol.abs) / UA, d = Math.max(o.abs.distanceTo(camPos) / UA, 1e-6);
  if (o.tipo === 'asteroide') {
    const cosA = Math.min(1, Math.max(-1, (r * r + d * d - (camPos.distanceTo(PORID.sol.abs) / UA) ** 2) / (2 * r * d)));
    const t = Math.tan(Math.acos(cosA) / 2);
    const f = (1 - o.G) * Math.exp(-3.33 * t ** 0.63) + o.G * Math.exp(-1.87 * t ** 1.22);
    return o.H + 5 * Math.log10(r * d) - 2.5 * Math.log10(Math.max(f, 1e-6));
  }
  return o.M1 + 5 * Math.log10(d) + o.K1 * Math.log10(Math.max(r, 0.01));
}
function desenharPequenos(abs, postos) {
  const ver = estado.messier && pequenos.length && abs.distanceTo(PORID.sol.abs) < 200 * UA;
  pontosPeq.visible = !!ver;
  if (!ver) { for (const o of pequenos) if (o.el) o.el.style.display = 'none'; return; }
  // posições em rodízio (3 mil por quadro; com o tempo acelerado, todas)
  const quantos = Math.abs(estado.ritmo) > 3600 ? pequenos.length : 3000;
  for (let k = 0; k < quantos; k++) {
    const o = pequenos[iPeq]; iPeq = (iPeq + 1) % pequenos.length;
    posOrbital(o.q, o.e, o.i, o.om, o.w, estado.jd - o.tp, o.abs);
    o.mag = magnitudePequeno(o, abs);
  }
  const lim = limiteMag(), up = estado.ceuModo ? estado.local.clone().normalize() : null;
  for (let i = 0; i < pequenos.length; i++) {
    const o = pequenos[i];
    if (o.el) o.el.style.display = 'none';
    const rel = _pq.copy(o.abs).sub(abs), d = rel.length();
    let a = o.mag === undefined ? 0 : Math.min(1, 10 ** (-0.4 * (o.mag - lim))) * (1 - diaNoCeu);
    if (a > 0.02 && up && rel.dot(up) < 0) a = 0;
    alfaPeq[i] = a > 0.02 ? a : 0;
    if (!alfaPeq[i]) continue;
    aberrarJS(rel.multiplyScalar(comprimir(d))).toArray(posPeq, i * 3);
    tamPeq[i] = (1.6 + 2.2 * a) * renderer.getPixelRatio();
    // nomes: os grandes asteroides e os cometas mais brilhantes
    if (!(estado.nomes && (o === estado.alvo || (a > 0.3 && (o.tipo !== 'asteroide' || o.H < 6))))) continue;
    projetado.copy(_pq.fromArray(posPeq, i * 3)).applyMatrix4(camera.matrixWorldInverse);
    if (projetado.z >= 0) continue;
    projetado.applyMatrix4(camera.projectionMatrix);
    const x = (projetado.x * 0.5 + 0.5) * innerWidth, y = (-projetado.y * 0.5 + 0.5) * innerHeight;
    if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) continue;
    const caixa = [x, y - 8, x + o.textoRotulo.length * 6.2 + 12, y + 8];
    if (o !== estado.alvo && postos.some((b) => caixa[0] < b[2] && caixa[2] > b[0] && caixa[1] < b[3] && caixa[3] > b[1])) continue;
    postos.push(caixa);
    if (!o.el) { o.el = document.createElement('div'); o.el.className = 'messier'; o.el.textContent = o.textoRotulo; o.el.onclick = () => { estado.alvo = o; aviso(tr('{c} · {tipo}, magnitude {m} agora', { c: o.nome, tipo: tr(o.tipo.trim()), m: o.mag.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })); }; camadaRot.append(o.el); }
    o.el.style.left = `${x}px`; o.el.style.top = `${y}px`; o.el.style.display = '';
    o.el.classList.toggle('alvo', o === estado.alvo);
  }
  geoPeq.setDrawRange(0, pequenos.length);
  geoPeq.attributes.position.needsUpdate = true; geoPeq.attributes.alfa.needsUpdate = true; geoPeq.attributes.tamanho.needsUpdate = true;
}
function pintarCeuBotoes() {
  $('btLinhasConst').textContent = tr(estado.linhasConst ? 'Desenho das constelações: ligado' : 'Desenho das constelações: desligado');
  $('btLinhasConst').classList.toggle('ativo', estado.linhasConst);
  $('btNomesConst').textContent = tr(estado.constelacoes ? 'Nomes das constelações: ligados' : 'Nomes das constelações: desligados');
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
  constelacoes = lista.map(([nomePt, x, y, z]) => {
    const nome = idioma === 'en' && nomePt === 'Telescópio' ? 'Telescopium' : tr(nomePt); // "Telescópio" também é botão
    const el = document.createElement('div');
    el.className = 'constelacao';
    el.textContent = nome;
    el.style.display = 'none';
    camadaRot.append(el);
    return { nome, nomePt, dir: new THREE.Vector3(x, y, z), el };
  });
  // na busca: "orion", "escorpiao"… vira a câmera para a constelação e liga o desenho e os nomes
  for (const c of constelacoes) addBusca(`${c.nome} · ${tr('constelação')}`, c.nome, 1e10, () => {
    estado.constelacoes = true; estado.linhasConst = true; pintarCeuBotoes();
    const up = estado.ceuModo ? estado.local.clone().normalize() : null;
    quatOlhando(c.dir.clone(), estado.q, up);
    if (estado.ceuModo && c.dir.dot(up) < 0) aviso(tr('{c} está abaixo do horizonte agora.', { c: c.nome }));
    else aviso(tr('Olhando para {c}.', { c: c.nome }));
  });
});
// ------------------------------- sondas e cometas: embarcar, momentos e fotos -------------------------------
const nM = 64;
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
    addBusca(`${o.nome} · ${tr(TIPO_EMBARQUE[o.tipo])}`, o.nome, 1e12, () => embarcar(o));
  }
  geoM.attributes.cor.needsUpdate = true;
  for (const sel of [$('selDestino'), $('selPartida')]) {
    for (const [titulo, tipo] of grupos) {
      const g = document.createElement('optgroup');
      g.label = tr(titulo);
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
  aviso(o.tipo === 'sonda' ? tr('A bordo da sonda {c}.', { c: o.nome }) : tr('A bordo {de:c}.', { c: o.tipo === 'satelite' && o.id !== 'hubble' ? { id: 'lua', nome: o.nome } : o }));
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
    b.textContent = `${new Date((m.jd - 2440587.5) * 86400000).toLocaleDateString(LOCALE, { timeZone: 'UTC' })} · ${tr(m.titulo)}${m.foto ? ' 📷' : ''}`;
    b.onclick = () => irMomento(o, m);
    lista.append(b);
  }
  $('mAgora').hidden = !(jdAgora() >= o.jd0 && jdAgora() <= o.jd1);
  $('mMomentosTit').hidden = !o.momentos.length;
  // satélites dão uma volta em hora e meia: ritmos curtos; sondas e cometas, ritmos de dias a anos
  const ritmos = o.tipo === 'satelite' ? [[1, 'tempo real'], [60, '1 min/s'], [3600, '1 h/s'], [86400, '1 dia/s']]
    : [[1, 'tempo real'], [86400, '1 dia/s'], [2629800, '1 mês/s'], [31557600, '1 ano/s']];
  document.querySelectorAll('#pMissao [data-ritmo]').forEach((b, i) => { b.dataset.ritmo = ritmos[i][0]; b.textContent = tr(ritmos[i][1]); });
}
function irMomento(o, m) {
  estado.jd = m.jd;
  atualizarPosicoes(estado.jd);
  missoes.atualizar(estado.jd);
  estado.ritmo = 1; $('selRitmo').value = '1';
  if (m.olhar === 'cometa') { enquadrarCometa(o); $('mTexto').textContent = tr(m.texto); if (m.foto) mostrarFoto(m); else $('foto').hidden = true; return; }
  const alvo = m.olhar ? (PORID[m.olhar] || missoes.porId[m.olhar]) : null;
  const dir = m.olharRaDec ? radecParaCena(m.olharRaDec[0], m.olharRaDec[1], 1) : alvo ? alvo.abs.clone().sub(camAbs()) : null;
  if (dir) quatOlhando(dir, estado.q);
  $('mTexto').textContent = tr(m.texto);
  if (m.foto) mostrarFoto(m); else $('foto').hidden = true;
}
function mostrarFoto(m) {
  $('fotoImg').src = `dados/fotos/${m.foto}.jpg`;
  $('fotoImg').alt = m.fotoInfo?.titulo || tr(m.titulo);
  $('fotoTitulo').textContent = tr(m.titulo);
  $('fotoTexto').textContent = tr(m.texto);
  $('fotoCredito').textContent = tr('Foto real: {c}. Ao fundo, a cena simulada do mesmo momento.', { c: `${m.credito || 'NASA'}${m.fotoInfo?.titulo ? ` · "${m.fotoInfo.titulo}"` : ''}` });
  $('foto').hidden = false;
}
let jdAnteriorMomentos = 0;
function avisarMomentos() {
  const o = estado.embarcado;
  if (o && estado.ritmo > 1) for (const m of o.momentos) if (jdAnteriorMomentos < m.jd && m.jd <= estado.jd) aviso(tr('{t}: veja em "Momentos" no painel da missão.', { t: tr(m.titulo) }));
  jdAnteriorMomentos = estado.jd;
}
function painelMissao() {
  const o = estado.embarcado, abs = camAbs();
  $('mData').textContent = data(estado.jd);
  if (!o.ativo) {
    $('mInfo').textContent = o.tipo === 'satelite' ? tr('Os elementos orbitais valem perto de {d} (±{n} dias). Use "Agora".', { d: data(o.epoca), n: Math.round(o.jd1 - o.epoca) }) : tr('Fora do período com dados ({d0} a {d1}).', { d0: data(o.jd0), d1: data(o.jd1) });
  } else if (o.tipo === 'satelite') {
    const periodo = (2 * Math.PI) / o.rec.no; // minutos
    const la = o.lat / GRAU, lo = o.lon / GRAU;
    $('mInfo').textContent = tr('Altitude {alt} km · {v} km/h em relação à Terra · uma volta na Terra a cada {p} min · sobre {lat}, {lon}', { alt: sig(o.alt), v: sig(o.velTerra * 3600), p: Math.round(periodo), lat: `${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'}`, lon: `${sig(Math.abs(lo))}° ${lo >= 0 ? PONTOS[4] : PONTOS[12]}` })
      + ` · ${tr(o.sombra ? 'na sombra da Terra' : o.id === 'hubble' ? 'iluminado pelo Sol' : 'iluminada pelo Sol')}${o.reserva ? tr(' · sem internet: elementos guardados, menos precisos') : ''}`;
  } else {
    const dT = abs.distanceTo(PORID.terra.abs);
    $('mInfo').textContent = tr(o.tipo === 'sonda' ? 'Do Sol: {s} · da Terra: {t} · velocidade em relação ao Sol: {v} km/s · um sinal daqui leva {d} até a Terra' : 'Do Sol: {s} · da Terra: {t} · velocidade em relação ao Sol: {v} km/s · a luz daqui leva {d} até a Terra', { s: distancia(o.abs.distanceTo(PORID.sol.abs)), t: distancia(dT), v: sig(o.vel.length()), d: duracao(dT / C) });
  }
  if (document.activeElement !== $('mLinha')) $('mLinha').value = estado.jd;
}
$('mLinha').oninput = (e) => { estado.jd = +e.target.value; };
for (const b of document.querySelectorAll('#pMissao [data-ritmo]')) b.onclick = () => { estado.ritmo = +b.dataset.ritmo; estado.orbitasMovem = estado.ritmo !== 0; if (estado.ritmo === 0) estado.ritmo = 1; $('selRitmo').value = String(estado.ritmo); };
$('mPausa').onclick = () => { estado.orbitasMovem = false; };
$('mAgora').onclick = () => { estado.jd = jdAgora(); estado.ritmo = 1; estado.orbitasMovem = true; $('selRitmo').value = '1'; };
$('mSair').onclick = () => { desembarcar(); escolherRef(); };
$('btEmbarcar').onclick = () => { const c = obterCorpo($('selDestino').value); if (c && (c.tipo === 'sonda' || c.tipo === 'cometa')) embarcar(c); else aviso(tr('Escolha uma sonda ou um cometa no destino para embarcar.')); };
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

aoTeclar('Space', () => (estado.pousado ? pular() : pararTudo()));
aoTeclar('KeyC', () => { estado.cruzeiro = !estado.cruzeiro; estado.piloto = null; });
aoTeclar('KeyG', () => (estado.alvo?.soCeu ? apontar(estado.alvo) : iniciarViagem(estado.alvo ?? obterCorpo($('selDestino').value))));
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
for (const v of vagasExo) v.rotulo = novoRotulo('planeta');
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
  if (!it) return aviso(txt ? tr('Não achei a cidade "{c}". Escolha uma da lista.', { c: txt }) : tr('Escreva o nome de uma cidade.'));
  const E = PORID.terra;
  if (estado.ceuModo) {
    // já no modo céu: muda de lugar na hora, no mesmo instante
    estado.ultimoLugar = it;
    const d = it.dir.clone().applyQuaternion(E.qOri);
    estado.local.copy(d).multiplyScalar(raioSuperficie(E, d) + ALTURA_OLHO);
    const { norte } = eixosLocais(d);
    estado.q.setFromRotationMatrix(_m.lookAt(ORIGEM, norte.clone().multiplyScalar(Math.cos(35 * GRAU)).addScaledVector(d, Math.sin(35 * GRAU)), d));
    estado.zonaCache = null;
    aplicarCeuPendente();
    aviso(tr('Céu de {c}', { c: `${it.nome}${it.pais ? `, ${it.pais}` : ''}` }));
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
carregarEstrelas().then(() => carregarExoplanetas().catch((e) => console.warn("exoplanetas:", e))).then(() => {
  ceu = criarCeu(S);
  ceu.material.uniforms.escalaPx.value = renderer.getPixelRatio();
  cena.add(ceu);
  preencherEstrelas();
  atualizarVagas();
  if (!estado.leve) pedirGaia();
});
// mais 1,1 milhão de estrelas do Gaia (fora do modo leve: são ~11 MB); e as de magnitude 11 a 12 (~2 milhões, ~20 MB)
// só quando o telescópio passa a alcançá-las
let gaia12 = null, gaia12Pedido = false;
function talvezGaia12() {
  if (gaia12Pedido || !ceu || estado.leve || limiteMag() < 10) return;
  gaia12Pedido = true;
  aviso(tr('Carregando mais 2 milhões de estrelas do Gaia para o telescópio…'));
  carregarGaia(ceu.material, 'dados/gaia12.bin').then((p) => { gaia12 = p; cena.add(gaia12); }).catch(() => { gaia12Pedido = false; });
}
let gaia = null, gaiaPedido = false;
function pedirGaia() {
  if (gaiaPedido || !ceu) return;
  gaiaPedido = true;
  carregarGaia(ceu.material).then((p) => { gaia = p; gaia.visible = !estado.leve; cena.add(gaia); }).catch(() => { gaiaPedido = false; });
}

// Põe nas vagas as estrelas mais próximas (mantendo as que continuam próximas na mesma vaga)
function atualizarVagas() {
  if (!cat.n) return;
  const novos = maisProximas(camAbs(), NV).map(estrelaObj);
  for (const o of novos) ajustarHospedeira(o);
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
  montarLista();
  escolherSistemaExo();
  if (ceu) {
    const oc = ceu.material.uniforms.ocultos.value;
    oc.fill(-1);
    vagas.forEach((v, j) => (oc[j] = v.obj ? v.obj.hyg : -1));
  }
}

const montarLista = () => { lista = CORPOS.concat(vagas.filter((v) => v.obj).map((v) => v.obj), vagasExo.filter((v) => v.obj).map((v) => v.obj)); };
// Estrela com exoplanetas: raio e massa do catálogo de exoplanetas (melhores que os estimados pela cor)
function ajustarHospedeira(o) {
  const e = exo.porHyg.get(o.hyg);
  if (!e || o.exoSistema) return;
  o.exoSistema = e;
  if (e.R) o.raio = e.R * 695700;
  o.massa = e.m;
  o.nome = e.nome;
  o.exoCorpos = e.pl.slice(0, NEXO).map((p) => corpoPlaneta(p, o));
  for (const c of o.exoCorpos) planetaPorNome.set(c.nome, c);
  // chegada de cima do plano das órbitas (do planeta mais externo da lista), longe o bastante para ver o sistema
  const ext = o.exoCorpos.at(-1).orbita;
  o.normal = ext.normal; o.eixoMaior = ext.N;
  o.distExo = Math.min(ext.a, 30 * UA) * 2.2;
}
// Sistema ativo: o do planeta escolhido como alvo ou acompanhado; senão, a hospedeira mais perto, se a câmera estiver nela
function escolherSistemaExo() {
  const abs = camAbs();
  let e = (estado.alvo?.exo && estado.alvo.estrela) || (estado.ref?.exo && estado.ref.estrela) || null;
  if (!e) {
    let melhor = Infinity;
    for (const v of vagas) {
      const o = v.obj;
      if (!o?.exoSistema) continue;
      const d = abs.distanceTo(o.abs), alcance = Math.max(o.soi, o.exoSistema.pl.at(-1).a * UA * 40);
      if (d < alcance && d < melhor) { melhor = d; e = o; }
    }
  }
  if (e === sistemaExo) return;
  for (const v of vagasExo) { if (v.obj) v.obj.malha = v.obj.rotulo = null; v.obj = null; v.malha.visible = v.linha.visible = false; v.rotulo.style.display = 'none'; }
  sistemaExo = e;
  if (e) {
    hospedeira(e.exoSistema);
    e.exoCorpos.forEach((o, j) => {
      const v = vagasExo[j];
      v.obj = o; o.malha = v.malha; o.rotulo = v.rotulo;
      v.rotulo.textContent = o.nome; v.rotulo.corpo = o;
      const u = v.malha.material.uniforms;
      u.corBase.value.copy(o.cor3).convertSRGBToLinear();
      u.raio.value = o.raio;
      u.detalhe.value = o.rochoso ? 1 : 0;
      o.cor3.toArray(corB, (CORPOS.length + NV + j) * 3);
      v.linha.material.color.copy(o.cor3);
      v.pts = Array.from({ length: 257 }, (_, k) => pontoOrbita(o.orbita, (k / 256) * 2 * Math.PI));
      posicaoOrbita(o.orbita, estado.jd, o.abs).add(e.abs);
    });
    const L = (e.raio / 695700) ** 2 * (e.T / 5772) ** 4, n = e.normal, t1 = e.eixoMaior, t2 = new THREE.Vector3().crossVectors(n, t1);
    const r1 = Math.sqrt(L / 1.107) * UA, r2 = Math.sqrt(L / 0.356) * UA;
    zonaHab.pts = Array.from({ length: 258 }, (_, j) => {
      const a = (Math.floor(j / 2) / 128) * 2 * Math.PI, r = j % 2 ? r2 : r1;
      return t1.clone().multiplyScalar(r * Math.cos(a)).addScaledVector(t2, r * Math.sin(a));
    });
    geoBrilho.attributes.cor.needsUpdate = true;
  }
  montarLista();
}
// posições dos planetas ativos na data atual
function moverExo() {
  for (const v of vagasExo) if (v.obj) posicaoOrbita(v.obj.orbita, estado.jd, v.obj.abs).add(v.obj.estrela.abs);
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
let veioDeRecarga = false;
// Volta ao lugar e à data de antes, se a página acabou de recarregar por falta de memória da placa de vídeo
try {
  const salvo = JSON.parse(sessionStorage.getItem('viagemEstado') || 'null');
  sessionStorage.removeItem('viagemEstado');
  if (salvo && Date.now() - salvo.t < 60000) {
    veioDeRecarga = true;
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
  aviso(tr('Óculos: modo leve (sem Terra em ladrilhos, atmosfera simples, sem a dobra).'));
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
  $('btAtm').textContent = tr(estado.atmFisica ? 'Atmosfera: física' : 'Atmosfera: simples');
  $('btAtm').classList.toggle('ativo', estado.atmFisica);
  pintarEfeito();
}
function textoPainelVR() {
  const vel = velocidade(velMedida);
  const a = estado.alvo;
  const linhas = [
    vel.principal,
    a ? tr('Alvo: {c}', { c: a }) : tr('Alvo: nenhum (aponte + gatilho direito)'),
    a && a !== estado.embarcado && !a.soCeu ? tr('a {d}', { d: distancia(Math.max(camAbs().distanceTo(a.abs) - (a.raio ?? 0), 0)) }) : '',
    data(estado.jd),
    estado.embarcado ? tr('A bordo: {c} · A desembarca', { c: estado.embarcado }) : a && missoes.objetos.includes(a) ? tr('A embarca · B vai até o alvo') : tr('B vai até o alvo'),
    performance.now() < avisoAte ? $('aviso').textContent : tr('Gatilho esq. acelera · aperto freia · X para'),
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
let luar = 0, velMedida = 0, freando = false, proximo = null, altProx = Infinity, altRef = Infinity, quadro = 0, diaNoCeu = 0, ofusc = 0;
const _ofD = new THREE.Vector3(), _ofV = new THREE.Vector3();
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), eixoX = new THREE.Vector3(1, 0, 0), eixoY = new THREE.Vector3(0, 1, 0), eixoZ = new THREE.Vector3(0, 0, 1);
const _delta = new THREE.Quaternion(), velVetor = new THREE.Vector3(), betaVec = new THREE.Vector3();
// Mesma aberração dos shaders, para os rótulos acompanharem as estrelas
// ------------------------------- eclipses -------------------------------
// fração do disco do Sol visível do ponto P (km, cena), com um corpo esférico na frente (mesma conta do shader)
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3();
let luzSolAqui = 1, luzSolLua = 1;
// Sol aparente (com a aberração da luz pela velocidade da Terra, ~20"): é ele que a Lua precisa tapar
const solAparente = new THREE.Vector3();
// a Terra é achatada (1/298): a latitude dos mapas (geodésica) fica, no centro da Terra, um pouco mais perto do equador.
// A simulação desenha uma esfera; para a sombra de um eclipse, corrigimos a posição de quem está no chão.
function pontoGeocentrico(P) {
  const E = PORID.terra, rel = _e3.copy(P).sub(E.abs), r = rel.length();
  if (r > E.raio * 1.1) return P;
  const qi = E.qOri.clone().invert(), dl = rel.clone().applyQuaternion(qi).normalize();
  const lat = Math.asin(dl.y), latGc = Math.atan(0.99330562 * Math.tan(lat));
  const h = Math.hypot(dl.x, dl.z);
  if (h < 1e-9) return P;
  dl.set((dl.x / h) * Math.cos(latGc), Math.sin(latGc), (dl.z / h) * Math.cos(latGc));
  return dl.applyQuaternion(E.qOri).multiplyScalar(r).add(E.abs);
}
function atualizarSolAparente() {
  const S = PORID.sol.abs, d = S.distanceTo(PORID.terra.abs);
  solAparente.copy(S).addScaledVector(velocidadePlaneta('terra', estado.jd), d / C);
}
function luzEclipseJS(P, oc, raioOc) {
  const sol = PORID.sol;
  const L = _e1.copy(solAparente).sub(P), dS = L.length();
  L.divideScalar(dS);
  const v = _e2.copy(oc.abs).sub(P), d = v.length();
  if (d < raioOc || v.dot(L) <= 0) return 1;
  v.divideScalar(d);
  const a = Math.asin(sol.raio / dS), b = Math.asin(raioOc / d), c = Math.atan2(_e3.crossVectors(v, L).length(), v.dot(L));
  if (c >= a + b) return 1;
  if (c <= b - a) return 0;
  if (c <= a - b) return 1 - (b * b) / (a * a);
  const a2 = a * a, b2 = b * b, c2 = c * c;
  const A = a2 * Math.acos(Math.min(1, Math.max(-1, (c2 + a2 - b2) / (2 * c * a)))) + b2 * Math.acos(Math.min(1, Math.max(-1, (c2 + b2 - a2) / (2 * c * b))))
    - 0.5 * Math.sqrt(Math.max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0));
  return Math.min(1, Math.max(0, 1 - A / (Math.PI * a2)));
}
// uniforms da sombra: a Terra recebe a sombra da Lua; a Lua, a da Terra (alargada 2% pela atmosfera, e avermelhada)
function uniformsEclipse(c, u, luz) {
  if (!u.eclAtivo) return;
  const oc = c.id === 'terra' ? PORID.lua : c.id === 'lua' ? PORID.terra : null;
  if (!oc) { u.eclAtivo.value = 0; return; }
  luz.copy(solAparente).sub(c.abs).normalize(); // direção do Sol aparente (a diferença na iluminação é imperceptível)
  const v = u.eclOcl.value.copy(oc.abs).sub(c.abs);
  u.eclAtivo.value = v.clone().normalize().dot(luz) > 0.995 ? 1 : 0; // só quando os três estão quase alinhados
  u.eclRaio.value = c.id === 'terra' ? oc.raio : oc.raio * 1.02;
  u.eclSolAng.value = Math.asin(PORID.sol.raio / PORID.sol.abs.distanceTo(c.abs));
  u.eclVermelho.value = c.id === 'lua' ? 1 : 0;
  if (c.id === 'terra') for (const k of ['eclOcl', 'eclRaio', 'eclSolAng', 'eclAtivo', 'eclVermelho']) {
    if (k === 'eclOcl') terra.eclipse.eclOcl.value.copy(u.eclOcl.value); else terra.eclipse[k].value = u[k].value;
  }
}
// Halo do Sol: a luz que se espalha em volta de uma fonte muito forte (na lente, no olho, ou no ar). Do tamanho de
// boa parte da tela perto da Terra; some quando um corpo tapa o Sol (luzSolAqui) e diminui longe dele.
const haloSol = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'), img = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const r = Math.hypot(x - 255.5, y - 255.5) / 256;
      const a = Math.max(0, 0.55 * Math.exp(-r * r * 30) + 0.35 * Math.exp(-r * 6) + 0.12 * Math.exp(-r * 2.5)) * Math.max(0, 1 - r) ** 1.5;
      const k = (y * 512 + x) * 4;
      img.data[k] = 255; img.data[k + 1] = 246 - 20 * r; img.data[k + 2] = 225 - 60 * r; img.data[k + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })(),
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, sizeAttenuation: false,
}));
haloSol.renderOrder = 6;
cena.add(haloSol);
// O Sol está atrás do corpo de referência ou do mais próximo? (linha de visada da câmera ao centro do Sol)
const _st = new THREE.Vector3();
function solTapado(abs) {
  const d = _st.copy(PORID.sol.abs).sub(abs), dist = d.length();
  d.divideScalar(dist);
  for (const c of [estado.ref, proximo]) {
    if (!c || !c.malha || c === PORID.sol || !c.raio) continue;
    const oc = _ofV.copy(c.abs).sub(abs), t = oc.dot(d);
    if (t > 0 && t < dist && oc.lengthSq() - t * t < c.raio * c.raio) return true;
  }
  return false;
}
function desenharHaloSol(abs) {
  const sol = PORID.sol, dSol = abs.distanceTo(sol.abs);
  const forca = Math.min(Math.max((Math.log10((UA / Math.max(dSol, 1)) ** 2) + 5) / 5, 0), 1);
  haloSol.visible = forca > 0.01 && luzSolAqui > 0.01 && dSol > sol.raio * 1.05 && !solTapado(abs);
  if (!haloSol.visible) return;
  haloSol.position.copy(sol.malha.position);
  const dentroAtm = diaNoCeu > 0.3 && !ofusc; // de dia, o céu claro já espalha a luz: halo menor
  // escala: altura da tela ≈ escala / (2·tan(fov/2)); o halo vai a pelo menos 5 raios do disco
  const raioAng = Math.asin(Math.min(sol.raio / dSol, 1));
  haloSol.scale.setScalar(Math.max((0.25 + 1.15 * forca) * (dentroAtm ? 0.6 : 1), 2 * Math.tan(raioAng) * 5));
  haloSol.material.opacity = Math.min(1, 0.25 + 0.75 * forca) * luzSolAqui;
}

// coroa solar: só aparece com o Sol totalmente tapado pela Lua (a parte de dentro fica atrás da Lua)
const coroa = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 18, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(235,240,255,.8)'); gr.addColorStop(0.3, 'rgba(200,215,255,.25)'); gr.addColorStop(1, 'rgba(180,200,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { // raios (serpentinas) da coroa
      const ang = (i / 26) * Math.PI * 2 + Math.sin(i * 7.3) * 0.2, comp = 60 + 55 * Math.abs(Math.sin(i * 3.7));
      const gg = g.createLinearGradient(128, 128, 128 + Math.cos(ang) * comp, 128 + Math.sin(ang) * comp);
      gg.addColorStop(0, 'rgba(255,255,255,.35)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = gg; g.lineWidth = 3 + 3 * Math.abs(Math.cos(i)); g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(ang) * comp, 128 + Math.sin(ang) * comp); g.stroke();
    }
    return new THREE.CanvasTexture(cv);
  })(),
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
}));
coroa.renderOrder = 6;
coroa.visible = false;
cena.add(coroa);
function desenharCoroa() {
  const sol = PORID.sol;
  const op = sol.malha && sol.malha.visible ? THREE.MathUtils.smoothstep(0.02 - luzSolLua, 0, 0.02) : 0;
  coroa.visible = op > 0.01;
  if (!coroa.visible) return;
  coroa.position.copy(sol.malha.position);
  coroa.scale.setScalar(sol.malha.scale.x * 7);
  coroa.material.opacity = op;
}

function aberrarJS(p) {
  refratar(p);
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
  vigiarDesempenho(agora);

  // Tempo da simulação e posições
  // no modo relatividade, em movimento, o tempo lá fora corre γ vezes mais rápido que o de bordo
  if (estado.orbitasMovem) estado.jd += (dt * estado.ritmo * (relativistico() && velMedida > 1e-3 * C ? gama(velMedida) : 1)) / 86400;
  atualizarPosicoes(estado.jd);
  if (quadro % 30 === 0 || estado.alvo?.exo || estado.ref?.exo) escolherSistemaExo();
  moverExo();
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

  posicionarVistaFora();
  if (mouse.roda) { if (estado.telescopio) definirZoom(estado.zoom * 1.18 ** -mouse.roda); else definirV(estado.v * 1.25 ** -mouse.roda); mouse.roda = 0; }

  // Rotação: mouse e teclas
  const ex = eixos();
  const mvVR = vr.entrada(dt, estado.q);
  if (mvVR.frente || mvVR.lado) { ex.frente = mvVR.frente; ex.lado = mvVR.lado; }
  const giro = 1.4 * dt * (estado.telescopio ? 1 / estado.zoom : 1); // no telescópio, as setas movem devagar
  if (mouse.novo) { mouse.novo = false; mouse.globo = pegouGlobo(mouse.px, mouse.py); }
  if ((mouse.dx || mouse.dy) && mouse.globo && podeGirarGlobo()) {
    // arrastar o planeta: a câmera dá a volta nele (o ponto pego acompanha o dedo, aproximadamente)
    const r = estado.ref, d = estado.local.length();
    const k = ((camera.fov * GRAU) / innerHeight) * Math.min(Math.max((d - r.raio) / r.raio, 0.05), 20);
    const qGiro = tmpQ.setFromAxisAngle(_gEixo.set(0, 1, 0).applyQuaternion(estado.q), -mouse.dx * k);
    qGiro.multiply(_gQ.setFromAxisAngle(_gEixo.set(1, 0, 0).applyQuaternion(estado.q), mouse.dy * k));
    estado.local.applyQuaternion(qGiro);
    estado.q.premultiply(qGiro);
    mouse.dx = mouse.dy = 0;
  } else if (mouse.dx || mouse.dy) {
    const k = (camera.fov * GRAU) / innerHeight;
    estado.q.multiply(tmpQ.setFromAxisAngle(eixoY, -mouse.dx * k));
    estado.q.multiply(tmpQ.setFromAxisAngle(eixoX, -mouse.dy * k));
    mouse.dx = mouse.dy = 0;
    if (estado.piloto) estado.piloto.olharLivre = true;
    estado.virar = null;
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
    if (u >= 1) { estado.piloto = null; chegou(p.alvo); }
  } else if (p && p.modo === 'vel') {
    const alvoAbs = p.alvo.abs;
    const deAlvo = abs.clone().sub(alvoAbs);
    const chegada = alvoAbs.clone().addScaledVector(deAlvo, distChegada(p.alvo) / deAlvo.length());
    const rumo = chegada.clone().sub(abs);
    const resta = rumo.length();
    const freioMax = resta * (1 - Math.exp(-dt * 2.5));
    let passoKm = passoBordo(estado.v) * dt;
    if (passoKm === Infinity) { // na luz: zero de tempo a bordo
      estado.local.add(rumo);
      const tTerra = resta / C;
      if (estado.orbitasMovem) estado.jd += tTerra / 86400;
      aviso(tr('Na velocidade da luz, o relógio de bordo não anda: a chegada é imediata. Lá fora passaram {t}.', { t: duracao(tTerra) }) + (estado.orbitasMovem && tTerra > 86400 ? ' ' + tr('A data da simulação avançou junto ("Agora" volta para hoje).') : ''), 9000);
      saltoRef = true;
      estado.piloto = null; mudarRef(p.alvo); chegou(p.alvo);
    } else {
      if (passoKm > freioMax) { passoKm = freioMax; freando = true; }
      estado.local.addScaledVector(rumo, passoKm / resta);
    }
    if (!p.olharLivre) estado.q.slerp(quatOlhando(alvoAbs.clone().sub(abs), tmpQ), 1 - Math.exp(-dt * 3));
    p.resta = resta;
    if (estado.piloto && resta < Math.max(distChegada(p.alvo) * 0.01, 0.01)) { estado.piloto = null; mudarRef(p.alvo); chegou(p.alvo); }
  } else if (p && p.modo === 'pouso') {
    p.t += dt;
    const u = Math.min(p.t / p.dur, 1);
    const e = u * u * (3 - 2 * u);
    const alt = p.alt0 * (alturaOlho(p.alvo) / p.alt0) ** e;
    const dir = p.dirCorpo.clone().applyQuaternion(p.alvo.qOri);
    estado.local.copy(dir).multiplyScalar(raioSuperficie(p.alvo, dir) + alt);
    // Termina olhando o horizonte (o de quem está de pé: em Vesta ou Fobos, não é o da direção do centro)
    const cima = cimaChao(p.alvo, estado.local, _cimaP);
    const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
    let tang = fr.clone().addScaledVector(cima, -fr.dot(cima));
    if (tang.lengthSq() < 1e-8) {
      const cy = new THREE.Vector3(0, 1, 0).applyQuaternion(estado.q);
      tang = cy.addScaledVector(cima, -cy.dot(cima));
    }
    const olhar = tang.normalize().addScaledVector(cima, -0.03);
    if (!p.olharLivre) estado.q.slerp(quatOlhando(olhar, tmpQ, cima), 1 - Math.exp(-dt * 2.2));
    if (u >= 1) {
      if (!p.olharLivre) virarParaOAberto(p.alvo);
      const gas = GASOSOS.includes(p.alvo.id);
      estado.piloto = null; estado.pousado = p.alvo; if (estado.vAntes === undefined) estado.vAntes = estado.v; definirV(gas ? 900 / 3600 : 5 / 3600);
      if (gas) aviso(tr('{c} não tem chão: abaixo das nuvens, o gás fica cada vez mais denso e quente, até virar líquido. Você flutua no topo das nuvens, onde a pressão é parecida com a do nível do mar na Terra.', { c: p.alvo }), 10000);
      else aviso(p.lugar ? tr('Pouso em {c}. Ande com as setas; R para decolar; Z para olhar o céu.', { c: p.lugar.nome }) : tr('Pouso {em:c}. Ande com as setas; R para decolar.', { c: p.alvo }));
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
    if (ex.vertical > 0 || estado.ref !== c) { estado.pousado = null; estado.pulo = null; restaurarV(); }
    else {
      const up = cimaChao(c, estado.local, new THREE.Vector3());
      if (estado.virar) { // depois do pouso, vira devagar para o lado aberto (qualquer comando cancela)
        if (ex.frente || ex.lado || ex.guinada || ex.arfagem || estado.cruzeiro) estado.virar = null;
        else { estado.q.slerp(estado.virar, 1 - Math.exp(-dt * 1.6)); if (estado.q.angleTo(estado.virar) < 0.01) estado.virar = null; }
      }
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
      const pulo = estado.pulo?.c === c ? estado.pulo : (estado.pulo = null);
      if (pulo) { // no ar: sobe e desce com a gravidade do lugar (que cai com o quadrado da distância ao centro)
        const r = estado.local.length();
        pulo.v -= (pulo.gR2 / (r * r)) * dt;
        pulo.h += pulo.v * dt;
        const chao = raioSuperficie(c, d) + alturaOlho(c);
        if (pulo.h <= 0 && pulo.v < 0) { estado.pulo = null; estado.local.copy(d).multiplyScalar(chao); }
        else estado.local.copy(d).multiplyScalar(chao + Math.max(pulo.h, 0));
      } else {
      // quando chega um ladrilho mais detalhado, a altura do chão muda: acompanha suavemente (sobe rápido, desce devagar)
      const alvoR = raioSuperficie(c, d) + alturaOlho(c), rAt = estado.local.length();
      const novoR = rAt + (alvoR - rAt) * (1 - Math.exp(-dt * (alvoR > rAt ? 12 : 2.5)));
      estado.local.copy(d).multiplyScalar(Math.max(novoR, alvoR - 0.01));
      }
    }
  } else {
    const frente = estado.cruzeiro ? 1 : ex.frente;
    if (frente || ex.lado || ex.vertical) {
      let v = Math.min(passoBordo(estado.v), 1e6 * C); // sem destino, na luz: γ de um milhão
      if (estado.freio && proximo && v > altProx * 0.9) { v = Math.max(altProx * 0.9, 0.0005); freando = true; }
      tmpV.set(ex.lado, ex.vertical, -frente).normalize().applyQuaternion(vr.ativo ? vr.qOlhar() : estado.q); // nos óculos, para onde se olha
      estado.local.addScaledVector(tmpV, v * dt);
    }
  }

  // Não atravessar superfícies
  if (proximo && !(p && p.modo === 'pouso')) {
    const rel = camAbs().sub(proximo.abs);
    const minimo = raioSuperficie(proximo, rel) + (proximo.tipo === 'estrela' ? 2000 : GASOSOS.includes(proximo.id) ? TOPO_NUVENS : ALTURA_OLHO);
    if (rel.length() < minimo) {
      rel.setLength(minimo);
      camAbs(tmpV);
      estado.local.add(proximo.abs.clone().add(rel).sub(tmpV));
    }
  }

  // Nivelar com o horizonte perto de um corpo
  if (estado.nivelar && estado.ref && estado.ref.tipo !== 'estrela' && altRef < estado.ref.raio * 2 && !(p && p.modo !== 'pouso')) {
    const up = altRef < estado.ref.raio * 0.2 ? cimaChao(estado.ref, estado.local, new THREE.Vector3()) : estado.local.clone().normalize();
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
    else {
      const vRef = relativistico() ? inst / Math.sqrt(1 + (inst / C) ** 2) : inst; // de γv (a bordo) para v (no referencial)
      velMedida += (vRef - velMedida) * (1 - Math.exp(-dt * 10)); velVetor.subVectors(estado.local, ultimoLocal).normalize();
    }
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
const _relT = new THREE.Vector3(), _camT = new THREE.Vector3(), _luzT = new THREE.Vector3(), _relS = new THREE.Vector3(), _camS = new THREE.Vector3();
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
  // os nomes do céu não entram abaixo do horizonte: no chão, o dos morros (vale para tudo, até os planetas); mais alto,
  // a borda do planeta (só para estrelas e objetos de céu profundo: uma lua na frente do disco continua com nome)
  const atrasDoRelevo = caixasDoRelevo(), relevoPerto = horiz.perto;
  if (relevoPerto) rotulosPostos.push(...atrasDoRelevo);
  atualizarSolAparente();
  luzSolLua = luzEclipseJS(pontoGeocentrico(abs.clone()), PORID.lua, PORID.lua.raio);
  luzSolAqui = Math.min(luzSolLua, estado.ref?.id === 'lua' ? luzEclipseJS(abs, PORID.terra, PORID.terra.raio * 1.02) : 1);
  refrAtiva = estado.ceuModo && estado.refracao;
  if (refrAtiva) zenRefr.copy(estado.local).normalize();
  if (linhasConst) { linhasConst.material.uniforms.refr.value = refrAtiva ? 1 : 0; linhasConst.material.uniforms.zenite.value.copy(zenRefr); }

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

  if (ra && abaixoDasNuvens(ra)) diaNoCeu = 1; // abaixo das nuvens de Vênus ou da névoa de Titã, nunca se veem estrelas

  // Ofuscamento: com o Sol no campo de visão (ou perto dele), a "câmera" fecha, como em qualquer foto: as estrelas e a
  // Via Láctea somem em volta dele. Mais forte quanto mais perto do Sol; com "Céu realçado", desligado.
  ofusc = 0;
  {
    const dSol = abs.distanceTo(sol.abs), dirSol = _ofD.copy(sol.abs).sub(abs).divideScalar(Math.max(dSol, 1));
    const olhar = _ofV.set(0, 0, -1).applyQuaternion(estado.q);
    const forca = Math.min(Math.max((Math.log10((UA / Math.max(dSol, 1)) ** 2) + 4) / 4, 0), 1); // 1 a 1 UA, some a ~100 UA
    const ang = dirSol.dot(olhar), meioFov = (camera.fov * GRAU) / 2 * Math.max(camera.aspect, 1);
    const noCampo = Math.min(Math.max((ang - Math.cos(meioFov + 0.35)) / (Math.cos(0.15) - Math.cos(meioFov + 0.35)), 0), 1);
    ofusc = forca * noCampo * luzSolAqui * (dSol > sol.raio * 1.05 && !solTapado(abs) ? 1 : 0);
    if (!estado.ceuRealcado && !estado.telescopio) diaNoCeu = Math.max(diaNoCeu, 0.92 * ofusc);
  }

  // Terra em ladrilhos: liga abaixo de 3 raios de altitude (com a aparência "fotos")
  const T = PORID.terra;
  const relT = _relT.copy(T.abs).sub(abs);
  const altT = relT.length() - T.raio;
  terra.ativo = estado.texturas && altT < T.raio * 3 && estado.epocaMa === 0 && !vr.ativo; // nos óculos, modo leve: sem ladrilhos
  // eclipses: o céu escurece com o Sol tapado (só perto da totalidade fica noite); a Lua na umbra quase não ilumina
  if (luzSolAqui < 1) diaNoCeu *= Math.min(1, 0.5 + 2.5 * luzSolAqui); // na totalidade, céu de crepúsculo: só as estrelas e planetas mais brilhantes
  luar *= 0.03 + 0.97 * luzEclipseJS(PORID.lua.abs, PORID.terra, PORID.terra.raio * 1.02);
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
      if (c.relevo?.[0] && !c.relevoPedido && d < c.raio * 3000) pedirRelevo(c);
      if (c.textura && !c.mapaPedido && !CEDO.includes(c.id) && diamPx > 2) pedirMapa(c);
      if (c.textura4k && !c.mapa4kPedido && diamPx > 700 && (c.mapaPronto || CEDO.includes(c.id))) pedirMapa4k(c);
      aberrarJS(c.malha.position.copy(rel).multiplyScalar(s));
      c.malha.scale.setScalar(c.raio * s);
      c.malha.quaternion.copy(c.qOri);
      c.malha.visible = diamPx > 0.5;
      const luz = u.luz.value.copy((c.estrela ?? sol).abs).sub(c.abs).normalize();
      uniformsEclipse(c, u, luz);
      // relevo em ladrilhos: carrega abaixo de 1,5 raio de altitude e assume abaixo de 1 raio, com a esfera afundada por baixo
      if (c.solo) {
        const altC = d - c.raio, quer = altC < c.raio * 1.5 && !vr.ativo && !(c.nevoa && nevoaPorCima(c));
        if (quer) {
          const inv = tmpQ.copy(c.qOri).invert();
          c.solo.ativo = altC < c.raio && (c.solo.ativo || c.solo.completo());
          c.solo.atualizar(_camS.copy(rel).negate().applyQuaternion(inv), _relS.copy(rel).multiplyScalar(s), c.qOri, camera, estado.exagero, c.solo.ativo);
        } else { c.solo.ativo = false; c.solo.esconder(); }
      }
      if (c.detalhe === undefined) { c.detalhe = criarDetalhe(c); c.detalhe2 = c.detalhe && criarDetalhe(c, 2); }
      if (c.detalhe) { // imagem de alta resolução perto da superfície: uma camada fina e uma larga (os ladrilhos de relevo têm a sua)
        const altC = d - c.raio, perto = altC < c.raio * 0.6 && estado.texturas && !c.solo?.ativo;
        const dirC = perto ? rel.clone().negate().normalize().applyQuaternion(_qi.copy(c.qOri).invert()) : _e3.set(1, 0, 0);
        c.detalhe.atualizar(dirC, perto ? altC : Infinity);
        c.detalhe2.atualizar(dirC, perto ? altC : Infinity);
        u.detalheAtivo.value = c.detalhe.ativo() ? 1 : 0; u.detalheMapa.value = c.detalhe.textura; u.detalheJanela.value.copy(c.detalhe.janela);
        u.detalheAtivo2.value = c.detalhe2.ativo() ? 1 : 0; u.detalheMapa2.value = c.detalhe2.textura; u.detalheJanela2.value.copy(c.detalhe2.janela);
      }
      u.kmPorUnidade.value = 1 / s;
      u.exagero.value = estado.exagero;
      u.usarTextura.value = estado.texturas ? 1 : 0;
      if (c.nevoa) { // Titã: a névoa por cima ou a superfície
        u.temMapa.value = nevoaPorCima(c) || !c.mapaPronto ? 0 : 1;
        u.temRelevo.value = nevoaPorCima(c) || !c.relevoPronto ? 0 : 1;
      }
      const sobNuvens = abaixoDasNuvens(c);
      if (c.nuvensAlt) { // Vênus, Titã: abaixo das nuvens, o chão some na distância e a luz vem do céu todo
        const [base, topo] = c.nuvensAlt, t = Math.min(Math.max((d - c.raio - base) / (topo - base), 0), 1);
        u.veuKm.value = sobNuvens ? c.veu.km * ((topo * 0.12) / c.veu.km) ** t : 0; // dentro das nuvens, quase nada se vê
        u.difusa.value = sobNuvens ? 0.85 : 0;
        u.corVeu.value.setRGB(...c.veu.cor).convertSRGBToLinear();
        if (sobNuvens) u.corLuz.value.setRGB(...c.veu.luz); else u.corLuz.value.setRGB(1, 1, 1);
        if (c.texturaChao) { // Vênus: o mapa do chão no lugar do das nuvens
          if (sobNuvens && !c.mapaChao) c.mapaChao = textura(c.texturaChao, true, () => (c.mapaChaoPronto = true));
          if (sobNuvens && c.mapaChaoPronto && u.mapa.value !== c.mapaChao) { c.mapaCima = u.mapa.value; u.mapa.value = c.mapaChao; u.temMapa.value = 1; }
          else if (!sobNuvens && c.mapaCima) { u.mapa.value = c.mapaCima; c.mapaCima = null; u.temMapa.value = c.mapaPronto ? 1 : 0; }
        }
      }
      const gasoso = GASOSOS.includes(c.id);
      u.detalhe.value = (c.rochoso || sobNuvens || gasoso) && estado.inventado ? 1 : 0;
      if (c.nuvensAlt) u.crateraForca.value = sobNuvens ? 0.15 : c.rochoso ? 0.15 : 0;
      u.exposicao.value = c.id === 'lua' && diaNoCeu < 1 && ra && ra.id === 'terra' && d > c.raio * 20 ? 3.2 : 1; // vista do chão à noite, a Lua brilha como de verdade
      u.polo.value.copy(polo.set(0, 1, 0).applyQuaternion(c.qOri));
      if ((c.rochoso || sobNuvens || gasoso) && d - c.raio < 3000) {
        // Posição da câmera no corpo, reduzida ao período do ruído em cada oitava (precisão dupla)
        const inv = tmpQ.copy(c.qOri).invert();
        u.paraCorpo.value.setFromMatrix4(_m4.makeRotationFromQuaternion(inv));
        const cb = _cb.copy(abs).sub(c.abs).applyQuaternion(inv);
        let k = 1 / 40;
        for (const o of u.camOct.value) {
          const ke = gasoso ? k * 0.25 : k; // como no shader: nuvens esticadas no plano do equador, sem giro
          o.set(((cb.x * ke) % 289 + 289) % 289, ((cb.y * k) % 289 + 289) % 289, ((cb.z * ke) % 289 + 289) % 289);
          if (!gasoso) cb.applyMatrix3(GIRO);
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
        au.urbano.value = c.id === 'terra' ? brilhoUrbano() : 0;
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
          uniformsEclipse(c, au, luz);
          // olho adaptado: no chão, o céu é a cena toda (exposição maior); do espaço, o planeta iluminado domina
          const noChao = Math.min(Math.max(1 - (d - c.raio) / 60, 0), 1);
          const eSol = _lvZ.copy(c.malha.position).negate().normalize().dot(luz); // altura do Sol vista daqui (seno)
          const crepusculo = 1 - THREE.MathUtils.smoothstep(eSol, -0.1, 0.35); // no fim da tarde a pupila abre
          au.exposicao.value = 1 + noChao * (2 + 6 * crepusculo);
        }
      }
      if (c.id === 'terra' && terra.ativo) c.malha.scale.setScalar((c.raio - 6) * s); // esfera de base sob os ladrilhos
      if (c.solo?.ativo) c.malha.scale.setScalar((c.raio - 2 - 3 * estado.exagero) * s);
      if (c.nuvMalha) {
        c.nuvMalha.material.uniforms.opac.value = c.id === 'terra' ? Math.min(Math.max((d - c.raio - 15) / 60, 0), 1) : 1;
        c.nuvMalha.position.copy(c.malha.position);
        c.nuvMalha.scale.setScalar((c.raio + 8) * s);
        const real = c.id === 'terra' && nuvensDoDia(c.nuvMalha.material.uniforms);
        if (real) c.nuvMalha.quaternion.copy(c.qOri); // a foto do dia fica presa ao mapa
        else c.nuvMalha.quaternion.copy(c.qOri).multiply(tmpQ.setFromAxisAngle(eixoY, ((estado.jd % 400) / 400) * 2 * Math.PI));
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
      else {
        tam = Math.max(tam, diamPx * 2.6);
        // estrela já vista como disco: o brilho de ponto encolhe e esmaece, para não lavar o disco (o Sol tem o halo próprio)
        const k = Math.min(Math.max((diamPx - 6) / 30, 0), 1);
        if (k > 0) { tam = tam * (1 - k) + diamPx * 1.15 * k; alfa *= 1 - (c === sol ? 0.9 : 0.6) * k; }
      }
      if (c !== sol && c.id !== 'lua') alfa *= (1 - diaNoCeu) * (1 - 0.5 * luar);
      if (c === sol) { alfa *= luzSolAqui; tam *= 0.25 + 0.75 * luzSolAqui; } // eclipse: o brilho do Sol some com o disco tapado
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
  desenharCoroa();
  vagas.forEach((v, j) => {
    if (v.obj) return corpoQuadro(v.obj, CORPOS.length + j);
    v.malha.visible = false;
    tamB[CORPOS.length + j] = 0;
    v.rotulo.style.display = 'none';
  });
  vagasExo.forEach((v, j) => {
    if (v.obj) return corpoQuadro(v.obj, CORPOS.length + NV + j);
    tamB[CORPOS.length + NV + j] = 0;
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
  // prédios: só a Terra de hoje, relevo real e fora do modo céu (no chão de uma cidade, eles tapariam o céu)
  predios.atualizar(camLocal, relT, T.qOri, _luzT, terra.ativo && estado.predios && !estado.ceuModo && !estado.epocaMa && !estado.gelo && estado.exagero === 1, estado.ceuModo);
  if (terra.ativo) terra.atualizar(camLocal, relT, T.qOri, _luzT.copy(solAparente).sub(T.abs).normalize(), estado.exagero, estado.atmFisica ? 0 : Math.min(Math.max(1.2 - altT / 300, 0), 1), estado.nivelMar / 1000, estado.gelo ? 1 : 0, camera, estado.ceuModo, estado.ceuModo);
  else terra.esconder();
  if (camadas) {
    // os nomes da Terra (cidades, picos) ficam no chão: o horizonte não os esconde
    const postosChao = relevoPerto ? rotulosPostos.filter((b) => !atrasDoRelevo.includes(b)) : rotulosPostos, n0 = postosChao.length;
    camadas.atualizar(camLocal, relT, T.qOri, sT, camera, postosChao,
      estado.epocaMa || estado.gelo || estado.ceuModo ? { cidades: 'nenhuma', fronteiras: false, nomes: false, picos: false } // camadas de hoje não valem no passado nem no céu
        : { cidades: estado.nomes ? estado.cidades : 'nenhuma', fronteiras: estado.fronteiras, nomes: estado.nomes && estado.nomesTerra, picos: estado.nomes && estado.picos },
      (dir) => (terra.ativo ? terra.altura(dir, estado.nivelMar / 1000) * estado.exagero : 0));
    if (relevoPerto) rotulosPostos.push(...postosChao.slice(n0)); // o que as camadas puseram
  }
  if (!relevoPerto) rotulosPostos.push(...atrasDoRelevo);
  desenharCeu(abs, rotulosPostos);
  desenharHaloSol(abs);
  desenharMessier(rotulosPostos, pxPorRad);
  if (!relevoPerto) for (const b of atrasDoRelevo) rotulosPostos.splice(rotulosPostos.indexOf(b), 1);
  desenharPequenos(abs, rotulosPostos);
  talvezGaia12();
  desenharMeteoros();
  desenharMissoes(abs, rotulosPostos, pxPorRad);
  desenharModelo(abs);
  desenharFrota(abs);
  $('pTerra').style.display = altT < T.raio * 10 && !document.body.classList.contains('foto') ? '' : 'none';
  const comSolo = CORPOS.find((c) => c.solo?.ativo);
  $('creditos').textContent = terra.ativo ? (estado.ceuModo ? tr('Terreno: EOX/Sentinel-2 · NASA · Mapzen/AWS · Natural Earth (créditos completos no manual)') : tr(CREDITOS) + (predios.visiveis() ? tr(' · Construções: © colaboradores do OpenStreetMap (OpenFreeMap)') : ''))
    : comSolo ? tr('Relevo (aqui, um ponto a cada {m} m): {c}', { m: Math.round(comSolo.solo.resolucao(_dl.copy(camAbs().sub(comSolo.abs)).normalize().applyQuaternion(_qi.copy(comSolo.qOri).invert())).metros), c: tr(comSolo.solo.credito) }) + (estado.texturas && CAMADAS[comSolo.id] ? tr(' · Imagens: {c}', { c: tr(CAMADAS[comSolo.id].credito) }) : '') : '';

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
    aviso(agoraDentro ? tr('De volta à bolha do rádio: aqui já chegam as transmissões humanas.') : tr('Você saiu da bolha do rádio: nenhum sinal humano chegou aqui ainda ({n} anos-luz da Terra).', { n: Math.round(rb / AL) }));
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
  const fCeu = gal.ceuVia.material.uniforms.mapa.value || (estado.viaReal && gal.ceuVia.material.uniforms.mapaReal.value) ? 1 - Math.min(Math.max((dSolPc - 300) / 1200, 0), 1) : 0;
  gal.ceuVia.visible = fCeu > 0;
  gal.ceuVia.scale.setScalar(5e10);
  gal.ceuVia.material.uniforms.forca.value = 0.85 * fCeu * (1 - diaNoCeu) * (1 - 0.85 * luar) * (1 - Math.min(brilhoUrbano() * 2.2, 1)); // na cidade a Via Láctea some
  gal.ceuVia.material.uniforms.beta.value.copy(betaVec);
  gal.ceuVia.material.uniforms.real.value = estado.viaReal && gal.ceuVia.material.uniforms.mapaReal.value ? 1 : 0;
  if (estado.telescopio) gal.ceuVia.material.uniforms.forca.value *= Math.min(1, 3 / estado.zoom); // no telescópio, o mapa (~11 pixels por grau) daria só um borrão: vai sumindo e ficam as estrelas
  gal.brilho.material.uniforms.ganho.value = 3.2 * (1 - fCeu);
  gal.poeira.material.uniforms.ganho.value = 1 - fCeu;
  for (const nv of [gal.brilho, gal.poeira, gal.campo, mrs].filter(Boolean)) {
    nv.material.uniforms.beta.value.copy(betaVec);
    const u = nv.material.uniforms;
    u.camAlto.value.copy(camAltoPc);
    u.camBaixo.value.copy(camBaixoPc);
    u.pxPorRad.value = pxPorRad;
    u.escalaPx.value = renderer.getPixelRatio();
    u.apagar.value = Math.max(diaNoCeu, luar * 0.85, Math.min(brilhoUrbano() * 2.2, 1)); // a Via Láctea some na cidade
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
    u.apagar.value = Math.max(diaNoCeu, luar * 0.6); // a poluição luminosa age pelo limite de magnitude
    u.refr.value = refrAtiva ? 1 : 0; u.zenite.value.copy(zenRefr);
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
    // vista de lado, de dentro da órbita: esmaece (as dos planetas, perto da Terra, viravam riscos pela tela toda)
    const relO = tmpV.copy(abs).sub(base), alturaPlano = Math.abs(relO.dot(o.normal)) / o.raioMax;
    const deLado = relO.length() < 2.5 * o.raioMax ? Math.min(Math.max((alturaPlano - 0.01) / 0.08, 0), 1) : 1;
    o.linha.material.opacity = (o.corpo.tipo === 'lua' ? 0.22 : 0.3) * (1 - diaNoCeu) * deLado;
  }

  for (const v of vagasExo.map((v) => ({ m: v.linha, pts: v.pts, ok: !!v.obj, alfa: 0.3 })).concat({ m: zonaHab.malha, pts: zonaHab.pts, ok: true, alfa: 0.13 })) {
    v.m.visible = !!sistemaExo && estado.linhas && v.ok;
    if (!v.m.visible) continue;
    const arr = v.m.geometry.attributes.position.array, base = sistemaExo.abs;
    for (let k = 0; k < v.pts.length; k++) {
      tmpV.copy(base).add(v.pts[k]).sub(abs);
      aberrarJS(tmpV.multiplyScalar(comprimir(tmpV.length()))).toArray(arr, k * 3);
    }
    v.m.geometry.attributes.position.needsUpdate = true;
    v.m.material.opacity = v.alfa * (1 - diaNoCeu);
  }

  vr.desenhar();
  brilho.desenhar(cena, camera, estado.brilho && !estado.leve && !vr.ativo ? 0.8 : 0, 0.9); // halo em volta das luzes fortes
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
  if (seg < 1) return [tr('agora mesmo'), ''];
  if (seg < 365.25 * 86400) return [tr('há {d}', { d: duracao(seg) }), ''];
  const ano = anoSim(estado.jd) - seg / (365.25 * 86400);
  let quando;
  if (ano >= 1) quando = tr(ano < 1000 ? 'no ano {a} d.C.' : 'no ano {a}', { a: Math.floor(ano) });
  else if (ano > -10000) quando = tr('no ano {a} a.C.', { a: Math.max(Math.ceil(-ano), 1) });
  else quando = tr('há {d}', { d: duracao(seg) });
  const era = ERAS.find(([inicio]) => ano >= inicio);
  return [quando, era ? tr('na Terra: {e}', { e: tr(era[1]) }) : tr('antes de a Terra existir')];
}

// Nomes das constelações (perto do Sol), bússola e informações do céu no modo "olhar para o céu"
// Morros e bordas de cratera escondem o céu atrás deles. Perto do chão, mede o horizonte de verdade em volta (a cada
// poucos quadros) e devolve, coluna a coluna da tela, a área abaixo dele, onde os nomes do céu não entram.
const HZ_N = 48, horiz = { elev: new Float32Array(HZ_N), e1: new THREE.Vector3(), e2: new THREE.Vector3(), up: new THREE.Vector3(), pos: new THREE.Vector3(), c: null, quadro: -99 };
const _hzP = new THREE.Vector3(), _hzD = new THREE.Vector3();
function caixasDoRelevo() {
  const c = estado.ref, H = horiz;
  H.perto = false;
  if (!c || !c.malha || c.tipo === 'estrela' || estado.telescopio || vr.ativo) return [];
  const olho = estado.local, r = olho.length();
  if (altRef > c.raio * 30 || r <= c.raio) return []; // de longe, o disco é pequeno
  H.perto = altRef < Math.max(3, c.raio * 0.003) && !GASOSOS.includes(c.id) && !(c.nevoa && nevoaPorCima(c));
  const base = () => {
    H.up.copy(olho).normalize();
    H.e1.crossVectors(H.up, Math.abs(H.up.y) < 0.9 ? eixoY : eixoX).normalize();
    H.e2.crossVectors(H.up, H.e1);
  };
  if (!H.perto) { // mais alto: o horizonte é a borda da esfera
    base(); H.c = null;
    H.elev.fill(-Math.acos(Math.min(c.raio / r, 1)));
  } else if (H.c !== c || quadro - H.quadro > 10 || H.pos.distanceTo(olho) > 0.01 + altRef * 0.05) {
    H.c = c; H.quadro = quadro; H.pos.copy(olho);
    base();
    const faixa = c.relevo ? c.relevo[2] - c.relevo[1] : 10;
    const dMax = Math.min(c.raio * 0.5, Math.sqrt(2 * c.raio * (Math.max(altRef, 0) + faixa)) * 1.5);
    for (let i = 0; i < HZ_N; i++) {
      const az = (i / HZ_N) * 2 * Math.PI;
      _hzD.copy(H.e1).multiplyScalar(Math.cos(az)).addScaledVector(H.e2, Math.sin(az));
      let max = -Math.PI / 2;
      for (let d = 0.005; d < dMax; d *= 1.35) {
        _hzP.copy(olho).addScaledVector(_hzD, d);
        _hzP.setLength(raioSuperficie(c, _hzP)).sub(olho);
        max = Math.max(max, Math.asin(Math.min(Math.max(_hzP.normalize().dot(H.up), -1), 1)));
      }
      H.elev[i] = max;
    }
  }
  // um ponto da tela está abaixo do horizonte?
  const abaixo = (x, y) => {
    _hzP.set((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
    const el = Math.asin(Math.min(Math.max(_hzP.dot(H.up), -1), 1));
    let az = Math.atan2(_hzP.dot(H.e2), _hzP.dot(H.e1)) / (2 * Math.PI) * HZ_N;
    if (az < 0) az += HZ_N;
    const i = Math.floor(az) % HZ_N, f = az - Math.floor(az);
    return el < H.elev[i] * (1 - f) + H.elev[(i + 1) % HZ_N] * f;
  };
  // o perfil projetado na tela; em cada coluna, os trechos entre os cruzamentos que ficam abaixo dele
  const pts = [];
  for (let i = 0; i <= HZ_N; i++) {
    const az = (i / HZ_N) * 2 * Math.PI, el = H.elev[i % HZ_N];
    _hzP.copy(H.e1).multiplyScalar(Math.cos(az) * Math.cos(el)).addScaledVector(H.e2, Math.sin(az) * Math.cos(el)).addScaledVector(H.up, Math.sin(el));
    _hzP.applyMatrix4(camera.matrixWorldInverse);
    if (_hzP.z >= -1e-9) { pts.push(null); continue; }
    _hzP.applyMatrix4(camera.projectionMatrix);
    pts.push([(_hzP.x * 0.5 + 0.5) * innerWidth, (-_hzP.y * 0.5 + 0.5) * innerHeight]);
  }
  const caixas = [], L = 16;
  for (let x = L / 2; x < innerWidth + L; x += L) {
    const ys = [-100];
    for (let i = 0; i < HZ_N; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!a || !b || (a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
      const y = a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
      if (y > -100 && y < innerHeight + 100) ys.push(y);
    }
    ys.push(innerHeight + 100);
    ys.sort((p, q) => p - q);
    for (let k = 0; k + 1 < ys.length; k++) {
      if (ys[k + 1] - ys[k] < 1) continue;
      if (abaixo(x, Math.min(Math.max((ys[k] + ys[k + 1]) / 2, 0), innerHeight))) caixas.push([x - L / 2, ys[k], x + L / 2, ys[k + 1]]);
    }
  }
  return caixas;
}

function desenharCeu(abs, postos) {
  if (linhasConst) {
    const dSolAl = abs.distanceTo(PORID.sol.abs) / AL;
    const longe = Math.min(Math.max((dSolAl - 50) / 150, 0), 1); // somem entre 50 e 200 anos-luz do Sol
    const op = 0.38 * (1 - longe) * (1 - Math.min(diaNoCeu * 1.6, 1));
    linhasConst.visible = estado.linhasConst && op > 0.01;
    linhasConst.material.uniforms.opac.value = op;
    linhasConst.material.uniforms.beta.value.copy(betaVec);
    renderer.getDrawingBufferSize(linhasConst.material.uniforms.res.value);
    linhasConst.material.uniforms.meia.value = 0.6 * renderer.getPixelRatio(); // ~1,2 pixel de tela de largura
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

const PONTOS = {
  pt: ['N', 'NNE', 'NE', 'LNE', 'L', 'LSE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'],
  en: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
  es: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'],
}[idioma];
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
  $('ceuHoraLocal').textContent = `${h2(dt.getUTCHours())}:${h2(dt.getUTCMinutes())} · ${dt.toLocaleDateString(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (usarOficial()) {
    const z = zonaAqui();
    $('ceuTipoHora').textContent = tr('hora oficial ({z}) · hora solar {h}', { z: rotuloUTC(deslocamento(z.zona, msUTC)) + (z.estimada ? tr(', fuso estimado pela longitude') : z.cidade ? tr(', fuso de {c}', { c: z.cidade.nome }) : ''), h: `${h2(solar.getUTCHours())}:${h2(solar.getUTCMinutes())}` });
  } else $('ceuTipoHora').textContent = tr('hora solar média do lugar (pela longitude)');
  // estação do ano (hemisfério do lugar)
  const diaAno = (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(dt.getUTCFullYear(), 0, 0)) / 86400000;
  const norteEst = diaAno < 79 || diaAno >= 355 ? 'inverno' : diaAno < 172 ? 'primavera' : diaAno < 265 ? 'verão' : 'outono';
  const oposto = { inverno: 'verão', verão: 'inverno', primavera: 'outono', outono: 'primavera' };
  $('ceuEstacao').textContent = `${tr(`{e} no hemisfério ${la >= 0 ? 'norte' : 'sul'}`, { e: tr(la >= 0 ? norteEst : oposto[norteEst]) })} · ${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'}, ${sig(Math.abs(lo))}° ${lo >= 0 ? PONTOS[4] : PONTOS[12]}`;
  // para onde se olha
  const fr = new THREE.Vector3(0, 0, -1).applyQuaternion(estado.q);
  const alt = Math.asin(Math.max(-1, Math.min(1, fr.dot(up)))) / GRAU;
  const az = Math.atan2(fr.dot(leste), fr.dot(norte)) / GRAU;
  $('ceuOlhando').textContent = tr(alt >= 0 ? '{p} ({az}°), {alt}° acima do horizonte' : '{p} ({az}°), {alt}° abaixo do horizonte', { p: pontoCardeal(az), az: Math.round(((az % 360) + 360) % 360), alt: Math.round(alt) });
  // o que está acima do horizonte agora
  const abs = camAbs(), lista = [];
  for (const c of CORPOS) {
    if (c === E || !['planeta', 'lua', 'estrela', 'anao'].includes(c.tipo) || (c.tipo === 'lua' && c.id !== 'lua')) continue;
    if (c.id === 'plutao') continue;
    const v = c.abs.clone().sub(abs).normalize();
    const a = Math.asin(v.dot(up)) / GRAU;
    if (a < 0) continue;
    const z = Math.atan2(v.dot(leste), v.dot(norte)) / GRAU;
    lista.push(`${c.nome}: ${pontoCardeal(z)}, ${Math.round(a)}°${c.id === 'urano' || c.id === 'netuno' ? tr(' (só com telescópio)') : ''}`);
  }
  $('ceuVisiveis').textContent = lista.length ? lista.join(' · ') : tr('nenhum planeta acima do horizonte agora');
  $('ceuMeteoros').textContent = textoMeteoros();
  const ano = 2000 + (estado.jd - 2451545) / 365.25;
  const sol = PORID.sol.abs.clone().sub(abs).normalize(), aSol = Math.asin(sol.dot(up)) / GRAU;
  $('ceuSituacao').textContent = (ano < 1800 || ano > 2050 ? tr('Atenção: fora de 1800–2050 as estrelas ficam nas posições de hoje.') + ' ' : '')
    + tr(aSol > 0 ? 'Dia: o céu claro esconde as estrelas.' : aSol > -6 ? 'Crepúsculo civil: só os astros mais brilhantes.' : aSol > -18 ? 'Crepúsculo: as estrelas vão aparecendo.'
      : luar > 0.3 ? 'Noite com luar forte: a Lua apaga as estrelas fracas e a Via Láctea.' : luar > 0.05 ? 'Noite com algum luar.' : 'Noite fechada: céu escuro, sem nuvens e sem luzes de cidade.');
}

function painel() {
  if (estado.ceuModo) { painelCeu(); hudTelescopio(); }
  if (estado.embarcado) painelMissao();
  const abs = camAbs();
  const vr = velocidade(velMedida);
  if (estado.pousado && !estado.cruzeiro && !eixos().frente && !eixos().lado) velMedida = 0; // parado no chão é parado
  $('velReal').textContent = velMedida < 1e-6 ? tr('parado') : vr.principal;
  const relA = estado.ref ? tr('em relação {a:c}', { c: estado.ref }) : '';
  $('velRealSub').textContent = velMedida < 1e-6 ? '' : [vr.secundaria, freando ? tr('freando') : '', relA].filter(Boolean).join(' · ');

  let rel = '';
  if (estado.efeito === 'relatividade' && velMedida > 0.01 * C) {
    const g = gama(velMedida);
    rel = tr('γ = {g} · 1 s a bordo = {d} na Terra', { g: sig(g), d: duracao(g) });
  }
  if (relativistico() && estado.v >= C) {
    rel = tr('Na luz, o relógio de bordo para: com destino, a chegada é imediata.') + (estado.v > C ? ' ' + tr('(Acima da luz não existe; vale como na luz.)') : '');
  }
  $('relInfo').textContent = rel;
  $('refFrame').textContent = (estado.ref ? estado.ref.nome : tr('espaço (fixo)')) + (estado.pousado ? tr(' · pousado') : '');
  $('maisPerto').textContent = proximo ? proximo.nome : '—';
  const pe = [estado.ref, estado.alvo, proximo].find((c) => c?.exo);
  const est = !pe && sistemaExo ? sistemaExo.exoSistema : null;
  $('rotExo').hidden = $('exoInfo').hidden = !pe && !est;
  if (pe) { $('rotExo').textContent = pe.nome; $('exoInfo').textContent = resumoPlaneta(pe, sig); }
  else if (est) { $('rotExo').textContent = tr('Planetas'); $('exoInfo').textContent = tn(est.pl.length, '{n} conhecido em volta {de:c} (NASA Exoplanet Archive, {d}); órbitas reais, orientação no céu aproximada', '{n} conhecidos em volta {de:c} (NASA Exoplanet Archive, {d}); órbitas reais, orientação no céu aproximada', { c: sistemaExo, d: new Date(exo.data).toLocaleDateString(LOCALE, { timeZone: 'UTC' }) }); }
  $('altitude').textContent = proximo ? distancia(Math.max(altProx, 0)) : '—';
  if (proximo && altProx < proximo.raio * 2 && proximo.tipo !== 'estrela') {
    const [la, lo] = latLon(proximo, abs.clone().sub(proximo.abs));
    $('coord').textContent = `${sig(Math.abs(la))}° ${la >= 0 ? 'N' : 'S'} · ${sig(Math.abs(lo))}° ${lo >= 0 ? PONTOS[4] : PONTOS[12]}`;
  } else $('coord').textContent = '—';
  const dT = abs.distanceTo(PORID.terra.abs);
  $('daTerra').textContent = distancia(dT);
  const segLuz = tempoLuzAnos(dT / AL) * 365.25 * 86400;
  $('luzTerra').textContent = dT > 1e8 * AL ? tr('{d} para a luz daqui chegar à Terra (com a expansão do universo)', { d: duracao(segLuz) }) : duracao(segLuz);
  const [quando, epoca] = quandoSaiu(segLuz);
  $('luzSaiu').textContent = quando;
  $('epoca').textContent = epoca;
  $('faixa').textContent = nomeFaixa();
  $('doSol').textContent = distancia(abs.distanceTo(PORID.sol.abs));
  $('dataSim').textContent = data(estado.jd);
  const ano = 2000 + (estado.jd - 2451545) / 365.25;
  $('avisoData').textContent = ano < 1800 || ano > 2050 ? tr('Fora de 1800–2050: estrelas sem o movimento próprio (planetas e Lua continuam precisos).') : '';
  const fz = -new Date().getTimezoneOffset() / 60;
  $('fusoTxt').textContent = tr('hora do seu computador ({z})', { z: `UTC${fz >= 0 ? '+' : '−'}${Math.abs(fz)}` });

  const p = estado.piloto;
  let st = '';
  if (p && p.modo === 'vel') {
    const t = (p.resta || 0) / Math.max(velMedida, 1e-9);
    st = relativistico()
      ? tr('A caminho {de:c}: faltam {d} · chegada em {b} a bordo ({t} lá fora)', { c: p.alvo, d: distancia(p.resta || 0), b: duracao(t / gama(velMedida)), t: duracao(t) })
      : tr('A caminho {de:c}: faltam {d} · chegada em {t}', { c: p.alvo, d: distancia(p.resta || 0), t: duracao(t) });
  }
  else if (p && p.modo === 'tempo') st = tr('A caminho {de:c}: {d} · {t} restantes', { c: p.alvo, d: distancia(abs.distanceTo(p.alvo.abs)), t: duracao(Math.max(p.dur - p.t, 0)) });
  else if (p && p.modo === 'pouso') st = tr('Pousando {em:c}: altitude {d}', { c: p.alvo, d: distancia(Math.max(altProx, 0)) });
  else if (p && p.modo === 'lugar') st = tr('Voando para {c}: {d} de altitude', { c: p.lugar.nome, d: distancia(Math.max(altProx, 0)) });
  else if (estado.aviao) st = tr('Modo avião: {d} sobre o chão · ↑↓ sobe/desce · ←→ vira · Y desliga', { d: distancia(estado.altAviao) });
  else if (estado.pousado) st = GASOSOS.includes(estado.pousado.id) ? tr('Sobre as nuvens {de:c}. Setas para voar, R para subir.', { c: estado.pousado }) : tr('No chão {de:c}. Setas para andar, R para decolar.', { c: estado.pousado });
  else if (estado.alvo?.soCeu) st = tr('{c} · {tipo}: um objeto do céu, para ver com o telescópio no modo céu', { c: estado.alvo.nome, tipo: tr(estado.alvo.tipo.trim()) });
  else if (estado.alvo) {
    const dc = distChegada(estado.alvo);
    const d = abs.distanceTo(estado.alvo.abs) - dc;
    st = d < dc * 0.02 ? tr('Você está {em:c}.', { c: estado.alvo }) : (relativistico()
      ? tr('{c}: {d} · na velocidade escolhida, {b} a bordo ({t} lá fora)', { c: estado.alvo, d: distancia(d), b: estado.v >= C ? duracao(0) : duracao(d / passoBordo(estado.v)), t: duracao(d / Math.min(estado.v, C)) })
      : tr('{c}: {d} · na velocidade escolhida, {t}', { c: estado.alvo, d: distancia(d), t: duracao(d / estado.v) }));
  }
  if (estado.cruzeiro) st = st ? `${tr('Cruzeiro ligado (C para desligar)')} · ${st}` : tr('Cruzeiro ligado (C para desligar)');
  $('statusViagem').textContent = st;
  atualizarNoChao();
  if (performance.now() > avisoAte) $('aviso').textContent = '';
}

// Quadro "no chão": onde se está, a gravidade (comparada à da Terra) e os comandos, enquanto se está pousado
let noChaoTxt = '';
function atualizarNoChao() {
  const c = estado.pousado;
  document.body.classList.toggle('noChao', !!c);
  document.body.classList.toggle('noGas', !!c && GASOSOS.includes(c.id));
  if (!c) { noChaoTxt = ''; return; }
  const g = gravidadeDe(c), pct = (g / 9.81) * 100;
  const kg = (60 * g) / 9.81, s2 = (n) => n.toLocaleString(LOCALE, { maximumSignificantDigits: 2 }); // as tabelas dão 2 ou 3 algarismos
  const gTxt = tr('gravidade {g} m/s² ({p}% da da Terra): quem pesa 60 kg sente como {k}', { g: s2(g), p: s2(pct), k: kg < 1 ? `${s2(kg * 1000)} g` : `${s2(kg)} kg` });
  const gas = GASOSOS.includes(c.id);
  const cmd = gas ? (ehCelular() ? tr('▲▼ voar · arraste para olhar · ⇡ subir') : tr('↑↓ voar · ←→ virar · arraste para olhar · R sobe'))
    : ehCelular() ? tr('▲▼ andar · arraste para olhar · ⤒ pular · ⇡ decolar') : tr('↑↓ andar · ←→ virar · arraste para olhar · Espaço pula · R decola · Z olha o céu');
  const txt = `${gas ? tr('Sobre as nuvens {de:c}', { c }) : tr('No chão {de:c}', { c })} · ${gTxt}\n${cmd}`;
  if (txt !== noChaoTxt) { noChaoTxt = txt; $('noChao').textContent = txt; }
}

renderer.setAnimationLoop(passo); // (e não requestAnimationFrame: nos óculos quem dá o ritmo é a sessão WebXR)
// Versão nova publicada: uma aba aberta há horas continuaria com o código antigo; a cada 10 minutos olha a data de
// modificação da página e do código no servidor e, se for mais nova que a do começo, oferece recarregar.
// Compara datas, não etiquetas (ETag): proxies de rede corporativa e servidores diferentes do CDN mudam a etiqueta
// (comprimida ou não, "W/"…) sem que o arquivo tenha mudado, e o aviso aparecia toda hora.
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  const data = (r) => {
    const lm = Date.parse(r.headers.get('last-modified') || '');
    if (lm) return lm;
    const h = /^(?:W\/)?"?([0-9a-f]{8})-/i.exec(r.headers.get('etag') || ''); // GitHub Pages: "<data em hexa>-<tamanho>"
    return h ? parseInt(h[1], 16) * 1000 : NaN;
  };
  const marca = () => Promise.all(['./', 'js/main.js'].map((u) => fetch(u, { method: 'HEAD', cache: 'no-store' }).then(data)))
    .then((l) => (l.every(Number.isFinite) ? Math.max(...l) : NaN));
  let inicial = NaN;
  marca().then((m) => (inicial = m)).catch(() => {});
  setInterval(() => marca().then((m) => {
    if (!Number.isFinite(inicial)) inicial = m;
    else if (m > inicial + 1000) $('novaVersao').hidden = false;
  }).catch(() => {}), 600000);
  $('btAtualizar').onclick = () => location.reload();
}
// Contador de visitas (GoatCounter, sem cookies). Só aparece no site publicado e se o contador público estiver ligado lá.
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  fetch('https://viagem-pelo-espaco.goatcounter.com/counter/TOTAL.json').then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.count) return;
    $('visitas').textContent = tr('{n} visitas desde a publicação', { n: Number(String(j.count).replace(/[\s\u202f,.]/g, '')).toLocaleString(LOCALE) });
    $('visitas').hidden = false;
  }).catch(() => {});
}
// ------------------------------- boas-vindas e modo leve -------------------------------
let ceuPendente = null; // data escolhida na tela de boas-vindas, aplicada quando o modo céu começar
function aplicarCeuPendente() {
  if (!ceuPendente) return;
  const { ano, mes, dia, hh, mm } = ceuPendente;
  ceuPendente = null;
  definirHoraLocal(ano, mes, dia, hh, mm);
  aviso(tr('O céu de {d}, às {h}.', { d: new Date(Date.UTC(ano, mes - 1, dia)).toLocaleDateString(LOCALE, { timeZone: 'UTC' }), h: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }));
}
const lerGuardado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
// aparelho modesto? (tela de toque, pouca memória ou poucos núcleos)
function aparelhoModesto() {
  if (matchMedia('(pointer: coarse)').matches) return tr('parece um celular ou tablet');
  if (navigator.deviceMemory && navigator.deviceMemory <= 4) return tr('o aparelho tem pouca memória');
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return tr('o processador tem poucos núcleos');
  return '';
}
function aplicarLeve(ligar, motivo = '') {
  estado.leve = ligar;
  renderer.setPixelRatio(ligar ? 1 : Math.min(devicePixelRatio, 2));
  estado.atmFisica = !ligar;
  estado.predios = !ligar;
  if (gaia) gaia.visible = !ligar; else if (!ligar) pedirGaia();
  if (gaia12) gaia12.visible = !ligar;
  if (ligar) { estado.cinturoes = false; $('ckCint').checked = false; }
  pintores.forEach((f) => f());
  $('bvLeve').checked = ligar;
  $('bvLeveMotivo').textContent = motivo ? tr('(Ligado porque {m}.)', { m: motivo }) : '';
}
{
  const g = lerGuardado('viagemLeve');
  if (g !== null) aplicarLeve(g === '1');
  else { const m = aparelhoModesto(); if (m) aplicarLeve(true, m); }
}
$('bvLeve').onchange = (e) => { aplicarLeve(e.target.checked); guardar('viagemLeve', e.target.checked ? '1' : '0'); };
// se ficar lento nos primeiros segundos, liga o modo leve sozinho (só se a pessoa nunca escolheu)
let vigia = { ini: 0, quadros: 0, feito: lerGuardado('viagemLeve') !== null };
function vigiarDesempenho(agora) {
  if (vigia.feito || estado.leve || document.hidden || !$('boasVindas').hidden) { vigia.ini = 0; return; }
  if (!vigia.ini) { vigia.ini = agora + 5000; vigia.quadros = 0; return; } // espera 5 s (texturas e dados chegando) antes de medir
  if (agora < vigia.ini) return;
  vigia.quadros++;
  const t = (agora - vigia.ini) / 1000;
  if (t > 10) {
    vigia.feito = true;
    if (vigia.quadros / t < 18) { aplicarLeve(true, tr('a simulação estava lenta neste aparelho')); aviso(tr('Liguei o modo leve porque estava lento. Dá para desligar em "Início".')); }
  }
}
function abrirBoasVindas() { $('boasVindas').hidden = false; }
function fecharBoasVindas() { $('boasVindas').hidden = true; guardar('viagemVisitou', '1'); }
$('btInicio').onclick = abrirBoasVindas;
// Idioma: seletor (Português, English, Español) e o manual no idioma escolhido
for (const sel of document.querySelectorAll('.selIdioma')) {
  for (const [k, nome] of Object.entries(IDIOMAS)) sel.append(new Option(nome, k));
  sel.value = idioma;
  sel.onchange = () => trocarIdioma(sel.value);
}
for (const a of document.querySelectorAll('a[href="manual.html"]')) a.href = manualIdioma;
$('bvExplorar').onclick = fecharBoasVindas;
$('bvPousar').onclick = () => { if (!cidadesLista.length) { aviso(tr('Carregando a lista de cidades…')); return setTimeout(() => $('bvPousar').click(), 500); } const t = $('bvCidade').value; if (!acharCidade(t)) return aviso(tr('Escolha uma cidade da lista.')); fecharBoasVindas(); pousarNaCidade(t, false); };
$('bvCidade').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('bvPousar').click(); } };
$('bvCeu').onclick = () => {
  if (!cidadesLista.length) { aviso(tr('Carregando a lista de cidades…')); return setTimeout(() => $('bvCeu').click(), 500); }
  const t = $('bvCidade2').value, d = $('bvData').value, h = $('bvHora').value || '21:00';
  if (!acharCidade(t)) return aviso(tr('Escolha uma cidade da lista.'));
  if (d) { const [ano, mes, dia] = d.split('-').map(Number), [hh, mm] = h.split(':').map(Number); ceuPendente = { ano, mes, dia, hh, mm }; }
  fecharBoasVindas();
  pousarNaCidade(t, true);
};
$('bvISS').onclick = () => { const o = missoes.porId.iss; if (!o) return aviso(tr('A ISS ainda está carregando; tente de novo em alguns segundos.')); fecharBoasVindas(); embarcar(o); };
$('bvVoyager').onclick = () => {
  const o = missoes.porId.voyager1;
  if (!o) return aviso(tr('As sondas ainda estão carregando; tente de novo em alguns segundos.'));
  fecharBoasVindas(); embarcar(o);
  const m = o.momentos.find((x) => x.titulo.includes('Pálido'));
  if (m) irMomento(o, m);
};
$('bvSaturno').onclick = () => {
  fecharBoasVindas();
  document.querySelector('input[name=modo][value=tempo]').checked = true;
  escolherAlvo(PORID.saturno);
  iniciarViagem(PORID.saturno);
  aviso(tr('Rumo a Saturno: 1,3 bilhão de km em 12 segundos.'));
};
$('bvPangeia').onclick = () => { fecharBoasVindas(); teleportar(PORID.terra); $('selEpoca').value = 'pangeia'; aplicarEpoca('pangeia'); };
// ------------------------------- roteiros guiados -------------------------------
// cada passo: título, texto (ou função que devolve o texto) e uma ação; quem avança é a pessoa ("Próximo")
function viajarPara(c, seg = 10) {
  if (!c) return;
  if (estado.embarcado) desembarcar();
  if (estado.ceuModo) sairDoCeu();
  if (estado.epocaMa || estado.gelo) { $('selEpoca').value = 'hoje'; aplicarEpoca('hoje'); }
  document.querySelector('input[name=modo][value=tempo]').checked = true;
  $('segundos').value = seg;
  escolherAlvo(c);
  iniciarViagem(c);
}
const estrelaPorNome = (n) => (cat.porNome.has(n) ? estrelaObj(cat.porNome.get(n)) : null);
function olharPara(c) { if (c) quatOlhando(c.abs.clone().sub(camAbs()), estado.q); }
// o mais alto acima do horizonte, entre os candidatos (no modo céu)
function maisAlto(lista, dirDe) {
  const up = estado.local.clone().normalize();
  let melhor = null, h = 0.12; // pelo menos ~7° acima do horizonte
  for (const x of lista) { const d = dirDe(x); if (!d) continue; const v = d.dot(up); if (v > h) { h = v; melhor = x; } }
  return melhor;
}
const dirCorpo = (c) => c && c.abs.clone().sub(camAbs()).normalize();
function hoje21h() { const t = horaLocalAgora(); return { ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate(), hh: 21, mm: 0 }; }
function precisaCeu() { if (!estado.ceuModo) { aviso(tr('Espere o pouso terminar e o céu aparecer; depois clique em "Próximo".')); return false; } return true; }
function telescopioEm(c, zoom) { if (!estado.telescopio) alternarTelescopio(); definirZoom(zoom); estado.alvo = c; apontar(c); }

const ROTEIROS = {
  grand: { titulo: 'Grand Tour do Sistema Solar', passos: [
    { nome: 'A Terra', texto: 'O ponto de partida: 12.742 km de diâmetro, a 150 milhões de km do Sol. A luz do Sol leva 8 minutos e 20 segundos para chegar aqui.', acao: () => { if (estado.embarcado) desembarcar(); teleportar(PORID.terra); } },
    { nome: 'A Lua', texto: 'A 384 mil km, a luz leva 1,3 segundo para ir da Terra à Lua. Ela mostra sempre a mesma face para nós. Doze pessoas caminharam aqui entre 1969 e 1972.', acao: () => viajarPara(PORID.lua, 6) },
    { nome: 'Marte', texto: 'Metade do tamanho da Terra, com um dia de 24 h 37 min. O Olympus Mons, o maior vulcão do Sistema Solar, tem cerca de 22 km de altura. Chegue perto do chão para ver o céu cor de caramelo.', acao: () => viajarPara(PORID.marte, 10) },
    { nome: 'Júpiter', texto: 'Caberiam 1.300 Terras dentro dele. A Grande Mancha Vermelha é uma tempestade maior que a Terra, observada há mais de 150 anos. Tem quase cem luas; as quatro maiores foram descobertas por Galileu em 1610.', acao: () => viajarPara(PORID.jupiter, 10) },
    { nome: 'Saturno', texto: 'Os anéis têm 270 mil km de diâmetro, mas em geral menos de um quilômetro de espessura: são bilhões de pedaços de gelo. Titã, a maior lua, tem uma atmosfera mais densa que a da Terra.', acao: () => viajarPara(PORID.saturno, 10) },
    { nome: 'Urano', texto: 'Urano gira deitado: o eixo é inclinado 98°. Cada polo passa 42 anos de dia e 42 anos de noite. Só uma sonda o visitou: a Voyager 2, em 1986.', acao: () => viajarPara(PORID.urano, 10) },
    { nome: 'Netuno', texto: 'A 4,5 bilhões de km, a luz do Sol leva mais de 4 horas para chegar. Aqui sopram os ventos mais rápidos do Sistema Solar, de mais de 2.000 km/h.', acao: () => viajarPara(PORID.netuno, 10) },
    { nome: 'Plutão', texto: 'Um planeta anão, menor que a nossa Lua. Em 2015, a New Horizons passou por aqui e encontrou um enorme coração de gelo de nitrogênio.', acao: () => viajarPara(PORID.plutao, 10) },
    { nome: 'Olhando para trás', texto: 'Daqui, o Sol é só a estrela mais brilhante do céu, e a Terra nem aparece. Toda a história humana aconteceu perto daquele ponto de luz.', acao: () => { pararTudo(); olharPara(PORID.sol); } },
  ] },
  voyager: { titulo: 'Seguindo a Voyager 1', passos: () => {
    const o = missoes.porId.voyager1;
    if (!o) return [];
    const p = o.momentos.map((m) => ({ nome: tr(m.titulo), texto: tr(m.texto), acao: () => { if (estado.embarcado !== o) embarcar(o); irMomento(o, m); } }));
    p.push({ nome: 'Hoje', texto: () => {
      const dSol = o.abs.distanceTo(PORID.sol.abs), dT = o.abs.distanceTo(PORID.terra.abs);
      return tr('Lançada em 1977, a Voyager 1 é o objeto feito pelo ser humano mais distante: agora está a {ua} UA do Sol, ou {d}. Um sinal de rádio leva {t} para chegar até nós. Ela ainda manda dados.', { ua: sig(dSol / UA), d: distancia(dSol).split(' · ')[0], t: duracao(dT / C) });
    }, acao: () => { if (estado.embarcado !== o) embarcar(o); estado.jd = jdAgora(); estado.ritmo = 1; $('selRitmo').value = '1'; } });
    return p;
  } },
  escala: { titulo: 'Da Terra à borda do universo', passos: [
    { nome: 'A Terra', texto: 'Uma viagem pelas escalas do universo, sempre em 12 segundos por etapa, não importa a distância.', acao: () => { if (estado.embarcado) desembarcar(); teleportar(PORID.terra); } },
    { nome: 'O Sol', texto: 'O Sol tem 109 vezes o diâmetro da Terra e concentra 99,8% de toda a massa do Sistema Solar.', acao: () => viajarPara(PORID.sol, 8) },
    { nome: 'Alfa Centauri', texto: 'O sistema estelar mais próximo, a 4,4 anos-luz: 41 trilhões de km. A Voyager 1 levaria uns 75 mil anos para chegar.', acao: () => viajarPara(estrelaPorNome('Alfa Centauri A'), 12) },
    { nome: 'O centro da Via Láctea', texto: 'A 26 mil anos-luz, o centro da nossa galáxia esconde um buraco negro de 4 milhões de massas solares, Sagitário A*.', acao: () => viajarPara(PORID.centro, 12) },
    { nome: 'A Via Láctea vista de fora', texto: 'Cerca de 100 mil anos-luz de diâmetro e algumas centenas de bilhões de estrelas. O Sol fica num braço menor, o de Órion, a meio caminho da borda.', acao: () => viajarPara(PORID.vialactea, 12) },
    { nome: 'Andrômeda', texto: 'A 2,5 milhões de anos-luz: a luz que vemos dela saiu quando os primeiros humanos do gênero Homo andavam pela África. Daqui a uns 4,5 bilhões de anos, ela e a Via Láctea vão se fundir.', acao: () => viajarPara(PORID.andromeda, 12) },
    { nome: 'O Aglomerado de Virgem', texto: 'A cerca de 54 milhões de anos-luz, mais de mil galáxias presas pela gravidade. A Via Láctea e Andrômeda estão na periferia desse grupo.', acao: () => viajarPara(PORID.virgem, 12) },
    { nome: 'A borda do universo observável', texto: 'A 46 bilhões de anos-luz em qualquer direção. Além dela, a luz ainda não teve tempo de chegar até nós desde o Big Bang, há 13,8 bilhões de anos.', acao: () => viajarPara(PORID.borda, 12) },
  ] },
  noite: { titulo: 'Uma noite no céu', passos: () => {
    const cidade = $('cidadePouso').value || $('bvCidade').value || $('bvCidade2').value || 'Rio de Janeiro';
    return [
      { nome: tr('O céu de {c}', { c: acharCidade(cidade)?.nome ?? cidade }), texto: 'Vamos pousar e olhar o céu desta noite, às 21 h, sem nuvens e sem as luzes da cidade, como num campo bem escuro.', acao: () => { if (estado.embarcado) desembarcar(); ceuPendente = hoje21h(); pousarNaCidade(cidade, true); } },
      { nome: 'Uma constelação', texto: () => (estado.rotConst ? tr('Esta é {c}. As linhas ligam as estrelas como os antigos imaginavam a figura; as estrelas de uma constelação em geral estão a distâncias muito diferentes de nós.', { c: estado.rotConst }) : tr('Arraste para olhar em volta: os nomes e as linhas das constelações estão ligados.')), acao: () => {
        if (!precisaCeu()) return;
        estado.constelacoes = true; estado.linhasConst = true; pintarCeuBotoes();
        const c = maisAlto(constelacoes.filter((k) => ['Órion', 'Escorpião', 'Cruzeiro do Sul', 'Sagitário', 'Leão', 'Cisne', 'Pégaso', 'Touro', 'Ursa Maior', 'Cassiopeia', 'Centauro', 'Gêmeos'].includes(k.nomePt)), (k) => k.dir);
        estado.rotConst = c?.nome;
        if (c) quatOlhando(c.dir.clone(), estado.q, estado.local.clone().normalize());
      } },
      { nome: 'A Lua e os planetas', texto: () => (estado.rotAstro ? tr('{o:c} está bem alto agora. Os planetas não piscam como as estrelas e mudam de lugar, devagar, de uma noite para outra.', { c: estado.rotAstro }) : tr('Nenhum planeta brilhante está alto agora; tente "+1 h" no painel do céu.')), acao: () => {
        if (!precisaCeu()) return;
        const a = maisAlto(['lua', 'venus', 'jupiter', 'saturno', 'marte'].map((id) => PORID[id]), dirCorpo);
        estado.rotAstro = a;
        if (a) { estado.alvo = a; apontar(a); }
      } },
      { nome: 'Pelo telescópio', texto: () => (estado.rotAstro ? tr('{o:c} com {n} vezes de aumento. Use − e + nas bordas, ou a roda do mouse.', { c: estado.rotAstro, n: estado.rotAstro.id === 'lua' ? 40 : 150 }) : tr('Sem planeta alto agora: o telescópio fica para o próximo passo.')), acao: () => {
        if (!precisaCeu() || !estado.rotAstro) return;
        telescopioEm(estado.rotAstro, estado.rotAstro.id === 'lua' ? 40 : 150);
      } },
      { nome: 'O céu profundo', texto: () => (estado.rotProfundo ? tr('{c}: {tipo}. A olho nu seria uma mancha fraca ou nem apareceria; no telescópio, a forma surge.', { c: estado.rotProfundo.nome, tipo: tr(estado.rotProfundo.tipo) }) : tr('Nenhum dos objetos mais famosos está alto agora.')), acao: () => {
        if (!precisaCeu()) return;
        const famosos = [42, 31, 45, 13, 8, 7, 22, 44, 11, 20, 57, 27].map((n) => messier.find((m) => m.m === n)).filter(Boolean);
        const o = maisAlto(famosos, (m) => m.dir);
        estado.rotProfundo = o;
        if (o) telescopioEm(o, Math.min(Math.max(1200 / Math.max(o.tam || 10, 1), 4), 250)); // o objeto ocupa ~1/3 do campo
      } },
      { nome: 'E na cidade?', texto: 'Este é o mesmo céu com a poluição luminosa de uma cidade grande: o céu fica pardo, a Via Láctea some e só as estrelas mais brilhantes resistem. Por isso os observatórios ficam longe das cidades.', acao: () => {
        if (!precisaCeu()) return;
        if (estado.telescopio) alternarTelescopio();
        estado.bortle = 7; $('selPoluicao').value = '7';
      } },
      { nome: 'Fim', texto: 'De volta ao céu natural. Daqui você pode mudar a data e a hora no painel do céu, trocar de cidade ou usar o telescópio à vontade.', acao: () => { estado.bortle = 0; $('selPoluicao').value = '0'; } },
    ];
  } },
};
let roteiro = null;
function iniciarRoteiro(id) {
  const r = ROTEIROS[id];
  const passos = typeof r.passos === 'function' ? r.passos() : r.passos;
  if (!passos.length) return aviso(tr('Este roteiro ainda está carregando; tente de novo em alguns segundos.'));
  fecharBoasVindas();
  roteiro = { r, passos, i: -1 };
  document.body.classList.add('emRoteiro');
  $('roteiro').hidden = false;
  irPasso(0);
}
function irPasso(i) {
  if (!roteiro) return;
  if (i >= roteiro.passos.length) return sairRoteiro();
  roteiro.i = Math.max(0, i);
  const p = roteiro.passos[roteiro.i];
  try { p.acao(); } catch (e) { console.warn(e); }
  $('rotTitulo').textContent = tr(roteiro.r.titulo);
  $('rotPasso').textContent = tr('{i} de {n}', { i: roteiro.i + 1, n: roteiro.passos.length });
  $('rotNome').textContent = tr(p.nome);
  const pintar = () => { if (roteiro && roteiro.passos[roteiro.i] === p) $('rotTexto').textContent = typeof p.texto === 'function' ? p.texto() : tr(p.texto); };
  pintar();
  if (typeof p.texto === 'function') setTimeout(pintar, 600); // textos que dependem do lugar ou da data
  $('rotAnterior').disabled = roteiro.i === 0;
  $('rotProximo').textContent = tr(roteiro.i === roteiro.passos.length - 1 ? 'Terminar' : 'Próximo ▶');
}
function sairRoteiro() { roteiro = null; $('roteiro').hidden = true; document.body.classList.remove('emRoteiro'); }
$('rotProximo').onclick = () => irPasso(roteiro.i + 1);
$('rotAnterior').onclick = () => irPasso(roteiro.i - 1);
$('rotSair').onclick = sairRoteiro;
for (const b of document.querySelectorAll('[data-roteiro]')) b.onclick = () => iniciarRoteiro(b.dataset.roteiro);
// ------------------------------- calendário de eclipses (NASA, 1900–2100) -------------------------------
let eclipses = null, eclInicio = 0;
const TIPO_SOL = { T: 'total', A: 'anular', H: 'híbrido', P: 'parcial' };
const TIPO_LUA = { T: 'total', P: 'parcial', N: 'penumbral' };
const jdEclipse = (e) => Date.UTC(e.a, e.m - 1, e.d, e.td[0], e.td[1], e.td[2] - e.dt) / 86400000 + 2440587.5; // TD − ΔT = UTC
function perto(lat, lon) {
  if (!cidadesLista.length) return '';
  const d = new THREE.Vector3(Math.cos(lat * GRAU) * Math.cos(lon * GRAU), Math.sin(lat * GRAU), -Math.cos(lat * GRAU) * Math.sin(lon * GRAU));
  let melhor = null, ang = 0.1; // até ~600 km
  for (const c of cidadesLista) { const a = c.dir.angleTo(d); if (a < ang && (c.pop > 3e5 || a < 0.05)) { ang = a; melhor = c; } }
  return melhor ? tr('perto de {c}', { c: `${melhor.nome}${melhor.pais ? `, ${melhor.pais}` : ''}` }) : tr('no mar ou longe de cidades');
}
async function abrirEclipses() {
  if (!eclipses) {
    const j = await fetch('dados/eclipses.json').then((r) => r.json());
    eclipses = [...j.sol.map((e) => ({ ...e, solar: true })), ...j.lua.map((e) => ({ ...e, solar: false }))].map((e) => ({ ...e, jd: jdEclipse(e) })).sort((a, b) => a.jd - b.jd);
  }
  eclInicio = Math.max(0, eclipses.findIndex((e) => e.jd >= estado.jd - 1));
  listarEclipses();
  $('eclipses').hidden = false;
}
function listarEclipses() {
  const lista = $('eclLista');
  lista.textContent = '';
  for (const e of eclipses.slice(eclInicio, eclInicio + 12)) {
    const data = new Date(Date.UTC(e.a, e.m - 1, e.d)).toLocaleDateString(LOCALE, { timeZone: 'UTC' });
    const hora = new Date((e.jd - 2440587.5) * 86400000).toISOString().slice(11, 16);
    let txt;
    if (e.solar) {
      const tipo = tr(`Eclipse solar ${TIPO_SOL[e.tipo[0]] ?? 'parcial'}`);
      txt = `<b>${data}</b> · ${tipo}${e.dur ? tr(' · {m} min {s} s no máximo', { m: Math.floor(e.dur / 60), s: e.dur % 60 }) : ''} · ${tr(e.tipo[0] === 'P' ? 'visto melhor {lugar}, às {h} UTC' : 'máximo {lugar}, às {h} UTC', { lugar: perto(e.lat, e.lon), h: hora })}`;
    } else {
      const tipo = tr(`Eclipse lunar ${TIPO_LUA[e.tipo[0]] ?? 'parcial'}`);
      txt = `<b>${data}</b> · ${tipo}${e.durTot ? tr(' · {m} min de totalidade', { m: Math.round(e.durTot) }) : ''} · ${tr('máximo às {h} UTC, com a Lua no alto {lugar}', { h: hora, lugar: perto(e.lat, e.lon) })}`;
    }
    const div = document.createElement('div');
    div.className = 'eclItem';
    div.innerHTML = `<div class="eclTxt">${txt}</div>`;
    const b1 = document.createElement('button'); b1.textContent = tr('Ver do chão'); b1.onclick = () => verEclipse(e, 'chao');
    const b2 = document.createElement('button'); b2.textContent = tr('Ver do espaço'); b2.onclick = () => verEclipse(e, 'espaco');
    div.append(b1, b2);
    lista.append(div);
  }
}
// põe o observador em pé num ponto qualquer da Terra (latitude e longitude em graus), já no modo céu
function ficarEm(lat, lon) {
  const E = PORID.terra;
  if (estado.embarcado) desembarcar();
  if (estado.ceuModo) sairDoCeu();
  if (estado.ref !== E) teleportar(E);
  estado.piloto = null;
  const dl = new THREE.Vector3(Math.cos(lat * GRAU) * Math.cos(lon * GRAU), Math.sin(lat * GRAU), -Math.cos(lat * GRAU) * Math.sin(lon * GRAU));
  estado.ultimoLugar = { dir: dl, nome: '' };
  const d = dl.clone().applyQuaternion(E.qOri);
  estado.local.copy(d).multiplyScalar(raioSuperficie(E, d) + ALTURA_OLHO);
  medirProximo();
  olharCeu();
}
function verEclipse(e, modo) {
  $('eclipses').hidden = true;
  estado.eclipseAtual = e;
  sairRoteiro();
  const inicio = e.solar && e.dur ? e.jd - (e.dur / 2 + 90) / 86400 : e.jd; // eclipse central: começa 1,5 min antes da totalidade
  estado.jd = inicio;
  atualizarPosicoes(estado.jd);
  if (modo === 'chao') {
    ficarEm(e.lat, e.lon);
    estado.jd = inicio; estado.ritmo = 1; estado.orbitasMovem = true; $('selRitmo').value = '1';
    estado.constelacoes = false; estado.linhasConst = false; pintarCeuBotoes();
    setTimeout(() => apontar(e.solar ? PORID.sol : PORID.lua), 200);
    aviso(tr(e.solar ? (e.dur ? 'A totalidade começa em cerca de 1 minuto e meio. Em tempo real.' : 'Eclipse no máximo. Use "+1 h" ou acelere o tempo para ver o avanço.') : 'Eclipse lunar no máximo. Acelere o tempo para ver a sombra da Terra passar.'));
  } else {
    // do espaço: a 40 mil km da Terra (solar, do lado do Sol) ou a 30 mil km da Lua (lunar)
    const alvo = e.solar ? PORID.terra : PORID.lua;
    teleportar(alvo);
    estado.jd = inicio; estado.ritmo = e.solar ? 60 : 300; estado.orbitasMovem = true;
    $('selRitmo').value = String(estado.ritmo);
    const paraSol = PORID.sol.abs.clone().sub(alvo.abs).normalize();
    const lado = new THREE.Vector3(0, 1, 0).cross(paraSol).normalize();
    const dir = paraSol.addScaledVector(lado, 0.35).normalize(); // do lado do Sol (no lunar, é também o lado da Terra: a face que estaria cheia)
    estado.local.copy(dir).multiplyScalar(e.solar ? 40000 : 30000);
    quatOlhando(dir.clone().negate(), estado.q);
    aviso(tr(e.solar ? 'A sombra da Lua sobre a Terra, 1 minuto por segundo.' : 'A Lua entrando na sombra da Terra, 5 minutos por segundo.'));
  }
}
// Máximo do eclipse visto daqui: procura, em até 4 horas antes e depois, quando o Sol (ou a Lua) fica mais tapado neste lugar
function maximoDaqui() {
  if (!estado.ceuModo) return aviso(tr('Entre no modo céu num lugar da Terra (Z) para procurar o eclipse visto dali.'));
  const E = PORID.terra, e = estado.eclipseAtual;
  const lunar = e ? !e.solar : false;
  const dl = estado.local.clone().normalize().applyQuaternion(E.qOri.clone().invert()), alt = estado.local.length();
  const base = e && Math.abs(e.jd - estado.jd) < 0.5 ? e.jd : estado.jd;
  const P = new THREE.Vector3(), up = new THREE.Vector3(), dirAstro = new THREE.Vector3();
  const avaliar = (jd) => {
    atualizarPosicoes(jd);
    const j0 = estado.jd; estado.jd = jd; atualizarSolAparente(); estado.jd = j0;
    up.copy(dl).applyQuaternion(E.qOri);
    P.copy(up).multiplyScalar(alt).add(E.abs);
    const astro = lunar ? PORID.lua : PORID.sol;
    const altura = dirAstro.copy(astro.abs).sub(P).normalize().dot(up);
    const v = lunar ? luzEclipseJS(PORID.lua.abs, PORID.terra, PORID.terra.raio * 1.02) : luzEclipseJS(pontoGeocentrico(P.clone()), PORID.lua, PORID.lua.raio);
    return altura > -0.005 ? v : 1;
  };
  let melhor = 1, jdM = base;
  for (let jd = base - 4 / 24; jd <= base + 4 / 24; jd += 2 / 1440) { const v = avaliar(jd); if (v < melhor) { melhor = v; jdM = jd; } }
  let total = 0;
  if (melhor < 1) {
    const ini = jdM;
    for (let jd = ini - 5 / 1440; jd <= ini + 5 / 1440; jd += 5 / 86400) { const v = avaliar(jd); if (v < melhor || (v === melhor && v === 0)) { if (v < melhor) jdM = jd; melhor = v; } if (v === 0) total += 5; }
  }
  const voltar = (jd) => { atualizarPosicoes(jd); atualizarPosicoes(jd); estado.local.copy(dl).applyQuaternion(E.qOri).multiplyScalar(alt); };
  if (melhor >= 0.999) {
    voltar(estado.jd);
    return aviso(tr(lunar ? 'Daqui, a Lua fica abaixo do horizonte durante este eclipse.' : 'Daqui, este eclipse não é visível: a sombra da Lua passa longe ou o Sol está abaixo do horizonte.'));
  }
  estado.jd = jdM - (total ? (total / 2 + 60) / 86400 : 0);
  voltar(estado.jd);
  estado.ritmo = 1; estado.orbitasMovem = true; $('selRitmo').value = '1';
  const t = new Date(horaLocalAgora().getTime() + (total ? (total / 2 + 60) * 1000 : 0));
  const hora = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  setTimeout(() => apontar(lunar ? PORID.lua : PORID.sol), 100);
  if (lunar) aviso(tr('Daqui, o máximo do eclipse é às {h} (hora local), com a Lua acima do horizonte.', { h: hora }));
  else if (total) aviso(tr('Daqui o eclipse é total: cerca de {m} min {s} s de totalidade, a partir de 1 minuto depois de agora. Máximo às {h}.', { m: Math.floor(total / 60), s: total % 60, h: hora }));
  else aviso(tr('Daqui, o máximo é às {h} (hora local), com {p}% do disco do Sol coberto.', { h: hora, p: Math.round((1 - melhor) * 100) }));
}
$('btEclipseAqui').onclick = maximoDaqui;
$('btEclipses').onclick = abrirEclipses;
$('btEclipses2').onclick = abrirEclipses;
$('eclFechar').onclick = () => ($('eclipses').hidden = true);
$('eclAntes').onclick = () => { eclInicio = Math.max(0, eclInicio - 12); listarEclipses(); };
$('eclDepois').onclick = () => { eclInicio = Math.min(eclipses.length - 12, eclInicio + 12); listarEclipses(); };
$('eclHoje').onclick = () => { eclInicio = Math.max(0, eclipses.findIndex((e) => e.jd >= jdAgora() - 1)); listarEclipses(); };
if (lerGuardado('viagemVisitou') === null && !veioDeRecarga) abrirBoasVindas();
// teste: latitude e longitude do ponto abaixo do Sol num corpo (graus)
function subsolar(id) {
  const c = PORID[id];
  const d = PORID.sol.abs.clone().sub(c.abs).normalize().applyQuaternion(c.qOri.clone().invert());
  return [Math.asin(d.y) / GRAU, Math.atan2(-d.z, d.x) / GRAU];
}
// teste: câmera a alt km sobre (lat, lon) de um corpo, olhando para o norte e inclinada para baixo (graus)
function sobrevoar(id, lat, lon, alt, inclinacao = 20) {
  const c = PORID[id];
  teleportar(c);
  const dl = new THREE.Vector3(Math.cos(lat * GRAU) * Math.cos(lon * GRAU), Math.sin(lat * GRAU), -Math.cos(lat * GRAU) * Math.sin(lon * GRAU));
  const d = dl.applyQuaternion(c.qOri);
  estado.local.copy(d).multiplyScalar(c.raio + alt);
  const norte = new THREE.Vector3(0, 1, 0).applyQuaternion(c.qOri);
  const frente = norte.sub(d.clone().multiplyScalar(norte.dot(d))).normalize();
  frente.multiplyScalar(Math.cos(inclinacao * GRAU)).addScaledVector(d, -Math.sin(inclinacao * GRAU));
  quatOlhando(frente, estado.q, d);
}
window.__sim = { mostrarFicha, teleportar, sobrevoar, raioSuperficie, pousar, subsolar, exo, vagasExo, zonaHab, planetaPorNome, pequenos, maximoDaqui, modelos, testeMeteoros: (n) => { const up = estado.local.clone().normalize(); const c = CHUVAS.find((x) => x.nome === "Oriônidas"); for (let i = 0; i < n; i++) { novoMeteoro(c.dir, c.v, up); if (meteoros.length) meteoros[meteoros.length - 1].t = 0.45; } }, quadros: (n = 1) => { for (let i = 0; i < n; i++) { tAnterior = performance.now() - 16; passo(); } }, luzEclipseJS, coroa, verEclipse, ficarEm, abrirEclipses, predios, vr, alvoNaDirecao, textoPainelVR, satelites, embarcar: (o) => embarcar(o), estado, PORID, camAbs, cat, estrelaObj, vagas, THREE, terra, buscar, indiceBusca, missoes, atualizarPosicoes };
