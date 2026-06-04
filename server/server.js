/* =====================================================================
   IRON MAN OFFROAD RACING — herní server
   - servíruje statické soubory hry
   - autoritativní simulace (sim.js) běží na serveru
   - lobby s místnostmi (kód), každý hráč na svém zařízení
   Bez externích závislostí (jen vestavěné moduly Node + server/ws.js).
   ===================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ws = require("./ws");
const IMR = require("../js/sim");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 3000;
const FIXED_DT = IMR.FIXED_DT;
const TICK_MS = 1000 / 60;
const BROADCAST_EVERY = 3;          // posílat stav každý 3. tik (~20 Hz)
const PLAYER_COLORS = ["#e8473b", "#3b82e8", "#34c759", "#a855f7", "#f59e0b", "#22d3ee"];
const AI_COLORS = ["#f59e0b", "#34c759", "#a855f7", "#22d3ee"];
const AI_NAMES = ["CPU Rudák", "CPU Bleskoun", "CPU Drtič", "CPU Liška"];
const AI_SKILL = { easy: 0.62, normal: 0.82, hard: 0.96 };

/* ---------------- Statické soubory ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".ico": "image/x-icon" };

const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

/* ---------------- Místnosti ---------------- */
const rooms = new Map();   // code -> room
let pidSeq = 1;

function makeCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makeRoom(hostConn, hostName) {
  const code = makeCode();
  const room = {
    code,
    hostId: null,
    players: new Map(),     // pid -> { id, name, color, conn, input }
    order: [],              // pořadí pid pro přidělení barev
    opts: { trackIndex: 0, laps: 3, aiCount: 0, aiDifficulty: "normal" },
    phase: "lobby",
    world: null,
    countdown: 0,
    tick: 0,
    loop: null,
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, conn, name) {
  const pid = "p" + (pidSeq++);
  const color = PLAYER_COLORS[room.order.length % PLAYER_COLORS.length];
  const player = { id: pid, name: name || "Hráč", color, conn, input: emptyInput() };
  room.players.set(pid, player);
  room.order.push(pid);
  if (!room.hostId) room.hostId = pid;
  conn.pid = pid;
  conn.roomCode = room.code;
  return player;
}

function emptyInput() { return { up: false, down: false, left: false, right: false, nitro: false }; }

function lobbyPayload(room) {
  return {
    t: "lobby",
    code: room.code,
    hostId: room.hostId,
    opts: room.opts,
    tracks: IMR.TRACKS.map((t) => ({ name: t.name, difficulty: t.difficulty })),
    players: room.order.map((pid) => {
      const p = room.players.get(pid);
      return { id: pid, name: p.name, color: p.color, host: pid === room.hostId };
    }),
  };
}

function broadcast(room, obj) {
  const s = JSON.stringify(obj);
  for (const p of room.players.values()) if (p.conn && !p.conn.closed) p.conn.sendText(s);
}

function broadcastLobby(room) { broadcast(room, lobbyPayload(room)); }

/* ---------------- Spuštění závodu ---------------- */
function startRace(room) {
  const cars = [];
  for (const pid of room.order) {
    const p = room.players.get(pid);
    p.input = emptyInput();
    cars.push(new IMR.Car({ id: pid, name: p.name, color: p.color }));
  }
  for (let i = 0; i < room.opts.aiCount; i++) {
    cars.push(new IMR.Car({
      id: "ai" + i, name: AI_NAMES[i % AI_NAMES.length], color: AI_COLORS[i % AI_COLORS.length],
      isAI: true, aiSkill: AI_SKILL[room.opts.aiDifficulty] || 0.82,
    }));
  }
  const trackDef = IMR.TRACKS[room.opts.trackIndex] || IMR.TRACKS[0];
  room.world = new IMR.World(trackDef, cars, room.opts.laps);
  room.world.running = false;
  room.phase = "countdown";
  room.countdown = 3.999;
  room.tick = 0;

  broadcast(room, {
    t: "raceStart",
    trackIndex: room.opts.trackIndex,
    laps: room.opts.laps,
    cars: cars.map((c) => ({ id: c.id, name: c.name, color: c.color, isAI: c.isAI })),
  });

  if (room.loop) clearInterval(room.loop);
  room.loop = setInterval(() => gameLoop(room), TICK_MS);
}

function gameLoop(room) {
  const w = room.world;
  if (!w) return;

  if (room.phase === "countdown") {
    room.countdown -= FIXED_DT;
    if (room.countdown <= 1 && !w.running) w.running = true;
    if (room.countdown <= 0) room.phase = "race";
  }

  if (w.running) {
    const inputs = {};
    for (const p of room.players.values()) inputs[p.id] = p.input;
    w.tick(inputs);
  }

  if (room.phase === "race" && w.allFinished()) {
    finishRace(room);
    return;
  }

  room.tick++;
  if (room.tick % BROADCAST_EVERY === 0 || room.phase === "countdown") {
    broadcast(room, statePayload(room));
  }
}

function statePayload(room) {
  const w = room.world;
  return {
    t: "state",
    phase: room.phase,
    time: w.time,
    countdown: room.countdown,
    cars: w.cars.map((c) => ({
      id: c.id, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10,
      a: Math.round(c.angle * 1000) / 1000, b: c.boosting ? 1 : 0,
      sp: Math.round(c.speed * 100) / 100,
      lg: c.lapGates, ng: c.nextGate, f: c.finished ? 1 : 0,
      n: Math.round(c.nitro), nt: Math.round(c.phys.nitroTank),
    })),
    pickups: w.pickups.filter((p) => p.active).map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y })),
  };
}

function finishRace(room) {
  room.phase = "finished";
  const ranking = room.world.ranking().map((c) => ({
    id: c.id, name: c.name, color: c.color, finished: c.finished,
    finishTime: c.finishTime, isAI: c.isAI,
  }));
  broadcast(room, statePayload(room));
  broadcast(room, { t: "finished", ranking });
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
}

function backToLobby(room) {
  room.phase = "lobby";
  room.world = null;
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
  broadcastLobby(room);
}

/* ---------------- Zpracování zpráv ---------------- */
function handleMessage(conn, msg) {
  let m;
  try { m = JSON.parse(msg); } catch (e) { return; }

  if (m.t === "create") {
    const room = makeRoom(conn, m.name);
    const p = addPlayer(room, conn, m.name);
    conn.sendJSON({ t: "joined", code: room.code, you: p.id });
    broadcastLobby(room);
    return;
  }

  if (m.t === "join") {
    const room = rooms.get((m.code || "").toUpperCase());
    if (!room) { conn.sendJSON({ t: "error", msg: "Místnost nenalezena." }); return; }
    if (room.phase !== "lobby") { conn.sendJSON({ t: "error", msg: "Závod už běží." }); return; }
    if (room.order.length >= 6) { conn.sendJSON({ t: "error", msg: "Místnost je plná." }); return; }
    const p = addPlayer(room, conn, m.name);
    conn.sendJSON({ t: "joined", code: room.code, you: p.id });
    broadcastLobby(room);
    return;
  }

  const room = rooms.get(conn.roomCode);
  if (!room) return;
  const player = room.players.get(conn.pid);
  if (!player) return;

  if (m.t === "opts" && conn.pid === room.hostId && room.phase === "lobby") {
    const o = room.opts;
    if (typeof m.trackIndex === "number") o.trackIndex = Math.max(0, Math.min(IMR.TRACKS.length - 1, m.trackIndex | 0));
    if (typeof m.laps === "number") o.laps = Math.max(1, Math.min(9, m.laps | 0));
    if (typeof m.aiCount === "number") o.aiCount = Math.max(0, Math.min(4, m.aiCount | 0));
    if (typeof m.aiDifficulty === "string") o.aiDifficulty = m.aiDifficulty;
    broadcastLobby(room);
    return;
  }

  if (m.t === "start" && conn.pid === room.hostId && room.phase === "lobby") {
    startRace(room);
    return;
  }

  if (m.t === "input" && m.input) {
    player.input = {
      up: !!m.input.up, down: !!m.input.down, left: !!m.input.left,
      right: !!m.input.right, nitro: !!m.input.nitro,
    };
    return;
  }

  if (m.t === "again" && conn.pid === room.hostId && room.phase === "finished") {
    backToLobby(room);
    return;
  }
}

function handleClose(conn) {
  const room = rooms.get(conn.roomCode);
  if (!room) return;
  room.players.delete(conn.pid);
  room.order = room.order.filter((pid) => pid !== conn.pid);
  if (room.players.size === 0) {
    if (room.loop) clearInterval(room.loop);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === conn.pid) room.hostId = room.order[0];
  if (room.phase === "lobby") broadcastLobby(room);
}

/* ---------------- Start ---------------- */
ws.attach(httpServer, (conn) => {
  conn.onmessage = (msg) => handleMessage(conn, msg);
  conn.onclose = () => handleClose(conn);
});

httpServer.listen(PORT, () => {
  console.log(`Iron Man Offroad Racing server běží na http://localhost:${PORT}`);
});
