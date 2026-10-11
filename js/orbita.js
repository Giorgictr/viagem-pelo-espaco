// Órbita de uma lua em torno do planeta entre dois pontos tabelados do JPL: integração numérica (RK4)
// com a gravidade do planeta e o efeito do seu achatamento (termo J2), que faz as órbitas internas
// precessarem rápido (Mimas, Encélado, Io…). Vetores na eclíptica J2000, km e km/s.
export function integrar(r0, v0, dt, mu, j2, req, polo, out) {
  const n = Math.max(1, Math.ceil(Math.abs(dt) / 1200)), h = dt / n;
  let x = r0[0], y = r0[1], z = r0[2], vx = v0[0], vy = v0[1], vz = v0[2];
  const k = 1.5 * j2 * mu * req * req;
  const acel = (px, py, pz, a) => {
    const r2 = px * px + py * py + pz * pz, r = Math.sqrt(r2), r3 = r2 * r;
    const s = (px * polo[0] + py * polo[1] + pz * polo[2]) / r; // seno da latitude em relação ao equador do planeta
    const f = -mu / r3, g = k / (r2 * r2 * r);
    const c1 = g * (5 * s * s - 1), c2 = -2 * g * s * r;
    a[0] = f * px + c1 * px + c2 * polo[0];
    a[1] = f * py + c1 * py + c2 * polo[1];
    a[2] = f * pz + c1 * pz + c2 * polo[2];
  };
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    acel(x, y, z, a1);
    const x2 = x + 0.5 * h * vx, y2 = y + 0.5 * h * vy, z2 = z + 0.5 * h * vz, vx2 = vx + 0.5 * h * a1[0], vy2 = vy + 0.5 * h * a1[1], vz2 = vz + 0.5 * h * a1[2];
    acel(x2, y2, z2, a2);
    const x3 = x + 0.5 * h * vx2, y3 = y + 0.5 * h * vy2, z3 = z + 0.5 * h * vz2, vx3 = vx + 0.5 * h * a2[0], vy3 = vy + 0.5 * h * a2[1], vz3 = vz + 0.5 * h * a2[2];
    acel(x3, y3, z3, a3);
    const x4 = x + h * vx3, y4 = y + h * vy3, z4 = z + h * vz3, vx4 = vx + h * a3[0], vy4 = vy + h * a3[1], vz4 = vz + h * a3[2];
    acel(x4, y4, z4, a4);
    x += (h / 6) * (vx + 2 * vx2 + 2 * vx3 + vx4);
    y += (h / 6) * (vy + 2 * vy2 + 2 * vy3 + vy4);
    z += (h / 6) * (vz + 2 * vz2 + 2 * vz3 + vz4);
    vx += (h / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
    vy += (h / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
    vz += (h / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

// gravidade, J2, raio equatorial e polo (RA, Dec da IAU) de cada planeta com luas
export const PLANETAS = {
  marte: { mu: 42828.37, j2: 0.0019605, req: 3396.2, polo: [317.269, 54.432] },
  jupiter: { mu: 1.26686534e8, j2: 0.014736, req: 71492, polo: [268.057, 64.495] },
  saturno: { mu: 3.7931187e7, j2: 0.016298, req: 60268, polo: [40.589, 83.537] },
  urano: { mu: 5.793939e6, j2: 0.003343, req: 25559, polo: [257.311, -15.175] },
  netuno: { mu: 6.836529e6, j2: 0.003411, req: 24764, polo: [299.36, 43.46] },
  plutao: { mu: 975.5, j2: 0, req: 1188, polo: [132.993, -6.163] },
};
// polo (RA, Dec) → vetor unitário na eclíptica J2000
export function poloEcliptica([ra, dec]) {
  const g = Math.PI / 180, e = 23.4392911 * g;
  const x = Math.cos(dec * g) * Math.cos(ra * g), y = Math.cos(dec * g) * Math.sin(ra * g), z = Math.sin(dec * g);
  return [x, y * Math.cos(e) + z * Math.sin(e), -y * Math.sin(e) + z * Math.cos(e)];
}
