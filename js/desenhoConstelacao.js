// Desenho de uma constelação na ficha: a figura (ilustração de Johan Meuris, Stellarium, Free Art License), as linhas
// (as mesmas do céu do programa) e as estrelas até a magnitude 5,5, com os nomes das principais. Projeção
// estereográfica centrada na constelação, com o norte para cima e o leste à esquerda, como se vê olhando o céu.
// A ilustração é encaixada por três estrelas (posição na imagem → posição no céu): uma transformação afim.
const GRAU = Math.PI / 180;
const imagens = new Map();
const carregar = (arq) => {
  if (!imagens.has(arq)) imagens.set(arq, new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = `texturas/constelacoes/${arq}`; }));
  return imagens.get(arq);
};

export async function desenharConstelacao(tela, d, rotulos = []) {
  const ctx = tela.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = tela.clientWidth || 400, H = tela.clientHeight || 300;
  tela.width = Math.round(W * dpr); tela.height = Math.round(H * dpr);

  // centro: média das estrelas e das linhas
  const pts = [...d.estrelas.map((e) => [e[0], e[1]]), ...d.linhas.flat()];
  let cx = 0, cy = 0, cz = 0;
  for (const [ra, dec] of pts) { cx += Math.cos(dec * GRAU) * Math.cos(ra * GRAU); cy += Math.cos(dec * GRAU) * Math.sin(ra * GRAU); cz += Math.sin(dec * GRAU); }
  const a0 = Math.atan2(cy, cx), d0 = Math.atan2(cz, Math.hypot(cx, cy));
  const proj = (ra, dec) => {
    const a = ra * GRAU - a0, de = dec * GRAU;
    const cosc = Math.sin(d0) * Math.sin(de) + Math.cos(d0) * Math.cos(de) * Math.cos(a);
    if (cosc < -0.5) return null;
    const k = 2 / (1 + cosc);
    return [-k * Math.cos(de) * Math.sin(a), -k * (Math.cos(d0) * Math.sin(de) - Math.sin(d0) * Math.cos(de) * Math.cos(a))];
  };
  // escala para caber (as estrelas da constelação e as linhas)
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [ra, dec] of pts) { const p = proj(ra, dec); if (!p) continue; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const m = 22, s = Math.min((W - 2 * m) / Math.max(x1 - x0, 1e-6), (H - 2 * m) / Math.max(y1 - y0, 1e-6));
  const ox = W / 2 - ((x0 + x1) / 2) * s, oy = H / 2 - ((y0 + y1) / 2) * s;
  const tela2 = (ra, dec) => { const p = proj(ra, dec); return p && [ox + p[0] * s, oy + p[1] * s]; };

  const fundo = () => { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = '#060a16'; ctx.fillRect(0, 0, W, H); };
  const resto = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(120, 170, 255, .75)'; ctx.lineWidth = 1.2;
    for (const linha of d.linhas) {
      ctx.beginPath();
      linha.forEach(([ra, dec], i) => { const p = tela2(ra, dec); if (p) i ? ctx.lineTo(...p) : ctx.moveTo(...p); });
      ctx.stroke();
    }
    for (const [ra, dec, mag] of d.estrelas) {
      const p = tela2(ra, dec); if (!p) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(0.7, 3.4 - 0.55 * mag), 0, 2 * Math.PI);
      ctx.fillStyle = '#fff'; ctx.fill();
    }
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255, 214, 150, .95)'; ctx.textBaseline = 'middle';
    for (const [txt, ra, dec] of rotulos) { const p = tela2(ra, dec); if (p) ctx.fillText(txt, p[0] + 6, p[1] - 6); }
  };

  fundo(); resto(); // primeiro sem a figura (a imagem pode demorar)
  if (!d.figura) return;
  const im = await carregar(d.figura.arq);
  if (!im) return;
  // afim: (px, py) da imagem → tela, pelas três estrelas de encaixe
  const A = d.figura.anc.map(([px, py, ra, dec]) => [px, py, ...(tela2(ra, dec) ?? [NaN, NaN])]);
  const [[p1x, p1y, q1x, q1y], [p2x, p2y, q2x, q2y], [p3x, p3y, q3x, q3y]] = A;
  const det = p1x * (p2y - p3y) + p2x * (p3y - p1y) + p3x * (p1y - p2y);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return;
  const resolve = (v1, v2, v3) => [ // coeficientes (a, b, c) de v = a·px + b·py + c
    (v1 * (p2y - p3y) + v2 * (p3y - p1y) + v3 * (p1y - p2y)) / det,
    (v1 * (p3x - p2x) + v2 * (p1x - p3x) + v3 * (p2x - p1x)) / det,
    (v1 * (p2x * p3y - p3x * p2y) + v2 * (p3x * p1y - p1x * p3y) + v3 * (p1x * p2y - p2x * p1y)) / det,
  ];
  const [ax, bx, cx2] = resolve(q1x, q2x, q3x), [ay, by, cy2] = resolve(q1y, q2y, q3y);
  fundo();
  ctx.setTransform(ax * dpr, ay * dpr, bx * dpr, by * dpr, cx2 * dpr, cy2 * dpr);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
  ctx.drawImage(im, 0, 0, d.figura.tam[0], d.figura.tam[1]);
  resto();
}
