// =============================================================================
// HolyOS — Normování (mobile-first měření časů na pracovišti)
// =============================================================================
// Read-only čtení dávek+operací+BOM z Factorify, zápisy (start/end na díl)
// výhradně do HolyOS DB. Pro identifikaci pracovníka modul reuse-uje
// /api/hr/kiosk/identify (PIN/chip).
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const fyNormovani = require('../services/factorify/normovani.service');

// Modul vyžaduje přihlášeného HolyOS uživatele (JWT cookie). Identifikace konkrétního
// pracovníka (kdo zrovna měří) jde přes existující /api/hr/kiosk/identify a posílá se
// jako person_id do POST /sessions.
router.use(requireAuth);

// ─── FY proxy: stáhni dávku včetně operací a BOM ────────────────────────
//
// POZOR: pevné podcesty MUSÍ být nad /:id (memory holyos_express_route_order).

router.get('/fy/batch/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) {
      return res.status(400).json({ error: 'Neplatné číslo dávky (očekává se kladné číslo)' });
    }
    const batch = await fyNormovani.getBatch(id);
    res.json(batch);
  } catch (err) {
    // Specifický 404 z FY = dávka neexistuje
    if (/HTTP 404/.test(String(err?.message || ''))) {
      return res.status(404).json({ error: `Dávka ${req.params.id} v Factorify nenalezena` });
    }
    next(err);
  }
});

// ─── Sessions: začátek / konec měření ────────────────────────────────────

// POST /api/normovani/sessions — začni měření na operaci
// Body: { person_id, fy_batch_id, fy_operation_id }
router.post('/sessions', async (req, res, next) => {
  try {
    const { person_id, fy_batch_id, fy_operation_id, notes } = req.body || {};

    if (!person_id || !fy_batch_id || !fy_operation_id) {
      return res.status(400).json({
        error: 'Chybí povinné údaje',
        required: ['person_id', 'fy_batch_id', 'fy_operation_id'],
      });
    }

    // Ověř že Person existuje
    const personId = parseInt(person_id, 10);
    if (!Number.isFinite(personId)) {
      return res.status(400).json({ error: 'person_id musí být číslo' });
    }
    const person = await prisma.person.findFirst({
      where: { id: personId, active: true },
      select: { id: true, first_name: true, last_name: true },
    });
    if (!person) {
      return res.status(404).json({ error: `Pracovník id=${personId} nenalezen nebo neaktivní` });
    }

    // Stáhni dávku z FY a najdi konkrétní operaci → uložíme denormalizované metadata
    const batch = await fyNormovani.getBatch(fy_batch_id);
    const op = batch.operations.find(o => String(o.id) === String(fy_operation_id));
    if (!op) {
      return res.status(404).json({
        error: `Operace ${fy_operation_id} v dávce ${fy_batch_id} neexistuje`,
        availableOperations: batch.operations.map(o => ({ id: o.id, name: o.name })),
      });
    }

    // Pokud má pracovník už aktivní session, vrať ji (idempotent restart)
    const existingActive = await prisma.normovaniSession.findFirst({
      where: {
        person_id: personId,
        fy_batch_id: String(fy_batch_id),
        fy_operation_id: String(fy_operation_id),
        status: 'active',
      },
    });
    if (existingActive) {
      return res.json({ session: existingActive, resumed: true });
    }

    const session = await prisma.normovaniSession.create({
      data: {
        person_id: personId,
        fy_batch_id: String(batch.id),
        fy_batch_number: String(batch.number),
        fy_goods_id: batch.goods?.id ?? null,
        fy_goods_code: batch.goods?.code ?? null,
        fy_goods_name: batch.goods?.name ?? null,
        fy_workflow_id: batch.workflow?.id ?? null,
        fy_operation_id: String(op.id),
        fy_operation_name: op.name,
        workplace_label: op.workplace ?? null,
        status: 'active',
        notes: notes || null,
      },
    });

    res.status(201).json({ session, resumed: false });
  } catch (err) {
    next(err);
  }
});

// GET /api/normovani/sessions — poslední session pracovníka, případně filtr
router.get('/sessions', async (req, res, next) => {
  try {
    const { person_id, status, batch_id, limit } = req.query;
    const where = {};
    if (person_id) where.person_id = parseInt(person_id, 10);
    if (status) where.status = String(status);
    if (batch_id) where.fy_batch_id = String(batch_id);

    const take = Math.min(parseInt(limit, 10) || 50, 200);
    const sessions = await prisma.normovaniSession.findMany({
      where,
      orderBy: { started_at: 'desc' },
      take,
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
        _count: { select: { events: true } },
      },
    });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

// ─── PEVNÉ PODCESTY pod /:id (musí být NAD dynamickou /:id) ─────────────

// POST /api/normovani/sessions/:id/events — záznam start/end u dílu
router.post('/sessions/:id/events', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }

    const { event_type, fy_item_id, fy_goods_id, item_code, item_name, item_unit, item_qr, quantity, notes } = req.body || {};

    if (!event_type || !['start', 'end'].includes(event_type)) {
      return res.status(400).json({ error: 'event_type musí být "start" nebo "end"' });
    }
    if (!fy_item_id) {
      return res.status(400).json({ error: 'fy_item_id je povinné' });
    }

    // Ověř, že session existuje a je active (na ukončenou se nesmí psát)
    const session = await prisma.normovaniSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return res.status(404).json({ error: `Session ${sessionId} neexistuje` });
    }
    if (session.status !== 'active') {
      return res.status(409).json({ error: `Session ${sessionId} je ${session.status}, nelze přidat event` });
    }

    const event = await prisma.normovaniEvent.create({
      data: {
        session_id: sessionId,
        event_type: String(event_type),
        fy_item_id: String(fy_item_id),
        fy_goods_id: fy_goods_id != null ? String(fy_goods_id) : null,
        item_code: item_code ?? null,
        item_name: item_name ?? null,
        item_unit: item_unit ?? null,
        item_qr: item_qr ?? null,
        quantity: quantity != null && quantity !== '' ? Number(quantity) : null,
        notes: notes ?? null,
      },
    });
    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// POST /api/normovani/sessions/:id/end — ukonči měření
router.post('/sessions/:id/end', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }
    const session = await prisma.normovaniSession.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: `Session ${sessionId} neexistuje` });
    if (session.status === 'done') return res.json(session);

    const updated = await prisma.normovaniSession.update({
      where: { id: sessionId },
      data: { status: 'done', ended_at: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/normovani/sessions/:id/events — list eventů v session
router.get('/sessions/:id/events', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }
    const events = await prisma.normovaniEvent.findMany({
      where: { session_id: sessionId },
      orderBy: { occurred_at: 'asc' },
    });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// GET /api/normovani/sessions/:id/export — JSON nebo CSV pro další zpracování
//   ?format=json (default) | csv
//
// Ukáže timing pro každý díl: pairing start↔end → trvání. Když chybí konec,
// trvání je null a stav "open".
router.get('/sessions/:id/export', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }

    const session = await prisma.normovaniSession.findUnique({
      where: { id: sessionId },
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
        events: { orderBy: { occurred_at: 'asc' } },
      },
    });
    if (!session) return res.status(404).json({ error: `Session ${sessionId} neexistuje` });

    // Spáruj start ↔ end po fy_item_id (FIFO).
    const pairs = [];
    const openByItem = new Map(); // fy_item_id → start event
    for (const ev of session.events) {
      if (ev.event_type === 'start') {
        if (openByItem.has(ev.fy_item_id)) {
          // Dva starty po sobě bez endu — uzavři předchozí jako "abandoned"
          const prev = openByItem.get(ev.fy_item_id);
          pairs.push({ ...buildPair(prev, null, session), status: 'abandoned' });
        }
        openByItem.set(ev.fy_item_id, ev);
      } else if (ev.event_type === 'end') {
        const start = openByItem.get(ev.fy_item_id);
        if (start) {
          openByItem.delete(ev.fy_item_id);
          pairs.push({ ...buildPair(start, ev, session), status: 'closed' });
        } else {
          // End bez startu — zaloguj jako anomálii, ať se nezahodí
          pairs.push({ ...buildPair(null, ev, session), status: 'orphan_end' });
        }
      }
    }
    // Otevřené starty bez endu
    for (const start of openByItem.values()) {
      pairs.push({ ...buildPair(start, null, session), status: 'open' });
    }

    if (String(req.query.format).toLowerCase() === 'csv') {
      const headers = [
        'session_id', 'pracovnik', 'davka', 'operace', 'pracoviste',
        'item_code', 'item_name', 'item_unit', 'qty', 'qr',
        'start_at', 'end_at', 'duration_seconds', 'status', 'notes',
      ];
      const rows = [headers.join(';')];
      for (const p of pairs) {
        rows.push([
          session.id,
          csvSafe(`${session.person?.first_name || ''} ${session.person?.last_name || ''}`.trim()),
          csvSafe(session.fy_batch_number),
          csvSafe(session.fy_operation_name),
          csvSafe(session.workplace_label),
          csvSafe(p.item_code),
          csvSafe(p.item_name),
          csvSafe(p.item_unit),
          p.quantity ?? '',
          csvSafe(p.item_qr),
          p.start_at ? p.start_at.toISOString() : '',
          p.end_at ? p.end_at.toISOString() : '',
          p.duration_seconds ?? '',
          p.status,
          csvSafe(p.notes),
        ].join(';'));
      }
      const csv = '﻿' + rows.join('\n'); // BOM pro Excel
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="normovani-${session.id}.csv"`);
      return res.send(csv);
    }

    // JSON default
    res.json({
      session: {
        id: session.id,
        person: session.person,
        fy_batch_id: session.fy_batch_id,
        fy_batch_number: session.fy_batch_number,
        fy_goods_code: session.fy_goods_code,
        fy_goods_name: session.fy_goods_name,
        fy_operation_id: session.fy_operation_id,
        fy_operation_name: session.fy_operation_name,
        workplace_label: session.workplace_label,
        started_at: session.started_at,
        ended_at: session.ended_at,
        status: session.status,
      },
      items: pairs,
      summary: {
        total_pairs: pairs.length,
        closed: pairs.filter(p => p.status === 'closed').length,
        open: pairs.filter(p => p.status === 'open').length,
        abandoned: pairs.filter(p => p.status === 'abandoned').length,
        orphan_end: pairs.filter(p => p.status === 'orphan_end').length,
        total_duration_seconds: pairs
          .filter(p => p.duration_seconds != null)
          .reduce((a, p) => a + p.duration_seconds, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

function buildPair(startEv, endEv, session) {
  const ref = endEv || startEv;
  const start_at = startEv ? startEv.occurred_at : null;
  const end_at = endEv ? endEv.occurred_at : null;
  let duration_seconds = null;
  if (start_at && end_at) {
    duration_seconds = Math.max(0, Math.round((new Date(end_at).getTime() - new Date(start_at).getTime()) / 1000));
  }
  return {
    fy_item_id: ref.fy_item_id,
    fy_goods_id: ref.fy_goods_id,
    item_code: ref.item_code,
    item_name: ref.item_name,
    item_unit: ref.item_unit,
    item_qr: ref.item_qr,
    quantity: ref.quantity,
    notes: ref.notes || null,
    start_at,
    end_at,
    duration_seconds,
  };
}

function csvSafe(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[;\n"]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// DELETE /api/normovani/sessions/:id — smazat měření (cascade smaže i eventy)
router.delete('/sessions/:id', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }
    const exists = await prisma.normovaniSession.findUnique({ where: { id: sessionId } });
    if (!exists) return res.status(404).json({ error: `Session ${sessionId} neexistuje` });

    // Cascade smaže i NormovaniEvent (FK má onDelete: Cascade ve schema)
    await prisma.normovaniSession.delete({ where: { id: sessionId } });
    res.json({ ok: true, deleted_id: sessionId });
  } catch (err) {
    next(err);
  }
});

// ─── Dynamická /:id MUSÍ být POSLEDNÍ (memory holyos_express_route_order) ──

// GET /api/normovani/sessions/:id — detail session
router.get('/sessions/:id', async (req, res, next) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ error: 'Neplatné session id' });
    }
    const session = await prisma.normovaniSession.findUnique({
      where: { id: sessionId },
      include: {
        person: { select: { id: true, first_name: true, last_name: true } },
        events: { orderBy: { occurred_at: 'asc' } },
      },
    });
    if (!session) return res.status(404).json({ error: `Session ${sessionId} neexistuje` });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
