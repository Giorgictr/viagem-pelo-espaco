#!/usr/bin/env python3
"""Exoplanetas confirmados do NASA Exoplanet Archive (tabela pscomppars, um valor por planeta) → dados/exoplanetas.json.

Cada estrela hospedeira é casada com a estrela do catálogo HYG no mesmo lugar (dados/estrelas.bin, já em
coordenadas da cena); as que não estão no HYG (a maioria das do Kepler, fracas e distantes) vão com a posição
própria e entram no catálogo de estrelas quando o app carrega.

Uso: python3 baixar_exoplanetas.py [arquivo.csv já baixado]
Só biblioteca padrão.
"""
import csv, io, json, math, os, struct, sys, time, urllib.parse, urllib.request
from collections import defaultdict

AQUI = os.path.dirname(os.path.abspath(__file__))
TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/async'
COLUNAS = ('pl_name,hostname,sy_snum,sy_pnum,discoverymethod,disc_year,disc_facility,pl_orbper,pl_orbsmax,pl_rade,pl_bmasse,'
           'pl_orbeccen,pl_orbincl,pl_orblper,pl_tranmid,pl_eqt,pl_insol,st_teff,st_rad,st_mass,st_spectype,ra,dec,sy_dist,sy_vmag,'
           'gaia_dr3_id,hip_name,hd_name')
OBLIQ = math.radians(23.4392911)


def baixar():
    """Consulta assíncrona (a síncrona cai por tempo limite quando o arquivo está lento)."""
    corpo = urllib.parse.urlencode({'query': f'select {COLUNAS} from pscomppars', 'format': 'csv', 'REQUEST': 'doQuery',
                                    'LANG': 'ADQL', 'PHASE': 'RUN'}).encode()
    req = urllib.request.Request(TAP, data=corpo, method='POST')
    opener = urllib.request.build_opener(type('SemRedir', (urllib.request.HTTPRedirectHandler,), {'redirect_request': lambda *a: None}))
    try:
        r = opener.open(req, timeout=300)
        job = r.headers['Location']
    except urllib.error.HTTPError as e:
        job = e.headers['Location']
    print('consulta:', job)
    for _ in range(120):
        fase = urllib.request.urlopen(job + '/phase', timeout=60).read().decode().strip()
        if fase in ('COMPLETED', 'ERROR', 'ABORTED'):
            break
        time.sleep(10)
    if fase != 'COMPLETED':
        raise RuntimeError(f'consulta terminou em {fase}')
    return urllib.request.urlopen(job + '/results/result', timeout=600).read().decode()


def num(v):
    try:
        return float(v) if v not in ('', None) else None
    except ValueError:
        return None


def arred(v, k):
    return None if v is None else round(v, k)


def cena(ra, dec, d):
    """Mesma conta de radecParaCena (js/corpos.js): equatorial → eclíptica → eixos da cena."""
    ra, dec = math.radians(ra), math.radians(dec)
    x, y, z = d * math.cos(dec) * math.cos(ra), d * math.cos(dec) * math.sin(ra), d * math.sin(dec)
    ce, se = math.cos(OBLIQ), math.sin(OBLIQ)
    ye, ze = y * ce + z * se, -y * se + z * ce
    return (x, ze, -ye)


def temperatura(bv):  # igual a js/estrelas.js (Ballesteros 2012; anãs M por tabela)
    bv = min(max(bv, -0.4), 2.0)
    if bv > 1.4:
        tab = [(1.4, 3900), (1.5, 3600), (1.6, 3400), (1.7, 3200), (1.8, 3050), (1.9, 2900), (2.0, 2800)]
        for (x0, y0), (x1, y1) in zip(tab, tab[1:]):
            if bv <= x1:
                return y0 + (y1 - y0) * (bv - x0) / (x1 - x0)
        return 2800
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))


def bv_de(T):
    a, b = -0.4, 2.0  # temperatura cai com B−V
    for _ in range(50):
        m = (a + b) / 2
        if temperatura(m) > T:
            a = m
        else:
            b = m
    return (a + b) / 2


def raio_de_massa(m):  # Terras; relação de Chen e Kipping (2017), simplificada
    if m < 2.0:
        return m ** 0.279
    if m < 130:
        return 0.808 * m ** 0.589
    return 12.1  # gigantes: ~1,1 raio de Júpiter, quase independente da massa


def massa_de_raio(r):
    if r < 1.21:
        return r ** (1 / 0.279)
    if r < 14:
        return (r / 0.808) ** (1 / 0.589)
    return 300.0


def main():
    if len(sys.argv) > 1:
        texto = open(sys.argv[1]).read()
    else:
        texto = baixar()
    linhas = list(csv.DictReader(io.StringIO(texto)))
    print(len(linhas), 'planetas')

    # HYG em grade de 1 pc para casar as hospedeiras
    bruto = open(os.path.join(AQUI, 'estrelas.bin'), 'rb').read()
    n = len(bruto) // 20
    hyg = struct.unpack(f'<{n * 5}f', bruto)
    grade = defaultdict(list)
    for i in range(n):
        x, y, z = hyg[i * 5:i * 5 + 3]
        grade[(math.floor(x), math.floor(y), math.floor(z))].append(i)

    estrelas = {}
    for p in linhas:
        h = p['hostname']
        if h not in estrelas:
            estrelas[h] = dict(linha=p, planetas=[])
        estrelas[h]['planetas'].append(p)

    saida, casadas = [], 0
    for h, e in estrelas.items():
        p = e['linha']
        ra, dec, d = num(p['ra']), num(p['dec']), num(p['sy_dist'])
        if ra is None or dec is None or d is None:
            continue
        T = num(p['st_teff']) or 5500.0
        R = num(p['st_rad'])
        mst = num(p['st_mass']) or 1.0
        V = num(p['sy_vmag'])
        if V is not None:
            M = V - 5 * math.log10(d) + 5
        else:  # pela luminosidade (sem correção bolométrica: aproximado)
            L = (R or 1.0) ** 2 * (T / 5772) ** 4
            M = 4.83 - 2.5 * math.log10(L)
        pos = cena(ra, dec, d)
        # estrela do HYG no mesmo lugar: direção, distância e brilho parecidos
        melhor, nota = -1, 1e9
        lim = 300 if d < 25 else 30  # segundos de arco: as próximas andam até 10"/ano entre as épocas dos catálogos
        r = max(1, math.ceil(d * 0.15))
        cx, cy, cz = (math.floor(c) for c in pos)
        if r <= 6:
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    for dz in range(-r, r + 1):
                        for i in grade.get((cx + dx, cy + dy, cz + dz), ()):
                            x, y, z, mag = hyg[i * 5:i * 5 + 4]
                            dh = math.sqrt(x * x + y * y + z * z)
                            ang = math.acos(max(-1, min(1, (x * pos[0] + y * pos[1] + z * pos[2]) / (dh * d))))
                            if ang < math.radians(lim / 3600) and abs(dh - d) / d < 0.15 and abs(mag - M) < 1.5:
                                s = ang * 3600 + abs(mag - M)
                                if s < nota:
                                    melhor, nota = i, s
        if melhor >= 0:
            casadas += 1
        pls = []
        for q in sorted(e['planetas'], key=lambda q: num(q['pl_orbsmax']) or num(q['pl_orbper']) or 1e9):
            a, P = num(q['pl_orbsmax']), num(q['pl_orbper'])
            Rp, Mp = num(q['pl_rade']), num(q['pl_bmasse'])
            est = 0
            if a is None and P is not None:
                a = (mst * (P / 365.25) ** 2) ** (1 / 3); est |= 4
            if P is None and a is not None:
                P = 365.25 * math.sqrt(a ** 3 / mst)
            if a is None:
                continue
            if Rp is None and Mp is not None:
                Rp = raio_de_massa(Mp); est |= 1
            if Mp is None and Rp is not None:
                Mp = massa_de_raio(Rp); est |= 2
            if Rp is None:
                Rp, Mp, est = 11.0, 300.0, est | 3
            pls.append({
                'n': q['pl_name'], 'a': round(a, 6), 'P': arred(P, 5), 'e': arred(num(q['pl_orbeccen']), 3),
                'i': arred(num(q['pl_orbincl']), 2), 'w': arred(num(q['pl_orblper']), 1), 'tm': arred(num(q['pl_tranmid']), 5),
                'R': round(Rp, 3), 'M': round(Mp, 2), 'Teq': arred(num(q['pl_eqt']), 0), 'S': arred(num(q['pl_insol']), 3),
                'ano': int(num(q['disc_year']) or 0), 'met': q['discoverymethod'], 'onde': q['disc_facility'], 'est': est,
            })
        if not pls:
            continue
        item = {'n': h, 'h': melhor, 'd': round(d, 3), 'T': round(T), 'R': arred(R, 3), 'm': round(mst, 3),
                'sp': p['st_spectype'] or None, 'pl': pls}
        if melhor < 0:
            item['p'] = [round(c, 4) for c in pos]
            item['M'] = round(M, 2)
            item['bv'] = round(bv_de(T), 3)
        saida.append(item)
    saida.sort(key=lambda e: e['d'])
    with open(os.path.join(AQUI, 'exoplanetas.json'), 'w') as f:
        json.dump({'fonte': 'NASA Exoplanet Archive (pscomppars), NASA/Caltech-IPAC', 'data': time.strftime('%Y-%m-%d'),
                   'estrelas': saida}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(saida)} estrelas ({casadas} no HYG), {sum(len(e["pl"]) for e in saida)} planetas')


if __name__ == '__main__':
    main()
