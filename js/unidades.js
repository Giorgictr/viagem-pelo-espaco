// Constantes físicas e formatação em português. Unidade interna de distância: km. Tempo: s.
export const C = 299792.458;              // velocidade da luz, km/s
export const UA = 1.495978707e8;          // unidade astronômica, km
export const AL = 9.4607304725808e12;     // ano-luz, km
export const PC = 3.0856775814913673e13;  // parsec, km
export const ANO = 365.25 * 86400;        // s
export const GRAU = Math.PI / 180;
export const OBLIQUIDADE = 23.4392911 * GRAU;

const nf = (n, casas = 0) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

// 3 algarismos significativos, com separadores brasileiros
export function sig(n) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n);
  if (a >= 1000) return nf(n, 0);
  if (a >= 100) return nf(n, 0);
  if (a >= 10) return nf(n, 1);
  if (a >= 1) return nf(n, 2);
  if (a === 0) return '0';
  return nf(n, Math.min(6, 2 - Math.floor(Math.log10(a))));
}

// Número grande com potência de 10 quando passa de um trilhão
function grande(n) {
  if (n < 1e12) return sig(n);
  const e = Math.floor(Math.log10(n));
  return `${sig(n / 10 ** e)} × 10${sobrescrito(e)}`;
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sobrescrito = (e) => String(e).split('').map((d) => (d === '-' ? '⁻' : SUP[+d])).join('');

// "1 milhão", "2,5 milhões"
const mi = (v, um, varios) => `${sig(v)} ${v < 2 ? um : varios}`;

export function distancia(km) {
  const a = Math.abs(km);
  if (a < 1) return `${sig(km * 1000)} m`;
  if (a < 1e7) return `${sig(km)} km`;
  const ua = km / UA;
  if (a < 1e9) return `${mi(km / 1e6, 'milhão', 'milhões')} de km · ${sig(ua)} UA`;
  if (a < 0.05 * AL) return ua < 100 ? `${mi(km / 1e9, 'bilhão', 'bilhões')} de km · ${sig(ua)} UA` : `${sig(ua)} UA`;
  const al = km / AL;
  if (al < 1e3) return `${sig(al)} ${al === 1 ? 'ano-luz' : 'anos-luz'}`;
  if (al < 1e6) return `${sig(al / 1e3)} mil anos-luz`;
  if (al < 1e9) return `${mi(al / 1e6, 'milhão', 'milhões')} de anos-luz`;
  return `${mi(al / 1e9, 'bilhão', 'bilhões')} de anos-luz`;
}

export function duracao(s) {
  if (!isFinite(s)) return '—';
  if (s < 1e-6) return 'instantâneo';
  if (s < 1e-3) return `${sig(s * 1e6)} µs`;
  if (s < 1) return `${sig(s * 1000)} ms`;
  if (s < 60) return `${sig(s)} s`;
  if (s < 3600) return `${sig(s / 60)} min`;
  if (s < 86400) return `${sig(s / 3600)} h`;
  if (s < ANO) return `${sig(s / 86400)} dias`;
  const anos = s / ANO;
  if (anos < 1e3) return `${sig(anos)} anos`;
  if (anos < 1e6) return `${sig(anos / 1e3)} mil anos`;
  if (anos < 1e9) return `${mi(anos / 1e6, 'milhão', 'milhões')} de anos`;
  if (anos < 1e12) return `${mi(anos / 1e9, 'bilhão', 'bilhões')} de anos`;
  return `${grande(anos / 1e9)} bilhões de anos`;
}

// Velocidade: linha principal e linha secundária
export function velocidade(kms) {
  const xc = kms / C;
  let principal;
  if (kms < 1) principal = `${sig(kms * 3600)} km/h`;
  else if (xc < 0.01) principal = `${sig(kms)} km/s`;
  else if (xc < 1e4) principal = `${sig(xc)} × c`;
  else {
    const alps = kms / AL; // anos-luz por segundo
    principal = alps < 1 ? `${grande(xc)} × c` : `${distancia(kms).replace('anos-luz', 'anos-luz')}/s`;
  }
  const sec = [];
  if (kms >= 1 && xc < 0.01) sec.push(`${sig(kms * 3600)} km/h`);
  if (xc >= 0.0001 && xc < 0.01) sec.push(`${sig(xc * 100)}% de c`);
  if (xc >= 0.01 && xc < 1e4) sec.push(`${sig(kms)} km/s`);
  if (xc >= 1e4) sec.push(`${grande(xc)} × c`);
  return { principal, secundaria: sec.join(' · ') };
}

export function data(jd) {
  const d = new Date((jd - 2440587.5) * 86400000);
  if (isNaN(d)) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const jdAgora = () => Date.now() / 86400000 + 2440587.5;
