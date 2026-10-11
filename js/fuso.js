// Hora oficial de um lugar: descobre o fuso (zona IANA) pela cidade mais próxima — estado no Brasil, país e,
// nos países com vários fusos, a longitude — e deixa o navegador calcular o deslocamento daquela data,
// com o histórico real de fusos e horários de verão.
const semAcento = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const BRASIL = {
  acre: 'America/Rio_Branco', amazonas: 'America/Manaus', roraima: 'America/Boa_Vista', rondonia: 'America/Porto_Velho',
  'mato grosso': 'America/Cuiaba', 'mato grosso do sul': 'America/Campo_Grande', para: 'America/Belem', amapa: 'America/Belem',
  tocantins: 'America/Araguaina', maranhao: 'America/Fortaleza', piaui: 'America/Fortaleza', ceara: 'America/Fortaleza',
  'rio grande do norte': 'America/Fortaleza', paraiba: 'America/Fortaleza', pernambuco: 'America/Recife', alagoas: 'America/Maceio',
  sergipe: 'America/Maceio', bahia: 'America/Bahia',
};
const PAISES = {
  portugal: 'Europe/Lisbon', espanha: 'Europe/Madrid', franca: 'Europe/Paris', 'reino unido': 'Europe/London', irlanda: 'Europe/Dublin',
  alemanha: 'Europe/Berlin', italia: 'Europe/Rome', 'paises baixos': 'Europe/Amsterdam', belgica: 'Europe/Brussels', suica: 'Europe/Zurich',
  austria: 'Europe/Vienna', polonia: 'Europe/Warsaw', suecia: 'Europe/Stockholm', noruega: 'Europe/Oslo', dinamarca: 'Europe/Copenhagen',
  finlandia: 'Europe/Helsinki', grecia: 'Europe/Athens', turquia: 'Europe/Istanbul', ucrania: 'Europe/Kyiv', romenia: 'Europe/Bucharest',
  hungria: 'Europe/Budapest', 'republica checa': 'Europe/Prague', chequia: 'Europe/Prague', egito: 'Africa/Cairo', 'africa do sul': 'Africa/Johannesburg',
  nigeria: 'Africa/Lagos', quenia: 'Africa/Nairobi', marrocos: 'Africa/Casablanca', angola: 'Africa/Luanda', mocambique: 'Africa/Maputo',
  argelia: 'Africa/Algiers', etiopia: 'Africa/Addis_Ababa', argentina: 'America/Argentina/Buenos_Aires', chile: 'America/Santiago',
  uruguai: 'America/Montevideo', paraguai: 'America/Asuncion', bolivia: 'America/La_Paz', peru: 'America/Lima', colombia: 'America/Bogota',
  venezuela: 'America/Caracas', equador: 'America/Guayaquil', cuba: 'America/Havana', japao: 'Asia/Tokyo', china: 'Asia/Shanghai',
  india: 'Asia/Kolkata', 'coreia do sul': 'Asia/Seoul', israel: 'Asia/Jerusalem', 'arabia saudita': 'Asia/Riyadh', ira: 'Asia/Tehran',
  paquistao: 'Asia/Karachi', tailandia: 'Asia/Bangkok', vietna: 'Asia/Ho_Chi_Minh', filipinas: 'Asia/Manila', 'nova zelandia': 'Pacific/Auckland',
  bangladesh: 'Asia/Dhaka', iraque: 'Asia/Baghdad', afeganistao: 'Asia/Kabul', nepal: 'Asia/Kathmandu', 'sri lanka': 'Asia/Colombo',
  islandia: 'Atlantic/Reykjavik', 'cabo verde': 'Atlantic/Cape_Verde',
};
// países com vários fusos: escolhe pela longitude (simplificado)
function porLongitude(pais, lat, lon) {
  if (pais === 'estados unidos') {
    if (lon < -154 && lat < 25) return 'Pacific/Honolulu';
    if (lat > 52 && lon < -130) return 'America/Anchorage';
    return lon > -87.5 ? 'America/New_York' : lon > -101 ? 'America/Chicago' : lon > -114.5 ? 'America/Denver' : 'America/Los_Angeles';
  }
  if (pais === 'canada') return lon > -66 ? 'America/Halifax' : lon > -90 ? 'America/Toronto' : lon > -102 ? 'America/Winnipeg' : lon > -120 ? 'America/Edmonton' : 'America/Vancouver';
  if (pais === 'mexico') return lon < -114 ? 'America/Tijuana' : lon < -106 ? 'America/Mazatlan' : 'America/Mexico_City';
  if (pais === 'russia') return lon < 22 ? 'Europe/Kaliningrad' : lon < 50 ? 'Europe/Moscow' : lon < 60 ? 'Europe/Samara' : lon < 70 ? 'Asia/Yekaterinburg'
    : lon < 80 ? 'Asia/Omsk' : lon < 90 ? 'Asia/Novosibirsk' : lon < 106 ? 'Asia/Krasnoyarsk' : lon < 118 ? 'Asia/Irkutsk' : lon < 136 ? 'Asia/Yakutsk'
    : lon < 150 ? 'Asia/Vladivostok' : lon < 162 ? 'Asia/Magadan' : 'Asia/Kamchatka';
  if (pais === 'australia') return lon < 129 ? 'Australia/Perth' : lat > -26 && lon < 138 ? 'Australia/Darwin' : lon < 141 ? 'Australia/Adelaide' : lat > -29 ? 'Australia/Brisbane' : 'Australia/Sydney';
  if (pais === 'indonesia') return lon < 115 ? 'Asia/Jakarta' : lon < 128 ? 'Asia/Makassar' : 'Asia/Jayapura';
  if (pais === 'cazaquistao') return lon < 60 ? 'Asia/Aqtobe' : 'Asia/Almaty';
  return null;
}

// cidade = { pais, estado } mais próxima; devolve { zona, estimada }
export function zonaDoLugar(cidade, lat, lon) {
  const pais = semAcento(cidade?.pais), estado = semAcento(cidade?.estado);
  let zona = null;
  if (pais === 'brasil') zona = BRASIL[estado] || 'America/Sao_Paulo';
  else zona = porLongitude(pais, lat, lon) || PAISES[pais] || null;
  if (zona) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: zona }); return { zona, estimada: false }; } catch { /* zona desconhecida no navegador */ }
  }
  const h = Math.round(lon / 15); // sem dado: fuso pela longitude (os nomes Etc têm o sinal invertido)
  return { zona: h === 0 ? 'Etc/GMT' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`, estimada: true };
}

// deslocamento (minutos) da zona no instante dado (ms UTC), com o histórico real
export function deslocamento(zona, msUTC) {
  try {
    const txt = new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: 'longOffset' })
      .formatToParts(new Date(msUTC)).find((p) => p.type === 'timeZoneName').value;
    const m = txt.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
  } catch { return 0; }
}
export const rotuloUTC = (min) => `UTC${min >= 0 ? '+' : '−'}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, '0')}` : ''}`;

// hora local (data e hora "de parede" naquela zona) → ms UTC; duas iterações bastam (horário de verão)
export function utcDeHoraLocal(zona, ano, mes, dia, hh, mm) {
  const parede = Date.UTC(ano, mes - 1, dia, hh, mm);
  let utc = parede - deslocamento(zona, parede) * 60000;
  utc = parede - deslocamento(zona, utc) * 60000;
  return utc;
}
