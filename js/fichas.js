// Fichas de chegada: um cartão com o essencial de cada lugar ao chegar (e ao tocar no nome em "Onde estou").
// Sistema Solar e galáxias: dados curados em dados/fichas.json (fichas da NASA); estrelas e exoplanetas: calculados
// do catálogo. Os textos passam pela tradução como os do resto da interface.
import { t, LOCALE } from './idioma.js';

const G = 6.674e-11, MASSA_TERRA = 5.972e24, RAIO_SOL = 695700, RAIO_TERRA = 6371, G_TERRA = 9.81;
let dados = { corpos: {}, estrelas: {} };
export async function carregarFichas() {
  try { dados = await fetch('dados/fichas.json').then((r) => r.json()); } catch { /* sem fichas curadas */ }
}

const TIPO_SS = {
  sol: 'Estrela anã amarela', mercurio: 'Planeta rochoso', venus: 'Planeta rochoso', terra: 'Planeta rochoso', marte: 'Planeta rochoso',
  jupiter: 'Gigante gasoso', saturno: 'Gigante gasoso', urano: 'Gigante de gelo', netuno: 'Gigante de gelo', plutao: 'Planeta anão',
};
const num = (v, casas = 0) => v.toLocaleString(LOCALE, { maximumFractionDigits: casas });

// Tipo da estrela pela temperatura e pelo tamanho
function tipoEstrela(T, rSol) {
  const cor = T < 3700 ? 'vermelha' : T < 5200 ? 'laranja' : T < 6000 ? 'amarela' : T < 10500 ? 'branca' : 'azul';
  if (rSol < 0.05 && T > 4500) return t('anã branca');
  if (rSol > 100) return t(`supergigante ${cor}`);
  if (rSol > 10) return t(`gigante ${cor}`);
  if (T < 3700) return t('anã vermelha');
  if (T < 5200) return t('anã laranja');
  if (T < 6000) return t('anã amarela, como o Sol');
  if (T < 7500) return t('estrela branco-amarelada');
  if (T < 10500) return t('estrela branca'); // a temperatura vem da cor: ±500 K
  return t('estrela azul');
}
const classe = (T) => (T < 3700 ? 'M' : T < 5200 ? 'K' : T < 6000 ? 'G' : T < 7500 ? 'F' : T < 10500 ? 'A' : T < 30000 ? 'B' : 'O');

// h: { sig, distancia, duracao, anoLuzSaiu(km) → texto, dTerra(c) → km, dSol(c) → km, PORID, cat }
export function montarFicha(c, h) {
  const f = { nome: c.nome, tipo: '', linhas: [], curiosidade: '' };
  const add = (rotulo, valor) => { if (valor !== undefined && valor !== null && valor !== '') f.linhas.push([t(rotulo), valor]); };
  const cur = dados.corpos[c.id];
  if (c.exo) return fichaExoplaneta(c, f, add, h);
  if (c.tipo === 'estrela' && c.id !== 'sol') return fichaEstrela(c, f, add, h);
  if (c.tipo === 'galaxia' || c.tipo === 'marco') {
    f.tipo = cur?.tipo ? t(cur.tipo) : t(c.tipo === 'galaxia' ? 'galáxia' : 'lugar do universo');
    add('Distância', h.distancia(h.dTerra(c)));
    if (c.raio && c.id !== 'borda' && c.id !== 'centro') add('Tamanho', t('cerca de {d} de diâmetro', { d: h.distancia(c.raio * 2) }));
    add('A luz que chega daqui saiu', h.anoLuzSaiu(h.dTerra(c)));
    f.curiosidade = cur?.curiosidade ? t(cur.curiosidade) : '';
    return f;
  }
  // Sistema Solar
  f.tipo = c.tipo === 'lua' ? t('Lua {de:p}', { p: c.paiObj }) : t(cur?.tipo ?? TIPO_SS[c.id] ?? 'Corpo do Sistema Solar');
  const diam = c.raio * 2;
  add('Diâmetro', `${num(diam)} km` + (c.id !== 'terra' ? ` (${t(c.raio / RAIO_TERRA < 2 ? '{n} vez a Terra' : '{n} vezes a Terra', { n: c.raio / RAIO_TERRA >= 100 ? num(c.raio / RAIO_TERRA) : h.sig(c.raio / RAIO_TERRA) })})` : ''));
  if (cur?.massa) {
    const mt = cur.massa / MASSA_TERRA;
    add('Massa', c.id === 'terra' ? `${h.sig(cur.massa / 1e24)} × 10²⁴ kg` : mt >= 0.001 ? t(mt < 2 ? '{n} massa da Terra' : '{n} massas da Terra', { n: h.sig(mt) }) : `${h.sig(cur.massa / 10 ** Math.floor(Math.log10(cur.massa)))} × 10${sobrescrito(Math.floor(Math.log10(cur.massa)))} kg`);
    const g = (G * cur.massa) / (c.raio * 1000) ** 2;
    const r = g / G_TERRA;
    add('Gravidade', `${h.sig(g)} m/s² (${r >= 2 ? t('{n} vezes a da Terra', { n: h.sig(r) }) : t('{p} da Terra', { p: r >= 0.1 ? `${num(r * 100)}%` : `${h.sig(r * 100)}%` })})`);
  }
  if (cur?.dia) add('Dia', t(cur.dia));
  if (cur?.ano) add(c.tipo === 'lua' ? 'Órbita' : 'Ano', t(cur.ano));
  if (cur?.temp) add('Temperatura', t(cur.temp));
  if (cur?.luas !== undefined) add('Luas conhecidas', num(cur.luas));
  if (c.id !== 'sol') add('Do Sol agora', h.distancia(h.dSol(c)));
  if (c.id !== 'terra') add('Da Terra agora', `${h.distancia(h.dTerra(c))} · ${t('a luz leva {d}', { d: h.duracao(h.dTerra(c) / 299792.458) })}`);
  if (cur?.descoberta) add('Descoberta', t(cur.descoberta));
  f.curiosidade = cur?.curiosidade ? t(cur.curiosidade) : '';
  return f;
}

function fichaEstrela(c, f, add, h) {
  const rSol = c.raio / RAIO_SOL;
  f.tipo = tipoEstrela(c.T, rSol);
  add('Classe e temperatura', `${classe(c.T)} · ${num(Math.round(c.T / 100) * 100)} K`);
  add('Tamanho', t(rSol < 2 ? '{n} vez o raio do Sol' : '{n} vezes o raio do Sol', { n: h.sig(rSol) }));
  add('Brilho', t(c.lum < 2 ? '{n} vez a luz do Sol' : '{n} vezes a luz do Sol', { n: h.sig(c.lum) }));
  add('Da Terra', h.distancia(h.dTerra(c)));
  add('A luz que chega daqui saiu', h.anoLuzSaiu(h.dTerra(c)));
  const e = c.exoSistema;
  if (e) add('Planetas conhecidos', `${e.pl.length}: ${e.pl.slice(0, 8).map((p) => p.n.replace(`${e.n} `, '')).join(', ')}${e.pl.length > 8 ? '…' : ''}`);
  const ptNome = Object.keys(dados.estrelas).find((n) => h.cat.porNome.get(n) === c.hyg);
  f.curiosidade = ptNome ? t(dados.estrelas[ptNome]) : '';
  return f;
}

function fichaExoplaneta(c, f, add, h) {
  const p = c.exo, est = c.estrela;
  f.tipo = t('Exoplaneta: {tipo}', { tipo: t(c.tipoExo) });
  add('Tamanho', t(p.R < 2 ? '{n} vez o raio da Terra' : '{n} vezes o raio da Terra', { n: h.sig(p.R) }) + (p.est & 1 ? t(' (estimado pela massa)') : ''));
  add('Massa', t(p.M < 2 ? '{n} massa da Terra' : '{n} massas da Terra', { n: h.sig(p.M) }) + (p.est & 2 ? t(' (estimada pelo tamanho)') : ''));
  if (p.R < 6) add('Gravidade', t('cerca de {p} da Terra (estimada)', { p: `${num((p.M / p.R ** 2) * 100)}%` }));
  if (p.P) add('Ano', p.P < 2 ? t('{n} horas', { n: h.sig(p.P * 24) }) : p.P < 1000 ? t('{n} dias', { n: h.sig(p.P) }) : t('{n} anos', { n: h.sig(p.P / 365.25) }));
  add('Distância da estrela', t('{n} UA (a Terra está a 1)', { n: h.sig(p.a) }));
  if (p.Teq) add('Temperatura de equilíbrio', `${String(Math.round(p.Teq - 273)).replace('-', '−')} °C`);
  const L = (est.raio / RAIO_SOL) ** 2 * (est.T / 5772) ** 4, S = L / p.a ** 2;
  add('Zona habitável', t(S > 1.107 ? 'mais perto da estrela que a zona habitável' : S >= 0.356 ? 'dentro da zona habitável: com atmosfera, poderia ter água líquida' : 'além da zona habitável'));
  add('Da Terra', h.distancia(h.dTerra(c)));
  add('Descoberta', t('{ano}, por {met}', { ano: p.ano, met: t({ 'Transit': 'trânsito', 'Radial Velocity': 'velocidade radial', 'Microlensing': 'microlente gravitacional', 'Imaging': 'imagem direta' }[p.met] ?? p.met) }) + (p.onde ? ` (${p.onde})` : ''));
  f.curiosidade = t('A aparência é ilustrativa: ninguém fotografou a superfície de um exoplaneta. Tamanho, massa e órbita são medidos.');
  return f;
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sobrescrito = (e) => String(e).split('').map((d) => (d === '-' ? '⁻' : SUP[+d])).join('');
