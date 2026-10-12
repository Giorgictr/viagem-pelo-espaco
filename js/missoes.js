// Sondas espaciais e cometas com trajetórias reais (JPL Horizons): posição em qualquer data dentro do período
// com dados, propagando a órbita (dois corpos) entre os pontos tabelados; cometas com núcleo, coma e caudas;
// "momentos" marcantes de cada missão, com fotos reais (NASA e parceiros).
import * as THREE from '../vendor/three.module.js';
import { deltaT } from './corpos.js';

const UA = 1.495978707e8;
const jdDe = (iso) => Date.parse(iso) / 86400000 + 2440587.5;

// Momentos: data (UTC), título, texto, para onde olhar (corpo ou direção RA/Dec) e foto (dados/fotos/<id>.jpg)
export const MOMENTOS = {
  voyager1: [
    { iso: '1977-09-10T00:00Z', titulo: 'Logo depois do lançamento', texto: 'Lançada em 5 de setembro de 1977, a Voyager 1 parte rumo a Júpiter e Saturno.', olhar: 'terra' },
    { iso: '1979-03-05T12:05Z', titulo: 'Passagem por Júpiter', texto: 'Máxima aproximação de Júpiter, a 349 mil km do centro (cerca de 280 mil km das nuvens). A sonda descobre vulcões ativos em Io.', olhar: 'jupiter', foto: 'PIA00022', credito: 'NASA/JPL' },
    { iso: '1980-11-12T23:46Z', titulo: 'Passagem por Saturno', texto: 'Máxima aproximação de Saturno, depois de um sobrevoo próximo de Titã. A trajetória a lança para fora do plano dos planetas.', olhar: 'saturno', foto: 'PIA00024', credito: 'NASA/JPL' },
    { iso: '1990-02-14T04:48Z', titulo: 'O Pálido Ponto Azul', texto: 'A 6 bilhões de km, a Voyager 1 se vira e fotografa a Terra: um ponto de luz menor que um pixel, num raio de sol espalhado pela câmera.', olhar: 'terra', foto: 'PIA00452', credito: 'NASA/JPL-Caltech' },
    { iso: '2012-08-25T00:00Z', titulo: 'Saída da heliosfera', texto: 'Primeiro objeto humano a deixar a bolha do vento solar e entrar no espaço interestelar.', olhar: 'sol' },
  ],
  voyager2: [
    { iso: '1977-08-23T00:00Z', titulo: 'Logo depois do lançamento', texto: 'Lançada em 20 de agosto de 1977, antes da gêmea Voyager 1, por um caminho mais longo que visitaria os quatro gigantes.', olhar: 'terra' },
    { iso: '1979-07-09T22:29Z', titulo: 'Passagem por Júpiter', texto: 'Máxima aproximação de Júpiter, a 722 mil km do centro (cerca de 650 mil km das nuvens).', olhar: 'jupiter' },
    { iso: '1981-08-26T03:24Z', titulo: 'Passagem por Saturno', texto: 'Máxima aproximação de Saturno, a 101 mil km das nuvens.', olhar: 'saturno' },
    { iso: '1986-01-24T17:59Z', titulo: 'Urano, pela única vez', texto: 'A única sonda a visitar Urano passa a 81 mil km das nuvens e descobre 10 luas novas.', olhar: 'urano', foto: 'PIA18182', credito: 'NASA/JPL-Caltech' },
    { iso: '1989-08-25T03:56Z', titulo: 'Netuno e a Grande Mancha Escura', texto: 'A sonda passa a 4.950 km sobre o polo norte de Netuno, o ponto mais perto de qualquer planeta em toda a missão.', olhar: 'netuno', foto: 'PIA00049', credito: 'NASA/JPL' },
    { iso: '1989-08-25T09:10Z', titulo: 'Tritão', texto: 'Horas depois, a sonda fotografa Tritão, com gêiseres de nitrogênio.', olhar: 'tritao', foto: 'PIA01994', credito: 'NASA/JPL' },
    { iso: '2018-11-05T00:00Z', titulo: 'Saída da heliosfera', texto: 'Seis anos depois da gêmea, a Voyager 2 também entra no espaço interestelar.', olhar: 'sol' },
  ],
  pioneer10: [
    { iso: '1973-12-04T02:26Z', titulo: 'Primeira sonda em Júpiter', texto: 'A Pioneer 10 é a primeira a atravessar o cinturão de asteroides e a visitar Júpiter, a 132 mil km das nuvens.', olhar: 'jupiter', foto: 'ARC-1973-AC73-9253', credito: 'NASA Ames' },
    { iso: '1983-06-13T00:00Z', titulo: 'Além da órbita de Netuno', texto: 'Primeiro objeto humano a passar da distância dos planetas. O último sinal foi recebido em 2003; a trajetória daí em diante é calculada.', olhar: 'sol' },
  ],
  newhorizons: [
    { iso: '2007-02-28T05:43Z', titulo: 'Atalho por Júpiter', texto: 'Júpiter acelera a sonda em 14 mil km/h e encurta a viagem até Plutão em três anos.', olhar: 'jupiter' },
    { iso: '2015-07-14T11:49Z', titulo: 'Plutão de perto', texto: 'A 12.500 km de Plutão, a sonda revela o "coração" de gelo de nitrogênio e montanhas de gelo de água.', olhar: 'plutao', foto: 'PIA19952', credito: 'NASA/JHUAPL/SwRI' },
    { iso: '2015-07-14T12:03Z', titulo: 'Caronte', texto: 'Logo depois, Caronte, a maior lua de Plutão, com uma região polar avermelhada.', olhar: 'caronte', foto: 'PIA19968', credito: 'NASA/JHUAPL/SwRI' },
  ],
  cassini: [
    { iso: '1999-08-18T03:28Z', titulo: 'Impulso da Terra', texto: 'Para ganhar velocidade, a Cassini passa a 1.171 km da Terra.', olhar: 'terra' },
    { iso: '2000-12-30T10:05Z', titulo: 'Passagem por Júpiter', texto: 'Mais um impulso, agora de Júpiter, a caminho de Saturno.', olhar: 'jupiter' },
    { iso: '2004-10-06T00:00Z', titulo: 'O retrato de Saturno', texto: 'Já em órbita, a Cassini compõe um dos maiores retratos de Saturno e seus anéis.', olhar: 'saturno', foto: 'PIA06193', credito: 'NASA/JPL/Space Science Institute' },
    { iso: '2012-03-01T00:00Z', titulo: 'Os jatos de Encélado', texto: 'Jatos de vapor e gelo saem do polo sul de Encélado, sinal de um oceano sob o gelo.', olhar: 'encelado', foto: 'PIA14599', credito: 'NASA/JPL-Caltech/Space Science Institute' },
    { iso: '2013-07-19T21:27Z', titulo: 'O dia em que a Terra sorriu', texto: 'Na sombra de Saturno, a Cassini fotografa o planeta contra o Sol, com a Terra como um ponto azul entre os anéis.', olhar: 'saturno', foto: 'PIA17172', credito: 'NASA/JPL-Caltech/Space Science Institute' },
    { iso: '2017-09-15T10:31Z', titulo: 'Mergulho final', texto: 'A Cassini mergulha na atmosfera de Saturno, de propósito, para não contaminar luas que podem ter vida.', olhar: 'saturno' },
  ],
  juno: [
    { iso: '2013-10-09T19:21Z', titulo: 'Impulso da Terra', texto: 'A Juno passa a 559 km da Terra para ganhar velocidade rumo a Júpiter.', olhar: 'terra' },
    { iso: '2016-07-05T03:53Z', titulo: 'Chegada a Júpiter', texto: 'Entrada em órbita polar: a primeira sonda a ver os polos de Júpiter de perto.', olhar: 'jupiter' },
    { iso: '2017-02-02T12:57Z', titulo: 'Júpiter visto de baixo', texto: 'O polo sul de Júpiter, com ciclones do tamanho da Terra.', olhar: 'jupiter', foto: 'PIA21381', credito: 'NASA/JPL-Caltech/SwRI/MSSS/Gabriel Fiset' },
    { iso: '2017-07-11T02:06Z', titulo: 'A Grande Mancha Vermelha', texto: 'Passagem direta sobre a Grande Mancha Vermelha, a cerca de 9 mil km das nuvens, minutos depois do ponto mais baixo da órbita. Na foto, a mesma tempestade vista pela Voyager 1 em 1979: ela já era observada havia mais de 150 anos.', olhar: 'jupiter', foto: 'PIA00014', credito: 'NASA/JPL (foto da Voyager 1, 1979)' },
    { iso: '2021-06-07T16:56Z', titulo: 'Ganimedes', texto: 'A maior lua do Sistema Solar, a 1.038 km.', olhar: 'ganimedes', foto: 'PIA24681', credito: 'NASA/JPL-Caltech/SwRI/MSSS' },
  ],
  parker: [
    { iso: '2018-08-14T00:00Z', titulo: 'Logo depois do lançamento', texto: 'A sonda mais rápida já construída parte para "tocar" o Sol.', olhar: 'sol' },
    { iso: '2024-12-24T11:53Z', titulo: 'Recorde de aproximação do Sol', texto: 'A 6,1 milhões de km da superfície do Sol, a cerca de 690 mil km/h: o objeto humano mais rápido da história.', olhar: 'sol' },
  ],
  jwst: [
    { iso: '2022-01-24T19:00Z', titulo: 'Chegada ao ponto L2', texto: 'O telescópio chega à sua órbita, a 1,5 milhão de km da Terra, sempre de costas para o Sol.', olhar: 'terra' },
    { iso: '2022-07-12T14:30Z', titulo: 'Primeiro campo profundo', texto: 'Milhares de galáxias atrás do aglomerado SMACS 0723: a luz mais antiga já vista em tantos detalhes.', olharRaDec: [110.84, -73.45], foto: 'webb_first_deep_field', credito: 'NASA, ESA, CSA, STScI' },
    { iso: '2022-07-12T15:00Z', titulo: 'Os Penhascos Cósmicos de Carina', texto: 'A borda de uma região de formação de estrelas na Nebulosa de Carina, a 7.600 anos-luz.', olharRaDec: [161.27, -59.87], foto: 'carina_nebula', credito: 'NASA, ESA, CSA, STScI' },
  ],
  rosetta: [
    { iso: '2014-08-06T09:00Z', titulo: 'Chegada ao cometa 67P', texto: 'Depois de dez anos, a Rosetta passa a acompanhar o cometa: a primeira sonda a orbitar um.', olhar: '67p', foto: 'PIA19093', credito: 'ESA/Rosetta/NAVCAM (CC BY-SA IGO 3.0), dezembro de 2014' },
    { iso: '2016-09-30T10:39Z', titulo: 'Pouso final', texto: 'A Rosetta encerra a missão descendo suavemente sobre o núcleo do cometa.', olhar: '67p' },
  ],
  pioneer11: [
    { iso: '1974-12-03T05:22Z', titulo: 'Passagem por Júpiter', texto: 'A 43 mil km das nuvens, três vezes mais perto que a Pioneer 10; a gravidade de Júpiter a lança rumo a Saturno.', olhar: 'jupiter' },
    { iso: '1979-09-01T16:31Z', titulo: 'A primeira visita a Saturno', texto: 'Primeira sonda a passar por Saturno, a 21 mil km das nuvens. Descobre o anel F e abre caminho para as Voyager.', olhar: 'saturno' },
  ],
  galileo: [
    { iso: '1990-02-10T05:59Z', titulo: 'Passagem por Vênus', texto: 'A primeira das três manobras de gravidade (Vênus, Terra, Terra) que levaram a Galileo até Júpiter.', olhar: 'venus' },
    { iso: '1990-12-08T20:34Z', titulo: 'De volta à Terra', texto: 'Passagem a 960 km da Terra. A sonda procura sinais de vida na Terra como se fosse um planeta desconhecido, e encontra.', olhar: 'terra' },
    { iso: '1994-07-20T00:00Z', titulo: 'O cometa que caiu em Júpiter', texto: 'Ainda a caminho, a Galileo vê diretamente os fragmentos do cometa Shoemaker-Levy 9 caírem no lado noturno de Júpiter.', olhar: 'jupiter' },
    { iso: '1995-12-07T22:04Z', titulo: 'Chegada a Júpiter', texto: 'Primeira sonda a orbitar Júpiter. No mesmo dia, uma cápsula mergulha na atmosfera do planeta.', olhar: 'jupiter' },
    { iso: '2003-09-21T18:57Z', titulo: 'Mergulho final', texto: 'Para não contaminar Europa, que pode ter um oceano com vida, a Galileo é lançada contra Júpiter.', olhar: 'jupiter' },
  ],
  ulysses: [
    { iso: '1992-02-08T12:02Z', titulo: 'Júpiter muda o rumo', texto: 'A gravidade de Júpiter tira a Ulysses do plano dos planetas e a põe numa órbita que passa por cima dos polos do Sol.', olhar: 'jupiter' },
    { iso: '1994-09-13T00:00Z', titulo: 'Sobre o polo sul do Sol', texto: 'Pela primeira vez, uma sonda observa o Sol de cima de um dos polos.', olhar: 'sol' },
    { iso: '1995-07-31T00:00Z', titulo: 'Sobre o polo norte do Sol', texto: 'Menos de um ano depois, o outro polo.', olhar: 'sol' },
  ],
  messenger: [
    { iso: '2008-01-14T19:04Z', titulo: 'Primeira passagem por Mercúrio', texto: 'A 200 km da superfície: a primeira visita a Mercúrio desde a Mariner 10, 33 anos antes.', olhar: 'mercurio' },
    { iso: '2011-03-18T01:00Z', titulo: 'Em órbita de Mercúrio', texto: 'Primeira sonda a orbitar o planeta mais próximo do Sol. Encontra gelo de água no fundo das crateras dos polos.', olhar: 'mercurio' },
    { iso: '2015-04-30T19:26Z', titulo: 'O fim', texto: 'Sem combustível, a MESSENGER cai em Mercúrio a 14 mil km/h, abrindo uma cratera de uns 16 metros.', olhar: 'mercurio' },
  ],
  dawn: [
    { iso: '2009-02-17T23:28Z', titulo: 'Passagem por Marte', texto: 'Uma manobra de gravidade a caminho do cinturão de asteroides.', olhar: 'marte' },
    { iso: '2011-07-16T00:00Z', titulo: 'Chegada a Vesta', texto: 'A Dawn passa a orbitar Vesta, o segundo maior corpo do cinturão de asteroides, por mais de um ano.' },
    { iso: '2015-03-06T12:00Z', titulo: 'Chegada a Ceres', texto: 'Primeira sonda a orbitar dois corpos diferentes, e a primeira a visitar um planeta anão. Ceres tem manchas brilhantes de sal.' },
  ],
  stardust: [
    { iso: '2004-01-02T19:22Z', titulo: 'Poeira do cometa Wild 2', texto: 'A 240 km do núcleo, a sonda recolhe poeira do cometa num bloco de aerogel.' },
    { iso: '2006-01-15T10:12Z', titulo: 'A cápsula volta à Terra', texto: 'A cápsula com a poeira pousa em Utah: as primeiras amostras de um cometa trazidas à Terra.', olhar: 'terra' },
  ],
  deepimpact: [
    { iso: '2005-07-04T05:52Z', titulo: 'Impacto no cometa Tempel 1', texto: 'Um projétil de 370 kg atinge o cometa a 37 mil km/h, e a sonda fotografa a nuvem de material lançada do interior.' },
    { iso: '2010-11-04T13:50Z', titulo: 'Cometa Hartley 2', texto: 'Na missão estendida, a sonda passa pelo pequeno cometa Hartley 2, que solta jatos de gelo de dióxido de carbono.' },
  ],
  hayabusa2: [
    { iso: '2018-06-27T00:00Z', titulo: 'Chegada a Ryugu', texto: 'A sonda japonesa alcança o asteroide Ryugu, um "pião" escuro de menos de 1 km.' },
    { iso: '2019-04-05T02:00Z', titulo: 'Uma cratera artificial', texto: 'Um projétil abre uma cratera em Ryugu para expor material de baixo da superfície; depois, a sonda o recolhe.' },
    { iso: '2020-12-05T17:30Z', titulo: 'Amostras de volta', texto: 'A cápsula pousa na Austrália com 5 gramas de Ryugu. A sonda segue viagem para outros asteroides.', olhar: 'terra' },
  ],
  osirisrex: [
    { iso: '2018-12-03T00:00Z', titulo: 'Chegada a Bennu', texto: 'A sonda alcança o asteroide Bennu, que tem uma pequena chance de atingir a Terra no século 22.' },
    { iso: '2020-10-20T22:08Z', titulo: 'O toque', texto: 'A sonda toca Bennu por alguns segundos. O solo, mais fofo que o esperado, quase a engole.' },
    { iso: '2023-09-24T14:52Z', titulo: 'Amostras de volta', texto: 'A cápsula pousa em Utah com cerca de 120 gramas de Bennu. A sonda segue rumo ao asteroide Apophis, com o nome OSIRIS-APEX.', olhar: 'terra' },
  ],
  dart: [
    { iso: '2022-09-26T23:14Z', titulo: 'Impacto em Dimorphos', texto: 'O primeiro teste de defesa planetária: a DART colide com a pequena lua Dimorphos e encurta a órbita dela em 32 minutos.' },
  ],
  lucy: [
    { iso: '2022-10-16T11:04Z', titulo: 'Passagem pela Terra', texto: 'A 350 km de altitude, mais baixo que a ISS, ganhando impulso rumo ao cinturão de asteroides e aos troianos de Júpiter.', olhar: 'terra' },
    { iso: '2023-11-01T16:54Z', titulo: 'Dinkinesh e uma surpresa', texto: 'No primeiro asteroide visitado, uma surpresa: uma lua formada por duas partes encostadas.' },
    { iso: '2025-04-20T17:51Z', titulo: 'Donaldjohanson', texto: 'Asteroide batizado em homenagem ao descobridor do fóssil "Lucy", que dá nome à missão.' },
  ],
  psyche: [
    { iso: '2023-10-14T00:00Z', titulo: 'A caminho de um mundo de metal', texto: 'A sonda segue para o asteroide Psyche, que pode ser o núcleo de metal de um planeta que não chegou a se formar. Chegada prevista para 2029.' },
  ],
  juice: [
    { iso: '2024-08-19T21:16Z', titulo: 'Lua e Terra em seguida', texto: 'A primeira dupla manobra de gravidade da história: a sonda passa pela Lua e, um dia depois, pela Terra.', olhar: 'terra' },
    { iso: '2025-08-31T05:28Z', titulo: 'Passagem por Vênus', texto: 'Mais impulso a caminho de Júpiter, onde chega em 2031 para estudar Ganimedes, Calisto e Europa.', olhar: 'venus' },
  ],
  europaclipper: [
    { iso: '2025-03-01T17:57Z', titulo: 'Passagem por Marte', texto: 'A 884 km da superfície, a sonda ganha impulso e testa as câmeras. Chega a Júpiter em 2030.', olhar: 'marte' },
    { iso: '2026-12-03T00:00Z', titulo: 'De volta à Terra', texto: 'A última manobra de gravidade antes de seguir para Júpiter e para Europa, a lua que pode esconder um oceano.', olhar: 'terra' },
  ],
  bepicolombo: [
    { iso: '2021-10-01T23:34Z', titulo: 'Primeira passagem por Mercúrio', texto: 'A 199 km da superfície. A missão europeia e japonesa usa seis passagens por Mercúrio para conseguir entrar em órbita.', olhar: 'mercurio' },
    { iso: '2025-01-08T05:59Z', titulo: 'Sexta e última passagem', texto: 'A sonda fotografa os polos de Mercúrio antes da chegada definitiva.', olhar: 'mercurio' },
  ],
  solarorbiter: [
    { iso: '2022-03-26T00:00Z', titulo: 'Perto do Sol', texto: 'A 48 milhões de km do Sol, mais perto que Mercúrio, com um escudo térmico que aguenta 500 °C.', olhar: 'sol' },
    { iso: '2025-03-20T00:00Z', titulo: 'Os polos do Sol', texto: 'Com a órbita inclinada, as primeiras imagens dos polos do Sol, onde nasce o ciclo das manchas solares.', olhar: 'sol' },
  ],
  artemis1: [
    { iso: '2022-11-21T12:57Z', titulo: 'Rasante na Lua', texto: 'A cápsula Orion, sem tripulação, passa a 130 km da superfície da Lua.', olhar: 'lua' },
    { iso: '2022-11-28T20:00Z', titulo: 'Mais longe que nunca', texto: 'A 432 mil km da Terra: a maior distância já alcançada por uma nave feita para levar pessoas.', olhar: 'terra' },
    { iso: '2022-12-05T16:43Z', titulo: 'Segunda passagem pela Lua', texto: 'A manobra que põe a Orion no caminho de volta.', olhar: 'lua' },
    { iso: '2022-12-11T17:00Z', titulo: 'De volta', texto: 'A cápsula entra na atmosfera a 40 mil km/h e pousa no Pacífico.', olhar: 'terra' },
  ],
  gaia: [
    { iso: '2016-09-14T00:00Z', titulo: 'O mapa da galáxia', texto: 'Do ponto L2, a 1,5 milhão de km da Terra, o Gaia mede a posição e a distância de quase 2 bilhões de estrelas. Parte das estrelas desta simulação vem dele.' },
  ],
  soho: [
    { iso: '1996-05-01T00:00Z', titulo: 'Vigiando o Sol', texto: 'Do ponto L1, entre a Terra e o Sol, a SOHO observa o Sol sem parar há décadas, e já descobriu mais de 5 mil cometas.', olhar: 'sol' },
  ],
  kepler: [
    { iso: '2011-12-05T00:00Z', titulo: 'Planetas por toda parte', texto: 'O Kepler vigia 150 mil estrelas ao mesmo tempo, à espera da leve queda de brilho quando um planeta passa na frente. Encontrou mais de 2.600 planetas.' },
  ],
  spitzer: [
    { iso: '2017-02-22T00:00Z', titulo: 'Os sete planetas de TRAPPIST-1', texto: 'O telescópio infravermelho confirma sete planetas do tamanho da Terra em volta da pequena estrela TRAPPIST-1.' },
  ],
  halley: [
    { iso: '1986-03-14T00:00Z', titulo: 'A visita de 1986', texto: 'Na passagem de 1986, várias sondas visitaram o Halley; a europeia Giotto fotografou o núcleo de perto. Na foto, o cometa visto da Terra em 8 de março de 1986.', olhar: 'cometa', foto: 'halley_lspn', credito: 'NASA/W. Liller (International Halley Watch)' },
    { iso: '2061-07-28T00:00Z', titulo: 'Próxima volta, em 2061', texto: 'O Halley volta a cada ~76 anos. A próxima passagem perto do Sol será em julho de 2061.', olhar: 'cometa' },
  ],
  halebopp: [
    { iso: '1997-04-01T00:00Z', titulo: 'O Grande Cometa de 1997', texto: 'Visível a olho nu por 18 meses, um recorde. Fotografado aqui do ônibus espacial.', olhar: 'cometa', foto: 'sts083-507-023', credito: 'NASA' },
  ],
  neowise: [
    { iso: '2020-07-05T00:00Z', titulo: 'NEOWISE sobre a Estação Espacial', texto: 'O cometa mais brilhante do hemisfério norte desde o Hale-Bopp, fotografado em julho de 2020.', olhar: 'cometa', foto: 'NHQ202007180001', credito: 'NASA/Bill Ingalls' },
  ],
  '67p': [
    { iso: '2015-08-13T02:03Z', titulo: 'Periélio, com a Rosetta ao lado', texto: 'O ponto da órbita mais perto do Sol, quando o cometa ficou mais ativo.', olhar: 'cometa' },
  ],
  atlas3i: [
    { iso: '2025-07-01T00:00Z', titulo: 'Descoberta', texto: 'O terceiro objeto interestelar já visto, vindo de fora do Sistema Solar numa órbita aberta (hiperbólica).', olhar: 'cometa' },
    { iso: '2025-10-29T00:00Z', titulo: 'Periélio', texto: 'O ponto mais perto do Sol; depois disso, ele vai embora para sempre.', olhar: 'cometa' },
  ],
};

// Cometas: raio do núcleo (km), magnitude absoluta H e atividade da cauda
const COMETAS = { halley: [5.5, 5.5, 2], halebopp: [30, -0.8, 6], neowise: [2.5, 6.5, 1.5], '67p': [2.0, 11, 0.2], atlas3i: [2.8, 11.5, 0.5] };

// ------------------------------- propagação orbital (dois corpos, variável universal) -------------------------------
const stumpS = (z) => (z > 1e-8 ? (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / Math.sqrt(z) ** 3 : z < -1e-8 ? (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / Math.sqrt(-z) ** 3 : 1 / 6);
const stumpC = (z) => (z > 1e-8 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-8 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : 0.5);
function propagar(r, v, dt, mu, out) {
  const r0 = Math.hypot(r[0], r[1], r[2]), v0 = Math.hypot(v[0], v[1], v[2]);
  // gravidade desprezível no intervalo (ex.: Plutão visto por uma sonda rápida): movimento retilíneo
  if (!mu || dt === 0 || (mu * dt * dt) / (r0 * r0 * r0) < 1e-7) return out.set(r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt);
  const vr0 = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / r0, sm = Math.sqrt(mu);
  const alfa = 2 / r0 - (v0 * v0) / mu;
  let x = sm * Math.abs(alfa) * dt;
  if (alfa < -1e-12) {
    // órbita hiperbólica (sobrevoo): chute inicial de Vallado, que converge bem mais
    const a = 1 / alfa, sg = Math.sign(dt), rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    const arg = (-2 * mu * alfa * dt) / (rv + sg * Math.sqrt(-mu * a) * (1 - r0 * alfa));
    if (arg > 0) x = sg * Math.sqrt(-a) * Math.log(arg);
  }
  let convergiu = false;
  for (let i = 0; i < 60; i++) {
    const z = alfa * x * x, C = stumpC(z), S = stumpS(z);
    const F = ((r0 * vr0) / sm) * x * x * C + (1 - alfa * r0) * x ** 3 * S + r0 * x - sm * dt;
    const dF = ((r0 * vr0) / sm) * x * (1 - alfa * x * x * S) + (1 - alfa * r0) * x * x * C + r0;
    const passo = F / dF;
    x -= passo;
    if (Math.abs(passo) < 1e-9 * Math.max(1, Math.abs(x))) { convergiu = true; break; }
  }
  if (!convergiu || !Number.isFinite(x)) return out.set(r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt);
  const z = alfa * x * x, f = 1 - ((x * x) / r0) * stumpC(z), g = dt - (x ** 3 / sm) * stumpS(z);
  if (!Number.isFinite(f) || !Number.isFinite(g)) return out.set(r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt); // nunca devolve NaN
  out.set(f * r[0] + g * v[0], f * r[1] + g * v[1], f * r[2] + g * v[2]);
  // conferência: o resultado não pode cair absurdamente longe do caminho em linha reta
  const lx = r[0] + v[0] * dt - out.x, ly = r[1] + v[1] * dt - out.y, lz = r[2] + v[2] * dt - out.z;
  if (Math.hypot(lx, ly, lz) > 2 * v0 * Math.abs(dt) + r0) return out.set(r[0] + v[0] * dt, r[1] + v[1] * dt, r[2] + v[2] * dt);
  return out;
}

// ------------------------------- caudas dos cometas (calculadas na GPU) -------------------------------
const CAUDA_V = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 param; // t ao longo da cauda, desvio lateral 1 e 2, tipo (0 poeira, 1 gás)
  uniform vec3 nucleo, antiSol, contraVel; uniform float comprimento, R0, escalaPx, brilho, pxPorRad;
  varying float vAlfa; varying float vTipo;
  void main() {
    float t = param.x;
    vec3 eixo = normalize(antiSol + (param.w < 0.5 ? contraVel * t * 0.9 : vec3(0.0))); // a poeira se curva para trás
    vec3 lado1 = normalize(cross(eixo, abs(eixo.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 lado2 = cross(eixo, lado1);
    float abre = (param.w < 0.5 ? 0.09 : 0.03) * t * comprimento + comprimento * 0.004;
    vec3 w = nucleo + eixo * t * comprimento + (lado1 * param.y + lado2 * param.z) * abre;
    float d = max(length(w), 1e-6);
    float s = d <= R0 ? 1.0 : R0 * (1.0 + log(d / R0)) / d;
    vAlfa = brilho * (1.0 - t) * (1.0 - t) * (param.w < 0.5 ? 1.0 : 0.7) * smoothstep(0.0, 0.004, t); // a cabeça fica por conta da coma
    vTipo = param.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w * s, 1.0);
    // cada partícula vira uma mancha suave do tamanho da largura local da cauda (brilho total conservado)
    float px = clamp(abre * 1.6 / d * pxPorRad, 2.0, 22.0);
    vAlfa *= max(0.12, min(1.0, 9.0 / (px * px)));
    gl_PointSize = px * escalaPx;
    #include <logdepthbuf_vertex>
  }`;
const CAUDA_F = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying float vAlfa; varying float vTipo;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    vec3 cor = vTipo < 0.5 ? vec3(1.0, 0.92, 0.78) : vec3(0.55, 0.75, 1.0);
    gl_FragColor = vec4(cor * vAlfa * exp(-r * r * 3.0) * (1.0 - r), 1.0);
  }`;

let _texComa = null;
function texturaComa() {
  if (_texComa) return _texComa;
  const N = 128, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return (_texComa = new THREE.CanvasTexture(cv));
}
// raio da coma (km): cresce perto do Sol e com a atividade do cometa
export const raioComa = (o, rUA) => (rUA > 5 ? 0 : Math.min(2e5, 2.5e4 * o.atividade / rUA ** 1.5));

function criarCauda(cena) {
  const N = 5000, p = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const tipo = i < N * 0.65 ? 0 : 1, t = Math.random() ** 1.6;
    const ang = Math.random() * Math.PI * 2, raio = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * 0.6;
    p.set([t, Math.cos(ang) * raio, Math.sin(ang) * raio, tipo], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('param', new THREE.BufferAttribute(p, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: CAUDA_V, fragmentShader: CAUDA_F,
    uniforms: {
      nucleo: { value: new THREE.Vector3() }, antiSol: { value: new THREE.Vector3(1, 0, 0) }, contraVel: { value: new THREE.Vector3() },
      comprimento: { value: 1 }, R0: { value: 1e8 }, escalaPx: { value: 1 }, brilho: { value: 0 }, pxPorRad: { value: 1000 },
    },
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  cena.add(pts);
  return pts;
}

// ------------------------------- carga e cálculo -------------------------------
export function criarMissoes(cena, PORID, materialRochoso) {
  const objetos = [], porId = {};
  const pronto = (async () => {
    const indice = await (await fetch('dados/missoes/indice.json')).json();
    const fotos = await (await fetch('dados/fotos/indice.json')).json().catch(() => ({}));
    for (const it of indice) {
      const dados = new Float64Array(await (await fetch(`dados/missoes/${it.id}.bin`)).arrayBuffer());
      // o JPL dá os instantes em tempo dinâmico (TDB); a simulação conta em tempo civil (UT): ~1 minuto de diferença hoje
      for (let k = 0; k < dados.length; k += 7) dados[k] -= deltaT(dados[k]) / 86400;
      for (const sg of it.segmentos) { sg.jd0 -= deltaT(sg.jd0) / 86400; sg.jd1 -= deltaT(sg.jd1) / 86400; }
      const o = {
        ...it, dados, abs: new THREE.Vector3(), ativo: false, vel: new THREE.Vector3(), jd0: Infinity, jd1: -Infinity,
        raio: it.tipo === 'cometa' ? COMETAS[it.id][0] : 0.005, cor: it.tipo === 'cometa' ? 0xcfe3ff : 0xffe0a0,
        momentos: (MOMENTOS[it.id] || []).map((m) => ({ ...m, jd: jdDe(m.iso), fotoInfo: m.foto ? fotos[m.foto] : null })),
        qOri: new THREE.Quaternion(), qOriAnt: new THREE.Quaternion(),
      };
      for (const s of it.segmentos) { o.jd0 = Math.min(o.jd0, s.jd0); o.jd1 = Math.max(o.jd1, s.jd1); }
      if (it.tipo === 'cometa') {
        const [raio, H, atividade] = COMETAS[it.id];
        o.H = H; o.atividade = atividade;
        o.malha = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), materialRochoso.clone());
        o.malha.material.uniforms.corBase.value = new THREE.Color(0x6a655e); // escuro como os núcleos reais, mas visível
        o.malha.material.uniforms.temMapa.value = 0;
        o.malha.material.uniforms.detalhe.value = 0;
        o.malha.material.uniforms.raio.value = raio;
        o.malha.visible = false;
        cena.add(o.malha);
        o.cauda = criarCauda(cena);
        o.coma = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaComa(), color: 0xcfe6ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        o.coma.renderOrder = 3;
        o.coma.visible = false;
        cena.add(o.coma);
      }
      objetos.push(o);
      porId[it.id] = o;
    }
  })();

  const _r = [0, 0, 0], _v = [0, 0, 0], _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function centroAbs(nome) { return nome === '67p' ? porId['67p']?.abs : PORID[nome]?.abs; }
  // posição (ecliptica J2000, km) relativa ao centro do segmento, por propagação a partir dos pontos vizinhos
  function noSegmento(o, s, jd, out) {
    const d = o.dados, i0 = s.inicio, n = s.n;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[(i0 + m) * 7] <= jd) lo = m; else hi = m; }
    const k1 = (i0 + lo) * 7, k2 = (i0 + hi) * 7, t1 = d[k1], t2 = d[k2];
    const u = Math.min(Math.max((jd - t1) / (t2 - t1 || 1), 0), 1);
    if (s.modo === 'hermite') {
      const h = (t2 - t1) * 86400, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      return out.set(...[0, 1, 2].map((c) => h00 * d[k1 + 1 + c] + h10 * h * d[k1 + 4 + c] + h01 * d[k2 + 1 + c] + h11 * h * d[k2 + 4 + c]));
    }
    for (let c = 0; c < 3; c++) { _r[c] = d[k1 + 1 + c]; _v[c] = d[k1 + 4 + c]; }
    propagar(_r, _v, (jd - t1) * 86400, s.gm, _a);
    for (let c = 0; c < 3; c++) { _r[c] = d[k2 + 1 + c]; _v[c] = d[k2 + 4 + c]; }
    propagar(_r, _v, (jd - t2) * 86400, s.gm, _b);
    const w = u * u * (3 - 2 * u); // as duas propagações se encontram suavemente
    return out.copy(_a).lerp(_b, w);
  }
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _h = new THREE.Vector3();
  // Perto de um planeta, o trecho medido em relação a ele casa com o planeta desenhado (cujas posições são
  // aproximadas); longe, vale o trecho em torno do Sol. Entre um e outro, a posição passa de um ao outro aos poucos.
  function posicao(o, jd, out) {
    let seg = null, sol = null;
    for (const s of o.segmentos) {
      if (!(jd >= s.jd0 && jd <= s.jd1)) continue;
      if (s.centro === 'sol') sol = s; else if (!seg) seg = s;
    }
    if (!seg && !sol) {
      // buraco de poucas horas entre trechos: usa o trecho mais próximo, propagando a partir da ponta
      let perto = null, dmin = 1.5;
      for (const s of o.segmentos) { const dd = jd < s.jd0 ? s.jd0 - jd : jd - s.jd1; if (dd < dmin) { dmin = dd; perto = s; } }
      if (!perto) return false;
      if (perto.centro === 'sol') sol = perto; else seg = perto;
    }
    if (seg) {
      const c = centroAbs(seg.centro);
      if (!c) return false;
      noSegmento(o, seg, jd, _p);
      out.set(_p.x, _p.z, -_p.y).add(c);
      if (sol) {
        const borda = Math.min(10, (seg.jd1 - seg.jd0) * 0.3);
        const w = Math.min(Math.max(Math.min(jd - seg.jd0, seg.jd1 - jd) / borda, 0), 1);
        if (w < 1) {
          noSegmento(o, sol, jd, _h);
          out.lerp(_q.set(_h.x, _h.z, -_h.y), 1 - w * w * (3 - 2 * w));
        }
      }
      return true;
    }
    noSegmento(o, sol, jd, _p);
    out.set(_p.x, _p.z, -_p.y);
    return true;
  }

  // velocidade (km/s) do centro do trecho em uso, para somar à velocidade relativa da sonda
  function deslocPlanetas(jd) {
    return (o, j) => {
      const seg = o.segmentos.find((s) => s.centro !== 'sol' && j >= s.jd0 && j <= s.jd1);
      return seg && velPlaneta ? velPlaneta(seg.centro, j) : new THREE.Vector3();
    };
  }
  let velPlaneta = null;
  return {
    usarVelPlaneta(f) { velPlaneta = f; },
    pronto, objetos, porId,
    atualizar(jd) {
      for (const pass of [0, 1]) for (const o of objetos) {
        const depende67p = o.segmentos.some((s) => s.centro === '67p');
        if ((pass === 0) === depende67p) continue;
        o.ativo = posicao(o, jd, o.abs);
        if (o.ativo) {
          // velocidade em relação ao Sol: inclui o movimento do planeta no caso dos trechos de sobrevoo
          const p0 = o.abs.clone();
          const deslocCentro = deslocPlanetas(jd, 60);
          if (posicao(o, jd + 60 / 86400, _q)) o.vel.copy(_q).sub(p0).divideScalar(60).add(deslocCentro(o, jd));
        }
      }
    },
    // cometas: núcleo, brilho (magnitude) e caudas; devolve a magnitude para o marcador
    desenharCometa(o, rel, d, s, solAbs, pxPorRad, escalaPx, diaNoCeu) {
      const r = o.abs.distanceTo(solAbs) / UA;
      o.malha.visible = o.ativo;
      if (o.ativo) {
        o.malha.position.copy(rel).multiplyScalar(s);
        o.malha.scale.setScalar(o.raio * s);
        const u = o.malha.material.uniforms;
        u.luz.value.copy(solAbs).sub(o.abs).normalize();
        u.kmPorUnidade.value = 1 / s;
      }
      const ativo = o.ativo && r < 5;
      o.cauda.visible = ativo;
      const rc = raioComa(o, r);
      o.coma.visible = ativo && rc > 0;
      if (o.coma.visible) {
        o.coma.position.copy(rel).multiplyScalar(s);
        o.coma.scale.setScalar(rc * 2 * s);
        o.coma.material.opacity = Math.min(1, 0.9 / r) * (1 - diaNoCeu);
      }
      if (ativo) {
        const L = Math.min(1.6e7 * o.atividade / (r * r), 1.5e8) * Math.max(0, 1 - r / 5);
        const u = o.cauda.material.uniforms;
        u.nucleo.value.copy(rel);
        u.antiSol.value.copy(o.abs).sub(solAbs).normalize();
        u.contraVel.value.copy(o.vel).negate().normalize();
        u.comprimento.value = L;
        u.escalaPx.value = escalaPx;
        u.pxPorRad.value = pxPorRad;
        u.brilho.value = 1.6 * Math.min(1, 2 / r) * (1 - diaNoCeu);
      }
      const delta = Math.max(d / UA, 1e-6);
      return o.H + 5 * Math.log10(delta) + 10 * Math.log10(Math.max(r, 0.05)); // magnitude total do cometa
    },
  };
}
