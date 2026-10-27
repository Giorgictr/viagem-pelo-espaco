// Brilho em volta das luzes fortes ("bloom"), como numa foto: o que chega perto do branco ou passa dele (o disco do Sol,
// os brilhos das estrelas somados, as nuvens mais claras, a Lua cheia vista do chão) espalha um halo suave em volta. A cena é desenhada numa imagem que guarda
// valores acima de 1 (meia precisão); o excesso é reduzido em 6 níveis (cada um com metade do tamanho) e somado de
// volta, do menor para o maior, o que dá um halo largo e macio sem custar caro. Os planetas iluminados não chegam ao
// branco e ficam como estão.
// A cena é gravada já com a mesma codificação da tela (sRGB), para todos os materiais saírem idênticos; o halo é somado
// nessa escala, o que basta para o efeito.
import * as THREE from '../vendor/three.module.js';

const NIVEIS = 6;
const QUAD_V = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function criarBrilho(renderer) {
  const alvo = (w, h, samples = 0) => new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, samples, depthBuffer: samples > 0, colorSpace: THREE.SRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  let cenaRT = null;
  const niveis = [];
  const tam = new THREE.Vector2();

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const cenaQuad = new THREE.Scene();
  cenaQuad.add(quad);

  // excesso acima do limiar (joelho suave), já com uma média de 4 amostras para não piscar em pontos isolados
  const extrair = new THREE.ShaderMaterial({
    vertexShader: QUAD_V, depthTest: false, depthWrite: false,
    uniforms: { fonte: { value: null }, texel: { value: new THREE.Vector2() }, limiar: { value: 1.0 } },
    fragmentShader: /* glsl */ `
      uniform sampler2D fonte; uniform vec2 texel; uniform float limiar;
      varying vec2 vUv;
      vec3 excesso(vec3 c) { float m = max(c.r, max(c.g, c.b)); float k = clamp(m - limiar * 0.85, 0.0, limiar * 0.3); k = k * k / (limiar * 1.2 + 1e-4); return c * max(k, m - limiar) / max(m, 1e-4); }
      void main() {
        vec3 c = excesso(texture2D(fonte, vUv + texel * vec2(-1.0, -1.0)).rgb) + excesso(texture2D(fonte, vUv + texel * vec2(1.0, -1.0)).rgb)
               + excesso(texture2D(fonte, vUv + texel * vec2(-1.0, 1.0)).rgb) + excesso(texture2D(fonte, vUv + texel * vec2(1.0, 1.0)).rgb);
        gl_FragColor = vec4(min(c * 0.25, vec3(30.0)), 1.0);
      }`,
  });
  // redução: 4 amostras bilineares (16 pixels) por pixel
  const reduzir = new THREE.ShaderMaterial({
    vertexShader: QUAD_V, depthTest: false, depthWrite: false,
    uniforms: { fonte: { value: null }, texel: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */ `
      uniform sampler2D fonte; uniform vec2 texel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(fonte, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(fonte, vUv + texel * vec2(1.0, -1.0)).rgb
               + texture2D(fonte, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(fonte, vUv + texel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c * 0.25, 1.0);
      }`,
  });
  // ampliação com filtro de tenda (9 amostras), somada ao nível de cima
  const ampliar = new THREE.ShaderMaterial({
    vertexShader: QUAD_V, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    uniforms: { fonte: { value: null }, texel: { value: new THREE.Vector2() } },
    fragmentShader: /* glsl */ `
      uniform sampler2D fonte; uniform vec2 texel; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(fonte, vUv).rgb * 4.0;
        c += (texture2D(fonte, vUv + vec2(texel.x, 0.0)).rgb + texture2D(fonte, vUv - vec2(texel.x, 0.0)).rgb
            + texture2D(fonte, vUv + vec2(0.0, texel.y)).rgb + texture2D(fonte, vUv - vec2(0.0, texel.y)).rgb) * 2.0;
        c += texture2D(fonte, vUv + texel).rgb + texture2D(fonte, vUv - texel).rgb
           + texture2D(fonte, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(fonte, vUv + vec2(-texel.x, texel.y)).rgb;
        gl_FragColor = vec4(c / 16.0, 1.0);
      }`,
  });
  // tela: a cena mais o halo
  const juntar = new THREE.ShaderMaterial({
    vertexShader: QUAD_V, depthTest: false, depthWrite: false,
    uniforms: { cena: { value: null }, halo: { value: null }, forca: { value: 0.5 } },
    fragmentShader: /* glsl */ `
      uniform sampler2D cena, halo; uniform float forca; varying vec2 vUv;
      void main() { gl_FragColor = vec4(texture2D(cena, vUv).rgb + texture2D(halo, vUv).rgb * forca, 1.0); }`,
  });

  function preparar() {
    renderer.getDrawingBufferSize(tam);
    const w = Math.max(1, tam.x), h = Math.max(1, tam.y);
    if (cenaRT && cenaRT.width === w && cenaRT.height === h) return;
    cenaRT?.dispose();
    for (const n of niveis) n.dispose();
    niveis.length = 0;
    cenaRT = alvo(w, h, 4);
    // o Three só codifica a saída em sRGB (como na tela) nos alvos de óculos; sem isso, gravaria luz linear e os materiais
    // que já escrevem a cor da tela sairiam com outra codificação
    cenaRT.isXRRenderTarget = true;
    for (let i = 0, a = w, b = h; i < NIVEIS; i++) { a = Math.max(1, a >> 1); b = Math.max(1, b >> 1); niveis.push(alvo(a, b)); }
  }
  const passar = (mat, destino) => { quad.material = mat; renderer.setRenderTarget(destino); renderer.render(cenaQuad, cam); };

  return {
    // desenha a cena com o halo; forca 0 ou nos óculos, direto na tela
    desenhar(cena, camera, forca = 0.5, limiar = 1) {
      if (!(forca > 0) || renderer.xr.isPresenting) { renderer.setRenderTarget(null); renderer.render(cena, camera); return; }
      preparar();
      renderer.setRenderTarget(cenaRT);
      renderer.render(cena, camera);
      extrair.uniforms.fonte.value = cenaRT.texture;
      extrair.uniforms.limiar.value = limiar;
      extrair.uniforms.texel.value.set(0.5 / cenaRT.width, 0.5 / cenaRT.height);
      passar(extrair, niveis[0]);
      for (let i = 1; i < NIVEIS; i++) {
        reduzir.uniforms.fonte.value = niveis[i - 1].texture;
        reduzir.uniforms.texel.value.set(0.5 / niveis[i - 1].width, 0.5 / niveis[i - 1].height);
        passar(reduzir, niveis[i]);
      }
      const autoLimpar = renderer.autoClear;
      renderer.autoClear = false;
      for (let i = NIVEIS - 1; i > 0; i--) {
        ampliar.uniforms.fonte.value = niveis[i].texture;
        ampliar.uniforms.texel.value.set(1 / niveis[i].width, 1 / niveis[i].height);
        passar(ampliar, niveis[i - 1]);
      }
      renderer.autoClear = autoLimpar;
      juntar.uniforms.cena.value = cenaRT.texture;
      juntar.uniforms.halo.value = niveis[0].texture;
      juntar.uniforms.forca.value = forca;
      passar(juntar, null);
    },
    liberar() { cenaRT?.dispose(); cenaRT = null; for (const n of niveis) n.dispose(); niveis.length = 0; },
  };
}
