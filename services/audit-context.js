// HolyOS — kontext auditu (kdo / odkud změnu provedl) přes AsyncLocalStorage.
// requireAuth nastaví přihlášeného uživatele, workery si nastaví zdroj (např. „vypršení rezervace").
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
function setUser(u) { try { const s = als.getStore(); if (s) { s.user = u; } else { als.enterWith({ user: u }); } } catch (e) { /* best-effort */ } }
function runWithSource(source, fn) { return als.run({ source, user: null }, fn); }
function get() { return als.getStore() || {}; }
module.exports = { setUser, runWithSource, get };
