/* =====================================================================
   IRON MAN OFFROAD RACING — ZVUK (audio.js)
   Syntetizované zvuky přes Web Audio API (bez externích souborů):
   motor buginy (zápaly válců, otáčky, řazení, zátěž, prskání výfuku),
   štěrk pod koly, smyk, nitro, nárazy, diváci, odpočet, odměny, cíl.
   AudioContext se vytvoří až po gestu uživatele (pravidla prohlížečů).
   ===================================================================== */
(function (global) {
  "use strict";

  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;    // bílý šum
  let brownBuffer = null;    // hnědý šum (hluboké hučení štěrku)
  let engineWave = null;
  const cars = {};           // id -> zvuk auta (motor + kola)
  const nitros = {};         // id -> syčení nitra
  let crowdNode = null;

  const MASTER = 0.75;

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    // jemný kompresor, ať se zvuky slijí a nic neřeže do uší
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    brownBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = noiseBuffer.getChannelData(0), b = brownBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5;
    }
    // Tvar vlny motoru: bohaté nižší harmonické s nepravidelnými fázemi
    // (vzduchem chlazený boxer buginy zní „drsně", ne jako čistý tón).
    const N = 32, re = new Float32Array(N), im = new Float32Array(N);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 1; n < N; n++) {
      const amp = Math.pow(n, -0.75) * (n % 2 ? 1 : 0.7) * (n === 2 ? 1.3 : 1);
      const ph = rnd() * Math.PI * 2;
      re[n] = amp * Math.cos(ph); im[n] = amp * Math.sin(ph);
    }
    engineWave = ctx.createPeriodicWave(re, im);
  }

  function ready() { return ctx && !muted; }
  function loopSource(buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }
  function filt(type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function gainNode(v) { const g = ctx.createGain(); g.gain.value = v || 0; return g; }

  /* ---------------- Auto: motor + kola ---------------- */
  function makeCar(pan) {
    const out = gainNode(0);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan || 0; panner.connect(master); }
    const dest = panner || master;

    // motor: harmonický tón zápalů + podharmonická „tělo" + pulzování (putt-putt)
    const osc = ctx.createOscillator(); osc.setPeriodicWave(engineWave);
    const sub = ctx.createOscillator(); sub.type = "sine";
    const am = gainNode(0.7);
    const lfo = ctx.createOscillator(); lfo.type = "sine";
    const lfoDepth = gainNode(0.28);
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain);
    const subG = gainNode(0.45);
    osc.connect(am); sub.connect(subG); subG.connect(am);
    const lp = filt("lowpass", 900, 0.8);
    const exhaust = filt("peaking", 380, 1.1); exhaust.gain.value = 7;      // rezonance výfuku
    am.connect(lp); lp.connect(exhaust); exhaust.connect(out);
    // sání / mechanika: šum v pásmu, sílí pod plynem
    const intake = loopSource(noiseBuffer), intF = filt("bandpass", 1800, 0.8), intG = gainNode(0);
    intake.connect(intF); intF.connect(intG); intG.connect(out);
    out.connect(dest);
    // kola: hučení štěrku a šustění smyku
    const gravel = loopSource(brownBuffer), gravF = filt("lowpass", 520, 0.7), gravG = gainNode(0);
    gravel.connect(gravF); gravF.connect(gravG); gravG.connect(dest);
    const skid = loopSource(noiseBuffer), skidF = filt("bandpass", 1300, 1.4), skidG = gainNode(0);
    skid.connect(skidF); skidF.connect(skidG); skidG.connect(dest);

    osc.start(); sub.start(); lfo.start();
    return { out, osc, sub, lfo, lp, intG, gravF, gravG, skidG, dest, rpm: 900, gear: 0, load: 0, lastThrottle: false, popUntil: 0 };
  }

  // hranice rychlostních stupňů (podíl max. rychlosti), s hysterezí
  const GEARS = [0, 0.27, 0.5, 0.74, 1.12];

  // s: { speed (0..1+ podíl max. rychlosti), throttle, slip (boční skluz px/tik),
  //      rough (bláto/voda/tráva), air (ve vzduchu), boosting, on (ve hře), pan (-1..1) }
  function updateCar(id, s) {
    if (!ctx) return;
    let e = cars[id];
    if (!e) e = cars[id] = makeCar(s.pan);
    const t = ctx.currentTime;
    const on = s.on && !muted;
    const sp = Math.max(0, Math.min(1.15, s.speed || 0));

    // řazení s hysterezí
    while (e.gear < GEARS.length - 2 && sp > GEARS[e.gear + 1]) e.gear++;
    while (e.gear > 0 && sp < GEARS[e.gear] - 0.04) e.gear--;
    const lo = GEARS[e.gear], hi = GEARS[e.gear + 1];
    const frac = Math.max(0, Math.min(1, (sp - lo) / (hi - lo)));
    let target = sp < 0.03 ? (s.throttle ? 2100 : 950) : 2300 + frac * 4300;
    if (s.air && s.throttle) target = 7200;                  // ve vzduchu se kola protočí
    e.rpm += (target - e.rpm) * (target < e.rpm ? 0.35 : 0.18);
    const f0 = (e.rpm / 60) * 2;                              // 4válec boxer: 2 zápaly na otáčku
    e.load += ((s.throttle || s.boosting ? 1 : 0.25) - e.load) * 0.2;

    e.osc.frequency.setTargetAtTime(f0, t, 0.02);
    e.sub.frequency.setTargetAtTime(f0 / 2, t, 0.02);
    e.lfo.frequency.setTargetAtTime(f0 / 2, t, 0.02);
    e.lp.frequency.setTargetAtTime(260 + f0 * (3 + 4 * e.load) + (s.boosting ? 900 : 0), t, 0.03);
    e.out.gain.setTargetAtTime(on ? 0.06 + 0.07 * e.load + 0.03 * (e.rpm / 7000) : 0, t, 0.05);
    e.intG.gain.setTargetAtTime(on ? 0.035 * e.load * (e.rpm / 7000) : 0, t, 0.05);
    // štěrk: sílí s rychlostí, v blátě/vodě hlubší a vlhčí, ve vzduchu ticho
    const ground = on && !s.air ? 1 : 0;
    e.gravF.frequency.setTargetAtTime(s.rough ? 300 : 560, t, 0.1);
    e.gravG.gain.setTargetAtTime(ground * Math.min(1, sp * 1.2) * (s.rough ? 0.5 : 0.28), t, 0.08);
    e.skidG.gain.setTargetAtTime(ground * Math.max(0, Math.min(0.09, ((s.slip || 0) - 0.35) * 0.09)), t, 0.06);

    // prskání výfuku po puštění plynu ve vysokých otáčkách
    if (on && e.lastThrottle && !s.throttle && e.rpm > 4200) e.popUntil = t + 0.45;
    if (on && t < e.popUntil && Math.random() < 0.18) pop(e.dest);
    e.lastThrottle = !!s.throttle;
  }

  function pop(dest) {
    const t = ctx.currentTime + Math.random() * 0.03;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer;
    const f = filt("bandpass", 500 + Math.random() * 500, 1.2), g = gainNode(0);
    src.connect(f); f.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.18 + Math.random() * 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.start(t, Math.random()); src.stop(t + 0.08);
  }

  // zpětná kompatibilita: jednoduché volání jen s rychlostí
  function updateEngine(id, speedRatio, on) { updateCar(id, { speed: speedRatio, throttle: speedRatio > 0.1, on }); }

  function stopEngine(id) {
    const e = cars[id];
    if (!e || !ctx) return;
    const t = ctx.currentTime;
    for (const g of [e.out.gain, e.intG.gain, e.gravG.gain, e.skidG.gain]) g.setTargetAtTime(0, t, 0.12);
  }
  function stopAllEngines() { for (const id in cars) stopEngine(id); for (const id in nitros) setNitro(id, false); }

  /* ---------------- Nitro: syčení s hlubokým „hukotem" ---------------- */
  function setNitro(id, on) {
    if (!ctx) return;
    let n = nitros[id];
    if (on && !n) {
      const src = loopSource(noiseBuffer), f = filt("bandpass", 900, 0.6), g = gainNode(0);
      const rum = loopSource(brownBuffer), rf = filt("lowpass", 160), rg = gainNode(0);
      src.connect(f); f.connect(g); g.connect(master);
      rum.connect(rf); rf.connect(rg); rg.connect(master);
      n = nitros[id] = { g, rg };
    }
    if (!n) return;
    const t = ctx.currentTime;
    n.g.gain.setTargetAtTime(on && !muted ? 0.09 : 0, t, on ? 0.04 : 0.1);
    n.rg.gain.setTargetAtTime(on && !muted ? 0.35 : 0, t, on ? 0.04 : 0.15);
  }

  /* ---------------- Diváci ---------------- */
  function crowd(on) {
    if (!ctx) return;
    if (!crowdNode) {
      const a = loopSource(noiseBuffer), f1 = filt("bandpass", 700, 0.5), f2 = filt("bandpass", 2200, 0.9);
      const g = gainNode(0), mod = gainNode(0.6);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
      const lfoG = gainNode(0.25); lfo.connect(lfoG); lfoG.connect(mod.gain);
      a.connect(f1); f1.connect(mod); a.connect(f2); f2.connect(mod); mod.connect(g); g.connect(master);
      lfo.start();
      crowdNode = { g };
    }
    crowdNode.g.gain.setTargetAtTime(on && !muted ? 0.05 : 0, ctx.currentTime, 0.6);
  }
  function cheer() {
    if (!ready()) return;
    crowd(true);
    const t = ctx.currentTime, g = crowdNode.g.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.22, t + 0.35); g.setTargetAtTime(0.05, t + 0.8, 0.9);
  }

  /* ---------------- Jednorázové efekty ---------------- */
  function tone(freq, dur, type, vol, when, glideTo) {
    if (!ready()) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator(), g = gainNode(0);
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noiseHit(f, type, vol, dur, q) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer;
    const fl = filt(type, f, q), g = gainNode(0);
    src.connect(fl); fl.connect(g); g.connect(master);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  function collision() { noiseHit(400, "lowpass", 0.3, 0.16); tone(110, 0.12, "sine", 0.18); }

  // náraz do plastového mantinelu (dutý „bum") nebo dopad ze skoku (tupé žuchnutí)
  let lastImpact = 0;
  function impact(power, kind) {
    if (!ready()) return;
    const t = ctx.currentTime;
    if (t - lastImpact < 0.08) return;
    lastImpact = t;
    const vol = Math.min(0.4, 0.1 + power * 0.07);
    if (kind === "wall") { noiseHit(650, "bandpass", vol, 0.12, 1.4); tone(150, 0.14, "triangle", vol * 0.7, 0, 95); }
    else { noiseHit(240, "lowpass", vol, 0.22); tone(75, 0.2, "sine", vol, 0, 48); }
  }

  // startovní semafor: tři nižší tóny, pak vyšší dlouhý + jásot
  function countdownTick(n) {
    if (n > 0) tone(520, 0.22, "sine", 0.28);
    else { tone(1040, 0.6, "sine", 0.3); tone(1040 * 1.5, 0.6, "sine", 0.08); cheer(); }
  }

  function pickup(kind) {
    if (!ready()) return;
    if (kind === "money") { tone(1568, 0.09, "triangle", 0.18); tone(2093, 0.22, "triangle", 0.16, 0.07); }        // cinknutí mincí
    else if (kind === "nitro") { noiseHit(1200, "bandpass", 0.12, 0.25, 0.7); tone(440, 0.3, "sine", 0.16, 0, 880); } // „fšš" + stoupající tón
    else if (kind === "tires") { noiseHit(200, "lowpass", 0.25, 0.12); tone(660, 0.18, "triangle", 0.14, 0.05); }
    else { tone(330, 0.25, "sawtooth", 0.06, 0, 990); tone(660, 0.2, "sine", 0.14, 0.05, 1320); }                     // zrychlení
  }

  function finishFanfare() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => { tone(f, 0.35, "triangle", 0.22, i * 0.13); tone(f / 2, 0.35, "sine", 0.1, i * 0.13); });
    cheer();
  }

  function setMuted(m) {
    muted = m;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
    if (muted) stopAllEngines();
    return muted;
  }
  function toggleMute() { return setMuted(!muted); }
  function isMuted() { return muted; }

  global.Sound = {
    init, ready, updateCar, updateEngine, stopEngine, stopAllEngines,
    setNitro, collision, impact, countdownTick, finishFanfare, pickup, crowd, cheer,
    setMuted, toggleMute, isMuted,
  };
})(typeof window !== "undefined" ? window : globalThis);
