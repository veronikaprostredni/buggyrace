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
      if (p) p.money += PAYOUT[i] != null ? PAYOUT[i] : 60;
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

  /* ---------------- Aktualizace ---------------- */
  let acc = 0;
  function update(dt) {
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
          if (ev.type === "finish" && !finishPlayed) { Sound.finishFanfare(); finishPlayed = true; }
        }
        acc -= FIXED_DT;
      }
      if (collided) Sound.collision();
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

  function drawTrack(track) {
    const th = track.theme;
    ctx.fillStyle = th.grass;
    ctx.fillRect(0, 0, W, H);
    for (const g of GRASS) {
      ctx.fillStyle = hexA(th.grassDark, g.a);
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill();
    }
    strokePath(track.center, track.width + 14, th.dirtEdge);
    strokePath(track.center, track.width, th.dirt);
    strokePath(track.center, track.width - 34, th.rut);
    drawStartLine(track);
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

  function drawCar(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(ctx, -15, -8, 30, 16, 4); ctx.fill();
    const grd = ctx.createLinearGradient(0, -9, 0, 9);
    grd.addColorStop(0, shade(c.color, 1.25));
    grd.addColorStop(1, shade(c.color, 0.7));
    ctx.fillStyle = grd;
    roundRect(ctx, -16, -9, 32, 18, 5); ctx.fill();
    ctx.fillStyle = "rgba(20,30,40,0.85)";
    roundRect(ctx, -2, -6, 9, 12, 3); ctx.fill();
    ctx.fillStyle = shade(c.color, 1.5);
    roundRect(ctx, 11, -7, 4, 14, 2); ctx.fill();
    ctx.fillStyle = "#16181a";
    roundRect(ctx, -12, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, -12, 7, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, -11, 7, 4, 2); ctx.fill();
    roundRect(ctx, 6, 7, 7, 4, 2); ctx.fill();
    ctx.restore();

    if (c.boosting) {
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.angle);
      const fl = 10 + Math.random() * 10;
      ctx.fillStyle = "rgba(255,150,40,0.9)";
      ctx.beginPath(); ctx.moveTo(-16, -4); ctx.lineTo(-16 - fl, 0); ctx.lineTo(-16, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,230,120,0.9)";
      ctx.beginPath(); ctx.moveTo(-16, -2); ctx.lineTo(-16 - fl * 0.6, 0); ctx.lineTo(-16, 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // jmenovka nad autem
    ctx.fillStyle = c.color;
    ctx.font = "bold 11px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(c.isAI ? "CPU" : c.name, c.x, c.y - 16);
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
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W, H);
    const n = Math.ceil(value - 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f6c544";
    if (n > 0) { ctx.font = "bold 160px 'Segoe UI', sans-serif"; ctx.fillText(n, W / 2, H / 2); }
    else { ctx.font = "bold 120px 'Segoe UI', sans-serif"; ctx.fillText("START!", W / 2, H / 2); }
  }

  function render() {
    if (netGame.active) { renderOnline(); return; }
    if (!world) {
      // náhled vybrané trati v menu
      drawTrack(IMR.buildTrack(IMR.TRACKS[selectedTrack]));
      return;
    }
    drawTrack(world.track);
    for (const c of world.cars) drawCar(c);
    drawHUD();
    if (state === STATE.COUNTDOWN) drawCountdown(countdown);
  }

  /* =====================================================================
     ONLINE REŽIM (síťový multiplayer)
     ===================================================================== */
  const Net = window.Net;
  let inOnline = false;            // je otevřené online překrytí?
  const netGame = {
    active: false, track: null, laps: 3, gateCount: IMR.GATE_COUNT,
    meta: {}, cars: {}, disp: {}, phase: "countdown", time: 0, countdown: 0,
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
    netGame.cars = {}; netGame.disp = {};
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
  }

  function renderOnline() {
    drawTrack(netGame.track);
    const k = 0.35;
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
      drawCar({ x: d.x, y: d.y, angle: d.a, color: meta.color, boosting: !!t.b, isAI: meta.isAI, name: meta.name });
    }
    drawOnlineHUD();
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
