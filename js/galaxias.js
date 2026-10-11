// Via Láctea (modelo em partículas a partir de medidas publicadas), outras galáxias (planos com textura
// procedural na orientação real), galáxias distantes ilustrativas e a borda do universo observável.
import * as THREE from '../vendor/three.module.js';
import { PC, AL, GRAU } from './unidades.js';
import { radecParaCena, PORID, CORPOS } from './corpos.js';

// Sistema galáctico na cena: X → centro galáctico, Z → polo norte galáctico, Y completa (sentido da rotação)
const GX = radecParaCena(266.405, -28.936, 1);
let GZ = radecParaCena(192.859, 27.128, 1);
const GY = new THREE.Vector3().crossVectors(GZ, GX).normalize();
GZ = new THREE.Vector3().crossVectors(GX, GY);
export const POLO_GALACTICO = GZ.clone();
const R_SOL = 8178, Z_SOL = 20; // pc

let semente = 1;
const acaso = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(acaso() + 1e-12)) * Math.cos(2 * Math.PI * acaso());

// ------------------------------- Via Láctea -------------------------------
// Coordenadas galactocêntricas (pc) → cena, em parsecs relativos ao Sol
function paraCena(x, y, z, arr, i) {
  const hx = x + R_SOL, hz = z - Z_SOL; // heliocêntrico: o centro fica em +X
  arr[i] = GX.x * hx + GY.x * y + GZ.x * hz;
  arr[i + 1] = GX.y * hx + GY.y * y + GZ.y * hz;
  arr[i + 2] = GX.z * hx + GY.z * y + GZ.z * hz;
}

// Braços: espirais logarítmicas (passo ~12°) com raio no azimute do Sol: Escudo-Centauro, Sagitário-Carina, Perseu, Externo
const K = Math.tan(12 * GRAU);
const BRACOS = [4.7e3, 6.6e3, 9.2e3, 12.9e3].map((r) => ({ r0: r, fase: 0 }));
const raioBraco = (b, phi) => b.r0 * Math.exp(K * (phi - Math.PI));

// mult: quantas vezes mais partículas; fTam: fator de tamanho (o brilho total se conserva)
function gerarViaLactea(mult = 1, fTam = 1) {
  semente = 1;
  const itens = [];
  const add = (x, y, z, cor, tam, brilho, poeira = false) => itens.push({ x, y, z, cor, tam: tam * fTam, brilho: brilho / (mult * fTam * fTam), poeira });
  // Bojo (esferoide) e barra (inclinada ~27° em relação à linha Sol–centro, lado próximo em longitude positiva)
  for (let i = 0; i < 5000 * mult; i++) {
    const r = Math.abs(gauss()) * 700, th = acaso() * Math.PI * 2, ph = Math.acos(2 * acaso() - 1);
    add(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph) * 0.6, [1.0, 0.82, 0.6], 260, 0.09);
  }
  const ab = (180 - 27) * GRAU;
  for (let i = 0; i < 4000 * mult; i++) {
    const u = gauss() * 1700, v = gauss() * 450, w = gauss() * 250;
    add(u * Math.cos(ab) - v * Math.sin(ab), u * Math.sin(ab) + v * Math.cos(ab), w, [1.0, 0.85, 0.65], 240, 0.07);
  }
  // Disco de estrelas velhas: exponencial, escala 3 kpc
  for (let i = 0; i < 16000 * mult; i++) {
    const r = -3000 * Math.log(1 - acaso() * 0.995) + 1500, th = acaso() * Math.PI * 2;
    if (r > 17000) continue;
    add(r * Math.cos(th), r * Math.sin(th), gauss() * 180, [1.0, 0.9, 0.78], 320, 0.022);
  }
  // Braços: estrelas jovens azuladas, nuvens rosadas de hidrogênio e faixas de poeira na borda interna
  for (const b of BRACOS) {
    for (let i = 0; i < 6000 * mult; i++) {
      const phi = Math.PI * (0.15 + acaso() * 2.6);
      const r = raioBraco(b, phi) + gauss() * 380;
      if (r < 3000 || r > 17000) continue;
      add(r * Math.cos(phi), r * Math.sin(phi), gauss() * 110, [0.78, 0.86, 1.0], 200, 0.05);
      if (acaso() < 0.12) add(r * Math.cos(phi) + gauss() * 60, r * Math.sin(phi) + gauss() * 60, gauss() * 40, [1.0, 0.45, 0.6], 60, 0.25);
      if (acaso() < 0.5) {
        const rp = r - 260;
        add(rp * Math.cos(phi), rp * Math.sin(phi), gauss() * 60, null, 230, 0.07, true);
      }
    }
  }
  // Braço de Órion (esporão onde fica o Sol)
  for (let i = 0; i < 900 * mult; i++) {
    const phi = Math.PI + (acaso() - 0.5) * 0.7, r = 8300 + (phi - Math.PI) * 900 + gauss() * 250;
    add(r * Math.cos(phi), r * Math.sin(phi), gauss() * 90, [0.82, 0.88, 1.0], 160, 0.035);
  }
  // Aglomerados globulares no halo
  for (let i = 0; i < 160; i++) {
    const r = 1500 + Math.abs(gauss()) * 12000, th = acaso() * Math.PI * 2, ph = Math.acos(2 * acaso() - 1);
    add(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), [1.0, 0.9, 0.7], 40, 0.6);
  }
  return itens;
}

function nuvem(itens, S, poeira) {
  const n = itens.length;
  const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), tam = new Float32Array(n), bri = new Float32Array(n);
  itens.forEach((it, k) => {
    paraCena(it.x, it.y, it.z, pos, k * 3);
    if (it.cor) cor.set(it.cor, k * 3);
    tam[k] = it.tam;
    bri[k] = it.brilho;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  geo.setAttribute('tam', new THREE.BufferAttribute(tam, 1));
  geo.setAttribute('brilho', new THREE.BufferAttribute(bri, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: S.NUVEM_V, fragmentShader: poeira ? S.POEIRA_F : S.NUVEM_F,
    uniforms: {
      camAlto: { value: new THREE.Vector3() }, camBaixo: { value: new THREE.Vector3() },
      PCKM: { value: PC }, R0: { value: 1e8 }, pxPorRad: { value: 1000 }, escalaPx: { value: 1 }, apagar: { value: 0 },
      ganho: { value: poeira ? 1 : 3.2 }, distMin: { value: 0 }, beta: { value: new THREE.Vector3() },
    },
    transparent: true, depthWrite: false,
    blending: poeira ? THREE.CustomBlending : THREE.AdditiveBlending,
  });
  if (poeira) {
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.ZeroFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  }
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = poeira ? 1.5 : 1;
  return pts;
}

// Galáxias distantes ilustrativas: aglomerados espalhados até a borda do universo observável
function gerarCampoDistante() {
  const itens = [];
  for (let c = 0; c < 2600; c++) {
    const r = 3e8 + Math.cbrt(acaso()) * 1.4e10; // pc (de ~1 bilhão a ~46 bilhões de anos-luz, além do catálogo 2MRS)
    const th = acaso() * Math.PI * 2, ph = Math.acos(2 * acaso() - 1);
    const cx = r * Math.sin(ph) * Math.cos(th), cy = r * Math.sin(ph) * Math.sin(th), cz = r * Math.cos(ph);
    const n = 3 + Math.floor(acaso() * 14);
    for (let i = 0; i < n; i++) {
      const quente = acaso() < 0.4;
      itens.push({ x: cx + gauss() * 1.5e6, y: cy + gauss() * 1.5e6, z: cz + gauss() * 1.5e6,
        cor: quente ? [1.0, 0.85, 0.7] : [0.8, 0.87, 1.0], tam: 3e4, brilho: 0.5 + acaso() });
    }
  }
  const n = itens.length;
  const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), tam = new Float32Array(n), bri = new Float32Array(n);
  itens.forEach((it, k) => { pos.set([it.x, it.y, it.z], k * 3); cor.set(it.cor, k * 3); tam[k] = it.tam; bri[k] = it.brilho; });
  return { pos, cor, tam, bri };
}

// Catálogo 2MRS (Huchra et al. 2012): ~43 mil galáxias reais, distância pela lei de Hubble (H0 = 70).
// dados/galaxias_2mrs.bin: x, y, z (pc, cena), magnitude absoluta K, tipo morfológico, raio (pc)
export async function carregar2MRS(base) {
  const d = new Float32Array(await (await fetch('dados/galaxias_2mrs.bin')).arrayBuffer());
  const n = d.length / 6;
  const pos = new Float32Array(n * 3), cor = new Float32Array(n * 3), tam = new Float32Array(n), bri = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * 6;
    pos[i * 3] = d[k]; pos[i * 3 + 1] = d[k + 1]; pos[i * 3 + 2] = d[k + 2];
    const eliptica = d[k + 4] < 0;
    cor.set(eliptica ? [1.0, 0.82, 0.62] : [0.8, 0.86, 1.0], i * 3);
    tam[i] = d[k + 5];
    bri[i] = Math.min(Math.max(10 ** (-0.4 * (d[k + 3] + 23.5)), 0.25), 2.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('cor', new THREE.BufferAttribute(cor, 3));
  geo.setAttribute('tam', new THREE.BufferAttribute(tam, 1));
  geo.setAttribute('brilho', new THREE.BufferAttribute(bri, 1));
  const pts = new THREE.Points(geo, base.material.clone());
  pts.material.uniforms.distMin.value = 1;
  pts.material.uniforms.ganho.value = 1.2;
  pts.frustumCulled = false;
  return pts;
}

// ------------------------------- texturas de galáxias -------------------------------
function texturaGalaxia(forma, cor, s0) {
  semente = s0;
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const c = new THREE.Color(cor);
  const rgb = (k, a) => `rgba(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)},${a})`;
  const bolha = (x, y, r, cor) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, cor);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  g.globalCompositeOperation = 'lighter';
  const m = N / 2;
  if (forma === 'eliptica') {
    for (let i = 0; i < 6; i++) bolha(m, m, m * (0.15 + i * 0.17), rgb(1, 0.22 - i * 0.03));
  } else if (forma === 'irregular') {
    for (let i = 0; i < 260; i++) {
      const r = Math.abs(gauss()) * m * 0.35, a = acaso() * Math.PI * 2;
      bolha(m + Math.cos(a) * r * 1.3, m + Math.sin(a) * r, 8 + acaso() * 40, acaso() < 0.1 ? 'rgba(255,120,170,0.35)' : rgb(1, 0.12));
    }
  } else {
    const barra = forma === 'barrada';
    bolha(m, m, m * 0.95, rgb(0.85, 0.16)); // disco difuso
    bolha(m, m, m * 0.6, rgb(0.95, 0.14));
    bolha(m, m, m * 0.34, 'rgba(255,214,160,0.55)'); // bojo de estrelas velhas, amarelado
    bolha(m, m, m * 0.13, 'rgba(255,236,205,0.95)');
    if (barra) for (let i = -40; i <= 40; i++) bolha(m + i * 2.6, m, 26, 'rgba(255,225,190,0.07)');
    const k = Math.tan(14 * GRAU), r0 = barra ? m * 0.32 : m * 0.12;
    for (let braco = 0; braco < 2; braco++) {
      for (let i = 0; i < 1400; i++) {
        const t = acaso() * 2.8 * Math.PI;
        const r = r0 * Math.exp(k * t) * (1 + gauss() * 0.06);
        if (r > m * 0.98) continue;
        const a = t + braco * Math.PI;
        const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
        const rosa = acaso() < 0.06;
        bolha(x + gauss() * 9, y + gauss() * 9, rosa ? 4 : 7 + acaso() * 14, rosa ? 'rgba(255,110,160,0.55)' : 'rgba(205,220,255,0.13)');
      }
    }
    // poeira: apaga um pouco na borda interna dos braços
    g.globalCompositeOperation = 'destination-out';
    for (let braco = 0; braco < 2; braco++) {
      for (let i = 0; i < 500; i++) {
        const t = acaso() * 2.8 * Math.PI, r = r0 * Math.exp(k * t) * 0.93;
        if (r > m * 0.95) continue;
        const a = t + braco * Math.PI;
        bolha(m + Math.cos(a) * r, m + Math.sin(a) * r, 12, 'rgba(0,0,0,0.06)');
      }
    }
  }
  // borda suave
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createRadialGradient(m, m, m * 0.6, m, m, m);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Normal do disco a partir do ângulo de posição e da inclinação (o lado mais próximo é desconhecido: escolhe um)
function orientarDisco(c) {
  const d = c.abs.clone().normalize();
  const norteCeu = radecParaCena(0, 90, 1);
  const leste = new THREE.Vector3().crossVectors(norteCeu, d).normalize();
  const norte = new THREE.Vector3().crossVectors(d, leste);
  const maior = norte.clone().multiplyScalar(Math.cos(c.pa * GRAU)).addScaledVector(leste, Math.sin(c.pa * GRAU));
  const menor = new THREE.Vector3().crossVectors(d, maior);
  const noPlano = menor.multiplyScalar(Math.cos(c.inc * GRAU)).addScaledVector(d, Math.sin(c.inc * GRAU));
  c.normal = new THREE.Vector3().crossVectors(maior, noPlano).normalize();
  c.eixoMaior = maior;
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(maior, noPlano, c.normal));
}

// ------------------------------- céu visto do Sistema Solar -------------------------------
// De dentro da galáxia, poucas dezenas de milhares de nuvens viram borrões. Para o céu visto daqui,
// o mesmo modelo é refeito com 8× mais nuvens menores e projetado num mapa (coordenadas galácticas),
// com a poeira absorvendo a luz de quem está atrás dela.
function mapaDoCeu() {
  const W = 2048, H = 1024;
  const luz = new Float32Array(W * H * 3), tau = new Float32Array(W * H);
  const itens = gerarViaLactea(8, 0.35);
  for (const it of itens) {
    const hx = it.x + R_SOL, hy = it.y, hz = it.z - Z_SOL;
    const d = Math.hypot(hx, hy, hz);
    if (d < 120) continue;
    const perto = Math.min(Math.max((d - it.tam * 1.5) / (it.tam * 6.5), 0), 1);
    const peso = it.brilho * perto * perto * (3 - 2 * perto);
    if (peso <= 0) continue;
    const l = Math.atan2(hy, hx), b = Math.asin(hz / d);
    const u = (0.5 - l / (2 * Math.PI)) * W, v = (0.5 - b / Math.PI) * H;
    const sig = (0.177 * it.tam) / d; // raio angular (rad) equivalente ao do shader
    const sx = Math.max(sig / ((2 * Math.PI) / W) / Math.max(Math.cos(b), 0.05), 0.6), sy = Math.max(sig / (Math.PI / H), 0.6);
    const area = sx * sy;
    const x0 = Math.floor(u - 3 * sx), x1 = Math.ceil(u + 3 * sx), y0 = Math.max(Math.floor(v - 3 * sy), 0), y1 = Math.min(Math.ceil(v + 3 * sy), H - 1);
    for (let y = y0; y <= y1; y++) {
      const gy = Math.exp(-((y - v) ** 2) / (2 * sy * sy));
      for (let x = x0; x <= x1; x++) {
        const g = gy * Math.exp(-((x - u) ** 2) / (2 * sx * sx)) * peso * (sig * 1e3) ** 2 / area;
        const k = y * W + ((x % W) + W) % W;
        if (it.poeira) tau[k] += g * 1.1;
        else { luz[k * 3] += g * it.cor[0]; luz[k * 3 + 1] += g * it.cor[1]; luz[k * 3 + 2] += g * it.cor[2]; }
      }
    }
  }
  // exposição automática pelo brilho típico da faixa, curva suave e absorção da poeira
  const amostra = [];
  for (let k = 0; k < W * H; k += 37) amostra.push(luz[k * 3 + 1]);
  amostra.sort((a, b) => a - b);
  const ref = amostra[Math.floor(amostra.length * 0.997)] || 1;
  const img = new ImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const atenua = Math.exp(-Math.min(tau[k], 1.1)); // a poeira escurece, mas não apaga de todo
    for (let c = 0; c < 3; c++) {
      const e = (luz[k * 3 + c] / ref) * atenua;
      img.data[k * 4 + c] = Math.round(255 * (Math.log1p(e * 6) / Math.log1p(6)) ** 1.1 * 0.92); // curva logarítmica: o bojo não estoura
    }
    img.data[k * 4 + 3] = 255;
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ------------------------------- montagem -------------------------------
export function criarGalaxias(cena, S) {
  const via = gerarViaLactea();
  const brilho = nuvem(via.filter((i) => !i.poeira), S, false);
  const poeira = nuvem(via.filter((i) => i.poeira), S, true);
  const campoDados = gerarCampoDistante();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(campoDados.pos, 3));
  geo.setAttribute('cor', new THREE.BufferAttribute(campoDados.cor, 3));
  geo.setAttribute('tam', new THREE.BufferAttribute(campoDados.tam, 1));
  geo.setAttribute('brilho', new THREE.BufferAttribute(campoDados.bri, 1));
  const campo = new THREE.Points(geo, brilho.material.clone());
  campo.material.uniforms.distMin.value = 1; // usa o brilho "de mapa", que não some com a distância
  campo.frustumCulled = false;
  cena.add(brilho, poeira, campo);
  PORID.vialactea.normal = GZ.clone();
  PORID.vialactea.eixoMaior = GX.clone();

  // Planos das galáxias com forma definida
  const planos = [];
  CORPOS.filter((c) => c.tipo === 'galaxia' && c.forma && c.forma !== 'modelo').forEach((c, k) => {
    const mat = new THREE.MeshBasicMaterial({
      map: texturaGalaxia(c.forma, c.cor, 101 + k * 7), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: new THREE.Color(0.9, 0.9, 0.9),
    });
    const malha = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    malha.renderOrder = 1;
    const sempreDeFrente = c.forma === 'eliptica' || c.forma === 'irregular';
    if (c.pa !== undefined) malha.userData.quat = orientarDisco(c);
    malha.userData.sempreDeFrente = sempreDeFrente && c.pa === undefined;
    c.plano = malha;
    cena.add(malha);
    planos.push(c);
  });

  // Borda do universo observável (a partir da Terra): casca com o padrão da radiação cósmica de fundo
  const borda = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), new THREE.ShaderMaterial({
    vertexShader: S.SIMPLES_V, fragmentShader: S.CMB_F, uniforms: { forca: { value: 0 } },
    blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  borda.renderOrder = 0;
  cena.add(borda);

  // Céu da Via Láctea visto daqui (calculado logo após a abertura, para não atrasar o primeiro quadro)
  const ceuMat = new THREE.ShaderMaterial({
    vertexShader: S.SIMPLES_V, fragmentShader: S.CEU_VIA_F,
    uniforms: { mapa: { value: null }, forca: { value: 0 }, GX: { value: GX }, GY: { value: GY }, GZ: { value: GZ }, beta: { value: new THREE.Vector3() } },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.BackSide,
  });
  const ceuVia = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), ceuMat);
  ceuVia.renderOrder = 0;
  ceuVia.visible = false;
  cena.add(ceuVia);
  setTimeout(() => { ceuMat.uniforms.mapa.value = mapaDoCeu(); }, 300);

  return { brilho, poeira, campo, planos, borda, ceuVia };
}
