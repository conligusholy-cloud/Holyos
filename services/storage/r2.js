// =============================================================================
// HolyOS — Cloudflare R2 storage helper
// =============================================================================
// S3-kompatibilní client pro Cloudflare R2 bucket (holyos-chat-rw).
// Použití:
//   const { putObject, buildKey } = require('../services/storage/r2');
//   const key = buildKey('chat', channelId, fileExt);
//   const { url, key } = await putObject(key, buffer, mime);
//   // url je veřejná, mobile klient si fotku stáhne přímo z R2.dev CDN.
//
// ENV proměnné (viz .env + Railway):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com),
//   R2_BUCKET (holyos-chat-rw),
//   R2_PUBLIC_URL (https://pub-XXX.r2.dev).

const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const REGION = 'auto'; // R2 vyžaduje "auto", ne us-east-1 jako klasické S3

let _client = null;

/**
 * Lazy-inicializovaný S3 client. Pokud chybí ENV proměnné, vrátí null —
 * volající si pak může rozhodnout, jestli to je fatal nebo fallback na
 * jiné storage (např. Railway volume v dev).
 */
function getClient() {
  if (_client) return _client;
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.warn('[r2] Chybí ENV proměnné R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY — R2 storage je vypnutý');
    return null;
  }
  _client = new S3Client({
    region: REGION,
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // R2 chce path-style URLs, ne virtual-hosted
  });
  return _client;
}

/**
 * Postaví unikátní klíč pro objekt v bucketu.
 *   prefix:    "chat" — top-level prefix (chat, products, atd.)
 *   scope:     channel_id, product_id apod. — separace per-resource
 *   ext:       přípona (".jpg", ".pdf", "" pokud neznámá)
 * Výsledek: "chat/<channel_id>/<uuid><ext>"
 */
function buildKey(prefix, scope, ext) {
  const safeExt = ext ? (ext.startsWith('.') ? ext : '.' + ext) : '';
  const uuid = crypto.randomUUID();
  return `${prefix}/${scope}/${uuid}${safeExt.toLowerCase()}`;
}

/**
 * Uploadne buffer do R2 pod daný key. Vrátí { key, url, size }.
 * url je public URL z R2_PUBLIC_URL prefix — mobile klient si fotku stáhne
 * přímo (bez backendu).
 *
 * @param {string} key — cesta v bucketu, např. "chat/<id>/<uuid>.jpg"
 * @param {Buffer} buffer — obsah souboru
 * @param {string} contentType — MIME type, např. "image/jpeg"
 */
async function putObject(key, buffer, contentType) {
  const client = getClient();
  if (!client) {
    const err = new Error('R2 storage není nakonfigurovaný (chybí ENV)');
    err.status = 503;
    throw err;
  }
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    const err = new Error('R2_BUCKET není nastavený');
    err.status = 503;
    throw err;
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    // CacheControl pro statické soubory v R2 — fotka se nikdy nemění (UUID v cestě)
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const url = publicBase ? `${publicBase}/${key}` : null;
  return { key, url, size: buffer.length };
}

/**
 * Smaže objekt z R2 (např. při delete attachmentu). Tichý fail, ne fatal.
 */
async function deleteObject(key) {
  const client = getClient();
  if (!client) return false;
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }));
    return true;
  } catch (err) {
    console.warn('[r2] Smazání objektu selhalo:', key, err.message);
    return false;
  }
}

/**
 * Pomocná funkce: z mime type určí, jestli jde o obrázek (kind: 'image')
 * nebo cokoli jiného (kind: 'file').
 */
function kindFromMime(mime) {
  if (typeof mime === 'string' && mime.startsWith('image/')) return 'image';
  return 'file';
}

/**
 * Pomocná funkce: z mime type nebo původního názvu vrátí přípona souboru.
 *   "image/jpeg" → ".jpg"
 *   "application/pdf" → ".pdf"
 *   "soubor.pdf" → ".pdf"
 *   neznámé → ""
 */
function extFromMimeOrName(mime, name) {
  const MIME_EXT = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt',
  };
  if (mime && MIME_EXT[mime]) return MIME_EXT[mime];
  if (typeof name === 'string') {
    const m = name.match(/\.[a-z0-9]{1,5}$/i);
    if (m) return m[0].toLowerCase();
  }
  return '';
}

module.exports = {
  getClient,
  putObject,
  deleteObject,
  buildKey,
  kindFromMime,
  extFromMimeOrName,
};
