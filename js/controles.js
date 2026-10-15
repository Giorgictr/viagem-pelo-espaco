// Teclado e mouse. O laço principal lê o estado a cada quadro.
export const teclas = new Set();
export const mouse = { dx: 0, dy: 0, arrastando: false, roda: 0 };
const ouvintes = {};
export const aoTeclar = (tecla, fn) => (ouvintes[tecla] = fn);

const emCampo = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';

addEventListener('keydown', (e) => {
  if (emCampo(e)) return;
  const k = e.code;
  if (k.startsWith('Arrow') || k === 'Space' || k === 'PageUp' || k === 'PageDown') e.preventDefault();
  if (!e.repeat && ouvintes[k]) ouvintes[k](e);
  teclas.add(k);
});
addEventListener('keyup', (e) => teclas.delete(e.code));
addEventListener('blur', () => teclas.clear());

export function ligarMouse(tela) {
  let ultimo = null;
  tela.addEventListener('pointerdown', (e) => {
    mouse.arrastando = true;
    mouse.moveu = 0;
    mouse.novo = true; mouse.px = e.clientX; mouse.py = e.clientY; // onde começou (o laço decide se pegou um planeta)
    ultimo = [e.clientX, e.clientY];
    tela.setPointerCapture(e.pointerId);
  });
  tela.addEventListener('pointermove', (e) => {
    if (!mouse.arrastando) return;
    mouse.dx += e.clientX - ultimo[0];
    mouse.dy += e.clientY - ultimo[1];
    mouse.moveu += Math.abs(e.clientX - ultimo[0]) + Math.abs(e.clientY - ultimo[1]);
    ultimo = [e.clientX, e.clientY];
  });
  const soltar = () => (mouse.arrastando = false);
  tela.addEventListener('pointerup', soltar);
  tela.addEventListener('pointercancel', soltar);
  tela.addEventListener('wheel', (e) => {
    e.preventDefault();
    mouse.roda += Math.sign(e.deltaY);
  }, { passive: false });
}

// Eixos de movimento (-1..1) e rotação a partir das teclas
export function eixos() {
  const t = (c) => (teclas.has(c) ? 1 : 0);
  const shift = teclas.has('ShiftLeft') || teclas.has('ShiftRight');
  const setasGiram = !shift;
  return {
    frente: t('KeyW') - t('KeyS') + (t('ArrowUp') - t('ArrowDown')) * (setasGiram ? 1 : 0),
    lado: t('KeyD') - t('KeyA'),
    vertical: t('KeyR') - t('KeyF') + t('PageUp') - t('PageDown'),
    guinada: t('ArrowLeft') - t('ArrowRight'),
    arfagem: shift ? t('ArrowUp') - t('ArrowDown') : 0,
    rolagem: t('KeyQ') - t('KeyE'),
  };
}
