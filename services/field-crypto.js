// HolyOS — Šifrování citlivých polí v databázi (AES-256-GCM)
// Zapíná se proměnnou FIELD_ENC_KEY (min. 32 znaků). Bez ní je vše průchozí (nic se nešifruje ani nedešifruje —
// jen už zašifrované hodnoty zůstanou nečitelné, proto klíč NIKDY neměnit ani neztrácet a mít zálohovaný mimo Railway).
// Formát uložené hodnoty: "enc1:" + base64(iv12 | tag16 | ciphertext). Hodnoty bez prefixu jsou čistý text (starší data).
'use strict';
const crypto = require('crypto');

const PREFIX = 'enc1:';
const SENSITIVE_PERSON = ['birth_number', 'id_card_number', 'bank_account'];

function keyBuf() {
  const k = process.env.FIELD_ENC_KEY;
  if (!k || k.length < 32) return null;
  return crypto.createHash('sha256').update('field:' + k).digest();
}
const enabled = () => !!keyBuf();
const isEnc = (v) => typeof v === 'string' && v.startsWith(PREFIX);

function encryptValue(v) {
  if (v === null || v === undefined || v === '' || typeof v !== 'string' || isEnc(v)) return v;
  const key = keyBuf(); if (!key) return v;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decryptValue(v) {
  if (!isEnc(v)) return v;
  const key = keyBuf(); if (!key) return v; // bez klíče nelze dešifrovat → vrátí se šifra (nečitelná)
  try {
    const raw = Buffer.from(v.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (e) { return v; }
}

// Pro audit log: citlivá pole se do snapshotů/změn ukládají zašifrovaná (rollback je vrátí zpět beze změny)
function redactForAudit(obj) {
  if (!obj || typeof obj !== 'object' || !enabled()) return obj;
  const out = Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
  for (const f of SENSITIVE_PERSON) {
    if (!(f in out)) continue;
    const val = out[f];
    if (val && typeof val === 'object' && ('from' in val || 'to' in val)) out[f] = { from: encryptValue(val.from), to: encryptValue(val.to) };
    else out[f] = encryptValue(val);
  }
  return out;
}

// Prisma rozšíření: model Person — šifruje při zápisu, dešifruje výsledky dotazů nad Person
function personExtension() {
  const encData = (d) => {
    if (!d || typeof d !== 'object') return d;
    for (const f of SENSITIVE_PERSON) {
      if (!(f in d)) continue;
      const v = d[f];
      if (typeof v === 'string') d[f] = encryptValue(v);
      else if (v && typeof v === 'object' && typeof v.set === 'string') d[f] = { set: encryptValue(v.set) };
    }
    return d;
  };
  const decRow = (r) => {
    if (!r || typeof r !== 'object') return r;
    for (const f of SENSITIVE_PERSON) if (f in r) r[f] = decryptValue(r[f]);
    return r;
  };
  return {
    name: 'field-crypto-person',
    query: {
      person: {
        async $allOperations({ operation, args, query }) {
          if (!enabled()) return query(args);
          const a = args || {};
          if (enabled()) {
            if (operation === 'create' || operation === 'update' || operation === 'updateMany') encData(a.data);
            if (operation === 'upsert') { encData(a.create); encData(a.update); }
            if (operation === 'createMany' && Array.isArray(a.data)) a.data.forEach(encData);
          }
          const res = await query(a);
          if (Array.isArray(res)) res.forEach(decRow); else decRow(res);
          return res;
        },
      },
    },
  };
}

// Jednorázové (idempotentní) zašifrování stávajících záznamů — běží po startu, jen když je klíč nastaven.
// basePrisma = klient BEZ rozšíření (vidí surové hodnoty v DB), extPrisma = klient s rozšířením (při zápisu šifruje).
async function encryptExistingPeople(basePrisma, extPrisma) {
  if (!enabled()) return { skipped: true };
  const rows = await basePrisma.person.findMany({ select: { id: true, birth_number: true, id_card_number: true, bank_account: true } });
  let changed = 0;
  for (const r of rows) {
    const data = {};
    for (const f of SENSITIVE_PERSON) if (r[f] && !isEnc(r[f])) data[f] = r[f];
    if (!Object.keys(data).length) continue;
    await extPrisma.person.update({ where: { id: r.id }, data }); // rozšíření hodnoty zašifruje
    changed++;
  }
  return { checked: rows.length, encrypted: changed };
}

module.exports = { encryptExistingPeople, enabled, isEnc, encryptValue, decryptValue, redactForAudit, personExtension, SENSITIVE_PERSON };
