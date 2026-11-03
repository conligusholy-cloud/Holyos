// HolyOS — dešifrování zálohy databáze (stažený soubor z R2) pro pg_restore.
// Použití:  set BACKUP_ENC_KEY=...   node scripts/restore-backup.js db-backups-2026-11-05_0230.dump.enc obnova.dump
// Pak:      pg_restore --no-owner --clean --if-exists -d "<DATABASE_URL>" obnova.dump
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const [,, src, dst] = process.argv;
if (!src || !dst) { console.error('Použití: node scripts/restore-backup.js <vstup.dump.enc> <výstup.dump>'); process.exit(1); }
const k = process.env.BACKUP_ENC_KEY;
if (!k || k.length < 32) { console.error('Nastav BACKUP_ENC_KEY (stejný klíč, kterým se zálohovalo).'); process.exit(1); }
const key = crypto.createHash('sha256').update('backup:' + k).digest();
const size = fs.statSync(src).size;
const fd = fs.openSync(src, 'r');
const head = Buffer.alloc(18); fs.readSync(fd, head, 0, 18, 0);
if (head.subarray(0, 6).toString() !== 'HOSBK1') { console.error('Soubor nemá správnou hlavičku zálohy HolyOS.'); process.exit(1); }
const iv = head.subarray(6, 18);
const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
const inp = fs.createReadStream(src, { start: 18, end: size - 17 });
const out = fs.createWriteStream(dst);
inp.pipe(d).pipe(out);
d.on('error', () => { console.error('Dešifrování selhalo — špatný klíč nebo poškozený soubor.'); process.exit(2); });
out.on('finish', () => console.log('Hotovo:', dst));
