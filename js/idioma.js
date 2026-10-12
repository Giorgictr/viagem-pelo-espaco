// Idioma da interface: português (o original), inglês ou espanhol.
// Escolha: ?lang= no endereço, depois a escolha guardada, depois o idioma do navegador.
// Os textos do código passam por t('texto em português', valores); a tradução vem de dados/idiomas/<idioma>.json,
// indexada pelo próprio texto em português (o que não estiver lá aparece em português).
// Marcadores: {x} é um valor; {de:x}, {a:x}, {em:x}, {o:x} põem o nome do corpo x com artigo e preposição do
// idioma ("da Lua", "ao Sol"; "the Moon"; "de la Luna", "al Sol").
export const IDIOMAS = { pt: 'Português', en: 'English', es: 'Español' };

function escolher() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && IDIOMAS[q]) return q;
  try { const g = localStorage.getItem('viagemIdioma'); if (g && IDIOMAS[g]) return g; } catch { /* sem armazenamento */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const k = (l || '').slice(0, 2).toLowerCase();
    if (IDIOMAS[k]) return k;
  }
  return 'en'; // quem não lê português nem espanhol fica com o inglês
}
export const idioma = escolher();
export const LOCALE = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[idioma];
document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : idioma;

let dic = {};
if (idioma !== 'pt') {
  try { dic = await fetch(`dados/idiomas/${idioma}.json`).then((r) => (r.ok ? r.json() : {})); } catch { dic = {}; }
}

// Nome com artigo e preposição, por idioma
const nomeDe = (x) => (typeof x === 'string' ? x : x?.nome ?? '');
function generoPt(x) {
  const id = x?.id, n = nomeDe(x);
  if (['terra', 'lua'].includes(id) || /^(Galáxia|Via Láctea|Grande Nuvem|Pequena Nuvem|Estrela|Borda|Nebulosa)/.test(n)) return 'f';
  if (id === 'sol' || /^(Centro|Aglomerado|Grande Atrator|Quasar)/.test(n)) return 'm';
  return '';
}
function generoEs(x) {
  const id = x?.id, n = nomeDe(x);
  if (['terra', 'lua'].includes(id) || /^(Galaxia|Vía Láctea|Gran Nube|Pequeña Nube|Estrella|Borde|Nebulosa)/.test(n)) return 'f';
  if (id === 'sol' || /^(Centro|Cúmulo|Gran Atractor|Cuásar)/.test(n)) return 'm';
  return '';
}
const comThe = (x) => (x?.id === 'sol' || x?.id === 'lua' || /^(Milky Way|Large |Small |Great |Virgo Cluster|Coma Cluster|Center|Edge|.* Galaxy$|.* Nebula$|.* Cluster$)/.test(nomeDe(x)) ? `the ${nomeDe(x)}` : nomeDe(x));
function artigo(prep, x) {
  const n = nomeDe(x);
  if (idioma === 'en') return comThe(x);
  if (idioma === 'es') {
    const g = generoEs(x);
    const art = g === 'f' ? 'la ' : g === 'm' ? 'el ' : '';
    if (prep === 'o') return art + n;
    if (prep === 'a') return g === 'm' ? `al ${n}` : `a ${art}${n}`;
    if (prep === 'de') return g === 'm' ? `del ${n}` : `de ${art}${n}`;
    return `en ${art}${n}`;
  }
  const g = generoPt(x);
  const t = { a: g === 'f' ? 'à' : g === 'm' ? 'ao' : 'a', de: g === 'f' ? 'da' : g === 'm' ? 'do' : 'de', em: g === 'f' ? 'na' : g === 'm' ? 'no' : 'em', o: g === 'f' ? 'a' : g === 'm' ? 'o' : '' }[prep];
  return t ? `${t} ${n}` : n;
}

export function t(pt, vals) {
  let s = dic[pt] ?? pt;
  if (!vals) return s;
  const comeca = /^\{(a|de|em|en|o):/.test(s);
  s = s.replace(/\{(?:(a|de|em|en|o):)?(\w+)\}/g, (m, prep, k) => (k in vals ? (prep ? artigo(prep === 'en' ? 'em' : prep, vals[k]) : nomeDe(vals[k]) || String(vals[k])) : m));
  return comeca ? s.charAt(0).toUpperCase() + s.slice(1) : s; // frase que começa pelo nome: "A Lua está…", "The Moon is…"
}
// Rótulo no singular ou no plural
export const tn = (n, um, varios, vals = {}) => t(n === 1 ? um : varios, { n, ...vals });

// ---------------- página: texto fixo do HTML ----------------
// Elementos com só texto e formatação simples são traduzidos inteiros (pelo HTML de dentro); nos outros, cada
// trecho de texto separadamente. Roda antes de o app ligar os botões.
const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'KBD', 'A', 'BR', 'SMALL', 'CODE', 'SUB', 'SUP', 'SPAN']);
const ATRIBUTOS = ['title', 'placeholder', 'aria-label', 'alt'];
const normal = (s) => s.replace(/\s+/g, ' ').trim();
function soInline(el) {
  for (const f of el.children) if (!INLINE.has(f.tagName) || f.id || f.children.length && !soInline(f)) return false;
  return true;
}
function percorrer(raiz, fazer) {
  const pular = (el) => el.closest?.('script, style, [data-sem-traducao]');
  const andar = (el) => {
    if (pular(el)) return;
    for (const a of ATRIBUTOS) if (el.hasAttribute?.(a) && normal(el.getAttribute(a))) fazer({ tipo: 'atr', el, a, chave: normal(el.getAttribute(a)) });
    if (el.children.length && soInline(el) && el.id !== 'rotulos' && normal(el.textContent) && el.innerHTML.includes('<')) {
      fazer({ tipo: 'html', el, chave: normal(el.innerHTML) });
      return;
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3 && normal(n.textContent) && /[A-Za-zÀ-ú]/.test(n.textContent)) fazer({ tipo: 'txt', n, chave: normal(n.textContent) });
      else if (n.nodeType === 1) andar(n);
    }
  };
  andar(raiz);
}
export function traduzirDOM(raiz = document.body) {
  if (idioma === 'pt') return;
  percorrer(raiz, (p) => {
    const tr = dic[p.chave];
    if (!tr) return;
    if (p.tipo === 'atr') p.el.setAttribute(p.a, tr);
    else if (p.tipo === 'html') p.el.innerHTML = tr;
    else p.n.textContent = p.n.textContent.replace(/\S[\s\S]*\S|\S/, tr);
  });
  document.title = dic[document.title] ?? document.title;
}
// Para gerar o dicionário: os textos fixos da página, do jeito que traduzirDOM procura
export function coletarDOM(raiz = document.body) {
  const s = new Set([document.title]);
  percorrer(raiz, (p) => s.add(p.chave));
  return [...s];
}

export function trocarIdioma(novo) {
  try { localStorage.setItem('viagemIdioma', novo); } catch { /* sem armazenamento */ }
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.href = u.toString();
}
// Manual no idioma certo
export const manual = idioma === 'pt' ? 'manual.html' : `manual.${idioma}.html`;

traduzirDOM();
