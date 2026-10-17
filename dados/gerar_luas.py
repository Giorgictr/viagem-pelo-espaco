#!/usr/bin/env python3
"""Texturas reais das luas (2048 × 1024, longitude de −180 a 180 para leste) a partir dos mosaicos globais do USGS
Astrogeology, lidos direto do S3 em blocos de linhas (nada é guardado), e mapas de relevo globais pequenos.

Os mosaicos em tons de cinza ganham um pouco da cor de cada corpo (a de js/corpos.js) e todos têm o brilho médio
ajustado ao dela: as fotos foram tiradas com câmeras, filtros e iluminação diferentes, e sem isso Calisto sairia
tão clara quanto Encélado. Onde a sonda não fotografou (valor 0), o buraco é preenchido com a média em volta.

Uso: python3 gerar_luas.py [id ...]   (sem ids: todas)
Saída: texturas/2k_<id>.jpg e, para Encélado e Fobos, texturas/relevo/<id>_2048.png (16 bits, como os outros).
Precisa de numpy e Pillow.
"""
import io, json, math, os, struct, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(AQUI, '..', 'texturas')
S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/'
JPL = 'https://space.jpl.nasa.gov/tmaps/pix/'
W_SAIDA, H_SAIDA = 2048, 1024

# id: (arquivo, cor do corpo em js/corpos.js, quanto da cor tingir um mosaico cinza)
LUAS = {
    'io': ('Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif', 0xe6cf63, 0),
    'europa': ('Europa_Voyager_GalileoSSI_global_mosaic_500m.tif', 0xd8c9ad, 0.7),
    'ganimedes': ('Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif', 0xa09584, 0),
    'calisto': ('Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif', 0x756a5b, 0.7),
    # Mimas: só existe dentro de um zip do DLR (mosaic/Mimas/Cassini_DLR_Mimas.zip), extraído em dados/brutos/luas/mimas
    'mimas': ('local:brutos/luas/mimas/Cassini_DLR/MI_170630_DLR_basemap_degrees.tif', 0xc9c6c0, 0.5),
    'encelado': ('Enceladus_Cassini_mosaic_global_110m.tif', 0xf2f4f7, 0.5),
    'tetis': ('Tethys_Cassini_mosaic_global_293m.tif', 0xdedbd5, 0.5),
    'dione': ('Dione_Cassini_Voyager_mosaic_global_154m.tif', 0xd2cfca, 0.5),
    'reia': ('Rhea_Cassini_Voyager_mosaic_global_417m.tif', 0xcac6bf, 0.5),
    'japeto': ('Iapetus_Cassini_Voyager_mosaic_global_783m.tif', 0x9a8f80, 0.7),
    'tritao': ('Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif', 0xd6c9c2, 0),
    'plutao': ('Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif', 0xc9b39a, 0.8),
    'caronte': ('Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif', 0xa8a29c, 0.5),
    'fobos': ('Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif', 0x8a7d70, 0.6),
    # luas de Urano: a Voyager 2 só viu o hemisfério sul; mapas do USGS no Solar System Simulator do JPL (1440 × 720)
    'ariel': ('jpl:ura1vuu2.jpg', 0xc4c2be, 0.5),
    'umbriel': ('jpl:ura2vuu2.jpg', 0x7d7a76, 0.5),
    'titania': ('jpl:ura3vuu2.jpg', 0xb2aca4, 0.5),
    'oberon': ('jpl:ura4vuu2.jpg', 0xa59c92, 0.5),
    'miranda': ('jpl:ura5vuu2.jpg', 0xb8b8b8, 0.5),
}
# relevo global (só o mapa, sem ladrilhos): (arquivo, deslocamento do primeiro byte, largura, altura, tipo, sem dado)
RELEVO = {
    'encelado': ('Enceladus/enceladus_cassini_iss_shapemodel_bland_2019/enceladus_2019pm_topography.tif', None, 720, 360, '<f4', None),
    'fobos': ('Phobos_ME_HRSC_DEM_Global_2ppd.tif', None, 699, 349, '<i2', -32768),
}


def baixar(url, a=None, n=None):
    for tentativa in range(8):
        try:
            h = {'Range': f'bytes={a}-{a + n - 1}'} if a is not None else {}
            d = urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=180).read()
            if n is None or len(d) == n:
                return d
        except Exception as e:
            print('  erro, tentando de novo:', e, file=sys.stderr)
        time.sleep(2 + tentativa * 3)
    raise RuntimeError(f'não baixou {url}')


def ler_tiff(url):
    """Cabeçalho de um GeoTIFF clássico sem compressão: tamanho, bandas, faixas e georreferência."""
    h = baixar(url, 0, 16)
    bo = '<' if h[:2] == b'II' else '>'
    off = struct.unpack(bo + 'I', h[4:8])[0]
    n = struct.unpack(bo + 'H', baixar(url, off, 2))[0]
    raw = baixar(url, off + 2, n * 12)
    TAM = {1: 1, 2: 1, 3: 2, 4: 4, 12: 8}
    tags = {}
    for i in range(n):
        tag, tipo, cont = struct.unpack(bo + 'HHI', raw[i * 12:i * 12 + 8])
        val = raw[i * 12 + 8:i * 12 + 12]
        tam = TAM.get(tipo, 1) * cont
        dado = val[:tam] if tam <= 4 else baixar(url, struct.unpack(bo + 'I', val)[0], tam)
        fmt = {1: 'B', 2: 's', 3: 'H', 4: 'I', 12: 'd'}.get(tipo)
        if fmt == 's':
            tags[tag] = dado.decode(errors='replace').strip('\x00')
        elif fmt:
            tags[tag] = struct.unpack(bo + f'{cont}{fmt}', dado)
    assert tags.get(259, (1,))[0] == 1, 'comprimido'
    # meridiano central da projeção (GeoKey 3088): vários mosaicos do USGS são centrados em 180°, não em 0°
    centro = 0.0
    chaves, duplos = tags.get(34735, ()), tags.get(34736, ())
    for j in range(4, len(chaves), 4):
        if chaves[j] in (3088, 3080) and chaves[j + 1] == 34736:
            centro = duplos[chaves[j + 3]]
    W, H = tags[256][0], tags[257][0]
    bandas = tags.get(277, (1,))[0]
    linhas_faixa = tags.get(278, (H,))[0]
    escala, ponto = tags[33550], tags[33922]
    return dict(W=W, H=H, bandas=bandas, bits=tags[258][0], planar=tags.get(284, (1,))[0], faixas=tags[273],
                linhas_faixa=linhas_faixa, escala=escala[0], x0=ponto[3], centro=centro, ordem=bo)


def reduzir(url, info):
    """Média em blocos para 2048 × 1024 (centros de pixel), por banda, ignorando o valor 0 (sem foto)."""
    W, H, nb = info['W'], info['H'], info['bandas']
    assert info['planar'] == 2 or nb == 1, 'bandas intercaladas'
    assert info['linhas_faixa'] == 1, 'mais de uma linha por faixa'
    # longitude do centro de cada coluna: começa em x0 (metros do meridiano 0 no equador, em escala)
    graus_px = 360.0 / W
    lon0 = info['centro'] + info['x0'] / info['escala'] * graus_px  # borda oeste do mapa
    lon = lon0 + (np.arange(W) + 0.5) * graus_px
    lon = (lon + 180.0) % 360.0 - 180.0
    col = np.minimum(((lon + 180.0) / 360.0 * W_SAIDA).astype(np.int64), W_SAIDA - 1)
    soma = np.zeros((nb, H_SAIDA, W_SAIDA))
    cont = np.zeros((nb, H_SAIDA, W_SAIDA))
    bloco = 64

    def ler(b, j0):
        j1 = min(j0 + bloco, H)
        a, z = info['faixas'][b * H + j0], info['faixas'][b * H + j1 - 1] + W
        assert z - a == (j1 - j0) * W, 'faixas fora de ordem'
        return b, j0, np.frombuffer(baixar(url, a, z - a), np.uint8).reshape(j1 - j0, W)
    tarefas = [(b, j0) for b in range(nb) for j0 in range(0, H, bloco)]
    with ThreadPoolExecutor(6) as ex:
        for k, (b, j0, d) in enumerate(ex.map(lambda t: ler(*t), tarefas)):
            lin = np.minimum(((np.arange(j0, j0 + d.shape[0]) + 0.5) / H * H_SAIDA).astype(np.int64), H_SAIDA - 1)
            ok = d > 0
            for r in np.unique(lin):
                sel = lin == r
                soma[b, r] += np.bincount(col, (d[sel] * ok[sel]).sum(0).astype(np.float64), minlength=W_SAIDA)
                cont[b, r] += np.bincount(col, ok[sel].sum(0).astype(np.float64), minlength=W_SAIDA)
            if k % 40 == 0:
                print(f'  {k}/{len(tarefas)} blocos', flush=True)
    with np.errstate(invalid='ignore'):
        img = soma / cont
    return img, cont > 0


def ampliar(m, forma):
    """Amplia uma grade grosseira com interpolação bilinear (sem os degraus de repetir pixels); NaN se espalha."""
    H, W = forma
    fy = np.clip((np.arange(H) + 0.5) * m.shape[0] / H - 0.5, 0, m.shape[0] - 1.0001)
    fx = np.clip((np.arange(W) + 0.5) * m.shape[1] / W - 0.5, 0, m.shape[1] - 1.0001)
    y0, x0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
    ty, tx = (fy - y0)[:, None], fx - x0
    return (m[y0][:, x0] * (1 - tx) + m[y0][:, x0 + 1] * tx) * (1 - ty) + (m[y0 + 1][:, x0] * (1 - tx) + m[y0 + 1][:, x0 + 1] * tx) * ty


def preencher(img, ok, borda=3):
    """Buracos (sem foto) ganham um preenchimento liso: a média dos dados em volta, espalhada por difusão numa grade
    grosseira (64 × 128) e ampliada com interpolação bilinear. A borda das fotos (muitas vezes escurecida) sai antes."""
    img = img.copy()
    for _ in range(borda):  # erosão da área com foto
        ok = ok & np.roll(ok, 1, 0) & np.roll(ok, -1, 0) & np.roll(ok, 1, 1) & np.roll(ok, -1, 1)
    falta = ~ok
    if not falta.any():
        return img
    H, W = img.shape
    gh, gw = 64, 128
    yi = np.minimum(np.arange(H) * gh // H, gh - 1)
    xi = np.minimum(np.arange(W) * gw // W, gw - 1)
    v = np.zeros((gh, gw)); p = np.zeros((gh, gw))
    np.add.at(v, (yi[:, None].repeat(W, 1)[ok], xi[None, :].repeat(H, 0)[ok]), img[ok])
    np.add.at(p, (yi[:, None].repeat(W, 1)[ok], xi[None, :].repeat(H, 0)[ok]), 1)
    tem = p > max(1, (H // gh) * (W // gw) * 0.3)  # célula com foto suficiente
    g = np.where(tem, v / np.maximum(p, 1), img[ok].mean())
    for _ in range(2000):  # difusão: as células sem foto viram a média das vizinhas
        viz = (np.roll(g, 1, 1) + np.roll(g, -1, 1) + np.vstack([g[:1], g[:-1]]) + np.vstack([g[1:], g[-1:]])) / 4
        g = np.where(tem, g, viz)
    f = ampliar(g, img.shape)
    img[falta] = f[falta]
    return img


def ajustar(rgb, cor, tinta):
    """Brilho médio igual ao da cor do corpo, por uma curva de gama (clareia ou escurece sem estourar os claros);
    um mosaico cinza ganha parte do tom da cor."""
    c = np.array([(cor >> 16) & 255, (cor >> 8) & 255, cor & 255], np.float64) / 255.0
    alvo = min(c.mean(), 0.72)  # nas luas de gelo (Encélado ~0,95), clarear até o fim apagaria o relevo da foto
    rgb = np.clip(rgb, 1e-4, 1)
    lo, hi = 0.05, 20.0
    for _ in range(40):  # gama tal que a média dê a da cor do corpo
        g = math.sqrt(lo * hi)
        if (rgb ** g).mean() > alvo:
            lo = g
        else:
            hi = g
    rgb = rgb ** g
    if tinta:
        rgb = rgb * (1 + tinta * (c / c.mean() - 1))[:, None, None]
    return np.clip(rgb, 0, 1)


def textura(id_):
    arq, cor, tinta = LUAS[id_]
    t0 = time.time()
    if arq.startswith('jpl:') or arq.startswith('local:'):
        Image.MAX_IMAGE_PIXELS = None
        fonte = io.BytesIO(baixar(JPL + arq[4:])) if arq.startswith('jpl:') else os.path.join(AQUI, arq[6:])
        im = Image.open(fonte).convert('L')
        if im.width > W_SAIDA:  # o de Mimas (−180 a 180, como a saída) é maior que ela
            im = im.resize((W_SAIDA, H_SAIDA), Image.LANCZOS)
        g = np.asarray(im, np.float64)
        ok = g > 3  # preto: hemisfério que a Voyager não viu
        g = preencher(g, ok) / 255.0
        print(f'{id_}: {arq.split(":", 1)[1]} ({g.shape[1]} × {g.shape[0]}), {100 * (1 - ok.mean()):.0f}% sem foto (preenchido)', flush=True)
        rgb = np.repeat(g[None], 3, 0)
    else:
        cache = os.path.join(AQUI, 'brutos', 'luas', f'{id_}.npz')  # o mosaico já reduzido: ajustes não baixam de novo
        if os.path.exists(cache):
            z = np.load(cache)
            img, ok = z['img'], z['ok']
            print(f'{id_}: {arq} (reduzido, do cache)', flush=True)
        else:
            url = S3 + arq
            info = ler_tiff(url)
            print(f'{id_}: {arq} ({info["W"]} × {info["H"]}, {info["bandas"]} banda(s), começa em {(info["centro"] + info["x0"] / info["escala"] * 360 / info["W"] + 180) % 360 - 180:.0f}°)', flush=True)
            img, ok = reduzir(url, info)
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            np.savez_compressed(cache, img=img.astype(np.float32), ok=ok)
        img = np.stack([preencher(img[b], ok[b]) for b in range(img.shape[0])]) / 255.0
        rgb = np.repeat(img, 3, 0) if img.shape[0] == 1 else img
        print(f'  {100 * (1 - ok[0].mean()):.1f}% sem foto (preenchido)', flush=True)
    rgb = ajustar(rgb, cor, tinta)
    saida = os.path.join(TEX, f'2k_{id_}.jpg')
    Image.fromarray(np.uint8(np.rint(rgb.transpose(1, 2, 0) * 255)), 'RGB').save(saida, quality=88)
    print(f'  {saida} ({os.path.getsize(saida) / 1e6:.1f} MB, {time.time() - t0:.0f} s)', flush=True)


def relevo(id_):
    arq, _, W, H, tipo, nulo = RELEVO[id_]
    url = S3 + arq
    info = ler_tiff(url)
    assert (info['W'], info['H']) == (W, H)
    b = np.dtype(tipo).itemsize
    a, z = info['faixas'][0], info['faixas'][-1] + (info['linhas_faixa'] * W * b)
    d = np.frombuffer(baixar(url, a, min(z, a + W * H * b) - a), tipo).reshape(H, W).astype(np.float64)
    ok = np.isfinite(d) & (d > -1e30) & ((d != nulo) if nulo is not None else True)
    lon0 = info['centro'] + info['x0'] / info['escala'] * 360.0 / W
    # gira para começar em −180 e amplia para 2048 × 1024 (bilinear; o mapa da fonte é grosseiro)
    d = preencher(np.where(ok, d, 0), ok, borda=0)
    # as colunas das bordas da fonte vêm ruins (em Fobos, centenas de metros fora, o que vira uma vala escura em 180°):
    # as mais perto da emenda saem, e as pontas boas são ligadas em linha reta, linha a linha
    g = max(2, W // 100)
    a, b = d[:, W - g - 1].copy(), d[:, g].copy()
    for k, col in enumerate(list(range(W - g, W)) + list(range(g))):
        t = (k + 1) / (2 * g + 1)
        d[:, col] = a * (1 - t) + b * t
    desloc = int(round((lon0 + 180.0) / 360.0 * W)) % W
    d = np.roll(d, desloc, 1)
    fy = np.clip((np.arange(H_SAIDA) + 0.5) / H_SAIDA * H - 0.5, 0, H - 1.0001)
    fx = (np.arange(W_SAIDA) + 0.5) / W_SAIDA * W - 0.5
    y0, x0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
    ty, tx = (fy - y0)[:, None], fx - x0
    xa, xb = x0 % W, (x0 + 1) % W
    m = (d[y0][:, xa] * (1 - tx) + d[y0][:, xb] * tx) * (1 - ty) + (d[y0 + 1][:, xa] * (1 - tx) + d[y0 + 1][:, xb] * tx) * ty
    # a fonte é grosseira (2–3 pixels dela por 8 de saída): a interpolação bilinear deixa vincos na borda de cada pixel
    # da fonte, e a luz marca esses vincos como linhas; uma suavização do tamanho de um pixel da fonte tira os vincos
    r = max(1, int(round(W_SAIDA / W / 2)))
    for _ in range(3):
        m = (np.roll(m, 1, 1) + m + np.roll(m, -1, 1)) / 3 if r == 1 else sum(np.roll(m, k, 1) for k in range(-r, r + 1)) / (2 * r + 1)
        m = np.vstack([m[:r], sum(m[r + k:H_SAIDA - r + k] for k in range(-r, r + 1)) / (2 * r + 1), m[-r:]])
    km = m / 1000.0
    lo, hi = float(np.floor(km.min() * 100) / 100), float(np.ceil(km.max() * 100) / 100)
    v = np.rint((km - lo) / (hi - lo) * 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), np.uint8)
    rgb[..., 0], rgb[..., 1] = v >> 8, v & 255
    saida = os.path.join(TEX, 'relevo', f'{id_}_2048.png')
    Image.fromarray(rgb, 'RGB').save(saida, optimize=True)
    print(f'{id_}: relevo de {lo} a {hi} km → {saida}', flush=True)


def main():
    ids = sys.argv[1:] or list(LUAS) + list(RELEVO)
    for i in ids:
        if i in LUAS:
            textura(i)
    for i in ids:
        if i in RELEVO:
            relevo(i)


if __name__ == '__main__':
    main()
