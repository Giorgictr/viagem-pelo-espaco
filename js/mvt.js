// Leitor mínimo de ladrilhos vetoriais (Mapbox Vector Tile, protobuf). Devolve só a camada pedida:
// [{ tipo, props, aneis: [[x, y, x, y, ...], ...] }] em coordenadas do ladrilho (0..extent, y para baixo).
class Leitor {
  constructor(buf, ini = 0, fim = buf.length) { this.b = buf; this.p = ini; this.fim = fim; }
  varint() {
    let r = 0, s = 0, c;
    do { c = this.b[this.p++]; r += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80);
    return r;
  }
  sub() { const n = this.varint(), l = new Leitor(this.b, this.p, this.p + n); this.p += n; return l; }
  texto() { const l = this.sub(); return new TextDecoder().decode(this.b.subarray(l.p, l.fim)); }
  pular(t) {
    if (t === 0) this.varint();
    else if (t === 1) this.p += 8;
    else if (t === 2) this.p += this.varint();
    else if (t === 5) this.p += 4;
  }
  empacotados() { const l = this.sub(), out = []; while (l.p < l.fim) out.push(l.varint()); return out; }
}
const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);

function valor(l) {
  let v = null;
  const dv = new DataView(l.b.buffer, l.b.byteOffset);
  while (l.p < l.fim) {
    const k = l.varint(), c = k >> 3, t = k & 7;
    if (c === 1) v = l.texto();
    else if (c === 2) { v = dv.getFloat32(l.p, true); l.p += 4; }
    else if (c === 3) { v = dv.getFloat64(l.p, true); l.p += 8; }
    else if (c === 4 || c === 5) v = l.varint();
    else if (c === 6) v = zz(l.varint());
    else if (c === 7) v = !!l.varint();
    else l.pular(t);
  }
  return v;
}

function geometria(cmds) {
  const aneis = [];
  let x = 0, y = 0, atual = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 7) { if (atual) aneis.push(atual); atual = null; continue; }
    for (let k = 0; k < n; k++) {
      x += zz(cmds[i++]); y += zz(cmds[i++]);
      if (id === 1) { if (atual) aneis.push(atual); atual = [x, y]; } else atual.push(x, y);
    }
  }
  if (atual) aneis.push(atual);
  return aneis;
}

export function lerCamada(arrayBuffer, nome) {
  const buf = new Uint8Array(arrayBuffer);
  const t = new Leitor(buf);
  while (t.p < t.fim) {
    const k = t.varint();
    if (k >> 3 !== 3 || (k & 7) !== 2) { t.pular(k & 7); continue; }
    const l = t.sub();
    let nomeCamada = '', extent = 4096;
    const chaves = [], valores = [], brutas = [];
    while (l.p < l.fim) {
      const kk = l.varint(), c = kk >> 3;
      if (c === 1) nomeCamada = l.texto();
      else if (c === 2) brutas.push(l.sub());
      else if (c === 3) chaves.push(l.texto());
      else if (c === 4) valores.push(valor(l.sub()));
      else if (c === 5) extent = l.varint();
      else l.pular(kk & 7);
    }
    if (nomeCamada !== nome) continue;
    const feicoes = brutas.map((f) => {
      let tipo = 0, tags = [], geo = [];
      while (f.p < f.fim) {
        const kk = f.varint(), c = kk >> 3;
        if (c === 2) tags = f.empacotados();
        else if (c === 3) tipo = f.varint();
        else if (c === 4) geo = f.empacotados();
        else f.pular(kk & 7);
      }
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[chaves[tags[i]]] = valores[tags[i + 1]];
      return { tipo, props, aneis: geometria(geo) };
    });
    return { extent, feicoes };
  }
  return { extent: 4096, feicoes: [] };
}
