// =============================================================================
// HolyOS — Storage routes (nahrávání souborů, obrázky)
// =============================================================================

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { requireAuth } = require('../middleware/auth');

// Složka pro ukládání souborů
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'data', 'storage');

// Zajistit existenci složky
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// GET /api/storage/files/:filename — stáhnout/zobrazit soubor (VEŘEJNÉ — pro <img src>)
router.get('/files/:filename(*)', async (req, res, next) => {
  try {
    const filePath = path.join(STORAGE_DIR, req.params.filename);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(403).json({ error: 'Přístup zamítnut' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Soubor nenalezen' });
    }
    // Cache 1 hodina
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(resolved);
  } catch (err) { next(err); }
});

// Všechny ostatní operace vyžadují auth
router.use(requireAuth);

// POST /api/storage/upload — nahrání souboru (base64)
router.post('/upload', async (req, res, next) => {
  try {
    const { file_data, file_name, file_type, folder } = req.body;

    if (!file_data || !file_name) {
      return res.status(400).json({ error: 'Chybí file_data nebo file_name' });
    }

    // Vytvořit podsložku pokud zadáno
    const targetDir = folder ? path.join(STORAGE_DIR, folder) : STORAGE_DIR;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Unikátní název
    const ext = path.extname(file_name);
    const uniqueName = `${uuidv4()}${ext}`;
    const filePath = path.join(targetDir, uniqueName);

    // Uložit base64 data
    const buffer = Buffer.from(file_data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const relativePath = folder ? `${folder}/${uniqueName}` : uniqueName;

    res.status(201).json({
      file_name: uniqueName,
      original_name: file_name,
      file_type: file_type || null,
      file_size: buffer.length,
      path: relativePath,
      url: `/api/storage/files/${relativePath}`,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/storage/files/:filename
router.delete('/files/:filename(*)', async (req, res, next) => {
  try {
    const filePath = path.join(STORAGE_DIR, req.params.filename);
    const resolved = path.resolve(filePath);

    if (!resolved.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(403).json({ error: 'Přístup zamítnut' });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/storage/list — seznam souborů ve složce
router.get('/list', async (req, res, next) => {
  try {
    const { folder } = req.query;
    const targetDir = folder ? path.join(STORAGE_DIR, folder) : STORAGE_DIR;

    const resolved = path.resolve(targetDir);
    if (!resolved.startsWith(path.resolve(STORAGE_DIR))) {
      return res.status(403).json({ error: 'Přístup zamítnut' });
    }

    if (!fs.existsSync(targetDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(targetDir).map(name => {
      const stat = fs.statSync(path.join(targetDir, name));
      return {
        name,
        size: stat.size,
        is_directory: stat.isDirectory(),
        modified_at: stat.mtime,
      };
    });

    res.json(files);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
