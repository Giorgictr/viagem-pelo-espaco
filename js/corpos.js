// Catálogo de corpos e efemérides. Coordenadas da cena: eclíptica J2000 em km,
// com o eixo Y da cena = norte da eclíptica (cena x = x_ecl, y = z_ecl, z = -y_ecl).
import * as THREE from '../vendor/three.module.js';
import * as Astro from '../vendor/astronomy.js';
import { UA, AL, PC, GRAU, OBLIQUIDADE } from './unidades.js';
import { t as tr } from './idioma.js';
import { integrar, PLANETAS, poloEcliptica } from './orbita.js';

// Elementos orbitais aproximados do JPL (Standish), válidos 1800–2050:
// a [UA], e, I [°], L [°], ϖ [°], Ω [°] e suas taxas por século juliano.
const KEPLER = {
  mercurio: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255,
    0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  terra: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  marte: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturno: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  urano: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  netuno: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  plutao: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684,
    -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  // Ceres e Vesta: elementos osculadores do JPL (SBDB, época 2461200,5), sem as perturbações seculares (erro de
  // poucos décimos de grau por década); L0 levado para J2000 pelo movimento médio
  ceres: [2.765552595, 0.0796922951, 10.5880278, 158.745564, 153.542841, 80.2486268, 0, 0, 0, 7827.47006, 0, 0],
  vesta: [2.361365965, 0.0902037438, 7.14392555, 233.749009, 255.169941, 103.701293, 0, 0, 0, 9920.860649, 0, 0],
};
const SO_KEPLER = ['ceres', 'vesta']; // posição pelos elementos acima (os demais, pelo VSOP87 do astronomy-engine)

const norm360 = (x) => ((x % 360) + 360) % 360;

// Posição heliocêntrica na eclíptica (km), já no sistema da cena
function kepler(el, T, out) {
  const a = (el[0] + el[6] * T) * UA;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * GRAU;
  const L = el[3] + el[9] * T;
  const varpi = el[4] + el[10] * T;
  const node = el[5] + el[11] * T;
  const w = (varpi - node) * GRAU;
  const O = node * GRAU;
  let M = norm360(L - varpi);
  if (M > 180) M -= 360;
  M *= GRAU;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = sw * sI * xp + cw * sI * yp;
  return out.set(x, z, -y);
}

// Lua: teoria ELP-2000/82 truncada (Meeus, "Astronomical Algorithms", cap. 47) — erro de poucos
// centésimos de grau. Devolve a posição geocêntrica na eclíptica J2000 (km), já no sistema da cena.
// Termos: [D, M, M', F, Σl (1e-6 grau), Σr (m)] e [D, M, M', F, Σb (1e-6 grau)]
const LUA_LR = [
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],[0,0,2,0,213618,-569925],
  [0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],[2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],
  [2,0,1,0,53322,-170733],[2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],[0,0,1,-2,10980,79661],
  [4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],[4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],
  [2,1,0,0,-6766,30824],[1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],[0,1,-2,0,-2689,-7003],
  [2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],[1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],
  [0,1,2,0,-2120,5751],[0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],[3,0,-1,0,-892,3258],
  [2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],[0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],
  [2,1,-2,0,691,0],[2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],[0,0,2,-2,-381,-4421],
  [1,1,1,0,351,0],[3,0,-2,0,-340,0],[4,0,-3,0,330,0],[2,-1,2,0,327,0],
  [0,2,1,0,-323,1165],[1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752],
];
const LUA_B = [
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],
  [2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],
  [2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],
  [2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
  [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],[0,1,1,-1,-1410],
  [0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],[4,0,0,-1,1021],[4,0,-1,1,833],
];
function lua(d, out) {
  const T = d / 36525, r = GRAU;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [a, b, c, f, l, rr] of LUA_LR) {
    const arg = (a * D + b * M + c * Mp + f * F) * r, e = Math.abs(b) === 1 ? E : Math.abs(b) === 2 ? E * E : 1;
    sl += l * e * Math.sin(arg);
    sr += rr * e * Math.cos(arg);
  }
  for (const [a, b, c, f, l] of LUA_B) {
    const e = Math.abs(b) === 1 ? E : Math.abs(b) === 2 ? E * E : 1;
    sb += l * e * Math.sin((a * D + b * M + c * Mp + f * F) * r);
  }
  sl += 3958 * Math.sin(A1 * r) + 1962 * Math.sin((Lp - F) * r) + 318 * Math.sin(A2 * r);
  sb += -2235 * Math.sin(Lp * r) + 382 * Math.sin(A3 * r) + 175 * Math.sin((A1 - F) * r) + 175 * Math.sin((A1 + F) * r)
    + 127 * Math.sin((Lp - Mp) * r) - 115 * Math.sin((Lp + Mp) * r);
  // longitude do equinócio da data → J2000 (precessão geral em longitude)
  const lam = (Lp + sl / 1e6 - (5029.0966 * T + 1.11113 * T * T) / 3600) * r;
  const bet = (sb / 1e6) * r, dist = 385000.56 + sr / 1000;
  const x = dist * Math.cos(bet) * Math.cos(lam), y = dist * Math.cos(bet) * Math.sin(lam), z = dist * Math.sin(bet);
  return out.set(x, z, -y);
}

// Equatorial (RA/Dec em graus, distância em km) → cena
export function radecParaCena(raDeg, decDeg, dist, out = new THREE.Vector3()) {
  const ra = raDeg * GRAU, dec = decDeg * GRAU;
  return equatorialParaCena(dist * Math.cos(dec) * Math.cos(ra), dist * Math.cos(dec) * Math.sin(ra), dist * Math.sin(dec), out);
}
export function equatorialParaCena(x, y, z, out = new THREE.Vector3()) {
  const ce = Math.cos(OBLIQUIDADE), se = Math.sin(OBLIQUIDADE);
  const ye = y * ce + z * se;
  const ze = -y * se + z * ce;
  return out.set(x, ze, -ye);
}

// tipo: estrela | planeta | anao | lua | galaxia | marco
// soi: raio da esfera de influência (km) — dentro dela, a câmera acompanha o corpo
// polo: [ascensão reta, declinação] do polo norte (IAU, graus); W: [meridiano em J2000, graus por dia]
// relevo: mapa de altitude em tons de cinza, [mínimo, máximo] em km
// atm: [r, g, b, espessura relativa ao raio]
export const CORPOS = [
  { id: 'sol', nome: 'Sol', tipo: 'estrela', raio: 695700, cor: 0xfff1d8, textura: '2k_sun.jpg', lum: 1, soi: 1.5 * AL, polo: [286.13, 63.87], W: [84.176, 14.1844] },
  { id: 'mercurio', nome: 'Mercúrio', tipo: 'planeta', pai: 'sol', raio: 2439.7, cor: 0xa9a29a, textura: '2k_mercury.jpg', textura4k: '4k_mercury.jpg', soi: 1.12e5, polo: [281.0103, 61.4155], W: [329.5469, 6.1385025], relevo: ['relevo/mercurio_2048.png', -5.36, 4.37], rochoso: true },
  { id: 'venus', nome: 'Vênus', tipo: 'planeta', pai: 'sol', raio: 6051.8, cor: 0xe8cf9a, textura: '2k_venus_atmosphere.jpg', textura4k: '4k_venus_atmosphere.jpg', soi: 6.16e5, polo: [272.76, 67.16], W: [160.2, -1.4813688], atm: [1.0, 0.85, 0.55, 0.03],
    // abaixo das nuvens (base ~48 km, topo ~70 km), o chão: mapa de radar da Magellan (cores ilustrativas), num ar amarelado
    nuvensAlt: [48, 70], texturaChao: '2k_venus_surface.jpg', veu: { km: 20, cor: [0.93, 0.68, 0.36], luz: [1.0, 0.8, 0.52] } },
  { id: 'terra', nome: 'Terra', tipo: 'planeta', pai: 'sol', raio: 6371, cor: 0x5d8fd6, textura: '2k_earth_daymap.jpg', noite: '2k_earth_nightmap.jpg', nuvens: '2k_earth_clouds.jpg', soi: 9.25e5, polo: [0, 90], poloT: [-0.641, -0.557], W: [190.147, 360.9856235], atm: [0.32, 0.58, 1.0, 0.025] },
  { id: 'marte', nome: 'Marte', tipo: 'planeta', pai: 'sol', raio: 3389.5, cor: 0xd0704a, textura: '2k_mars.jpg', textura4k: '4k_mars.jpg', soi: 5.77e5, polo: [317.269, 54.432], W: [176.63, 350.89198226], relevo: ['relevo/marte_mola_4096.jpg', -8.2, 21.24], atm: [0.95, 0.6, 0.42, 0.012], rochoso: true },
  { id: 'jupiter', nome: 'Júpiter', tipo: 'planeta', pai: 'sol', raio: 69911, cor: 0xd9b58c, textura: '2k_jupiter.jpg', textura4k: '4k_jupiter.jpg', soi: 4.82e7, polo: [268.057, 64.495], W: [284.95, 870.536], atm: [0.85, 0.8, 0.7, 0.012] },
  { id: 'saturno', nome: 'Saturno', tipo: 'planeta', pai: 'sol', raio: 58232, cor: 0xe3cf9e, textura: '2k_saturn.jpg', textura4k: '4k_saturn.jpg', soi: 5.48e7, polo: [40.589, 83.537], W: [38.9, 810.7939024], aneis: [74500, 140220], atm: [0.9, 0.82, 0.6, 0.012] },
  { id: 'urano', nome: 'Urano', tipo: 'planeta', pai: 'sol', raio: 25362, cor: 0x9fd8e0, textura: '2k_uranus.jpg', soi: 5.18e7, polo: [257.311, -15.175], W: [203.81, -501.1600928], atm: [0.6, 0.85, 0.95, 0.02] },
  { id: 'netuno', nome: 'Netuno', tipo: 'planeta', pai: 'sol', raio: 24622, cor: 0x5a7fe0, textura: '2k_neptune.jpg', soi: 8.66e7, polo: [299.36, 43.46], W: [253.18, 536.3128492], atm: [0.45, 0.6, 1.0, 0.02] },
  // Ceres e Vesta, visitados pela Dawn: polo e rotação da IAU (2015); relevo e imagens da Dawn (DLR). Vesta é
  // achatada (569 × 554 × 453 km): o raio é o médio e a forma vem do relevo.
  { id: 'ceres', nome: 'Ceres', tipo: 'anao', pai: 'sol', raio: 470, cor: 0x8c8780, textura: '2k_ceres.jpg', soi: 8.8e4, polo: [291.418, 66.764], W: [170.65, 952.1532], relevo: ['relevo/ceres_2048.png', -27.92, 17], rochoso: true },
  { id: 'vesta', nome: 'Vesta', tipo: 'anao', pai: 'sol', raio: 262.7, cor: 0xa59c90, textura: '2k_vesta.jpg', soi: 4.5e4, polo: [309.031, 42.235], W: [285.39, 1617.3329428], relevo: ['relevo/vesta_2048.png', -50.73, 30.25], rochoso: true },
  { id: 'plutao', nome: 'Plutão', tipo: 'anao', pai: 'sol', raio: 1188.3, cor: 0xc9b39a, soi: 3.1e6, polo: [132.993, -6.163], W: [302.695, 56.3625225], textura: '2k_plutao.jpg', relevo: ['relevo/plutao_2048.png', -4.02, 5.99], rochoso: true },
  // Luas. A nossa tem efeméride própria; as outras: órbita circular no equador do planeta,
  // período real, posição ao longo da órbita aproximada. orbita: [raio km, período dias (negativo = retrógrada)]
  { id: 'lua', nome: 'Lua', tipo: 'lua', pai: 'terra', raio: 1737.4, cor: 0xbdbab5, textura: '2k_moon.jpg', textura4k: '4k_moon.jpg', soi: 6.6e4, relevo: ['relevo/lua_2048.png', -8.62, 10.49], rochoso: true },
  { id: 'fobos', nome: 'Fobos', tipo: 'lua', pai: 'marte', raio: 11.1, cor: 0x8a7d70, orbita: [9376, 0.31891], textura: '2k_fobos.jpg', relevo: ['relevo/fobos_2048.png', -2.94, 2.92], rochoso: true },
  { id: 'deimos', nome: 'Deimos', tipo: 'lua', pai: 'marte', raio: 6.2, cor: 0x9c8e7c, orbita: [23463, 1.26244], rochoso: true },
  { id: 'io', nome: 'Io', tipo: 'lua', pai: 'jupiter', raio: 1821.6, cor: 0xe6cf63, orbita: [421700, 1.769138], textura: '2k_io.jpg', rochoso: true },
  { id: 'europa', nome: 'Europa', tipo: 'lua', pai: 'jupiter', raio: 1560.8, cor: 0xd8c9ad, orbita: [671034, 3.551181], textura: '2k_europa.jpg', rochoso: true },
  { id: 'ganimedes', nome: 'Ganimedes', tipo: 'lua', pai: 'jupiter', raio: 2634.1, cor: 0xa09584, orbita: [1070412, 7.154553], textura: '2k_ganimedes.jpg', rochoso: true },
  { id: 'calisto', nome: 'Calisto', tipo: 'lua', pai: 'jupiter', raio: 2410.3, cor: 0x756a5b, orbita: [1882709, 16.689018], textura: '2k_calisto.jpg', rochoso: true },
  { id: 'mimas', nome: 'Mimas', tipo: 'lua', pai: 'saturno', raio: 198.2, cor: 0xc9c6c0, orbita: [185539, 0.942422], textura: '2k_mimas.jpg', rochoso: true },
  { id: 'encelado', nome: 'Encélado', tipo: 'lua', pai: 'saturno', raio: 252.1, cor: 0xf2f4f7, orbita: [237948, 1.370218], textura: '2k_encelado.jpg', relevo: ['relevo/encelado_2048.png', -1.89, 1.41], rochoso: true },
  { id: 'tetis', nome: 'Tétis', tipo: 'lua', pai: 'saturno', raio: 531.1, cor: 0xdedbd5, orbita: [294619, 1.887802], textura: '2k_tetis.jpg', rochoso: true },
  { id: 'dione', nome: 'Dione', tipo: 'lua', pai: 'saturno', raio: 561.4, cor: 0xd2cfca, orbita: [377396, 2.736915], textura: '2k_dione.jpg', rochoso: true },
  { id: 'reia', nome: 'Reia', tipo: 'lua', pai: 'saturno', raio: 763.8, cor: 0xcac6bf, orbita: [527108, 4.518212], textura: '2k_reia.jpg', rochoso: true },
  // Titã: de fora, a névoa laranja (como se vê); com a névoa desligada, a superfície por baixo dela: imagem da Cassini
  // no infravermelho próximo (ISS) e relevo do radar (Corlies et al. 2017)
  { id: 'tita', nome: 'Titã', tipo: 'lua', pai: 'saturno', raio: 2574.7, cor: 0xd9a246, orbita: [1221870, 15.945], atm: [0.95, 0.65, 0.3, 0.12], textura: '2k_titan_surface.jpg', relevo: ['relevo/tita_2048.png', -1.66, 1.14], nevoa: true,
    // a névoa vai até centenas de km; a Huygens viu o chão abaixo de ~50 km, alaranjado e embaçado
    nuvensAlt: [50, 200], veu: { km: 25, cor: [0.78, 0.5, 0.22], luz: [1.0, 0.74, 0.44] } },
  { id: 'japeto', nome: 'Jápeto', tipo: 'lua', pai: 'saturno', raio: 734.5, cor: 0x9a8f80, orbita: [3560820, 79.3215], textura: '2k_japeto.jpg', rochoso: true },
  { id: 'miranda', nome: 'Miranda', tipo: 'lua', pai: 'urano', raio: 235.8, cor: 0xb8b8b8, orbita: [129390, 1.413479], textura: '2k_miranda.jpg', rochoso: true },
  { id: 'ariel', nome: 'Ariel', tipo: 'lua', pai: 'urano', raio: 578.9, cor: 0xc4c2be, orbita: [191020, 2.520379], textura: '2k_ariel.jpg', rochoso: true },
  { id: 'umbriel', nome: 'Umbriel', tipo: 'lua', pai: 'urano', raio: 584.7, cor: 0x7d7a76, orbita: [266000, 4.144177], textura: '2k_umbriel.jpg', rochoso: true },
  { id: 'titania', nome: 'Titânia', tipo: 'lua', pai: 'urano', raio: 788.4, cor: 0xb2aca4, orbita: [435910, 8.705872], textura: '2k_titania.jpg', rochoso: true },
  { id: 'oberon', nome: 'Oberon', tipo: 'lua', pai: 'urano', raio: 761.4, cor: 0xa59c92, orbita: [583520, 13.463239], textura: '2k_oberon.jpg', rochoso: true },
  { id: 'tritao', nome: 'Tritão', tipo: 'lua', pai: 'netuno', raio: 1353.4, cor: 0xd6c9c2, orbita: [354759, -5.876854], textura: '2k_tritao.jpg', rochoso: true },
  { id: 'caronte', nome: 'Caronte', tipo: 'lua', pai: 'plutao', raio: 606, cor: 0xa8a29c, orbita: [19591, 6.3872], textura: '2k_caronte.jpg', relevo: ['relevo/caronte_2048.png', -13.91, 6.75], rochoso: true },
  // Via Láctea e além. Galáxias: raio do disco, ângulo de posição (pa) e inclinação (inc) reais, aproximados.
  // forma: espiral | barrada | eliptica | irregular. grupo: separa as listas de destino.
  // Buracos negros: raio = raio do horizonte de eventos (raio de Schwarzschild, 2,95 km por massa solar). bn.disco: brilho
  // do disco de gás (0: adormecido, sem disco). Massas e distâncias: GRAVITY 2019 (Sgr A*), EHT 2019 (M87*),
  // Miller-Jones et al. 2021 (Cygnus X-1), El-Badry et al. 2023 (Gaia BH1), Gaia 2024 (Gaia BH3), Cantrell et al. 2010 (A0620-00)
  { id: 'sgra', nome: 'Sagitário A*', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 4.3e6, cor: 0xffc890, lum: 1, ra: 266.41684, dec: -29.00781, dist: 8178 * PC, bn: { massa: 4.3e6, disco: 0.35 } },
  { id: 'm87bh', nome: 'M87*', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 6.5e9, cor: 0xffd0a0, lum: 1, ra: 187.70593, dec: 12.39112, dist: 5.35e7 * AL, bn: { massa: 6.5e9, disco: 0.8 } },
  { id: 'cygx1', nome: 'Cygnus X-1', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 21, cor: 0xc8d8ff, lum: 1, ra: 299.59032, dec: 35.20161, dist: 7200 * AL, bn: { massa: 21, disco: 1 } },
  { id: 'gaiabh1', nome: 'Gaia BH1', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 9.6, cor: 0xd0d0d0, lum: 1, ra: 262.17124, dec: -0.58098, dist: 1560 * AL, bn: { massa: 9.6, disco: 0 } },
  { id: 'gaiabh3', nome: 'Gaia BH3', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 33, cor: 0xd0d0d0, lum: 1, ra: 294.82796, dec: 14.93167, dist: 1930 * AL, bn: { massa: 33, disco: 0 } },
  { id: 'v404', nome: 'V404 Cygni', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 9, cor: 0xffd8b0, lum: 1, ra: 306.01592, dec: 33.86722, dist: 7800 * AL, bn: { massa: 9, disco: 0.3 } },
  { id: 'a0620', nome: 'A0620-00', tipo: 'marco', grupo: 'Buracos negros', raio: 2.953 * 6.6, cor: 0xffd8b0, lum: 1, ra: 95.68559, dec: -0.34564, dist: 3300 * AL, bn: { massa: 6.6, disco: 0.25 } },
  { id: 'centro', nome: 'Centro da Via Láctea (Sgr A*)', tipo: 'marco', grupo: 'Via Láctea', raio: 1.2e7, cor: 0xffd9a0, lum: 4e6, ra: 266.4168, dec: -29.0078, dist: 8178 * PC },
  { id: 'vialactea', nome: 'Via Láctea (vista de fora)', tipo: 'galaxia', grupo: 'Via Láctea', raio: 5e4 * AL, cor: 0xfff0d8, lum: 2e10, ra: 266.4168, dec: -29.0078, dist: 8178 * PC, forma: 'modelo' },
  { id: 'gnm', nome: 'Grande Nuvem de Magalhães', tipo: 'galaxia', grupo: 'Via Láctea', raio: 7e3 * AL, cor: 0xdfe6ff, lum: 1.5e9, ra: 80.894, dec: -69.756, dist: 1.63e5 * AL, forma: 'irregular', pa: 170, inc: 35 },
  { id: 'pnm', nome: 'Pequena Nuvem de Magalhães', tipo: 'galaxia', grupo: 'Via Láctea', raio: 3.5e3 * AL, cor: 0xdfe6ff, lum: 4.6e8, ra: 13.187, dec: -72.829, dist: 2.0e5 * AL, forma: 'irregular', pa: 45, inc: 60 },
  { id: 'sagitario', nome: 'Galáxia Anã de Sagitário', tipo: 'galaxia', grupo: 'Via Láctea', raio: 5e3 * AL, cor: 0xffe8c8, lum: 2e5, brilhoPlano: 0.08, ra: 283.76, dec: -30.48, dist: 7.0e4 * AL, forma: 'eliptica' },
  { id: 'andromeda', nome: 'Galáxia de Andrômeda (M31)', tipo: 'galaxia', grupo: 'Grupo Local', raio: 7.6e4 * AL, cor: 0xe6e8ff, lum: 3.3e10, ra: 10.6847, dec: 41.269, dist: 2.537e6 * AL, forma: 'espiral', pa: 35, inc: 77 },
  { id: 'm32', nome: 'M32', tipo: 'galaxia', grupo: 'Grupo Local', raio: 3.3e3 * AL, cor: 0xffe8cc, lum: 3e8, ra: 10.674, dec: 40.865, dist: 2.49e6 * AL, forma: 'eliptica' },
  { id: 'm110', nome: 'M110', tipo: 'galaxia', grupo: 'Grupo Local', raio: 8.5e3 * AL, cor: 0xffe8cc, lum: 3e8, ra: 10.092, dec: 41.685, dist: 2.69e6 * AL, forma: 'eliptica' },
  { id: 'triangulo', nome: 'Galáxia do Triângulo (M33)', tipo: 'galaxia', grupo: 'Grupo Local', raio: 3.05e4 * AL, cor: 0xdfe8ff, lum: 4e9, ra: 23.4621, dec: 30.6599, dist: 2.73e6 * AL, forma: 'espiral', pa: 23, inc: 54 },
  { id: 'barnard', nome: 'Galáxia de Barnard (NGC 6822)', tipo: 'galaxia', grupo: 'Grupo Local', raio: 3.5e3 * AL, cor: 0xe0e8ff, lum: 1e8, ra: 296.24, dec: -14.8, dist: 1.6e6 * AL, forma: 'irregular', pa: 10, inc: 50 },
  { id: 'm81', nome: 'Galáxia de Bode (M81)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 4.5e4 * AL, cor: 0xf0eaff, lum: 3e10, ra: 148.888, dec: 69.065, dist: 1.18e7 * AL, forma: 'espiral', pa: 157, inc: 59 },
  { id: 'm82', nome: 'Galáxia do Charuto (M82)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 1.85e4 * AL, cor: 0xfff0e0, lum: 1e10, ra: 148.968, dec: 69.68, dist: 1.2e7 * AL, forma: 'irregular', pa: 65, inc: 80 },
  { id: 'centauroA', nome: 'Centaurus A (NGC 5128)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 3e4 * AL, cor: 0xffeedd, lum: 5e10, ra: 201.365, dec: -43.019, dist: 1.2e7 * AL, forma: 'eliptica' },
  { id: 'escultor', nome: 'Galáxia do Escultor (NGC 253)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 4.5e4 * AL, cor: 0xf4eeff, lum: 2.5e10, ra: 11.888, dec: -25.288, dist: 1.14e7 * AL, forma: 'espiral', pa: 52, inc: 76 },
  { id: 'm83', nome: 'Cata-vento do Sul (M83)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 2.75e4 * AL, cor: 0xe6ecff, lum: 2e10, ra: 204.254, dec: -29.866, dist: 1.5e7 * AL, forma: 'barrada', pa: 45, inc: 24 },
  { id: 'm64', nome: 'Galáxia do Olho Negro (M64)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 2.7e4 * AL, cor: 0xfff0e0, lum: 1.5e10, ra: 194.182, dec: 21.683, dist: 1.7e7 * AL, forma: 'espiral', pa: 115, inc: 60 },
  { id: 'm101', nome: 'Galáxia do Cata-vento (M101)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 8.5e4 * AL, cor: 0xe2eaff, lum: 3e10, ra: 210.802, dec: 54.349, dist: 2.09e7 * AL, forma: 'espiral', pa: 39, inc: 18 },
  { id: 'm51', nome: 'Galáxia do Rodamoinho (M51)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 3.8e4 * AL, cor: 0xe6ecff, lum: 2.5e10, ra: 202.47, dec: 47.195, dist: 2.3e7 * AL, forma: 'espiral', pa: 163, inc: 22 },
  { id: 'm63', nome: 'Galáxia do Girassol (M63)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 4.9e4 * AL, cor: 0xf0eeff, lum: 2.5e10, ra: 198.955, dec: 42.029, dist: 2.9e7 * AL, forma: 'espiral', pa: 105, inc: 55 },
  { id: 'sombreiro', nome: 'Galáxia do Sombreiro (M104)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 2.5e4 * AL, cor: 0xfff0dc, lum: 8e10, ra: 189.998, dec: -11.623, dist: 3.1e7 * AL, forma: 'espiral', pa: 90, inc: 84 },
  { id: 'm87', nome: 'M87 (Virgem A, buraco negro M87*)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 6e4 * AL, cor: 0xffeedd, lum: 2e11, ra: 187.706, dec: 12.391, dist: 5.35e7 * AL, forma: 'eliptica' },
  { id: 'ngc1300', nome: 'NGC 1300 (espiral barrada)', tipo: 'galaxia', grupo: 'Galáxias próximas', raio: 5.5e4 * AL, cor: 0xeaeeff, lum: 3e10, ra: 49.921, dec: -19.411, dist: 6.1e7 * AL, forma: 'barrada', pa: 106, inc: 49 },
  { id: 'rodacarro', nome: 'Galáxia Roda de Carro', tipo: 'galaxia', grupo: 'Além', raio: 7.5e4 * AL, cor: 0xe0e8ff, lum: 3e10, ra: 9.42, dec: -33.72, dist: 5.0e8 * AL, forma: 'espiral', pa: 30, inc: 40 },
  { id: 'ic1101', nome: 'IC 1101 (uma das maiores galáxias)', tipo: 'galaxia', grupo: 'Além', raio: 2.75e5 * AL, cor: 0xffeedd, lum: 1e12, ra: 227.733, dec: 5.745, dist: 1.04e9 * AL, forma: 'eliptica' },
  { id: 'virgem', nome: 'Aglomerado de Virgem', tipo: 'marco', grupo: 'Além', raio: 4e6 * AL, cor: 0xffe8d0, lum: 1e12, ra: 187.7, dec: 12.3, dist: 5.4e7 * AL },
  { id: 'coma', nome: 'Aglomerado de Coma', tipo: 'marco', grupo: 'Além', raio: 1e7 * AL, cor: 0xffe8d0, lum: 3e12, ra: 194.95, dec: 27.98, dist: 3.21e8 * AL },
  { id: 'atrator', nome: 'Grande Atrator (centro de Laniakea)', tipo: 'marco', grupo: 'Além', raio: 2e7 * AL, cor: 0xffe0c0, lum: 1e12, ra: 243.9, dec: -60.9, dist: 2.5e8 * AL },
  { id: 'q3c273', nome: 'Quasar 3C 273', tipo: 'marco', grupo: 'Além', raio: 1e5 * AL, cor: 0xcfe0ff, lum: 4e12, ra: 187.278, dec: 2.052, dist: 2.4e9 * AL },
  { id: 'jades', nome: 'JADES-GS-z14-0 (galáxia mais distante conhecida)', tipo: 'marco', grupo: 'Além', raio: 1e5 * AL, cor: 0xffd0b0, lum: 1e10, ra: 53.0829, dec: -27.8556, dist: 3.38e10 * AL },
  { id: 'borda', nome: 'Borda do universo observável', tipo: 'marco', grupo: 'Além', raio: 5e8 * AL, cor: 0xffc8a0, lum: 0, ra: 53.0829, dec: -27.8556, dist: 4.65e10 * AL },
];

export const PORID = Object.fromEntries(CORPOS.map((c) => [c.id, c]));
for (const c of CORPOS) c.nome = tr(c.nome); // nome no idioma da interface

// Base do equador de um corpo na cena: X = nodo (IAU, em RA+90°), Y = polo norte, Z = X × Y
function baseEquador(c) {
  const [a, d] = c.polo;
  const p = radecParaCena(a, d, 1);
  const q = radecParaCena(a + 90, 0, 1);
  const z = new THREE.Vector3().crossVectors(q, p);
  return { p, q, z, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(q, p, z)) };
}

let semente = 7;
const acaso = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
for (const c of CORPOS) {
  c.abs = new THREE.Vector3();
  if (c.ra !== undefined) radecParaCena(c.ra, c.dec, c.dist, c.abs);
  c.paiObj = c.pai ? PORID[c.pai] : null;
  if (c.polo) c.base = baseEquador(c);
  if (c.orbita) c.fase0 = acaso() * 360;
  c.relPai = new THREE.Vector3();
  c.qOri = new THREE.Quaternion();
  c.qOriAnt = new THREE.Quaternion();
}

const tmp = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _y = new THREE.Vector3(0, 1, 0), _pr = new THREE.Vector3();
const eixoY = new THREE.Vector3(0, 1, 0);

// Posição exata das luas (JPL Horizons, 1970–2040): integra a órbita (com o achatamento do planeta) a partir
// dos dois pontos tabelados vizinhos e mistura as duas soluções suavemente. Fora do período, usa a aproximação.
export async function carregarEfemeridesLuas() {
  const idx = await (await fetch('dados/luas/indice.json')).json();
  await Promise.all(Object.entries(idx).map(async ([id, e]) => {
    const c = PORID[id];
    if (!c || !PLANETAS[c.pai]) return;
    const d = new Float32Array(await (await fetch(`dados/luas/${id}.bin`)).arrayBuffer());
    const P = PLANETAS[c.pai];
    c.efem = { ...e, d, P, polo: poloEcliptica(P.polo) };
  }));
}
const _ra = [0, 0, 0], _rb = [0, 0, 0];
function posLuaEfem(c, jd, out) {
  const E = c.efem, f = (jd - E.jd0) / E.passo;
  if (!(f >= 0 && f < E.n - 1)) return false;
  const k = Math.floor(f), u = f - k, d = E.d, h = E.passo * 86400, i = k * 6, j = i + 6;
  integrar([d[i], d[i + 1], d[i + 2]], [d[i + 3], d[i + 4], d[i + 5]], u * h, E.P.mu, E.P.j2, E.P.req, E.polo, _ra);
  integrar([d[j], d[j + 1], d[j + 2]], [d[j + 3], d[j + 4], d[j + 5]], (u - 1) * h, E.P.mu, E.P.j2, E.P.req, E.polo, _rb);
  const w = u * u * (3 - 2 * u);
  const x = _ra[0] + (_rb[0] - _ra[0]) * w, y = _ra[1] + (_rb[1] - _ra[1]) * w, z = _ra[2] + (_rb[2] - _ra[2]) * w;
  out.set(x, z, -y); // eclíptica → cena
  return true;
}

function posLuaCircular(c, d, out) {
  const [a, P] = c.orbita;
  const th = (c.fase0 + (360 / P) * d) * GRAU;
  const b = c.paiObj.base;
  return out.copy(b.q).multiplyScalar(a * Math.cos(th)).addScaledVector(b.z, -a * Math.sin(th));
}

// Atualiza posições absolutas e orientações para a data juliana jd
// ΔT = TT − UT (segundos): a simulação conta o tempo civil (UT), mas as fórmulas da Lua usam o tempo dinâmico (TT).
// Polinômios de Espenak e Meeus (NASA), os mesmos do catálogo de eclipses. Sem isso, a Lua fica ~40" adiantada hoje
// e a faixa de um eclipse total se desloca dezenas de quilômetros.
export function deltaT(jd) {
  const y = 2000 + (jd - 2451545.0) / 365.25;
  let t;
  if (y < 1900) { t = (y - 1820) / 100; return -20 + 32 * t * t; }
  if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { t = y - 1920; return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3; }
  if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (y < 2150) return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  t = (y - 1820) / 100; return -20 + 32 * t * t;
}
// Efemérides de precisão (astronomy-engine, MIT): VSOP87 para os planetas e um modelo da Lua com erro de segundos de arco;
// ela mesma converte o tempo civil (UT) em tempo dinâmico (ΔT). Os elementos de Kepler ficam para as linhas das órbitas.
const CORPO_ASTRO = { mercurio: 'Mercury', venus: 'Venus', terra: 'Earth', marte: 'Mars', jupiter: 'Jupiter', saturno: 'Saturn', urano: 'Uranus', netuno: 'Neptune', plutao: 'Pluto' };
export const tempoAstro = (jd) => Astro.MakeTime(new Date((jd - 2440587.5) * 86400000));
export function atualizarPosicoes(jd) {
  const d = jd - 2451545.0;
  const T = d / 36525;
  const t = tempoAstro(jd);
  for (const id in CORPO_ASTRO) {
    if (!PORID[id]) continue;
    const v = Astro.HelioVector(Astro.Body[CORPO_ASTRO[id]], t);
    equatorialParaCena(v.x * UA, v.y * UA, v.z * UA, PORID[id].abs);
  }
  for (const id of SO_KEPLER) if (PORID[id]) kepler(KEPLER[id], T, PORID[id].abs);
  const L = PORID.lua;
  const m = Astro.GeoMoon(t);
  equatorialParaCena(m.x * UA, m.y * UA, m.z * UA, L.relPai);
  for (const c of CORPOS) {
    if (c.orbita) {
      if (c.efem && c.efemJd === jd) { /* já calculada neste instante */ }
      else if (!(c.efem && posLuaEfem(c, jd, c.relPai))) posLuaCircular(c, d, c.relPai);
      c.efemJd = jd;
      c.exata = !!(c.efem && jd >= c.efem.jd0 && jd < c.efem.jd0 + c.efem.passo * (c.efem.n - 1));
    }
    if (c.tipo === 'lua') c.abs.copy(c.paiObj.abs).add(c.relPai);
  }
  // Orientação: rotação própria (IAU) ou travada pela maré (luas: face voltada ao planeta)
  for (const c of CORPOS) {
    c.qOriAnt.copy(c.qOri);
    if (c.poloT) { c.polo = [c.poloT[0] * T, 90 + c.poloT[1] * T]; c.base = baseEquador(c); } // precessão do eixo da Terra
    if (c.W) {
      c.qOri.copy(c.base.quat).multiply(_q.setFromAxisAngle(eixoY, (((c.W[0] + c.W[1] * d) % 360) * GRAU)));
    } else if (c.tipo === 'lua') {
      const x = tmp.copy(c.relPai).negate().normalize();
      // norte: o do planeta; numa órbita retrógrada (Tritão), o contrário, porque a lua gira junto com a órbita
      const polo = c.id === 'lua' ? _y : c.orbita?.[1] < 0 ? _pr.copy(c.paiObj.base.p).negate() : c.paiObj.base.p;
      const z = new THREE.Vector3().crossVectors(x, polo).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      c.qOri.setFromRotationMatrix(_m.makeBasis(x, y, z));
    }
  }
}

// Velocidade (km/s, na cena) de um planeta pelos elementos orbitais, por diferença em 60 s
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
export function velocidadePlaneta(id, jd) {
  const b = CORPO_ASTRO[id];
  if (SO_KEPLER.includes(id)) { // por diferença em 60 s
    const T = (jd - 2451545.0) / 36525, dT = 60 / 86400 / 36525;
    return kepler(KEPLER[id], T + dT, _v2).sub(kepler(KEPLER[id], T, _v1)).divideScalar(60).clone();
  }
  if (!b) return new THREE.Vector3();
  const e = Astro.HelioState(Astro.Body[b], tempoAstro(jd)); // UA/dia
  const k = UA / 86400;
  return equatorialParaCena(e.vx * k, e.vy * k, e.vz * k);
}

// Pontos de uma órbita (para desenhar a linha), relativos ao pai, km
export function pontosOrbita(id, jd, n = 360) {
  const c = PORID[id];
  const T = (jd - 2451545.0) / 36525;
  const pts = [];
  if (id === 'lua') {
    for (let i = 0; i <= n; i++) pts.push(lua(jd - 2451545.0 + (27.321661 * i) / n, new THREE.Vector3()));
    return pts;
  }
  if (c.orbita) {
    for (let i = 0; i <= n; i++) {
      const t = jd + (Math.abs(c.orbita[1]) * i) / n, v = new THREE.Vector3();
      if (!(c.efem && posLuaEfem(c, t, v))) posLuaCircular(c, t - 2451545.0, v);
      pts.push(v);
    }
    return pts;
  }
  const el = KEPLER[id].slice();
  for (let i = 0; i <= n; i++) {
    const e2 = el.slice();
    e2[3] = el[4] + (360 * i) / n + el[10] * T; // varre a anomalia média
    e2[9] = 0;
    pts.push(kepler(e2, T, new THREE.Vector3()));
  }
  return pts;
}
