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
  const HUD_H = 62;          // horní lišta pro HUD (svět px) – panely nezakrývají trať
  function computeCamera() {
    camS = Math.min(canvas.width / W, canvas.height / (H * TILT + WALL_H * 2 + HUD_H));
    camOffX = (canvas.width - W * camS) / 2;
    camOffY = (canvas.height - (H * TILT + HUD_H) * camS) / 2 + (WALL_H + HUD_H) * camS;
  }
  function setGround() { ctx.setTransform(camS, 0, 0, camS * TILT, camOffX, camOffY); }   // zem (stlačená)
  function setHud() { ctx.setTransform(camS, 0, 0, camS, camOffX, camOffY - (HUD_H + WALL_H) * camS); }   // HUD lišta nad tratí
  function setOverlay() { ctx.setTransform(camS, 0, 0, camS, camOffX, camOffY); }                         // překryv přes trať
  function projX(x) { return camOffX + x * camS; }
  function projY(y) { return camOffY + y * camS * TILT; }
  window.addEventListener("resize", resize);
  resize();

  /* ---------------- Částicové efekty (prach, bláto, nitro) ---------------- */
  const particles = [];
  // h = počáteční výška, base = výška země (částice na ni dopadne), vh = svislá rychlost
  function spawnParticle(x, y, vx, vy, life, size, color, h, base, vh) {
    if (particles.length > 360) return;
    h = h || 0;
    particles.push({ x, y, vx, vy, life, max: life, size, color, h, base: base != null ? base : h, vh: vh || 0 });
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vx *= 0.9; p.vy *= 0.9;
      p.h += p.vh; p.vh -= 0.15; if (p.h < p.base) { p.h = p.base; p.vh = 0; }
      p.life -= dt;
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
      ctx.arc(projX(p.x), projY(p.y) - p.h * camS, p.size * camS * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // efekty za autem: nitro jiskry, bahno/voda (odstřikující), prach
  function spawnCarFx(track, c) {
    const angle = c.angle, speed = Math.abs(c.speed || 0);
    if ((c.z || 0) - (c.gz || 0) > 2) return;            // ve vzduchu nic nevíří
    const bx = c.x - Math.cos(angle) * 15, by = c.y - Math.sin(angle) * 15, h = c.gz || 0;
    const surf = IMR.surfaceAt(track, c.x, c.y);
    if (c.boosting) {
      for (let i = 0; i < 2; i++)
        spawnParticle(bx, by, -Math.cos(angle) * 1.2 + (Math.random() - 0.5), -Math.sin(angle) * 1.2 + (Math.random() - 0.5),
          0.4, 5 + Math.random() * 4, Math.random() < 0.5 ? "#ffd24a" : "#ff7a1a", h + 4);
    }
    if (surf.rough && speed > 0.6) {
      const water = surf.speed < 0.55;
      for (let i = 0; i < 2; i++)
        spawnParticle(bx, by, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
          0.55, 3 + Math.random() * 4, water ? "#a8d6ec" : "#5e3f20", h, h, 1 + Math.random() * 1.5);
    } else if (speed > 2.2 && Math.random() < 0.5) {
      spawnParticle(bx, by, (Math.random() - 0.5), (Math.random() - 0.5), 0.45, 4, "rgba(190,170,130,0.6)", h);
    }
  }
  // oblak prachu při dopadu ze skoku / jiskry při nárazu do mantinelu
  function burstFx(c, kind, power) {
    const n = Math.min(14, 4 + Math.round(power * 3)), h = c.gz || 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 1.4;
      spawnParticle(c.x, c.y, Math.cos(a) * v, Math.sin(a) * v, kind === "wall" ? 0.3 : 0.6,
        kind === "wall" ? 2.5 : 4 + Math.random() * 4, kind === "wall" ? "#ffe08a" : "rgba(200,175,130,0.75)",
        h + (kind === "wall" ? 8 : 1), h, kind === "wall" ? 1.2 : 0.6);
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
          if (ev.type === "wall" || ev.type === "land") {
            const car = world.cars.find((c) => c.id === ev.car);
            if (car) burstFx(car, ev.type, ev.power);
            Sound.impact(ev.power, ev.type);
          }
          if (ev.type === "finish" && !finishPlayed) { Sound.finishFanfare(); finishPlayed = true; }
        }
        acc -= FIXED_DT;
      }
      if (collided) Sound.collision();
      for (const c of world.cars) if (!c.finished) spawnCarFx(world.track, c);
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
  /* ---------------- Statická vrstva: aréna, trať s reliéfem, mantinely ----------------
     Kreslí se jednou do mezipaměti (při změně trati nebo velikosti okna), takže si
     můžeme dovolit bohaté stínování terénu bez dopadu na plynulost hry. */
  const LIGHT = (function () { const l = [-0.5, -0.5, 1]; const k = Math.hypot(l[0], l[1], l[2]); return l.map((v) => v / k); })();
  let groundCache = null, groundKey = "";
  const trackCache = {};
  function trackFor(def) { return trackCache[def.id] || (trackCache[def.id] = IMR.buildTrack(def)); }

  function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
  function hash2(i, k) { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); }
  function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbStr(c, f) { return `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`; }
  function hexA(hex, a) { const c = rgbOf(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function shade(hex, f) { return rgbStr(rgbOf(hex), f); }
  function groundHere(track, x, y) { return IMR.groundAt(track, IMR.nearestOnCenter(track, x, y).s); }

  // vyhlazené normály a výšky v bodech osy trati
  function trackFrame(track) {
    if (track._frame) return track._frame;
    const C = track.center, n = C.length, nrm = [], g = [];
    for (let i = 0; i < n; i++) {
      const a = C[(i - 1 + n) % n], b = C[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      nrm.push({ x: -dy / l, y: dx / l });
      g.push(IMR.groundAt(track, track.sAt[i]));
    }
    return (track._frame = { nrm, g });
  }

  function poly(g, pts, fill) {
    g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath(); g.fill(); g.stroke();   // obrys stejnou barvou skryje švy mezi plochami
  }

  function buildGroundLayer(track) {
    const cv = (groundCache && groundCache.width === canvas.width && groundCache.height === canvas.height)
      ? groundCache : document.createElement("canvas");
    cv.width = canvas.width; cv.height = canvas.height;
    const g = cv.getContext("2d");
    const th = track.theme, fr = trackFrame(track), C = track.center, n = C.length;
    const P = (x, y, h) => [projX(x), projY(y) - h * camS];

    // pozadí a podlaha arény
    const bg = g.createLinearGradient(0, 0, 0, cv.height);
    bg.addColorStop(0, "#10180f"); bg.addColorStop(1, "#050805");
    g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = th.grass;
    g.fillRect(projX(-30), projY(-30), (W + 60) * camS, (H + 60) * camS * TILT);
    const r = rng(7 + n);
    for (let i = 0; i < 420; i++) {          // zrnitost povrchu
      const x = r() * W, y = r() * H, s = (1 + r() * 3) * camS;
      g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.06)";
      g.fillRect(projX(x), projY(y), s, s * TILT);
    }
    // plastické boule a hrboly v aréně (mimo trať), osvětlené zleva shora
    const keep = track.halfW + IMR.WALL_GAP + 14;
    for (let i = 0; i < 70; i++) {
      const x = 30 + r() * (W - 60), y = 30 + r() * (H - 60), rad = 10 + r() * 26;
      if (IMR.nearestOnCenter(track, x, y).d < keep + rad) continue;
      const sx = projX(x), sy = projY(y), rx = rad * camS, ry = rad * camS * TILT, lift = rad * 0.35 * camS;
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.beginPath(); g.ellipse(sx + rx * 0.18, sy + ry * 0.25, rx, ry, 0, 0, Math.PI * 2); g.fill();
      const grd = g.createRadialGradient(sx - rx * 0.35, sy - lift - ry * 0.45, rx * 0.1, sx, sy - lift * 0.5, rx * 1.05);
      grd.addColorStop(0, shade(th.grass, 1.35)); grd.addColorStop(0.6, th.grass); grd.addColorStop(1, shade(th.grass, 0.72));
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(sx, sy - lift * 0.5, rx, ry + lift * 0.5, 0, 0, Math.PI * 2); g.fill();
    }

    // trať: pruhy napříč šířkou; každá plocha osvětlená podle skutečného sklonu terénu
    const LANES = 10, dirt = rgbOf(th.dirt), hw = track.halfW + IMR.WALL_GAP;
    const quads = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ca = C[i], cb = C[j], na = fr.nrm[i], nb = fr.nrm[j], ha = fr.g[i], hb = fr.g[j];
      const tx = cb.x - ca.x, ty = cb.y - ca.y, tz = hb - ha;
      let nx = na.y * tz, ny = -na.x * tz, nz = na.x * ty - na.y * tx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const lit = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / (Math.hypot(nx, ny, nz) || 1));
      for (let k = 0; k < LANES; k++) {
        const u0 = -1 + (2 * k) / LANES, u1 = -1 + (2 * (k + 1)) / LANES, um = Math.abs((u0 + u1) / 2);
        const cross = 1.06 - 0.34 * um * um * um;                    // tmavší okraje u mantinelů
        const ruts = Math.abs(um - 0.4) < 0.1 ? 0.9 : 1;              // dvě vyjeté koleje
        const f = (0.45 + 0.68 * lit) * cross * ruts * (0.975 + 0.05 * hash2(i, k));
        const pts = [P(ca.x + na.x * u0 * hw, ca.y + na.y * u0 * hw, ha), P(ca.x + na.x * u1 * hw, ca.y + na.y * u1 * hw, ha),
          P(cb.x + nb.x * u1 * hw, cb.y + nb.y * u1 * hw, hb), P(cb.x + nb.x * u0 * hw, cb.y + nb.y * u0 * hw, hb)];
        quads.push({ pts, col: rgbStr(dirt, f), y: Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]) });
      }
    }
    quads.sort((a, b) => a.y - b.y);
    for (const q of quads) poly(g, q.pts, q.col);

    // organická textura hlíny: hroudy a kamínky po celé šíři trati
    const tr = rng(91 + n);
    for (let i = 0; i < n * 5; i++) {
      const ci = Math.floor(tr() * n), u = (tr() * 2 - 1) * hw * 0.95, c = C[ci], nn = fr.nrm[ci];
      const [sx, sy] = P(c.x + nn.x * u, c.y + nn.y * u, fr.g[ci]);
      const big = tr() < 0.12, rad = (big ? 2.5 + tr() * 2.5 : 0.8 + tr() * 1.4) * camS;
      g.fillStyle = tr() < 0.55 ? "rgba(40,25,10,0.22)" : "rgba(255,240,210,0.16)";
      g.beginPath(); g.ellipse(sx, sy, rad, rad * TILT, 0, 0, Math.PI * 2); g.fill();
    }
    // skokánky: světlá hrana na vrcholu a stín na dopadové ploše
    for (const hl of track.hills) {
      if (hl.type !== "ramp") continue;
      const at = (s) => { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(track.sAt[i] - s); if (d < bd) { bd = d; best = i; } } return best; };
      const crest = at(hl.s0), c = C[crest], nn = fr.nrm[crest], h = fr.g[crest];
      g.strokeStyle = "rgba(255,235,190,0.55)"; g.lineWidth = 3 * camS;
      g.beginPath(); g.moveTo(...P(c.x - nn.x * hw, c.y - nn.y * hw, h)); g.lineTo(...P(c.x + nn.x * hw, c.y + nn.y * hw, h)); g.stroke();
      for (let k = 0; k < 4; k++) {
        const i0 = at(hl.s0 + hl.fall + k * 7), i1 = at(hl.s0 + hl.fall + (k + 1) * 7), a = C[i0], b = C[i1], na = fr.nrm[i0], nb = fr.nrm[i1];
        g.globalAlpha = 0.22 * (1 - k / 4);
        poly(g, [P(a.x - na.x * hw, a.y - na.y * hw, fr.g[i0]), P(a.x + na.x * hw, a.y + na.y * hw, fr.g[i0]),
          P(b.x + nb.x * hw, b.y + nb.y * hw, fr.g[i1]), P(b.x - nb.x * hw, b.y - nb.y * hw, fr.g[i1])], "#000");
      }
      g.globalAlpha = 1;
    }

    // louže bláta / vody (na výšce terénu)
    for (const z of track.terrain) {
      const water = z.type === "water", h = groundHere(track, z.x, z.y);
      const sx = projX(z.x), sy = projY(z.y) - h * camS, rx = z.r * camS, ry = z.r * camS * TILT;
      g.fillStyle = "rgba(0,0,0,0.38)";
      g.beginPath(); g.ellipse(sx, sy + 2 * camS, rx, ry, 0, 0, Math.PI * 2); g.fill();
      const grd = g.createRadialGradient(sx - rx * 0.3, sy - ry * 0.3, rx * 0.1, sx, sy, rx);
      if (water) { grd.addColorStop(0, "#6aaed2"); grd.addColorStop(1, "#1f4f6b"); }
      else { grd.addColorStop(0, "#6b4a28"); grd.addColorStop(1, "#32220f"); }
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(sx, sy, rx * 0.93, ry * 0.93, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = water ? "rgba(220,240,250,0.45)" : "rgba(140,100,60,0.5)";
      g.beginPath(); g.ellipse(sx - rx * 0.3, sy - ry * 0.35, rx * 0.32, ry * 0.18, 0, 0, Math.PI * 2); g.fill();
    }

    // start / cíl (šachovnice)
    const g0 = track.gates[0], ux = -Math.sin(g0.dirAngle), uy = Math.cos(g0.dirAngle), fx = Math.cos(g0.dirAngle), fy = Math.sin(g0.dirAngle);
    const cols = 8, sq = (track.width) / cols, h0 = groundHere(track, g0.x, g0.y);
    for (let i = 0; i < cols; i++) for (let k = 0; k < 2; k++) {
      const a = -track.width / 2 + i * sq, b = a + sq, c0 = -8 + k * 8, c1 = c0 + 8;
      const pt = (u, v) => P(g0.x + ux * u + fx * v, g0.y + uy * u + fy * v, h0);
      poly(g, [pt(a, c0), pt(b, c0), pt(b, c1), pt(a, c1)], (i + k) % 2 ? "#1c1c1c" : "#efefef");
    }

    // pevné mantinely: kontaktní stín, násep na kopcích, stěna s tloušťkou, horní hrana
    const walls = [];
    for (const sgn of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, na = fr.nrm[i], nb = fr.nrm[j], ha = fr.g[i], hb = fr.g[j];
        const inA = { x: C[i].x + na.x * hw * sgn, y: C[i].y + na.y * hw * sgn };
        const inB = { x: C[j].x + nb.x * hw * sgn, y: C[j].y + nb.y * hw * sgn };
        const outA = { x: inA.x + na.x * 5 * sgn, y: inA.y + na.y * 5 * sgn };
        const outB = { x: inB.x + nb.x * 5 * sgn, y: inB.y + nb.y * 5 * sgn };
        // na ostré vnitřní zatáčce se posunutá křivka přeloží přes sebe; takové kusy leží
        // blíž ose než skutečný (fyzikální) mantinel → nekreslit, ať zeď netrčí do trati
        const ok = (pt) => IMR.nearestOnCenter(track, pt.x, pt.y).d > hw - 1.5;
        if (!ok(inA) && !ok(inB)) continue;
        const near = na.y * sgn > 0;      // stěna na straně ke kameře → vidíme vnější líc
        walls.push({ i, inA, inB, outA, outB, ha, hb, near, y: Math.max(projY(inA.y), projY(inB.y)) });
      }
    }
    for (const w of walls) {                // kontaktní stín na trati u paty stěny
      const fA = { x: w.inA.x * 0.86 + (w.inA.x - (w.outA.x - w.inA.x) * 2.4) * 0.14, y: w.inA.y * 0.86 + (w.inA.y - (w.outA.y - w.inA.y) * 2.4) * 0.14 };
      const fB = { x: w.inB.x * 0.86 + (w.inB.x - (w.outB.x - w.inB.x) * 2.4) * 0.14, y: w.inB.y * 0.86 + (w.inB.y - (w.outB.y - w.inB.y) * 2.4) * 0.14 };
      g.globalAlpha = 0.28;
      poly(g, [P(w.inA.x, w.inA.y, w.ha), P(w.inB.x, w.inB.y, w.hb), P(fB.x, fB.y, w.hb), P(fA.x, fA.y, w.ha)], "#000");
      g.globalAlpha = 1;
    }
    walls.sort((a, b) => a.y - b.y);
    for (const w of walls) {
      const red = Math.floor(w.i / 4) % 2 === 0;
      const faceA = w.near ? w.outA : w.inA, faceB = w.near ? w.outB : w.inB;
      if (w.near && (w.ha > 0.5 || w.hb > 0.5))        // hliněný násep pod stěnou na kopci
        poly(g, [P(faceA.x, faceA.y, 0), P(faceB.x, faceB.y, 0), P(faceB.x, faceB.y, w.hb), P(faceA.x, faceA.y, w.ha)], shade(th.dirt, 0.5));
      poly(g, [P(faceA.x, faceA.y, w.ha), P(faceB.x, faceB.y, w.hb), P(faceB.x, faceB.y, w.hb + WALL_H), P(faceA.x, faceA.y, w.ha + WALL_H)],
        red ? (w.near ? "#a92b25" : "#8f241f") : (w.near ? "#c4c0b6" : "#a9a59c"));
      poly(g, [P(w.inA.x, w.inA.y, w.ha + WALL_H), P(w.inB.x, w.inB.y, w.hb + WALL_H), P(w.outB.x, w.outB.y, w.hb + WALL_H), P(w.outA.x, w.outA.y, w.ha + WALL_H)],
        red ? "#e4483d" : "#f4f1ea");
    }
    return cv;
  }

  // balíčky odměn na trati
  const PICKUP_STYLE = {
    nitro: { c: "#3bb0ff", label: "N" },
    money: { c: "#f6c544", label: "$" },
    tires: { c: "#222", label: "T" },
    accel: { c: "#34c759", label: "»" },
  };
  function drawPickups(track, list) {
    if (!list) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const now = Date.now();
    for (const p of list) {
      if (p.active === false) continue;
      const st = PICKUP_STYLE[p.type] || PICKUP_STYLE.money;
      const amp = p.type === "nitro" ? 9 : 4;                       // nitro výrazně poskakuje
      const bob = Math.abs(Math.sin(now / 300 + (p.id || 0))) * amp;
      const sx = projX(p.x), sy = projY(p.y) - groundHere(track, p.x, p.y) * camS;
      const r = 13 * camS, shrink = 1 - bob / 30;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.8 * shrink, r * 0.4 * shrink, 0, 0, Math.PI * 2); ctx.fill();
      const cy = sy - (16 + bob) * camS;
      ctx.fillStyle = st.c;
      ctx.beginPath(); ctx.arc(sx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2.5 * camS; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.arc(sx - r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.type === "nitro" || p.type === "tires" ? "#fff" : "#1a1205";
      ctx.font = `bold ${Math.round(15 * camS)}px 'Segoe UI', sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(st.label, sx, cy + camS);
    }
  }

  // Auto: poloha promítnutá perspektivou, výška nad terénem (skoky), stín na zemi.
  // Karoserie má boční hranu, takže působí jako malý 3D model.
  function carBody(color, f) {
    roundRect(ctx, -16, -9, 32, 18, 5);
    ctx.fillStyle = shade(color, f); ctx.fill();
  }
  function drawCar(c) {
    const sx = projX(c.x);
    const groundY = projY(c.y) - (c.gz || 0) * camS;
    const air = Math.max(0, (c.z || 0) - (c.gz || 0));
    const shake = c.rough && Math.abs(c.speed || 0) > 0.6 && air < 0.5 ? Math.sin(performance.now() / 20 + sx) * 0.8 * camS : 0;
    const bodyY = groundY - (6 + air) * camS + shake;
    const appAngle = Math.atan2(Math.sin(c.angle) * TILT, Math.cos(c.angle));
    const thick = 4 * camS;

    // stín zůstává na zemi a zmenšuje se s výškou skoku
    const sh = 1 / (1 + air / 25);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * sh})`;
    ctx.beginPath(); ctx.ellipse(sx + air * 0.3 * camS, groundY + 2 * camS, 18 * camS * sh, 9.5 * camS * sh, 0, 0, Math.PI * 2); ctx.fill();

    if (c.boosting) {
      ctx.save();
      ctx.translate(sx, bodyY); ctx.rotate(appAngle); ctx.scale(camS, camS);
      const fl = 12 + Math.random() * 12;
      ctx.fillStyle = "rgba(255,150,40,0.9)";
      ctx.beginPath(); ctx.moveTo(-16, -5); ctx.lineTo(-16 - fl, 0); ctx.lineTo(-16, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,235,140,0.95)";
      ctx.beginPath(); ctx.moveTo(-16, -3); ctx.lineTo(-16 - fl * 0.6, 0); ctx.lineTo(-16, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // kola + boční hrana karoserie (posunuté dolů = tloušťka)
    ctx.save();
    ctx.translate(sx, bodyY + thick); ctx.rotate(appAngle); ctx.scale(camS, camS);
    ctx.fillStyle = "#121314";
    roundRect(ctx, -13, -12, 9, 5, 2); ctx.fill(); roundRect(ctx, -13, 7, 9, 5, 2); ctx.fill();
    roundRect(ctx, 5, -12, 9, 5, 2); ctx.fill(); roundRect(ctx, 5, 7, 9, 5, 2); ctx.fill();
    carBody(c.color, 0.5);
    ctx.restore();

    // horní plocha karoserie
    ctx.save();
    ctx.translate(sx, bodyY); ctx.rotate(appAngle); ctx.scale(camS, camS);
    const grd = ctx.createLinearGradient(0, -9, 0, 9);
    grd.addColorStop(0, shade(c.color, 1.35)); grd.addColorStop(1, shade(c.color, 0.8));
    roundRect(ctx, -16, -9, 32, 18, 5); ctx.fillStyle = grd; ctx.fill();
    ctx.fillStyle = "rgba(20,30,40,0.88)"; roundRect(ctx, -2, -6, 9, 12, 3); ctx.fill();     // kabina
    ctx.fillStyle = "rgba(255,255,255,0.25)"; roundRect(ctx, 0, -5, 3, 10, 1.5); ctx.fill(); // odlesk skla
    ctx.fillStyle = shade(c.color, 1.6); roundRect(ctx, 11, -7, 4, 14, 2); ctx.fill();      // maska
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.5;                              // rám korby
    roundRect(ctx, -14, -7, 10, 14, 2); ctx.stroke();
    ctx.restore();

    ctx.fillStyle = c.color;
    ctx.font = `bold ${Math.round(12 * camS)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(c.isAI ? "CPU" : c.name, sx, bodyY - 15 * camS);
  }

  // Panel hráče v horní liště: jméno, pozice, kolo, zásoba nitra.
  function drawPanel(name, color, pos, of, lap, laps, nitro, tank, align) {
    const w = 236, h = 50, y = 6, px = align === "left" ? 6 : W - 6 - w;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; roundRect(ctx, px, y, w, h, 9); ctx.fill();
    ctx.fillStyle = color; roundRect(ctx, px, y, 6, h, 3); ctx.fill();
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = color; ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.fillText(name, px + 14, y + 6);
    ctx.textAlign = "right"; ctx.fillStyle = "#fff"; ctx.font = "bold 14px 'Segoe UI', sans-serif";
    ctx.fillText(`${pos}./${of}   Kolo ${lap}/${laps}`, px + w - 10, y + 7);
    ctx.fillStyle = "rgba(255,255,255,0.18)"; roundRect(ctx, px + 14, y + 30, w - 28, 12, 5); ctx.fill();
    ctx.fillStyle = "#3bb0ff"; roundRect(ctx, px + 14, y + 30, (w - 28) * Math.max(0, Math.min(1, nitro / tank)), 12, 5); ctx.fill();
    ctx.textAlign = "left"; ctx.fillStyle = "#fff"; ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.fillText("NITRO", px + 19, y + 31);
  }
  function drawCenterHUD(time, line2, line2Color) {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; roundRect(ctx, W / 2 - 75, 6, 150, 30, 8); ctx.fill();
    ctx.fillStyle = "#f6c544"; ctx.font = "bold 21px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(formatTime(time), W / 2, 21);
    if (line2) {
      ctx.fillStyle = line2Color || "#cfd8cf"; ctx.font = "bold 13px 'Segoe UI', sans-serif";
      ctx.fillText(line2, W / 2, 47);
    }
  }

  function drawHUD() {
    const rank = world.ranking();
    const players = world.cars.filter((c) => !c.isAI);
    players.slice(0, 2).forEach((c, i) => drawPanel(c.name, c.color, rank.indexOf(c) + 1, rank.length,
      c.currentLap(TOTAL_LAPS), TOTAL_LAPS, c.nitro, c.phys.nitroTank, i === 0 ? "left" : "right"));
    const lead = rank.length > 1 && rank[0].lapGates !== rank[1].lapGates ? rank[0] : null;
    const line2 = (champ ? `🏆 Závod ${champ.raceIndex + 1}/${champ.totalRaces}` : "") +
      (champ && lead ? "  ·  " : "") + (lead ? `▲ ${lead.isAI ? "CPU" : lead.name} vede` : "");
    drawCenterHUD(world.time, line2, lead ? lead.color : null);
  }

  function drawCountdown(value) {
    setOverlay();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H * TILT);
    const n = Math.ceil(value - 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f6c544";
    const cy = H * TILT / 2;
    if (n > 0) { ctx.font = "bold 150px 'Segoe UI', sans-serif"; ctx.fillText(n, W / 2, cy); }
    else { ctx.font = "bold 110px 'Segoe UI', sans-serif"; ctx.fillText("START!", W / 2, cy); }
  }

  // společné vykreslení scény: statická vrstva z mezipaměti + částice, balíčky a auta
  function drawScene(track, carList, pickups) {
    computeCamera();
    const key = track.def.id + ":" + canvas.width + "x" + canvas.height;
    if (key !== groundKey) { groundCache = buildGroundLayer(track); groundKey = key; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(groundCache, 0, 0);
    drawParticles();
    drawPickups(track, pickups);
    const sorted = [...carList].sort((a, b) => a.y - b.y);   // painter podle hloubky
    for (const c of sorted) drawCar(c);
  }

  function render() {
    if (netGame.active) { renderOnline(); return; }
    if (!world) {
      drawScene(trackFor(IMR.TRACKS[selectedTrack]), [], []);   // náhled v menu
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
    netGame.track = trackFor(IMR.TRACKS[m.trackIndex] || IMR.TRACKS[0]);
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
        const d = netGame.disp[id];
        if (!c.f && d) spawnCarFx(netGame.track, { x: d.x, y: d.y, angle: d.a, speed: c.sp || 0, boosting: !!c.b, z: d.z, gz: d.gz });
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
      // výška: plynulá interpolace, terén pod autem se dopočítá z trati
      d.z = d.z == null ? (t.z || 0) : d.z + ((t.z || 0) - d.z) * 0.5;
      d.gz = groundHere(netGame.track, d.x, d.y);
      const airNow = d.z - d.gz > 2;
      if (d.wasAir && !airNow) burstFx({ x: d.x, y: d.y, gz: d.gz }, "land", 2.5);
      d.wasAir = airNow;
      const meta = netGame.meta[id] || { color: "#ccc", name: id, isAI: false };
      carList.push({ x: d.x, y: d.y, angle: d.a, z: d.z, gz: d.gz, speed: t.sp || 0,
        rough: IMR.surfaceAt(netGame.track, d.x, d.y).rough, color: meta.color, boosting: !!t.b, isAI: meta.isAI, name: meta.name });
    }
    drawScene(netGame.track, carList, netGame.pickups);
    setHud(); drawOnlineHUD();
    if (netGame.phase === "countdown") drawCountdown(netGame.countdown);
  }

  function drawOnlineHUD() {
    const ids = Object.keys(netGame.cars);
    // pořadí podle projetých branek, pak podle vzdálenosti k další brance
    const ranked = ids.sort((a, b) => {
      const A = netGame.cars[a], B = netGame.cars[b];
      if (B.lg !== A.lg) return B.lg - A.lg;
      const ga = netGame.track.gates[A.ng], gb = netGame.track.gates[B.ng];
      return Math.hypot(A.x - ga.x, A.y - ga.y) - Math.hypot(B.x - gb.x, B.y - gb.y);
    });
    const me = netGame.cars[Net.you], meta = netGame.meta[Net.you];
    if (me && meta) {
      const lap = Math.min(Math.floor(me.lg / netGame.gateCount) + 1, netGame.laps);
      drawPanel(meta.name + " (ty)", meta.color, ranked.indexOf(Net.you) + 1, ranked.length, lap, netGame.laps, me.n, me.nt || 100, "left");
    }
    const leadId = ranked.length > 1 && netGame.cars[ranked[0]].lg !== netGame.cars[ranked[1]].lg ? ranked[0] : null;
    const lm = leadId ? (netGame.meta[leadId] || {}) : null;
    drawCenterHUD(netGame.time, lm ? `▲ ${lm.name || ""} vede` : "", lm ? lm.color : null);
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
