/* =====================================================================
   IRON MAN OFFROAD RACING — KLIENT (main.js)
   Vstup z klávesnice, vykreslování, UI a herní smyčka.
   Simulaci pohání modul sim.js (window.IMR).
   ===================================================================== */
(function () {
  "use strict";
  const IMR = window.IMR;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = IMR.WORLD_W, H = IMR.WORLD_H;
  const FIXED_DT = IMR.FIXED_DT;
  const TOTAL_LAPS = 3;

  /* ---------------- Kamera / 2.5D perspektiva (~75°) ---------------- */
  const TILT = 0.74;        // svislé stlačení (1 = shora, méně = nakloněnější pohled)
  const WALL_H = 16;        // výška mantinelu (svět px) pro plastický 3D dojem
  let camS = 1, camOffX = 0, camOffY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  function computeCamera() {
    camS = Math.min(canvas.width / W, canvas.height / (H * TILT + WALL_H * 2));
    camOffX = (canvas.width - W * camS) / 2;
    camOffY = (canvas.height - H * TILT * camS) / 2 + WALL_H * camS;
  }
  function setGround() { ctx.setTransform(camS, 0, 0, camS * TILT, camOffX, camOffY); }   // zem (stlačená)
  function setHud() { ctx.setTransform(camS, 0, 0, camS, camOffX, camOffY); }             // HUD (bez stlačení)
  function projX(x) { return camOffX + x * camS; }
  function projY(y) { return camOffY + y * camS * TILT; }
  window.addEventListener("resize", resize);
  resize();

  /* ---------------- Částicové efekty (prach, bláto, nitro) ---------------- */
  const particles = [];
  function spawnParticle(x, y, vx, vy, life, size, color) {
    if (particles.length > 320) return;
    particles.push({ x, y, vx, vy, life, max: life, size, color });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(projX(p.x), projY(p.y), p.size * camS * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // efekty za autem: nitro jiskry, bahno/voda, prach
  function spawnCarFx(track, x, y, angle, speed, boosting) {
    const bx = x - Math.cos(angle) * 15, by = y - Math.sin(angle) * 15;
    const surf = IMR.surfaceAt(track, x, y);
    if (boosting) {
      for (let i = 0; i < 2; i++)
        spawnParticle(bx, by, -Math.cos(angle) * 1.2 + (Math.random() - 0.5), -Math.sin(angle) * 1.2 + (Math.random() - 0.5),
          0.4, 5 + Math.random() * 4, Math.random() < 0.5 ? "#ffd24a" : "#ff7a1a");
    }
    if (surf.rough && speed > 0.6) {
      const water = surf.speed < 0.55;
      for (let i = 0; i < 2; i++)
        spawnParticle(bx, by, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
          0.5, 4 + Math.random() * 4, water ? "#9fd0e8" : "#6b4a28");
    } else if (speed > 2.2 && Math.random() < 0.5) {
      spawnParticle(bx, by, (Math.random() - 0.5), (Math.random() - 0.5), 0.4, 4, "rgba(190,170,130,0.7)");
    }
  }

  const Sound = window.Sound;
  const STATE = { MENU: "menu", COUNTDOWN: "countdown", RACE: "race", FINISHED: "finished" };
  let state = STATE.MENU;
  let countdown = 0;
  let lastCountInt = 4;       // pro odpočtové pípnutí
  let world = null;
  let selectedTrack = 0;
  let finishPlayed = false;

  /* ---------------- Klávesy ---------------- */
  const pressed = {};
  const down = (c) => !!pressed[c];
  const P1_KEYS = { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", nitro: "ShiftLeft" };
  const P2_KEYS = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", nitro: "ShiftRight" };
  const PREVENT = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
    "KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"]);

  window.addEventListener("keydown", (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    Sound.init();   // odemkne audio po prvním gestu
    pressed[e.code] = true;
    if (e.code === "Enter" && !inOnline) {
      if (state === STATE.MENU) startGame();
      else if (state === STATE.FINISHED) {
        if (!shop.classList.contains("hidden")) nextChampRace();
        else doResultsAction();
      }
    }
    if (e.code === "KeyR" && !inOnline && !netGame.active &&
        (state === STATE.RACE || state === STATE.FINISHED)) toMenu();
    if (e.code === "KeyM") updateMuteBtn(Sound.toggleMute());
    if (e.code === "KeyF") toggleFullscreen();
  });
  window.addEventListener("keyup", (e) => { pressed[e.code] = false; });

  function inputFor(keys) {
    return { up: down(keys.up), down: down(keys.down), left: down(keys.left), right: down(keys.right), nitro: down(keys.nitro) };
  }

  /* ---------------- Konfigurace závodu ---------------- */
  let gameMode = "quick";     // "quick" | "champ"
  let humanCount = 2;
  let aiCount = 0;
  let aiDifficulty = "normal";
  const CHAMP_RACES = 5;
  const PAYOUT = [700, 450, 300, 200, 120, 80];   // peníze dle umístění
  let champ = null;           // stav šampionátu
  let resultsAction = "again";
  const AI_SKILL = { easy: 0.62, normal: 0.82, hard: 0.96 };
  const AI_COLORS = ["#f59e0b", "#34c759", "#a855f7", "#22d3ee"];
  const AI_NAMES = ["CPU Rudák", "CPU Bleskoun", "CPU Drtič", "CPU Liška"];

  const HUMAN_CONTROLLERS = [
    { id: "p1", keys: P1_KEYS, color: "#e8473b", name: "Hráč 1" },
    { id: "p2", keys: P2_KEYS, color: "#3b82e8", name: "Hráč 2" },
  ];

  function activeControllers() { return HUMAN_CONTROLLERS.slice(0, humanCount); }

  function aiUpgradeLevel(raceIndex) { return Math.min(3, Math.floor(raceIndex * 0.8)); }

  /* ---------------- Sestavení aut ---------------- */
  function makeCars() {
    const cars = activeControllers().map((ctrl) => {
      const car = new IMR.Car({ id: ctrl.id, color: ctrl.color, name: ctrl.name });
      if (champ) car.setUpgrades(champ.players[ctrl.id].upgrades);
      return car;
    });
    for (let i = 0; i < aiCount; i++) {
      const car = new IMR.Car({
        id: "ai" + i, color: AI_COLORS[i % AI_COLORS.length], name: AI_NAMES[i % AI_NAMES.length],
        isAI: true, aiSkill: AI_SKILL[aiDifficulty],
      });
      if (champ) {
        const lvl = aiUpgradeLevel(champ.raceIndex);
        car.setUpgrades({ engine: lvl, accel: lvl, tires: lvl, nitro: lvl });
      }
      cars.push(car);
    }
    return cars;
  }

  /* ---------------- Stavy ---------------- */
  const overlay = document.getElementById("overlay");
  const results = document.getElementById("results");

  function toMenu() {
    state = STATE.MENU;
    Sound.stopAllEngines();
    overlay.classList.remove("hidden");
    results.classList.add("hidden");
  }

  function updateMuteBtn(muted) {
    const b = document.getElementById("muteBtn");
    if (b) b.textContent = muted ? "🔇" : "🔊";
  }

  const shop = document.getElementById("shop");

  function startGame() {
    Sound.init();
    if (gameMode === "champ") startChampionship();
    else { champ = null; beginRace(IMR.TRACKS[selectedTrack]); }
  }

  function beginRace(trackDef) {
    world = new IMR.World(trackDef, makeCars(), TOTAL_LAPS);
    world.running = false;
    countdown = 3.999;
    lastCountInt = 4;
    finishPlayed = false;
    state = STATE.COUNTDOWN;
    overlay.classList.add("hidden");
    results.classList.add("hidden");
    shop.classList.add("hidden");
  }

  /* ---------------- Šampionát ---------------- */
  function startChampionship() {
    const n = IMR.TRACKS.length;
    const trackOrder = [];
    for (let i = 0; i < CHAMP_RACES; i++) trackOrder.push((selectedTrack + i) % n);
    const players = {};
    for (const ctrl of activeControllers())
      players[ctrl.id] = { name: ctrl.name, color: ctrl.color, money: 0, upgrades: { engine: 0, accel: 0, tires: 0, nitro: 0 } };
    const wins = {};
    const participants = activeControllers().map((c) => ({ id: c.id, name: c.name, color: c.color }));
    for (const c of activeControllers()) wins[c.id] = 0;
    for (let i = 0; i < aiCount; i++) {
      wins["ai" + i] = 0;
      participants.push({ id: "ai" + i, name: AI_NAMES[i % AI_NAMES.length], color: AI_COLORS[i % AI_COLORS.length] });
    }
    champ = { raceIndex: 0, totalRaces: CHAMP_RACES, trackOrder, players, wins, participants };
    beginRace(IMR.TRACKS[trackOrder[0]]);
  }

  function awardChampionship(ranked) {
    ranked.forEach((c, i) => {
      const p = champ.players[c.id];
      if (p) p.money += (PAYOUT[i] != null ? PAYOUT[i] : 60) + (c.cashBonus || 0);  // umístění + sebrané peníze
    });
    champ.wins[ranked[0].id] = (champ.wins[ranked[0].id] || 0) + 1;
  }

  function finishRace() {
    state = STATE.FINISHED;
    Sound.stopAllEngines();
    for (const c of world.cars) Sound.setNitro(c.id, false);
    const ranked = world.ranking();

    if (champ) {
      awardChampionship(ranked);
      champ.raceIndex++;
      if (champ.raceIndex < champ.totalRaces) { showShop(ranked); return; }
      showFinalStandings(ranked);
      return;
    }
    showQuickResults(ranked);
  }

  function showQuickResults(ranked) {
    const winner = ranked[0];
    document.getElementById("winnerTitle").textContent = `🏁 ${winner.name} vyhrává!`;
    document.getElementById("winnerTitle").style.color = winner.color;
    document.getElementById("againBtn").textContent = "ZÁVODIT ZNOVU";
    resultsAction = "again";
    const box = document.getElementById("resultTimes");
    box.innerHTML = ranked.map((c, i) =>
      `<div class="row" style="color:${c.color}"><span>${i + 1}. ${c.name}</span>` +
      `<span>${c.finished ? formatTime(c.finishTime) : "—"}</span></div>`).join("");
    results.classList.remove("hidden");
  }

  function showFinalStandings(ranked) {
    const standings = [...champ.participants].sort((a, b) => (champ.wins[b.id] || 0) - (champ.wins[a.id] || 0));
    const champion = standings[0];
    document.getElementById("winnerTitle").textContent = `🏆 Šampion: ${champion.name}`;
    document.getElementById("winnerTitle").style.color = champion.color;
    document.getElementById("againBtn").textContent = "ZPĚT DO MENU";
    resultsAction = "menu";
    const box = document.getElementById("resultTimes");
    box.innerHTML = standings.map((p, i) =>
      `<div class="row" style="color:${p.color}"><span>${i + 1}. ${p.name}</span>` +
      `<span>${champ.wins[p.id] || 0}× 🥇</span></div>`).join("");
    results.classList.remove("hidden");
  }

  /* ---------------- Obchod ---------------- */
  function showShop(ranked) {
    state = STATE.FINISHED;
    document.getElementById("shopTitle").textContent =
      `OBCHOD — závod ${champ.raceIndex}/${champ.totalRaces} hotov`;
    const winLine = `Závod vyhrál ${ranked[0].name}. Utrať výhru za vylepšení!`;
    document.getElementById("shopSub").textContent = winLine;
    renderShop();
    shop.classList.remove("hidden");
    results.classList.add("hidden");
  }

  function renderShop() {
    const wrap = document.getElementById("shopPlayers");
    wrap.innerHTML = "";
    for (const ctrl of activeControllers()) {
      const p = champ.players[ctrl.id];
      const col = document.createElement("div");
      col.className = "shop-col";
      let html = `<div class="shop-name" style="color:${p.color}">${p.name}</div>` +
        `<div class="shop-money">💰 ${p.money}</div>`;
      for (const key of Object.keys(IMR.UPGRADE_DEFS)) {
        const def = IMR.UPGRADE_DEFS[key];
        const lvl = p.upgrades[key];
        const dots = Array.from({ length: def.max }, (_, i) =>
          `<span class="dot ${i < lvl ? "on" : ""}"></span>`).join("");
        let action;
        if (lvl >= def.max) action = `<span class="maxed">MAX</span>`;
        else {
          const cost = def.cost[lvl + 1];
          const afford = p.money >= cost;
          action = `<button class="buy-btn" data-pid="${ctrl.id}" data-key="${key}" ${afford ? "" : "disabled"}>${cost} 💰</button>`;
        }
        html += `<div class="shop-item"><div class="shop-item-top"><b>${def.name}</b>${action}</div>` +
          `<div class="dots">${dots}</div><div class="shop-desc">${def.desc}</div></div>`;
      }
      col.innerHTML = html;
      wrap.appendChild(col);
    }
    wrap.querySelectorAll(".buy-btn").forEach((b) => b.addEventListener("click", () => {
      buyUpgrade(b.dataset.pid, b.dataset.key);
    }));
  }

  function buyUpgrade(pid, key) {
    const p = champ.players[pid];
    const def = IMR.UPGRADE_DEFS[key];
    const lvl = p.upgrades[key];
    if (lvl >= def.max) return;
    const cost = def.cost[lvl + 1];
    if (p.money < cost) return;
    p.money -= cost;
    p.upgrades[key] = lvl + 1;
    Sound.countdownTick(2);   // krátké cinknutí
    renderShop();
  }

  function nextChampRace() {
    beginRace(IMR.TRACKS[champ.trackOrder[champ.raceIndex]]);
  }

  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  }

  /* ---------------- Výběr trati (UI) ---------------- */
  function buildTrackSelect() {
    const wrap = document.getElementById("trackSelect");
    if (!wrap) return;
    wrap.innerHTML = "";
    IMR.TRACKS.forEach((t, i) => {
      const btn = document.createElement("button");
      btn.className = "track-btn" + (i === selectedTrack ? " active" : "");
      btn.innerHTML = `<span class="t-name">${t.name}</span><span class="t-diff">${t.difficulty}</span>`;
      btn.addEventListener("click", () => {
        selectedTrack = i;
        [...wrap.children].forEach((c, k) => c.classList.toggle("active", k === i));
      });
      wrap.appendChild(btn);
    });
  }

  /* ---------------- Generátor přepínačů voleb ---------------- */
  function buildOptionGroup(containerId, options, getVal, setVal) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "opt-btn" + (opt.value === getVal() ? " active" : "");
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        setVal(opt.value);
        [...wrap.children].forEach((c, k) => c.classList.toggle("active", options[k].value === getVal()));
      });
      wrap.appendChild(btn);
    });
  }

  function buildOptionUI() {
    buildOptionGroup("modeSelect",
      [{ label: "🏁 Rychlý závod", value: "quick" }, { label: "🏆 Šampionát (5 závodů + obchod)", value: "champ" }],
      () => gameMode, (v) => { gameMode = v; });
    buildOptionGroup("humanSelect",
      [{ label: "1", value: 1 }, { label: "2", value: 2 }],
      () => humanCount, (v) => { humanCount = v; });
    buildOptionGroup("aiSelect",
      [0, 1, 2, 3, 4].map((n) => ({ label: String(n), value: n })),
      () => aiCount, (v) => { aiCount = v; });
    buildOptionGroup("aiDiffSelect",
      [{ label: "Snadní", value: "easy" }, { label: "Normální", value: "normal" }, { label: "Těžcí", value: "hard" }],
      () => aiDifficulty, (v) => { aiDifficulty = v; });
  }

  function doResultsAction() {
    if (resultsAction === "online-again") { results.classList.add("hidden"); Net.again(); }
    else if (resultsAction === "online-leave") { results.classList.add("hidden"); leaveOnline(); }
    else if (resultsAction === "menu") toMenu();
    else startGame();
  }

  document.getElementById("startBtn").addEventListener("click", startGame);
  document.getElementById("againBtn").addEventListener("click", doResultsAction);
  document.getElementById("nextRaceBtn").addEventListener("click", nextChampRace);
  document.getElementById("muteBtn").addEventListener("click", () => {
    Sound.init();
    updateMuteBtn(Sound.toggleMute());
  });

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    }
  }
  document.getElementById("fsBtn").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => setTimeout(resize, 60));

  /* ---------------- Aktualizace ---------------- */
  let acc = 0;
  function update(dt) {
    updateParticles(dt);
    if (netGame.active) { updateOnline(dt); return; }
    if (state === STATE.COUNTDOWN) {
      countdown -= dt;
      const ci = Math.ceil(countdown - 1);   // 3,2,1,0(=GO)
      if (ci < lastCountInt && ci >= 0) { Sound.countdownTick(ci); lastCountInt = ci; }
      if (countdown <= 1 && !world.running) world.running = true;  // "START!" = jede se
      if (countdown <= 0) state = STATE.RACE;
    }
    if (state === STATE.RACE || (state === STATE.COUNTDOWN && world.running)) {
      const inputs = {};
      for (const ctrl of activeControllers()) inputs[ctrl.id] = inputFor(ctrl.keys);
      acc += dt;
      let guard = 0;
      let collided = false;
      while (acc >= FIXED_DT && guard++ < 6) {
        const events = world.tick(inputs);
        for (const ev of events) {
          if (ev.type === "collision") collided = true;
          if (ev.type === "pickup") Sound.pickup(ev.kind);
          if (ev.type === "finish" && !finishPlayed) { Sound.finishFanfare(); finishPlayed = true; }
        }
        acc -= FIXED_DT;
      }
      if (collided) Sound.collision();
      for (const c of world.cars) if (!c.finished) spawnCarFx(world.track, c.x, c.y, c.angle, Math.abs(c.speed), c.boosting);
      updateEngineSounds();
      if (state === STATE.RACE && world.allFinished()) finishRace();
    }
  }

  function updateEngineSounds() {
    for (const c of world.cars) {
      if (c.isAI || c.remote) continue;   // zvuk motoru jen pro místní hráče
      const ratio = Math.min(1, Math.abs(c.speed) / c.phys.maxSpeed);
      Sound.updateEngine(c.id, ratio, !c.finished);
      Sound.setNitro(c.id, c.boosting);
    }
  }

  /* ---------------- Vykreslení ---------------- */
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // statické travnaté skvrny (deterministicky)
  const GRASS = [];
  (function () {
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 90; i++) GRASS.push({ x: rnd() * W, y: rnd() * H, r: 6 + rnd() * 22, a: 0.05 + rnd() * 0.06 });
  })();

  function drawBackdrop() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, "#10180f"); g.addColorStop(1, "#050805");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGround(track) {
    const th = track.theme;
    ctx.fillStyle = th.grass;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    for (const g of GRASS) {
      ctx.fillStyle = hexA(th.grassDark, g.a);
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
    }
    const w = track.width;
    // plastický vyhloubený profil cesty: stín -> tmavé okraje -> hlína -> nasvícený střed
    strokePath(track.center, w + 26, "rgba(0,0,0,0.28)");          // měkký stín
    strokePath(track.center, w + 4, shade(th.dirt, 0.55));         // tmavý sráz okraje
    strokePath(track.center, w, shade(th.dirt, 0.74));
    strokePath(track.center, w - 16, th.dirt);                     // hlína
    strokePath(track.center, w - 42, shade(th.dirt, 1.14));        // nasvícený střed
    strokePath(track.center, Math.max(6, w - 80), shade(th.rut, 1.2));
    drawDirtTexture(track);                                        // hrudky / koleje
    drawTerrain(track);                                            // bláto / louže
    drawStartLine(track);
  }

  // deterministická textura na trati (hrudky, koleje) pro plastičtější povrch
  function drawDirtTexture(track) {
    const C = track.center, th = track.theme;
    for (let i = 0; i < C.length; i += 3) {
      const p = C[i];
      const seed = (i * 928371) % 1000 / 1000;
      const off = (seed - 0.5) * (track.width - 30);
      const q = C[(i + 1) % C.length];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const x = p.x + nx * off, y = p.y + ny * off;
      ctx.fillStyle = seed > 0.5 ? "rgba(0,0,0,0.10)" : hexA(th.rut, 0.18);
      ctx.beginPath(); ctx.ellipse(x, y, 5 + seed * 5, 3 + seed * 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // bod posunutý kolmo k trati o vzdálenost d
  function offsetPath(center, d) {
    const n = center.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = center[i], q = center[(i + 1) % n];
      const dx = q.x - p.x, dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      out.push({ x: p.x + (-dy / len) * d, y: p.y + (dx / len) * d });
    }
    return out;
  }
  function strokePoly(pts, width, color, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round"; ctx.lineCap = "butt";
    if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  // Vyvýšené červeno-bílé mantinely jako v originále (3D zdi s výškou)
  function drawBarrierWalls(track) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const off = track.width / 2 + 6;
    const wallPx = WALL_H * camS;
    const quads = [];
    for (const sgn of [1, -1]) {
      const edge = offsetPath(track.center, off * sgn);
      for (let i = 0; i < edge.length; i++) {
        const p = edge[i], q = edge[(i + 1) % edge.length];
        const bx0 = projX(p.x), by0 = projY(p.y), bx1 = projX(q.x), by1 = projY(q.y);
        quads.push({ bx0, by0, bx1, by1, i, ykey: Math.max(by0, by1) });
      }
    }
    quads.sort((a, b) => a.ykey - b.ykey);   // painter: vzdálené (nahoře) první
    for (const q of quads) {
      const stripe = Math.floor(q.i / 4) % 2 === 0;
      const face = stripe ? "#b5302a" : "#c9c6bd";
      const top = stripe ? "#e0463c" : "#f2efe7";
      // boční stěna
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.moveTo(q.bx0, q.by0); ctx.lineTo(q.bx1, q.by1);
      ctx.lineTo(q.bx1, q.by1 - wallPx); ctx.lineTo(q.bx0, q.by0 - wallPx);
      ctx.closePath(); ctx.fill();
      // horní hrana (osvětlená)
      ctx.strokeStyle = top; ctx.lineWidth = Math.max(2, 3 * camS); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(q.bx0, q.by0 - wallPx); ctx.lineTo(q.bx1, q.by1 - wallPx); ctx.stroke();
    }
  }

  function drawTerrain(track) {
    for (const z of track.terrain) {
      const water = z.type === "water";
      ctx.save();
      // tmavý důlek (vyhloubení)
      ctx.beginPath(); ctx.arc(z.x, z.y + 2, z.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill();
      // hladina / bahno
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r * 0.92, 0, Math.PI * 2);
      const grd = ctx.createRadialGradient(z.x - z.r * 0.3, z.y - z.r * 0.3, z.r * 0.1, z.x, z.y, z.r);
      if (water) { grd.addColorStop(0, "#5b9fc4"); grd.addColorStop(1, "#1f4f6b"); }
      else { grd.addColorStop(0, "#6b4a28"); grd.addColorStop(1, "#3a2814"); }
      ctx.fillStyle = grd; ctx.fill();
      // odlesk
      ctx.beginPath(); ctx.ellipse(z.x - z.r * 0.3, z.y - z.r * 0.35, z.r * 0.34, z.r * 0.2, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = water ? "rgba(200,230,245,0.4)" : "rgba(130,95,55,0.5)";
      ctx.fill();
      ctx.restore();
    }
  }

  // balíčky odměn na trati
  const PICKUP_STYLE = {
    nitro: { c: "#3bb0ff", t: "🔥", label: "N" },
    money: { c: "#f6c544", t: "$", label: "$" },
    tires: { c: "#222", t: "◎", label: "T" },
    accel: { c: "#34c759", t: "⚡", label: "»" },
  };
  function drawPickups(list) {
    if (!list) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const now = Date.now();
    for (const p of list) {
      if (p.active === false) continue;
      const st = PICKUP_STYLE[p.type] || PICKUP_STYLE.money;
      // nitro výrazně poskakuje, ostatní jemně
      const amp = p.type === "nitro" ? 9 : 4;
      const bob = Math.abs(Math.sin(now / 300 + (p.id || 0))) * amp;
      const sx = projX(p.x), sy = projY(p.y);
      const r = 13 * camS;
      // stín na zemi
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.8, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      // tělo balíčku (vznáší se + poskakuje)
      const cy = sy - (16 + bob) * camS;
      ctx.fillStyle = st.c;
      ctx.beginPath(); ctx.arc(sx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2.5 * camS; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.stroke();
      // lesk
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.arc(sx - r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.type === "nitro" || p.type === "tires" ? "#fff" : "#1a1205";
      ctx.font = `bold ${Math.round(15 * camS)}px 'Segoe UI', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(st.label, sx, cy + camS);
    }
  }
  function strokePath(center, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(center[0].x, center[0].y);
    for (let i = 1; i < center.length; i++) ctx.lineTo(center[i].x, center[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  function drawStartLine(track) {
    const g = track.gates[0];
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.dirAngle + Math.PI / 2);
    const cols = 7, sq = track.width / cols, depth = 16;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? "#f2f2f2" : "#1c1c1c";
        ctx.fillRect(-track.width / 2 + i * sq, -depth / 2 + j * (depth / 2), sq, depth / 2);
      }
    ctx.restore();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Auto jako billboard: poloha promítnutá perspektivou, sprite bez zkreslení,
  // natočený podle zdánlivého (stlačeného) směru. Stín na zemi + lehká výška.
  function drawCar(c) {
    const sx = projX(c.x), sy = projY(c.y);
    const appAngle = Math.atan2(Math.sin(c.angle) * TILT, Math.cos(c.angle));
    const lift = 5 * camS;   // mírné nadzvednutí (3D dojem)

    // stín na zemi
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath(); ctx.ellipse(sx, sy + 2 * camS, 17 * camS, 9 * camS, 0, 0, Math.PI * 2); ctx.fill();

    // plamen nitra (za autem, pod karoserií)
    if (c.boosting) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(sx, sy - lift); ctx.rotate(appAngle); ctx.scale(camS, camS);
      const fl = 12 + Math.random() * 12;
      ctx.fillStyle = "rgba(255,150,40,0.9)";
      ctx.beginPath(); ctx.moveTo(-16, -5); ctx.lineTo(-16 - fl, 0); ctx.lineTo(-16, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,235,140,0.95)";
      ctx.beginPath(); ctx.moveTo(-16, -3); ctx.lineTo(-16 - fl * 0.6, 0); ctx.lineTo(-16, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // karoserie
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(sx, sy - lift); ctx.rotate(appAngle); ctx.scale(camS, camS);
    ctx.fillStyle = "#16181a";
    roundRect(ctx, -12, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, -12, 7, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, 7, 7, 4, 2); ctx.fill();
    const grd = ctx.createLinearGradient(0, -9, 0, 9);
    grd.addColorStop(0, shade(c.color, 1.3));
    grd.addColorStop(1, shade(c.color, 0.65));
    ctx.fillStyle = grd;
    roundRect(ctx, -16, -9, 32, 18, 5); ctx.fill();
    ctx.fillStyle = "rgba(20,30,40,0.85)";
    roundRect(ctx, -2, -6, 9, 12, 3); ctx.fill();
    ctx.fillStyle = shade(c.color, 1.6);
    roundRect(ctx, 11, -7, 4, 14, 2); ctx.fill();
    ctx.restore();

    // jmenovka
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = c.color;
    ctx.font = `bold ${Math.round(12 * camS)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(c.isAI ? "CPU" : c.name, sx, sy - lift - 17 * camS);
  }

  function drawHUD() {
    const cars = world.cars;
    const players = cars.filter((c) => !c.isAI);
    if (players[0]) drawPlayerHUD(players[0], 16, 16, "left");
    if (players[1]) drawPlayerHUD(players[1], W - 16, 16, "right");

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, W / 2 - 70, 12, 140, 34, 8); ctx.fill();
    ctx.fillStyle = "#f6c544";
    ctx.font = "bold 22px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(formatTime(world.time), W / 2, 30);

    if (champ) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(ctx, W / 2 - 50, 76, 100, 22, 6); ctx.fill();
      ctx.fillStyle = "#cfd8cf";
      ctx.font = "bold 12px 'Segoe UI', sans-serif";
      ctx.fillText(`🏆 Závod ${champ.raceIndex + 1}/${champ.totalRaces}`, W / 2, 87);
    }

    const rank = world.ranking();
    if (rank.length && (rank[0].lapGates !== (rank[1] ? rank[1].lapGates : -1))) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(ctx, W / 2 - 75, 50, 150, 24, 6); ctx.fill();
      ctx.fillStyle = rank[0].color;
      ctx.font = "bold 14px 'Segoe UI', sans-serif";
      ctx.fillText(`▲ ${rank[0].isAI ? "CPU" : rank[0].name} vede`, W / 2, 62);
    }
  }
  function drawPlayerHUD(c, x, y, align) {
    const w = 184, h = 64;
    const px = align === "left" ? x : x - w;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(ctx, px, y, w, h, 10); ctx.fill();
    ctx.fillStyle = c.color;
    roundRect(ctx, px, y, 6, h, 3); ctx.fill();
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = c.color;
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText(c.name, px + 14, y + 8);
    ctx.fillStyle = "#fff";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.fillText(`Kolo ${c.currentLap(TOTAL_LAPS)}/${TOTAL_LAPS}`, px + 14, y + 28);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    roundRect(ctx, px + 14, y + 46, w - 28, 9, 4); ctx.fill();
    ctx.fillStyle = "#f6c544";
    const tank = c.phys.nitroTank;
    roundRect(ctx, px + 14, y + 46, (w - 28) * Math.max(0, c.nitro / tank), 9, 4); ctx.fill();
    ctx.fillStyle = "#cfd8cf";
    ctx.font = "10px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
    ctx.fillText("NITRO", px + w - 14, y + 33);
  }

  function drawCountdown(value) {
    setHud();
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, H * TILT);
    const n = Math.ceil(value - 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f6c544";
    const cy = H * TILT / 2;
    if (n > 0) { ctx.font = "bold 150px 'Segoe UI', sans-serif"; ctx.fillText(n, W / 2, cy); }
    else { ctx.font = "bold 110px 'Segoe UI', sans-serif"; ctx.fillText("START!", W / 2, cy); }
  }

  // společné vykreslení scény (zem, mantinely, balíčky, auta) v perspektivě
  function drawScene(track, carList, pickups) {
    drawBackdrop();
    computeCamera();
    setGround(); drawGround(track);
    drawBarrierWalls(track);                 // 3D mantinely (vlastní transform)
    drawParticles();                         // prach/bahno/nitro (na zemi)
    drawPickups(pickups);                    // billboardy
    const sorted = [...carList].sort((a, b) => a.y - b.y);   // painter podle hloubky
    for (const c of sorted) drawCar(c);
  }

  function render() {
    if (netGame.active) { renderOnline(); return; }
    if (!world) {
      drawScene(IMR.buildTrack(IMR.TRACKS[selectedTrack]), [], []);   // náhled v menu
      return;
    }
    drawScene(world.track, world.cars, world.pickups);
    setHud(); drawHUD();
    if (state === STATE.COUNTDOWN) drawCountdown(countdown);
  }

  /* =====================================================================
     ONLINE REŽIM (síťový multiplayer)
     ===================================================================== */
  const Net = window.Net;
  let inOnline = false;            // je otevřené online překrytí?
  const netGame = {
    active: false, track: null, laps: 3, gateCount: IMR.GATE_COUNT,
    meta: {}, cars: {}, disp: {}, pickups: [], phase: "countdown", time: 0, countdown: 0,
    lastInputStr: "", lastCountInt: 4, lobby: null,
  };

  const onlineOverlay = document.getElementById("online");
  const onlineConnect = document.getElementById("onlineConnect");
  const onlineLobby = document.getElementById("onlineLobby");

  function openOnline() {
    inOnline = true;
    overlay.classList.add("hidden");
    results.classList.add("hidden");
    onlineConnect.classList.remove("hidden");
    onlineLobby.classList.add("hidden");
    document.getElementById("netError").textContent = "";
    onlineOverlay.classList.remove("hidden");
    Sound.init();
    if (!Net.connected) Net.connect();
  }

  function leaveOnline() {
    Net.close();
    inOnline = false;
    netGame.active = false;
    Sound.stopAllEngines();
    onlineOverlay.classList.add("hidden");
    overlay.classList.remove("hidden");
  }

  /* ----- síťové události ----- */
  Net.on("error", (m) => {
    const el = document.getElementById("netError");
    if (el) el.textContent = m.msg || "Chyba spojení.";
  });
  Net.on("close", () => {
    if (netGame.active || inOnline) {
      const el = document.getElementById("netError");
      if (el) el.textContent = "Spojení se serverem bylo přerušeno.";
    }
  });

  Net.on("lobby", (m) => {
    netGame.lobby = m;
    netGame.active = false;
    state = STATE.MENU;
    Sound.stopAllEngines();
    inOnline = true;
    onlineOverlay.classList.remove("hidden");
    onlineConnect.classList.add("hidden");
    results.classList.add("hidden");
    onlineLobby.classList.remove("hidden");
    renderLobby(m);
  });

  Net.on("raceStart", (m) => {
    netGame.track = IMR.buildTrack(IMR.TRACKS[m.trackIndex] || IMR.TRACKS[0]);
    netGame.laps = m.laps;
    netGame.meta = {};
    for (const c of m.cars) netGame.meta[c.id] = { name: c.name, color: c.color, isAI: c.isAI };
    netGame.cars = {}; netGame.disp = {}; netGame.pickups = [];
    netGame.phase = "countdown";
    netGame.countdown = 3.999;
    netGame.lastCountInt = 4;
    netGame.active = true;
    state = STATE.RACE;
    onlineOverlay.classList.add("hidden");
    results.classList.add("hidden");
    Sound.init();
  });

  Net.on("state", (m) => {
    netGame.phase = m.phase;
    netGame.time = m.time;
    netGame.countdown = m.countdown;
    netGame.pickups = m.pickups || [];
    for (const c of m.cars) {
      netGame.cars[c.id] = c;
      if (!netGame.disp[c.id]) netGame.disp[c.id] = { x: c.x, y: c.y, a: c.a };
    }
    if (m.phase === "countdown") {
      const ci = Math.ceil(m.countdown - 1);
      if (ci < netGame.lastCountInt && ci >= 0) { Sound.countdownTick(ci); netGame.lastCountInt = ci; }
    }
  });

  Net.on("finished", (m) => {
    Sound.stopAllEngines();
    Sound.finishFanfare();
    const isHost = netGame.lobby && netGame.lobby.hostId === Net.you;
    document.getElementById("winnerTitle").textContent = `🏁 ${m.ranking[0].name} vyhrává!`;
    document.getElementById("winnerTitle").style.color = m.ranking[0].color;
    document.getElementById("againBtn").textContent = isHost ? "ZPĚT DO LOBBY" : "ZPĚT DO MENU";
    resultsAction = isHost ? "online-again" : "online-leave";
    document.getElementById("resultTimes").innerHTML = m.ranking.map((c, i) =>
      `<div class="row" style="color:${c.color}"><span>${i + 1}. ${c.name}</span>` +
      `<span>${c.finished ? formatTime(c.finishTime) : "—"}</span></div>`).join("");
    results.classList.remove("hidden");
  });

  /* ----- vykreslení lobby ----- */
  function renderLobby(m) {
    document.getElementById("roomCode").textContent = m.code;
    const list = document.getElementById("lobbyPlayers");
    list.innerHTML = m.players.map((p) =>
      `<li style="border-color:${p.color}"><span class="dotc" style="background:${p.color}"></span>${p.name}${p.host ? " 👑" : ""}${p.id === Net.you ? " (ty)" : ""}</li>`).join("");

    const isHost = m.hostId === Net.you;
    const hostOpts = document.getElementById("lobbyHostOpts");
    const startBtn = document.getElementById("netStartBtn");
    const status = document.getElementById("lobbyStatus");
    hostOpts.style.opacity = isHost ? "1" : "0.55";
    hostOpts.style.pointerEvents = isHost ? "auto" : "none";
    startBtn.style.display = isHost ? "inline-block" : "none";
    status.textContent = isHost ? "Až budou všichni připraveni, spusť závod." : "Čekání na hostitele…";

    buildNetGroup("netTrackSel", m.tracks.map((t, i) => ({ label: t.name, value: i })), m.opts.trackIndex, (v) => Net.setOpts({ trackIndex: v }), isHost);
    buildNetGroup("netLapsSel", [1, 2, 3, 5].map((n) => ({ label: String(n), value: n })), m.opts.laps, (v) => Net.setOpts({ laps: v }), isHost);
    buildNetGroup("netAiSel", [0, 1, 2, 3, 4].map((n) => ({ label: String(n), value: n })), m.opts.aiCount, (v) => Net.setOpts({ aiCount: v }), isHost);
    buildNetGroup("netAiDiffSel", [{ label: "Snadní", value: "easy" }, { label: "Normální", value: "normal" }, { label: "Těžcí", value: "hard" }], m.opts.aiDifficulty, (v) => Net.setOpts({ aiDifficulty: v }), isHost);
  }

  function buildNetGroup(id, options, current, onPick, enabled) {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "opt-btn" + (opt.value === current ? " active" : "");
      btn.textContent = opt.label;
      if (enabled) btn.addEventListener("click", () => onPick(opt.value));
      wrap.appendChild(btn);
    });
  }

  /* ----- online update & render ----- */
  function onlineInput() {
    return {
      up: down("KeyW") || down("ArrowUp"),
      down: down("KeyS") || down("ArrowDown"),
      left: down("KeyA") || down("ArrowLeft"),
      right: down("KeyD") || down("ArrowRight"),
      nitro: down("ShiftLeft") || down("ShiftRight"),
    };
  }

  function updateOnline() {
    if (netGame.phase === "countdown" || netGame.phase === "race") {
      const inp = onlineInput();
      const s = JSON.stringify(inp);
      if (s !== netGame.lastInputStr) { Net.sendInput(inp); netGame.lastInputStr = s; }
    }
    // zvuk motoru lokálního hráče
    const me = netGame.cars[Net.you];
    if (me) {
      const ratio = Math.min(1, Math.abs(me.sp || 0) / 6);
      Sound.updateEngine("self", ratio, netGame.phase === "race" && !me.f);
      Sound.setNitro("self", !!me.b);
    }
    // efekty pro všechna auta podle snapshotu
    if (netGame.track && netGame.phase === "race") {
      for (const id in netGame.cars) {
        const c = netGame.cars[id];
        if (!c.f) spawnCarFx(netGame.track, c.x, c.y, c.a, Math.abs(c.sp || 0), !!c.b);
      }
    }
  }

  function renderOnline() {
    const k = 0.35;
    const carList = [];
    for (const id in netGame.cars) {
      const t = netGame.cars[id];
      const d = netGame.disp[id];
      d.x += (t.x - d.x) * k;
      d.y += (t.y - d.y) * k;
      let da = t.a - d.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      d.a += da * k;
      const meta = netGame.meta[id] || { color: "#ccc", name: id, isAI: false };
      carList.push({ x: d.x, y: d.y, angle: d.a, color: meta.color, boosting: !!t.b, isAI: meta.isAI, name: meta.name });
    }
    drawScene(netGame.track, carList, netGame.pickups);
    setHud(); drawOnlineHUD();
    if (netGame.phase === "countdown") drawCountdown(netGame.countdown);
  }

  function drawOnlineHUD() {
    // čas
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, W / 2 - 70, 12, 140, 34, 8); ctx.fill();
    ctx.fillStyle = "#f6c544";
    ctx.font = "bold 22px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(formatTime(netGame.time), W / 2, 30);

    // panel lokálního hráče
    const me = netGame.cars[Net.you];
    const meta = netGame.meta[Net.you];
    if (me && meta) {
      const lap = Math.min(Math.floor(me.lg / netGame.gateCount) + 1, netGame.laps);
      const w = 184, h = 64, px = 16, y = 16;
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      roundRect(ctx, px, y, w, h, 10); ctx.fill();
      ctx.fillStyle = meta.color; roundRect(ctx, px, y, 6, h, 3); ctx.fill();
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      ctx.fillStyle = meta.color; ctx.font = "bold 15px 'Segoe UI', sans-serif";
      ctx.fillText(meta.name + " (ty)", px + 14, y + 8);
      ctx.fillStyle = "#fff"; ctx.font = "13px 'Segoe UI', sans-serif";
      ctx.fillText(`Kolo ${lap}/${netGame.laps}`, px + 14, y + 28);
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      roundRect(ctx, px + 14, y + 46, w - 28, 9, 4); ctx.fill();
      ctx.fillStyle = "#f6c544";
      roundRect(ctx, px + 14, y + 46, (w - 28) * Math.max(0, me.n / (me.nt || 100)), 9, 4); ctx.fill();
      ctx.fillStyle = "#cfd8cf"; ctx.font = "10px 'Segoe UI', sans-serif"; ctx.textAlign = "right";
      ctx.fillText("NITRO", px + w - 14, y + 33);
    }

    // vedoucí
    let leader = null;
    for (const id in netGame.cars) {
      const c = netGame.cars[id];
      if (!leader || c.lg > netGame.cars[leader].lg) leader = id;
    }
    if (leader) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(ctx, W / 2 - 75, 50, 150, 24, 6); ctx.fill();
      ctx.fillStyle = (netGame.meta[leader] || {}).color || "#fff";
      ctx.font = "bold 14px 'Segoe UI', sans-serif"; ctx.textAlign = "center";
      ctx.fillText(`▲ ${(netGame.meta[leader] || {}).name || ""} vede`, W / 2, 62);
    }
  }

  /* ----- online UI wiring ----- */
  document.getElementById("onlineBtn").addEventListener("click", openOnline);
  document.getElementById("onlineBackBtn").addEventListener("click", leaveOnline);
  document.getElementById("lobbyLeaveBtn").addEventListener("click", leaveOnline);
  document.getElementById("createRoomBtn").addEventListener("click", () => {
    const name = (document.getElementById("netName").value || "Hráč").trim().slice(0, 14);
    if (Net.connected) Net.create(name); else Net.connect(() => Net.create(name));
  });
  document.getElementById("joinRoomBtn").addEventListener("click", () => {
    const name = (document.getElementById("netName").value || "Hráč").trim().slice(0, 14);
    const code = (document.getElementById("joinCode").value || "").trim().toUpperCase();
    if (!code) { document.getElementById("netError").textContent = "Zadej kód místnosti."; return; }
    if (Net.connected) Net.join(code, name); else Net.connect(() => Net.join(code, name));
  });
  document.getElementById("netStartBtn").addEventListener("click", () => Net.start());

  /* ---------------- Hlavní smyčka ---------------- */
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  buildTrackSelect();
  buildOptionUI();
  requestAnimationFrame(loop);
})();
