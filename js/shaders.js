// Shaders. Todos usam o depth buffer logarítmico (por causa da escala).
const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

// Relatividade especial para quem se move com velocidade beta (fração de c, eixos da cena):
// aberração (as fontes se juntam à frente) e fator Doppler D (frequência × D; brilho ~ D³).
const REL = /* glsl */ `
  uniform vec3 beta;
  // refração da atmosfera (modo céu): levanta os astros perto do horizonte (~0,5° no horizonte; fórmula de Sæmundsson)
  uniform vec3 zenite; uniform float refr;
  vec3 refratar(vec3 p) {
    if (refr < 0.5) return p;
    float L = length(p);
    vec3 n = p / L;
    float s = dot(n, zenite);
    float h = degrees(asin(clamp(s, -1.0, 1.0)));
    if (h < -1.5) return p;
    float R = min(1.02 / tan(radians(h + 10.3 / (h + 5.11))), 40.0) / 60.0; // graus
    vec3 t = zenite - n * s;
    float tl = length(t);
    if (tl < 1e-6) return p;
    float r = radians(R);
    return (n * cos(r) + t / tl * sin(r)) * L;
  }
  vec3 aberrar(vec3 p, out float D) {
    D = 1.0;
    float b = length(beta);
    if (b < 1e-4) return p;
    vec3 bh = beta / b;
    float L = length(p);
    vec3 n = p / L;
    float c = dot(n, bh);
    float c2 = (c + b) / (1.0 + b * c);
    vec3 perp = n - c * bh;
    float pl = length(perp);
    vec3 n2 = pl > 1e-7 ? c2 * bh + sqrt(max(1.0 - c2 * c2, 0.0)) * perp / pl : sign(c2) * bh;
    D = (1.0 + b * c) / sqrt(1.0 - b * b);
    return n2 * L;
  }
  // cor de corpo negro (mesma aproximação da CPU)
  vec3 corTemp(float T) {
    float t = clamp(T, 1000.0, 40000.0) / 100.0;
    vec3 c;
    if (t <= 66.0) { c = vec3(1.0, clamp((99.47 * log(t) - 161.12) / 255.0, 0.0, 1.0), t <= 19.0 ? 0.0 : clamp((138.52 * log(t - 10.0) - 305.04) / 255.0, 0.0, 1.0)); }
    else { c = vec3(clamp(329.7 * pow(t - 60.0, -0.1332) / 255.0, 0.0, 1.0), clamp(288.12 * pow(t - 60.0, -0.0755) / 255.0, 0.0, 1.0), 1.0); }
    float m = (c.r + c.g + c.b) / 3.0;
    return m + (c - m) * 0.75;
  }
  // tinge uma cor qualquer como se sua temperatura fosse multiplicada por D
  vec3 tingir(vec3 cor, float D) { return D == 1.0 ? cor : cor * corTemp(6500.0 * D) / corTemp(6500.0); }`;

const RUIDO = /* glsl */ `
  // Ruído de valor com período de 289 células: permite somar a posição da câmera já reduzida (na CPU,
  // em precisão dupla) à posição relativa do pixel, sem perder precisão perto do chão
  float hash3(vec3 p) { p = mod(p, 289.0); p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  // Crateras procedurais (detalhe inventado): numa grade de células, cada uma pode ter uma cratera com centro e raio
  // sorteados; o perfil é uma bacia com borda elevada e um pouco de material ejetado em volta (forma das crateras
  // simples da Lua). Devolve a altura em unidades da célula. Só as 8 células em volta do ponto contam (raio < 0,5).
  float crateras(vec3 p) {
    vec3 b = floor(p - 0.5);
    float h = 0.0;
    for (int dx = 0; dx < 2; dx++) for (int dy = 0; dy < 2; dy++) for (int dz = 0; dz < 2; dz++) {
      vec3 cel = b + vec3(float(dx), float(dy), float(dz));
      float sorte = hash3(cel + 17.0);
      if (sorte > 0.55) continue; // nem toda célula tem cratera
      vec3 centro = cel + 0.15 + 0.7 * vec3(hash3(cel), hash3(cel + 31.0), hash3(cel + 59.0));
      float R = 0.18 + 0.27 * hash3(cel + 83.0);
      float d = length(p - centro) / R;
      float bacia = d < 1.0 ? (d * d - 1.0) * 0.4 : 0.0;
      float borda = 0.11 * exp(-pow((d - 1.0) / (d < 1.0 ? 0.12 : 0.3), 2.0));
      h += (bacia + borda) * R;
    }
    return h;
  }
  float ruido(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  // Normal perturbada por uma altura escalar, via derivadas de tela
  vec3 relevoTela(vec3 pos, vec3 n, float h) {
    vec3 dpx = dFdx(pos), dpy = dFdy(pos);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    if (abs(det) < 1e-30) return n;
    vec3 g = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * n - g);
  }`;

// Mapa de relevo global: altura de 0 a 1 em 16 bits (byte alto no vermelho, baixo no verde); num mapa cinza de
// 8 bits (vermelho = verde) dá o próprio valor. A conta é linear, então a interpolação da textura continua certa.
const ALT16 = /* glsl */ `
  float alt16(vec4 c) { return dot(c.rg, vec2(65280.0, 255.0) / 65535.0); }
`;
export const PLANETA_V = LOGV + ALT16 + /* glsl */ `
  uniform sampler2D relevo;
  uniform float temRelevo, hMin, hMax, exagero, raio, usarPiso, pisoMar;
  varying vec3 vN, vP, vMundo; varying vec2 vUv;
  #ifdef LADRILHO
  // ladrilho de relevo (js/solo.js): posição na esfera relativa ao centro do ladrilho, direção e altura (km) à parte
  attribute vec4 dirAlt; attribute vec2 uvT; varying vec2 vT;
  #endif
  void main() {
    vUv = uv; vP = position;
    vec3 pos = position;
    #ifdef LADRILHO
    vT = uvT; vP = dirAlt.xyz;
    pos += dirAlt.xyz * dirAlt.w * exagero;
    vN = normalize(mat3(modelMatrix) * dirAlt.xyz);
    #else
    if (temRelevo > 0.5) {
      float h = mix(hMin, hMax, alt16(texture2D(relevo, uv)));
      if (usarPiso > 0.5) h = max(h, pisoMar); // superfície do mar plana (Terra antiga)
      pos *= max(1.0 + h * exagero / raio, 0.3); // exagerado, o relevo de Fobos e Vesta (é a forma do corpo) passaria do centro
    }
    vN = normalize(mat3(modelMatrix) * normal);
    #endif
    vec4 m = modelMatrix * vec4(pos, 1.0);
    vMundo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
    #include <logdepthbuf_vertex>
  }`;

// Eclipses: quanto do disco do Sol um corpo esférico (a Lua para a Terra, a Terra para a Lua) tapa, visto do ponto P.
// P e eclOcl em km, no referencial do corpo iluminado (centro = 0), com os eixos da cena; L = direção do Sol.
const ECLIPSE = /* glsl */ `
  uniform vec3 eclOcl; uniform float eclRaio, eclSolAng, eclAtivo, eclVermelho;
  float luzEclipse(vec3 P, vec3 L, out float umbra) {
    umbra = 0.0;
    if (eclAtivo < 0.5) return 1.0;
    vec3 v = eclOcl - P;
    float d = length(v);
    if (dot(v, L) <= 0.0) return 1.0;
    vec3 vn = v / d;
    float a = eclSolAng, b = asin(clamp(eclRaio / d, 0.0, 1.0));
    float c = atan(length(cross(vn, L)), dot(vn, L)); // separação (preciso mesmo em ângulos pequenos)
    if (c >= a + b) return 1.0;
    if (c <= b - a) { umbra = clamp((b - a - c) / max(b - a, 1e-6) * 3.0 + 0.4, 0.0, 1.0); return 0.0; }
    if (c <= a - b) return 1.0 - (b * b) / (a * a); // anular
    float a2 = a * a, b2 = b * b, c2 = c * c;
    float A = a2 * acos(clamp((c2 + a2 - b2) / (2.0 * c * a), -1.0, 1.0)) + b2 * acos(clamp((c2 + b2 - a2) / (2.0 * c * b), -1.0, 1.0))
      - 0.5 * sqrt(max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0.0));
    return clamp(1.0 - A / (3.14159265 * a2), 0.0, 1.0);
  }`;

export const PLANETA_F = LOGF + RUIDO + ECLIPSE + ALT16 + /* glsl */ `
  uniform sampler2D mapa, noite, relevo, detalheMapa, detalheMapa2;
  uniform vec4 detalheJanela, detalheJanela2; uniform float detalheAtivo, detalheAtivo2;
  uniform float temMapa, temNoite, emissivo, temRelevo, hMin, hMax, exagero, raio, detalhe, kmPorUnidade, usarTextura, usarPiso, pisoMar, exposicao, crateraForca;
  uniform float veuKm, difusa, nuvemDet;
  uniform float tingir; // Marte: as imagens de perto (Viking, via Trek) vêm desbotadas; o claro e escuro delas, com a cor do mapa global // nuvemDet: gigantes gasosos (detalhe de nuvens, esticado na direção dos ventos) // abaixo das nuvens (Vênus, Titã): visibilidade no ar espesso e parte da luz que vem do céu todo
  uniform vec3 corBase, luz, polo, corVeu, corLuz;
  uniform vec2 texel;
  uniform vec3 camOct[16]; uniform mat3 paraCorpo;
  varying vec3 vN, vP, vMundo; varying vec2 vUv;
  #ifdef LADRILHO
  uniform sampler2D relTile, imgTile; uniform vec4 janelaRel, janelaImg; uniform float temImg;
  varying vec2 vT;
  #endif
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n0 = normalize(vN);
    vec3 n = n0;
    vec3 base;
    float pesoDet = 0.0;
    if (temMapa > 0.5 && usarTextura > 0.5) {
    base = texture2D(mapa, vUv).rgb;
    vec3 glob = base;
    float lumG = max(dot(glob, vec3(0.2126, 0.7152, 0.0722)), 0.01);
    #ifdef LADRILHO
    if (temImg > 0.5) { base = texture2D(imgTile, janelaImg.xy + vT * janelaImg.zw).rgb; pesoDet = 1.0; }
    #else
    // imagem de alta resolução (NASA Trek) em volta do ponto abaixo da câmera, fundida nas bordas
    if (detalheAtivo2 > 0.5) { // camada larga, até o horizonte
      vec2 q2 = (vUv - detalheJanela2.xy) / (detalheJanela2.zw - detalheJanela2.xy);
      if (q2.x > 0.0 && q2.x < 1.0 && q2.y > 0.0 && q2.y < 1.0) {
        pesoDet = smoothstep(0.0, 0.1, min(min(q2.x, 1.0 - q2.x), min(q2.y, 1.0 - q2.y)));
        base = mix(base, texture2D(detalheMapa2, q2).rgb, pesoDet);
      }
    }
    if (detalheAtivo > 0.5) {
      vec2 q = (vUv - detalheJanela.xy) / (detalheJanela.zw - detalheJanela.xy);
      if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
        float pf = smoothstep(0.0, 0.1, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y)));
        base = mix(base, texture2D(detalheMapa, q).rgb, pf);
        pesoDet = max(pesoDet, pf);
      }
    }
    #endif
    if (tingir > 0.0 && pesoDet > 0.0) base = mix(base, glob * dot(base, vec3(0.2126, 0.7152, 0.0722)) / lumG, tingir * pesoDet);
    }
    else {
      // aparência procedural: cor do corpo com manchas e faixas
      if (emissivo > 0.5) {
        // superfície de estrela: granulação
        float g = ruido(vP * 40.0) * 0.5 + ruido(vP * 110.0) * 0.3 + ruido(vP * 9.0) * 0.2;
        base = corBase * (0.78 + 0.45 * g);
      } else {
        float f = ruido(vP * 3.0) * 0.5 + ruido(vP * 7.0) * 0.3 + ruido(vP * 19.0) * 0.2;
        base = corBase * (0.62 + 0.6 * f + 0.08 * sin(vP.y * 18.0 + ruido(vP * 2.0) * 4.0));
      }
    }
    if (emissivo > 0.5) {
      // superfície de estrela, como nas fotos em luz visível: quase branca no centro, com o limbo mais escuro e mais
      // avermelhado (escurecimento do limbo: I(μ) = 1 − u(1 − μ), com u maior no azul; para o Sol, u ≈ 0,5–0,75)
      // e a granulação, sutil; a foto do mapa só entra de leve, como textura das células
      float mu = max(dot(n, normalize(-vMundo)), 0.0);
      vec3 u = vec3(0.50, 0.60, 0.74);
      vec3 limbo = 1.0 - u * (1.0 - mu);
      float g = ruido(vP * 220.0) * 0.55 + ruido(vP * 90.0) * 0.3 + ruido(vP * 25.0) * 0.15;
      float textura = temMapa > 0.5 ? dot(texture2D(mapa, vUv).rgb, vec3(0.33)) : 0.5;
      // a cor de corpo negro é mais "laranja" do que o olho vê: a luz forte satura e parece branca no centro
      vec3 cor = mix(corBase, vec3(1.0), 0.5) * limbo * (0.93 + 0.1 * g + 0.08 * (textura - 0.5)) * 1.7;
      gl_FragColor = vec4(cor, 1.0);
      #include <colorspace_fragment>
      return;
    }
    #ifdef LADRILHO
    { // inclinação de cada amostra dos dados (para leste e para o norte)
      vec2 s = texture2D(relTile, janelaRel.xy + vT * janelaRel.zw).rg * exagero;
      vec3 T = normalize(cross(polo, n0)); vec3 B = cross(n0, T);
      n = normalize(n - T * s.x - B * s.y);
    }
    #else
    bool sobAgua = usarPiso > 0.5 && mix(hMin, hMax, alt16(texture2D(relevo, vUv))) < pisoMar;
    if (temRelevo > 0.5 && !sobAgua) {
      float hE = alt16(texture2D(relevo, vUv + vec2(texel.x, 0.0))), hW = alt16(texture2D(relevo, vUv - vec2(texel.x, 0.0)));
      float hN = alt16(texture2D(relevo, vUv + vec2(0.0, texel.y))), hS = alt16(texture2D(relevo, vUv - vec2(0.0, texel.y)));
      float k = (hMax - hMin) * exagero / raio;
      float coslat = max(sqrt(max(1.0 - pow(dot(n0, polo), 2.0), 0.0)), 0.05);
      float dx = (hE - hW) * k / (2.0 * texel.x * 6.2831853 * coslat);
      float dy = (hN - hS) * k / (2.0 * texel.y * 3.1415927);
      vec3 T = normalize(cross(polo, n0)); vec3 B = cross(n0, T);
      n = normalize(n - T * dx - B * dy);
    }
    #endif
    // Detalhe procedural que aparece perto do chão (rochas, crateras pequenas)
    if (detalhe > 0.5) {
      // tamanho do pixel no chão (km): cresce muito em visada rasante, o que evita serrilhado e moiré
      float pixKm = max(length(fwidth(vMundo)) * kmPorUnidade, 1e-7);
      vec3 rel = paraCorpo * (vMundo * kmPorUnidade); // km, no referencial do corpo, relativo à câmera
      float h = 0.0, alb = 0.0, k = 1.0 / 40.0;
      // cada oitava gira (mesma rotação aplicada na CPU) para a grade do ruído não aparecer
      const mat3 GIRO = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
      for (int i = 0; i < 16; i++) {
        float tamKm = 1.0 / k;
        float vis = clamp(tamKm / (pixKm * 6.0) - 1.0, 0.0, 1.0);
        if (vis <= 0.0) break;
        // coordenada desta oitava (a câmera vem reduzida da CPU). Nas nuvens dos gasosos, o ruído é esticado no plano do
        // equador (os ventos correm ao longo dos paralelos) e não gira entre as oitavas, para as faixas ficarem alinhadas
        vec3 q = camOct[i] + (nuvemDet > 0.5 ? rel * vec3(0.25, 1.0, 0.25) : rel) * k;
        float r = ruido(q);
        if (nuvemDet < 0.5) rel = GIRO * rel;
        // oitavas muito maiores que o pixel quase não mudam o sombreamento, mas somariam alturas enormes
        // e a derivada de tela perderia precisão (aparecia uma grade); por isso saem suavemente
        float baixa = clamp(1.0 - log2(tamKm / (pixKm * 300.0)), 0.0, 1.0);
        // terreno de verdade tem inclinações parecidas em todas as escalas: a altura de cada oitava acompanha o
        // tamanho dela (antes caía duas vezes mais rápido e o chão de perto ficava liso). Das médias para baixo, cristas
        // (ruído "dobrado"), que lembram rochas e sulcos em vez de ondulações moles.
        // as cristas têm detalhe mais fino que a oitava: somem antes, para não serrilhar em visada rasante
        float visC = clamp(tamKm / (pixKm * 14.0) - 1.0, 0.0, 1.0);
        float forma = i >= 3 && nuvemDet < 0.5 ? mix(r, 1.0 - abs(2.0 * r - 1.0), visC) : r;
        h += (forma - 0.5) * vis * baixa * tamKm * 0.22 * pow(0.88, float(i)) * (nuvemDet > 0.5 ? 0.3 : 1.0); // nuvens: relevo macio
        // crateras em várias escalas (nos corpos sem atmosfera; menos em Marte), das oitavas de ~2,5 km às de metros
        if (crateraForca > 0.0 && i >= 4 && mod(float(i), 2.0) < 0.5) h += crateras(q) * tamKm * crateraForca * visC * baixa;
        alb += (r - 0.5) * vis * (i < 6 ? 0.5 : 0.35);
        k *= 2.0;
      }
      vec3 nb = relevoTela(vMundo, n, h * 0.5 / kmPorUnidade);
      n = normalize(mix(n, nb, smoothstep(0.2, 0.7, clamp(dot(nb, n), 0.0, 1.0)))); // nunca vira o chão do avesso
      base *= clamp(1.0 + 0.55 * alb, 0.4, 1.6);
    }
    // a foto de alta resolução já traz as sombras do relevo: o relevo global (grosseiro) quase não ilumina por cima dela
    #ifdef LADRILHO
    n = normalize(mix(n, n0, 0.45 * pesoDet)); // com o relevo fino de verdade, a luz dele vale mais
    #else
    n = normalize(mix(n, n0, 0.85 * pesoDet));
    #endif
    float l = max(dot(n, luz), 0.0);
    float lg = dot(n0, luz);
    float dia = smoothstep(-0.05, 0.05, lg);
    if (difusa > 0.0) { // sob nuvens grossas, a luz vem espalhada do céu todo: sombras fracas, e o dia acaba devagar
      l = mix(l, 0.5 + 0.4 * dot(n, n0), difusa);
      dia = mix(dia, smoothstep(-0.12, 0.25, lg), difusa);
    }
    float umbra;
    float ecl = luzEclipse(n0 * raio, luz, umbra);
    vec3 c = base * corLuz * (l * dia * ecl + 0.012);
    // na umbra da Terra, a Lua recebe só a luz avermelhada que atravessa a nossa atmosfera (todos os pores do sol ao mesmo tempo)
    c += base * vec3(0.55, 0.2, 0.07) * 0.22 * umbra * eclVermelho * smoothstep(-0.05, 0.05, lg);
    if (temNoite > 0.5) c += texture2D(noite, vUv).rgb * (1.0 - smoothstep(-0.12, 0.08, lg)) * 0.8;
    if (veuKm > 0.0) c = mix(c, corVeu * dia, 1.0 - exp(-length(vMundo) * kmPorUnidade / veuKm)); // o longe some no ar
    gl_FragColor = vec4(c * exposicao, 1.0);
    #include <colorspace_fragment>
  }`;

export const SIMPLES_V = LOGV + /* glsl */ `
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 m = modelMatrix * vec4(position, 1.0);
    vMundo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
    #include <logdepthbuf_vertex>
  }`;

export const NUVENS_F = LOGF + /* glsl */ `
  uniform sampler2D mapa, mapaA, mapaB; uniform vec3 luz; uniform float opac, real, mistura, horas, deriva;
  varying vec3 vN, vMundo; varying vec2 vUv;
  // nuvens na foto do dia: claras e sem cor (o mar, a terra e o brilho do Sol no mar ficam de fora)
  float nuvem(vec3 c) {
    float mn = min(min(c.r, c.g), c.b), mx = max(max(c.r, c.g), c.b);
    float sat = (mx - mn) / max(mx, 1e-3);
    return smoothstep(0.4, 0.75, mn) * (1.0 - smoothstep(0.07, 0.2, sat)); // areia clara tem um pouco de cor; nuvem é cinza ou branca
  }
  // deriva ilustrativa: ventos alísios para oeste nos trópicos, ventos de oeste nas latitudes médias (graus de longitude por hora)
  float vento(float lat) {
    float a = abs(lat);
    return -0.5 * (1.0 - smoothstep(20.0, 32.0, a)) + 0.55 * smoothstep(30.0, 42.0, a) * (1.0 - smoothstep(58.0, 72.0, a));
  }
  void main() {
    #include <logdepthbuf_fragment>
    float a;
    if (real > 0.5) {
      float lat = (vUv.y - 0.5) * 180.0;
      vec2 uA = vUv, uB = vUv;
      uA.x -= deriva * vento(lat) * horas / 360.0;          // a foto do dia, levada pelo vento desde a hora dela
      uB.x -= deriva * vento(lat) * (horas - 24.0) / 360.0;  // a do dia seguinte, vinda de trás
      a = mix(nuvem(texture2D(mapaA, uA).rgb), nuvem(texture2D(mapaB, uB).rgb), mistura) * opac;
    } else a = texture2D(mapa, vUv).r * opac;
    float l = dot(normalize(vN), luz);
    gl_FragColor = vec4(vec3(max(l, 0.0) + 0.01), a * 0.92);
    #include <colorspace_fragment>
  }`;

// Atmosfera: de fora, um halo iluminado; de dentro, a cor do céu (some à noite)
export const ATM_F = LOGF + /* glsl */ `
  uniform vec3 cor, luz, centro;
  uniform float dentro, densidade, luar, urbano;
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 v = normalize(-vMundo);
    vec3 n = normalize(vN);
    if (dentro < 0.5) {
      float rim = 1.0 - abs(dot(n, v));
      float sol = smoothstep(-0.35, 0.45, dot(n, luz));
      float a = clamp(pow(rim, 2.6) * sol * 1.5, 0.0, 1.0);
      gl_FragColor = vec4(cor, a);
    } else {
      vec3 up = normalize(-centro);
      float dia = smoothstep(-0.18, 0.15, dot(up, luz));
      vec3 dir = -v;
      float alto = max(dot(dir, up), 0.0);
      vec3 ceu = mix(cor * 1.1, cor * 0.55, pow(alto, 0.6));
      float poente = (1.0 - smoothstep(0.0, 0.35, dot(up, luz))) * pow(1.0 - alto, 3.0) * max(dot(dir, luz), 0.0);
      ceu = mix(ceu, vec3(1.0, 0.45, 0.2), clamp(poente, 0.0, 0.8));
      float claro = max(dia, luar * 0.22); // a Lua cheia clareia um pouco o céu noturno
      vec3 cc = ceu * (0.25 + 0.75 * dia);
      float aa = claro * 0.97 * densidade;
      float g = urbano * (0.18 + 0.82 * pow(1.0 - alto, 3.0)) * densidade; // poluição luminosa
      gl_FragColor = vec4((cc * aa + vec3(0.30, 0.24, 0.17) * g) / max(aa + g, 1e-4), min(aa + g, 1.0));
    }
    #include <colorspace_fragment>
  }`;

// Atmosfera física: espalhamento simples de Rayleigh (moléculas: céu azul, poente vermelho) e Mie (aerossóis e poeira:
// névoa branca e halo em volta do Sol), integrado ao longo de cada raio de visão, com a luz do Sol atenuada até cada ponto
// e a sombra do planeta. Unidades: raio do planeta = 1. Mistura pré-multiplicada (soma a luz espalhada e atenua o que
// está atrás: chão, estrelas).
export const ATM_FIS_F = LOGF + ECLIPSE + /* glsl */ `
  uniform vec3 luz, centro, betaR, betaMs, betaMe, betaO, gM;
  uniform float raioR, topo, HR, HM, intensidade, exposicao, luar, multiplo, urbano, raioCorpo;
  varying vec3 vN, vMundo; varying vec2 vUv;
  vec2 esfera(vec3 o, vec3 d, float r) {
    float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c;
    if (h < 0.0) return vec2(1e9, -1e9);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }
  // profundidade óptica de um raio que sai da altura h (em escalas de altura) com cosseno zenital cz, até o espaço:
  // aproximação da função de Chapman (C. Schüler, GPU Pro 3), em vez de integrar passo a passo
  float chapman(float X, float h, float cz) {
    float c = sqrt(X + h);
    if (cz >= 0.0) return c / (c * cz + 1.0) * exp(-h);
    float x0 = sqrt(1.0 - cz * cz) * (X + h);
    return 2.0 * sqrt(x0) * exp(X - x0) - c / (1.0 - c * cz) * exp(-h);
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vMundo);
    vec3 o = -centro / raioR;
    vec2 ta = esfera(o, d, topo);
    if (ta.x > ta.y || ta.y < 0.0) discard;
    float t0 = max(ta.x, 0.0), t1 = ta.y;
    vec2 tp = esfera(o, d, 1.0);
    if (tp.x < tp.y && tp.x > 0.0) t1 = min(t1, tp.x);
    if (t1 <= t0) discard;
    const int N = 16;
    float ds = (t1 - t0) / float(N);
    vec3 somaR = vec3(0.0), somaM = vec3(0.0), somaA = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < N; i++) {
      vec3 p = o + d * (t0 + ds * (float(i) + 0.5));
      float h = max(length(p) - 1.0, 0.0);
      float dR = exp(-h / HR) * ds, dM = exp(-h / HM) * ds;
      odR += 0.5 * dR; odM += 0.5 * dM;
      // espalhamento múltiplo (aproximado): o céu em volta ilumina cada ponto, mesmo na sombra, enquanto o Sol não
      // está muito abaixo do horizonte local; é o que deixa o crepúsculo azul depois que o Sol some
      float ambiente = smoothstep(-0.28, 0.2, dot(normalize(p), luz));
      somaA += dR * ambiente * exp(-((betaR + betaO) * odR + betaMe * odM));
      vec2 tpl = esfera(p, luz, 1.0);
      if (!(tpl.x < tpl.y && tpl.x > 0.0)) { // fora da sombra do planeta
        float cz = dot(normalize(p), luz);
        float lR = HR * chapman(1.0 / HR, h / HR, cz), lM = HM * chapman(1.0 / HM, h / HM, cz);
        vec3 atn = exp(-((betaR + betaO) * (odR + lR) + betaMe * (odM + lM)));
        somaR += dR * atn; somaM += dM * atn;
      }
      odR += 0.5 * dR; odM += 0.5 * dM;
    }
    float mu = dot(d, luz);
    float fR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    vec3 g2 = gM * gM;
    vec3 fM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * gM * mu, vec3(1.5)));
    vec3 L = intensidade * (somaR * betaR * fR + somaM * betaMs * fM + multiplo * somaA * betaR / (4.0 * PI));
    float um; // na sombra da Lua, o ar também fica sem sol (avaliado onde o raio toca o chão ou mais se aproxima dele)
    L *= mix(0.025, 1.0, luzEclipse(normalize(o + d * t1) * raioCorpo, luz, um)); // na totalidade, sobra a luz que vem do céu fora da sombra
    vec3 T = exp(-((betaR + betaO) * odR + betaMe * odM));
    // compressão que preserva o tom (sem ela, perto do Sol o vermelho e o verde saturam juntos e o poente fica amarelo)
    float mx = max(max(L.r, L.g), max(L.b, 1e-6));
    vec3 cor = mix(L / mx * (1.0 - exp(-mx * exposicao)), 1.0 - exp(-L * exposicao), 0.25);
    cor += luar * 0.06 * vec3(0.35, 0.55, 1.0) * clamp((1.0 - T.b) * 4.0, 0.0, 1.0); // luar: um véu azulado fraco
    // poluição luminosa: as luzes da cidade iluminam o ar por baixo; o brilho alaranjado cresce perto do horizonte
    float alturaVisada = max(dot(d, normalize(o)), 0.0);
    cor += urbano * vec3(0.30, 0.24, 0.17) * (0.18 + 0.82 * pow(1.0 - alturaVisada, 3.0));
    float a = clamp(1.0 - (T.r + T.g + T.b) / 3.0, 0.0, 1.0);
    // a soma acontece nos valores já codificados da tela: converter a luz espalhada para sRGB a exageraria (véu leitoso),
    // então ela sai direto, já comprimida pela exposição
    gl_FragColor = vec4(cor, a);
  }`;

export const ANEIS_V = LOGV + /* glsl */ `
  attribute float raioRel;
  varying float vR; varying vec3 vMundo;
  void main() {
    vR = raioRel;
    vec4 m = modelMatrix * vec4(position, 1.0);
    vMundo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
    #include <logdepthbuf_vertex>
  }`;
export const ANEIS_F = LOGF + /* glsl */ `
  uniform sampler2D mapa; uniform vec3 luz, centro, polo; uniform float raioP;
  varying float vR; varying vec3 vMundo;
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(mapa, vec2(vR, 0.5));
    vec3 P = vMundo - centro;
    float tt = -dot(P, luz);
    float sombra = (tt > 0.0 && length(P + luz * tt) < raioP) ? 0.06 : 1.0;
    // visto pelo lado que o Sol não ilumina, o anel só deixa passar um pouco de luz
    bool ladoEscuro = sign(dot(polo, luz)) != sign(dot(polo, -vMundo));
    float k = ladoEscuro ? 0.22 : 1.0;
    gl_FragColor = vec4(t.rgb * (0.1 + 0.9 * sombra) * k, t.a * (ladoEscuro ? 0.7 : 0.95));
    #include <colorspace_fragment>
  }`;

// Brilhos: pontos de luz com tamanho em pixels (estrelas, galáxias, marcadores)
export const BRILHO_V = LOGV + REL + /* glsl */ `
  attribute float tamanho; attribute vec3 cor; attribute float alfa;
  varying vec3 vCor; varying float vAlfa;
  uniform float escalaPx;
  void main() {
    float D;
    vec3 p = aberrar(position, D);
    vCor = tingir(cor, D); vAlfa = alfa * min(D * D * D, 2.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = tamanho * escalaPx;
    #include <logdepthbuf_vertex>
  }`;
export const BRILHO_F = LOGF + /* glsl */ `
  varying vec3 vCor; varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float a = exp(-r * r * 9.0) + 0.25 * exp(-r * 5.0) * (1.0 - r);
    gl_FragColor = vec4(vCor * a * vAlfa, 1.0);
  }`;

// Cinturões: cada ponto em órbita kepleriana circular em torno do Sol, calculado na GPU
export const CINTURAO_V = LOGV + REL + /* glsl */ `
  attribute vec4 orb; // raio (km), fase inicial, inclinação, nodo (rad)
  uniform vec3 solRel; uniform float dias, R0, escalaPx, tamanho;
  void main() {
    float aUA = orb.x / 1.495978707e8;
    float ang = orb.y + 6.2831853 / (365.25 * pow(aUA, 1.5)) * dias;
    vec3 p = vec3(cos(ang), sin(orb.z) * sin(ang - orb.w), -sin(ang)) * orb.x;
    vec3 w = solRel + p;
    float d = length(w);
    float s = d <= R0 ? 1.0 : R0 * (1.0 + log(d / R0)) / d;
    float D;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aberrar(w * s, D), 1.0);
    gl_PointSize = tamanho * escalaPx;
    #include <logdepthbuf_vertex>
  }`;
export const CINTURAO_F = LOGF + /* glsl */ `
  uniform vec3 cor; uniform float alfa;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(cor * alfa * (1.0 - r * r), 1.0);
  }`;

// Céu de estrelas do catálogo. Posições em parsecs; a câmera vem partida em parte alta + baixa
// (precisão dupla emulada), para a estrela continuar no lugar certo mesmo quando se chega perto dela.
export const CEU_V = LOGV + REL + /* glsl */ `
  attribute float absmag; attribute vec3 cor; attribute float temp;
  uniform vec3 camAlto, camBaixo;
  uniform float PCKM, R0, limite, limiteTam, escalaPx, apagar;
  uniform int ocultos[8];
  varying vec3 vCor; varying float vAlfa;
  void main() {
    bool oculto = false;
    for (int k = 0; k < 8; k++) if (ocultos[k] == gl_VertexID) oculto = true;
    vec3 rel = (position - camAlto) - camBaixo;
    float dpc = max(length(rel), 1e-15);
    float dkm = dpc * PCKM;
    float s = dkm <= R0 ? 1.0 : R0 * (1.0 + log(dkm / R0)) / dkm;
    float D;
    rel = aberrar(refratar(rel), D);
    float m = absmag + 5.0 * log(dpc) * 0.4342945 - 5.0 - 7.5 * log(min(D, 1.4)) * 0.4342945;
    float b = pow(10.0, -0.4 * (m - limite));
    vCor = D == 1.0 ? cor : corTemp(temp * D);
    vAlfa = min(b, 1.0) * (1.0 - apagar);
    if (oculto || vAlfa < 0.012) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(rel * PCKM * s, 1.0);
    // no telescópio, o limite sobe (aparecem mais estrelas), mas o tamanho segue o do olho: estrelas continuam pontos
    float bt = pow(10.0, -0.4 * (m - limiteTam));
    gl_PointSize = clamp(2.2 * pow(bt, 0.22), 1.5, 90.0) * escalaPx;
    #include <logdepthbuf_vertex>
  }`;

// Bolha do rádio humano: casca quase invisível, com borda e uma grade sutil
export const BOLHA_F = LOGF + /* glsl */ `
  uniform vec3 cor; uniform float forca;
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float r = 1.0 - abs(dot(normalize(vN), normalize(-vMundo)));
    float grade = smoothstep(0.992, 1.0, abs(sin(vUv.x * 3.14159 * 24.0))) + smoothstep(0.992, 1.0, abs(sin(vUv.y * 3.14159 * 12.0)));
    float a = (pow(r, 4.0) * 0.9 + grade * 0.07) * forca;
    gl_FragColor = vec4(cor * a, 1.0);
  }`;

// Nuvens da Via Láctea (e campo de galáxias distantes): tamanho físico em parsecs vira tamanho na tela
export const NUVEM_V = LOGV + REL + /* glsl */ `
  attribute vec3 cor; attribute float tam, brilho;
  uniform vec3 camAlto, camBaixo;
  uniform float PCKM, R0, pxPorRad, escalaPx, apagar, ganho, distMin;
  varying vec3 vCor; varying float vAlfa;
  void main() {
    vec3 rel = (position - camAlto) - camBaixo;
    float dpc = max(length(rel), 1e-9);
    float dkm = dpc * PCKM;
    float s = dkm <= R0 ? 1.0 : R0 * (1.0 + log(dkm / R0)) / dkm;
    float px = tam / dpc * pxPorRad;
    float a;
    if (distMin > 0.5) {
      // campo distante: aparência de mapa (não some com a distância)
      a = brilho * ganho * clamp(4e8 / dpc, 0.1, 1.0) * smoothstep(tam * 2.0, tam * 20.0, dpc);
      px = max(px, 1.6);
    } else {
      a = brilho * ganho * smoothstep(tam * 1.5, tam * 8.0, dpc);
      if (px < 1.5) { a *= px * px / 2.25; px = 1.5; }
    }
    float D;
    rel = aberrar(rel, D);
    a *= (1.0 - apagar) * min(D, 1.5);
    px = min(px / D, 180.0); // a aberração também encolhe (à frente) ou estica (atrás) cada nuvem
    vCor = tingir(cor, D); vAlfa = a;
    if (a < 0.0015) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(rel * PCKM * s, 1.0);
    gl_PointSize = px * escalaPx;
    #include <logdepthbuf_vertex>
  }`;
export const NUVEM_F = LOGF + /* glsl */ `
  varying vec3 vCor; varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vCor * exp(-r * r * 4.0) * (1.0 - r) * vAlfa, 1.0);
  }`;
// Poeira: escurece o que está atrás (mistura: destino × (1 − alfa))
export const POEIRA_F = LOGF + /* glsl */ `
  varying vec3 vCor; varying float vAlfa;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, exp(-r * r * 4.0) * (1.0 - r) * vAlfa);
  }`;
// Borda do universo observável: padrão parecido com a radiação cósmica de fundo (ilustrativo)
export const CMB_F = LOGF + RUIDO + /* glsl */ `
  uniform float forca;
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    float f = ruido(n * 6.0) * 0.4 + ruido(n * 13.0) * 0.25 + ruido(n * 29.0) * 0.15 + ruido(n * 70.0) * 0.12 + ruido(n * 160.0) * 0.08;
    vec3 c = mix(vec3(0.1, 0.25, 0.8), vec3(1.0, 0.95, 0.85), smoothstep(0.35, 0.5, f));
    c = mix(c, vec3(1.0, 0.45, 0.1), smoothstep(0.5, 0.68, f));
    gl_FragColor = vec4(c * forca, 1.0);
  }`;

// Via Láctea vista do Sistema Solar: mapa em coordenadas galácticas numa esfera em volta da câmera.
// No modo relatividade, desfaz a aberração para achar a direção de origem de cada pixel e tinge pelo Doppler.
// Linhas das constelações: direções fixas (vistas do Sistema Solar), com aberração no modo relatividade
// Faixas com largura fixa na tela (linhas do WebGL têm 1 pixel físico: quase somem em telas Retina e de celular)
export const LINHA_CEU_V = LOGV + REL + /* glsl */ `
  attribute vec3 outra; attribute vec2 canto; // canto.x: 0 nesta ponta, 1 na outra; canto.y: lado (−1 ou 1)
  uniform vec2 res; uniform float meia; // tamanho da imagem e meia largura, em pixels físicos
  varying float vLado;
  void main() {
    float D;
    vec4 a = modelViewMatrix * vec4(aberrar(refratar(position), D), 1.0);
    vec4 b = modelViewMatrix * vec4(aberrar(refratar(outra), D), 1.0);
    float k = 1e-3 * length(a.xyz);
    if (a.z > -k && b.z > -k) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // atrás da câmera
    if (a.z > -k) a = mix(a, b, (a.z + k) / (a.z - b.z));
    if (b.z > -k) b = mix(b, a, (b.z + k) / (b.z - a.z));
    vec4 ca = projectionMatrix * a, cb = projectionMatrix * b;
    vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * res;
    vec2 n = length(d) > 1e-6 ? normalize(vec2(-d.y, d.x)) : vec2(0.0, 1.0);
    vLado = canto.y;
    gl_Position = ca;
    gl_Position.xy += n * canto.y * (meia + 1.0) * 2.0 / res * ca.w;
    #include <logdepthbuf_vertex>
  }`;
// Figuras das constelações no céu (js/figurasCeu.js): a ilustração em cinza, somada à luz do céu, azulada e fraca
export const FIGURA_CEU_V = LOGV + REL + /* glsl */ `
  varying vec2 vUv;
  void main() {
    float D;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aberrar(refratar(position), D), 1.0);
    #include <logdepthbuf_vertex>
  }`;
export const FIGURA_CEU_F = LOGF + /* glsl */ `
  uniform sampler2D atlas; uniform float opac;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(atlas, vUv).r;
    gl_FragColor = vec4(vec3(0.62, 0.76, 1.0) * a * opac, 1.0);
  }`;
export const LINHA_CEU_F = LOGF + /* glsl */ `
  uniform float opac, meia;
  varying float vLado;
  void main() {
    #include <logdepthbuf_fragment>
    float px = abs(vLado) * (meia + 1.0);       // distância ao eixo, em pixels físicos
    float a = clamp(meia + 0.5 - px, 0.0, 1.0); // borda suave de um pixel
    gl_FragColor = vec4(0.55, 0.72, 1.0, opac * a);
  }`;

export const CEU_VIA_F = LOGF + REL + /* glsl */ `
  uniform sampler2D mapa, mapaReal; uniform float forca, real, ganhoReal; uniform vec3 GX, GY, GZ, EX, EY, EZ;
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vMundo);
    float D = 1.0;
    float b = length(beta);
    if (b > 1e-4) {
      vec3 bh = beta / b;
      float c2 = dot(n, bh);
      float c = (c2 - b) / (1.0 - b * c2);
      vec3 perp = n - c2 * bh;
      float pl = length(perp);
      if (pl > 1e-6) n = c * bh + sqrt(max(1.0 - c * c, 0.0)) * perp / pl;
      D = (1.0 + b * c) / sqrt(1.0 - b * b);
    }
    vec3 c;
    if (real > 0.5) {
      // mapa real (NASA, Deep Star Maps 2020): ascensão reta 0 no centro, crescendo para a esquerda; gravado com gama 2,2
      float ra = atan(dot(n, EY), dot(n, EX));
      float dec = asin(clamp(dot(n, EZ), -1.0, 1.0));
      c = pow(texture2D(mapaReal, vec2(fract(0.5 - ra / 6.2831853), 0.5 + dec / 3.1415927)).rgb, vec3(2.2)) * ganhoReal;
    } else {
      float l = atan(dot(n, GY), dot(n, GX));
      float lat = asin(clamp(dot(n, GZ), -1.0, 1.0));
      c = texture2D(mapa, vec2(0.5 - l / 6.2831853, 0.5 + lat / 3.1415927)).rgb;
    }
    gl_FragColor = vec4(tingir(c, D) * forca * min(D * D, 2.0), 1.0);
  }`;

// Ladrilhos da Terra: imagem de satélite, relevo real (exagerável), reflexo do Sol na água,
// luzes das cidades no lado noturno e névoa atmosférica com a distância
export const TERRA_V = LOGV + /* glsl */ `
  attribute vec4 dirAlt; attribute float agua; attribute vec2 glob, uvN;
  uniform float exagero, nivelMar;
  varying vec2 vUv, vGlob, vUvN; varying vec3 vN, vMundo, vRadial; varying float vAgua, vH;
  void main() {
    vUv = uv; vGlob = glob; vUvN = uvN; vH = dirAlt.w;
    vAgua = dirAlt.w < nivelMar ? 1.0 : 0.0;
    vRadial = mat3(modelMatrix) * dirAlt.xyz;
    // a malha foi montada com o mar no nível zero; aqui sobe ou desce a água e aplica o exagero do relevo
    float hBase = max(dirAlt.w, 0.0);
    float hMostra = max(dirAlt.w, nivelMar);
    vec3 p = position + dirAlt.xyz * (hMostra * exagero - hBase);
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 m = modelMatrix * vec4(p, 1.0);
    vMundo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
    #include <logdepthbuf_vertex>
  }`;
export const TERRA_F = LOGF + ECLIPSE + /* glsl */ `
  uniform sampler2D imagem, noite, noiteTile;
  uniform vec3 luz, corCeu;
  uniform float nevoa, kmPorUnidade, temNoiteTile, nivelMar, gelo, semLuzes;
  varying vec2 vUv, vGlob, vUvN; varying vec3 vN, vMundo, vRadial; varying float vAgua, vH;
  // Mantos de gelo do último máximo glacial (~20 mil anos), contornos APROXIMADOS
  float faixa(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
  float elipse(float lat, float lon, float la0, float lo0, float rla, float rlo) {
    float d = length(vec2((lat - la0) / rla, (lon - lo0) / rlo));
    return 1.0 - smoothstep(0.75, 1.15, d);
  }
  float geloGlacial(float lat, float lon) {
    float ond = sin(radians(lon * 7.0)) * 1.2 + sin(radians(lon * 17.0 + 40.0)) * 0.6; // borda irregular
    float g = smoothstep(-61.0, -64.0, lat); // Antártida
    float limNA = 47.0 + 3.0 * sin(radians(lon * 4.0)) + ond;
    g = max(g, smoothstep(limNA - 1.0, limNA + 1.5, lat) * faixa(lon, -138.0, -53.0, 4.0)); // Laurentide e Cordilheira
    g = max(g, smoothstep(57.5, 61.0, lat) * faixa(lon, -153.0, -138.0, 3.0)); // costa do Alasca
    g = max(g, smoothstep(58.0, 61.0, lat) * faixa(lon, -74.0, -12.0, 3.0)); // Groenlândia
    g = max(g, elipse(lat, lon, 64.9, -18.5, 2.2, 6.0)); // Islândia
    float limEU = (lon < 25.0 ? 51.5 + 1.2 * sin(radians(lon * 9.0)) : 51.5 + (lon - 25.0) * 0.22) + ond * 0.6;
    g = max(g, smoothstep(limEU - 0.8, limEU + 1.4, lat) * faixa(lon, -11.0, 66.0, 4.0)); // Fenoscândia e Ilhas Britânicas
    g = max(g, smoothstep(-39.5, -42.5, lat) * faixa(lon, -75.5, -70.5, 1.2)); // Andes da Patagônia
    g = max(g, elipse(lat, lon, 46.3, 10.0, 1.4, 4.2) * 0.9); // Alpes
    return g;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 base = texture2D(imagem, vUv).rgb;
    // nível do mar diferente do atual: terra alagada vira água; fundo do mar exposto vira planície costeira
    if (vH < nivelMar && vH >= 0.0) base = mix(vec3(0.05, 0.16, 0.26), vec3(0.12, 0.32, 0.38), clamp(1.0 - (nivelMar - vH) / 0.08, 0.0, 1.0));
    if (vH >= nivelMar && vH < 0.0) base = mix(vec3(0.52, 0.49, 0.38), vec3(0.36, 0.42, 0.28), clamp(-vH / 0.12, 0.0, 1.0));
    // no mar, a normal é a da esfera (lisa e contínua entre ladrilhos); em terra, a do relevo
    vec3 n = normalize(vAgua > 0.5 ? vRadial : vN);
    float l = dot(n, luz);
    // luz do Sol nas encostas + luz difusa do céu (azulada), que clareia o lado da montanha sem Sol durante o dia;
    // a foto de satélite já traz parte da sombra, então o contraste do relevo é um pouco suavizado
    vec3 rad = normalize(vRadial);
    float diaAqui = smoothstep(-0.15, 0.2, dot(rad, luz));
    float lSol = max(mix(dot(rad, luz), l, 0.6), 0.0);
    vec3 ceuDifuso = vec3(0.55, 0.68, 1.0) * (0.07 + 0.09 * max(dot(n, rad), 0.0)) * diaAqui;
    float umbraT;
    float ecl = luzEclipse(rad * 6371.0, luz, umbraT); // sombra da Lua num eclipse solar
    vec3 c = base * ((lSol * 1.05 + ceuDifuso) * ecl + 0.015);
    c -= max(c - 0.72, 0.0) * 0.6; // paredões de pedra virados para o Sol (foto esticada na encosta) não estouram em branco
    if (vAgua > 0.5 && l > 0.0) {
      vec3 h = normalize(luz + normalize(-vMundo));
      c += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 140.0) * 0.7 * clamp(1.0 - length(vMundo) * kmPorUnidade / 9000.0, 0.15, 1.0); // reflexo mais discreto visto de longe
    }
    vec3 luzes = temNoiteTile > 0.5 ? texture2D(noiteTile, vUvN).rgb * 1.3 : texture2D(noite, vGlob).rgb * 0.8;
    // luzes das cidades só quando é noite no lugar (pela esfera), não nas encostas de costas para o Sol durante o dia
    // de perto, a imagem de luzes (~600 m) viraria um lençol branco: atenua e usa a foto do dia para dar textura (ruas e quadras)
    float dKm = length(vMundo) * kmPorUnidade;
    float longe = smoothstep(20.0, 120.0, dKm);
    float perto = mix(0.10, 1.0, smoothstep(4.0, 120.0, dKm));
    float textura = mix(0.08 + 2.4 * pow(dot(base, vec3(0.333)), 1.6), 1.0, longe); // parques e água escuros, ruas e quadras claras
    luzes *= perto * textura * mix(vec3(1.0, 0.72, 0.42), vec3(1.0), longe);     // de perto, o alaranjado da iluminação pública
    c += luzes * (1.0 - smoothstep(-0.12, 0.08, dot(rad, luz))) * (1.0 - max(gelo, semLuzes)); // sem cidades na era glacial e no modo céu
    if (gelo > 0.5) {
      float g = geloGlacial((vGlob.y - 0.5) * 180.0, vGlob.x * 360.0 - 180.0);
      c = mix(c, vec3(0.93, 0.96, 1.0) * (max(l, 0.0) * 1.05 + 0.03), g * 0.96);
    }
    float dk = length(vMundo) * kmPorUnidade;
    float f = (1.0 - exp(-dk / 160.0)) * nevoa;
    float dia = smoothstep(-0.1, 0.3, l);
    c = mix(c, corCeu * (0.12 + 0.88 * dia) * 0.85, f * 0.6);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;
