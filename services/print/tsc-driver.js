// HolyOS — TSC TC200 driver
//
// Čistý TCP socket bridge: pošle ZPL stream na (ip:port) a zavře spojení.
// TSC TC200 firmware v ZPL emulačním módu akceptuje ZPL přes raw TCP socket
// bez handshake / odpovědi. Úspěch posuzujeme podle zápisu do socketu bez chyby.
//
// Ping: otevře TCP spojení, okamžitě zavře. Měří latenci.

const net = require('net');

/**
 * Pošle ZPL payload na tiskárnu přes TCP socket.
 *
 * @param {object} opts
 * @param {string} opts.ip       - IP adresa tiskárny
 * @param {number} opts.port     - TCP port
 * @param {string} opts.zpl      - ZPL tělo (raw string)
 * @param {number} [opts.timeoutMs=5000] - timeout pro connect + send
 * @returns {Promise<{ok: boolean, latencyMs: number, bytes: number, error?: string}>}
 */
function sendZpl({ ip, port, zpl, timeoutMs = 5000 }) {
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
      const buf = Buffer.from(zpl, 'utf8');
      socket.write(buf, (err) => {
        if (err) {
          finish({ ok: false, bytes: 0, error: err.message });
          return;
        }
        // TSC TC200 neposílá ACK. Dáme jí 200 ms na zpracování
        // (malý ZPL se odbaví okamžitě) a socket zavřeme.
        setTimeout(() => {
          socket.end(() => finish({ ok: true, bytes: buf.length }));
        }, 200);
      });
    });
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

module.exports = { sendZpl, ping };
