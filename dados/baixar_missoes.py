# Baixa do JPL Horizons as trajetórias (posição e velocidade, eclíptica J2000) de sondas e cometas,
# em trechos: cruzeiro em torno do Sol e sobrevoos medidos em relação ao planeta (passagem exata).
# Grava dados/missoes/<id>.bin (float64: jd, x, y, z, vx, vy, vz) e dados/missoes/indice.json.
import json, os, struct, time, urllib.parse, urllib.request

API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
BRUTO = os.path.join(os.path.dirname(__file__), 'brutos', 'horizons')
SAIDA = os.path.join(os.path.dirname(__file__), 'missoes')
CENTRO = {'sol': '500@10', 'venus': '500@299', 'terra': '500@399', 'jupiter': '500@599', 'saturno': '500@699',
          'urano': '500@799', 'netuno': '500@899', 'plutao': '500@999', '67p': None}
GM = {'sol': 1.32712440018e11, 'venus': 324859.0, 'terra': 398600.44, 'jupiter': 1.26686534e8, 'saturno': 3.7931187e7,
      'urano': 5.793939e6, 'netuno': 6.836529e6, 'plutao': 869.6, '67p': 0}

# (id, nome, tipo, comando Horizons, [(centro, início, fim, passo, modo)])
OBJETOS = [
  ('voyager1', 'Voyager 1', 'sonda', '-31', [('sol', '1977-09-08', '2030-01-01', '5 d', 'kepler'),
     ('jupiter', '1979-02-20', '1979-03-20', '6 h', 'kepler'), ('saturno', '1980-10-30', '1980-11-25', '6 h', 'kepler')]),
  ('voyager2', 'Voyager 2', 'sonda', '-32', [('sol', '1977-08-23', '2030-01-01', '5 d', 'kepler'),
     ('jupiter', '1979-06-25', '1979-07-25', '6 h', 'kepler'), ('saturno', '1981-08-12', '1981-09-08', '6 h', 'kepler'),
     ('urano', '1986-01-14', '1986-02-04', '3 h', 'kepler'), ('netuno', '1989-08-15', '1989-09-05', '3 h', 'kepler')]),
  ('pioneer10', 'Pioneer 10', 'sonda', '-23', [('sol', '1972-03-05', '2030-01-01', '10 d', 'kepler'),
     ('jupiter', '1973-11-20', '1973-12-18', '6 h', 'kepler')]),
  ('newhorizons', 'New Horizons', 'sonda', '-98', [('sol', '2006-01-21', '2030-01-01', '5 d', 'kepler'),
     ('jupiter', '2007-02-15', '2007-03-15', '6 h', 'kepler'), ('plutao', '2015-07-01', '2015-07-28', '1 h', 'kepler')]),
  ('cassini', 'Cassini', 'sonda', '-82', [('sol', '1997-10-17', '2004-06-01', '2 d', 'kepler'),
     ('venus', '1998-04-24', '1998-04-28', '1 h', 'kepler'), ('venus', '1999-06-22', '1999-06-26', '1 h', 'kepler'),
     ('terra', '1999-08-16', '1999-08-20', '1 h', 'kepler'), ('jupiter', '2000-12-15', '2001-01-15', '6 h', 'kepler'),
     ('saturno', '2004-06-01', '2017-09-15', '6 h', 'kepler')]),
  ('juno', 'Juno', 'sonda', '-61', [('sol', '2011-08-07', '2016-06-20', '2 d', 'kepler'),
     ('terra', '2013-10-07', '2013-10-12', '1 h', 'kepler'), ('jupiter', '2016-06-20', '2030-01-01', '6 h', 'kepler')]),
  ('parker', 'Parker Solar Probe', 'sonda', '-96', [('sol', '2018-08-14', '2030-01-01', '12 h', 'kepler')]),
  ('jwst', 'Telescópio James Webb', 'sonda', '-170', [('terra', '2021-12-26', '2030-01-01', '1 d', 'hermite')]),
  ('rosetta', 'Rosetta', 'sonda', '-226', [('sol', '2004-03-05', '2014-08-01', '2 d', 'kepler'),
     ('67p', '2014-08-01', '2016-09-30', '6 h', 'hermite')]),
  ('halley', 'Cometa Halley', 'cometa', 'DES=1P;CAP', [('sol', '1900-01-01', '2070-01-01', '20 d', 'kepler')]),
  ('halebopp', 'Cometa Hale-Bopp', 'cometa', 'DES=C/1995 O1;', [('sol', '1985-01-01', '2030-01-01', '5 d', 'kepler')]),
  ('neowise', 'Cometa NEOWISE', 'cometa', 'DES=C/2020 F3;', [('sol', '2016-01-01', '2030-01-01', '2 d', 'kepler')]),
  ('67p', 'Cometa 67P/Churyumov-Gerasimenko', 'cometa', 'DES=67P;CAP', [('sol', '2000-01-01', '2030-01-01', '1 d', 'kepler')]),
  ('atlas3i', '3I/ATLAS (visitante interestelar)', 'cometa', 'DES=C/2025 N1;', [('sol', '2018-01-01', '2035-01-01', '2 d', 'kepler')]),
]

def consulta(comando, centro, ini, fim, passo):
    q = {'format': 'json', 'COMMAND': f"'{comando}'", 'OBJ_DATA': "'NO'", 'MAKE_EPHEM': "'YES'", 'EPHEM_TYPE': "'VECTORS'",
         'CENTER': f"'{centro}'", 'START_TIME': f"'{ini}'", 'STOP_TIME': f"'{fim}'", 'STEP_SIZE': f"'{passo}'",
         'REF_PLANE': "'ECLIPTIC'", 'REF_SYSTEM': "'ICRF'", 'VEC_TABLE': "'2'", 'OUT_UNITS': "'KM-S'", 'CSV_FORMAT': "'YES'", 'VEC_LABELS': "'NO'"}
    url = API + '?' + urllib.parse.urlencode(q)
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r).get('result', '')
        except Exception as e:
            time.sleep(3)
    return ''

def linhas(txt):
    if '$$SOE' not in txt: return []
    corpo = txt.split('$$SOE')[1].split('$$EOE')[0]
    out = []
    for ln in corpo.strip().splitlines():
        p = [x.strip() for x in ln.split(',')]
        try: out.append([float(p[0])] + [float(v) for v in p[2:8]])
        except (ValueError, IndexError): pass
    return out

indice = []
for oid, nome, tipo, cmd, segs in OBJETOS:
    linhas_obj, segmentos = [], []
    for centro, ini, fim, passo, modo in segs:
        c = CENTRO[centro] or '500@1000012'  # 67P como centro: código do Horizons para o núcleo do cometa
        dados = []
        for fim_t in [fim, '2027-01-01', '2026-10-01', '2026-01-01', '2025-09-15']:
            if fim_t < ini or (fim_t != fim and fim_t > fim): continue
            txt = consulta(cmd, c, ini, fim_t, passo)
            open(os.path.join(BRUTO, f'{oid}_{centro}_{ini}.txt'), 'w').write(txt)
            dados = linhas(txt)
            if dados: break
        if not dados:
            print('  sem dados:', oid, centro, ini, '→', txt[-300:].replace('\n', ' ') if txt else 'sem resposta')
            continue
        segmentos.append({'centro': centro, 'gm': GM[centro], 'modo': modo, 'inicio': len(linhas_obj), 'n': len(dados), 'jd0': dados[0][0], 'jd1': dados[-1][0]})
        linhas_obj += dados
        print(f'{oid:12s} {centro:8s} {len(dados):6d} pontos  {dados[0][0]:.1f} → {dados[-1][0]:.1f}')
        time.sleep(0.5)
    with open(os.path.join(SAIDA, f'{oid}.bin'), 'wb') as f:
        for l in linhas_obj: f.write(struct.pack('<7d', *l))
    indice.append({'id': oid, 'nome': nome, 'tipo': tipo, 'segmentos': segmentos})
json.dump(indice, open(os.path.join(SAIDA, 'indice.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', sum(os.path.getsize(os.path.join(SAIDA, f)) for f in os.listdir(SAIDA)) // 1024, 'KB')
