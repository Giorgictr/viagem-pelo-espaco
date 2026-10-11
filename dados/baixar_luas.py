# Baixa do JPL Horizons a posição e a velocidade das luas principais em relação ao planeta (eclíptica J2000),
# de 1970 a 2040, com passo fixo. Grava dados/luas/<id>.bin: float32 (x, y, z, vx, vy, vz) por passo,
# e dados/luas/indice.json com jd0, passo (dias) e número de pontos.
import json, os, struct, time, urllib.parse, urllib.request
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
SAIDA = os.path.join(os.path.dirname(__file__), 'luas'); os.makedirs(SAIDA, exist_ok=True)
INI, FIM = '1970-01-01', '2040-01-01'
# id na simulação, código Horizons, centro, passo
LUAS = [('fobos', '401', '499', '6 h'), ('deimos', '402', '499', '12 h'),
        ('io', '501', '599', '12 h'), ('europa', '502', '599', '1 d'), ('ganimedes', '503', '599', '1 d'), ('calisto', '504', '599', '2 d'),
        ('mimas', '601', '699', '12 h'), ('encelado', '602', '699', '12 h'), ('tetis', '603', '699', '1 d'), ('dione', '604', '699', '1 d'),
        ('reia', '605', '699', '1 d'), ('tita', '606', '699', '2 d'), ('japeto', '608', '699', '4 d'),
        ('miranda', '705', '799', '12 h'), ('ariel', '701', '799', '1 d'), ('umbriel', '702', '799', '1 d'), ('titania', '703', '799', '2 d'), ('oberon', '704', '799', '2 d'),
        ('tritao', '801', '899', '1 d'), ('caronte', '901', '999', '1 d')]
def consulta(cmd, centro, passo):
    q = {'format': 'json', 'COMMAND': f"'{cmd}'", 'OBJ_DATA': "'NO'", 'MAKE_EPHEM': "'YES'", 'EPHEM_TYPE': "'VECTORS'",
         'CENTER': f"'500@{centro}'", 'START_TIME': f"'{INI}'", 'STOP_TIME': f"'{FIM}'", 'STEP_SIZE': f"'{passo}'",
         'REF_PLANE': "'ECLIPTIC'", 'REF_SYSTEM': "'ICRF'", 'VEC_TABLE': "'2'", 'OUT_UNITS': "'KM-S'", 'CSV_FORMAT': "'YES'", 'VEC_LABELS': "'NO'"}
    for _ in range(3):
        try:
            with urllib.request.urlopen(API + '?' + urllib.parse.urlencode(q), timeout=300) as r: return json.load(r).get('result', '')
        except Exception: time.sleep(5)
    return ''
indice = {}
for lid, cmd, centro, passo in LUAS:
    txt = consulta(cmd, centro, passo)
    if '$$SOE' not in txt: print('falhou', lid, txt[-200:]); continue
    linhas = [l.split(',') for l in txt.split('$$SOE')[1].split('$$EOE')[0].strip().splitlines()]
    with open(os.path.join(SAIDA, f'{lid}.bin'), 'wb') as f:
        for p in linhas: f.write(struct.pack('<6f', *[float(v) for v in p[2:8]]))
    jd0, jd1 = float(linhas[0][0]), float(linhas[-1][0])
    indice[lid] = {'jd0': jd0, 'passo': (jd1 - jd0) / (len(linhas) - 1), 'n': len(linhas)}
    print(f'{lid:10s} {len(linhas):7d} pontos'); time.sleep(0.5)
json.dump(indice, open(os.path.join(SAIDA, 'indice.json'), 'w'), indent=1)
print('total KB', sum(os.path.getsize(os.path.join(SAIDA, f)) for f in os.listdir(SAIDA)) // 1024)
