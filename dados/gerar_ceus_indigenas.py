#!/usr/bin/env python3
"""Céus indígenas do Brasil: as constelações tupi-guarani e tukano, para trocar o céu ocidental por elas.

Fontes (dados/brutos/ceus_indigenas, do repositório github.com/Stellarium/stellarium-skycultures):
- tupi/index.json: linhas e nomes, contribuição de Paulo Marcelo Pontes (GNU GPL v2.0), a partir de Germano Bruno
  Afonso e do livro de Claude d'Abbeville (1614);
- tukano/index.json: linhas e nomes, do levantamento de Walmir Thomazi Cardoso (tese de doutorado, PUC-SP, 2007), com
  os tukanos do rio Tiquié (CC BY-SA).
Posições das estrelas: HYG v4.1 (pelo número Hipparcos).

Saída: dados/ceus/<cultura>.json, com as linhas já na direção da cena (a mesma conversão de js/corpos.js), o centro
de cada constelação (para o nome) e as constelações ocidentais por onde ela passa. Os textos ficam em dados/ceus/textos.json.
Uso: python3 gerar_ceus_indigenas.py
"""
import collections, csv, json, math, os
from gerar_constelacoes import ABREV  # nome em português → abreviação da UAI

AQUI = os.path.dirname(os.path.abspath(__file__))
BR = os.path.join(AQUI, 'brutos', 'ceus_indigenas')
SAIDA = os.path.join(AQUI, 'ceus')
OBL = math.radians(23.4392911)


def cena(ra, dec):
    """RA/Dec (graus) → direção na cena (equatorialParaCena de js/corpos.js: eixos da eclíptica)."""
    a, d = math.radians(ra), math.radians(dec)
    x, y, z = math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)
    ce, se = math.cos(OBL), math.sin(OBL)
    ye, ze = y * ce + z * se, -y * se + z * ce
    return (x, ze, -ye)


def main():
    os.makedirs(SAIDA, exist_ok=True)
    pt = {v: k for k, v in ABREV.items()}
    hip = {}
    for r in csv.DictReader(open(os.path.join(AQUI, 'brutos', 'hygdata_v41.csv'))):
        if r['hip']:
            hip[int(r['hip'])] = (float(r['ra']) * 15, float(r['dec']), r['con'])
    for cultura in ('tupi', 'tukano'):
        d = json.load(open(os.path.join(BR, f'{cultura}_index.json')))
        lista = []
        for c in d['constellations']:
            segs, pts, cons = [], [], collections.Counter()
            for linha in c['lines']:
                hs = [h for h in linha if isinstance(h, int) and h in hip]
                for a, b in zip(hs, hs[1:]):
                    segs += [round(v, 5) for v in cena(*hip[a][:2]) + cena(*hip[b][:2])]
                for h in hs:
                    pts.append(cena(*hip[h][:2]))
                    cons[hip[h][2]] += 1
            if not pts:
                continue
            cx, cy, cz = (sum(p[i] for p in pts) for i in range(3))
            n = math.sqrt(cx * cx + cy * cy + cz * cz)
            lista.append({
                'id': c['id'].split()[-1], 'nativo': c['common_name'].get('native', ''), 'en': c['common_name'].get('english', ''),
                'centro': [round(cx / n, 5), round(cy / n, 5), round(cz / n, 5)], 'segs': segs, 'cons': [pt[k] for k, n in cons.most_common() if k in pt and n >= 2] or [pt[k] for k, _ in cons.most_common(1) if k in pt],
            })
        json.dump({'cultura': cultura, 'constelacoes': lista}, open(os.path.join(SAIDA, f'{cultura}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        print(cultura, len(lista), 'constelações', sum(len(x['segs']) // 6 for x in lista), 'segmentos')


if __name__ == '__main__':
    main()
