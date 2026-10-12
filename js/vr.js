// Óculos de realidade virtual (WebXR, ex.: navegador do Meta Quest) — protótipo.
// A câmera continua na origem: tudo é desenhado relativo a ela. Ela fica dentro de um "suporte" (rig) que gira
// com estado.q (o corpo da nave) e tem escala 1/1000 — a cena é em km e os óculos medem a cabeça em metros,
// então mexer a cabeça 1 m desloca a vista 1 m, não 1 km.
import * as THREE from '../vendor/three.module.js';
import { VRButton } from '../vendor/VRButton.js';
import { t } from './idioma.js';

const TEXTOS = { 'ENTER VR': t('Entrar em VR'), 'EXIT VR': t('Sair da VR'), 'VR NOT SUPPORTED': t('VR não disponível'), 'VR NOT ALLOWED': t('VR não permitida') };
const ZONA = 0.15; // zona morta dos joysticks
const GIRO = Math.PI / 6; // giro em saltos de 30°

// g: ganchos do núcleo (main.js) — texto do painel, escolha por direção, ações dos botões
export function criarVR(renderer, cena, camera, g) {
  const rig = new THREE.Group();
  cena.add(rig);
  rig.add(camera);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local'); // origem onde a cabeça está ao entrar (sem chão: estamos no espaço)

  const vr = { ativo: false, rig };
  const qOlhar = new THREE.Quaternion(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
  let nearAntes = 0, farAntes = 0;

  // botão "Entrar em VR": só aparece se o navegador tem óculos (no computador comum nada muda)
  navigator.xr?.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    const b = VRButton.createButton(renderer);
    b.id = 'btVR';
    const traduzir = () => { const t = TEXTOS[b.textContent]; if (t) b.textContent = t; };
    new MutationObserver(traduzir).observe(b, { childList: true, characterData: true, subtree: true });
    traduzir();
    document.body.append(b);
  }).catch(() => {});

  renderer.xr.addEventListener('sessionstart', () => {
    vr.ativo = true;
    rig.scale.setScalar(0.001);
    // perto/longe em metros (o espaço da vista agora é o do suporte, ×1000)
    nearAntes = camera.near; farAntes = camera.far;
    camera.near = nearAntes * 1000; camera.far = farAntes * 1000;
    g.aoEntrar();
  });
  renderer.xr.addEventListener('sessionend', () => {
    vr.ativo = false;
    rig.scale.setScalar(1);
    rig.quaternion.identity();
    camera.position.set(0, 0, 0);
    camera.near = nearAntes; camera.far = farAntes;
    camera.updateProjectionMatrix();
    g.aoSair();
  });

  // ---------------- controles ----------------
  const maos = {}; // 'left' / 'right' → { obj, fonte, antes: [] }
  const geoLaser = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  for (let i = 0; i < 2; i++) {
    const obj = renderer.xr.getController(i);
    const laser = new THREE.Line(geoLaser, new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.6, depthTest: false }));
    laser.scale.z = 40; // 40 m
    laser.renderOrder = 997;
    laser.visible = false;
    obj.add(laser);
    obj.addEventListener('connected', (e) => {
      const m = e.data.handedness === 'left' ? 'left' : 'right';
      maos[m] = { obj, fonte: e.data, antes: [], laser };
      laser.visible = m === 'right';
      if (m === 'left') obj.add(painel);
    });
    obj.addEventListener('disconnected', () => { for (const k in maos) if (maos[k].obj === obj) { if (k === 'left') obj.remove(painel); delete maos[k]; } });
    rig.add(obj);
  }
  const apertou = (m, i) => {
    const gp = maos[m]?.fonte.gamepad;
    const agora = !!gp?.buttons[i]?.pressed, antes = maos[m].antes[i];
    maos[m].antes[i] = agora;
    return agora && !antes;
  };
  const valor = (m, i) => maos[m]?.fonte.gamepad?.buttons[i]?.value ?? 0;
  const eixo = (m, i) => { const v = maos[m]?.fonte.gamepad?.axes[i] ?? 0; return Math.abs(v) < ZONA ? 0 : v; };
  let giroArmado = true;

  // Lê os controles: devolve o movimento pedido (frente/lado) e gira o corpo em saltos de 30°.
  // Esquerda: joystick move (na direção do olhar), gatilho acelera, aperto freia, X para, Y troca o efeito.
  // Direita: joystick vira 30°, gatilho escolhe o alvo apontado, A embarca/desembarca, B vai até o alvo.
  vr.entrada = (dt, q) => {
    const mov = { frente: 0, lado: 0 };
    if (!vr.ativo) return mov;
    mov.lado = eixo('left', 2);
    mov.frente = -eixo('left', 3);
    const gx = eixo('right', 2);
    if (giroArmado && Math.abs(gx) > 0.7) { q.multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), -Math.sign(gx) * GIRO)); giroArmado = false; }
    else if (Math.abs(gx) < 0.3) giroArmado = true;
    const acel = valor('left', 0), freio = valor('left', 1);
    if (acel > 0.05 || freio > 0.05) g.multiplicarV(2 ** ((acel - freio) * 2 * dt)); // segurando tudo: ×4 por segundo
    if (maos.right) {
      if (apertou('right', 0)) {
        maos.right.obj.getWorldQuaternion(_q);
        g.escolherNaDirecao(_v.set(0, 0, -1).applyQuaternion(_q));
      }
      if (apertou('right', 4)) g.embarcarOuDesembarcar();
      if (apertou('right', 5)) g.irAoAlvo();
    }
    if (maos.left) {
      if (apertou('left', 4)) g.parar();
      if (apertou('left', 5)) g.trocarEfeito();
    }
    return mov;
  };

  // direção do olhar no mundo (cabeça × corpo)
  vr.qOlhar = () => camera.getWorldQuaternion(qOlhar);

  // pixels por radiano de cada olho (para o tamanho dos pontos)
  vr.pxPorRad = () => {
    const c = renderer.xr.getCamera().cameras[0];
    return c && c.viewport.w ? (c.viewport.w / 2) * c.projectionMatrix.elements[5] : 900;
  };

  // ---------------- painel na mão esquerda ----------------
  const tela = document.createElement('canvas');
  tela.width = 512; tela.height = 300;
  const ctx = tela.getContext('2d');
  const tex = new THREE.CanvasTexture(tela);
  tex.colorSpace = THREE.SRGBColorSpace;
  const painel = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.117), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  painel.position.set(0, 0.07, -0.06);
  painel.rotation.x = -0.7;
  painel.renderOrder = 999;

  // ---------------- nome do alvo (os rótulos HTML não aparecem nos óculos) ----------------
  const telaN = document.createElement('canvas');
  telaN.width = 512; telaN.height = 96;
  const ctxN = telaN.getContext('2d');
  const texN = new THREE.CanvasTexture(telaN);
  texN.colorSpace = THREE.SRGBColorSpace;
  const nome = new THREE.Sprite(new THREE.SpriteMaterial({ map: texN, depthTest: false, depthWrite: false, toneMapped: false }));
  nome.scale.set(1.2, 0.225, 1); // a 4 m
  nome.renderOrder = 998;
  nome.visible = false;
  rig.add(nome);
  let nomeAtual = '';

  let quadro = 0;
  vr.desenhar = () => {
    if (!vr.ativo) return;
    // nome do alvo, 4 m à frente na direção dele, um pouco abaixo
    const dir = g.direcaoAlvo(_v);
    nome.visible = !!dir;
    if (dir) {
      const n = g.nomeAlvo();
      if (n !== nomeAtual) {
        nomeAtual = n;
        ctxN.clearRect(0, 0, 512, 96);
        ctxN.font = '600 40px system-ui, sans-serif';
        ctxN.textAlign = 'center';
        ctxN.lineWidth = 8; ctxN.strokeStyle = 'rgba(0,0,0,.75)'; ctxN.fillStyle = '#ffe9a8';
        ctxN.strokeText(n, 256, 62, 500); ctxN.fillText(n, 256, 62, 500);
        texN.needsUpdate = true;
      }
      dir.applyQuaternion(_q.copy(rig.quaternion).invert()).multiplyScalar(4);
      nome.position.copy(dir).addScaledVector(_v.set(0, 1, 0), -0.28);
    }
    if (quadro++ % 10) return;
    const linhas = g.textoPainel();
    ctx.clearRect(0, 0, 512, 300);
    ctx.fillStyle = 'rgba(8,14,28,.82)';
    ctx.beginPath(); ctx.roundRect(0, 0, 512, 300, 22); ctx.fill();
    ctx.textAlign = 'left';
    linhas.forEach((t, i) => {
      ctx.font = i === 0 ? '600 38px system-ui, sans-serif' : i < 3 ? '28px system-ui, sans-serif' : '22px system-ui, sans-serif';
      ctx.fillStyle = i < 3 ? '#e8eefc' : '#9fb3d6';
      ctx.fillText(t, 22, [50, 98, 140, 188, 222, 256, 288][i] ?? 290, 470);
    });
    tex.needsUpdate = true;
  };

  return vr;
}
