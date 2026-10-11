// Shaders. Todos usam o depth buffer logarítmico (por causa da escala).
const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

// Relatividade especial para quem se move com velocidade beta (fração de c, eixos da cena):
// aberração (as fontes se juntam à frente) e fator Doppler D (frequência × D; brilho ~ D³).
const REL = /* glsl */ `
  uniform vec3 beta;
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

export const PLANETA_V = LOGV + /* glsl */ `
  uniform sampler2D relevo;
  uniform float temRelevo, hMin, hMax, exagero, raio, usarPiso, pisoMar;
  varying vec3 vN, vP, vMundo; varying vec2 vUv;
  void main() {
    vUv = uv; vP = position;
    vec3 pos = position;
    if (temRelevo > 0.5) {
      float h = mix(hMin, hMax, texture2D(relevo, uv).r);
      if (usarPiso > 0.5) h = max(h, pisoMar); // superfície do mar plana (Terra antiga)
      pos *= 1.0 + h * exagero / raio;
    }
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 m = modelMatrix * vec4(pos, 1.0);
    vMundo = m.xyz;
    gl_Position = projectionMatrix * viewMatrix * m;
    #include <logdepthbuf_vertex>
  }`;

export const PLANETA_F = LOGF + RUIDO + /* glsl */ `
  uniform sampler2D mapa, noite, relevo;
  uniform float temMapa, temNoite, emissivo, temRelevo, hMin, hMax, exagero, raio, detalhe, kmPorUnidade, usarTextura, usarPiso, pisoMar, exposicao;
  uniform vec3 corBase, luz, polo;
  uniform vec2 texel;
  uniform vec3 camOct[16]; uniform mat3 paraCorpo;
  varying vec3 vN, vP, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n0 = normalize(vN);
    vec3 n = n0;
    vec3 base;
    if (temMapa > 0.5 && usarTextura > 0.5) base = texture2D(mapa, vUv).rgb;
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
      float mu = max(dot(n, normalize(-vMundo)), 0.0);
      gl_FragColor = vec4(base * (0.38 + 0.62 * pow(mu, 0.5)) * 1.35, 1.0);
      #include <colorspace_fragment>
      return;
    }
    bool sobAgua = usarPiso > 0.5 && mix(hMin, hMax, texture2D(relevo, vUv).r) < pisoMar;
    if (temRelevo > 0.5 && !sobAgua) {
      float hE = texture2D(relevo, vUv + vec2(texel.x, 0.0)).r, hW = texture2D(relevo, vUv - vec2(texel.x, 0.0)).r;
      float hN = texture2D(relevo, vUv + vec2(0.0, texel.y)).r, hS = texture2D(relevo, vUv - vec2(0.0, texel.y)).r;
      float k = (hMax - hMin) * exagero / raio;
      float coslat = max(sqrt(max(1.0 - pow(dot(n0, polo), 2.0), 0.0)), 0.05);
      float dx = (hE - hW) * k / (2.0 * texel.x * 6.2831853 * coslat);
      float dy = (hN - hS) * k / (2.0 * texel.y * 3.1415927);
      vec3 T = normalize(cross(polo, n0)); vec3 B = cross(n0, T);
      n = normalize(n - T * dx - B * dy);
    }
    // Detalhe procedural que aparece perto do chão (rochas, crateras pequenas)
    if (detalhe > 0.5) {
      // tamanho do pixel no chão (km): cresce muito em visada rasante, o que evita serrilhado e moiré
      float pixKm = max(length(fwidth(vMundo)) * kmPorUnidade, 1e-7);
      vec3 rel = paraCorpo * (vMundo * kmPorUnidade); // km, no referencial do corpo, relativo à câmera
      float h = 0.0, alb = 0.0, amp = 1.0, k = 1.0 / 40.0;
      // cada oitava gira (mesma rotação aplicada na CPU) para a grade do ruído não aparecer
      const mat3 GIRO = mat3(0.36, 0.48, -0.8, -0.8, 0.6, 0.0, 0.48, 0.64, 0.6);
      for (int i = 0; i < 16; i++) {
        float tamKm = 1.0 / k;
        float vis = clamp(tamKm / (pixKm * 6.0) - 1.0, 0.0, 1.0);
        if (vis <= 0.0) break;
        float r = ruido(camOct[i] + rel * k);
        rel = GIRO * rel;
        // oitavas muito maiores que o pixel quase não mudam o sombreamento, mas somariam alturas enormes
        // e a derivada de tela perderia precisão (aparecia uma grade); por isso saem suavemente
        float baixa = clamp(1.0 - log2(tamKm / (pixKm * 300.0)), 0.0, 1.0);
        h += (r - 0.5) * amp * vis * baixa * tamKm;
        alb += (r - 0.5) * vis * (i < 6 ? 0.5 : 0.25);
        k *= 2.0; amp *= 0.5;
      }
      vec3 nb = relevoTela(vMundo, n, h * 0.5 / kmPorUnidade);
      n = normalize(mix(n, nb, smoothstep(0.2, 0.7, clamp(dot(nb, n), 0.0, 1.0)))); // nunca vira o chão do avesso
      base *= clamp(1.0 + 0.55 * alb, 0.4, 1.6);
    }
    float l = dot(n, luz);
    float lg = dot(n0, luz);
    vec3 c = base * (max(l, 0.0) * smoothstep(-0.05, 0.05, lg) + 0.012);
    if (temNoite > 0.5) c += texture2D(noite, vUv).rgb * (1.0 - smoothstep(-0.12, 0.08, lg)) * 0.8;
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
  uniform sampler2D mapa; uniform vec3 luz; uniform float opac;
  varying vec3 vN, vMundo; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(mapa, vUv).r * opac;
    float l = dot(normalize(vN), luz);
    gl_FragColor = vec4(vec3(max(l, 0.0) + 0.01), a * 0.92);
    #include <colorspace_fragment>
  }`;

// Atmosfera: de fora, um halo iluminado; de dentro, a cor do céu (some à noite)
export const ATM_F = LOGF + /* glsl */ `
  uniform vec3 cor, luz, centro;
  uniform float dentro, densidade, luar;
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
      gl_FragColor = vec4(ceu * (0.25 + 0.75 * dia), claro * 0.97 * densidade);
    }
    #include <colorspace_fragment>
  }`;

// Atmosfera física: espalhamento simples de Rayleigh (moléculas: céu azul, poente vermelho) e Mie (aerossóis e poeira:
// névoa branca e halo em volta do Sol), integrado ao longo de cada raio de visão, com a luz do Sol atenuada até cada ponto
// e a sombra do planeta. Unidades: raio do planeta = 1. Mistura pré-multiplicada (soma a luz espalhada e atenua o que
// está atrás: chão, estrelas).
export const ATM_FIS_F = LOGF + /* glsl */ `
  uniform vec3 luz, centro, betaR, betaMs, betaMe, betaO, gM;
  uniform float raioR, topo, HR, HM, intensidade, exposicao, luar, multiplo;
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
    vec3 T = exp(-((betaR + betaO) * odR + betaMe * odM));
    // compressão que preserva o tom (sem ela, perto do Sol o vermelho e o verde saturam juntos e o poente fica amarelo)
    float mx = max(max(L.r, L.g), max(L.b, 1e-6));
    vec3 cor = mix(L / mx * (1.0 - exp(-mx * exposicao)), 1.0 - exp(-L * exposicao), 0.25);
    cor += luar * 0.06 * vec3(0.35, 0.55, 1.0) * clamp((1.0 - T.b) * 4.0, 0.0, 1.0); // luar: um véu azulado fraco
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
    rel = aberrar(rel, D);
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
export const LINHA_CEU_V = LOGV + REL + /* glsl */ `
  void main() {
    float D;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(aberrar(position, D), 1.0);
    #include <logdepthbuf_vertex>
  }`;
export const LINHA_CEU_F = LOGF + /* glsl */ `
  uniform float opac;
  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(0.55, 0.72, 1.0, opac);
  }`;

export const CEU_VIA_F = LOGF + REL + /* glsl */ `
  uniform sampler2D mapa; uniform float forca; uniform vec3 GX, GY, GZ;
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
    float l = atan(dot(n, GY), dot(n, GX));
    float lat = asin(clamp(dot(n, GZ), -1.0, 1.0));
    vec3 c = texture2D(mapa, vec2(0.5 - l / 6.2831853, 0.5 + lat / 3.1415927)).rgb;
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
export const TERRA_F = LOGF + /* glsl */ `
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
    vec3 c = base * (max(l, 0.0) * 1.1 + 0.015);
    if (vAgua > 0.5 && l > 0.0) {
      vec3 h = normalize(luz + normalize(-vMundo));
      c += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 140.0) * 0.7 * clamp(1.0 - length(vMundo) * kmPorUnidade / 9000.0, 0.15, 1.0); // reflexo mais discreto visto de longe
    }
    vec3 luzes = temNoiteTile > 0.5 ? texture2D(noiteTile, vUvN).rgb * 1.3 : texture2D(noite, vGlob).rgb * 0.8;
    c += luzes * (1.0 - smoothstep(-0.12, 0.08, l)) * (1.0 - max(gelo, semLuzes)); // sem cidades na era glacial e no modo céu
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
