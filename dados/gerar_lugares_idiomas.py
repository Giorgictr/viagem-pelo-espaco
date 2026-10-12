#!/usr/bin/env python3
"""Nomes dos lugares da Terra (dados/terra_camadas.json) em inglês e espanhol, do Natural Earth.

Cada lugar é casado com o recurso do Natural Earth mais perto (pela posição) no arquivo do seu tipo; o nome sai
dos campos NAME_EN/NAME_ES. Saída: dados/idiomas/lugares.<idioma>.json, com as mesmas listas e na mesma ordem
do terra_camadas.json (só os nomes; o país de cada cidade vai traduzido também).

Uso: python3 gerar_lugares_idiomas.py   (precisa de dados/brutos/natural-earth)
"""
import json, math, os

AQUI = os.path.dirname(os.path.abspath(__file__))
NE = os.path.join(AQUI, 'brutos', 'natural-earth')
ARQUIVOS = {
    'cidades': ('ne_10m_populated_places.geojson', 'NAME_EN', 'NAME_ES', 'NAME'),
    'paises': ('ne_50m_admin_0_countries.geojson', 'NAME', 'NAME_ES', 'NAME'),  # em inglês, o nome curto
    'mares': ('ne_50m_geography_marine_polys.geojson', 'name_en', 'name_es', 'name'),
    'picos': ('ne_10m_geography_regions_elevation_points.geojson', 'name_en', 'name_es', 'name'),
    'regioes': ('ne_10m_geography_regions_points.geojson', 'name_en', 'name_es', 'name'),
}


def centro(geo):
    """Ponto representativo: o próprio ponto, ou a média dos vértices do maior anel."""
    t, c = geo['type'], geo['coordinates']
    if t == 'Point':
        return c[1], c[0]
    aneis = [c[0]] if t == 'Polygon' else [p[0] for p in c]
    anel = max(aneis, key=len)
    return sum(p[1] for p in anel) / len(anel), sum(p[0] for p in anel) / len(anel)


def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    return math.acos(max(-1, min(1, math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(lo1 - lo2))))


def maiuscula(s):
    return s[:1].upper() + s[1:] if s else s


def main():
    camadas = json.load(open(os.path.join(AQUI, 'terra_camadas.json')))
    saida = {'en': {}, 'es': {}}
    pais_pt = {}
    for tipo, (arq, en, es, base) in ARQUIVOS.items():
        feats = json.load(open(os.path.join(NE, arq)))['features']
        pts = [(centro(f['geometry']), f['properties']) for f in feats if f['geometry']]
        for lang in saida:
            saida[lang][tipo] = []
        for item in camadas[tipo]:
            nome, la, lo = item[0], item[1], item[2]
            # mesmo nome em português primeiro; senão, o mais perto
            cand = [p for p in pts if (p[1].get('NAME_PT') or p[1].get('name_pt')) == nome]
            (pos, props) = min(cand or pts, key=lambda p: dist((la, lo), p[0]))
            for lang, campo in (('en', en), ('es', es)):
                n = props.get(campo) or props.get(base) or nome
                saida[lang][tipo].append(maiuscula(n) if tipo in ('mares', 'regioes') else n)
            if tipo == 'paises':
                pais_pt[nome] = {'en': props.get(en) or nome, 'es': props.get(es) or nome}
    # país das cidades
    for lang in saida:
        saida[lang]['paisDasCidades'] = [pais_pt.get(c[4], {}).get(lang, c[4]) if c[4] else '' for c in camadas['cidades']]
    os.makedirs(os.path.join(AQUI, 'idiomas'), exist_ok=True)
    for lang, d in saida.items():
        with open(os.path.join(AQUI, 'idiomas', f'lugares.{lang}.json'), 'w') as f:
            json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
        print(lang, {k: len(v) for k, v in d.items()}, 'ex.:', d['cidades'][:3], d['paises'][:3], d['mares'][:2])


if __name__ == '__main__':
    main()
