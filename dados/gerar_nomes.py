#!/usr/bin/env python3
"""Nomes do relevo (crateras, montes, vales, mares...) dos corpos do Sistema Solar, para mostrar no chão e nas fichas.

Fonte: Gazetteer of Planetary Nomenclature (UAI, Working Group for Planetary System Nomenclature; mantido pelo USGS
Astrogeology Science Center; dados do USGS, domínio público). Arquivos *_nomenclature_center_pts.zip de
https://planetarynames.wr.usgs.gov/GIS_Downloads, descompactados em dados/brutos/nomenclatura/<CORPO>/.
Ficam só os nomes aprovados, sem as crateras-satélite (as que levam letra: "Tycho A").
Longitudes: 0 a 360, positivas para leste (a mesma convenção do programa).

Saída:
- dados/nomes/<corpo>.json: [nome, tipo (código da UAI), diâmetro em km, lat, lon, índice da origem, id no Gazetteer]
- dados/nomes/origens.en.json: as origens dos nomes, em inglês (as traduções ficam em origens.pt.json e origens.es.json,
  feitas à parte e mantidas: este script só acrescenta as novas no fim, sem mudar os índices das antigas)
Uso: python3 gerar_nomes.py
"""
import glob, json, os, struct

AQUI = os.path.dirname(os.path.abspath(__file__))
BR = os.path.join(AQUI, 'brutos', 'nomenclatura')
SAIDA = os.path.join(AQUI, 'nomes')
CORPOS = {
    'MOON': 'lua', 'MARS': 'marte', 'MERCURY': 'mercurio', 'VENUS': 'venus', 'CERES': 'ceres', 'VESTA': 'vesta', 'PLUTO': 'plutao',
    'CHARON': 'caronte', 'PHOBOS': 'fobos', 'DEIMOS': 'deimos', 'IO': 'io', 'EUROPA': 'europa', 'GANYMEDE': 'ganimedes',
    'CALLISTO': 'calisto', 'MIMAS': 'mimas', 'ENCELADUS': 'encelado', 'TETHYS': 'tetis', 'DIONE': 'dione', 'RHEA': 'reia',
    'TITAN': 'tita', 'IAPETUS': 'japeto', 'MIRANDA': 'miranda', 'ARIEL': 'ariel', 'UMBRIEL': 'umbriel', 'TITANIA': 'titania',
    'OBERON': 'oberon', 'TRITON': 'tritao',
}


def ler_dbf(caminho):
    """Lê a tabela de atributos (dBase III) do shapefile."""
    with open(caminho, 'rb') as f:
        cab = f.read(32)
        n = struct.unpack('<I', cab[4:8])[0]
        tam_cab, tam_reg = struct.unpack('<HH', cab[8:12])
        campos = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            campos.append((d[:11].split(b'\0')[0].decode(), d[16]))
        f.seek(tam_cab)
        regs = []
        for _ in range(n):
            r = f.read(tam_reg)
            if r[:1] == b'*':
                continue
            i, reg = 1, {}
            for nome, ln in campos:
                reg[nome] = r[i:i + ln].decode('utf-8', 'replace').strip()
                i += ln
            regs.append(reg)
    return regs


def main():
    os.makedirs(SAIDA, exist_ok=True)
    arq_or = os.path.join(SAIDA, 'origens.en.json')
    origens = json.load(open(arq_or)) if os.path.exists(arq_or) else []
    indice = {o: i for i, o in enumerate(origens)}
    resumo = {}
    a_fam = os.path.join(SAIDA, 'famosos.json')
    famosos = json.load(open(a_fam)) if os.path.exists(a_fam) else {}
    for pasta, corpo in CORPOS.items():
        dbf = glob.glob(os.path.join(BR, pasta, '*.dbf'))
        if not dbf:
            print('falta', pasta)
            continue
        lista = []
        for r in ler_dbf(dbf[0]):
            if r['code'] == 'SF' or not r['approval'].startswith('Adopted'):
                continue
            o = r['origin'].strip()
            if o not in indice:
                indice[o] = len(origens)
                origens.append(o)
            diam = float(r['diameter'] or 0)
            fid = int(r['link'].rsplit('/', 1)[-1]) if r['link'] else 0
            lista.append([r['clean_name'], r['code'], round(diam, 1), round(float(r['center_lat']), 3), round(float(r['center_lon']) % 360, 3), indice[o], fid])
        # os famosos primeiro, depois os maiores (o programa mostra os nomes nessa ordem, sem sobrepor)
        lista.sort(key=lambda x: (f'{corpo}:{x[0]}' not in famosos, -x[2]))
        json.dump(lista, open(os.path.join(SAIDA, f'{corpo}.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
        resumo[corpo] = len(lista)
    json.dump(origens, open(arq_or, 'w'), ensure_ascii=False, indent=0)
    print(resumo, sum(resumo.values()), 'nomes;', len(origens), 'origens')
    indice_busca()


def indice_busca():
    """dados/nomes/busca.json: os lugares que entram na busca (grandes, mares, montes e os famosos), com o nome dos
    mares e lagos da Lua traduzido (a origem deles é o significado: "Sea of Tranquility") como apelido."""
    famosos = json.load(open(os.path.join(SAIDA, 'famosos.json'))) if os.path.exists(os.path.join(SAIDA, 'famosos.json')) else {}
    trad = {}
    for lg in ('pt', 'es'):
        a = os.path.join(SAIDA, f'origens.{lg}.json')
        trad[lg] = json.load(open(a)) if os.path.exists(a) else []
    busca = []
    for corpo in CORPOS.values():
        for f in json.load(open(os.path.join(SAIDA, f'{corpo}.json'))):
            nome, cod, diam = f[0], f[1], f[2]
            if not (diam >= 150 or cod in ('ME', 'OC') or (cod == 'MO' and diam >= 80) or f'{corpo}:{nome}' in famosos):
                continue
            apelidos = []
            if corpo == 'lua' and cod in ('ME', 'OC', 'LC', 'SI', 'PA'):
                for lg in ('pt', 'es'):
                    if f[5] < len(trad[lg]):
                        apelidos.append(trad[lg][f[5]].strip(' ".“”').rstrip('.'))
            busca.append([nome, corpo, f[3], f[4], diam, cod, f[5], f[6]] + apelidos)
    json.dump(busca, open(os.path.join(SAIDA, 'busca.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('busca:', len(busca), 'lugares')


if __name__ == '__main__':
    main()
