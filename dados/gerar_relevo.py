#!/usr/bin/env python3
"""Ladrilhos de relevo da Lua, de Marte, de Mercúrio, de Ceres, de Vesta e de Titã (mosaicos globais do USGS Astrogeology;
Titã: grade montada por preparar_tita.py).

Lê o GeoTIFF original em blocos de linhas direto do S3 do USGS (o arquivo não é guardado: a Lua tem 8,5 GB),
monta o globo inteiro até o nível zGlobal e, nas regiões de destaque, guarda a resolução nativa até zMax.

Ladrilhos no mesmo esquema do NASA Trek (grade de latitude e longitude): no nível z há 2^(z+1) × 2^z ladrilhos,
cada um com 180/2^z graus de lado. Cada ladrilho tem 259 × 259 amostras: 257 nos cantos da grade de 256 células
(as bordas são iguais nos dois vizinhos) e mais uma de cada lado, para calcular a inclinação na borda.
Altura = (R·256 + G − 32768) × passo[z] (metros), em WebP sem perdas. O passo cresce com o espaçamento entre
pontos (~1/250 dele, em potências de 2 da unidade do arquivo): o erro de inclinação fica abaixo de 0,2% e os
bits de ruído, que não se comprimem, saem.

Uso: python3 gerar_relevo.py lua|marte|mercurio|ceres|vesta|tita [--formato webp|png] [--saida dados/relevo]
     python3 gerar_relevo.py lua --so-regioes   (refaz só as regiões de destaque, lendo só as linhas delas)
     python3 gerar_relevo.py lua --requantizar   (ladrilhos já gravados com o passo da unidade do arquivo)
     python3 gerar_relevo.py vesta --so-mapa     (refaz só o mapa global de 16 bits, dos ladrilhos do nível 3)
Precisa de numpy e Pillow.
"""
import argparse, atexit, json, math, os, shutil, sys, tempfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import numpy as np
from PIL import Image

T = 256
S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/'
SEM_DADO = -32768

# inicio: posição do primeiro byte de dados (as linhas são contínuas, int16, sem compressão — conferido)
CORPOS = {
    'lua': dict(raio=1737400.0, arq='Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif', W=92160, H=46080, inicio=738233, ppd=256.0, lon0=-180.0,
                escala=0.5, zg=5, credito='LRO LOLA LDEM 118 m (NASA/GSFC), mosaico do USGS Astrogeology'),
    'marte': dict(raio=3396190.0, arq='Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif', W=106694, H=53347, inicio=854272,
                  ppd=1 / 0.003374120830641, lon0=-180.0, escala=1.0, zg=5,
                  credito='MGS MOLA e Mars Express HRSC, mistura de 200 m (NASA/ESA/DLR/FU Berlin), mosaico do USGS Astrogeology'),
    'mercurio': dict(raio=2439400.0, arq='Mercury_Messenger_USGS_DEM_Global_665m_v2.tif', W=23040, H=11520, inicio=92981, ppd=64.0, lon0=0.0,
                     escala=0.5, zg=5, credito='MESSENGER MDIS 665 m (NASA/JHUAPL/Carnegie), mosaico do USGS Astrogeology'),
    # Ceres e Vesta (Dawn, DLR): o arquivo traz o raio de cada ponto (Ceres: em metros acima de 470 km; Vesta: em metros),
    # e não a altura; 'soma' converte para altura sobre a esfera do corpo. Os dados começam 1 byte antes do que diz o
    # rótulo (que conta a partir de 1). Vesta é achatada: a "altura" vai de −40 a +30 km e inclui a forma do corpo.
    'ceres': dict(raio=470000.0, arq='Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif', W=21600, H=10800, inicio=87217, ppd=60.0,
                  lon0=0.0, escala=1.0, zg=5, soma=0.0,
                  credito='Dawn FC HAMO DTM 137 m (NASA/JPL-Caltech/UCLA/MPS/DLR/IDA), mosaico do USGS Astrogeology'),
    'vesta': dict(raio=262700.0, arq='Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif', W=17280, H=8640, inicio=69785, ppd=48.0,
                  lon0=-180.0, escala=1.0, zg=5, tipo='<f4', soma=-262700.0,
                  credito='Dawn FC HAMO DTM 93 m (NASA/JPL-Caltech/UCLA/MPS/DLR/IDA), mosaico do USGS Astrogeology'),
    # Titã: alturas sobre a esfera de 2575 km; o corpo tem 2574,7
    # Plutão e Caronte (New Horizons, 300 m): só o hemisfério visto de perto tem relevo; o resto é preenchido liso.
    # Conferir o meridiano central (GeoKey 3088) de cada arquivo: o de Plutão é 180°, o de Caronte, 0°
    'plutao': dict(raio=1188300.0, arq='Pluto_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif', W=24888, H=12444, inicio=100199,
                   ppd=24888 / 360.0, lon0=0.0, escala=1.0, zg=5,  # projeção centrada em 180°: o arquivo começa em 0°
                   credito='New Horizons LORRI e MVIC, 300 m (NASA/JHUAPL/SwRI), mosaico do USGS Astrogeology'),
    'caronte': dict(raio=606000.0, arq='Charon_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif', W=12693, H=6347, inicio=51427,
                    ppd=12693 / 360.0, lon0=-180.0, escala=1.0, zg=5,
                    credito='New Horizons LORRI e MVIC, 300 m (NASA/JHUAPL/SwRI), mosaico do USGS Astrogeology'),
    'tita': dict(raio=2574700.0, local='brutos/tita/tita_32ppd.npy', W=11520, H=5760, ppd=32.0, lon0=-180.0, escala=1.0, zg=4, soma=300.0,
                 credito='Cassini RADAR: altimetria, SARTopo e estéreo, interpolados (Corlies et al. 2017, Cornell, CC0)'),
}

# Regiões de destaque com a resolução nativa: (nome, lat mín, lat máx, lon mín, lon máx, nível máximo)
REGIOES = {
    'lua': [
        ('Apollo 11', -0.8, 2.2, 22.0, 25.0, 7), ('Apollo 12 e 14', -5.0, -1.5, -25.0, -16.0, 7),
        ('Apollo 15', 24.6, 27.6, 2.1, 5.1, 7), ('Apollo 16', -10.5, -7.5, 14.0, 17.0, 7),
        ('Apollo 17', 18.7, 21.7, 29.3, 32.3, 7), ('Tycho', -46.0, -40.6, -14.5, -8.2, 7),
        ('Copérnico', 7.0, 12.2, -23.0, -17.2, 7), ('Aristarco', 21.5, 26.0, -50.5, -44.5, 7),
        ('Chang\'e 3', 42.6, 45.6, -21.0, -18.0, 7), ('Chang\'e 4 (Von Kármán)', -47.5, -43.3, 174.0, 179.9, 7),
    ],
    'marte': [
        ('Monte Olimpo', 12.5, 25.0, -141.0, -126.5, 7), ('Valles Marineris', -15.0, -2.0, -95.0, -30.0, 6),
        ('Valles Marineris (centro)', -13.0, -3.5, -80.0, -58.0, 7), ('Gale (Curiosity)', -7.0, -3.8, 136.2, 139.4, 7),
        ('Jezero (Perseverance)', 16.8, 20.0, 75.9, 79.1, 7), ('Gusev (Spirit)', -16.2, -13.0, 173.8, 177.0, 7),
        ('Meridiani (Opportunity)', -3.6, -0.3, -7.2, -3.8, 7), ('Utopia (Zhurong)', 23.5, 26.7, 108.3, 111.5, 7),
        ('Elysium (InSight)', 2.9, 6.1, 134.0, 137.2, 7), ('Chryse (Viking 1)', 20.7, 23.9, -49.6, -46.4, 7),
        ('Ares Vallis (Pathfinder)', 17.5, 20.7, -34.8, -31.6, 7),
    ],
    'mercurio': [], 'ceres': [], 'vesta': [], 'tita': [], 'plutao': [], 'caronte': [],
}


def baixar(url, a, n):
    for tentativa in range(8):
        try:
            req = urllib.request.Request(url, headers={'Range': f'bytes={a}-{a + n - 1}'})
            d = urllib.request.urlopen(req, timeout=180).read()
            if len(d) == n:
                return d
        except Exception as e:
            print('  erro, tentando de novo:', e, file=sys.stderr)
        time.sleep(2 + tentativa * 3)
    raise RuntimeError(f'não baixou {a}+{n}')


def blocos(cfg, linhas=64, paralelo=4):
    """Gera (j0, matriz float32 em unidades do arquivo, NaN sem dado) em ordem, com alguns blocos baixando à frente."""
    W, H = cfg['W'], cfg['H']
    if 'local' in cfg:  # grade já pronta em disco
        a = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), cfg['local']), mmap_mode='r')
        for j0 in range(0, H, linhas):
            yield j0, np.asarray(a[j0:j0 + linhas], np.float32) + np.float32(cfg.get('soma', 0))
        return
    tipo = cfg.get('tipo', '<i2')
    b = np.dtype(tipo).itemsize
    url = S3 + cfg['arq']

    def converter(raw, n):
        d = np.frombuffer(raw, tipo).reshape(n, W)
        if tipo == '<i2':
            v = d.astype(np.float32)
            v[d == SEM_DADO] = np.nan
        else:
            v = np.where(np.isfinite(d) & (d > -1e30), d, np.nan).astype(np.float32)
        return v + np.float32(cfg.get('soma', 0))
    inicios = list(range(0, H, linhas))
    with ThreadPoolExecutor(paralelo) as ex:
        fila = []
        for k, j0 in enumerate(inicios):
            j1 = min(j0 + linhas, H)
            fila.append((j0, j1, ex.submit(baixar, url, cfg['inicio'] + j0 * W * b, (j1 - j0) * W * b)))
            if len(fila) > paralelo + 2 or k == len(inicios) - 1:
                while fila and (len(fila) > paralelo or k == len(inicios) - 1):
                    a, c, f = fila.pop(0)
                    yield a, converter(f.result(), c - a)


def ajustar(cfg, reg):
    """Amplia a região até a grade dos ladrilhos do primeiro nível regional (todos os níveis a cobrem inteira)."""
    nome, la0, la1, lo0, lo1, zr = reg
    vao = 180.0 / 2 ** (cfg['zg'] + 1)
    x0, x1 = math.floor((lo0 + 180) / vao), math.ceil((lo1 + 180) / vao)
    y0, y1 = math.floor((90 - la1) / vao), math.ceil((90 - la0) / vao)
    return (nome, 90 - y1 * vao, 90 - y0 * vao, x0 * vao - 180, x1 * vao - 180, zr)


def janela(cfg, reg):
    """Linhas e colunas do arquivo que cobrem a região, com folga para a borda extra e o filtro."""
    nome, la0, la1, lo0, lo1, zr = reg
    ppd, m = cfg['ppd'], 0.1
    j0, j1 = max(int((90 - la1 - m) * ppd), 0), min(int(math.ceil((90 - la0 + m) * ppd)), cfg['H'])
    i0, i1 = max(int((lo0 + 180 - m) * ppd), 0), min(int(math.ceil((lo1 + 180 + m) * ppd)), cfg['W'])
    return j0, j1, i0, i1


def ler_janelas(cfg, regioes):
    """Só as janelas das regiões, uma linha por pedido (muitos em paralelo)."""
    assert cfg['lon0'] == -180.0 and cfg.get('tipo', '<i2') == '<i2' and 'local' not in cfg and not cfg.get('soma')
    url, W = S3 + cfg['arq'], cfg['W']
    janelas = []
    with ThreadPoolExecutor(16) as ex:
        for reg in regioes:
            j0, j1, i0, i1 = janela(cfg, reg)
            t0 = time.time()
            linhas = ex.map(lambda j: np.frombuffer(baixar(url, cfg['inicio'] + (j * W + i0) * 2, (i1 - i0) * 2), '<i2'), range(j0, j1))
            janelas.append(dict(nome=reg[0], j0=j0, i0=i0, dados=np.stack(list(linhas))))
            print(f'  {reg[0]}: {j1 - j0} × {i1 - i0} em {time.time() - t0:.0f} s', flush=True)
    return janelas


def lon_colunas(cfg):
    lon = cfg['lon0'] + (np.arange(cfg['W']) + 0.5) / cfg['ppd']
    return (lon + 180.0) % 360.0 - 180.0


def ler(cfg, regioes):
    """Uma passada pelo arquivo: globo médio no nível zg + janelas nativas das regiões."""
    zg, W, H, ppd = cfg['zg'], cfg['W'], cfg['H'], cfg['ppd']
    Wt, Ht = 2 ** (zg + 1) * T, 2 ** zg * T
    dt = 180.0 / Ht
    cidx = np.rint((lon_colunas(cfg) + 180.0) / dt).astype(np.int64) % Wt
    # as duas grades ficam em arquivos (memória mapeada): com outros programas abertos, 8 GB não davam conta
    tmp = tempfile.mkdtemp(prefix='relevo_')
    atexit.register(shutil.rmtree, tmp, True)
    soma = np.lib.format.open_memmap(os.path.join(tmp, 'soma.npy'), 'w+', np.float32, (Ht + 1, Wt))
    cont = np.lib.format.open_memmap(os.path.join(tmp, 'cont.npy'), 'w+', np.uint8, (Ht + 1, Wt))  # poucos pontos por ponto da grade: 1 byte basta
    janelas = []
    for reg in regioes:
        assert cfg['lon0'] == -180.0
        j0, j1, i0, i1 = janela(cfg, reg)
        janelas.append(dict(nome=reg[0], j0=j0, i0=i0, dados=np.full((j1 - j0, i1 - i0), np.nan, np.float32)))
    t0, feito = time.time(), 0
    for j0, d in blocos(cfg):
        n = d.shape[0]
        valido = ~np.isnan(d)
        v = np.where(valido, d, 0)
        lat = 90.0 - (np.arange(j0, j0 + n) + 0.5) / ppd
        r = np.clip(np.rint((90.0 - lat) / dt).astype(np.int64), 0, Ht)
        for rr in np.unique(r):
            sel = r == rr
            soma[rr] += np.bincount(cidx, v[sel].sum(0), minlength=Wt).astype(np.float32)
            cont[rr] += np.bincount(cidx, valido[sel].sum(0).astype(np.float64), minlength=Wt).astype(np.uint8)
        for J in janelas:
            a, b = max(j0, J['j0']), min(j0 + n, J['j0'] + J['dados'].shape[0])
            if a < b:
                J['dados'][a - J['j0']:b - J['j0']] = d[a - j0:b - j0, J['i0']:J['i0'] + J['dados'].shape[1]]
        feito += n
        if feito % (64 * 50) < 64:
            dec = time.time() - t0
            print(f'  {feito}/{H} linhas, {dec:.0f} s, faltam ~{dec / feito * (H - feito):.0f} s', flush=True)
    with np.errstate(invalid='ignore', divide='ignore'):
        g = np.divide(soma, cont, out=soma)  # no lugar: sem outra grade inteira na memória
    falta = cont == 0
    del cont
    if falta.any():
        print(f'  {falta.sum()} pontos sem dado ({100 * falta.mean():.1f}%): preenchidos com a média em volta, sem degraus', flush=True)
        preencher_grade(g, falta)
    return g, janelas


def preencher_grade(g, falta, k=16):
    """Buracos da grade global ganham a média dos dados em volta: numa grade k × k vezes menor, preenchida por difusão,
    e ampliada de volta com interpolação bilinear (em faixas, para caber na memória)."""
    H1, W = g.shape
    h, w = (H1 - 1) // k, W // k
    v, p = np.zeros((h, w)), np.zeros((h, w))
    for i in range(h):  # em faixas de k linhas, sem cópia da grade inteira
        f = falta[i * k:(i + 1) * k, :w * k]
        v[i] = np.where(f, 0, g[i * k:(i + 1) * k, :w * k]).reshape(k, w, k).sum((0, 2), dtype=np.float64)
        p[i] = (~f).reshape(k, w, k).sum((0, 2), dtype=np.float64)
    # células sem dado: difusão (cada uma vira a média das vizinhas, até assentar), sem os degraus de níveis grosseiros
    tem = p > 0
    grosso = np.where(tem, v / np.maximum(p, 1), (v.sum() / max(p.sum(), 1)))
    for passo in range(3000):
        viz = (np.roll(grosso, 1, 1) + np.roll(grosso, -1, 1) + np.vstack([grosso[:1], grosso[:-1]]) + np.vstack([grosso[1:], grosso[-1:]])) / 4
        novo = np.where(tem, grosso, viz)
        if passo % 200 == 0 and np.abs(novo - grosso).max() < 0.05:
            break
        grosso = novo
    fx = np.clip((np.arange(W) + 0.5) / k - 0.5, 0, w - 1.0001)
    x0 = np.floor(fx).astype(int)
    tx = (fx - x0).astype(np.float32)
    for a0 in range(0, H1, 256):
        a1 = min(a0 + 256, H1)
        sel = falta[a0:a1]
        if not sel.any():
            continue
        fy = np.clip((np.arange(a0, a1) + 0.5) / k - 0.5, 0, h - 1.0001)
        y0 = np.floor(fy).astype(int)
        ty = (fy - y0)[:, None].astype(np.float32)
        b = (grosso[y0][:, x0] * (1 - tx) + grosso[y0][:, x0 + 1] * tx) * (1 - ty) + (grosso[y0 + 1][:, x0] * (1 - tx) + grosso[y0 + 1][:, x0 + 1] * tx) * ty
        g[a0:a1][sel] = b[sel]


def reduzir(g):
    """Grade de cantos (H+1, W) → (H/2+1, W/2) com filtro [1,2,1]/4 (longitude circular)."""
    a = (np.roll(g, 1, 1) + 2 * g + np.roll(g, -1, 1)) * 0.25
    a = a[:, ::2]
    b = a.copy()
    b[1:-1] = (a[:-2] + 2 * a[1:-1] + a[2:]) * 0.25
    return b[::2]


def ladrilho_global(gz, x, y):
    Hz, Wz = gz.shape[0] - 1, gz.shape[1]
    lin = np.clip(np.arange(y * T - 1, y * T + T + 2), 0, Hz)
    col = np.arange(x * T - 1, x * T + T + 2) % Wz
    return gz[np.ix_(lin, col)]


def bilinear(a, fy, fx):
    fy = np.clip(fy, 0, a.shape[0] - 1.0001)
    fx = np.clip(fx, 0, a.shape[1] - 1.0001)
    y0, x0 = np.floor(fy).astype(np.int64), np.floor(fx).astype(np.int64)
    ty, tx = fy - y0, fx - x0
    return ((a[y0, x0] * (1 - tx) + a[y0, x0 + 1] * tx) * (1 - ty) + (a[y0 + 1, x0] * (1 - tx) + a[y0 + 1, x0 + 1] * tx) * ty)


def ladrilhos_regiao(cfg, J, z, la0, la1, lo0, lo1):
    """Ladrilhos do nível z inteiramente dentro da região, da janela nativa (média em blocos + bilinear)."""
    ppd = cfg['ppd']
    vao = 180.0 / 2 ** z
    x0, x1 = math.ceil((lo0 + 180) / vao - 1e-6), math.floor((lo1 + 180) / vao + 1e-6)
    y0, y1 = math.ceil((90 - la1) / vao - 1e-6), math.floor((90 - la0) / vao + 1e-6)
    if x1 <= x0 or y1 <= y0:
        return None, []
    k = max(1, int(ppd / (T / vao)))  # média em blocos k × k antes de interpolar
    d = J['dados'].astype(np.float32)
    if J['dados'].dtype == np.int16:
        d[J['dados'] == SEM_DADO] = np.nan
    if np.isnan(d).any():
        print(f'  aviso: {J["nome"]} tem pontos sem dado', flush=True)
    h, w = (d.shape[0] // k) * k, (d.shape[1] // k) * k
    m = d[:h, :w].reshape(h // k, k, w // k, k).mean((1, 3))
    saida = []
    passo = vao / T
    for y in range(y0, y1):
        for x in range(x0, x1):
            lon = -180 + (x * T + np.arange(-1, T + 2)) * passo
            lat = 90 - (y * T + np.arange(-1, T + 2)) * passo
            # índice fracionário no bloco médio: centro do bloco b em (b·k + k/2) pixels da origem da janela
            fx = ((lon + 180) * ppd - J['i0']) / k - 0.5
            fy = ((90 - lat) * ppd - J['j0']) / k - 0.5
            FY, FX = np.meshgrid(fy, fx, indexing='ij')
            saida.append((x, y, bilinear(m, FY, FX)))
    return [x0, x1 - 1, y0, y1 - 1], saida


def passo(cfg, z):
    """Passo de altura do nível z, em unidades do arquivo (potência de 2)."""
    espac = cfg['raio'] * math.pi / 2 ** z / T
    minimo = math.ceil(math.log2(cfg['amp'] / 32000.0)) if cfg.get('amp') else 0  # alturas grandes (Vesta) cabem em 16 bits
    return 2 ** max(0, minimo, int(math.floor(math.log2(espac / 250.0 / cfg['escala']))))


def gravar(args):
    caminho, a, formato, q = args
    v = np.clip(np.rint(a / q) + 32768, 0, 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    im = Image.fromarray(rgb, 'RGB')
    if formato == 'webp':
        im.save(caminho, 'WEBP', lossless=True, quality=50, method=4, exact=True)
    else:
        im.save(caminho, 'PNG', optimize=True)
    return os.path.getsize(caminho)


def _requantizar(args):
    caminho, q = args
    px = np.asarray(Image.open(caminho)).astype(np.int32)
    v = px[..., 0] * 256 + px[..., 1] - 32768
    return gravar((caminho, v.astype(np.float32), caminho.rsplit('.', 1)[1], q))


def requantizar(a, cfg):
    arq = os.path.join(a.saida, f'{a.corpo}.json')
    man = json.load(open(arq))
    if 'passo' in man:
        print('já quantizado'); return
    base = os.path.join(a.saida, a.corpo)
    tarefas = []
    for z in sorted(os.listdir(base), key=int):
        for raiz, _, nomes in os.walk(os.path.join(base, z)):
            tarefas += [(os.path.join(raiz, n), passo(cfg, int(z))) for n in nomes]
    with ProcessPoolExecutor(os.cpu_count()) as ex:
        total = sum(ex.map(_requantizar, tarefas, chunksize=16))
    zmax = man['zMax']
    man.pop('escala', None)
    man['passo'] = [passo(cfg, z) * cfg['escala'] for z in range(zmax + 1)]
    json.dump(man, open(arq, 'w'), ensure_ascii=False, indent=1)
    print(f'{len(tarefas)} ladrilhos, {total / 1e6:.1f} MB; passos (m): {man["passo"]}')


def gravar_mapa(a, cfg, g3):
    """Mapa global (2048 × 1024, centros de pixel) para a esfera vista de longe, do nível 3 (4096 × 2049 cantos).
    Altura de 0 a 1 em 16 bits: byte alto no vermelho, baixo no verde (em Vesta, 8 bits dariam degraus de 300 m)."""
    pix = (g3[:-1] + g3[1:]) * 0.5
    pix = (pix + np.roll(pix, -1, 1)) * 0.5
    pix = pix.reshape(1024, 2, 2048, 2).mean((1, 3))
    hm = pix * cfg['escala'] / 1000.0
    lo, hi = float(np.floor(hm.min() * 100) / 100), float(np.ceil(hm.max() * 100) / 100)
    v = np.rint((hm - lo) / (hi - lo) * 65535).astype(np.uint16)
    rgb = np.zeros(v.shape + (3,), np.uint8)
    rgb[..., 0], rgb[..., 1] = v >> 8, v & 255
    os.makedirs(a.global_png, exist_ok=True)
    Image.fromarray(rgb, 'RGB').save(os.path.join(a.global_png, f'{a.corpo}_2048.png'), optimize=True)
    print(f'  mapa global: {a.corpo}_2048.png, de {lo} a {hi} km', flush=True)
    return lo, hi


def mapa_dos_ladrilhos(a, cfg):
    """Refaz só o mapa global, juntando os ladrilhos do nível 3 já gravados."""
    man = json.load(open(os.path.join(a.saida, f'{a.corpo}.json')))
    q = man['passo'][3] / cfg['escala']
    g3 = np.zeros((8 * T + 1, 16 * T), np.float32)
    for x in range(16):
        for y in range(8):
            px = np.asarray(Image.open(os.path.join(a.saida, a.corpo, '3', str(x), f'{y}.{man["formato"]}'))).astype(np.float32)
            t = (px[..., 0] * 256 + px[..., 1] - 32768) * q
            g3[y * T:y * T + T + 1, x * T:x * T + T] = t[1:T + 2, 1:T + 1]
    lo, hi = gravar_mapa(a, cfg, g3)
    man['mapaGlobal'] = [f'relevo/{a.corpo}_2048.png', lo, hi]
    json.dump(man, open(os.path.join(a.saida, f'{a.corpo}.json'), 'w'), ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('corpo', choices=CORPOS)
    ap.add_argument('--formato', default='webp', choices=['webp', 'png'])
    ap.add_argument('--saida', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'relevo'))
    ap.add_argument('--global-png', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'texturas', 'relevo'))
    ap.add_argument('--requantizar', action='store_true')
    ap.add_argument('--so-regioes', action='store_true')
    ap.add_argument('--so-mapa', action='store_true')
    a = ap.parse_args()
    cfg = CORPOS[a.corpo]
    regioes = [ajustar(cfg, r) for r in REGIOES[a.corpo]]
    if a.requantizar:
        return requantizar(a, cfg)
    if a.so_mapa:
        return mapa_dos_ladrilhos(a, cfg)
    base = os.path.join(a.saida, a.corpo)
    print(f'{a.corpo}: lendo {cfg.get("arq") or cfg["local"]}', flush=True)
    if a.so_regioes:
        g, janelas = None, ler_janelas(cfg, regioes)
    else:
        g, janelas = ler(cfg, regioes)
    if g is not None:
        cfg['amp'] = float(np.nanmax(np.abs(g)))
    ext = a.formato
    ex = ProcessPoolExecutor(os.cpu_count())
    pendentes, total, contagem = [], [0], [0]

    def guardar(caminho, t):
        z = int(caminho.split(os.sep)[-3])
        pendentes.append(ex.submit(gravar, (caminho, t, ext, passo(cfg, z))))
        contagem[0] += 1
        while len(pendentes) > 64:
            total[0] += pendentes.pop(0).result()

    if g is not None:
        # globo: do nível zg até 0
        gz, z = g, cfg['zg']
        niveis = {}
        while z >= 0:
            niveis[z] = gz
            for y in range(2 ** z):
                for x in range(2 ** (z + 1)):
                    guardar(os.path.join(base, str(z), str(x), f'{y}.{ext}'), np.rint(ladrilho_global(gz, x, y)).astype(np.int32))
            if z > 0:
                gz = reduzir(gz)
            z -= 1
        lo, hi = gravar_mapa(a, cfg, niveis[3])
    # regiões
    manifesto_regioes = []
    for (nome, la0, la1, lo0, lo1, zr), J in zip(regioes, janelas):
        info = dict(nome=nome, lat=[la0, la1], lon=[lo0, lo1], niveis={})
        for z in range(cfg['zg'] + 1, zr + 1):
            faixa, lad = ladrilhos_regiao(cfg, J, z, la0, la1, lo0, lo1)
            if not faixa:
                continue
            info['niveis'][z] = faixa
            for x, y, t in lad:
                guardar(os.path.join(base, str(z), str(x), f'{y}.{ext}'), np.rint(t).astype(np.int32))
        manifesto_regioes.append(info)
        print(f'  região {nome}: {info["niveis"]}', flush=True)
    del janelas
    for f in pendentes:
        total[0] += f.result()
    ex.shutdown()
    print(f'  {contagem[0]} ladrilhos, {total[0] / 1e6:.1f} MB', flush=True)
    zmax = max([cfg['zg']] + [r[5] for r in regioes])
    if g is None:  # só as regiões: o resto do manifesto continua
        anterior = json.load(open(os.path.join(a.saida, f'{a.corpo}.json')))
        lo, hi = anterior['mapaGlobal'][1:]
    manifesto = dict(corpo=a.corpo, formato=ext, passo=[passo(cfg, z) * cfg['escala'] for z in range(zmax + 1)], zGlobal=cfg['zg'],
                     zMax=zmax, credito=cfg['credito'],
                     mapaGlobal=[f'relevo/{a.corpo}_2048.png', lo, hi], regioes=manifesto_regioes)
    with open(os.path.join(a.saida, f'{a.corpo}.json'), 'w') as f:
        json.dump(manifesto, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
