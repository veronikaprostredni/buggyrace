/* =====================================================================
   IRON MAN OFFROAD RACING — ZVUK (audio.js)
   Syntetizované zvuky přes Web Audio API (bez externích souborů):
   motor (výška dle rychlosti), nitro, nárazy, odpočet, cílová fanfára.
   AudioContext se vytvoří až po gestu uživatele (políčka prohlížečů).
   ===================================================================== */
(function (global) {
  "use strict";

  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuffer = null;
  const engines = {};   // id -> { osc1, osc2, filter, gain }
  const nitros = {};    // id -> { src, filter, gain }

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);

    // bílý šum pro nitro / náraz
    const len = ctx.sampleRate * 1.0;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function ready() { return ctx && !muted; }

  /* ---------------- Motor ---------------- */
  function ensureEngine(id, color) {
    if (!ctx || engines[id]) return engines[id];
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sawtooth"; osc2.type = "square";
    osc2.detune.value = -12;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 900;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc1.connect(filter); osc2.connect(filter);
    filter.connect(gain); gain.connect(master);
    osc1.start(); osc2.start();
    return (engines[id] = { osc1, osc2, filter, gain });
  }

  // speedRatio 0..1, on = auto je ve hře
  function updateEngine(id, speedRatio, on) {
    if (!ctx) return;
    const e = ensureEngine(id);
    if (!e) return;
    const t = ctx.currentTime;
    const base = 55 + speedRatio * 210;
    e.osc1.frequency.setTargetAtTime(base, t, 0.04);
    e.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
    e.filter.frequency.setTargetAtTime(500 + speedRatio * 2200, t, 0.05);
    e.gain.gain.setTargetAtTime(on ? 0.06 + speedRatio * 0.10 : 0, t, 0.08);
  }

  function stopEngine(id) {
    const e = engines[id];
    if (e && ctx) e.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
  }
  function stopAllEngines() { for (const id in engines) stopEngine(id); }

  /* ---------------- Nitro ---------------- */
  function setNitro(id, on) {
    if (!ctx) return;
    let n = nitros[id];
    if (on) {
      if (!n) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer; src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass"; filter.frequency.value = 1400; filter.Q.value = 0.8;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(filter); filter.connect(gain); gain.connect(master);
        src.start();
        n = nitros[id] = { src, filter, gain };
      }
      n.gain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.03);
    } else if (n) {
      n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    }
  }

  /* ---------------- Jednorázové efekty ---------------- */
  function blip(freq, dur, type, vol) {
    if (!ready()) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(master);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function collision() {
    if (!ready() || !noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 500;
    const g = ctx.createGain();
    src.connect(filter); filter.connect(g); g.connect(master);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.start(t); src.stop(t + 0.2);
  }

  function countdownTick(n) {
    if (n > 0) blip(440, 0.18, "square", 0.3);
    else blip(880, 0.5, "sawtooth", 0.35);   // GO!
  }

  function pickup(kind) {
    if (!ready()) return;
    // peníze = mincový dvojtón, ostatní = vzestupné blipnutí
    if (kind === "money") { blip(988, 0.08, "square", 0.22); setTimeout(() => blip(1319, 0.12, "square", 0.22), 70); }
    else { blip(660, 0.07, "triangle", 0.22); setTimeout(() => blip(1047, 0.12, "triangle", 0.22), 60); }
  }

  function finishFanfare() {
    if (!ready()) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => blip(f, 0.3, "triangle", 0.3), i * 130));
  }

  function setMuted(m) {
    muted = m;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
    if (muted) { stopAllEngines(); for (const id in nitros) setNitro(id, false); }
    return muted;
  }
  function toggleMute() { return setMuted(!muted); }
  function isMuted() { return muted; }

  global.Sound = {
    init, ready, updateEngine, stopEngine, stopAllEngines,
    setNitro, collision, countdownTick, finishFanfare, pickup,
    setMuted, toggleMute, isMuted,
  };
})(typeof window !== "undefined" ? window : globalThis);
