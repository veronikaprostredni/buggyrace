/* =====================================================================
   IRON MAN OFFROAD RACING — síťový klient (net.js)
   Tenká obálka nad WebSocketem pro komunikaci s herním serverem.
   ===================================================================== */
(function (global) {
  "use strict";

  const Net = {
    ws: null,
    connected: false,
    you: null,
    code: null,
    handlers: {},

    on(type, fn) { this.handlers[type] = fn; return this; },
    _emit(type, data) { if (this.handlers[type]) this.handlers[type](data); },

    connect(onReady) {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/ws`;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        this._emit("error", { msg: "Nelze se připojit k serveru." });
        return;
      }
      this.ws.onopen = () => { this.connected = true; if (onReady) onReady(); };
      this.ws.onclose = () => { this.connected = false; this._emit("close", {}); };
      this.ws.onerror = () => { this._emit("error", { msg: "Chyba spojení se serverem." }); };
      this.ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === "joined") { this.you = m.you; this.code = m.code; }
        this._emit(m.t, m);
      };
    },

    send(obj) {
      if (this.ws && this.connected) this.ws.send(JSON.stringify(obj));
    },

    create(name) { this.send({ t: "create", name }); },
    join(code, name) { this.send({ t: "join", code, name }); },
    setOpts(o) { this.send(Object.assign({ t: "opts" }, o)); },
    start() { this.send({ t: "start" }); },
    again() { this.send({ t: "again" }); },
    sendInput(input) { this.send({ t: "input", input }); },
    close() { if (this.ws) this.ws.close(); },
  };

  global.Net = Net;
})(typeof window !== "undefined" ? window : globalThis);
