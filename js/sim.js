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

  /* ---------------- Definice tratí ---------------- */
  const TRACKS = [
    {
      id: "dusty",
      name: "Prašná smyčka",
      difficulty: "Střední",
      width: 108,
      theme: { grass: "#2f5a37", grassDark: "#214027", dirt: "#8a6e42", dirtEdge: "#6b5634", rut: "#7d6238" },
      waypoints: [
        { x: 200, y: 150 }, { x: 470, y: 110 }, { x: 760, y: 140 }, { x: 880, y: 300 },
        { x: 820, y: 470 }, { x: 600, y: 470 }, { x: 470, y: 560 }, { x: 250, y: 540 }, { x: 110, y: 360 },
      ],
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
    return { def, center, gates, halfW, width: def.width, gateCount: GATE_COUNT, theme: def.theme, terrain: def.terrain || [] };
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

  const BASE = {
    accel: 0.17, reverseAccel: 0.11, maxSpeed: 4.3, offMaxSpeed: 1.9,
    friction: 0.985, offFriction: 0.90,    // dopředné valivé tření
    grip: 0.17, offGrip: 0.09,             // ubírání bočního skluzu (víc = méně smyku)
    turn: 0.060, nitroMaxSpeed: 5.2, nitroBoost: 0.26,
  };

  function computePhys(up) {
    up = up || {};
    const e = up.engine || 0, a = up.accel || 0, t = up.tires || 0, n = up.nitro || 0;
    return {
      accel: BASE.accel + a * 0.035,
      reverseAccel: BASE.reverseAccel,
      maxSpeed: BASE.maxSpeed + e * 0.55,
      offMaxSpeed: BASE.offMaxSpeed + e * 0.12,
      friction: BASE.friction,
      offFriction: BASE.offFriction,
      grip: BASE.grip + t * 0.045,
      offGrip: BASE.offGrip + t * 0.02,
      turn: BASE.turn + t * 0.006,
      nitroMaxSpeed: BASE.nitroMaxSpeed + e * 0.55,
      nitroBoost: BASE.nitroBoost + n * 0.03,
      nitroTank: 100 + n * 45,
      nitroDrain: 0.8 - n * 0.08,
      nitroRegen: 0.10 + n * 0.03,
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
      this.x = 0; this.y = 0; this.angle = 0; this.speed = 0;
      this.vx = 0; this.vy = 0;          // vektor rychlosti
      this.boostTime = 0; this.gripTime = 0;   // dočasné bonusy z balíčků
      this.prevX = 0; this.prevY = 0;
      this.lapGates = 0;       // celkový počet projetých branek
      this.nextGate = 1;
      this.nitro = this.phys.nitroTank;
      this.finished = false;
      this.finishTime = 0;
      this.rumble = 0;
      this.collided = false;   // příznak pro zvuk srážky (čte a maže renderer)
      this.boosting = false;
      // AI stav
      this._aiTarget = 1;
    }

    setUpgrades(up) {
      this.upgrades = up;
      this.phys = computePhys(up);
    }

    place(x, y, angle) {
      this.x = this.prevX = x;
      this.y = this.prevY = y;
      this.angle = angle;
      this.speed = 0;
      this.vx = 0; this.vy = 0;
      this.boostTime = 0; this.gripTime = 0;
      this.lapGates = 0;
      this.nextGate = 1;
      this.nitro = this.phys.nitroTank;
      this.finished = false;
      this.finishTime = 0;
      this._aiTarget = 1;
    }

    currentLap(totalLaps) {
      return Math.min(Math.floor(this.lapGates / GATE_COUNT) + 1, totalLaps);
    }
  }

  /* ---------------- AI řízení ---------------- */
  // Vrátí vstup {up,down,left,right,nitro} pro AI auto na základě další branky.
  function aiInput(car, track) {
    const gates = track.gates;
    // cíl = branka pár kroků před autem (plynulejší trajektorie)
    const look = 1;
    const tgt = gates[(car.nextGate + look) % gates.length];
    const dx = tgt.x - car.x, dy = tgt.y - car.y;
    const desired = Math.atan2(dy, dx);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const skill = car.aiSkill;
    const deadzone = 0.05;
    const input = { up: false, down: false, left: false, right: false, nitro: false };

    if (diff < -deadzone) input.left = true;
    else if (diff > deadzone) input.right = true;

    // plyn: ubrat v ostré zatáčce, jinak plný plyn
    const sharp = Math.abs(diff);
    if (sharp > 1.1 && car.speed > car.phys.maxSpeed * 0.55) {
      input.down = true;        // přibrzdit
    } else {
      input.up = true;
    }

    // nitro na rovince, když je dost zásoby a slušná dovednost
    if (sharp < 0.25 && car.nitro > 30 && skill > 0.6) input.nitro = true;

    // malá nedokonalost podle dovednosti (nižší skill = občas pustí plyn)
    if (skill < 0.95 && Math.random() > 0.5 + skill * 0.49) {
      input.up = false;
    }
    return input;
  }

  /* ---------------- Krok fyziky jednoho auta ---------------- */
  function stepCar(car, track, input) {
    if (car.finished) {
      car.vx *= 0.9; car.vy *= 0.9;
      car.x += car.vx; car.y += car.vy;
      car.speed = Math.hypot(car.vx, car.vy);
      return;
    }
    const P = car.phys;
    const onTrack = isOnTrack(track, car.x, car.y);
    const surf = surfaceAt(track, car.x, car.y);   // vliv terénu (bláto/voda)

    // dočasné bonusy z balíčků
    car.boostTime = Math.max(0, car.boostTime - FIXED_DT);
    car.gripTime = Math.max(0, car.gripTime - FIXED_DT);
    const speedMul = car.boostTime > 0 ? 1.35 : 1;
    const gripMul = car.gripTime > 0 ? 1.4 : 1;

    const usingNitro = input.nitro && car.nitro > 0 && input.up;
    car.boosting = usingNitro || car.boostTime > 0;
    let maxSpeed = (onTrack ? P.maxSpeed : P.offMaxSpeed) * speedMul * surf.speed;
    let accel = P.accel;
    if (usingNitro) {
      maxSpeed = P.nitroMaxSpeed * speedMul * surf.speed;
      accel += P.nitroBoost;
      car.nitro = Math.max(0, car.nitro - P.nitroDrain);
    } else {
      car.nitro = Math.min(P.nitroTank, car.nitro + P.nitroRegen);
    }

    const a = car.angle, cosA = Math.cos(a), sinA = Math.sin(a);
    // motor působí podél směru auta
    if (input.up) { car.vx += cosA * accel; car.vy += sinA * accel; }
    if (input.down) { car.vx -= cosA * P.reverseAccel; car.vy -= sinA * P.reverseAccel; }

    // řízení (účinnější při vyšší rychlosti; podle směru jízdy)
    const sp = Math.hypot(car.vx, car.vy);
    const fwdSign = (car.vx * cosA + car.vy * sinA) >= 0 ? 1 : -1;
    const steerFactor = Math.min(1, sp / 1.4);
    if (input.left) car.angle -= P.turn * steerFactor * fwdSign;
    if (input.right) car.angle += P.turn * steerFactor * fwdSign;

    // rozklad rychlosti na podélnou a boční složku vůči novému směru
    const a2 = car.angle, c2 = Math.cos(a2), s2 = Math.sin(a2);
    let fwd = car.vx * c2 + car.vy * s2;
    let lat = -car.vx * s2 + car.vy * c2;

    fwd *= (onTrack ? P.friction : P.offFriction);
    let grip = (onTrack ? P.grip : P.offGrip) * gripMul * surf.grip;
    if (grip > 0.92) grip = 0.92;
    lat *= (1 - grip);                  // přilnavost ubírá boční skluz (drift)

    if (fwd > maxSpeed) fwd = maxSpeed;
    if (fwd < -P.offMaxSpeed) fwd = -P.offMaxSpeed;

    car.vx = c2 * fwd - s2 * lat;
    car.vy = s2 * fwd + c2 * lat;
    car.speed = fwd;

    const rough = !onTrack || surf.rough;
    car.rumble = (rough && sp > 0.5) ? (Math.random() - 0.5) * 1.6 : 0;
    car.prevX = car.x; car.prevY = car.y;
    car.x += car.vx + car.rumble;
    car.y += car.vy + car.rumble;

    const m = 16;
    if (car.x < m) { car.x = m; car.vx *= -0.3; car.vy *= 0.8; }
    if (car.x > WORLD_W - m) { car.x = WORLD_W - m; car.vx *= -0.3; car.vy *= 0.8; }
    if (car.y < m) { car.y = m; car.vy *= -0.3; car.vx *= 0.8; }
    if (car.y > WORLD_H - m) { car.y = WORLD_H - m; car.vy *= -0.3; car.vx *= 0.8; }
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
      }
      this.resolveCollisions(events);
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
    catmullRomClosed, buildTrack, isOnTrack, computePhys,
    Car, World, aiInput, stepCar, checkGate,
  };

  global.IMR = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
