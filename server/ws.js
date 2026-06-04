/* =====================================================================
   Minimální WebSocket server (RFC 6455) — bez externích závislostí.
   Stačí pro herní zprávy: textové rámce, ping/pong, close.
   ===================================================================== */
"use strict";
const crypto = require("crypto");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function accept(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.onmessage = null;
    this.onclose = null;
    this.closed = false;
    socket.on("data", (d) => this._onData(d));
    socket.on("close", () => this._close());
    socket.on("error", () => this._close());
  }

  _onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this._parseFrame()) { /* zpracuj všechny kompletní rámce */ }
  }

  _parseFrame() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      len = Number(b.readBigUInt64BE(2)); offset = 10;
    }
    let maskKey;
    if (masked) {
      if (b.length < offset + 4) return false;
      maskKey = b.slice(offset, offset + 4); offset += 4;
    }
    if (b.length < offset + len) return false;
    let payload = b.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this.buf = b.slice(offset + len);

    if (opcode === 0x8) { this.close(); return false; }      // close
    if (opcode === 0x9) { this._send(payload, 0xA); return true; } // ping -> pong
    if (opcode === 0xA) return true;                          // pong
    if (opcode === 0x1 && fin) {                              // text
      if (this.onmessage) {
        try { this.onmessage(payload.toString("utf8")); } catch (e) { /* ignore */ }
      }
    }
    return true;
  }

  _send(data, opcode) {
    if (this.closed) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, data])); } catch (e) { this._close(); }
  }

  sendText(str) { this._send(Buffer.from(str, "utf8"), 0x1); }
  sendJSON(obj) { this.sendText(JSON.stringify(obj)); }

  close() {
    if (this.closed) return;
    try { this._send(Buffer.alloc(0), 0x8); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
    this._close();
  }

  _close() {
    if (this.closed) return;
    this.closed = true;
    if (this.onclose) this.onclose();
  }
}

// Připojí WS handler k existujícímu http serveru.
function attach(httpServer, onConnection) {
  httpServer.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + accept(key),
      "\r\n",
    ];
    socket.write(headers.join("\r\n"));
    const conn = new Conn(socket);
    onConnection(conn, req);
  });
}

module.exports = { attach, Conn };
