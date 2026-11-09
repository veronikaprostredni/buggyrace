/* =====================================================================
   IRON MAN OFFROAD RACING — 3D VYKRESLOVÁNÍ (render3d.js, ES modul)
   Kreslí stav hry ve 3D (three.js): terén s výškovým profilem, plastové
   mantinely, kameny, stromy a tráva se stíny, buginy jako 3D modely.
   Simulace (sim.js) ani herní logika (main.js) se tím nemění: main.js každý
   snímek předá stav a tento modul ho jen vykreslí. Bez WebGL zůstane 2D.
   ===================================================================== */
import * as THREE from "./vendor/three.module.min.js";

const IMR = window.IMR;
const W = IMR.WORLD_W, H = IMR.WORLD_H;
const WALL_H = 16;                       // výška mantinelu (stejně jako ve 2D)
const ARENA = { x0: -140, x1: W + 140, y0: -140, y1: H + 140 };   // malovaná oblast kolem trati

/* ---------------- Motivy tratí ---------------- */
const THEMES = {
  dusty: {
    grass: ["#4c7531", "#6a8c3b", "#3b6229"], dry: "#9a8a4f", dirt: ["#8b6a43", "#a68459"], mud: "#3d2a17",
    trees: 70, conifer: 0.4, rocks: 50, tufts: 2600, tuftColor: "#5f8a34", bushes: 40,
    sun: 0xfff1d8, sunI: 3.3, hemi: [0xdbe7ff, 0x4d3c28, 0.55], fog: 0xbfcfd2, exposure: 1.0,
  },
  canyon: {
    grass: ["#c49b66", "#b6875a", "#d5ae7b"], dry: "#c9a46c", dirt: ["#9c7349", "#b88c5d"], mud: "#4a321c",
    trees: 0, cactus: 26, rocks: 140, tufts: 900, tuftColor: "#b39a52", bushes: 18,
    sun: 0xffe7c4, sunI: 3.4, hemi: [0xf3e2c8, 0x7a5434, 0.55], fog: 0xe3cfae, exposure: 1.0,
  },
  oval: {
    grass: ["#4f8a35", "#6c9c43", "#3e7a2b"], dry: "#8d9a4e", dirt: ["#94734a", "#ae8c5f"], mud: "#3d2a17",
    trees: 120, conifer: 0.25, rocks: 35, tufts: 3200, tuftColor: "#5c9437", bushes: 60,
    sun: 0xfff3dc, sunI: 3.3, hemi: [0xd9e8ff, 0x4b3d29, 0.58], fog: 0xbfd2d6, exposure: 1.0,
  },
  stadium: {
    grass: ["#2f4a2b", "#3b5a33", "#263f24"], dry: "#556042", dirt: ["#6d5a42", "#857053"], mud: "#2c2014",
    trees: 40, conifer: 0.8, rocks: 30, tufts: 1800, tuftColor: "#3d6233", bushes: 30, night: true,
    sun: 0xb8c8ff, sunI: 1.5, hemi: [0x6a7fb0, 0x1d1a16, 0.55], fog: 0x1a2232, exposure: 1.15,
  },
};
function themeFor(track) { return THEMES[track.def.id] || THEMES.dusty; }

/* ---------------- Šum a náhoda (deterministické) ---------------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(x, y, oct, seed) {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f, seed + o * 17); tot += amp; amp *= 0.5; f *= 2.03; }
  return v / tot;
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return a + (b - a) * t; }
function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

/* ---------------- Stav rendereru ---------------- */
let renderer = null, scene, camera, sun, hemi, fogColor;
let cssW = 0, cssH = 0, hudCss = 0;
const built = new Map();       // id trati -> { group, heightAt, theme }
let current = null;            // aktuálně zobrazená trať
const carModels = new Map();   // id auta -> model
const pickupModels = new Map();
let particleSys = null;
const colorCache = new Map();

function init(canvas) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x0a120c, 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 20, 6000);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  sun = new THREE.DirectionalLight(0xffffff, 3);
  // slunce zleva zezadu: stíny padají doprava a ke kameře, takže jsou dobře vidět
  sun.position.set(W / 2 - 420, 950, H / 2 - 480);
  sun.target.position.set(W / 2, 0, H / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -760; sc.right = 760; sc.top = 640; sc.bottom = -640; sc.near = 200; sc.far = 2600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.8;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);
  fogColor = new THREE.Color(0xbfcfd2);
  scene.fog = new THREE.Fog(fogColor, 1600, 3600);
  scene.background = fogColor;

  particleSys = makeParticles();
  scene.add(particleSys.points);
  api.ok = true;
  return true;
}

/* =====================================================================
   TERÉN: výšková síť + malovaná textura (barva, reliéf, lesk)
   ===================================================================== */
function trackFrame(track) {
  const C = track.center, n = C.length, nrm = [], g = [];
  for (let i = 0; i < n; i++) {
    const a = C[(i - 1 + n) % n], b = C[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    nrm.push({ x: -dy / l, y: dx / l });
    g.push(IMR.groundAt(track, track.sAt[i]));
  }
  return { nrm, g };
}

// Kopečky v trávě mimo trať (náhodné, ale pro trať vždy stejné).
function makeMounds(track, seed) {
  const r = rng(seed), out = [], keep = track.halfW + IMR.WALL_GAP + 40;
  for (let i = 0; i < 26; i++) {
    const x = ARENA.x0 + r() * (ARENA.x1 - ARENA.x0), y = ARENA.y0 + r() * (ARENA.y1 - ARENA.y0);
    const rad = 35 + r() * 70;
    if (IMR.nearestOnCenter(track, x, y).d < keep + rad * 0.6) continue;
    out.push({ x, y, rad, h: 5 + r() * 14 });
  }
  return out;
}

function buildTerrain(track, th, mounds, fr) {
  const hw = track.halfW, edge = hw + IMR.WALL_GAP;
  // výška terénu v bodě (svět x,y) – trať s kopci, mírný val u mantinelu, zvlněná tráva
  function heightAt(x, y) {
    const nn = IMR.nearestOnCenter(track, x, y);
    const g = IMR.groundAt(track, nn.s);
    if (nn.d <= edge) return g + 2.4 * smooth(hw - 14, edge, nn.d);
    let o = 7 * (fbm(x * 0.006, y * 0.006, 3, 11) - 0.45);
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < m.rad) o += m.h * 0.5 * (1 + Math.cos(Math.PI * d / m.rad));
    }
    const t = smooth(edge, edge + 70, nn.d);
    return mix(g + 2.4, o, t);
  }

  const SX = ARENA.x1 - ARENA.x0, SY = ARENA.y1 - ARENA.y0, STEP = 5;
  const segX = Math.round(SX / STEP), segY = Math.round(SY / STEP);
  const geo = new THREE.PlaneGeometry(SX, SY, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (ARENA.x0 + SX / 2), z = pos.getZ(i) + (ARENA.y0 + SY / 2);
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();

  const tex = paintTerrain(track, th, fr);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.color, bumpMap: tex.detail, bumpScale: 1.6, roughnessMap: tex.detail, roughness: 1, metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, heightAt };
}

// Malovaná textura terénu: do pomocných pláten se nakreslí masky (trať, koleje,
// bláto, stín u mantinelu) a pak se pixel po pixelu smíchá barva s šumem.
function paintTerrain(track, th, fr) {
  const S = 1.65;                                   // pixelů na jednotku světa
  const TW = Math.round((ARENA.x1 - ARENA.x0) * S), TH = Math.round((ARENA.y1 - ARENA.y0) * S);
  const mk = () => { const c = document.createElement("canvas"); c.width = TW; c.height = TH; const g = c.getContext("2d"); g.setTransform(S, 0, 0, S, -ARENA.x0 * S, -ARENA.y0 * S); return [c, g]; };
  const C = track.center, n = C.length, hw = track.halfW;
  const path = (g, d) => {
    g.beginPath();
    for (let i = 0; i <= n; i++) { const p = C[i % n], q = fr.nrm[i % n]; const x = p.x + q.x * d, y = p.y + q.y * d; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath();
  };
  const strokeMask = (g, d, w, blur, alpha) => {
    g.save(); g.filter = blur ? `blur(${blur * S}px)` : "none"; g.globalAlpha = alpha == null ? 1 : alpha;
    g.strokeStyle = "#fff"; g.lineWidth = w; g.lineJoin = "round"; g.lineCap = "round"; path(g, d); g.stroke(); g.restore();
  };
  // R = trať, G = měkký okraj (vyšlapaná tráva), B = vyjeté koleje
  const [mc, mg] = mk();
  mg.fillStyle = "#000"; mg.fillRect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0);
  mg.globalCompositeOperation = "lighter";
  const lay = (color, fn) => { const [c, g] = mk(); fn(g); mg.save(); mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = "lighter";
    mg.globalAlpha = 1; mg.filter = "none"; const tmp = c; const tg = tmp.getContext("2d"); tg.globalCompositeOperation = "source-in"; tg.fillStyle = color; tg.fillRect(0, 0, TW, TH); mg.drawImage(tmp, 0, 0); mg.restore(); };
  lay("#ff0000", (g) => strokeMask(g, 0, track.width + 10, 1.2));
  lay("#00ff00", (g) => strokeMask(g, 0, track.width + 46, 9));
  lay("#0000ff", (g) => { for (const d of [-0.42, -0.2, 0.2, 0.42]) strokeMask(g, d * hw, 7, 2.5, 0.8); strokeMask(g, 0, 10, 4, 0.35); });
  const mask = mg.getImageData(0, 0, TW, TH).data;

  // A2: stín u paty mantinelů (R), bláto (G), voda (B)
  const [ac, ag] = mk();
  ag.fillStyle = "#000"; ag.fillRect(ARENA.x0, ARENA.y0, ARENA.x1 - ARENA.x0, ARENA.y1 - ARENA.y0);
  ag.globalCompositeOperation = "lighter";
  const lay2 = (color, fn) => { const [c, g] = mk(); fn(g); const tg = c.getContext("2d"); tg.globalCompositeOperation = "source-in"; tg.fillStyle = color; tg.fillRect(0, 0, TW, TH);
    ag.save(); ag.setTransform(1, 0, 0, 1, 0, 0); ag.drawImage(c, 0, 0); ag.restore(); };
  lay2("#ff0000", (g) => { strokeMask(g, hw + 4, 9, 4, 0.9); strokeMask(g, -(hw + 4), 9, 4, 0.9); });
  lay2("#00ff00", (g) => { for (const z of track.terrain) if (z.type === "mud") { g.save(); g.filter = `blur(${5 * S}px)`; g.fillStyle = "#fff"; g.beginPath(); g.ellipse(z.x, z.y, z.r * 1.05, z.r * 0.9, 0.4, 0, Math.PI * 2); g.fill(); g.restore(); } });
  lay2("#0000ff", (g) => { for (const z of track.terrain) if (z.type === "water") { g.save(); g.filter = `blur(${4 * S}px)`; g.fillStyle = "#fff"; g.beginPath(); g.arc(z.x, z.y, z.r * 1.08, 0, Math.PI * 2); g.fill(); g.restore(); } });
  const aux = ag.getImageData(0, 0, TW, TH).data;

  const colC = document.createElement("canvas"); colC.width = TW; colC.height = TH;
  const detC = document.createElement("canvas"); detC.width = TW; detC.height = TH;
  const colI = colC.getContext("2d").createImageData(TW, TH), detI = detC.getContext("2d").createImageData(TW, TH);
  const cd = colI.data, dd = detI.data;
  const G = th.grass.map(hexRgb), DRY = hexRgb(th.dry), D = th.dirt.map(hexRgb), MUD = hexRgb(th.mud);
  for (let py = 0; py < TH; py++) {
    const wy = ARENA.y0 + py / S;
    for (let px = 0; px < TW; px++) {
      const wx = ARENA.x0 + px / S, k = (py * TW + px) * 4;
      const tr = mask[k] / 255, soft = mask[k + 1] / 255, rut = mask[k + 2] / 255;
      const ao = aux[k] / 255, mud = aux[k + 1] / 255, water = aux[k + 2] / 255;
      const n1 = fbm(wx * 0.02, wy * 0.02, 3, 3), n2 = vnoise(wx * 0.35, wy * 0.35, 5), n3 = fbm(wx * 0.08, wy * 0.08, 2, 9);
      // tráva: tři odstíny + suchá místa + jemná zrnitost stébel
      const gm = n1 < 0.5 ? n1 * 2 : (n1 - 0.5) * 2;
      let gr = n1 < 0.5 ? mix(G[2][0], G[0][0], gm) : mix(G[0][0], G[1][0], gm);
      let gg = n1 < 0.5 ? mix(G[2][1], G[0][1], gm) : mix(G[0][1], G[1][1], gm);
      let gb = n1 < 0.5 ? mix(G[2][2], G[0][2], gm) : mix(G[0][2], G[1][2], gm);
      const dry = smooth(0.62, 0.8, n3) * 0.55;
      gr = mix(gr, DRY[0], dry); gg = mix(gg, DRY[1], dry); gb = mix(gb, DRY[2], dry);
      const blade = 0.82 + 0.36 * n2;
      gr *= blade; gg *= blade; gb *= blade;
      // hlína: dva odstíny, hrudky, kamínky, tmavší koleje, světlejší ujetá stopa
      const dm = fbm(wx * 0.05, wy * 0.05, 3, 21);
      let dr = mix(D[0][0], D[1][0], dm), dg = mix(D[0][1], D[1][1], dm), db = mix(D[0][2], D[1][2], dm);
      const grain = 0.8 + 0.4 * vnoise(wx * 0.9, wy * 0.9, 7);
      const peb = hash2(px >> 1, py >> 1, 99), pebble = peb > 0.988 ? 1 : 0, dark = peb < 0.01 ? 1 : 0;
      let f = grain * (1 - 0.28 * rut);
      dr *= f; dg *= f; db *= f;
      if (pebble) { dr = mix(dr, 205, 0.6); dg = mix(dg, 190, 0.6); db = mix(db, 165, 0.6); }
      if (dark) { dr *= 0.6; dg *= 0.6; db *= 0.6; }
      // míchání: trať / vyšlapaný okraj / tráva
      const t = Math.max(tr, soft * 0.55 * (0.6 + 0.8 * n2));
      let r = mix(gr, dr, t), gc = mix(gg, dg, t), b = mix(gb, db, t);
      // bláto (tmavé, mokré) a dno louže
      if (mud > 0) { const m = mud * (0.85 + 0.3 * n2); r = mix(r, MUD[0] * (0.8 + 0.3 * n3), m); gc = mix(gc, MUD[1] * (0.8 + 0.3 * n3), m); b = mix(b, MUD[2] * (0.8 + 0.3 * n3), m); }
      if (water > 0) { r = mix(r, MUD[0] * 0.9, water); gc = mix(gc, MUD[1] * 0.95, water); b = mix(b, MUD[2], water); }
      // stín u paty mantinelu
      const sh = 1 - 0.38 * ao;
      cd[k] = r * sh; cd[k + 1] = gc * sh; cd[k + 2] = b * sh; cd[k + 3] = 255;
      // detail: R = reliéf (bump), G = drsnost
      const wet = Math.max(mud, water);
      let bump = t > 0.5 ? 0.45 + 0.3 * vnoise(wx * 0.9, wy * 0.9, 7) - 0.25 * rut + 0.35 * pebble : 0.45 + 0.35 * n2;
      bump = mix(bump, 0.45, wet);                       // mokrá plocha je hladká (žádné třpytky)
      const rough = mix(mix(0.9, 0.96, t), 0.5, wet);
      dd[k] = Math.max(0, Math.min(255, bump * 255)); dd[k + 1] = rough * 255; dd[k + 2] = 0; dd[k + 3] = 255;
    }
  }
  colC.getContext("2d").putImageData(colI, 0, 0);
  detC.getContext("2d").putImageData(detI, 0, 0);
  const color = new THREE.CanvasTexture(colC);
  color.colorSpace = THREE.SRGBColorSpace;
  const detail = new THREE.CanvasTexture(detC);
  for (const t2 of [color, detail]) { t2.anisotropy = renderer.capabilities.getMaxAnisotropy(); t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping; }
  return { color, detail };
}

// Vzdálená krajina za arénou (opakovaná textura trávy, mizí v oparu).
function buildFarGround(th) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"), img = g.createImageData(256, 256), d = img.data;
  const G = th.grass.map(hexRgb);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const n = vnoise((x % 256) * 0.06, (y % 256) * 0.06, 4), k = (y * 256 + x) * 4, f = 0.8 + 0.35 * vnoise(x * 0.5, y * 0.5, 6);
    d[k] = mix(G[2][0], G[1][0], n) * f; d[k + 1] = mix(G[2][1], G[1][1], n) * f; d[k + 2] = mix(G[2][2], G[1][2], n) * f; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.rotation.x = -Math.PI / 2; m.position.set(W / 2, -6, H / 2); m.receiveShadow = true;
  return m;
}

/* =====================================================================
   MANTINELY: plastové bloky (profil svodidla), špína a odřeniny
   ===================================================================== */
function barrierTextures() {
  const variants = [];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 128;
    const g = c.getContext("2d"), r = rng(77 + v * 31);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 128);
    // plastová zrnitost
    const img = g.getImageData(0, 0, 256, 128), d = img.data;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 256; x++) {
      const k = (y * 256 + x) * 4, n = 0.9 + 0.1 * vnoise(x * 0.4, y * 0.4, 50 + v);
      // špína odspodu nahoru (prach a bláto od kol)
      const grime = smooth(0.35, 1, y / 128) * (0.55 + 0.45 * fbm(x * 0.05, y * 0.08, 3, 60 + v));
      const f = n * (1 - 0.55 * grime);
      d[k] = 255 * f; d[k + 1] = 248 * f * (1 - 0.06 * grime); d[k + 2] = 240 * f * (1 - 0.15 * grime);
    }
    g.putImageData(img, 0, 0);
    // odřeniny: tmavé šmouhy od pneumatik a světlé škrábance
    for (let i = 0; i < 9; i++) {
      const x = r() * 256, y = 40 + r() * 80, len = 20 + r() * 70;
      g.strokeStyle = `rgba(25,20,18,${0.25 + r() * 0.35})`; g.lineWidth = 2 + r() * 6; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + len * 0.5, y - 4 + r() * 8, x + len, y + (r() - 0.5) * 10); g.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const x = r() * 256, y = 10 + r() * 110;
      g.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.35})`; g.lineWidth = 0.6 + r();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + r() * 22, y + (r() - 0.5) * 4); g.stroke();
    }
    for (let i = 0; i < 6; i++) {                   // cákance bláta
      g.fillStyle = `rgba(70,48,25,${0.3 + r() * 0.4})`;
      g.beginPath(); g.ellipse(r() * 256, 80 + r() * 48, 3 + r() * 9, 2 + r() * 5, r() * 3, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    variants.push(t);
  }
  return variants;
}

function barrierGeometry(len) {
  // profil svodidla (šířka × výška), vytažený do délky bloku
  const s = new THREE.Shape();
  const P = [[-4.5, 0], [-4.5, 3.2], [-3, 6.9], [-2.4, 18.2], [-1.75, 20], [1.75, 20], [2.4, 18.2], [3, 6.9], [4.5, 3.2], [4.5, 0]];
  s.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) s.lineTo(P[i][0], P[i][1]); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: true, bevelThickness: 0.9, bevelSize: 0.5, bevelSegments: 2, curveSegments: 2 });
  geo.translate(0, 0, -len / 2);
  geo.rotateY(Math.PI / 2);          // délka bloku podél osy X
  // UV: podél bloku = x, nahoru = y (textura se špínou dole)
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + len / 2) / len, 1 - pos.getY(i) / 20);
  geo.computeVertexNormals();
  return geo;
}

function buildBarriers(track, fr, heightAt) {
  const group = new THREE.Group();
  const C = track.center, n = C.length, off = track.halfW + IMR.WALL_GAP + 4.5;
  const BLOCK = 21, GAP = 1.4;
  const tex = barrierTextures();
  const geo = barrierGeometry(BLOCK - GAP);
  const lists = tex.map(() => []);
  const red = new THREE.Color(0xc23a2e), white = new THREE.Color(0xf1eee6);
  let blockNo = 0;
  for (const sgn of [1, -1]) {
    // polyčára mantinelu
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: C[i].x + fr.nrm[i].x * off * sgn, y: C[i].y + fr.nrm[i].y * off * sgn });
    const cum = [0];
    for (let i = 1; i <= n; i++) { const a = pts[i - 1], b = pts[i % n]; cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
    const L = cum[n];
    const at = (s) => { s = ((s % L) + L) % L; let i = 0; while (cum[i + 1] < s) i++; const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const a = pts[i], b = pts[(i + 1) % n]; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };
    const count = Math.floor(L / BLOCK);
    const step = L / count;
    for (let k = 0; k < count; k++) {
      const p0 = at(k * step + GAP / 2), p1 = at((k + 1) * step - GAP / 2);
      const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
      // na ostré vnitřní zatáčce se křivka přeloží – tam blok nestojí (stejně jako fyzika)
      if (IMR.nearestOnCenter(track, cx, cy).d < off - 3) continue;
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const h0 = heightAt(p0.x, p0.y), h1 = heightAt(p1.x, p1.y);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(p1.y - p0.y, p1.x - p0.x), Math.atan2(h1 - h0, len), "YXZ"));
      m.compose(new THREE.Vector3(cx, (h0 + h1) / 2 - 0.8, cy), q, new THREE.Vector3(len / (BLOCK - GAP), 1, 1));
      lists[blockNo % tex.length].push({ m, c: (blockNo % 2 === 0) ? red : white });
      blockNo++;
    }
  }
  lists.forEach((list, v) => {
    const mat = new THREE.MeshStandardMaterial({ map: tex[v], roughness: 0.55, metalness: 0 });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, i) => { im.setMatrixAt(i, b.m); im.setColorAt(i, b.c); });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  });
  return group;
}

/* =====================================================================
   OKOLÍ: kameny, stromy, keře, kaktusy, trsy trávy
   ===================================================================== */
function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position, r = rng(seed);
  const sx = 0.8 + r() * 0.6, sy = 0.45 + r() * 0.35, sz = 0.7 + r() * 0.6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.78 + 0.45 * fbm(x * 1.7 + seed, y * 1.7, 3, seed) + 0.08 * vnoise(x * 6, z * 6, seed + 1);
    pos.setXYZ(i, x * k * sx, Math.max(-0.25, y * k * sy), z * k * sz);
  }
  geo.computeVertexNormals();
  return geo;
}
function scatter(track, count, minD, seed, region, heightAt, extra) {
  const r = rng(seed), out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 30) {
    const x = region.x0 + r() * (region.x1 - region.x0), y = region.y0 + r() * (region.y1 - region.y0);
    const d = IMR.nearestOnCenter(track, x, y).d;
    if (d < minD) continue;
    if (extra && !extra(x, y, d)) continue;
    out.push({ x, y, h: heightAt(x, y), r: r(), r2: r(), r3: r() });
  }
  return out;
}

function buildNature(track, th, heightAt) {
  const group = new THREE.Group();
  const edge = track.halfW + IMR.WALL_GAP + 10;
  const big = { x0: -320, x1: W + 320, y0: -260, y1: H + 240 };
  // stromy nesmějí stát mezi kamerou a tratí (dole) – tam jen nízké keře
  const notInFront = (x, y) => y < H + 30;

  // kameny (6 tvarů, instancované) – i menší kamínky u mantinelů
  const rockGeos = [0, 1, 2, 3, 4, 5].map((i) => rockGeometry(101 + i * 13));
  const rockMat = new THREE.MeshStandardMaterial({ color: th.night ? 0x6d6a66 : 0x8d877c, roughness: 0.92, flatShading: true });
  const rocks = scatter(track, th.rocks, edge + 12, 5, big, heightAt);
  const pebbles = scatter(track, Math.round(th.rocks * 1.2), edge + 6, 8, ARENA, heightAt, (x, y, d) => d < edge + 60);
  const rockSets = rockGeos.map(() => []);
  rocks.forEach((p, i) => rockSets[i % 6].push({ p, s: 6 + p.r * 16 }));
  pebbles.forEach((p, i) => rockSets[i % 6].push({ p, s: 1.6 + p.r * 3.2 }));
  rockSets.forEach((list, gi) => {
    const im = new THREE.InstancedMesh(rockGeos[gi], rockMat, list.length);
    const col = new THREE.Color();
    list.forEach((o, i) => {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(o.p.x, o.p.h + o.s * 0.15, o.p.y),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(o.p.r2 * 0.4, o.p.r3 * 6.28, 0)), new THREE.Vector3(o.s, o.s, o.s));
      im.setMatrixAt(i, m);
      col.setHSL(0.08 + o.p.r * 0.04, 0.12 + o.p.r2 * 0.1, 0.4 + o.p.r3 * 0.2); im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  });

  // stromy: listnaté (kmen + koruna z několika hrud) a jehličnaté (kužely)
  if (th.trees) {
    const spots = scatter(track, th.trees, edge + 45, 21, big, heightAt, notInFront);
    const trunkGeo = new THREE.CylinderGeometry(1.6, 2.4, 1, 6); trunkGeo.translate(0, 0.5, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    const bp = blobGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i), k = 0.85 + 0.3 * vnoise(x * 3 + 5, z * 3, 2); bp.setXYZ(i, x * k, y * k, z * k); }
    blobGeo.computeVertexNormals();
    const coneGeo = new THREE.ConeGeometry(1, 1, 7); coneGeo.translate(0, 0.5, 0);
    const trunks = [], blobs = [], cones = [];
    for (const p of spots) {
      const hgt = 34 + p.r * 34, conifer = p.r2 < th.conifer;
      trunks.push({ pos: [p.x, p.h - 1, p.y], s: [1, conifer ? hgt * 0.35 : hgt * 0.45, 1] });
      if (conifer) {
        for (let k = 0; k < 3; k++) cones.push({ pos: [p.x, p.h + hgt * (0.22 + k * 0.22), p.y], s: [hgt * (0.3 - k * 0.07), hgt * 0.42, hgt * (0.3 - k * 0.07)], c: p.r3 });
      } else {
        const crown = hgt * 0.32;
        for (let k = 0; k < 4; k++) {
          const a = k * 1.9 + p.r3 * 6, rr = k ? crown * 0.55 : 0;
          blobs.push({ pos: [p.x + Math.cos(a) * rr, p.h + hgt * 0.62 + (k ? -crown * 0.15 : crown * 0.2), p.y + Math.sin(a) * rr], s: [crown * (k ? 0.75 : 1), crown * (k ? 0.65 : 0.85), crown * (k ? 0.75 : 1)], c: p.r3 });
        }
      }
    }
    const put = (geo, mat, list, hue) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length), col = new THREE.Color();
      list.forEach((o, i) => {
        im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(...o.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 2.39, 0)), new THREE.Vector3(...o.s)));
        if (hue) { col.setHSL(hue[0] + (o.c || 0) * hue[1], hue[2], hue[3] + (o.c || 0) * hue[4]); im.setColorAt(i, col); }
      });
      im.castShadow = true; im.receiveShadow = true; group.add(im);
    };
    put(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 0.9 }), trunks);
    put(blobGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), blobs, [0.22, 0.08, 0.45, th.night ? 0.12 : 0.2, 0.1]);
    put(coneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), cones, [0.3, 0.05, 0.4, th.night ? 0.1 : 0.16, 0.07]);
  }
  // kaktusy (kaňon)
  if (th.cactus) {
    const spots = scatter(track, th.cactus, edge + 40, 31, big, heightAt, notInFront);
    const capGeo = new THREE.CapsuleGeometry(1, 1, 4, 8); capGeo.translate(0, 0.5, 0);
    const parts = [];
    // kmen + ramena: krátký vodorovný výběžek a svislá část nahoru (tvar saguaro)
    for (const p of spots) {
      const hgt = 26 + p.r * 24, r = 4.2;
      parts.push({ pos: [p.x, p.h - 1, p.y], s: [r, hgt, r], rz: 0 });
      for (const side of p.r2 > 0.45 ? [1, -1] : [1]) {
        const ay = p.h + hgt * (0.3 + p.r3 * 0.15);
        parts.push({ pos: [p.x, ay, p.y], s: [2.8, 7, 2.8], rz: -side * Math.PI / 2 });
        parts.push({ pos: [p.x + side * 7, ay - 1, p.y], s: [2.8, hgt * 0.38, 2.8], rz: 0 });
      }
    }
    const im = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x6e9b55, roughness: 0.65 }), parts.length);
    parts.forEach((o, i) => im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(...o.pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, o.rz)), new THREE.Vector3(...o.s))));
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
  // nízké keře (smějí i dopředu)
  if (th.bushes) {
    const spots = scatter(track, th.bushes, edge + 22, 41, big, heightAt);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), spots.length);
    const col = new THREE.Color();
    spots.forEach((p, i) => {
      const s = 5 + p.r * 7;
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.h + s * 0.25, p.y), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.r2 * 6, 0)), new THREE.Vector3(s * 1.3, s * 0.75, s)));
      col.setHSL(th.cactus ? 0.15 : 0.25 + p.r3 * 0.05, 0.4, th.night ? 0.12 : 0.22 + p.r3 * 0.08); im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  }
  // trsy trávy: zkřížená stébla (alfa textura), hustěji u okrajů a v trávě
  if (th.tufts) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const g = c.getContext("2d"), r = rng(9);
    g.fillStyle = "#000"; g.fillRect(0, 0, 64, 64);       // maska: černá = průhledné, bílá = stéblo
    for (let i = 0; i < 22; i++) {
      const x = 8 + r() * 48, lean = (r() - 0.5) * 18, hgt = 30 + r() * 32;
      g.strokeStyle = "#fff"; g.lineWidth = 2 + r() * 2;
      g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + lean * 0.3, 64 - hgt * 0.6, x + lean, 64 - hgt); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    const geo = new THREE.BufferGeometry();
    const v = [], uv = [];
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      const cx = Math.cos(a), cz = Math.sin(a);
      // přední i zadní strana zvlášť (jednostranný materiál), aby obě měly normálu vzhůru
      v.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 0, -cz, cx, 1, cz, -cx, 1, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      v.push(cx, 0, cz, -cx, 0, -cz, -cx, 1, -cz, cx, 0, cz, -cx, 1, -cz, cx, 1, cz);
      uv.push(1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    // normály vzhůru: tráva se nasvítí jako zem, ne podle natočení stébel
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(v.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
    const spots = scatter(track, th.tufts, edge + 2, 51, { x0: ARENA.x0 + 10, x1: ARENA.x1 - 10, y0: ARENA.y0 + 10, y1: ARENA.y1 - 10 }, heightAt);
    const mat = new THREE.MeshStandardMaterial({ color: th.tuftColor, alphaMap: t, alphaTest: 0.5, roughness: 0.9 });
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const col = new THREE.Color();
    spots.forEach((p, i) => {
      const s = 4.5 + p.r * 6;
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.h - 0.3, p.y), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.r2 * 6, 0)), new THREE.Vector3(s, s * (0.8 + p.r3 * 0.6), s)));
      col.setScalar(0.8 + p.r3 * 0.4); im.setColorAt(i, col);
    });
    im.receiveShadow = true; group.add(im);
  }
  return group;
}

/* ---------------- Louže vody a startovní čára ---------------- */
function buildDetails(track, heightAt) {
  const group = new THREE.Group();
  for (const z of track.terrain) {
    if (z.type !== "water") continue;
    const geo = new THREE.CircleGeometry(z.r * 0.98, 40);
    const pos = geo.attributes.position;
    for (let i = 1; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), k = 0.88 + 0.16 * vnoise(Math.atan2(y, x) * 2 + 7, 1, 3); pos.setXY(i, x * k, y * k); }
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a6f78, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.82 }));
    m.position.set(z.x, heightAt(z.x, z.y) + 0.7, z.y);
    m.receiveShadow = true;
    group.add(m);
  }
  // šachovnice startu jako obtisk na zemi
  const g0 = track.gates[0], c = document.createElement("canvas"); c.width = 160; c.height = 32;
  const gg = c.getContext("2d");
  for (let i = 0; i < 10; i++) for (let k = 0; k < 2; k++) { gg.fillStyle = (i + k) % 2 ? "#1d1d1d" : "#ecebe6"; gg.fillRect(i * 16, k * 16, 16, 16); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(track.width, track.width / 5, 10, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = -(g0.dirAngle + Math.PI / 2);
  m.position.set(g0.x, heightAt(g0.x, g0.y) + 0.25, g0.y);
  m.receiveShadow = true;
  group.add(m);
  // dva praporky u startu
  const nx = -Math.sin(g0.dirAngle), ny = Math.cos(g0.dirAngle);
  for (const sgn of [1, -1]) {
    const px = g0.x + nx * (track.halfW + IMR.WALL_GAP + 14) * sgn, py = g0.y + ny * (track.halfW + IMR.WALL_GAP + 14) * sgn, h = heightAt(px, py);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 34, 6), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.4 }));
    pole.position.set(px, h + 17, py); pole.castShadow = true; group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(px + 6, h + 30, py); flag.castShadow = true; group.add(flag);
  }
  return group;
}

/* =====================================================================
   BUGINY: retro bugina jako 3D model (vana, rám, řidič, velká zadní kola)
   ===================================================================== */
const sharedCar = {};
function carShared() {
  if (sharedCar.ok) return sharedCar;
  // pneumatika s dezénem (textura na válci)
  const c = document.createElement("canvas"); c.width = 64; c.height = 16;
  const g = c.getContext("2d"); g.fillStyle = "#1b1b1b"; g.fillRect(0, 0, 64, 16);
  g.fillStyle = "#2d2d2d"; for (let i = 0; i < 16; i++) g.fillRect(i * 4, 2, 2, 12);
  const tread = new THREE.CanvasTexture(c); tread.wrapS = THREE.RepeatWrapping; tread.repeat.set(2, 1);
  sharedCar.tire = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.95 });
  sharedCar.rim = new THREE.MeshStandardMaterial({ color: 0xbfc3c6, metalness: 0.8, roughness: 0.3 });
  sharedCar.metal = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.7, roughness: 0.4 });
  sharedCar.chrome = new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 1, roughness: 0.18 });
  sharedCar.seat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.8 });
  sharedCar.visor = new THREE.MeshStandardMaterial({ color: 0x15202a, metalness: 0.4, roughness: 0.1 });
  sharedCar.lamp = new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xfff0b0, emissiveIntensity: 0.6, roughness: 0.2 });
  sharedCar.flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false });
  sharedCar.ok = true;
  return sharedCar;
}

function makeWheel(radius, width, sh) {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18, 1), sh.tire);
  tire.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.3, 12), sh.rim);
  rim.rotation.x = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width + 0.6, 8), sh.chrome);
  hub.rotation.x = Math.PI / 2;
  w.add(tire, rim, hub);
  tire.castShadow = true;
  return w;
}

function buildBuggy(color) {
  const sh = carShared();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const root = new THREE.Group();       // poloha a natočení
  const body = new THREE.Group();       // náklon karoserie (pérování)
  root.add(body);

  // vana karoserie: boční profil retro buginy vytažený do šířky (předek dlouhý a nízký)
  const prof = new THREE.Shape();
  prof.moveTo(-12, 3.2); prof.lineTo(-12.5, 6.5); prof.lineTo(-7, 7.8); prof.lineTo(-2.5, 6.6);
  prof.lineTo(4.5, 6.8); prof.quadraticCurveTo(11.5, 6.4, 14.5, 4.4); prof.lineTo(14.8, 3); prof.quadraticCurveTo(5, 2.4, -12, 3.2);
  const tub = new THREE.ExtrudeGeometry(prof, { depth: 11, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.1, bevelSegments: 3, curveSegments: 6 });
  tub.translate(0, 0, -5.5);
  const tubMesh = new THREE.Mesh(tub, paint);
  tubMesh.castShadow = true; tubMesh.receiveShadow = true;
  body.add(tubMesh);
  // podlaha / podvozek
  const floor = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 10), sh.metal);
  floor.position.set(1, 2.6, 0); floor.castShadow = true; body.add(floor);
  // motor vzadu s výfuky
  const eng = new THREE.Mesh(new THREE.BoxGeometry(6, 4.2, 8), sh.metal);
  eng.position.set(-13, 6, 0); eng.castShadow = true; body.add(eng);
  for (const z of [-2.3, 2.3]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 4.5, 8), sh.chrome);
    pipe.rotation.z = Math.PI / 2 - 0.35; pipe.position.set(-16.4, 7.4, z); body.add(pipe);
  }
  // sedačka, řidič s helmou
  const seat = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 6), sh.seat);
  seat.position.set(-4.8, 9.6, 0); seat.rotation.z = -0.15; body.add(seat);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(2.1, 3, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2f3b4a, roughness: 0.8 }));
  torso.position.set(-2.6, 10.4, 0); torso.rotation.z = -0.25; torso.castShadow = true; body.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(2.3, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.25, clearcoat: 0.8 }));
  helmet.position.set(-2.2, 14.6, 0); helmet.castShadow = true; body.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(2.35, 12, 8, -0.9, 1.8, 1.0, 0.9), sh.visor);
  visor.position.copy(helmet.position); body.add(visor);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.35, 6, 16, Math.PI), paint);
  stripe.position.copy(helmet.position); stripe.rotation.y = Math.PI / 2; body.add(stripe);
  // ochranný rám (roll bar) z trubek
  const tube = (pts, r) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, r, 6, false), sh.metal);
    m.castShadow = true; body.add(m);
  };
  for (const z of [-5.2, 5.2]) tube([[-8.5, 7, z], [-8, 15, z * 0.9], [-6.5, 19.5, z * 0.8], [-1, 19.5, z * 0.8], [3.5, 9, z * 0.95]], 0.6);
  tube([[-6.5, 19.5, -4.2], [-6.5, 19.8, 0], [-6.5, 19.5, 4.2]], 0.6);
  tube([[-8.2, 13, -5], [-8.2, 13, 5]], 0.5);
  // přední nárazník a reflektory
  tube([[15.5, 3.2, -5.5], [16.6, 3.6, 0], [15.5, 3.2, 5.5]], 0.55);
  for (const z of [-3.3, 3.3]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), sh.lamp);
    lamp.position.set(13.5, 7.6, z); body.add(lamp);
  }
  // plamen nitra z výfuků
  const flame = new THREE.Mesh(new THREE.ConeGeometry(1.2, 7, 8), sh.flame);
  flame.rotation.z = Math.PI / 2; flame.position.set(-20.5, 6.4, 0); flame.visible = false; body.add(flame);

  // kola: přední menší (natáčecí), zadní velká – typický vzhled buginy
  const wheels = [];
  const front = [];
  for (const [x, z, rad, wid] of [[10.2, -8.3, 4.2, 3.4], [10.2, 8.3, 4.2, 3.4], [-9.6, -8.6, 5.4, 4.8], [-9.6, 8.6, 5.4, 4.8]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, rad, z);
    const w = makeWheel(rad, wid, sh); pivot.add(w);
    root.add(pivot);
    wheels.push({ w, rad });
    if (x > 0) front.push(pivot);
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  flame.castShadow = false;
  root.scale.setScalar(1.15);
  return { root, body, wheels, front, flame, prev: null, roll: 0, pitch: 0, spin: 0, steerVis: 0, yawRate: 0 };
}

/* =====================================================================
   ODMĚNY: nenápadné předměty (lahev nitra, mince, pneumatika, kanystr)
   ===================================================================== */
function buildPickup(type) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); if (rx) m.rotation.x = rx; if (rz) m.rotation.z = rz; m.castShadow = true; g.add(m); return m; };
  if (type === "nitro") {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2f6fb0, metalness: 0.55, roughness: 0.35 });
    add(new THREE.CylinderGeometry(2.6, 2.6, 9, 14), steel, 0, 4.5, 0);
    add(new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 9, 0);
    add(new THREE.CylinderGeometry(0.8, 0.8, 2, 8), new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.2 }), 0, 11.4, 0);
    add(new THREE.CylinderGeometry(2.65, 2.65, 1.6, 14), new THREE.MeshStandardMaterial({ color: 0xe9e5da, roughness: 0.6 }), 0, 5.5, 0);
  } else if (type === "money") {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd6a83a, metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(3, 3, 0.9, 20), gold, (i % 2) * 0.4, 0.5 + i * 0.95, 0);
    add(new THREE.CylinderGeometry(3, 3, 0.9, 20), gold, 4.4, 2.6, 0, 0, 1.2);
  } else if (type === "tires") {
    add(new THREE.TorusGeometry(3.6, 1.6, 10, 20), new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.95 }), 0, 1.6, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(2.1, 2.1, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.3 }), 0, 1.6, 0);
  } else {                                // accel: červený kanystr
    const can = new THREE.MeshStandardMaterial({ color: 0xb83226, metalness: 0.3, roughness: 0.45 });
    add(new THREE.BoxGeometry(7, 8, 3.6), can, 0, 4, 0);
    add(new THREE.TorusGeometry(1.6, 0.45, 6, 12, Math.PI), can, -1, 8.2, 0);
    add(new THREE.CylinderGeometry(0.7, 0.9, 2, 8), new THREE.MeshStandardMaterial({ color: 0xd0c06a, metalness: 0.7, roughness: 0.3 }), 2.6, 8.8, 0, 0, -0.5);
  }
  g.scale.setScalar(1.7);
  return g;
}
// jemný kruh na zemi pod odměnou (aby šla najít, ale nesvítila)
const RING_COLORS = { nitro: "#7fb6e8", money: "#e8c76a", tires: "#d9d9d9", accel: "#e8826f" };
let ringTex = null;
function pickupRing(type) {
  if (!ringTex) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 6, 32, 32, 31);
    grd.addColorStop(0, "rgba(255,255,255,0.15)"); grd.addColorStop(0.62, "rgba(255,255,255,0.8)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    ringTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: ringTex, color: RING_COLORS[type] || "#ffffff", transparent: true, opacity: 1, depthWrite: false, fog: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ---------------- Částice (prach, bláto, voda, jiskry nitra) ---------------- */
function makeParticles() {
  const MAX = 400;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), alpha = new Float32Array(MAX), size = new Float32Array(MAX);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 600 } },
    vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
      void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.25, 0.05, r)); }`,
    transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, pos, col, alpha, size, MAX };
}
function parseColor(str) {
  let c = colorCache.get(str);
  if (!c) {
    const m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) { const p = m[1].split(",").map(Number); c = new THREE.Color(p[0] / 255, p[1] / 255, p[2] / 255); }
    else c = new THREE.Color(str);
    c.convertSRGBToLinear();
    colorCache.set(str, c);
  }
  return c;
}
function updateParticles(list) {
  const P = particleSys, n = Math.min(P.MAX, list ? list.length : 0);
  for (let i = 0; i < n; i++) {
    const p = list[i], a = Math.max(0, p.life / p.max), c = parseColor(p.color);
    P.pos[i * 3] = p.x; P.pos[i * 3 + 1] = (p.h || 0) + 1.5; P.pos[i * 3 + 2] = p.y;
    P.col[i * 3] = c.r; P.col[i * 3 + 1] = c.g; P.col[i * 3 + 2] = c.b;
    P.alpha[i] = a * 0.85; P.size[i] = p.size * (0.8 + (1 - a) * 1.1);
  }
  P.geo.setDrawRange(0, n);
  for (const k of ["position", "color", "alpha", "size"]) P.geo.attributes[k].needsUpdate = true;
}

/* =====================================================================
   SESTAVENÍ TRATI, KAMERA, SNÍMEK
   ===================================================================== */
function ensureTrack(track) {
  const id = track.def.id;
  if (current && current.id === id) return current;
  if (current) current.group.visible = false;
  let b = built.get(id);
  if (!b) {
    const th = themeFor(track), fr = trackFrame(track);
    const group = new THREE.Group();
    const mounds = makeMounds(track, 17);
    const terr = buildTerrain(track, th, mounds, fr);
    group.add(terr.mesh, buildFarGround(th), buildBarriers(track, fr, terr.heightAt), buildNature(track, th, terr.heightAt), buildDetails(track, terr.heightAt));
    if (th.night) group.add(buildFloodlights());
    scene.add(group);
    b = { id, group, th, heightAt: terr.heightAt };
    built.set(id, b);
    // v paměti nechat nejvýš dvě trati (aktuální a předchozí)
    for (const [oid, ob] of built) {
      if (built.size <= 2) break;
      if (oid === id || (current && oid === current.id)) continue;
      scene.remove(ob.group); disposeGroup(ob.group); built.delete(oid);
      for (const [k, m] of pickupModels) if (k.startsWith(oid + ":")) { scene.remove(m.item, m.ring); pickupModels.delete(k); }
    }
  }
  b.group.visible = true;
  const th = b.th;
  sun.color.setHex(th.sun); sun.intensity = th.sunI;
  hemi.color.setHex(th.hemi[0]); hemi.groundColor.setHex(th.hemi[1]); hemi.intensity = th.hemi[2];
  fogColor.setHex(th.fog); renderer.toneMappingExposure = th.exposure;
  current = b;
  return b;
}

// uvolní geometrie, materiály a textury trati z paměti grafiky
function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
  });
}

function buildFloodlights() {
  const g = new THREE.Group();
  for (const [x, y] of [[-60, -40], [W + 60, -40], [-60, H + 30], [W + 60, H + 30]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 120, 8), new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.6, roughness: 0.5 }));
    pole.position.set(x, 60, y); pole.castShadow = true; g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 1.4 }));
    head.position.set(x, 122, y); head.lookAt(W / 2, 0, H / 2); g.add(head);
    const lamp = new THREE.PointLight(0xfff0d0, 1100, 1500, 1);
    lamp.position.set(x, 130, y); g.add(lamp);
  }
  return g;
}

let camKey = "";
function fitCamera() {
  const vw = cssW, vh = Math.max(50, cssH - hudCss);
  const key = vw + "x" + vh;
  if (key === camKey) return;
  camKey = key;
  camera.aspect = vw / vh;
  camera.updateProjectionMatrix();
  const el = THREE.MathUtils.degToRad(57);
  const target = new THREE.Vector3(W / 2, 0, H / 2 + 10);
  const corners = [];
  for (const x of [-12, W + 12]) for (const z of [-12, H + 12]) for (const y of [0, 22]) corners.push(new THREE.Vector3(x, y, z));
  const v = new THREE.Vector3();
  const place = (D) => { camera.position.set(target.x, target.y + D * Math.sin(el), target.z + D * Math.cos(el)); camera.lookAt(target); camera.updateMatrixWorld(); };
  const ext = () => { let mx = 0, minY = 9, maxY = -9; for (const c of corners) { v.copy(c).project(camera); mx = Math.max(mx, Math.abs(v.x)); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); } return { mx, minY, maxY }; };
  for (let it = 0; it < 6; it++) {
    let lo = 300, hi = 9000;
    for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2; place(mid); const e = ext(); if (e.mx <= 0.97 && e.minY >= -0.97 && e.maxY <= 0.97) hi = mid; else lo = mid; }
    place(hi);
    const e = ext();
    target.z -= ((e.maxY + e.minY) / 2) * hi * 0.25;      // vyvážit horní a dolní okraj
  }
  // opar až za arénou (podle skutečné vzdálenosti kamery)
  const D = camera.position.distanceTo(target);
  scene.fog.near = D * 1.35; scene.fog.far = D * 3;
  camera.far = D * 4; camera.updateProjectionMatrix();
  particleSys.points.material.uniforms.scale.value = vh * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

function resize() {
  const c = renderer.domElement;
  const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
  if (w !== cssW || h !== cssH) { cssW = w; cssH = h; renderer.setSize(w, h, false); camKey = ""; }
}

function updateCar(m, c, dt) {
  const gz = c.gz || 0, z = Math.max(c.z || 0, gz);
  m.root.position.set(c.x, z, c.y);
  m.root.rotation.y = -c.angle;
  // dopočet z pohybu (funguje stejně pro místní i online auta)
  let speed = c.speed;
  if (m.prev) {
    const dist = Math.hypot(c.x - m.prev.x, c.y - m.prev.y);
    let dA = c.angle - m.prev.a; while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
    m.yawRate = m.yawRate * 0.8 + (dA / Math.max(dt, 1e-3)) * 0.2;
    if (speed == null) speed = dist / Math.max(dt * 60, 1e-3);
    const vNow = dist / Math.max(dt, 1e-3);
    m.accel = (m.accel || 0) * 0.85 + ((vNow - (m.v || 0)) / Math.max(dt, 1e-3)) * 0.15;
    m.v = vNow;
    m.spin += dist / 5;
  }
  m.prev = { x: c.x, y: c.y, a: c.angle };
  for (const w of m.wheels) w.w.rotation.z = -m.spin * (5 / w.rad);
  const steerTarget = c.steer != null ? c.steer : Math.max(-1, Math.min(1, m.yawRate * 0.5));
  m.steerVis += (steerTarget - m.steerVis) * 0.3;
  for (const f of m.front) f.rotation.y = -m.steerVis * 0.45;
  // náklon karoserie: v zatáčce na vnější stranu, při brzdění dopředu, ve vzduchu nos nahoru
  const air = (c.z || 0) - gz > 1.5;
  const rollT = Math.max(-0.12, Math.min(0.12, -m.yawRate * (Math.abs(speed || 0)) * 0.012));
  const pitchT = air ? 0.08 : Math.max(-0.08, Math.min(0.08, (m.accel || 0) * 0.00035));
  m.roll += (rollT - m.roll) * 0.15; m.pitch += (pitchT - m.pitch) * 0.12;
  const bounce = c.rough && !air && Math.abs(speed || 0) > 0.6 ? Math.sin(performance.now() / 45 + c.x) * 0.35 : 0;
  m.body.rotation.set(m.roll, 0, m.pitch);
  m.body.position.y = 1.2 + bounce;
  m.flame.visible = !!c.boosting;
  if (c.boosting) { const s = 0.8 + Math.random() * 0.5; m.flame.scale.set(1, s, 1); }
}

function render(frame) {
  if (!api.ok) return;
  resize();
  hudCss = frame.hudCss || 0;
  fitCamera();
  const b = ensureTrack(frame.track);
  const now = performance.now(), dt = Math.min(0.05, (now - (render.last || now)) / 1000) || 1 / 60;
  render.last = now;

  // auta
  const seen = new Set();
  for (const c of frame.cars) {
    seen.add(c.id);
    let m = carModels.get(c.id);
    if (!m || m.color !== c.color) {
      if (m) scene.remove(m.root);
      m = buildBuggy(c.color); m.color = c.color;
      carModels.set(c.id, m); scene.add(m.root);
    }
    updateCar(m, c, dt);
  }
  for (const [id, m] of carModels) if (!seen.has(id)) { scene.remove(m.root); carModels.delete(id); }

  // odměny
  const seenP = new Set();
  for (const p of frame.pickups || []) {
    if (p.active === false) continue;
    const key = b.id + ":" + p.id + ":" + p.type; seenP.add(key);
    let m = pickupModels.get(key);
    if (!m) {
      m = { item: buildPickup(p.type), ring: pickupRing(p.type), h: b.heightAt(p.x, p.y) };
      pickupModels.set(key, m); scene.add(m.item, m.ring);
    }
    const bob = p.type === "nitro" ? Math.abs(Math.sin(now / 320 + p.id)) * 4 : Math.sin(now / 500 + p.id) * 1 + 1;
    m.item.position.set(p.x, m.h + 1 + bob, p.y);
    m.item.rotation.y = now / 1400 + p.id;
    m.ring.position.set(p.x, m.h + 0.6, p.y);
    m.item.visible = m.ring.visible = true;
  }
  for (const [k, m] of pickupModels) if (!seenP.has(k)) m.item.visible = m.ring.visible = false;

  updateParticles(frame.particles);

  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, cssW, cssH);
  renderer.clear();
  renderer.setViewport(0, 0, cssW, cssH - hudCss);
  renderer.setScissor(0, 0, cssW, cssH - hudCss);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
}

// Promítnutí bodu světa (x, y, výška) do CSS pixelů plátna (pro jmenovky aut).
const _v = new THREE.Vector3();
function project(x, y, h) {
  _v.set(x, h, y).project(camera);
  if (_v.z > 1) return null;
  return { x: (_v.x + 1) / 2 * cssW, y: hudCss + (1 - _v.y) / 2 * (cssH - hudCss) };
}

const api = { ok: false, init, render, project };
window.Render3D = api;
const cv = document.getElementById("view3d");
if (cv && !init(cv)) cv.style.display = "none";
