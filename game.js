/* =====================================================================
   IRON MAN OFFROAD RACING — moderní remake klasiky z DOSu
   Top-down závod pro dva hráče na jedné klávesnici.
   Čistý HTML5 Canvas + JS, bez závislostí.
   ===================================================================== */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

const TOTAL_LAPS = 3;

/* ---------- Stavy hry ---------- */
const STATE = { MENU: "menu", COUNTDOWN: "countdown", RACE: "race", FINISHED: "finished" };
let state = STATE.MENU;
let countdown = 0;       // sekundy do startu
let raceTime = 0;        // čas závodu v sekundách

/* =====================================================================
   TRAŤ — definovaná řídicími body, vyhlazená Catmull-Rom splajnem
   ===================================================================== */
const WAYPOINTS = [
  { x: 200, y: 150 },
  { x: 470, y: 110 },
  { x: 760, y: 140 },
  { x: 880, y: 300 },
  { x: 820, y: 470 },
  { x: 600, y: 470 },
  { x: 470, y: 560 },
  { x: 250, y: 540 },
  { x: 110, y: 360 },
];
const TRACK_WIDTH = 86;          // šířka cesty
const HALF_W = TRACK_WIDTH / 2;

function catmullRomClosed(points, samplesPerSeg) {
  const res = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    for (let t = 0; t < samplesPerSeg; t++) {
      const s = t / samplesPerSeg;
      const s2 = s * s;
      const s3 = s2 * s;
      const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * s +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3);
      const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * s +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3);
      res.push({ x, y });
    }
  }
  return res;
}

const CENTER = catmullRomClosed(WAYPOINTS, 24);   // hustá osa trati (uzavřená smyčka)

/* Branky pro počítání kol a pořadí — rovnoměrně po ose trati */
const GATE_COUNT = 24;
const GATE_RADIUS = 58;
const GATES = [];
for (let i = 0; i < GATE_COUNT; i++) {
  GATES.push(CENTER[Math.round((i / GATE_COUNT) * CENTER.length) % CENTER.length]);
}

/* Travnaté "skvrny" pro texturu pozadí (deterministicky, ať se nehýbou) */
const GRASS = [];
(function () {
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 90; i++) {
    GRASS.push({ x: rnd() * W, y: rnd() * H, r: 6 + rnd() * 22, a: 0.04 + rnd() * 0.06 });
  }
})();

/* ---------- Geometrie: vzdálenost bodu od úsečky ---------- */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* Je bod na trati (v dosahu osy)? */
function isOnTrack(x, y) {
  let best = Infinity;
  for (let i = 0; i < CENTER.length; i++) {
    const a = CENTER[i];
    const b = CENTER[(i + 1) % CENTER.length];
    const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
    if (d < best) best = d;
    if (best <= HALF_W) return true;
  }
  return best <= HALF_W;
}

/* =====================================================================
   AUTA
   ===================================================================== */
const PHYS = {
  accel: 0.16,
  reverseAccel: 0.12,
  maxSpeed: 4.3,
  offMaxSpeed: 1.7,
  friction: 0.965,
  offFriction: 0.90,
  turn: 0.052,
  nitroMax: 4.7,
  nitroBoost: 0.22,
};

class Car {
  constructor(color, name, keys) {
    this.color = color;
    this.name = name;
    this.keys = keys;
    this.reset(0, 0, 0);
  }
  reset(x, y, angle) {
    this.x = x; this.y = y;
    this.angle = angle;
    this.speed = 0;
    this.lap = 0;            // dokončená kola
    this.nextGate = 1;       // další branka, kterou má projet (start = branka 0)
    this.gatesPassed = 0;    // celkový počet projetých branek (pro pořadí)
    this.nitro = 100;        // zásoba nitra v %
    this.finished = false;
    this.finishTime = 0;
    this.rumble = 0;
  }

  get currentLap() {
    return Math.min(Math.floor(this.gatesPassed / GATE_COUNT) + 1, TOTAL_LAPS);
  }

  update(dt) {
    if (this.finished) {
      this.speed *= 0.9;
      this.x += Math.cos(this.angle) * this.speed;
      this.y += Math.sin(this.angle) * this.speed;
      return;
    }
    const k = this.keys;
    const onTrack = isOnTrack(this.x, this.y);

    const usingNitro = down(k.nitro) && this.nitro > 0 && down(k.up);
    let maxSpeed = onTrack ? PHYS.maxSpeed : PHYS.offMaxSpeed;
    let accel = PHYS.accel;
    if (usingNitro) {
      maxSpeed = PHYS.nitroMax;
      accel += PHYS.nitroBoost;
      this.nitro = Math.max(0, this.nitro - 0.8);
    } else {
      this.nitro = Math.min(100, this.nitro + 0.10);   // pomalá regenerace
    }

    if (down(k.up)) this.speed += accel;
    if (down(k.down)) this.speed -= PHYS.reverseAccel;

    // tření
    this.speed *= onTrack ? PHYS.friction : PHYS.offFriction;

    // omezení rychlosti
    if (this.speed > maxSpeed) this.speed = maxSpeed;
    if (this.speed < -PHYS.offMaxSpeed) this.speed = -PHYS.offMaxSpeed;

    // zatáčení (účinnější při vyšší rychlosti, podle směru jízdy)
    const steerFactor = Math.min(1, Math.abs(this.speed) / 1.5);
    const dir = this.speed >= 0 ? 1 : -1;
    if (down(k.left)) this.angle -= PHYS.turn * steerFactor * dir;
    if (down(k.right)) this.angle += PHYS.turn * steerFactor * dir;

    // off-road drncání
    this.rumble = (!onTrack && Math.abs(this.speed) > 0.5)
      ? (Math.random() - 0.5) * 1.6 : 0;

    // pohyb
    this.x += Math.cos(this.angle) * this.speed + this.rumble;
    this.y += Math.sin(this.angle) * this.speed + this.rumble;

    // hranice plátna — odraz s tlumením
    const m = 16;
    if (this.x < m) { this.x = m; this.speed *= 0.4; }
    if (this.x > W - m) { this.x = W - m; this.speed *= 0.4; }
    if (this.y < m) { this.y = m; this.speed *= 0.4; }
    if (this.y > H - m) { this.y = H - m; this.speed *= 0.4; }

    // průjezd brankami
    const g = GATES[this.nextGate];
    if (Math.hypot(this.x - g.x, this.y - g.y) < GATE_RADIUS) {
      this.nextGate = (this.nextGate + 1) % GATE_COUNT;
      this.gatesPassed++;
      if (this.gatesPassed >= TOTAL_LAPS * GATE_COUNT) {
        this.finished = true;
        this.finishTime = raceTime;
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // stín
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(ctx, -15, -8, 30, 16, 4); ctx.fill();

    // karoserie
    const grd = ctx.createLinearGradient(0, -9, 0, 9);
    grd.addColorStop(0, shade(this.color, 1.25));
    grd.addColorStop(1, shade(this.color, 0.7));
    ctx.fillStyle = grd;
    roundRect(ctx, -16, -9, 32, 18, 5); ctx.fill();

    // kabina / sklo
    ctx.fillStyle = "rgba(20,30,40,0.85)";
    roundRect(ctx, -2, -6, 9, 12, 3); ctx.fill();

    // přední maska
    ctx.fillStyle = shade(this.color, 1.5);
    roundRect(ctx, 11, -7, 4, 14, 2); ctx.fill();

    // kola
    ctx.fillStyle = "#16181a";
    roundRect(ctx, -12, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, -12, 7, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, 7, 7, 4, 2); ctx.fill();

    ctx.restore();

    // plamen nitra
    if (state === STATE.RACE && !this.finished &&
        down(this.keys.nitro) && this.nitro > 0 && down(this.keys.up)) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.angle);
      ctx.fillStyle = "rgba(255,150,40,0.9)";
      const fl = 10 + Math.random() * 10;
      ctx.beginPath();
      ctx.moveTo(-16, -4);
      ctx.lineTo(-16 - fl, 0);
      ctx.lineTo(-16, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,230,120,0.9)";
      ctx.beginPath();
      ctx.moveTo(-16, -2);
      ctx.lineTo(-16 - fl * 0.6, 0);
      ctx.lineTo(-16, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ---------- Pomocné kreslení ---------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/* =====================================================================
   KLÁVESY
   ===================================================================== */
const pressed = {};
const down = (code) => !!pressed[code];

const P1_KEYS = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", nitro: "ShiftLeft" };
const P2_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", nitro: "ShiftRight" };

const PREVENT = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight",
]);

window.addEventListener("keydown", (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  pressed[e.code] = true;
  if (e.code === "Enter" && state === STATE.MENU) startCountdown();
  if (e.code === "KeyR" && (state === STATE.RACE || state === STATE.FINISHED)) toMenu();
});
window.addEventListener("keyup", (e) => { pressed[e.code] = false; });

/* =====================================================================
   AUTA + START
   ===================================================================== */
const cars = [
  new Car("#e8473b", "Hráč 1", P1_KEYS),
  new Car("#3b82e8", "Hráč 2", P2_KEYS),
];

function placeCarsAtStart() {
  // směr trati u startu (branka 0 -> branka 1)
  const a = GATES[0], b = GATES[1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(ang), ny = Math.cos(ang);   // normála (do stran)
  cars[0].reset(a.x + nx * 16, a.y + ny * 16, ang);
  cars[1].reset(a.x - nx * 16, a.y - ny * 16, ang);
}

/* =====================================================================
   PŘECHODY STAVŮ
   ===================================================================== */
const overlay = document.getElementById("overlay");
const results = document.getElementById("results");

function toMenu() {
  state = STATE.MENU;
  overlay.classList.remove("hidden");
  results.classList.add("hidden");
}
function startCountdown() {
  placeCarsAtStart();
  raceTime = 0;
  countdown = 3.999;
  state = STATE.COUNTDOWN;
  overlay.classList.add("hidden");
  results.classList.add("hidden");
}
function finishRace() {
  state = STATE.FINISHED;
  const ranked = [...cars].sort((c1, c2) => c1.finishTime - c2.finishTime);
  const winner = ranked[0];
  document.getElementById("winnerTitle").textContent =
    `🏁 ${winner.name} vyhrává!`;
  document.getElementById("winnerTitle").style.color = winner.color;
  const box = document.getElementById("resultTimes");
  box.innerHTML = ranked.map((c, i) => {
    const cls = c === cars[0] ? "p1" : "p2";
    return `<div class="row ${cls}"><span>${i + 1}. ${c.name}</span>` +
           `<span>${formatTime(c.finishTime)}</span></div>`;
  }).join("");
  results.classList.remove("hidden");
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

document.getElementById("startBtn").addEventListener("click", startCountdown);
document.getElementById("againBtn").addEventListener("click", startCountdown);

/* =====================================================================
   AKTUALIZACE
   ===================================================================== */
function update(dt) {
  if (state === STATE.COUNTDOWN) {
    countdown -= dt;
    if (countdown <= 0) state = STATE.RACE;
  }
  if (state === STATE.RACE) {
    raceTime += dt;
    for (const c of cars) c.update(dt);
    resolveCarCollision();
    if (cars.every((c) => c.finished)) finishRace();
  }
}

/* Jemná srážka aut — odstrčení od sebe */
function resolveCarCollision() {
  const [a, b] = cars;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = 26;
  if (d > 0 && d < min) {
    const ovr = (min - d) / 2;
    const ux = dx / d, uy = dy / d;
    a.x -= ux * ovr; a.y -= uy * ovr;
    b.x += ux * ovr; b.y += uy * ovr;
    a.speed *= 0.85; b.speed *= 0.85;
  }
}

/* =====================================================================
   VYKRESLENÍ
   ===================================================================== */
function drawTrack() {
  // tráva (pozadí)
  ctx.fillStyle = "#2f5a37";
  ctx.fillRect(0, 0, W, H);
  for (const g of GRASS) {
    ctx.fillStyle = `rgba(20,60,30,${g.a})`;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // okraj trati (světlejší prach)
  drawTrackPath(TRACK_WIDTH + 14, "#6b5634");
  // hlína
  drawTrackPath(TRACK_WIDTH, "#8a6e42");
  // vyjeté koleje uprostřed
  drawTrackPath(TRACK_WIDTH - 34, "#7d6238");

  drawStartLine();
}

function drawTrackPath(width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(CENTER[0].x, CENTER[0].y);
  for (let i = 1; i < CENTER.length; i++) ctx.lineTo(CENTER[i].x, CENTER[i].y);
  ctx.closePath();
  ctx.stroke();
}

function drawStartLine() {
  const a = GATES[0], b = GATES[1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(ang + Math.PI / 2);
  const cols = 7, sq = TRACK_WIDTH / cols, depth = 16;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? "#f2f2f2" : "#1c1c1c";
      ctx.fillRect(-TRACK_WIDTH / 2 + i * sq, -depth / 2 + j * (depth / 2), sq, depth / 2);
    }
  }
  ctx.restore();
}

function drawHUD() {
  // panely hráčů
  drawPlayerHUD(cars[0], 16, 16, "left");
  drawPlayerHUD(cars[1], W - 16, 16, "right");

  // čas závodu
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundRect(ctx, W / 2 - 70, 12, 140, 34, 8); ctx.fill();
  ctx.fillStyle = "#f6c544";
  ctx.font = "bold 22px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatTime(raceTime), W / 2, 30);

  // pořadí (kdo vede)
  const lead = leader();
  if (lead) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    roundRect(ctx, W / 2 - 70, 50, 140, 24, 6); ctx.fill();
    ctx.fillStyle = lead.color;
    ctx.font = "bold 14px 'Segoe UI', sans-serif";
    ctx.fillText(`▲ ${lead.name} vede`, W / 2, 62);
  }
}

function progressOf(c) { return c.gatesPassed; }
function leader() {
  if (cars[0].gatesPassed === cars[1].gatesPassed) return null;
  return cars[0].gatesPassed > cars[1].gatesPassed ? cars[0] : cars[1];
}

function drawPlayerHUD(c, x, y, align) {
  const w = 184, h = 64;
  const px = align === "left" ? x : x - w;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  roundRect(ctx, px, y, w, h, 10); ctx.fill();
  ctx.fillStyle = c.color;
  roundRect(ctx, px, y, 6, h, 3); ctx.fill();

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = c.color;
  ctx.font = "bold 15px 'Segoe UI', sans-serif";
  ctx.fillText(c.name, px + 14, y + 8);

  ctx.fillStyle = "#fff";
  ctx.font = "13px 'Segoe UI', sans-serif";
  ctx.fillText(`Kolo ${c.currentLap}/${TOTAL_LAPS}`, px + 14, y + 28);

  // nitro pruh
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  roundRect(ctx, px + 14, y + 46, w - 28, 9, 4); ctx.fill();
  ctx.fillStyle = "#f6c544";
  roundRect(ctx, px + 14, y + 46, (w - 28) * (c.nitro / 100), 9, 4); ctx.fill();
  ctx.fillStyle = "#cfd8cf";
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("NITRO", px + w - 14, y + 33);
}

function drawCountdown() {
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, W, H);
  const n = Math.ceil(countdown - 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f6c544";
  if (n > 0) {
    ctx.font = "bold 160px 'Segoe UI', sans-serif";
    ctx.fillText(n, W / 2, H / 2);
  } else {
    ctx.font = "bold 120px 'Segoe UI', sans-serif";
    ctx.fillText("START!", W / 2, H / 2);
  }
}

function render() {
  drawTrack();
  for (const c of cars) c.draw(ctx);

  if (state === STATE.RACE || state === STATE.COUNTDOWN || state === STATE.FINISHED) {
    drawHUD();
  }
  if (state === STATE.COUNTDOWN) drawCountdown();
}

/* =====================================================================
   HLAVNÍ SMYČKA
   ===================================================================== */
let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;     // ochrana proti velkým skokům
  update(dt);
  render();
  requestAnimationFrame(loop);
}

placeCarsAtStart();
requestAnimationFrame(loop);
