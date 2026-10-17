#!/usr/bin/env python3
"""Dados técnicos das fichas (dados/fichas_dados.json), com a fonte de cada número, para servir de pesquisa.

- Planetas, Lua e Plutão: NASA Planetary Fact Sheet (NSSDCA); Sol: NASA Sun Fact Sheet.
- Luas: JPL Solar System Dynamics — parâmetros físicos (GM, raio, densidade), elementos orbitais médios e as
  circunstâncias de descoberta (ano e descobridor, segundo o IAU WGPSN).
- Ceres e Vesta: JPL Small-Body Database (física, órbita e descoberta).
- Galáxias e lugares do universo: descoberta registrada aqui (fontes históricas), com o link do objeto no NED.
- Estrelas: dados/estrelas_info.json, do HYG v4.1 (números de catálogo, coordenadas, magnitude, tipo espectral), para
  as estrelas com nome, as que têm planetas e as que estão a menos de 25 parsecs.

Os textos (rótulos e nomes) vão em português; a interface traduz. Uso: python3 gerar_fichas.py
Só biblioteca padrão.
"""
import csv, html, json, math, os, re, struct, time, urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
G = 6.6743e-20  # km³/(kg·s²)

FONTES = {
    'nasa': ['NASA Planetary Fact Sheet (NSSDCA/GSFC)', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/'],
    'nasaSol': ['NASA Sun Fact Sheet (NSSDCA/GSFC)', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html'],
    'jplFis': ['JPL Solar System Dynamics: parâmetros físicos dos satélites', 'https://ssd.jpl.nasa.gov/sats/phys_par/'],
    'jplElem': ['JPL Solar System Dynamics: elementos orbitais médios dos satélites', 'https://ssd.jpl.nasa.gov/sats/elem/'],
    'jplDesc': ['JPL Solar System Dynamics: descoberta dos satélites (IAU WGPSN)', 'https://ssd.jpl.nasa.gov/sats/discovery.html'],
    'sbdb': ['JPL Small-Body Database', 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html'],
    'hyg': ['HYG Database v4.1 (astronexus.com, CC BY-SA 4.0)', 'https://github.com/astronexus/HYG-Database'],
    'exo': ['NASA Exoplanet Archive (NASA/Caltech-IPAC)', 'https://exoplanetarchive.ipac.caltech.edu/'],
    'ned': ['NASA/IPAC Extragalactic Database (NED)', 'https://ned.ipac.caltech.edu/'],
}
PLANETAS = {'MERCURY': 'mercurio', 'VENUS': 'venus', 'EARTH': 'terra', 'MOON': 'lua', 'MARS': 'marte', 'JUPITER': 'jupiter',
            'SATURN': 'saturno', 'URANUS': 'urano', 'NEPTUNE': 'netuno', 'PLUTO': 'plutao'}
LUAS = {'Phobos': 'fobos', 'Deimos': 'deimos', 'Io': 'io', 'Europa': 'europa', 'Ganymede': 'ganimedes', 'Callisto': 'calisto',
        'Mimas': 'mimas', 'Enceladus': 'encelado', 'Tethys': 'tetis', 'Dione': 'dione', 'Rhea': 'reia', 'Titan': 'tita',
        'Iapetus': 'japeto', 'Miranda': 'miranda', 'Ariel': 'ariel', 'Umbriel': 'umbriel', 'Titania': 'titania',
        'Oberon': 'oberon', 'Triton': 'tritao', 'Charon': 'caronte'}
NOMES = {'Galileo': 'Galileu Galilei', 'A. Hall': 'Asaph Hall', 'W. Herschel': 'William Herschel', 'G.D. Cassini': 'Giovanni Domenico Cassini',
         'C. Huygens': 'Christiaan Huygens', 'W. Lassell': 'William Lassell', 'G. Kuiper': 'Gerard Kuiper', 'J.W. Christy': 'James Christy'}
# planetas: descoberta (os cinco visíveis a olho nu são conhecidos desde a Antiguidade)
DESC_PLANETAS = {
    'mercurio': ['Antiguidade', 'conhecido desde a Antiguidade (visível a olho nu)'],
    'venus': ['Antiguidade', 'conhecido desde a Antiguidade (visível a olho nu)'],
    'marte': ['Antiguidade', 'conhecido desde a Antiguidade (visível a olho nu)'],
    'jupiter': ['Antiguidade', 'conhecido desde a Antiguidade (visível a olho nu)'],
    'saturno': ['Antiguidade', 'conhecido desde a Antiguidade (visível a olho nu)'],
    'urano': ['1781', 'William Herschel, com telescópio (o primeiro planeta descoberto assim)'],
    'netuno': ['1846', 'Johann Galle, no lugar previsto pelos cálculos de Urbain Le Verrier'],
    'plutao': ['1930', 'Clyde Tombaugh, no Observatório Lowell'],
}
# galáxias e lugares (id em js/corpos.js): [ano, por, nome no NED ou None]
DESC_GALAXIAS = {
    'centro': ['1974', 'Bruce Balick e Robert Brown (a fonte de rádio Sgr A*)', 'Sgr A*'],
    'vialactea': ['Antiguidade', 'visível a olho nu; Galileu viu em 1610 que é feita de estrelas', None],
    'gnm': ['Antiguidade', 'visível a olho nu no hemisfério sul; descrita por al-Sufi em 964', 'LMC'],
    'pnm': ['Antiguidade', 'visível a olho nu no hemisfério sul; registrada pela expedição de Fernão de Magalhães (1519)', 'SMC'],
    'sagitario': ['1994', 'Rodrigo Ibata, Gerry Gilmore e Mike Irwin', 'Sagittarius Dwarf Spheroidal'],
    'andromeda': ['964', 'Abd al-Rahman al-Sufi; Edwin Hubble mostrou em 1925 que é outra galáxia', 'M31'],
    'm32': ['1749', 'Guillaume Le Gentil', 'M32'],
    'm110': ['1773', 'Charles Messier', 'M110'],
    'triangulo': ['1764', 'Charles Messier (talvez vista antes por Giovanni Hodierna)', 'M33'],
    'barnard': ['1884', 'Edward Emerson Barnard', 'NGC 6822'],
    'm81': ['1774', 'Johann Elert Bode', 'M81'],
    'm82': ['1774', 'Johann Elert Bode', 'M82'],
    'escultor': ['1783', 'Caroline Herschel', 'NGC 253'],
    'm83': ['1752', 'Nicolas-Louis de Lacaille', 'M83'],
    'm64': ['1779', 'Edward Pigott (e, dias depois, Johann Elert Bode)', 'M64'],
    'm101': ['1781', 'Pierre Méchain', 'M101'],
    'm51': ['1773', 'Charles Messier; Lord Rosse viu a espiral em 1845', 'M51'],
    'm63': ['1779', 'Pierre Méchain', 'M63'],
    'sombreiro': ['1781', 'Pierre Méchain', 'M104'],
    'm87': ['1781', 'Charles Messier; o buraco negro foi fotografado pelo Event Horizon Telescope em 2019', 'M87'],
    'ngc1300': ['1835', 'John Herschel', 'NGC 1300'],
    'rodacarro': ['1941', 'Fritz Zwicky', 'Cartwheel Galaxy'],
    'ic1101': ['1790', 'William Herschel', 'IC 1101'],
    'virgem': ['1781', 'Charles Messier notou o ajuntamento de "nebulosas"', 'Virgo Cluster'],
    'coma': ['1785', 'William Herschel notou o ajuntamento; em 1933, Fritz Zwicky deduziu daqui a matéria escura', 'Coma Cluster'],
    'atrator': ['1987', 'os "Sete Samurais" (Alan Dressler, Donald Lynden-Bell, Sandra Faber e colegas)', None],
    'q3c273': ['1963', 'Maarten Schmidt (o primeiro quasar identificado)', '3C 273'],
    'jades': ['2024', 'equipe JADES, com o telescópio James Webb (Stefano Carniani e colegas)', 'JADES-GS-z14-0'],
}


def baixar(url):
    for t in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'viagem-pelo-espaco'}), timeout=120).read()
        except Exception as e:
            erro = e
            time.sleep(3 + 5 * t)
    raise erro


def tabela(url, cod='utf-8'):
    s = baixar(url).decode(cod, errors='replace')
    out = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', s, flags=re.S | re.I):
        cel = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', c))).strip()
               for c in re.findall(r'<t[dh][^>]*>(.*?)(?=<t[dh]|</tr>|$)', tr, flags=re.S | re.I)]
        if cel:
            out.append(cel)
    return out


def numero(t):
    t = (t or '').replace(',', '').replace('*', '').strip()
    m = re.match(r'^-?\d+(\.\d*)?([eE][-+]?\d+)?', t)
    return float(m.group(0)) if m else None


def fatos_planetas():
    linhas = tabela(FONTES['nasa'][1])
    cab = linhas[0][1:]
    ids = [PLANETAS[c] for c in cab]
    rot = {}
    for l in linhas[1:]:
        if len(l) >= len(ids) + 1:
            rot[l[0]] = l[1:len(ids) + 1]
    def col(prefixo):
        k = next((k for k in rot if k.startswith(prefixo)), None)
        if k is None:
            raise KeyError(prefixo)
        return rot[k]
    campos = {
        'massa': (col('Mass'), 1e24), 'diametro': (col('Diameter'), 1), 'densidade': (col('Density'), 1),
        'gravidade': (col('Gravity'), 1), 'escape': (col('Escape Velocity'), 1), 'rotacao': (col('Rotation Period'), 1),
        'dia': (col('Length of Day'), 1), 'semieixo': (col('Distance from Sun'), 1e6), 'perielio': (col('Perihelion'), 1e6),
        'afelio': (col('Aphelion'), 1e6), 'periodo': (col('Orbital Period'), 1), 'velOrbital': (col('Orbital Velocity'), 1),
        'inclinacao': (col('Orbital Inclination'), 1), 'excentricidade': (col('Orbital Eccentricity'), 1),
        'obliquidade': (col('Obliquity to Orbit'), 1), 'temperatura': (col('Mean Temperature'), 1),
        'pressao': (col('Surface Pressure'), 1), 'luas': (col('Number of Moons'), 1),
    }
    aneis, campo = col('Ring System'), col('Global Magnetic Field')
    saida = {}
    for j, id_ in enumerate(ids):
        d = {}
        for nome, (vals, fator) in campos.items():
            v = numero(vals[j])
            if v is not None:
                d[nome] = v * fator
        d['aneis'] = aneis[j].lower().startswith('yes')
        d['campoMagnetico'] = campo[j].lower().startswith('yes')
        d['fontes'] = ['nasa']
        saida[id_] = d
    # na coluna da Lua, as distâncias já são em volta da Terra (10⁶ km) e o período é o sideral (27,3 dias)
    return saida


def fatos_sol():
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', baixar(FONTES['nasaSol'][1]).decode('latin-1'))))
    def pega(rotulo):
        m = re.search(re.escape(rotulo) + r'[^0-9\-+]*([-+]?[\d,]+\.?\d*)', t)
        if not m:
            raise KeyError(rotulo)
        return float(m.group(1).replace(',', ''))
    return {'massa': pega('Mass (10 24 kg)') * 1e24, 'diametro': pega('Volumetric mean radius (km)') * 2,
            'densidade': pega('Mean density (kg/m 3 )'), 'gravidade': pega('Surface gravity (eq.) (m/s 2 )'),
            'escape': pega('Escape velocity (km/s)'), 'rotacao': pega('Sidereal rotation period (hrs)*'),
            'obliquidade': pega('Obliquity to ecliptic (deg.)'), 'luminosidade': pega('Luminosity (10 24 J/s)') * 1e24,
            'tipoEspectral': 'G2 V', 'fontes': ['nasaSol']}


def fatos_luas():
    fis = {}
    for l in tabela(FONTES['jplFis'][1]):
        if len(l) >= 10 and l[1] in LUAS:  # cada valor, margem e referência numa célula: GM, raio e densidade em 3, 6 e 9
            gm, r, rho = numero(l[3]), numero(l[6]), numero(l[9])
            fis[LUAS[l[1]]] = (gm, r, rho)
    elem = {}
    for l in tabela(FONTES['jplElem'][1]):
        if len(l) >= 14 and l[2] in LUAS and LUAS[l[2]] not in elem:
            elem[LUAS[l[2]]] = dict(semieixo=numero(l[7]), excentricidade=numero(l[8]), inclinacao=numero(l[11]), periodo=numero(l[13]))
    desc = {}
    for l in tabela(FONTES['jplDesc'][1]):
        if len(l) >= 5 and l[1] in LUAS:
            desc[LUAS[l[1]]] = (l[3], NOMES.get(l[4], l[4]))
    saida = {}
    for id_ in LUAS.values():
        d, fontes = {}, []
        if id_ in fis and fis[id_][0]:
            gm, r, rho = fis[id_]
            d.update(massa=gm / G, diametro=2 * r, densidade=rho * 1000 if rho else None,
                     gravidade=gm / r ** 2 * 1000, escape=math.sqrt(2 * gm / r))
            fontes.append('jplFis')
        if id_ in elem:
            d.update({k: v for k, v in elem[id_].items() if v is not None})
            fontes.append('jplElem')
        if id_ in desc:
            d['descobertaAno'], d['descobertaPor'] = desc[id_]
            fontes.append('jplDesc')
        d = {k: v for k, v in d.items() if v is not None}
        d['fontes'] = fontes
        saida[id_] = d
    # a Lua da NASA tem mais campos; o JPL dá o GM moderno: os dois ficam (a NASA por cima)
    return saida


def fatos_asteroides():
    saida = {}
    for id_, num_ in (('ceres', 1), ('vesta', 4)):
        j = json.loads(baixar(f'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr={num_}&phys-par=1&discovery=1&full-prec=1'))
        fis = {p['name']: p['value'] for p in j.get('phys_par', [])}
        orb = {e['name']: e['value'] for e in j['orbit']['elements']}
        gm, diam = float(fis['GM']), float(fis['diameter'])
        r = diam / 2
        d = dict(massa=gm / G, diametro=diam, densidade=float(fis['density']) * 1000 if fis.get('density') else gm / G / (4 / 3 * math.pi * (r * 1e3) ** 3),
                 gravidade=gm / r ** 2 * 1000, escape=math.sqrt(2 * gm / r), rotacao=float(fis['rot_per']),
                 albedo=float(fis['albedo']), semieixo=float(orb['a']) * 149597870.7, excentricidade=float(orb['e']),
                 inclinacao=float(orb['i']), periodo=float(orb['per']), perielio=float(orb['q']) * 149597870.7,
                 afelio=float(orb['ad']) * 149597870.7)
        if fis.get('extent'):
            d['dimensoes'] = fis['extent'].replace(' x ', ' × ') + ' km'
        dsc = j.get('discovery', {})
        if dsc.get('date'):
            d['descobertaAno'] = dsc['date'][:4]
        if dsc.get('who'):
            quem = {'Piazzi, G.': 'Giuseppe Piazzi', 'Olbers, H. W.': 'Heinrich Olbers'}.get(dsc['who'], dsc['who'])
            d['descobertaPor'] = quem
            if dsc.get('location'):
                d['descobertaLocal'] = dsc['location']
            d['descobertaData'] = time.strftime('%Y-%m-%d', time.strptime(dsc['date'], '%Y-%b-%d'))
        d['fontes'] = ['sbdb']
        saida[id_] = d
    return saida


def estrelas_info():
    """Liga cada estrela de dados/estrelas.bin à linha do HYG pela distância, magnitude absoluta e cor (que não
    mudam com a rotação das coordenadas da cena) e guarda os dados de catálogo das que importam para as fichas."""
    bruto = open(os.path.join(AQUI, 'estrelas.bin'), 'rb').read()
    n = len(bruto) // 20
    b = struct.unpack(f'<{n * 5}f', bruto)
    nomes = {i for i, *_ in json.load(open(os.path.join(AQUI, 'estrelas_nomes.json')))}
    hosp = {e['h'] for e in json.load(open(os.path.join(AQUI, 'exoplanetas.json')))['estrelas'] if e['h'] >= 0}
    # par mais próximo em distância, magnitude absoluta e cor (o .bin guarda em precisão simples)
    quero = {}
    for i in range(n):
        x, y, z, am, ci = b[i * 5:i * 5 + 5]
        d = math.sqrt(x * x + y * y + z * z)
        if i in nomes or i in hosp or d < 25:
            quero.setdefault(round(d, 1), []).append((i, d, am, ci))
    melhor = {}
    for linha in csv.DictReader(open(os.path.join(AQUI, 'brutos', 'hygdata_v41.csv'))):
        if linha['id'] == '0':
            continue
        try:
            d, am, ci = float(linha['dist']), float(linha['absmag']), float(linha['ci'] or 0.65)  # sem cor no HYG: 0,65, como no .bin
        except ValueError:
            continue
        for k in (round(d, 1), round(d - 0.1, 1), round(d + 0.1, 1)):
            for i, d2, am2, ci2 in quero.get(k, ()):
                # a distância pode diferir até ~1% (estrelas de movimento próprio grande); brilho e cor, quase nada
                erro = abs(d - d2) / max(d, 1e-3) * 10 + abs(am - am2) + abs(ci - ci2)
                if erro < 0.12 and abs(am - am2) < 0.02 and erro < melhor.get(i, (9,))[0]:
                    melhor[i] = (erro, linha)
    saida = {}
    for i, (_, linha) in melhor.items():
        cat = {c: linha[c] for c in ('hip', 'hd', 'hr', 'gl') if linha[c]}
        bayer = ' '.join(x for x in (linha['bayer'] or linha['flam'], linha['con']) if x) if (linha['bayer'] or linha['flam']) else ''
        saida[i] = [cat, float(linha['ra']), float(linha['dec']), float(linha['mag']), linha['spect'],
                    round(float(linha['dist']), 3), bayer, linha['con']]
    faltam = sum(len(v) for v in quero.values()) - len(saida)
    print(f'  estrelas: {len(saida)} casadas com o HYG, {faltam} sem par')
    return saida


def main():
    corpos = fatos_planetas()
    corpos['sol'] = fatos_sol()
    for id_, d in fatos_luas().items():
        if id_ in corpos:  # a Lua: os campos da NASA ficam; entram a descoberta e o que faltar
            for k, v in d.items():
                if k == 'fontes':
                    corpos[id_]['fontes'] += [f for f in v if f not in corpos[id_]['fontes']]
                elif k not in corpos[id_]:
                    corpos[id_][k] = v
        else:
            corpos[id_] = d
    corpos.update(fatos_asteroides())
    for id_, (ano, por) in DESC_PLANETAS.items():
        corpos[id_]['descobertaAno'], corpos[id_]['descobertaPor'] = ano, por
    galaxias = {}
    for id_, (ano, por, ned) in DESC_GALAXIAS.items():
        galaxias[id_] = {'descobertaAno': ano, 'descobertaPor': por}
        if ned:
            galaxias[id_]['ned'] = 'https://ned.ipac.caltech.edu/byname?objname=' + urllib.request.quote(ned)
    arred = lambda v: float(f'{v:.6g}') if isinstance(v, float) else v
    corpos = {k: {c: arred(v) for c, v in d.items()} for k, d in corpos.items()}
    saida = {'consultado': time.strftime('%Y-%m-%d'), 'fontes': FONTES, 'corpos': corpos, 'galaxias': galaxias}
    json.dump(saida, open(os.path.join(AQUI, 'fichas_dados.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    est = estrelas_info()
    json.dump({'fonte': 'hyg', 'campos': ['catálogos', 'ra (h)', 'dec (°)', 'magnitude aparente', 'tipo espectral', 'distância (pc)', 'Bayer/Flamsteed', 'constelação'],
               'estrelas': est}, open(os.path.join(AQUI, 'estrelas_info.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(corpos)} corpos, {len(galaxias)} galáxias e lugares, {len(est)} estrelas com dados de catálogo')
    for id_ in ('terra', 'lua', 'tita', 'ceres', 'caronte', 'sol'):
        print(' ', id_, {k: v for k, v in corpos[id_].items() if k in ('massa', 'diametro', 'densidade', 'gravidade', 'descobertaAno', 'descobertaPor', 'periodo')})


if __name__ == '__main__':
    main()
