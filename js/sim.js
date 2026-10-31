/* =====================================================================
   IRON MAN OFFROAD RACING — SIMULAČNÍ JÁDRO (sim.js)
   Čistá, na prostředí nezávislá simulace (běží v prohlížeči i v Node).
   Obsahuje: definice tratí, geometrii, fyziku aut, AI a herní svět.
   Detekce branek je řešena protnutím čáry (robustní, nedá se přeskočit).
   ===================================================================== */
(function (global) {
  "use strict";

  const WORLD_W = 1000;
  const WORLD_H = 680;
  const GATE_COUNT = 24;
  const FIXED_DT = 1 / 60;   // pevný krok simulace
  const CAR_R = 11;          // srážkový poloměr auta
  const WALL_GAP = 6;        // mantinel stojí kousek za okrajem cesty
  const GRAVITY = 0.42;      // px/tik² pro skoky z kopců

  /* ---------------- Definice tratí ---------------- */
  const TRACKS = [
    {
      id: "dusty",
      name: "Prašná smyčka",
      difficulty: "Střední",
      width: 108,
      theme: { grass: "#6b5233", grassDark: "#4f3c25", dirt: "#a5844f", dirtEdge: "#7a6038", rut: "#94754a" },   // hliněná aréna jako v originále
      waypoints: [
        { x: 200, y: 150 }, { x: 470, y: 110 }, { x: 760, y: 140 }, { x: 880, y: 300 },
        { x: 820, y: 470 }, { x: 600, y: 470 }, { x: 470, y: 560 }, { x: 250, y: 540 }, { x: 110, y: 360 },
      ],
      terrainSpec: [
        { gate: 5, side: 0.55, type: "mud", r: 34 },
        { gate: 14, side: -0.45, type: "water", r: 30 },
        { gate: 20, side: 0.4, type: "mud", r: 32 },
      ],
      hillSpec: [ { gate: 2.6, type: "ramp", rise: 60, fall: 20, h: 16 }, { gate: 10, len: 150, h: 13 }, { gate: 17.4, len: 36, h: 4 }, { gate: 17.9, len: 36, h: 4 }, { gate: 18.4, len: 36, h: 4 } ],
    },
    {
      id: "canyon",
      name: "Hadí kaňon",
      difficulty: "Těžká",
      width: 100,
      theme: { grass: "#6b5a3a", grassDark: "#564834", dirt: "#b08a55", dirtEdge: "#8a6c40", rut: "#a07c48" },
      waypoints: [
        { x: 150, y: 230 }, { x: 330, y: 130 }, { x: 520, y: 210 }, { x: 700, y: 120 }, { x: 880, y: 250 },
        { x: 800, y: 430 }, { x: 870, y: 560 }, { x: 640, y: 600 }, { x: 470, y: 500 }, { x: 280, y: 590 }, { x: 110, y: 430 },
      ],
      terrainSpec: [
        { gate: 4, side: -0.45, type: "mud", r: 30 },
        { gate: 9, side: 0.5, type: "water", r: 30 },
        { gate: 13, side: -0.4, type: "mud", r: 32 },
        { gate: 19, side: 0.45, type: "mud", r: 30 },
      ],
      hillSpec: [ { gate: 2, len: 150, h: 13 }, { gate: 7, len: 36, h: 4 }, { gate: 7.5, len: 36, h: 4 }, { gate: 16.4, type: "ramp", rise: 60, fall: 20, h: 16 } ],
    },
    {
      id: "oval",
      name: "Velký ovál",
      difficulty: "Snadná",
      width: 116,
      theme: { grass: "#33683f", grassDark: "#234a2c", dirt: "#9a7b48", dirtEdge: "#76603a", rut: "#8a6e40" },
      waypoints: [
        { x: 200, y: 150 }, { x: 500, y: 120 }, { x: 800, y: 150 }, { x: 890, y: 340 },
        { x: 800, y: 540 }, { x: 500, y: 570 }, { x: 200, y: 540 }, { x: 110, y: 340 },
      ],
      terrainSpec: [
        { gate: 11, side: 0.5, type: "mud", r: 34 },
        { gate: 22, side: -0.4, type: "water", r: 28 },
      ],
      hillSpec: [ { gate: 3.4, type: "ramp", rise: 65, fall: 20, h: 17 }, { gate: 8, len: 160, h: 14 }, { gate: 15.4, type: "ramp", rise: 65, fall: 20, h: 17 }, { gate: 20, len: 160, h: 14 } ],
    },
    {
      id: "stadium",
      name: "Noční stadion",
      difficulty: "Střední",
      width: 106,
      theme: { grass: "#283042", grassDark: "#1d2433", dirt: "#7c6f55", dirtEdge: "#5d533f", rut: "#6e6249" },
      waypoints: [
        { x: 200, y: 160 }, { x: 500, y: 120 }, { x: 800, y: 160 }, { x: 880, y: 340 },
        { x: 800, y: 540 }, { x: 500, y: 580 }, { x: 200, y: 540 }, { x: 120, y: 340 },
      ],
      terrainSpec: [
        { gate: 7, side: -0.5, type: "mud", r: 32 },
        { gate: 17, side: 0.45, type: "water", r: 28 },
      ],
      hillSpec: [ { gate: 3.4, type: "ramp", rise: 60, fall: 20, h: 16 }, { gate: 11.4, len: 36, h: 4 }, { gate: 11.9, len: 36, h: 4 }, { gate: 12.4, len: 36, h: 4 }, { gate: 21, len: 150, h: 13 } ],
    },
  ];

  /* ---------------- Geometrie ---------------- */
  function catmullRomClosed(points, samplesPerSeg) {
    const res = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let t = 0; t < samplesPerSeg; t++) {
        const s = t / samplesPerSeg, s2 = s * s, s3 = s2 * s;
        res.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
        });
      }
    }
    return res;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Protnutí dvou úseček (p1->p2) a (p3->p4)
  function segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(d) < 1e-9) return false;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }

  // Z definice trati vytvoří kompletní geometrii (osa, branky, startovní čára)
  function buildTrack(def) {
    const center = catmullRomClosed(def.waypoints, 24);
    const halfW = def.width / 2;
    const gateLineHalf = halfW * 1.25;        // čára branky přesahuje okraj trati
    const gates = [];
    for (let i = 0; i < GATE_COUNT; i++) {
      const idx = Math.round((i / GATE_COUNT) * center.length) % center.length;
      const p = center[idx];
      const nxt = center[(idx + 2) % center.length];
      const ang = Math.atan2(nxt.y - p.y, nxt.x - p.x);
      const nx = -Math.sin(ang), ny = Math.cos(ang);   // normála k trati
      gates.push({
        x: p.x, y: p.y, dirAngle: ang,
        ax: p.x - nx * gateLineHalf, ay: p.y - ny * gateLineHalf,
        bx: p.x + nx * gateLineHalf, by: p.y + ny * gateLineHalf,
      });
    }
    // terénní plochy z předpisu vázaného na branky (zaručeně u trati)
    let terrain = def.terrain || [];
    if (def.terrainSpec) {
      terrain = def.terrainSpec.map((s) => {
        const g = gates[s.gate % gates.length];
        const nx = -Math.sin(g.dirAngle), ny = Math.cos(g.dirAngle);
        return { type: s.type, r: s.r, x: g.x + nx * s.side * halfW, y: g.y + ny * s.side * halfW };
      });
    }
    // oblouková délka podél osy (pro kopce a výškový profil)
    const sAt = [0];
    for (let i = 1; i <= center.length; i++) {
      const a = center[i - 1], b = center[i % center.length];
      sAt.push(sAt[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const length = sAt[center.length];
    // kopce přes celou šířku trati: { s0 = střed, half = poloviční délka, h = výška }
    // vlna (hill): symetrický táhlý kopec; skokánek (ramp): pozvolný nájezd, hrana, krátký sraz
    const hills = (def.hillSpec || []).map((hs) => {
      const idx = Math.round((hs.gate / GATE_COUNT) * center.length) % center.length;
      return hs.type === "ramp"
        ? { type: "ramp", s0: sAt[idx], rise: hs.rise, fall: hs.fall, h: hs.h }
        : { type: "hill", s0: sAt[idx], half: hs.len / 2, h: hs.h };
    });
    return {
      def, center, gates, halfW, width: def.width, gateCount: GATE_COUNT, theme: def.theme, terrain,
      sAt, length, hills,
      wallR: halfW + WALL_GAP - CAR_R,   // max. vzdálenost středu auta od osy (pevný mantinel)
    };
  }

  // Nejbližší bod osy trati: vzdálenost, jednotková normála (od osy k bodu) a oblouková délka.
  function nearestOnCenter(track, x, y) {
    const C = track.center, n = C.length;
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < n; i++) {
      const a = C[i], b = C[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (a.x + t * dx), ey = y - (a.y + t * dy);
      const d2 = ex * ex + ey * ey;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    const a = C[bi], b = C[(bi + 1) % n];
    const px = a.x + (b.x - a.x) * bt, py = a.y + (b.y - a.y) * bt;
    const d = Math.sqrt(best);
    let nx, ny;
    if (d > 1e-6) { nx = (x - px) / d; ny = (y - py) / d; }
    else { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; nx = -(b.y - a.y) / l; ny = (b.x - a.x) / l; }
    const s = track.sAt[bi] + (track.sAt[bi + 1] - track.sAt[bi]) * bt;
    return { d, nx, ny, s };
  }

  // Výška terénu v daném místě osy (součet hladkých kopců, s ohledem na uzavřenou smyčku).
  function groundAt(track, s) {
    let h = 0;
    for (const hl of track.hills) {
      let d = s - hl.s0;
      if (d > track.length / 2) d -= track.length;
      if (d < -track.length / 2) d += track.length;
      if (hl.type === "ramp") {
        if (d > -hl.rise && d <= 0) h += hl.h * (1 - Math.cos((Math.PI / 2) * (d + hl.rise) / hl.rise));   // nejstrmější u hrany
        else if (d > 0 && d < hl.fall) h += hl.h * 0.5 * (1 + Math.cos(Math.PI * d / hl.fall));
      } else if (d > -hl.half && d < hl.half) h += hl.h * 0.5 * (1 + Math.cos(Math.PI * d / hl.half));
    }
    return h;
  }

  function isOnTrack(track, x, y) {
    const C = track.center, half = track.halfW;
    let best = Infinity;
    for (let i = 0; i < C.length; i++) {
      const a = C[i], b = C[(i + 1) % C.length];
      const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
      if (best <= half) return true;
    }
    return best <= half;
  }

  /* ---------------- Terén ---------------- */
  const NEUTRAL = { speed: 1, grip: 1, rough: false };
  const TERRAIN_FX = {
    mud: { speed: 0.62, grip: 0.78, rough: true },     // bláto: pomalé a kluzké
    water: { speed: 0.48, grip: 0.55, rough: true },   // louže: hodně zpomalí
    bumps: { speed: 0.85, grip: 0.92, rough: true },   // hrboly: drncání
  };
  // Vliv povrchu v daném bodě (terénní plochy trati).
  function surfaceAt(track, x, y) {
    const T = track.terrain;
    if (T) for (const z of T) {
      const dx = x - z.x, dy = y - z.y;
      if (dx * dx + dy * dy < z.r * z.r) return TERRAIN_FX[z.type] || NEUTRAL;
    }
    return NEUTRAL;
  }

  /* ---------------- Vylepšení (shop) ---------------- */
  const UPGRADE_DEFS = {
    engine: { name: "Motor", max: 3, cost: [0, 400, 800, 1400], desc: "vyšší maximální rychlost" },
    accel:  { name: "Zrychlení", max: 3, cost: [0, 350, 700, 1200], desc: "rychlejší rozjezd" },
    tires:  { name: "Pneumatiky", max: 3, cost: [0, 350, 700, 1200], desc: "lepší zatáčení" },
    nitro:  { name: "Nitro", max: 3, cost: [0, 400, 800, 1400], desc: "větší zásoba turba" },
  };

  // Ladění jízdy: cíl = předvídatelné ovládání jako v původní hře.
  // Auto jede tam, kam míří (malý smyk), otáčí se i pomalu, má skutečnou brzdu.
  const BASE = {
    accel: 0.15, brake: 0.24, reverseAccel: 0.08, maxSpeed: 4.3, reverseMax: 1.8,
    offMaxSpeed: 2.2,
    friction: 0.988, offFriction: 0.95,    // dopředné valivé tření (cesta / tráva)
    grip: 0.36, offGrip: 0.22,             // ubírání bočního skluzu za tik (víc = méně smyku)
    turn: 0.066,                           // rad/tik při plné rychlosti
    turnStill: 0.55,                       // podíl otáčivosti v klidu (otočení na místě)
    nitroMaxSpeed: 5.6, nitroBoost: 0.22,
  };

  function computePhys(up) {
    up = up || {};
    const e = up.engine || 0, a = up.accel || 0, t = up.tires || 0, n = up.nitro || 0;
    return {
      accel: BASE.accel + a * 0.03,
      brake: BASE.brake,
      reverseAccel: BASE.reverseAccel,
      reverseMax: BASE.reverseMax,
      maxSpeed: BASE.maxSpeed + e * 0.5,
      offMaxSpeed: BASE.offMaxSpeed + e * 0.12,
      friction: BASE.friction,
      offFriction: BASE.offFriction,
      grip: BASE.grip + t * 0.05,
      offGrip: BASE.offGrip + t * 0.03,
      turn: BASE.turn + t * 0.005,
      turnStill: BASE.turnStill,
      nitroMaxSpeed: BASE.nitroMaxSpeed + e * 0.5,
      nitroBoost: BASE.nitroBoost + n * 0.03,
      nitroTank: 100 + n * 45,
      nitroDrain: 0.8 - n * 0.08,
      nitroRegen: 0.03 + n * 0.01,    // velmi pomalé samovolné dobíjení; hlavně se sbírá
    };
  }

  /* ---------------- Auto ---------------- */
  let _carSeq = 0;
  class Car {
    constructor(opts) {
      opts = opts || {};
      this.id = opts.id != null ? opts.id : "car" + (_carSeq++);
      this.color = opts.color || "#e8473b";
      this.name = opts.name || "Hráč";
      this.isAI = !!opts.isAI;
      this.aiSkill = opts.aiSkill != null ? opts.aiSkill : 0.9;
      this.upgrades = opts.upgrades || { engine: 0, accel: 0, tires: 0, nitro: 0 };
      this.phys = computePhys(this.upgrades);
      this.place(0, 0, 0);
      this.collided = false;   // příznak pro zvuk srážky
    }

    setUpgrades(up) {
      this.upgrades = up;
      this.phys = computePhys(up);
      this.nitro = Math.min(this.phys.nitroTank, 50);
    }

    place(x, y, angle) {
      this.x = this.prevX = x;
      this.y = this.prevY = y;
      this.angle = angle;
      this.speed = 0;
      this.vx = 0; this.vy = 0;          // vektor rychlosti
      this.z = 0; this.vz = 0;           // výška nad zemí (skoky z kopců)
      this.gz = 0;                       // výška terénu pod autem
      this.air = false;                  // ve vzduchu
      this.slope = 0;                    // sklon terénu ve směru jízdy
      this.onTrack = true;
      this.rough = false;                // drncavý povrch (jen pro efekty)
      this.boostTime = 0; this.gripTime = 0;   // dočasné bonusy z balíčků
      this.boosting = false;
      this.cashBonus = 0;                // peníze sebrané na trati
      this.lapGates = 0;                 // celkový počet projetých branek
      this.nextGate = 1;
      this.nitro = Math.min(this.phys.nitroTank, 50);
      this.finished = false;
      this.finishTime = 0;
    }

    currentLap(totalLaps) {
      return Math.min(Math.floor(this.lapGates / GATE_COUNT) + 1, totalLaps);
    }
  }

  const NO_INPUT = { up: false, down: false, left: false, right: false, nitro: false };

  /* ---------------- AI řízení ---------------- */
  // Deterministická AI: míří na branku před sebou, brzdí před ostrou zatáčkou,
  // dovednost určuje, jak blízko maximální rychlosti jede a jak využívá nitro.
  function aiInput(car, track) {
    const gates = track.gates;
    const look = car.speed > 3 ? 2 : 1;
    const tgt = gates[(car.nextGate + look - 1) % gates.length];
    const desired = Math.atan2(tgt.y - car.y, tgt.x - car.x);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const skill = car.aiSkill;
    const input = { up: false, down: false, left: false, right: false, nitro: false };
    if (diff < -0.06) input.left = true;
    else if (diff > 0.06) input.right = true;

    const sharp = Math.abs(diff);
    // snadní ~0.86, normální ~0.93 max. rychlosti, těžcí jedou naplno
    const cruise = car.phys.maxSpeed * (0.62 + 0.38 * skill);
    if (sharp > 1.0 && car.speed > car.phys.maxSpeed * 0.55) input.down = true;
    else if (skill >= 0.95 || car.speed < cruise) input.up = true;

    if (sharp < 0.2 && car.nitro > 35 && skill > 0.7 && !car.air) input.nitro = true;
    return input;
  }

  /* ---------------- Krok fyziky jednoho auta ---------------- */
  function stepCar(car, track, input) {
    if (car.finished) input = NO_INPUT;
    const P = car.phys;
    const onTrack = car.onTrack;
    const surf = surfaceAt(track, car.x, car.y);   // vliv terénu (bláto/voda)
    const grounded = !car.air;

    // dočasné bonusy z balíčků
    car.boostTime = Math.max(0, car.boostTime - FIXED_DT);
    car.gripTime = Math.max(0, car.gripTime - FIXED_DT);
    const gripMul = car.gripTime > 0 ? 1.35 : 1;

    const cosA = Math.cos(car.angle), sinA = Math.sin(car.angle);

    // NITRO = nastřádaná zásoba, kterou hráč vypustí klávesou (i bez plynu)
    const usingNitro = input.nitro && car.nitro > 0;
    car.boosting = usingNitro || car.boostTime > 0;
    let maxSpeed = (onTrack ? P.maxSpeed : P.offMaxSpeed) * surf.speed;
    if (car.boostTime > 0) maxSpeed = Math.max(maxSpeed, P.maxSpeed * 1.3);
    if (usingNitro) {
      maxSpeed = Math.max(maxSpeed, P.nitroMaxSpeed);
      car.nitro = Math.max(0, car.nitro - P.nitroDrain);
      car.vx += cosA * P.nitroBoost; car.vy += sinA * P.nitroBoost;   // tah i bez plynu
    } else {
      car.nitro = Math.min(P.nitroTank, car.nitro + P.nitroRegen);
    }

    // 1) motor tlačí podél aktuálního směru auta
    const fwd0 = car.vx * cosA + car.vy * sinA;
    if (grounded && input.up) {
      const a = P.accel * (car.boostTime > 0 ? 1.5 : 1);
      car.vx += cosA * a; car.vy += sinA * a;
    }

    // 2) řízení: stálá otáčivost, i v klidu (otočení na místě), obráceně při couvání
    if (grounded) {
      const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      if (steer) {
        const k = P.turnStill + (1 - P.turnStill) * Math.min(1, Math.abs(fwd0) / 2);
        car.angle += steer * P.turn * k * (fwd0 < -0.1 ? -1 : 1);
      }
    }

    // 3) rozklad rychlosti vůči NOVÉMU směru: auto nese setrvačnost, přilnavost tlumí skluz
    const c2 = Math.cos(car.angle), s2 = Math.sin(car.angle);
    let fwd = car.vx * c2 + car.vy * s2;
    let lat = -car.vx * s2 + car.vy * c2;
    if (grounded) {
      if (input.down) {
        if (fwd > 0.15) fwd = Math.max(0, fwd - P.brake);   // skutečná brzda
        else fwd -= P.reverseAccel;                          // pak zpátečka
      }
      fwd -= Math.sign(fwd) * car.slope * 0.1;          // do kopce zpomalí, z kopce zrychlí
      fwd *= (onTrack ? P.friction : P.offFriction);
      let grip = (onTrack ? P.grip : P.offGrip) * gripMul * surf.grip;
      if (grip > 0.9) grip = 0.9;
      lat *= (1 - grip);
      if (!input.up && !usingNitro && Math.abs(fwd) < 0.05) fwd = 0;
    } else {
      fwd *= 0.998; lat *= 0.99;          // ve vzduchu jen setrvačnost
    }
    if (fwd > maxSpeed) fwd = maxSpeed + (fwd - maxSpeed) * 0.85;   // plynulé zpomalení (bláto, konec boostu)
    if (fwd < -P.reverseMax) fwd = -P.reverseMax;

    car.vx = c2 * fwd - s2 * lat;
    car.vy = s2 * fwd + c2 * lat;
    car.speed = fwd;

    car.prevX = car.x; car.prevY = car.y;
    car.x += car.vx;
    car.y += car.vy;

    // pevné mantinely: odraz od stěny podél trati
    const near = nearestOnCenter(track, car.x, car.y);
    car.wallHit = 0;
    if (near.d > track.wallR) {
      const over = near.d - track.wallR;
      car.x -= near.nx * over; car.y -= near.ny * over;
      const vn = car.vx * near.nx + car.vy * near.ny;      // rychlost do stěny
      if (vn > 0) {
        car.vx -= 1.35 * vn * near.nx; car.vy -= 1.35 * vn * near.ny;   // odraz 35 %
        car.vx *= 0.94; car.vy *= 0.94;                                  // tření o stěnu
        car.wallHit = vn;
      }
      near.d = track.wallR;
    }
    car.onTrack = near.d <= track.halfW;
    car.rough = !car.onTrack || surf.rough;

    // výška: jízda po kopcích, odlepení na hřebeni, dopad
    const gz = groundAt(track, near.s);
    car.landed = 0;
    if (!car.air) {
      const groundVz = gz - car.gz;            // jak rychle se zvedá zem pod autem
      if (groundVz - car.vz < -GRAVITY && Math.abs(car.speed) > 1.5) {
        car.air = true;                        // zem uhýbá rychleji než gravitace → skok
        car.vz = Math.min(car.vz, 2.4) - GRAVITY; car.z += car.vz;
      } else {
        car.vz = groundVz; car.z = gz;
      }
    } else {
      car.vz -= GRAVITY; car.z += car.vz;
      if (car.z <= gz) {                       // dopad
        car.landed = -car.vz;
        car.z = gz; car.vz = 0; car.air = false;
        if (car.landed > 2) { car.vx *= 0.9; car.vy *= 0.9; }   // tvrdý dopad trochu zpomalí
      }
    }
    // sklon ve směru jízdy (kladný = do kopce) pro příští krok
    const moved = Math.hypot(car.x - car.prevX, car.y - car.prevY);
    car.slope = car.air ? 0 : Math.max(-0.6, Math.min(0.6, (gz - car.gz) / Math.max(0.5, moved)));
    car.gz = gz;

    const m = 16;
    if (car.x < m) car.x = m;
    if (car.x > WORLD_W - m) car.x = WORLD_W - m;
    if (car.y < m) car.y = m;
    if (car.y > WORLD_H - m) car.y = WORLD_H - m;
  }

  // Kontrola průjezdu brankou (protnutí čáry pohybem auta)
  function checkGate(car, track, totalLaps) {
    if (car.finished) return false;
    const g = track.gates[car.nextGate];
    if (segmentsIntersect(car.prevX, car.prevY, car.x, car.y, g.ax, g.ay, g.bx, g.by)) {
      car.nextGate = (car.nextGate + 1) % track.gateCount;
      car.lapGates++;
      if (car.lapGates >= totalLaps * track.gateCount) {
        car.finished = true;
      }
      return true;   // brankou prošel (gate 0 = projetí cílem/kolo)
    }
    return false;
  }

  /* ---------------- Svět ---------------- */
  class World {
    constructor(trackDef, cars, totalLaps) {
      this.track = buildTrack(trackDef);
      this.cars = cars;
      this.totalLaps = totalLaps || 3;
      this.time = 0;
      this.running = false;
      this.placeCars();
      this.initPickups();
    }

    // odměny na trati: nitro, peníze, pneumatiky (grip), zrychlení
    initPickups() {
      const types = ["nitro", "money", "accel", "nitro", "tires", "money", "nitro", "accel"];
      const gateIdx = [3, 6, 9, 12, 15, 18, 21, 23];
      const gates = this.track.gates;
      this.pickups = gateIdx.map((gi, k) => {
        const g = gates[gi % gates.length];
        const nx = -Math.sin(g.dirAngle), ny = Math.cos(g.dirAngle);
        const side = (k % 2 === 0 ? 1 : -1) * (this.track.halfW * 0.4);
        return { id: k, type: types[k % types.length], x: g.x + nx * side, y: g.y + ny * side, active: true, respawn: 0 };
      });
    }

    placeCars() {
      const g = this.track.gates[0];
      const ang = g.dirAngle;
      const nx = -Math.sin(ang), ny = Math.cos(ang);   // do stran
      const bx = -Math.cos(ang), by = -Math.sin(ang);  // dozadu
      this.cars.forEach((c, i) => {
        const row = Math.floor(i / 2);
        const col = (i % 2) === 0 ? -1 : 1;
        const px = g.x + nx * col * 18 + bx * (12 + row * 34);
        const py = g.y + ny * col * 18 + by * (12 + row * 34);
        c.place(px, py, ang);
        c.z = c.gz = groundAt(this.track, nearestOnCenter(this.track, px, py).s);
      });
    }

    // jeden pevný krok; inputsById: { carId: inputState }
    tick(inputsById) {
      if (!this.running) return [];
      this.time += FIXED_DT;
      const events = [];
      for (const c of this.cars) {
        const input = c.isAI ? aiInput(c, this.track)
                             : (inputsById[c.id] || { up: false, down: false, left: false, right: false, nitro: false });
        stepCar(c, this.track, input);
        if (c.wallHit > 1.2) events.push({ type: "wall", car: c.id, power: c.wallHit });
        if (c.landed > 1.5) events.push({ type: "land", car: c.id, power: c.landed });
      }
      this.resolveCollisions(events);
      this.updatePickups(events);
      for (const c of this.cars) {
        const wasFinished = c.finished;
        if (checkGate(c, this.track, this.totalLaps)) {
          events.push({ type: "gate", car: c.id, lapGates: c.lapGates });
          if (c.finished && !wasFinished) {
            c.finishTime = this.time;
            events.push({ type: "finish", car: c.id, time: c.finishTime });
          }
        }
      }
      return events;
    }

    updatePickups(events) {
      const R = 24;
      for (const p of this.pickups) {
        if (!p.active) {
          p.respawn -= FIXED_DT;
          if (p.respawn <= 0) p.active = true;
          continue;
        }
        for (const c of this.cars) {
          if (c.finished) continue;
          const dx = c.x - p.x, dy = c.y - p.y;
          if (dx * dx + dy * dy < R * R) {
            this.applyPickup(c, p);
            p.active = false;
            p.respawn = 7;
            events.push({ type: "pickup", car: c.id, kind: p.type });
            break;
          }
        }
      }
    }

    applyPickup(car, p) {
      switch (p.type) {
        case "nitro": car.nitro = Math.min(car.phys.nitroTank, car.nitro + 60); break;
        case "accel": car.boostTime = 3.0; break;       // dočasné zrychlení
        case "tires": car.gripTime = 4.5; break;        // dočasná lepší přilnavost
        case "money": car.cashBonus = (car.cashBonus || 0) + 150; break;  // sebráno -> přičte se mimo
      }
    }

    resolveCollisions(events) {
      const cs = this.cars;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length; j++) {
          const a = cs[i], b = cs[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = 26;
          if (d > 0 && d < min) {
            const ovr = (min - d) / 2;
            const ux = dx / d, uy = dy / d;
            a.x -= ux * ovr; a.y -= uy * ovr;
            b.x += ux * ovr; b.y += uy * ovr;
            // předání části hybnosti + odraz
            const push = 0.6;
            a.vx -= ux * push; a.vy -= uy * push;
            b.vx += ux * push; b.vy += uy * push;
            a.vx *= 0.9; a.vy *= 0.9; b.vx *= 0.9; b.vy *= 0.9;
            a.collided = b.collided = true;
            events.push({ type: "collision", a: a.id, b: b.id });
          }
        }
      }
    }

    // pořadí podle počtu projetých branek, pak podle vzdálenosti k další brance
    ranking() {
      return [...this.cars].sort((a, b) => {
        if (a.finished && b.finished) return a.finishTime - b.finishTime;
        if (b.lapGates !== a.lapGates) return b.lapGates - a.lapGates;
        const ga = this.track.gates[a.nextGate], gb = this.track.gates[b.nextGate];
        return Math.hypot(a.x - ga.x, a.y - ga.y) - Math.hypot(b.x - gb.x, b.y - gb.y);
      });
    }

    allFinished() { return this.cars.every((c) => c.finished); }
  }

  const API = {
    WORLD_W, WORLD_H, GATE_COUNT, FIXED_DT,
    TRACKS, UPGRADE_DEFS, BASE,
    CAR_R, WALL_GAP, GRAVITY,
    catmullRomClosed, buildTrack, isOnTrack, surfaceAt, nearestOnCenter, groundAt, computePhys,
    Car, World, aiInput, stepCar, checkGate,
  };

  global.IMR = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
