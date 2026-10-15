#!/usr/bin/env python3
"""Relevo de Titã numa grade só, para o gerar_relevo.py.

Fonte: Corlies et al. 2017, "Titan's Topography and Shape at the End of the Cassini Mission" (Cornell eCommons,
doi:10.7298/m4dv-gv95, CC0): topo_4PPD_interp.cub (mapa global interpolado, 4 pontos por grau) e dtm_32PPD.cub
(faixas medidas pelo radar, 32 pontos por grau, ~4% da superfície). Os dois estão em metros sobre a esfera de 2575 km.

As faixas e o mapa interpolado diferem em centenas de metros entre si (o mapa é um ajuste suave), então as faixas
não são coladas: entra só o detalhe local delas (a diferença para a média em ~10 km), com a borda esmaecida.
Saída: dados/brutos/tita/tita_32ppd.npy (float32, 5760 × 11520, centros de pixel em (i + 0,5)/32 grau).

Uso: python3 preparar_tita.py   (precisa dos .cub em dados/brutos/tita)
"""
import os
import numpy as np

PASTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'brutos', 'tita')


def ler_cubo(nome, W, H, tw, th):
    """Cubo do ISIS em ladrilhos (float32, sem compressão; os dados começam depois do rótulo de 64 KiB)."""
    raw = np.fromfile(os.path.join(PASTA, nome), '<f4', count=W * H, offset=65536)
    a = raw.reshape(H // th, W // tw, th, tw).transpose(0, 2, 1, 3).reshape(H, W)
    return np.where(np.isfinite(a) & (a > -1e30), a, np.nan).astype(np.float32)


def caixa(a, r, eixo, circular):
    """Média móvel de largura 2r+1 ao longo de um eixo (circular em longitude)."""
    n = a.shape[eixo]
    if circular:
        a = np.concatenate([np.take(a, range(n - r, n), eixo), a, np.take(a, range(r), eixo)], eixo)
    else:
        a = np.concatenate([np.repeat(np.take(a, [0], eixo), r, eixo), a, np.repeat(np.take(a, [n - 1], eixo), r, eixo)], eixo)
    c = np.cumsum(a, eixo, dtype=np.float64)
    zero = np.zeros_like(np.take(c, [0], eixo))
    c = np.concatenate([zero, c], eixo)
    return ((np.take(c, range(2 * r + 1, n + 2 * r + 1), eixo) - np.take(c, range(0, n), eixo)) / (2 * r + 1)).astype(np.float32)


def borrar(a, r):
    """Três passadas de caixa: quase gaussiana (sigma ~ r)."""
    for _ in range(3):
        a = caixa(caixa(a, r, 1, True), r, 0, False)
    return a


def main():
    W, H = 11520, 5760
    glob = ler_cubo('topo_4PPD_interp.cub', 1440, 720, 480, 360)
    dtm = ler_cubo('dtm_32PPD.cub', W, H, 480, 480)
    # mapa global na grade de 32 por grau: centros do arquivo de 4 por grau em lon = (i − 719)/4, lat = (359 − j)/4
    lon = -180 + (np.arange(W) + 0.5) / 32
    lat = 90 - (np.arange(H) + 0.5) / 32
    fi, fj = lon * 4 + 719, np.clip(359 - lat * 4, 0, 719 - 1e-4)
    i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
    ti, tj = (fi - i0).astype(np.float32), (fj - j0).astype(np.float32)
    ia, ib = i0 % 1440, (i0 + 1) % 1440
    linha = lambda j: glob[j][:, ia] * (1 - ti) + glob[j][:, ib] * ti
    base = linha(j0) * (1 - tj)[:, None] + linha(j0 + 1) * tj[:, None]
    del glob
    # detalhe das faixas: diferença para a média local dos pontos medidos. A média é feita numa grade 4 × 4 vezes
    # menor (8 por grau) e ampliada de volta: a grade cheia, borrada várias vezes, não cabe na memória.
    ok = np.isfinite(dtm)
    k = 4
    okR = ok.reshape(H // k, k, W // k, k).mean((1, 3), dtype=np.float32)
    vR = np.nan_to_num(dtm).reshape(H // k, k, W // k, k).sum((1, 3), dtype=np.float32) / (k * k)
    peso = borrar(okR, 1)
    with np.errstate(invalid='ignore', divide='ignore'):
        mediaR = np.where(peso > 0.05, borrar(vR, 1) / peso, 0).astype(np.float32)
    mascR = np.clip((borrar(okR, 1) - 0.5) / 0.4, 0, 1).astype(np.float32)  # só onde quase toda a vizinhança foi medida
    del vR, peso
    saida = base
    del base
    for a in range(0, H, 480):  # amplia em faixas de linhas
        b = a + 480
        fy = np.clip((np.arange(a, b) + 0.5) / k - 0.5, 0, H // k - 1.0001)
        fx = (np.arange(W) + 0.5) / k - 0.5
        y0, x0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
        ty, tx = (fy - y0)[:, None], fx - x0
        xa, xb = x0 % (W // k), (x0 + 1) % (W // k)
        amp = lambda m: (m[y0][:, xa] * (1 - tx) + m[y0][:, xb] * tx) * (1 - ty) + (m[y0 + 1][:, xa] * (1 - tx) + m[y0 + 1][:, xb] * tx) * ty
        d = np.where(ok[a:b], np.nan_to_num(dtm[a:b]) - amp(mediaR), 0)
        saida[a:b] += (d * amp(mascR) * ok[a:b]).astype(np.float32)
    detalhe = (dtm - saida)[ok]  # só para o resumo abaixo
    print(f'faixas: {ok.mean() * 100:.1f}% da superfície; faixa − resultado: ±{np.percentile(np.abs(detalhe), 99):.0f} m (99%);'
          f' altura de {saida.min():.0f} a {saida.max():.0f} m')
    np.save(os.path.join(PASTA, 'tita_32ppd.npy'), saida)


if __name__ == '__main__':
    main()
