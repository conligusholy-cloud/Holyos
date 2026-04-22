// =============================================================================
// HolyOS — CAD výkresy (SolidWorks import)
// REST endpointy pro desktop klienta (kontextové menu "Odevzdat do výroby")
// i pro webový modul cad-vykresy.
//
// Kompatibilita s původním Factorify tokem (CadExporter):
//   GET  /api/cad/project-blocks   — strom projektů + bloků
//   POST /api/cad/drawings-import  — hlavní upload (výkres + metadata + PNG/PDF)
// Navíc:
//   GET  /api/cad/drawings         — vyhledávání
//   GET  /api/cad/drawings/:id     — detail + konfigurace + kusovník
//   POST /api/cad/upload-asset     — samostatný upload binárky (PDF/PNG)
//                                    — vrací path, který se pak referencuje
//                                      v drawings-import místo Base64 payloadu
//   GET  /api/cad/assets/:token    — servírování uloženého PDF/PNG
// =============================================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { prisma } = require('../config/database');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');

// ─── Úložiště pro PDF/PNG ────────────────────────────────────────────────────
// Na Railway persistent volume /app/data/cad-assets, lokálně ./data/cad-assets.

const ASSET_ROOT = process.env.CAD_ASSET_ROOT
  || (process.env.DATA_ROOT ? path.join(process.env.DATA_ROOT, 'cad-assets')
                            : path.join(__dirname, '..', 'data', 'cad-assets'));

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(ASSET_ROOT);

/**
 * Uloží Base64 payload do souboru a vrátí relativní cestu (bez ASSET_ROOT).
 * Cesta má tvar YYYY/MM/<sha256>.<ext>.
 */
function saveBase64Asset(base64, ext) {
  if (!base64) return null;
  const raw = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64');
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  const d = new Date();
  const sub = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(ASSET_ROOT, sub);
  ensureDir(dir);
  const rel = `${sub}/${sha}.${ext}`;
  const full = path.join(ASSET_ROOT, rel);
  if (!fs.existsSync(full)) fs.writeFileSync(full, raw);
  return rel;
}

function absAssetPath(rel) {
  if (!rel) return null;
  // Ochrana proti path traversal
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(ASSET_ROOT, safe);
  if (!full.startsWith(ASSET_ROOT)) return null;
  return full;
}

// ─── Autentizace pro všechny CAD endpointy ──────────────────────────────────
// Čtení je otevřené všem přihlášeným (web CAD modul, seznam projektů ve Bridge).
// Zápis (upload nových výkresů, založení projektu) vyžaduje buď super admin,
// nebo flag Person.can_upload_cad na připojeném Person záznamu.
router.use(requireAuth);

async function requireCadWrite(req, res, next) {
  try {
    // Super admin má vždy plný přístup
    if (req.user && req.user.isSuperAdmin) return next();

    // Jinak si najdeme navázaný Person a zkontrolujeme flag can_upload_cad.
    // (req.user.person už může být načten z requireAuth middleware.)
    let person = req.user && req.user.person;
    if (!person && req.user && req.user.id) {
      person = await prisma.person.findFirst({ where: { user_id: req.user.id } });
    }

    if (person && person.can_upload_cad === true) return next();

    return res.status(403).json({
      error: 'Pro nahrávání CAD výkresů je potřeba oprávnění. Požádej admina, ať ti v Lidé a HR zaškrtne „Může vkládat CAD".',
    });
  } catch (err) {
    next(err);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/cad/project-blocks — strom projektů + bloků
//
// Stejný tvar odpovědi, jaký používal desktop CadExporter (pole projects
// s vnořeným polem blocks → children). Desktop klient si z toho staví strom
// v "SubmitPreview" dialogu (výběr cílového bloku).
// ───────────────────────────────────────────────────────────────────────────
router.get('/project-blocks', async (req, res, next) => {
  try {
    const projects = await prisma.cadProject.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      include: {
        blocks: {
          orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
          select: {
            id: true, project_id: true, parent_id: true,
            name: true, label: true, sort_order: true,
          },
        },
      },
    });

    // Sestavíme strom bloků pro každý projekt (parent_id → children)
    const withTree = projects.map(p => {
      const byId = new Map(p.blocks.map(b => [b.id, { ...b, children: [] }]));
      const roots = [];
      for (const b of byId.values()) {
        if (b.parent_id && byId.has(b.parent_id)) {
          byId.get(b.parent_id).children.push(b);
        } else {
          roots.push(b);
        }
      }
      return {
        Id: p.id,
        Code: p.code,
        Name: p.name,
        Customer: p.customer,
        Blocks: roots,
      };
    });

    res.json({ Projects: withTree, Success: true });
  } catch (err) {
    next(err);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/cad/drawings — seznam / fulltext
// Query: ?q=...&projectId=...&blockId=...&extension=sldasm
// ───────────────────────────────────────────────────────────────────────────
router.get('/drawings', async (req, res, next) => {
  try {
    const { q, projectId, blockId, extension, limit } = req.query;
    const where = {};
    if (projectId) where.project_id = parseInt(projectId);
    if (blockId) where.block_id = parseInt(blockId);
    if (extension) where.extension = String(extension).toLowerCase();
    if (q) {
      where.OR = [
        { file_name: { contains: String(q), mode: 'insensitive' } },
        { title: { contains: String(q), mode: 'insensitive' } },
        { description: { contains: String(q), mode: 'insensitive' } },
      ];
    }

    const drawings = await prisma.cadDrawing.findMany({
      where,
      take: Math.min(parseInt(limit) || 100, 500),
      orderBy: [{ last_import_at: 'desc' }],
      include: {
        project: { select: { id: true, code: true, name: true } },
        block:   { select: { id: true, name: true } },
        creator: { select: { id: true, first_name: true, last_name: true, email: true } },
        configurations: {
          select: { id: true, config_name: true, quantity: true, png_path: true, pdf_path: true, stl_path: true },
        },
      },
    });
    res.json(drawings);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/cad/drawings/:id — detail + konfigurace + kusovník
// ───────────────────────────────────────────────────────────────────────────
router.get('/drawings/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatné ID' });

    const drawing = await prisma.cadDrawing.findUnique({
      where: { id },
      include: {
        project: true,
        block: true,
        creator: { select: { id: true, first_name: true, last_name: true } },
        configurations: {
          include: {
            components: {
              include: {
                material: { select: { id: true, code: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!drawing) return res.status(404).json({ error: 'Výkres nenalezen' });
    res.json(drawing);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/cad/assets/* — servírování uloženého PDF/PNG
// Path: /api/cad/assets/2026/04/<sha>.pdf
// ───────────────────────────────────────────────────────────────────────────
router.get('/assets/*', (req, res) => {
  const rel = req.params[0];
  const full = absAssetPath(rel);
  if (!full || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Asset nenalezen' });
  }
  const ext = path.extname(full).toLowerCase();
  const mime = ext === '.pdf' ? 'application/pdf'
             : ext === '.png' ? 'image/png'
             : ext === '.stl' ? 'model/stl'
             : 'application/octet-stream';
  res.type(mime);
  // Assety jsou adresovane hashem (immutable) — drz je v browser cache 30 dni.
  // Druhe otevreni stejneho STL/PDF = 0 bajtu z Holyosu.
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  fs.createReadStream(full).pipe(res);
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/cad/upload-asset — samostatný upload PDF/PNG (Base64 v JSONu)
// Body: { filename, contentBase64, kind: 'pdf'|'png' }
// Response: { path, url }
// Doporučeno pro desktop klienta: neposílat velké Base64 v drawings-import,
// nejdřív nahrát přes tento endpoint a v drawings-import referencovat jen path.
// ───────────────────────────────────────────────────────────────────────────
const uploadAssetSchema = z.object({
  filename: z.string().optional(),
  kind: z.enum(['pdf', 'png', 'stl']),
  contentBase64: z.string().min(1),
});
router.post('/upload-asset', requireCadWrite, async (req, res, next) => {
  try {
    const parsed = uploadAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const rel = saveBase64Asset(parsed.data.contentBase64, parsed.data.kind);
    res.json({ path: rel, url: `/api/cad/assets/${rel}` });
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/cad/drawings-import — hlavní endpoint (kompatibilní s CadExporter)
//
// Payload (zjednodušeno oproti původnímu CadExporteru — kompatibilní):
// {
//   Project: { Id? | Code? },
//   goodsBlockId: number?,            // volitelné, kam výkres přiřadit
//   overwrite: boolean?,              // přepsat stejnou verzi
//   DrawingFiles: [
//     {
//       Name, DrawingFileName, RelativePath?, Extension,
//       Version?, SourcePath?,
//       Configurations: [
//         {
//           ConfigurationName, ConfigurationID?, Quantity, SelectedToSubmit?,
//           CustomProperties: {},
//           MassGrams?,
//           // dvě varianty — buď inline Base64, nebo už nahraný asset:
//           PngBase64? | PngPath?,
//           PdfBase64? | PdfPath?,
//           ExternalReferences?: [],
//           Components: [ { Name, Path, Quantity, ConfigurationName, CustomProperties } ],
//           UnknownComponents: []
//         }
//       ]
//     }
//   ]
// }
//
// Response:
// { Success, Created: [...], Updated: [...], NotChanged: [...], UnknownComponents: [...], Errors: [...] }
// ───────────────────────────────────────────────────────────────────────────

const importSchema = z.object({
  Project: z.object({
    Id: z.number().int().optional(),
    Code: z.string().optional(),
  }),
  goodsBlockId: z.number().int().optional().nullable(),
  overwrite: z.boolean().optional(),
  DrawingFiles: z.array(z.object({
    Name: z.string().optional(),
    DrawingFileName: z.string(),
    RelativePath: z.string().optional().nullable(),
    Extension: z.string(),
    Version: z.number().int().optional(),
    SourcePath: z.string().optional().nullable(),
    Configurations: z.array(z.object({
      ConfigurationName: z.string(),
      ConfigurationID: z.string().optional().nullable(),
      Quantity: z.number().int().default(1),
      SelectedToSubmit: z.boolean().optional(),
      CustomProperties: z.record(z.string(), z.any()).default({}),
      MassGrams: z.number().optional().nullable(),
      PngBase64: z.string().optional().nullable(),
      PdfBase64: z.string().optional().nullable(),
      StlBase64: z.string().optional().nullable(),
      PngPath: z.string().optional().nullable(),
      PdfPath: z.string().optional().nullable(),
      StlPath: z.string().optional().nullable(),
      // Další přílohy (STEP, DXF, EASM, EPRT, IGES …). Každá má buď Path
      // (už uploadnuté přes upload-asset) nebo Base64 (server uloží).
      Attachments: z.array(z.object({
        Kind: z.string(),              // "step" | "dxf" | "easm" | …
        Filename: z.string(),
        Path: z.string().optional().nullable(),
        Base64: z.string().optional().nullable(),
      })).default([]),
      ExternalReferences: z.array(z.any()).default([]),
      Components: z.array(z.object({
        Name: z.string(),
        Path: z.string().optional().nullable(),
        Quantity: z.number().int().default(1),
        ConfigurationName: z.string().optional().nullable(),
        CustomProperties: z.record(z.string(), z.any()).optional(),
      })).default([]),
      UnknownComponents: z.array(z.any()).default([]),
    })).default([]),
  })),
});

router.post('/drawings-import', requireCadWrite, async (req, res, next) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        Success: false, Message: 'Neplatná data',
        Errors: parsed.error.flatten(),
      });
    }
    const { Project, goodsBlockId, overwrite, DrawingFiles } = parsed.data;

    // Najít projekt (preferujeme Id, jinak Code)
    const project = Project.Id
      ? await prisma.cadProject.findUnique({ where: { id: Project.Id } })
      : await prisma.cadProject.findUnique({ where: { code: Project.Code } });
    if (!project) {
      return res.status(404).json({ Success: false, Message: 'Projekt nenalezen' });
    }

    const authorPersonId = req.user?.person_id || null;

    const created = [], updated = [], notChanged = [], errors = [];
    const unknownOut = [];

    for (const f of DrawingFiles) {
      try {
        // Uložit všechny konfigurace - nejdřív zpracovat assety
        const configPayloads = [];
        for (const cfg of f.Configurations) {
          let pngPath = cfg.PngPath || null;
          let pdfPath = cfg.PdfPath || null;
          let stlPath = cfg.StlPath || null;
          if (!pngPath && cfg.PngBase64) pngPath = saveBase64Asset(cfg.PngBase64, 'png');
          if (!pdfPath && cfg.PdfBase64) pdfPath = saveBase64Asset(cfg.PdfBase64, 'pdf');
          if (!stlPath && cfg.StlBase64) stlPath = saveBase64Asset(cfg.StlBase64, 'stl');

          // Přílohy — pokud má Base64, uložíme; pokud má Path, použijeme ji.
          const attachments = [];
          for (const a of (cfg.Attachments || [])) {
            let p = a.Path || null;
            if (!p && a.Base64) {
              p = saveBase64Asset(a.Base64, (a.Kind || 'bin').toLowerCase().replace(/[^a-z0-9]/g, ''));
            }
            if (p) {
              attachments.push({
                kind: (a.Kind || '').toLowerCase(),
                filename: a.Filename,
                path: p,
              });
            }
          }

          configPayloads.push({
            config_name: cfg.ConfigurationName,
            config_code: cfg.ConfigurationID ?? null,
            quantity: cfg.Quantity,
            selected: cfg.SelectedToSubmit ?? true,
            custom_properties: cfg.CustomProperties,
            mass_grams: cfg.MassGrams ?? null,
            png_path: pngPath,
            pdf_path: pdfPath,
            stl_path: stlPath,
            attachments,
            external_references: cfg.ExternalReferences,
            components: cfg.Components,
            unknown: cfg.UnknownComponents,
          });
        }

        // Najít existující drawing
        const existing = await prisma.cadDrawing.findFirst({
          where: {
            project_id: project.id,
            file_name: f.DrawingFileName,
          },
          orderBy: { version: 'desc' },
          include: { configurations: true },
        });

        let drawing;
        let action; // 'created' | 'updated' | 'not_changed'

        if (!existing) {
          drawing = await prisma.cadDrawing.create({
            data: {
              project_id: project.id,
              block_id: goodsBlockId || null,
              file_name: f.DrawingFileName,
              relative_path: f.RelativePath ?? null,
              extension: f.Extension.toLowerCase().replace(/^\./, ''),
              version: f.Version ?? 1,
              source_path: f.SourcePath ?? null,
              title: f.Name ?? null,
              created_by_id: authorPersonId,
            },
          });
          action = 'created';
        } else if (overwrite) {
          drawing = await prisma.cadDrawing.update({
            where: { id: existing.id },
            data: {
              block_id: goodsBlockId ?? existing.block_id,
              relative_path: f.RelativePath ?? existing.relative_path,
              source_path: f.SourcePath ?? existing.source_path,
              title: f.Name ?? existing.title,
              last_import_at: new Date(),
            },
          });
          // Smazat staré konfigurace (včetně komponent díky cascade)
          await prisma.cadDrawingConfig.deleteMany({ where: { drawing_id: drawing.id } });
          action = 'updated';
        } else {
          // Existuje a overwrite=false → neměníme, jen reportujeme
          updated.length; // noop
          notChanged.push({
            Id: existing.id,
            DrawingFileName: existing.file_name,
            Version: existing.version,
          });
          continue;
        }

        // Vytvořit konfigurace + komponenty
        for (const c of configPayloads) {
          const created_cfg = await prisma.cadDrawingConfig.create({
            data: {
              drawing_id: drawing.id,
              config_name: c.config_name,
              config_code: c.config_code,
              quantity: c.quantity,
              selected: c.selected,
              custom_properties: c.custom_properties,
              mass_grams: c.mass_grams,
              png_path: c.png_path,
              pdf_path: c.pdf_path,
              stl_path: c.stl_path,
              attachments: c.attachments,
              external_references: c.external_references,
            },
          });
          // Komponenty (kusovník)
          if (c.components.length || c.unknown.length) {
            const componentsData = [
              ...c.components.map(comp => ({
                parent_config_id: created_cfg.id,
                name: comp.Name,
                path: comp.Path ?? null,
                quantity: comp.Quantity ?? 1,
                configuration: comp.ConfigurationName ?? null,
                custom_properties: comp.CustomProperties ?? null,
                is_unknown: false,
              })),
              ...c.unknown.map(comp => ({
                parent_config_id: created_cfg.id,
                name: comp.Name ?? String(comp),
                path: comp.Path ?? null,
                quantity: comp.Quantity ?? 1,
                configuration: comp.ConfigurationName ?? null,
                custom_properties: comp.CustomProperties ?? null,
                is_unknown: true,
              })),
            ];
            if (componentsData.length) {
              await prisma.cadComponent.createMany({ data: componentsData });
            }
            if (c.unknown.length) unknownOut.push(...c.unknown);
          }
        }

        const payload = {
          Id: drawing.id,
          DrawingFileName: drawing.file_name,
          Version: drawing.version,
          ProjectId: drawing.project_id,
          BlockId: drawing.block_id,
        };
        if (action === 'created') created.push(payload);
        else if (action === 'updated') updated.push(payload);
      } catch (e) {
        errors.push({ file: f.DrawingFileName, message: e.message });
      }
    }

    res.json({
      Success: errors.length === 0,
      Message: errors.length ? 'Některé výkresy se nepodařilo importovat.' : 'Import dokončen.',
      Created: created,
      Updated: updated,
      NotChanged: notChanged,
      UnknownComponents: unknownOut,
      Errors: errors,
    });
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/cad/projects — rychlý create projektu (pro admin nebo first-time setup)
// ───────────────────────────────────────────────────────────────────────────
const projectSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  customer: z.string().max(255).optional().nullable(),
  description: z.string().optional().nullable(),
});
router.post('/projects', requireCadWrite, async (req, res, next) => {
  try {
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const project = await prisma.cadProject.create({ data: parsed.data });
    res.status(201).json(project);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Projekt s tímto kódem už existuje' });
    }
    next(err);
  }
});

// POST /api/cad/projects/:id/blocks — přidat blok do projektu
const blockSchema = z.object({
  name: z.string().min(1).max(255),
  label: z.string().max(255).optional().nullable(),
  parent_id: z.number().int().optional().nullable(),
  sort_order: z.number().int().optional(),
});
router.post('/projects/:id/blocks', requireCadWrite, async (req, res, next) => {
  try {
    const project_id = parseInt(req.params.id);
    if (isNaN(project_id)) return res.status(400).json({ error: 'Neplatné ID projektu' });
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Neplatná data', details: parsed.error.flatten() });
    }
    const block = await prisma.cadBlock.create({
      data: { project_id, ...parsed.data },
    });
    res.status(201).json(block);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/cad/components/:id/resolve — přiřadit komponentu na Material
// ───────────────────────────────────────────────────────────────────────────
router.post('/components/:id/resolve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { material_id } = req.body;
    if (isNaN(id) || !Number.isInteger(material_id)) {
      return res.status(400).json({ error: 'Neplatné ID' });
    }
    const comp = await prisma.cadComponent.update({
      where: { id },
      data: { material_id, is_unknown: false, resolved: true },
    });
    res.json(comp);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/cad/drawings/:id — update title/description/block_id
// ───────────────────────────────────────────────────────────────────────────
router.patch('/drawings/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatne ID' });
    const { title, description, block_id } = req.body || {};
    const data = {};
    if (title !== undefined) data.title = title ? String(title).trim() : null;
    if (description !== undefined) data.description = description ? String(description).trim() : null;
    if (block_id !== undefined) data.block_id = block_id ? parseInt(block_id) : null;
    const updated = await prisma.cadDrawing.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, code: true, name: true } },
        block:   { select: { id: true, name: true } },
        creator: { select: { id: true, first_name: true, last_name: true, email: true } },
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// PATCH /api/cad/projects/:id — update code/name/customer/active
// ───────────────────────────────────────────────────────────────────────────
router.patch('/projects/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatne ID' });
    const { code, name, customer, active } = req.body || {};
    const data = {};
    if (code !== undefined) data.code = String(code).trim();
    if (name !== undefined) data.name = String(name).trim();
    if (customer !== undefined) data.customer = customer ? String(customer).trim() : null;
    if (active !== undefined) data.active = !!active;
    const updated = await prisma.cadProject.update({ where: { id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/cad/projects/:id — smaze projekt (cascade smaze bloky + vykresy)
// ───────────────────────────────────────────────────────────────────────────
router.delete('/projects/:id', requireCadWrite, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatne ID' });
    await prisma.cadProject.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/cad/drawings/:id — smaze vykres (cascade smaze konfigurace)
// ───────────────────────────────────────────────────────────────────────────
router.delete('/drawings/:id', requireCadWrite, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Neplatne ID' });
    await prisma.cadDrawing.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
