#!/usr/bin/env python3
"""Lista os textos em português que a interface pode mostrar, para montar os dicionários de tradução.

Junta: literais de texto do código (js/, menos shaders), nomes e tipos dos arquivos de dados e os textos fixos da
página (dados/idiomas/textos_pagina.json, coletados no navegador por coletarDOM() de js/idioma.js).
Saída: dados/idiomas/textos_pt.json (lista ordenada). O que já estiver traduzido em <idioma>.json é mantido;
faltantes.<idioma>.json recebe só o que falta traduzir.

Uso: python3 extrair_textos.py
"""
import json, os, re

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
PASTA = os.path.join(AQUI, 'idiomas')

LITERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")
CODIGO = re.compile(r"^(#include|rgba?\(|dados/|texturas/|https?:|[a-z]+/[a-z]|\.|[A-Za-z_$][\w$]*(\.[\w$]+)+$)|[{};=]\s|\bvec[234]\b|gl_|\$\{")


def parece_texto(s):
    if len(s) < 2 or not re.search(r'[A-Za-zÀ-ú]', s):
        return False
    if re.search(r'\{(?:\w+:)?\w+\}', s) and re.search(r'[a-zà-ú]{2}', s) and '${' not in s and not re.search(r'[;=]', s):
        return True  # frase com marcadores de valor
    if CODIGO.search(s) or re.fullmatch(r'(Africa|America|Asia|Europe|Australia|Pacific|Atlantic|Indian|Etc)/[\w/+-]+', s) or s in ('NFD', 'PageUp', 'PageDown', 'Enter', 'Escape'):
        return False
    if re.fullmatch(r'[\w-]+', s) and not re.search(r'[À-ú]', s) and s.lower() == s and len(s) < 3:
        return False
    return ' ' in s or re.search(r'[À-ú]', s) or s[:1].isupper() or s in ('estrela', 'planeta', 'cometa', 'asteroide', 'sonda', 'hoje', 'parado', 'freando')


def do_codigo():
    achados = set()
    for nome in sorted(os.listdir(os.path.join(RAIZ, 'js'))):
        if not nome.endswith('.js') or nome in ('shaders.js', 'fuso.js'):  # fuso.js: só nomes internos de países e fusos
            continue
        txt = open(os.path.join(RAIZ, 'js', nome)).read()
        txt = re.sub(r'^\s*//.*$', '', txt, flags=re.M)
        for m in LITERAL.finditer(txt):
            s = next(g for g in m.groups() if g is not None)
            s = s.replace("\\'", "'").replace('\\"', '"')
            if parece_texto(s):
                achados.add(s)
        # aspas simples dentro de modelos com crase (que a passada acima engole inteiros)
        for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'", txt):
            if parece_texto(m.group(1)):
                achados.add(m.group(1).replace("\\'", "'"))
        # o que vai direto para a tradução, qualquer que seja a forma
        for m in re.finditer(r"\b(?:t|tr|tn)\((?:[^,()']*,\s*)?'((?:[^'\\]|\\.)*)'(?:\s*,\s*'((?:[^'\\]|\\.)*)')?", txt):
            for g in m.groups():
                if g:
                    achados.add(g.replace("\\'", "'"))
    return achados


def dos_dados():
    a = set()
    for o in json.load(open(os.path.join(AQUI, 'messier.json'))):
        if o.get('tipo'):
            a.add(o['tipo'])
        if o.get('nome'):
            a.add(o['nome'])
    ngc = json.load(open(os.path.join(AQUI, 'ngc.json')))
    a.update(t for t in ngc['tipos'] if t)
    a.update(o[8] for o in ngc['objetos'] if len(o) > 8 and o[8])
    for c in json.load(open(os.path.join(AQUI, 'constelacoes.json'))):
        a.add(c['nome'] if isinstance(c, dict) else c[0])
    for o in json.load(open(os.path.join(AQUI, 'missoes', 'indice.json'))):
        a.add(o['nome'])
    fichas = json.load(open(os.path.join(AQUI, 'fichas.json')))
    for c in fichas['corpos'].values():
        a.update(v for k, v in c.items() if isinstance(v, str))
    a.update(fichas['estrelas'].values())
    tec = json.load(open(os.path.join(AQUI, 'fichas_dados.json')))
    a.update(v[0] for v in tec['fontes'].values())
    for grupo in ('corpos', 'galaxias'):
        a.update(d['descobertaPor'] for d in tec[grupo].values() if d.get('descobertaPor'))
    for cor in ('vermelha', 'laranja', 'amarela', 'branca', 'azul'):
        a |= {f'gigante {cor}', f'supergigante {cor}'}
    return a


def main():
    textos = do_codigo() | dos_dados()
    pagina = os.path.join(PASTA, 'textos_pagina.json')
    if os.path.exists(pagina):
        textos |= set(json.load(open(pagina)))
    # chaves montadas no código (partes variáveis)
    for tipo in ('total', 'anular', 'híbrido', 'parcial'):
        textos.add(f'Eclipse solar {tipo}')
    for tipo in ('total', 'parcial', 'penumbral'):
        textos.add(f'Eclipse lunar {tipo}')
    textos |= {'{e} no hemisfério norte', '{e} no hemisfério sul'}
    # valores de mapas do código que passam por t() numa variável
    textos |= {'cidade', 'país', 'mar', 'pico', 'região', 'estrela', 'planeta', 'planeta anão', 'galáxia', 'lugar do universo', 'inverno',
               'primavera', 'verão', 'outono', 'exoplaneta', 'magnitude', 'cometa', 'asteroide', 'constelação', 'tempo real', 'luz', 'carro'}
    lista = sorted(textos, key=lambda s: s.lower())
    os.makedirs(PASTA, exist_ok=True)
    json.dump(lista, open(os.path.join(PASTA, 'textos_pt.json'), 'w'), ensure_ascii=False, indent=0)
    print(len(lista), 'textos')
    for lang in ('en', 'es'):
        arq = os.path.join(PASTA, f'{lang}.json')
        feito = json.load(open(arq)) if os.path.exists(arq) else {}
        falta = [s for s in lista if s not in feito]
        json.dump(falta, open(os.path.join(PASTA, f'faltantes.{lang}.json'), 'w'), ensure_ascii=False, indent=0)
        print(lang, len(feito), 'traduzidos,', len(falta), 'faltando')


if __name__ == '__main__':
    main()
