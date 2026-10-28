// Fichas de chegada: um cartão com os dados de cada lugar ao chegar (e ao tocar no nome em "Onde estou"), feito para
// servir de pesquisa: cada número vem com a fonte (link e data de consulta) e a ficha pode ser copiada como texto.
// Dados: dados/fichas_dados.json (NASA, JPL; gerado por dados/gerar_fichas.py), dados/fichas.json (textos curados),
// e, só quando uma ficha precisa, dados/estrelas_info.json (HYG) e dados/exoplanetas_fichas.json (NASA Exoplanet
// Archive); para as constelações, dados/constelacoes_fichas.json (gerado por dados/gerar_constelacoes.py) e
// dados/constelacoes_textos.json (textos escritos para o projeto, nos três idiomas). Os textos passam pela tradução
// como os do resto da interface.
import { t, LOCALE, idioma } from './idioma.js';

const G = 6.674e-11, MASSA_TERRA = 5.972e24, RAIO_SOL = 695700, RAIO_TERRA = 6371, G_TERRA = 9.81, UA = 149597870.7;
let dados = { corpos: {}, estrelas: {} }, tecnicos = { corpos: {}, galaxias: {}, fontes: {} };
let estrelasInfo = null, exoInfo = null, constDados = null, constTextos = null, relevo = null;
export async function carregarFichas() {
  await Promise.all([
    fetch('dados/fichas.json').then((r) => r.json()).then((d) => (dados = d)).catch(() => {}),
    fetch('dados/fichas_dados.json').then((r) => r.json()).then((d) => (tecnicos = d)).catch(() => {}),
  ]);
}
// Gravidade na superfície (m/s²): a da tabela da NASA/JPL; sem ela (exoplanetas rochosos), pela massa ou, sem massa,
// com a densidade da Terra
export function gravidadeDe(c) {
  const g = tecnicos.corpos?.[c.id]?.gravidade;
  if (g) return g;
  const R = c.raio * 1000;
  if (c.massaTerra) return (G * c.massaTerra * MASSA_TERRA) / (R * R);
  return (4 / 3) * Math.PI * G * 5514 * R;
}
// Dados de catálogo das estrelas e das descobertas dos exoplanetas: só baixados na primeira ficha que os usa
export const precisaExtras = (c) => (c.exo && !exoInfo) || (c.tipo === 'estrela' && c.id !== 'sol' && (!estrelasInfo || (c.exoSistema && !exoInfo)))
  || (c.tipo === 'constelacao' && !constDados) || (c.tipo === 'relevo' && !relevo);
export async function carregarExtras(c) {
  if (c?.tipo === 'relevo') { // tipos, textos dos lugares famosos e origens dos nomes (no idioma da página)
    const pegar = (u) => fetch(u).then((r) => r.json()).catch(() => null);
    const [tipos, famosos, origens] = await Promise.all([pegar('dados/nomes/tipos.json'), pegar('dados/nomes/famosos.json'), pegar(`dados/nomes/origens.${idioma}.json`)]);
    relevo = { tipos: tipos ?? {}, famosos: famosos ?? {}, origens: origens ?? [] };
    return;
  }
  if (c?.tipo === 'constelacao') {
    await Promise.all([
      fetch('dados/constelacoes_fichas.json').then((r) => r.json()).then((d) => (constDados = d)).catch(() => (constDados = { lista: {} })),
      fetch('dados/constelacoes_textos.json').then((r) => r.json()).then((d) => (constTextos = d)).catch(() => (constTextos = { textos: {} })),
    ]);
    return;
  }
  await Promise.all([
    estrelasInfo ? null : fetch('dados/estrelas_info.json').then((r) => r.json()).then((d) => (estrelasInfo = d.estrelas)).catch(() => (estrelasInfo = {})),
    exoInfo ? null : fetch('dados/exoplanetas_fichas.json').then((r) => r.json()).then((d) => (exoInfo = d)).catch(() => (exoInfo = {})),
  ]);
}

const TIPO_SS = {
  sol: 'Estrela anã amarela', mercurio: 'Planeta rochoso', venus: 'Planeta rochoso', terra: 'Planeta rochoso', marte: 'Planeta rochoso',
  jupiter: 'Gigante gasoso', saturno: 'Gigante gasoso', urano: 'Gigante de gelo', netuno: 'Gigante de gelo', plutao: 'Planeta anão',
};
const num = (v, casas = 0) => v.toLocaleString(LOCALE, { maximumFractionDigits: casas });
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sobrescrito = (e) => String(e).split('').map((d) => (d === '-' ? '⁻' : SUP[+d])).join('');
const cientifico = (v, sig) => { const e = Math.floor(Math.log10(Math.abs(v))); return `${sig(v / 10 ** e)} × 10${sobrescrito(e)}`; };
const GREGO = { Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω' };
const grego = (b) => b.replace(/^([A-Z][a-z]{1,2})(-?\d)?/, (m, l, k) => (GREGO[l] ?? l) + (k ? sobrescrito(k.replace('-', '')) : ''));
const sexagesimal = (v, horas) => {
  const s = v < 0 ? '−' : horas ? '' : '+', a = Math.abs(v), g = Math.floor(a), mm = Math.floor((a - g) * 60), ss = Math.round(((a - g) * 60 - mm) * 60);
  return horas ? `${g}h ${String(mm).padStart(2, '0')}m ${String(ss).padStart(2, '0')}s` : `${s}${g}° ${String(mm).padStart(2, '0')}′ ${String(ss).padStart(2, '0')}″`;
};

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

// Uma ficha: seções de [rótulo, valor], curiosidade e fontes. h: { sig, distancia, duracao, anoLuzSaiu(km), dTerra(c),
// dSol(c), PORID, cat }
export function montarFicha(c, h) {
  const f = { nome: c.nome, tipo: '', secoes: [], curiosidade: '', fontes: [], consultado: tecnicos.consultado };
  let secao = null;
  const abrir = (titulo) => { secao = [t(titulo), []]; f.secoes.push(secao); };
  const add = (rotulo, valor) => { if (valor !== undefined && valor !== null && valor !== '') secao[1].push([rotulo === null ? null : t(rotulo), valor]); };
  const fonte = (chave) => { const x = tecnicos.fontes[chave]; if (x && !f.fontes.some((y) => y[1] === x[1])) f.fontes.push([t(x[0]), x[1]]); };
  if (c.tipo === 'constelacao') fichaConstelacao(c, f, abrir, add, h);
  else if (c.tipo === 'relevo') fichaRelevo(c, f, abrir, add);
  else if (c.exo) fichaExoplaneta(c, f, abrir, add, h);
  else if (c.tipo === 'estrela' && c.id !== 'sol') fichaEstrela(c, f, abrir, add, fonte, h);
  else if (c.tipo === 'galaxia' || c.tipo === 'marco') fichaGalaxia(c, f, abrir, add, h);
  else fichaSistemaSolar(c, f, abrir, add, fonte, h);
  f.secoes = f.secoes.filter((s) => s[1].length);
  return f;
}

// Constelação: o desenho (f.desenho), os textos da primeira leva (história, como achar, destaque, outros povos) e os
// dados de todas as 88 (UAI, HYG, OpenNGC). Linhas com rótulo null são parágrafos.
const MESES = (m) => new Date(Date.UTC(2026, m - 1, 15)).toLocaleDateString(LOCALE, { month: 'long', timeZone: 'UTC' });
const DIA_MES = (mmdd) => { const [m, d] = mmdd.split('-').map(Number); return new Date(Date.UTC(2026, m - 1, d)).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', timeZone: 'UTC' }); };
function fichaConstelacao(c, f, abrir, add, h) {
  f.tipo = t('Constelação');
  if (!constDados) return;
  const [ab, d] = Object.entries(constDados.lista).find(([, v]) => v.pt === c.nomePt) ?? [];
  if (!d) return;
  f.consultado = constDados.consultado;
  const tx = constTextos?.textos?.[ab]?.[idioma] ?? constTextos?.textos?.[ab]?.pt;
  f.desenho = { d, rotulos: d.principais.filter((e) => e[3] < 3.6).map((e) => [e[0] || grego(e[1]) || e[2], e[5], e[6]]) };
  if (tx) { abrir('A figura e a história'); add(null, tx.historia); }
  abrir('Como achar');
  if (tx) add(null, tx.achar);
  add('Melhor época', t('Às 21 h, passa mais alto no céu em {m}', { m: MESES(d.mes21h) }));
  const altBsb = 90 - Math.abs(-15.8 - d.centro[1]), altPoa = 90 - Math.abs(-30 - d.centro[1]), altFor = 90 - Math.abs(-3.7 - d.centro[1]);
  add('Do Brasil', altFor < 5 ? t('fica abaixo do horizonte: só se vê do hemisfério norte')
    : altPoa < 5 ? t('aparece baixa no horizonte norte, mais no Norte e no Nordeste; do Sul, não se vê')
      : d.centro[1] < -60 ? t('do Sul e do Sudeste, nunca se põe: gira em volta do polo sul celeste')
        : t('passa a {a}° de altura em Brasília', { a: num(Math.min(altBsb, 90)) }) + (d.centro[1] > -15.8 ? ` (${t('ao norte')})` : ` (${t('ao sul')})`));
  if (d.sol) {
    add('O Sol passa por ela', t('de {a} a {b}', { a: DIA_MES(d.sol[0]), b: DIA_MES(d.sol[1]) }));
    add(null, t('As datas dos signos da astrologia são outras: foram fixadas há uns 2 mil anos, e desde então o eixo da Terra mudou de direção (a precessão). As constelações também não têm o mesmo tamanho, e o Sol passa ainda pelo Serpentário.'));
  }
  if (tx?.destaque) { abrir('Destaque'); add(null, tx.destaque); }
  if (tx?.povos) { abrir('Outros povos'); add(null, tx.povos); }
  abrir('Estrelas mais brilhantes');
  for (const [nome, bayer, flam, mag, ly] of d.principais.slice(0, 5)) {
    const desig = bayer ? `${grego(bayer)} ${d.gen}` : flam ? `${flam} ${d.gen}` : '';
    add(nome ? `${nome}${desig ? ` (${desig})` : ''}` : desig || '—', t('magnitude {m}', { m: num(mag, 2) }) + (ly ? ` · ${t('{n} anos-luz', { n: num(ly) })}` : ''));
  }
  if (d.messier.length) {
    abrir('Para o binóculo e o telescópio');
    for (const [m, nome, tipo, mag] of d.messier) add(`M${m}${nome ? ` · ${t(nome)}` : ''}`, t(tipo) + (mag ? ` · ${t('magnitude {m}', { m: num(mag, 1) })}` : ''));
  }
  abrir('A constelação');
  add('Nome oficial', `${d.la} (${t('genitivo')} ${d.gen}, ${t('abreviação')} ${ab})`);
  add('Área', t('{a} graus quadrados, a {n}.ª maior das 88', { a: num(d.area), n: d.posArea }));
  f.fontes.push([t('Limites, nomes e linhas: UAI, via d3-celestial (Olaf Frohn, BSD)'), 'https://github.com/ofrohn/d3-celestial']);
  if (d.figura) f.fontes.push([t('Ilustração: Johan Meuris, Stellarium (Free Art License)'), 'https://github.com/Stellarium/stellarium-skycultures/tree/master/western']);
  f.fontes.push([t('Estrelas: HYG v4.1 (CC BY-SA 4.0)'), 'https://github.com/astronexus/HYG-Database']);
  if (d.messier.length) f.fontes.push([t('Objetos de Messier: OpenNGC (CC BY-SA 4.0)'), 'https://github.com/mattiaverga/OpenNGC']);
  if (tx?.povos) f.fontes.push([constTextos.fonte_povos, '']);
}

// Lugar com nome no relevo de outro corpo (Gazetteer da UAI/USGS): o tipo e como se forma, a origem do nome e,
// nos famosos, um texto escrito para o projeto. Linhas com rótulo null são parágrafos.
const IDX = { pt: 0, en: 1, es: 2 }[idioma] ?? 0;
const DESCRITOR = /^(Mons|Montes|Patera|Paterae|Rupes|Dorsum|Dorsa|Vallis|Valles|Fossa|Fossae|Chasma|Chasmata|Tholus|Tholi|Planitia|Corona|Coronae|Catena|Catenae|Linea|Lineae|Regio|Sulcus|Sulci|Fluctus|Facula|Faculae|Planum|Mensa|Mensae|Colles|Cavus|Cavi|Labyrinthus|Terra|Terrae|Macula|Maculae|Undae|Scopulus|Lacus|Lacuna|Mare|Sinus|Palus|Insula|Insulae|Flumen|Flumina|Fretum|Virga|Virgae|Farrum|Farra|Flexus|Arcus|Lingula|Rima|Rimae|Promontorium|Statio|Labes|Chaos|Tessera|Tesserae)$/;
function fichaRelevo(c, f, abrir, add) {
  const [nome, cod, diam, lat, lon, io, fid] = c.f;
  f.nome = nome;
  if (!relevo) { f.tipo = t('Relevo'); return; }
  const tp = relevo.tipos[cod];
  f.tipo = t('{tipo} {em:c}', { tipo: tp ? tp.nome[IDX] : cod, c: c.corpo });
  f.consultado = relevo.tipos._consultado;
  const famoso = relevo.famosos[`${c.corpo.id}:${nome}`];
  if (famoso) { abrir('Sobre este lugar'); add(null, famoso[IDX]); }
  if (tp) { abrir('Como se forma'); add(null, (tp.corpos?.[c.corpo.id] ?? tp.expl)[IDX]); }
  let origem = relevo.origens[io];
  // homenagens a pessoas: a lista dá só os prenomes ("Ira Sprague; astrônomo americano"), porque o sobrenome é o nome
  // do lugar; junta os dois, sem a palavra do tipo ("Keller Patera" → Helen Keller)
  const m = origem && /^([^;,()0-9"“]{2,60}); (.+)$/.exec(origem);
  if (m) {
    const sobrenome = nome.split(' ').filter((w) => !DESCRITOR.test(w)).join(' ');
    if (sobrenome && !m[1].includes(sobrenome)) origem = `${m[1]} ${sobrenome}; ${m[2]}`;
  }
  if (origem) { abrir('Origem do nome'); add(null, origem); }
  abrir('Dados');
  if (diam > 0) add(cod === 'AA' ? 'Diâmetro' : 'Extensão', `${num(diam, diam < 10 ? 1 : 0)} km`);
  const ns = lat >= 0 ? 'N' : 'S', w = lon > 180, l = w ? 360 - lon : lon;
  add('Posição', `${num(Math.abs(lat), 2)}° ${ns}, ${num(l, 2)}° ${t(w ? 'O' : 'L')}`);
  f.fontes.push([t('Nome: UAI, Gazetteer of Planetary Nomenclature (USGS)'), `https://planetarynames.wr.usgs.gov/Feature/${fid}`]);
}

function fichaSistemaSolar(c, f, abrir, add, fonte, h) {
  const cur = dados.corpos[c.id] ?? {}, d = tecnicos.corpos[c.id] ?? {};
  f.tipo = c.tipo === 'lua' ? t('Lua {de:p}', { p: c.paiObj }) : t(cur.tipo ?? TIPO_SS[c.id] ?? 'Corpo do Sistema Solar');
  const sig = h.sig;
  abrir('O corpo');
  const diam = d.diametro ?? c.raio * 2;
  add('Diâmetro', `${num(diam)} km` + (c.id !== 'terra' ? ` (${t(diam / 2 / RAIO_TERRA < 2 ? '{n} vez a Terra' : '{n} vezes a Terra', { n: diam / 2 / RAIO_TERRA >= 100 ? num(diam / 2 / RAIO_TERRA) : sig(diam / 2 / RAIO_TERRA) })})` : ''));
  if (d.dimensoes) add('Dimensões', d.dimensoes.replace(/\./g, LOCALE.startsWith('en') ? '.' : ','));
  const massa = d.massa ?? cur.massa;
  if (massa) {
    const mt = massa / MASSA_TERRA;
    add('Massa', `${cientifico(massa, sig)} kg` + (c.id !== 'terra' ? ` (${mt >= 0.001 ? t(mt < 2 ? '{n} massa da Terra' : '{n} massas da Terra', { n: sig(mt) }) : t('{p} da Terra', { p: `${sig(mt * 100)}%` })})` : ''));
    const g = d.gravidade ?? (G * massa) / (c.raio * 1000) ** 2;
    const r = g / G_TERRA;
    add('Gravidade na superfície', `${sig(g)} m/s²` + (c.id !== 'terra' ? ` (${r >= 2 ? t('{n} vezes a da Terra', { n: sig(r) }) : t('{p} da Terra', { p: r >= 0.1 ? `${num(r * 100)}%` : `${sig(r * 100)}%` })})` : ''));
  }
  if (d.densidade) add('Densidade média', `${num(d.densidade)} kg/m³` + (d.densidade < 1000 ? ` (${t('menor que a da água')})` : ''));
  if (d.escape) add('Velocidade de escape', `${sig(d.escape)} km/s`);
  if (d.luminosidade) add('Luminosidade', `${cientifico(d.luminosidade, sig)} W`);
  if (d.tipoEspectral) add('Tipo espectral', d.tipoEspectral);
  const horas = (x) => (Math.abs(x) < 72 ? t('{n} horas', { n: sig(Math.abs(x)) }) : t('{n} dias', { n: sig(Math.abs(x) / 24) })) + (x < 0 ? ` (${t('ao contrário')})` : '');
  if (d.rotacao) add('Rotação (em relação às estrelas)', horas(d.rotacao));
  else if (cur.dia) add('Dia', t(cur.dia));
  if (d.dia && Math.abs(Math.abs(d.dia) - Math.abs(d.rotacao ?? 0)) / Math.abs(d.dia) > 0.02) add('Dia solar (de um nascer do Sol ao outro)', horas(d.dia));
  if (d.obliquidade !== undefined) add('Inclinação do eixo', `${num(d.obliquidade, 2)}°`);
  if (cur.temp) add('Temperatura', t(cur.temp));
  else if (d.temperatura !== undefined) add('Temperatura média', `${num(d.temperatura)} °C`);
  if (d.pressao !== undefined) add('Pressão na superfície', d.pressao === 0 ? t('sem atmosfera') : `${sig(d.pressao)} bar`);
  if (d.albedo) add('Albedo (fração da luz refletida)', num(d.albedo, 2));
  const luas = d.luas ?? cur.luas;
  if (luas !== undefined) add('Luas conhecidas', num(luas));
  if (d.aneis !== undefined) add('Anéis', t(d.aneis ? 'sim' : 'não'));
  if (d.campoMagnetico !== undefined) add('Campo magnético global', t(d.campoMagnetico ? 'sim' : 'não'));

  if (c.id !== 'sol') {
    abrir('A órbita');
    const lua = c.tipo === 'lua';
    if (d.semieixo) add(lua ? 'Distância média do planeta' : 'Distância média do Sol', lua ? `${num(d.semieixo)} km` : h.distancia(d.semieixo));
    if (d.perielio && d.afelio) add(lua ? 'Mais perto e mais longe' : 'Periélio e afélio', `${lua ? `${num(d.perielio)} km` : h.distancia(d.perielio)} · ${lua ? `${num(d.afelio)} km` : h.distancia(d.afelio)}`);
    if (d.excentricidade !== undefined) add('Excentricidade', num(d.excentricidade, 4));
    if (d.inclinacao !== undefined) add(lua ? 'Inclinação da órbita (sobre o equador do planeta)' : 'Inclinação da órbita (sobre a eclíptica)', `${num(d.inclinacao, 2)}°`);
    if (d.periodo) add(lua ? 'Período (uma volta)' : 'Ano (uma volta no Sol)', d.periodo < 1000 ? t('{n} dias', { n: sig(d.periodo) }) : t('{n} anos', { n: sig(d.periodo / 365.25) }));
    else if (cur.ano) add(lua ? 'Órbita' : 'Ano', t(cur.ano));
    if (d.velOrbital) add('Velocidade média na órbita', `${sig(d.velOrbital)} km/s`);
  }

  abrir('A descoberta');
  if (d.descobertaAno) {
    const quando = d.descobertaAno === 'Antiguidade' ? '' : d.descobertaData ? new Date(d.descobertaData).toLocaleDateString(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : d.descobertaAno;
    add('Descoberta', (quando ? `${quando}, ` : '') + (d.descobertaAno === 'Antiguidade' ? t(d.descobertaPor) : t('por {p}', { p: t(d.descobertaPor) })) + (d.descobertaLocal ? t(', em {l}', { l: d.descobertaLocal }) : ''));
  } else if (cur.descoberta) add('Descoberta', t(cur.descoberta));

  abrir('Agora');
  if (c.id !== 'sol') add('Do Sol agora', h.distancia(h.dSol(c)));
  if (c.id !== 'terra') add('Da Terra agora', `${h.distancia(h.dTerra(c))} · ${t('a luz leva {d}', { d: h.duracao(h.dTerra(c) / 299792.458) })}`);
  f.curiosidade = cur.curiosidade ? t(cur.curiosidade) : '';
  for (const k of d.fontes ?? []) fonte(k);
  if (cur.curiosidade) f.fontes.push([t('NASA Science: Sistema Solar (textos)'), 'https://science.nasa.gov/solar-system/']);
}

function fichaEstrela(c, f, abrir, add, fonte, h) {
  const rSol = c.raio / RAIO_SOL, sig = h.sig;
  f.tipo = tipoEstrela(c.T, rSol);
  const info = estrelasInfo?.[c.hyg];
  abrir('A estrela');
  if (info) {
    const [cat, ra, dec, mag, spect, , bayer] = info;
    const nomes = [bayer ? grego(bayer) : '', cat.hip && `HIP ${cat.hip}`, cat.hd && `HD ${cat.hd}`, cat.hr && `HR ${cat.hr}`, cat.gl && cat.gl.replace(/^Gl /, 'Gliese ')].filter(Boolean);
    if (nomes.length) add('Nos catálogos', nomes.join(' · '));
    add('Coordenadas (J2000)', `${sexagesimal(ra, true)} · ${sexagesimal(dec, false)}`);
    add('Magnitude aparente', num(mag, 2).replace('-', '−') + (mag < 6.5 ? ` (${t('visível a olho nu')})` : ''));
    if (spect) add('Tipo espectral', spect.replace(/\.+$/, ''));
  }
  add('Classe e temperatura', `${classe(c.T)} · ${num(Math.round(c.T / 100) * 100)} K` + (info?.[4] ? '' : ` (${t('pela cor')})`));
  add('Tamanho', t(rSol < 2 ? '{n} vez o raio do Sol' : '{n} vezes o raio do Sol', { n: sig(rSol) }));
  add('Brilho', t(c.lum < 2 ? '{n} vez a luz do Sol' : '{n} vezes a luz do Sol', { n: sig(c.lum) }));
  const e = c.exoSistema;
  if (e) add('Planetas conhecidos', `${e.pl.length}: ${e.pl.slice(0, 8).map((p) => p.n.replace(`${e.n} `, '')).join(', ')}${e.pl.length > 8 ? '…' : ''}`);
  abrir('Agora');
  add('Da Terra', h.distancia(h.dTerra(c)));
  add('A luz que chega daqui saiu', h.anoLuzSaiu(h.dTerra(c)));
  const ptNome = Object.keys(dados.estrelas).find((n) => h.cat.porNome.get(n) === c.hyg);
  f.curiosidade = ptNome ? t(dados.estrelas[ptNome]) : '';
  fonte('hyg');
  if (e) { fonte('exo'); f.fontes.push([t('{c} no NASA Exoplanet Archive', { c: e.n }), `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(e.n)}`]); }
}

function fichaExoplaneta(c, f, abrir, add, h) {
  const p = c.exo, est = c.estrela, x = exoInfo?.[p.n] ?? {}, sig = h.sig;
  const m2 = (v) => Number(Math.abs(v).toPrecision(2)).toLocaleString(LOCALE, { maximumSignificantDigits: 2 }); // margens: 2 algarismos
  const erro = (e) => (!e || e[0] == null ? '' : Math.abs(e[0]) === Math.abs(e[1] ?? e[0]) ? ` (± ${m2(e[0])})` : ` (+${m2(e[0])} −${m2(e[1])})`);
  f.tipo = t('Exoplaneta: {tipo}', { tipo: t(c.tipoExo) });
  abrir('O planeta');
  add('Tamanho', t(p.R < 2 ? '{n} vez o raio da Terra' : '{n} vezes o raio da Terra', { n: sig(p.R) }) + (p.est & 1 ? t(' (estimado pela massa)') : erro(x.eR)));
  add('Massa', t(p.M < 2 ? '{n} massa da Terra' : '{n} massas da Terra', { n: sig(p.M) }) + (p.est & 2 ? t(' (estimada pelo tamanho)') : erro(x.eM)));
  if (p.R < 6) add('Gravidade', t('cerca de {p} da Terra (estimada)', { p: `${num((p.M / p.R ** 2) * 100)}%` }));
  if (p.Teq) add('Temperatura de equilíbrio', `${String(Math.round(p.Teq - 273)).replace('-', '−')} °C`);
  abrir('A órbita');
  if (p.P) add('Ano', (p.P < 2 ? t('{n} horas', { n: sig(p.P * 24) }) : p.P < 1000 ? t('{n} dias', { n: sig(p.P) }) : t('{n} anos', { n: sig(p.P / 365.25) })) + (x.eP && p.P < 1000 ? ` (± ${m2(x.eP)} ${t('dias')})` : ''));
  add('Distância da estrela', t('{n} UA (a Terra está a 1)', { n: sig(p.a) }));
  if (p.e) add('Excentricidade', num(p.e, 3));
  const L = (est.raio / RAIO_SOL) ** 2 * (est.T / 5772) ** 4, S = L / p.a ** 2;
  add('Zona habitável', t(S > 1.107 ? 'mais perto da estrela que a zona habitável' : S >= 0.356 ? 'dentro da zona habitável: com atmosfera, poderia ter água líquida' : 'além da zona habitável'));
  abrir('A descoberta');
  add('Descoberta', t('{ano}, por {met}', { ano: p.ano, met: t({ 'Transit': 'trânsito', 'Radial Velocity': 'velocidade radial', 'Microlensing': 'microlente gravitacional', 'Imaging': 'imagem direta' }[p.met] ?? p.met) }) + (p.onde ? ` (${p.onde})` : ''));
  if (x.ref) add('Artigo da descoberta', x.ref);
  abrir('Agora');
  add('Da Terra', h.distancia(h.dTerra(c)));
  f.curiosidade = t('A aparência é ilustrativa: ninguém fotografou a superfície de um exoplaneta. Tamanho, massa e órbita são medidos.');
  f.fontes.push([t('{c} no NASA Exoplanet Archive', { c: p.n }), `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(p.n)}`]);
  if (x.ref && x.refu) f.fontes.push([x.ref, x.refu]);
}

function fichaGalaxia(c, f, abrir, add, h) {
  const cur = dados.corpos[c.id], d = tecnicos.galaxias[c.id] ?? {};
  f.tipo = cur?.tipo ? t(cur.tipo) : t(c.tipo === 'galaxia' ? 'galáxia' : 'lugar do universo');
  abrir('O lugar');
  add('Distância', h.distancia(h.dTerra(c)));
  if (c.raio && c.id !== 'borda' && c.id !== 'centro') add('Tamanho', t('cerca de {d} de diâmetro', { d: h.distancia(c.raio * 2) }));
  add('A luz que chega daqui saiu', h.anoLuzSaiu(h.dTerra(c)));
  abrir('A descoberta');
  if (d.descobertaAno) add('Descoberta', (d.descobertaAno === 'Antiguidade' ? '' : `${d.descobertaAno}, `) + (d.descobertaAno === 'Antiguidade' ? t(d.descobertaPor) : t('por {p}', { p: t(d.descobertaPor) })));
  f.curiosidade = cur?.curiosidade ? t(cur.curiosidade) : '';
  if (d.ned) f.fontes.push([t('{c} no NED (NASA/IPAC)', { c: c.nome }), d.ned]);
}

// A ficha como texto, para copiar e citar
export function textoFicha(f) {
  const l = [f.nome, f.tipo, ''];
  for (const [titulo, linhas] of f.secoes) {
    l.push(titulo.toUpperCase());
    for (const [k, v] of linhas) l.push(k === null ? v : `${k}: ${v}`);
    l.push('');
  }
  if (f.curiosidade) l.push(f.curiosidade, '');
  if (f.fontes.length) {
    l.push(t('Fontes') + (f.consultado ? ` (${t('consultadas em {d}', { d: new Date(f.consultado).toLocaleDateString(LOCALE, { timeZone: 'UTC' }) })})` : '') + ':');
    for (const [n, u] of f.fontes) l.push(u ? `- ${n}: ${u}` : `- ${n}`);
    l.push('');
  }
  l.push(`${t('Viagem pelo Espaço')}: https://giorgictr.github.io/viagem-pelo-espaco/`);
  return l.join('\n');
}
