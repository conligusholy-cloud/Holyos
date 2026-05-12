// HolyOS — TSC driver (TC200, TE210, podobné)
//
// Čistý TCP socket bridge: pošle byty na (ip:port) a zavře spojení.
// TSC firmware (jak v ZPL emulaci, tak nativní TSPL) akceptuje raw socket
// bez handshake / odpovědi. Úspěch posuzujeme podle zápisu do socketu bez chyby.
//
// Tři režimy:
//   - sendZpl({ ip, port, zpl })       — ZPL string → UTF-8 bytes
//   - sendRaw({ ip, port, payload })   — libovolný Buffer (TSPL + BITMAP binární data,
//                                         emulace, byte stream)
//   - ping({ ip, port })               — TCP connect + close, měření latence

const net = require('net');

/**
 * Pošle raw byty na tiskárnu přes TCP socket. Univerzální — funguje pro ZPL,
 * TSPL, TSPL+BITMAP binární data, nebo cokoli jiného.
 *
 * @param {object} opts
 * @param {string}  opts.ip
 * @param {number}  opts.port
 * @param {Buffer}  opts.payload         - kompletní byte stream
 * @param {number}  [opts.timeoutMs=10000] - delší timeout, BITMAP joby jsou velké
 * @param {number}  [opts.drainMs=500]     - po write počkej, ať firmware doráží
 * @returns {Promise<{ok: boolean, latencyMs: number, bytes: number, error?: string}>}
 */
function sendRaw({ ip, port, payload, timeoutMs = 10000, drainMs = 500 }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);

    socket.once('error', (err) => {
      finish({ ok: false, bytes: 0, error: err.message });
    });

    socket.once('timeout', () => {
      finish({ ok: false, bytes: 0, error: `Timeout po ${timeoutMs} ms` });
    });

    socket.connect(port, ip, () => {
      socket.write(payload, (err) => {
        if (err) {
          finish({ ok: false, bytes: 0, error: err.message });
          return;
        }
        // TSC neposílá ACK — dáme tiskárně čas na zpracování velkých BITMAP jobů,
        // pak teprve socket zavřeme.
        setTimeout(() => {
          socket.end(() => finish({ ok: true, bytes: payload.length }));
        }, drainMs);
      });
    });
  });
}

/**
 * Pošle ZPL payload (string) na tiskárnu. Wrapper okolo sendRaw — UTF-8 encode.
 *
 * @param {object} opts
 * @param {string} opts.ip
 * @param {number} opts.port
 * @param {string} opts.zpl
 * @param {number} [opts.timeoutMs=5000]
 * @returns {Promise<{ok: boolean, latencyMs: number, bytes: number, error?: string}>}
 */
function sendZpl({ ip, port, zpl, timeoutMs = 5000 }) {
  return sendRaw({
    ip, port,
    payload: Buffer.from(zpl, 'utf8'),
    timeoutMs,
    drainMs: 200, // ZPL joby jsou typicky malé
  });
}

/**
 * Ping tiskárny — TCP connect + immediate close.
 * Indikuje dostupnost síťovým způsobem (neumí ověřit ZPL firmware).
 */
function ping({ ip, port, timeoutMs = 2000 }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', (err) => finish({ ok: false, error: err.message }));
    socket.once('timeout', () => finish({ ok: false, error: `Timeout po ${timeoutMs} ms` }));
    socket.connect(port, ip, () => finish({ ok: true }));
  });
}

module.exports = { sendZpl, sendRaw, ping };
