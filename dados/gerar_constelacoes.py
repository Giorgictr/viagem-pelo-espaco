#!/usr/bin/env python3
"""Fichas das 88 constelações: dados (sem texto escrito à mão) e o desenho de cada figura.

Fontes (em dados/brutos/constelacoes, baixadas à mão; ver LICENCA em texturas/constelacoes):
- Stellarium, cultura "western" (github.com/Stellarium/stellarium-skycultures): index.json (CC BY-SA) com, para cada
  constelação, a ilustração e três estrelas de encaixe (número HIP e posição na imagem); ilustrações de Johan Meuris
  (Free Art License 1.3), copiadas para texturas/constelacoes.
- d3-celestial (© Olaf Frohn, BSD): nomes, genitivos, pontos dos rótulos, limites da UAI (J2000) e as linhas, as mesmas
  desenhadas no céu do programa.
- HYG v4.1 (CC BY-SA 4.0): estrelas (posição, brilho, distância, nome, Bayer, constelação).
- OpenNGC (CC BY-SA 4.0): em que constelação fica cada objeto de Messier.

Saída: dados/constelacoes_fichas.json, com a chave = abreviação da UAI.
Uso: python3 gerar_constelacoes.py
"""
import csv, json, math, os, shutil, datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
BR = os.path.join(AQUI, 'brutos', 'constelacoes')
OBL = math.radians(23.4392911)


ABREV = {
    'Oitante': 'Oct', 'Peixes': 'Psc', 'Baleia': 'Cet', 'Andrômeda': 'And', 'Cassiopeia': 'Cas', 'Fênix': 'Phe', 'Pégaso': 'Peg',
    'Tucano': 'Tuc', 'Hidra Macho': 'Hyi', 'Escultor': 'Scl', 'Cefeu': 'Cep', 'Erídano': 'Eri', 'Perseu': 'Per', 'Triângulo': 'Tri',
    'Áries': 'Ari', 'Fornalha': 'For', 'Ursa Menor': 'UMi', 'Relógio': 'Hor', 'Girafa': 'Cam', 'Touro': 'Tau', 'Retículo': 'Ret',
    'Dourado': 'Dor', 'Cinzel': 'Cae', 'Órion': 'Ori', 'Cocheiro': 'Aur', 'Lebre': 'Lep', 'Pomba': 'Col', 'Pintor': 'Pic',
    'Unicórnio': 'Mon', 'Gêmeos': 'Gem', 'Cão Maior': 'CMa', 'Lince': 'Lyn', 'Quilha': 'Car', 'Popa': 'Pup', 'Peixe Voador': 'Vol',
    'Cão Menor': 'CMi', 'Vela': 'Vel', 'Câncer': 'Cnc', 'Camaleão': 'Cha', 'Hidra': 'Hya', 'Ursa Maior': 'UMa', 'Bússola': 'Pyx',
    'Leão': 'Leo', 'Máquina Pneumática': 'Ant', 'Leão Menor': 'LMi', 'Dragão': 'Dra', 'Sextante': 'Sex', 'Taça': 'Crt',
    'Centauro': 'Cen', 'Virgem': 'Vir', 'Mosca': 'Mus', 'Cruzeiro do Sul': 'Cru', 'Corvo': 'Crv', 'Cabeleira de Berenice': 'Com',
    'Cães de Caça': 'CVn', 'Boieiro': 'Boo', 'Ave do Paraíso': 'Aps', 'Lobo': 'Lup', 'Compasso': 'Cir', 'Libra': 'Lib',
    'Triângulo Austral': 'TrA', 'Coroa Boreal': 'CrB', 'Serpente': 'Ser', 'Escorpião': 'Sco', 'Hércules': 'Her', 'Esquadro': 'Nor',
    'Serpentário': 'Oph', 'Altar': 'Ara', 'Pavão': 'Pav', 'Sagitário': 'Sgr', 'Coroa Austral': 'CrA', 'Telescópio': 'Tel',
    'Lira': 'Lyr', 'Escudo': 'Sct', 'Águia': 'Aql', 'Raposa': 'Vul', 'Cisne': 'Cyg', 'Flecha': 'Sge', 'Capricórnio': 'Cap',
    'Delfim': 'Del', 'Índio': 'Ind', 'Aquário': 'Aqr', 'Microscópio': 'Mic', 'Cavalo Menor': 'Equ', 'Peixe Austral': 'PsA',
    'Grou': 'Gru', 'Lagarto': 'Lac', 'Mesa': 'Men',
}


def cena_para_radec(x, y, z):
    """Inverso de equatorialParaCena (js/corpos.js): cena = (x, ze, −ye)."""
    ye, ze = -z, y
    ce, se = math.cos(OBL), math.sin(OBL)
    yq = ye * ce - ze * se
    zq = ye * se + ze * ce
    return math.degrees(math.atan2(yq, x)) % 360, math.degrees(math.asin(max(-1, min(1, zq))))


def unit(ra, dec):
    a, d = math.radians(ra), math.radians(dec)
    return (math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d))


def area_esferica(aneis):
    """Área (graus quadrados) de um polígono em lon/lat com lados curtos: soma de (λ2 − λ1)(2 + sen φ1 + sen φ2)/2."""
    tot = 0
    for anel in aneis:
        s = 0
        for (l1, p1), (l2, p2) in zip(anel, anel[1:] + anel[:1]):
            dl = math.radians(l2 - l1)
            if dl > math.pi: dl -= 2 * math.pi
            if dl < -math.pi: dl += 2 * math.pi
            s += dl * (2 + math.sin(math.radians(p1)) + math.sin(math.radians(p2)))
        tot += s / 2
    a = abs(tot) * (180 / math.pi) ** 2
    return min(a, 41252.96 - a)  # o anel pode ter sido percorrido "por fora"


def dentro(ra, dec, aneis):
    """Ponto (graus) dentro de um polígono de lon/lat (d3: lon = AR de −180 a 180), desenrolando a longitude."""
    for anel in aneis:
        pts, lon0 = [], None
        for lon, lat in anel:
            if lon0 is not None:
                while lon - lon0 > 180: lon -= 360
                while lon - lon0 < -180: lon += 360
            pts.append((lon, lat)); lon0 = lon
        for x in (ra, ra - 360, ra + 360, ra - 720):
            c = False
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                if (y1 > dec) != (y2 > dec) and x < x1 + (dec - y1) * (x2 - x1) / (y2 - y1):
                    c = not c
            if c:
                return True
    return False


def sol_radec(d):
    """Posição aproximada do Sol (graus) numa data (Almanaque Astronômico, baixa precisão, J2000)."""
    n = (datetime.datetime(d.year, d.month, d.day, 12) - datetime.datetime(2000, 1, 1, 12)).days
    L = (280.460 + 0.9856474 * n) % 360
    g = math.radians((357.528 + 0.9856003 * n) % 360)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    ra = math.degrees(math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))) % 360
    return ra, math.degrees(math.asin(math.sin(eps) * math.sin(lam)))


def main():
    ours = json.load(open(os.path.join(AQUI, 'constelacoes.json')))
    d3 = json.load(open(os.path.join(BR, 'd3_constellations.json')))['features']
    bounds = json.load(open(os.path.join(BR, 'd3_bounds.json')))['features']
    linhas = json.load(open(os.path.join(AQUI, 'brutos', 'd3-celestial', 'constellations.lines.json')))['features']
    stl = {c['iau']: c for c in json.load(open(os.path.join(BR, 'stellarium_western_index.json')))['constellations']}

    # nome em português → abreviação da UAI; a direção do rótulo (constelacoes.json) dá o centro
    abrev = {}
    for nome, x, y, z, *_ in ours:
        ra, dec = cena_para_radec(x, y, z)
        abrev[nome] = (ABREV[nome], ra, dec)
    assert len({a for a, *_ in abrev.values()}) == 88, 'abreviações repetidas'

    # áreas pelos limites (Serpente vem em dois pedaços)
    areas = {}
    for f in bounds:
        g = f['geometry']
        polis = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        areas[f['id']] = areas.get(f['id'], 0) + sum(area_esferica([[(p[0], p[1]) for p in anel[:-1] if True] for anel in pol]) for pol in polis)
    ordem = sorted(areas, key=lambda k: -areas[k])

    # estrelas (HYG)
    hip, porCon = {}, {}
    for r in csv.DictReader(open(os.path.join(AQUI, 'brutos', 'hygdata_v41.csv'))):
        if not r['hip'] or r['proper'] == 'Sol':
            continue
        mag = float(r['mag'])
        e = {'ra': float(r['ra']) * 15, 'dec': float(r['dec']), 'mag': mag, 'nome': r['proper'], 'bayer': r['bayer'],
             'flam': r['flam'], 'dist': float(r['dist']) if r['dist'] else None, 'con': r['con']}
        hip[int(r['hip'])] = e
        if mag <= 5.5:
            porCon.setdefault(r['con'], []).append(e)

    # Messier por constelação (OpenNGC)
    messier = {m['m']: m for m in json.load(open(os.path.join(AQUI, 'messier.json')))}
    conM = {}
    for arq in ('OpenNGC_NGC.csv', 'OpenNGC_addendum.csv'):
        for r in csv.DictReader(open(os.path.join(BR, arq)), delimiter=';'):
            if r['M'] and int(r['M']) in messier and int(r['M']) not in conM and r['Name'] != 'M102':
                conM[int(r['M'])] = 'Ser' if r['Const'] in ('Se1', 'Se2') else r['Const']

    # linhas de d3-celestial (as mesmas do céu do programa)
    linhasPor = {f['id']: f['geometry']['coordinates'] for f in linhas}

    # ilustrações: Argo Navis (Quilha) serve também a Popa e Vela; o Serpentário segura a Serpente
    emprestada = {'Pup': 'Car', 'Vel': 'Car', 'Ser': 'Oph'}
    destino = os.path.join(RAIZ, 'texturas', 'constelacoes')
    os.makedirs(destino, exist_ok=True)

    # por onde o Sol passa ao longo de 2026 (os limites são de 1875; a diferença para as datas de hoje é de horas)
    aneis = {}
    for f in bounds:
        g = f['geometry']
        polis = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        aneis.setdefault(f['id'], []).extend([[(p[0], p[1]) for p in anel] for pol in polis for anel in pol])
    passagens, atual = [], None
    for k in range(366 + 40):
        dia = datetime.date(2025, 12, 1) + datetime.timedelta(days=k)
        ra, dec = sol_radec(dia)
        con = next((c for c in ('Sgr', 'Cap', 'Aqr', 'Psc', 'Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Oph', 'Cet') if dentro(ra, dec, aneis[c])), '?')
        if con != atual:
            passagens.append([con, dia]); atual = con
    sol = {}
    for (con, ini), (_, fim) in zip(passagens, passagens[1:]):
        if ini.year == 2026 or fim.year == 2026:
            sol.setdefault(con, [ini.strftime('%m-%d'), (fim - datetime.timedelta(days=1)).strftime('%m-%d')])
    print('Sol:', sol)

    lista = {}
    for nome, (ab, ra, dec) in abrev.items():
        f3 = next(f for f in d3 if f['id'] == ab)['properties']
        estrelas = sorted(porCon.get(ab, []), key=lambda e: e['mag'])
        d = {
            'pt': nome, 'la': f3['name'], 'gen': f3['gen'], 'area': round(areas[ab], 1), 'posArea': ordem.index(ab) + 1,
            'centro': [round(ra, 3), round(dec, 3)],
            'estrelas': [[round(e['ra'], 3), round(e['dec'], 3), round(e['mag'], 2)] for e in estrelas],
            'principais': [[e['nome'], e['bayer'], e['flam'], round(e['mag'], 2), round(e['dist'] * 3.26156) if e['dist'] and e['dist'] < 100000 else None,
                            round(e['ra'], 3), round(e['dec'], 3)] for e in estrelas[:6]],
            'messier': [[m, messier[m]['nome'], messier[m]['tipo'], messier[m]['mag'], round(messier[m]['ra'], 3), round(messier[m]['dec'], 3)]
                        for m in sorted(m for m, c in conM.items() if c == ab)],
            'linhas': [[[round(lon % 360, 3), round(lat, 3)] for lon, lat in linha] for linha in linhasPor.get(ab, [])],
        }
        s = stl.get(emprestada.get(ab, ab))
        if s and 'image' in s:
            im = s['image']
            arq = os.path.basename(im['file'])
            shutil.copy(os.path.join(BR, 'ilustracoes', arq), os.path.join(destino, arq))
            d['figura'] = {'arq': arq, 'tam': im['size'],
                           'anc': [[a['pos'][0], a['pos'][1], round(hip[a['hip']]['ra'], 4), round(hip[a['hip']]['dec'], 4)] for a in im['anchors']]}
        # mês em que passa mais alto às 21 h (hora local): às 21 h do equinócio de setembro, culmina a AR 21 h
        dias = ((ra / 15 - 21) % 24) / 24 * 365.25
        d['mes21h'] = (datetime.date(2025, 9, 21) + datetime.timedelta(days=dias)).month
        if ab in sol:
            d['sol'] = sol[ab]
        lista[ab] = d

    json.dump({'consultado': datetime.date.today().isoformat(), 'lista': lista}, open(os.path.join(AQUI, 'constelacoes_fichas.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))
    for ab in ('Hya', 'Vir', 'UMa', 'Cru', 'Ori', 'Ser'):
        print(ab, lista[ab]['pt'], lista[ab]['area'], lista[ab]['posArea'], 'mês', lista[ab]['mes21h'], 'M', lista[ab]['messier'], lista[ab]['principais'][:2])
    print('sem figura:', [k for k, v in lista.items() if 'figura' not in v])
    print('tamanho:', os.path.getsize(os.path.join(AQUI, 'constelacoes_fichas.json')) // 1024, 'KB')


if __name__ == '__main__':
    main()
