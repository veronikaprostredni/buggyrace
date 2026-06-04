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
    if (e.code === "Enter" && state === STATE.MENU) startRace();
    if (e.code === "KeyR" && (state === STATE.RACE || state === STATE.FINISHED)) toMenu();
    if (e.code === "KeyM") updateMuteBtn(Sound.toggleMute());
  });
  window.addEventListener("keyup", (e) => { pressed[e.code] = false; });

  function inputFor(keys) {
    return { up: down(keys.up), down: down(keys.down), left: down(keys.left), right: down(keys.right), nitro: down(keys.nitro) };
  }

  /* ---------------- Sestavení aut (lokální hra 2 hráčů) ---------------- */
  function makeLocalCars() {
    return [
      new IMR.Car({ id: "p1", color: "#e8473b", name: "Hráč 1" }),
      new IMR.Car({ id: "p2", color: "#3b82e8", name: "Hráč 2" }),
    ];
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

  function startRace() {
    Sound.init();
    world = new IMR.World(IMR.TRACKS[selectedTrack], makeLocalCars(), TOTAL_LAPS);
    world.running = false;
    countdown = 3.999;
    lastCountInt = 4;
    finishPlayed = false;
    state = STATE.COUNTDOWN;
    overlay.classList.add("hidden");
    results.classList.add("hidden");
  }

  function finishRace() {
    state = STATE.FINISHED;
    Sound.stopAllEngines();
    for (const c of world.cars) Sound.setNitro(c.id, false);
    const ranked = world.ranking();
    const winner = ranked[0];
    document.getElementById("winnerTitle").textContent = `🏁 ${winner.name} vyhrává!`;
    document.getElementById("winnerTitle").style.color = winner.color;
    const box = document.getElementById("resultTimes");
    box.innerHTML = ranked.map((c, i) =>
      `<div class="row" style="color:${c.color}"><span>${i + 1}. ${c.name}</span>` +
      `<span>${c.finished ? formatTime(c.finishTime) : "—"}</span></div>`).join("");
    results.classList.remove("hidden");
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

  document.getElementById("startBtn").addEventListener("click", startRace);
  document.getElementById("againBtn").addEventListener("click", startRace);
  document.getElementById("muteBtn").addEventListener("click", () => {
    Sound.init();
    updateMuteBtn(Sound.toggleMute());
  });

  /* ---------------- Aktualizace ---------------- */
  let acc = 0;
  function update(dt) {
    if (state === STATE.COUNTDOWN) {
      countdown -= dt;
      const ci = Math.ceil(countdown - 1);   // 3,2,1,0(=GO)
      if (ci < lastCountInt && ci >= 0) { Sound.countdownTick(ci); lastCountInt = ci; }
      if (countdown <= 1 && !world.running) world.running = true;  // "START!" = jede se
      if (countdown <= 0) state = STATE.RACE;
    }
    if (state === STATE.RACE || (state === STATE.COUNTDOWN && world.running)) {
      const inputs = { p1: inputFor(P1_KEYS), p2: inputFor(P2_KEYS) };
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

  function drawCountdown() {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, W, H);
    const n = Math.ceil(countdown - 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f6c544";
    if (n > 0) { ctx.font = "bold 160px 'Segoe UI', sans-serif"; ctx.fillText(n, W / 2, H / 2); }
    else { ctx.font = "bold 120px 'Segoe UI', sans-serif"; ctx.fillText("START!", W / 2, H / 2); }
  }

  function render() {
    if (!world) {
      // náhled vybrané trati v menu
      drawTrack(IMR.buildTrack(IMR.TRACKS[selectedTrack]));
      return;
    }
    drawTrack(world.track);
    for (const c of world.cars) drawCar(c);
    drawHUD();
    if (state === STATE.COUNTDOWN) drawCountdown();
  }

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
  requestAnimationFrame(loop);
})();
