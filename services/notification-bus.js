// =============================================================================
// HolyOS — Notification Bus (SSE stream, in-memory fanout)
// =============================================================================
// Jednoduché pub/sub pro push notifikací a zpráv klientům přes SSE.
// Každý připojený prohlížeč má otevřené SSE spojení a podepsaný user_id.
// Když kdekoli v back-endu vznikne nová zpráva/notifikace, zavolá se publish()
// a všichni adresáti (podle user_id) dostanou event přes otevřený kanál.
//
// Omezení: in-memory, funguje jen v jedné Node instanci. Pro více instancí
// bude potřeba externí broker (Redis Pub/Sub). Pro Railway single-instance stačí.
// =============================================================================

const EventEmitter = require('events');

class NotificationBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0); // nelimitovat počet posluchačů
    // Map<userId, Set<res>>  — otevřená SSE spojení na uživatele
    this.clients = new Map();
  }

  // Registruj nové SSE spojení pro uživatele
  addClient(userId, res) {
    if (!this.clients.has(userId)) this.clients.set(userId, new Set());
    this.clients.get(userId).add(res);
  }

  // Odregistruj spojení (při zavření)
  removeClient(userId, res) {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.clients.delete(userId);
  }

  // Odešli event konkrétnímu uživateli (všem jeho otevřeným tabům)
  publishToUser(userId, eventName, payload) {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return 0;
    const data = JSON.stringify(payload);
    let delivered = 0;
    for (const res of set) {
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${data}\n\n`);
        delivered++;
      } catch (_) {
        // broken pipe — vyčistí se přes close event
      }
    }
    return delivered;
  }

  // Odešli event seznamu uživatelů
  publishToUsers(userIds, eventName, payload) {
    let total = 0;
    for (const uid of userIds) total += this.publishToUser(uid, eventName, payload);
    return total;
  }

  // Broadcast (všichni připojení)
  publishToAll(eventName, payload) {
    let total = 0;
    for (const [uid] of this.clients) total += this.publishToUser(uid, eventName, payload);
    return total;
  }

  // Debug
  stats() {
    let connections = 0;
    for (const set of this.clients.values()) connections += set.size;
    return { users: this.clients.size, connections };
  }

  // ─── Presence ─────────────────────────────────────────────────────────────
  // Přítomný = má alespoň jedno otevřené SSE spojení.
  isOnline(userId) {
    const set = this.clients.get(userId);
    return !!(set && set.size > 0);
  }

  onlineUserIds() {
    return Array.from(this.clients.keys());
  }
}

// Singleton
const bus = new NotificationBus();

module.exports = bus;
