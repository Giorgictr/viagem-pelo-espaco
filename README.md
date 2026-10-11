# Viagem pelo Espaço

Simulação 3D do espaço conhecido, no navegador (Three.js): Sistema Solar com posições reais, 109 mil estrelas, Via Láctea e 43 mil galáxias, a Terra em ladrilhos com relevo e imagens de satélite, o céu de qualquer lugar e data, telescópio, sondas e cometas com trajetórias do JPL e a ISS em tempo real. Velocidade regulável, inclusive acima da luz.

**Abrir:** https://giorgictr.github.io/viagem-pelo-espaco/ · **Manual:** [manual.html](https://giorgictr.github.io/viagem-pelo-espaco/manual.html)

Para rodar no próprio computador: `python3 servidor.py 8743` e abrir http://127.0.0.1:8743.

## Dados e licenças

Os créditos completos estão no manual (seção "Fontes dos dados"). Em resumo:

- Imagens da Terra: Sentinel-2 cloudless 2023 © EOX IT Services GmbH (dados Copernicus modificados), **CC BY-NC-SA 4.0**, carregadas durante o uso; por isso o site é de uso não comercial.
- Estrelas: catálogo HYG (CC BY-SA 4.0). Texturas dos planetas: Solar System Scope (CC BY 4.0). Linhas das constelações: d3-celestial (BSD). Terra antiga: PALEOMAP (CC BY 4.0). Lugares e fronteiras: Natural Earth (domínio público). Relevo: Terrain Tiles (Mapzen/AWS). Luzes noturnas: NASA Black Marble.
- Construções em 3D: © colaboradores do OpenStreetMap (ODbL), via OpenFreeMap. Objetos de Messier: OpenNGC (CC BY-SA 4.0).
- Trajetórias, luas e efemérides: JPL Horizons (NASA/JPL-Caltech). Satélites: CelesTrak + satellite.js (MIT). Three.js (MIT).
- Fotos das missões: NASA (uso livre); o 67P é da ESA/Rosetta/NAVCAM (CC BY-SA IGO 3.0).
