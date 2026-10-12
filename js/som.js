// Som sintetizado na hora (Web Audio): motor, vento perto dos corpos, entrada/saída de dobra
// e música ambiente gerada, que muda de clima por região. Também toca músicas da pasta musica/.
import { t as tr } from './idioma.js';
let ctx = null, mestre, busMusica, eco;
let motor, vento;
const estadoSom = { ligado: true, volume: 0.6, musica: 'gerada', regiao: 'sistema' };
export { estadoSom };

// O navegador só libera o áudio depois de um gesto do usuário
export function ligarAudioNoPrimeiroGesto() {
  const iniciar = () => {
    if (!ctx) criar();
    if (ctx.state === 'suspended') ctx.resume();
  };
  addEventListener('pointerdown', iniciar);
  addEventListener('keydown', iniciar);
}

function ruidoBranco(seg = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seg, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function criar() {
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.connect(ctx.destination);
  mestre = ctx.createGain();
  mestre.gain.value = estadoSom.ligado ? estadoSom.volume : 0;
  mestre.connect(comp);

  // Eco (reverberação) gerado: ruído com decaimento exponencial
  eco = ctx.createConvolver();
  const n = ctx.sampleRate * 5, ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
  }
  eco.buffer = ir;
  const ecoVol = ctx.createGain();
  ecoVol.gain.value = 0.55;
  eco.connect(ecoVol).connect(mestre);

  busMusica = ctx.createGain();
  busMusica.gain.value = 0.5;
  busMusica.connect(mestre);
  busMusica.connect(eco);

  // Motor: duas serras levemente desafinadas + uma senoide grave, por um filtro passa-baixa
  const filtro = ctx.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = 0;
  filtro.connect(g).connect(mestre);
  const oscs = [['sawtooth', 1], ['sawtooth', 1.006], ['sine', 0.5]].map(([tipo, k]) => {
    const o = ctx.createOscillator();
    o.type = tipo;
    o.connect(filtro);
    o.start();
    return { o, k };
  });
  motor = { filtro, g, oscs };

  // Vento: ruído por um passa-banda
  const fonte = ctx.createBufferSource();
  fonte.buffer = ruidoBranco();
  fonte.loop = true;
  const banda = ctx.createBiquadFilter();
  banda.type = 'bandpass';
  banda.Q.value = 0.7;
  const gv = ctx.createGain();
  gv.gain.value = 0;
  fonte.connect(banda).connect(gv).connect(mestre);
  fonte.start();
  vento = { banda, g: gv };

  agendarMusica();
}

// Chamado a cada quadro: v em km/s, proximidade = v / altitude (1/s), dentroAtm 0..1
export function atualizarSom(v, proximidade, dentroAtm) {
  if (!ctx) return;
  const t = ctx.currentTime;
  mestre.gain.setTargetAtTime(estadoSom.ligado ? estadoSom.volume : 0, t, 0.1);
  const x = Math.min(Math.max((Math.log10(Math.max(v, 1e-4)) + 3) / 25, 0), 1); // 1 m/s → 0, 10²² km/s → 1
  const parado = v < 1e-4;
  for (const { o, k } of motor.oscs) o.frequency.setTargetAtTime((34 + 95 * x) * k, t, 0.25);
  motor.filtro.frequency.setTargetAtTime(160 + 2600 * x ** 1.6, t, 0.25);
  motor.g.gain.setTargetAtTime(parado ? 0.025 : 0.05 + 0.09 * x, t, 0.3);
  const r = Math.min(Math.max(Math.log10(Math.max(proximidade, 1e-9)) / 2, 0), 1);
  vento.g.gain.setTargetAtTime(Math.max(r * 0.22, dentroAtm * Math.min(v / 0.3, 1) * 0.3), t, 0.2);
  vento.banda.frequency.setTargetAtTime(300 + 1800 * Math.max(r, dentroAtm * 0.5), t, 0.2);
}

// Entrada (subir = true) ou saída da dobra: varredura de tom + rajada de ruído
export function somDobra(subir) {
  if (!ctx || !estadoSom.ligado) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth';
  f.type = 'lowpass';
  f.frequency.value = 2500;
  o.frequency.setValueAtTime(subir ? 70 : 900, t);
  o.frequency.exponentialRampToValueAtTime(subir ? 1100 : 60, t + 1.3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(f).connect(g).connect(mestre);
  g.connect(eco);
  o.start(t);
  o.stop(t + 1.7);
  const n = ctx.createBufferSource(), b = ctx.createBiquadFilter(), gn = ctx.createGain();
  n.buffer = ruidoBranco(2);
  b.type = 'bandpass';
  b.frequency.setValueAtTime(subir ? 300 : 3000, t);
  b.frequency.exponentialRampToValueAtTime(subir ? 4000 : 200, t + 1.2);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(0.35, t + 0.1);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  n.connect(b).connect(gn).connect(mestre);
  n.start(t);
  n.stop(t + 1.5);
}

// ------------------------------- música gerada -------------------------------
const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const REGIOES = {
  // acordes (notas MIDI), duração de cada acorde (s), escala dos sininhos
  sistema: { acordes: [[48, 55, 59, 62, 64], [45, 52, 55, 60, 64], [41, 48, 52, 57, 60], [43, 50, 53, 59, 62]], dur: 9, sinos: [72, 74, 76, 79, 81, 84] },
  interestelar: { acordes: [[38, 45, 50, 52, 57], [34, 41, 45, 50, 52], [41, 48, 53, 55, 60], [36, 43, 48, 50, 55]], dur: 12, sinos: [69, 72, 74, 76, 81] },
  galactico: { acordes: [[31, 38, 43, 50], [29, 36, 41, 48], [33, 40, 45, 52]], dur: 16, sinos: [62, 67, 69, 74] },
};
let iAcorde = 0, proximoAcorde = 0, proximoSino = 0;

function nota(freq, inicio, dur, vol, tipo, ataque, destino = busMusica) {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = tipo;
  o.frequency.value = freq;
  o.detune.value = (Math.random() - 0.5) * 12;
  f.type = 'lowpass';
  f.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, inicio);
  g.gain.exponentialRampToValueAtTime(vol, inicio + ataque);
  g.gain.setValueAtTime(vol, inicio + Math.max(dur - 4, ataque));
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
  o.connect(f).connect(g).connect(destino);
  o.start(inicio);
  o.stop(inicio + dur + 0.1);
}

function agendarMusica() {
  setInterval(() => {
    if (!ctx || estadoSom.musica !== 'gerada' || !estadoSom.ligado) return;
    const t = ctx.currentTime, R = REGIOES[estadoSom.regiao];
    if (t >= proximoAcorde - 0.5) {
      const ac = R.acordes[iAcorde++ % R.acordes.length];
      const inicio = Math.max(t, proximoAcorde);
      for (const m of ac) {
        nota(midi(m), inicio, R.dur + 4, 0.035, 'triangle', 3.5);
        nota(midi(m) * 1.003, inicio, R.dur + 4, 0.02, 'sine', 4);
      }
      proximoAcorde = inicio + R.dur;
    }
    if (t >= proximoSino) {
      const m = R.sinos[Math.floor(Math.random() * R.sinos.length)];
      nota(midi(m), t, 4, 0.025, 'sine', 0.01);
      proximoSino = t + 2.5 + Math.random() * 5;
    }
  }, 250);
}

// ------------------------------- músicas do usuário -------------------------------
let faixas = [], iFaixa = 0;
const player = new Audio();
player.addEventListener('ended', () => tocarFaixa(iFaixa + 1));

// A pasta musica/ é listada pelo próprio servidor local (python -m http.server)
async function listarFaixas() {
  try {
    const html = await (await fetch('musica/')).text();
    const nomes = [...html.matchAll(/href="([^"]+\.(?:mp3|m4a|ogg|wav|aac|flac))"/gi)].map((m) => m[1]);
    faixas = nomes.map((n) => `musica/${n}`).sort(() => Math.random() - 0.5);
  } catch { faixas = []; }
  return faixas.length;
}
function tocarFaixa(i) {
  if (!faixas.length) return;
  iFaixa = ((i % faixas.length) + faixas.length) % faixas.length;
  player.src = faixas[iFaixa];
  player.volume = estadoSom.ligado ? estadoSom.volume : 0;
  player.play().catch(() => {});
}
export function nomeFaixa() {
  return faixas.length && estadoSom.musica === 'minhas' ? decodeURIComponent(faixas[iFaixa].split('/').pop()) : '';
}
export const proximaFaixa = () => tocarFaixa(iFaixa + 1);

// Troca o modo de música: 'gerada' | 'minhas' | 'nenhuma'. Devolve aviso, se houver.
export async function mudarMusica(modo) {
  estadoSom.musica = modo;
  if (modo === 'minhas') {
    if (!(await listarFaixas())) { player.pause(); return tr('Nenhuma música encontrada: coloque arquivos MP3 na pasta "musica" e escolha de novo.'); }
    tocarFaixa(0);
  } else player.pause();
  return '';
}
export function ajustarVolume() {
  player.volume = estadoSom.ligado ? estadoSom.volume : 0;
}
