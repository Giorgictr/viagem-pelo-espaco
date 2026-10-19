// Teste de fumaça da Viagem pelo Espaço: roda antes de cada publicação.
// Sobe o servidor local numa porta própria, abre a página no Chrome instalado (sem janela) e faz um passeio:
// corpos do Sistema Solar e além, relevo em ladrilhos, fichas, chaves, busca, os três idiomas, o celular e os
// manuais. Falha se aparecer erro de JavaScript, erro de shader, arquivo do próprio site faltando, texto em
// português nas outras línguas ou o ☰ sumindo no celular. Arquivos de fora (NASA Trek, GIBS…) que falharem
// viram só aviso: o site precisa continuar de pé sem eles.
//
// Uso: cd testes && npm install && npm run fumaca       (capturas em testes/capturas/, fora do git)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURAS = path.join(RAIZ, 'testes', 'capturas');
const PORTA = 8799;
const BASE = `http://127.0.0.1:${PORTA}/`;
const erros = [], avisos = [];
let etapa = '';
const falha = (m) => { erros.push(`[${etapa}] ${m}`); console.log(`  ✗ ${m}`); };
const aviso = (m) => { avisos.push(`[${etapa}] ${m}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

// ---------------------------------------------------------------- servidor
const servidor = spawn('python3', ['servidor.py', String(PORTA)], { cwd: RAIZ, stdio: 'ignore' });
process.on('exit', () => servidor.kill());
for (let i = 0; ; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* ainda subindo */ }
  if (i > 50) { console.log('servidor não subiu'); process.exit(2); }
  await new Promise((r) => setTimeout(r, 200));
}

// com a placa de vídeo do Mac (Metal), como num navegador de verdade; o desenho por software (SwiftShader) às vezes
// falha ao compilar o shader do céu na primeira abertura, sem nenhuma mensagem, e é bem mais lento
const navegador = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
mkdirSync(CAPTURAS, { recursive: true });

// Página com os vigias de erro ligados
async function abrir(url, opcoes = {}) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 800 }, ...opcoes });
  await ctx.addInitScript(() => { try { localStorage.setItem('viagemVisitou', '1'); } catch { /* sem armazenamento */ } }); // sem a tela de boas-vindas
  // se um shader não montar, diz qual (o three.js só mostra o registro do WebGL, que às vezes vem vazio)
  await ctx.addInitScript(() => {
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
      const orig = C.prototype.getProgramParameter;
      C.prototype.getProgramParameter = function (prog, nome) {
        const v = orig.call(this, prog, nome);
        if (nome === this.LINK_STATUS && v === false) {
          const fontes = (this.getAttachedShaders(prog) || []).map((sh) => (this.getShaderSource(sh) || '').split('\n').filter((l) => /uniform|attribute|varying|void main/.test(l)).slice(0, 6).join(' | ').slice(0, 300));
          console.error(`[shader que não montou] contexto perdido: ${this.isContextLost()} · erro GL: ${this.getError()} · ${fontes.join(' ### ')}`);
        }
        return v;
      };
    }
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => falha(`erro de JavaScript: ${e.message.split('\n')[0]}`));
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') {
      if (/Failed to load resource/.test(t)) return; // tratado pelas respostas abaixo, com o endereço
      falha(`console: ${t.slice(0, 200)}`);
    } else if (m.type() === 'warning' && /THREE\.WebGLProgram|Shader Error|shader/i.test(t)) falha(`shader: ${t.slice(0, 200)}`);
  });
  p.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (u.startsWith(BASE)) falha(`arquivo do site faltando (${r.status()}): ${u.slice(BASE.length)}`);
    else aviso(`fora do site, ${r.status()}: ${u.slice(0, 120)}`);
  });
  p.on('requestfailed', (r) => { if (!r.url().startsWith(BASE)) aviso(`fora do site, falhou: ${r.url().slice(0, 120)}`); });
  await p.goto(BASE + url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__sim && window.__sim.PORID, null, { timeout: 90000 });
  return p;
}
// cada parte do teste roda separada: se uma travar, o erro é anotado e as outras continuam
async function parte(nome, titulo, fn) {
  etapa = nome;
  console.log(titulo);
  try { await fn(); } catch (e) { falha(`parou: ${e.message.split('\n')[0]}`); }
}
const quadros = (p, n = 5) => p.evaluate((n) => window.__sim.quadros(n), n);
const captura = (p, nome) => p.screenshot({ path: path.join(CAPTURAS, `${nome}.png`) });
async function esperar(p, fn, arg, ms = 30000) { // avança quadros até a condição valer
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    await quadros(p, 2);
    if (await p.evaluate(fn, arg)) return true;
    await p.waitForTimeout(200);
  }
  return false;
}

// ---------------------------------------------------------------- 1. passeio em português
let textosPt = {};
await parte('pt', 'Passeio em português', async () => {
const p = await abrir('?lang=pt');
await quadros(p, 10);
ok('a página abriu e o laço principal anda');
const corpos = ['terra', 'lua', 'sol', 'mercurio', 'venus', 'marte', 'fobos', 'ceres', 'vesta', 'jupiter', 'io', 'europa', 'saturno', 'encelado', 'tita', 'urano', 'titania', 'netuno', 'tritao', 'plutao', 'caronte', 'andromeda'];
for (const id of corpos) {
  const r = await p.evaluate((id) => {
    const s = window.__sim, c = s.PORID[id];
    if (!c) return 'não existe';
    s.teleportar(c); s.quadros(8);
    if (c.malha && !c.malha.visible && c.tipo !== 'galaxia') return 'esfera invisível de perto';
    return '';
  }, id);
  if (r) falha(`${id}: ${r}`);
  // a foto do corpo (baixada quando ele aparece como disco) tem de chegar
  else if (!(await esperar(p, (id) => { const c = window.__sim.PORID[id]; return !c.textura || c.mapaPronto || ['sol', 'terra', 'lua'].includes(id); }, id, 20000))) falha(`${id}: a foto não carregou`);
}
ok(`visitou ${corpos.length} corpos, com as fotos`);
await captura(p, 'pt-andromeda');

// relevo em ladrilhos (servidos do próprio site em localhost)
for (const id of ['lua', 'marte', 'ceres', 'vesta', 'plutao']) {
  await p.evaluate((id) => { const s = window.__sim, ss = s.subsolar(id); s.sobrevoar(id, ss[0] - 10, ss[1] + 15, s.PORID[id].raio * 0.08, 25); }, id);
  if (await esperar(p, (id) => !!window.__sim.PORID[id].solo?.ativo, id, 40000)) ok(`${id}: relevo em ladrilhos ativo`);
  else falha(`${id}: o relevo em ladrilhos não entrou`);
}
await captura(p, 'pt-vesta-perto');

// Titã: com a névoa (padrão) não há ladrilhos; sem ela, há
await p.evaluate(() => { const s = window.__sim; s.sobrevoar('tita', 0, 0, 300, 25); });
await quadros(p, 20);
if (await p.evaluate(() => window.__sim.PORID.tita.solo?.ativo)) falha('Titã com névoa ligou o relevo em ladrilhos');
await p.evaluate(() => document.getElementById('btNevoaTita').click());
if (await esperar(p, () => !!window.__sim.PORID.tita.solo?.ativo, null, 40000)) ok('Titã sem névoa: superfície e relevo');
else falha('Titã sem névoa: o relevo em ladrilhos não entrou');
await p.evaluate(() => document.getElementById('btNevoaTita').click());

// pouso: a Lua (e o pulo), Vesta (irregular), Vênus (abaixo das nuvens) e Júpiter (flutua no topo das nuvens)
const pousarEm = (id, alt) => p.evaluate(async ([id, alt]) => {
  const s = window.__sim, ss = s.subsolar(id), c = s.PORID[id];
  s.sobrevoar(id, ss[0] - 20, ss[1] + 25, alt, 25); s.quadros(30); s.pousar();
  for (let n = 0; s.estado.piloto && n < 4000; n += 50) { s.quadros(50); await new Promise((r) => setTimeout(r, 20)); }
  s.quadros(30);
  return { pousado: s.estado.pousado?.id ?? null, alt: s.estado.local.length() - s.raioSuperficie(c, s.estado.local), quadro: document.getElementById('noChao').textContent, mapa: c.malha.material.uniforms.mapa.value?.image?.src ?? '' };
}, [id, alt]);
for (const [id, alt, teste] of [
  ['lua', 300, (r) => r.alt < 0.01],
  ['vesta', 100, (r) => r.alt < 0.01],
  ['venus', 500, (r) => r.alt < 0.01 && r.mapa.includes('venus_surface')],
  ['jupiter', 3000, (r) => r.alt > 45 && r.alt < 55],
]) {
  const r = await pousarEm(id, alt);
  if (r.pousado === id && teste(r) && /gravidade/.test(r.quadro)) ok(`pouso em ${id} (altitude ${(r.alt * 1000).toFixed(1)} m)`);
  else falha(`pouso em ${id}: ${JSON.stringify(r)}`);
  if (id === 'lua') {
    const h = await p.evaluate(() => { const s = window.__sim; dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); s.quadros(40); return s.estado.pulo?.h ?? 0; });
    if (h > 0.0005) ok(`pulo na Lua: ${(h * 1000).toFixed(1)} m depois de 0,6 s`); else falha(`o pulo na Lua não subiu (${h})`);
  }
}
await captura(p, 'pt-jupiter-nuvens');

// fichas
const ficha = await p.evaluate(() => { const s = window.__sim; s.mostrarFicha(s.PORID.marte); const f = document.getElementById('ficha'); return !f.hidden && f.innerText; });
if (ficha && /Diâmetro/.test(ficha) && /Gravidade/.test(ficha)) ok('ficha de Marte'); else falha('a ficha de Marte não abriu direito');
await p.evaluate(() => document.getElementById('fichaFechar')?.click());

// chaves: liga e desliga de novo
const chaves = ['btOrbitas', 'btRelevo', 'btAparencia', 'btNivelar', 'btAtm', 'btFichas', 'btInventado', 'btCeu', 'btLinhasConst', 'btNomesConst', 'btIlustr', 'btViaReal', 'btDobra'];
for (const id of chaves) {
  const existe = await p.evaluate((id) => { const b = document.getElementById(id); if (!b) return false; b.click(); window.__sim.quadros(3); b.click(); window.__sim.quadros(3); return true; }, id);
  if (!existe) falha(`botão ${id} sumiu`);
}
ok(`${chaves.length} chaves ligadas e desligadas`);

// busca: constelação, estrela, cidade, exoplaneta
for (const nome of ['orion', 'sirius', 'paris', 'trappist-1', 'andromeda']) {
  const r = await p.evaluate((nome) => { const e = window.__sim.buscar(nome); if (!e) return false; e.acao(); window.__sim.quadros(5); return true; }, nome);
  if (!r) falha(`a busca não achou "${nome}"`);
}
ok('busca');

// arrastar sobre a Terra gira em volta dela; arrastar no céu só vira o olhar
await p.evaluate(() => { const s = window.__sim; s.teleportar(s.PORID.terra); s.quadros(5); });
await p.waitForTimeout(300);
const antes = await p.evaluate(() => window.__sim.estado.local.toArray());
await p.mouse.move(640, 400); await p.mouse.down(); await p.mouse.move(760, 400, { steps: 6 }); await p.mouse.up();
await quadros(p, 3);
const depois = await p.evaluate(() => window.__sim.estado.local.toArray());
const moveu = Math.hypot(...antes.map((v, i) => v - depois[i]));
if (moveu > 100) ok('arrastar sobre a Terra gira em volta dela'); else falha('arrastar sobre a Terra não girou');
textosPt = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('button[id]')].map((b) => [b.id, b.textContent.trim()])));
await p.context().close();
});

// ---------------------------------------------------------------- 2. inglês e espanhol
for (const lang of ['en', 'es']) await parte(lang, `Página em ${lang}`, async () => {
  const q = await abrir(`?lang=${lang}`);
  await quadros(q, 10);
  const r = await q.evaluate(() => ({ titulo: document.title, botoes: Object.fromEntries([...document.querySelectorAll('button[id]')].map((b) => [b.id, b.textContent.trim()])) }));
  if (r.titulo === 'Viagem pelo Espaço') falha('título da página sem tradução');
  // botões com texto que tem cara de português e é igual ao do português
  const iguais = Object.entries(r.botoes).filter(([id, t]) => textosPt[id] === t && /[ãõçéêáíóú]|\b(ligad|desligad|ou|de|da|do|com|sem)\b/i.test(t) && !/^(Ceres|Vesta)$/.test(t));
  for (const [id, t] of iguais) falha(`botão ${id} continua em português: "${t}"`);
  await q.evaluate(() => { const s = window.__sim; s.mostrarFicha(s.PORID.vesta); });
  const f = await q.evaluate(() => document.getElementById('ficha').innerText);
  if (/Diâmetro|Gravidade/.test(f)) falha('ficha em português');
  if (!iguais.length) ok('interface traduzida');
  await q.context().close();
});

// ---------------------------------------------------------------- 3. celular
await parte('celular', 'Celular', async () => {
const c = await abrir('?lang=pt', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await quadros(c, 10);
await c.waitForTimeout(800); // vigiarAbas roda a cada 400 ms
const visivel = (sel) => c.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; }, sel);
if (!(await c.evaluate(() => document.body.classList.contains('celular')))) falha('o modo celular não ligou');
if (!(await visivel('#btPaineis'))) falha('o ☰ não aparece');
await c.tap('#btPaineis');
const opcoes = await c.evaluate(() => [...document.querySelectorAll('#menuAbas button')].map((b) => b.textContent));
if (opcoes.length < 3) falha(`o menu do ☰ tem só ${opcoes.length} opções`);
for (let i = 0; i < Math.min(opcoes.length - 1, 4); i++) {
  if (!(await visivel('#btPaineis'))) { falha(`o ☰ sumiu depois de escolher "${opcoes[i - 1]}"`); break; }
  if (await c.evaluate(() => document.getElementById('menuAbas').hidden)) await c.tap('#btPaineis');
  await c.evaluate((i) => document.querySelectorAll('#menuAbas button')[i].click(), i);
  await c.waitForTimeout(500);
}
if (await visivel('#btPaineis')) ok(`☰ continua na tela depois de abrir ${Math.min(opcoes.length - 1, 4)} painéis`);
await captura(c, 'celular');
await c.context().close();
});

// ---------------------------------------------------------------- 4. manuais
await parte('manuais', 'Manuais', async () => {
for (const arq of ['manual.html', 'manual.en.html', 'manual.es.html']) {
  const ctx = await navegador.newContext();
  const m = await ctx.newPage();
  m.on('pageerror', (e) => falha(`${arq}: erro de JavaScript: ${e.message}`));
  m.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE)) falha(`${arq}: arquivo faltando: ${r.url().slice(BASE.length)}`); });
  await m.goto(BASE + arq, { waitUntil: 'load' });
  const quebrados = await m.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)).filter((id) => id && !document.getElementById(id)));
  for (const id of new Set(quebrados)) falha(`${arq}: link para #${id}, que não existe`);
  const locais = await m.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => !/^(#|https?:|mailto:)/.test(h)));
  for (const h of new Set(locais)) {
    const r = await fetch(BASE + h.split('#')[0]);
    if (!r.ok) falha(`${arq}: link para ${h} dá ${r.status}`);
  }
  await ctx.close();
}
ok('manuais e links');
});

// ---------------------------------------------------------------- resultado
await navegador.close();
servidor.kill();
const fora = new Set(avisos.map((a) => a.replace(/^\[[^\]]*\] /, '')));
if (fora.size) console.log(`\n${fora.size} aviso(s) de servidores de fora (não reprovam):\n  ${[...fora].slice(0, 8).join('\n  ')}${fora.size > 8 ? '\n  …' : ''}`);
console.log(erros.length ? `\nREPROVADO: ${erros.length} problema(s)\n  ${erros.join('\n  ')}` : '\nAPROVADO: nenhum problema encontrado');
process.exit(erros.length ? 1 : 0);
