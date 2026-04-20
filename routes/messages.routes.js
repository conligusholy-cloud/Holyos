// =============================================================================
// HolyOS — Messages routes (user-to-user chat, skupiny, task thready, AI účastník)
// =============================================================================
// Endpointy:
//   GET    /api/messages/channels                 — moje kanály s last_message a unread count
//   GET    /api/messages/channels/:id             — detail kanálu + členové
//   POST   /api/messages/channels/direct          — otevři/vytvoř 1:1 s uživatelem { user_id }
//   POST   /api/messages/channels/group           — vytvoř skupinu { name, user_ids[] }
//   POST   /api/messages/channels/task/:taskId    — otevři/vytvoř thread k požadavku
//   POST   /api/messages/channels/:id/members     — přidej člena { user_id }
//   DELETE /api/messages/channels/:id/members/:userId — odeber člena
//   GET    /api/messages/channels/:id/messages    — stránkovaná historie (?before=…&limit=…)
//   POST   /api/messages/channels/:id/messages    — pošli zprávu { content, ai? }
//   POST   /api/messages/channels/:id/read        — označ přečtené do teď
//   GET    /api/messages/users/searchable         — list uživatelů pro picker
// =============================================================================

const express = require('express');
const router = express.Router();
const { prisma } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const bus = require('../services/notification-bus');
const { createNotification } = require('./notifications.routes');

router.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────────────────────────

const MEMBER_SELECT = {
  id: true, user_id: true, role: true, last_read_at: true, muted: true,
  user: {
    select: {
      id: true, username: true, display_name: true,
      person: { select: { photo_url: true, first_name: true, last_name: true } },
    },
  },
};

function unreadFor(channel, userId) {
  const me = channel.members.find(m => m.user_id === userId);
  if (!me) return 0;
  if (!me.last_read_at) return channel._count?.messages ?? 0;
  // Přesně zjistit počet nepřečtených se dělá samostatným COUNT — tady jen přibližný signál
  return channel.last_message_at > me.last_read_at ? 1 : 0;
}

async function ensureMember(channelId, userId) {
  const m = await prisma.chatChannelMember.findUnique({
    where: { channel_id_user_id: { channel_id: channelId, user_id: userId } },
  });
  if (!m) {
    const err = new Error('Nemáš přístup do tohoto kanálu');
    err.status = 403;
    throw err;
  }
  return m;
}

// Načti členy kanálu (pro push notifikací)
async function channelMemberIds(channelId) {
  const members = await prisma.chatChannelMember.findMany({
    where: { channel_id: channelId },
    select: { user_id: true },
  });
  return members.map(m => m.user_id);
}

// ─── CHANNELS ──────────────────────────────────────────────────────────────

// Seznam mých kanálů — JEDNA raw SQL query (původně 6+ roundtripů přes Prisma include → 1 roundtrip)
router.get('/channels', async (req, res, next) => {
  const t0 = Date.now();
  try {
    const userId = req.user.id;
    // Vše v jedné SQL: kanály, members s users a persons, last message, unread count
    const rows = await prisma.$queryRaw`
      SELECT
        c.id,
        c.type,
        c.name,
        c.topic,
        c.admin_task_id,
        c.created_by,
        c.last_message_at,
        c.created_at,
        c.updated_at,
        me.last_read_at AS my_last_read_at,
        me.muted       AS my_muted,
        me.role        AS my_role,
        (SELECT row_to_json(lm) FROM (
          SELECT id, content, sender_id, sender_type, sender_label, created_at
          FROM chat_messages
          WHERE channel_id = c.id AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
        ) lm) AS last_message,
        (
          SELECT COUNT(*)::int FROM chat_messages cm
          WHERE cm.channel_id = c.id
            AND cm.deleted_at IS NULL
            AND cm.sender_id IS DISTINCT FROM ${userId}
            AND (me.last_read_at IS NULL OR cm.created_at > me.last_read_at)
        ) AS unread,
        (
          SELECT json_agg(json_build_object(
            'id', mm.id,
            'user_id', mm.user_id,
            'role', mm.role,
            'last_read_at', mm.last_read_at,
            'muted', mm.muted,
            'user', json_build_object(
              'id', u.id,
              'username', u.username,
              'display_name', u.display_name,
              'person', CASE WHEN p.id IS NOT NULL THEN json_build_object(
                'photo_url', p.photo_url,
                'first_name', p.first_name,
                'last_name', p.last_name
              ) ELSE NULL END
            )
          ))
          FROM chat_channel_members mm
          JOIN users u ON u.id = mm.user_id
          LEFT JOIN people p ON p.user_id = u.id
          WHERE mm.channel_id = c.id
        ) AS members
      FROM chat_channels c
      JOIN chat_channel_members me ON me.channel_id = c.id AND me.user_id = ${userId}
      ORDER BY c.last_message_at DESC NULLS LAST
    `;

    // Namapuj do stejné struktury, jakou front-end čeká
    const channels = rows.map(r => ({
      id: r.id,
      type: r.type,
      name: r.name,
      topic: r.topic,
      admin_task_id: r.admin_task_id,
      created_by: r.created_by,
      last_message_at: r.last_message_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      my_membership: {
        last_read_at: r.my_last_read_at,
        muted: r.my_muted,
        role: r.my_role,
      },
      last_message: r.last_message || null,
      unread: r.unread || 0,
      members: r.members || [],
    }));

    console.log(`[messages] GET /channels: ${channels.length} kanálů za ${Date.now() - t0}ms (raw SQL)`);
    res.json(channels);
  } catch (err) {
    console.error('[messages] /channels error:', err.message);
    next(err);
  }
});

// Detail kanálu
router.get('/channels/:id', async (req, res, next) => {
  try {
    await ensureMember(req.params.id, req.user.id);
    const channel = await prisma.chatChannel.findUnique({
      where: { id: req.params.id },
      include: { members: { select: MEMBER_SELECT } },
    });
    if (!channel) return res.status(404).json({ error: 'Kanál nenalezen' });
    res.json(channel);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Otevři/vytvoř 1:1
router.post('/channels/direct', async (req, res, next) => {
  try {
    const otherId = parseInt(req.body.user_id);
    if (!otherId || otherId === req.user.id) {
      return res.status(400).json({ error: 'Neplatný uživatel' });
    }

    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other) return res.status(404).json({ error: 'Uživatel nenalezen' });

    // Najdi existující direct kanál s přesně těmito 2 členy
    const existing = await prisma.chatChannel.findFirst({
      where: {
        type: 'direct',
        members: { every: { user_id: { in: [req.user.id, otherId] } } },
        AND: [
          { members: { some: { user_id: req.user.id } } },
          { members: { some: { user_id: otherId } } },
        ],
      },
      include: { members: { select: MEMBER_SELECT } },
    });

    if (existing && existing.members.length === 2) {
      return res.json(existing);
    }

    const channel = await prisma.chatChannel.create({
      data: {
        type: 'direct',
        created_by: req.user.id,
        members: {
          create: [
            { user_id: req.user.id, role: 'admin' },
            { user_id: otherId, role: 'member' },
          ],
        },
      },
      include: { members: { select: MEMBER_SELECT } },
    });

    // Push oběma účastníkům
    bus.publishToUsers([req.user.id, otherId], 'channel_update', { channel_id: channel.id });

    res.status(201).json(channel);
  } catch (err) { next(err); }
});

// Vytvoř skupinu
router.post('/channels/group', async (req, res, next) => {
  try {
    const { name, user_ids, topic } = req.body;
    if (!name || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: 'Chybí název nebo seznam uživatelů' });
    }

    const ids = [...new Set([...user_ids.map(Number), req.user.id])];
    const channel = await prisma.chatChannel.create({
      data: {
        type: 'group',
        name: String(name).slice(0, 255),
        topic: topic ? String(topic).slice(0, 500) : null,
        created_by: req.user.id,
        members: {
          create: ids.map(uid => ({
            user_id: uid,
            role: uid === req.user.id ? 'admin' : 'member',
          })),
        },
      },
      include: { members: { select: MEMBER_SELECT } },
    });

    bus.publishToUsers(ids, 'channel_update', { channel_id: channel.id });
    // Notifikace ostatním o přidání
    for (const uid of ids) {
      if (uid === req.user.id) continue;
      await createNotification({
        userId: uid,
        type: 'chat_message',
        title: `Byl jsi přidán do skupiny "${channel.name}"`,
        link: `/modules/chat/?channel=${channel.id}`,
        meta: { channel_id: channel.id },
      });
    }
    res.status(201).json(channel);
  } catch (err) { next(err); }
});

// Thread k požadavku
router.post('/channels/task/:taskId', async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const task = await prisma.adminTask.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Požadavek nenalezen' });

    let channel = await prisma.chatChannel.findFirst({
      where: { type: 'task', admin_task_id: taskId },
      include: { members: { select: MEMBER_SELECT } },
    });

    if (!channel) {
      // Členové: autor požadavku (pokud existuje) + aktuální user
      const memberIds = new Set([req.user.id]);
      if (task.created_by) memberIds.add(task.created_by);

      channel = await prisma.chatChannel.create({
        data: {
          type: 'task',
          name: `Požadavek #${task.id}${task.page_title ? ` — ${task.page_title}` : ''}`.slice(0, 255),
          admin_task_id: taskId,
          created_by: req.user.id,
          members: {
            create: [...memberIds].map(uid => ({
              user_id: uid,
              role: uid === req.user.id ? 'admin' : 'member',
            })),
          },
        },
        include: { members: { select: MEMBER_SELECT } },
      });
    } else {
      // Už existuje — ujisti se, že aktuální user je členem (auto-join)
      const isMember = channel.members.some(m => m.user_id === req.user.id);
      if (!isMember) {
        await prisma.chatChannelMember.create({
          data: { channel_id: channel.id, user_id: req.user.id, role: 'member' },
        });
        channel = await prisma.chatChannel.findUnique({
          where: { id: channel.id },
          include: { members: { select: MEMBER_SELECT } },
        });
      }
    }

    res.json(channel);
  } catch (err) { next(err); }
});

// Přidej člena
router.post('/channels/:id/members', async (req, res, next) => {
  try {
    const me = await ensureMember(req.params.id, req.user.id);
    if (me.role !== 'admin') {
      return res.status(403).json({ error: 'Jen admin kanálu může přidávat členy' });
    }
    const userId = parseInt(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'Chybí user_id' });

    const member = await prisma.chatChannelMember.upsert({
      where: { channel_id_user_id: { channel_id: req.params.id, user_id: userId } },
      update: {},
      create: { channel_id: req.params.id, user_id: userId, role: 'member' },
      select: MEMBER_SELECT,
    });

    bus.publishToUser(userId, 'channel_update', { channel_id: req.params.id });
    res.status(201).json(member);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Odeber člena
router.delete('/channels/:id/members/:userId', async (req, res, next) => {
  try {
    const me = await ensureMember(req.params.id, req.user.id);
    const targetId = parseInt(req.params.userId);
    if (me.role !== 'admin' && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Jen admin nebo sám sebe' });
    }
    await prisma.chatChannelMember.delete({
      where: { channel_id_user_id: { channel_id: req.params.id, user_id: targetId } },
    });
    bus.publishToUser(targetId, 'channel_update', { channel_id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── MESSAGES ──────────────────────────────────────────────────────────────

// Historie zpráv v kanálu — JEDNA raw SQL query (dřív Prisma ~6 round-tripů → 1)
router.get('/channels/:id/messages', async (req, res, next) => {
  const t0 = Date.now();
  try {
    const channelId = req.params.id;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const beforeId = req.query.before ? String(req.query.before) : null;

    // Cursor: pokud beforeId, zjisti jeho created_at a filtruj přímo v SQL
    let beforeTs = null;
    if (beforeId) {
      const refRows = await prisma.$queryRaw`
        SELECT created_at FROM chat_messages WHERE id = ${beforeId} LIMIT 1
      `;
      if (refRows.length) beforeTs = refRows[0].created_at;
    }

    const rows = beforeTs
      ? await prisma.$queryRaw`
          SELECT
            m.id, m.channel_id, m.sender_id, m.sender_type, m.sender_label,
            m.content, m.attachments, m.edited_at, m.created_at,
            CASE WHEN u.id IS NOT NULL THEN json_build_object(
              'id', u.id, 'username', u.username, 'display_name', u.display_name,
              'person', CASE WHEN p.id IS NOT NULL THEN json_build_object('photo_url', p.photo_url) ELSE NULL END
            ) ELSE NULL END AS sender
          FROM chat_messages m
          LEFT JOIN users u ON u.id = m.sender_id
          LEFT JOIN people p ON p.user_id = u.id
          WHERE m.channel_id = ${channelId}
            AND m.deleted_at IS NULL
            AND m.created_at < ${beforeTs}
            AND EXISTS (SELECT 1 FROM chat_channel_members cm WHERE cm.channel_id = m.channel_id AND cm.user_id = ${userId})
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw`
          SELECT
            m.id, m.channel_id, m.sender_id, m.sender_type, m.sender_label,
            m.content, m.attachments, m.edited_at, m.created_at,
            CASE WHEN u.id IS NOT NULL THEN json_build_object(
              'id', u.id, 'username', u.username, 'display_name', u.display_name,
              'person', CASE WHEN p.id IS NOT NULL THEN json_build_object('photo_url', p.photo_url) ELSE NULL END
            ) ELSE NULL END AS sender
          FROM chat_messages m
          LEFT JOIN users u ON u.id = m.sender_id
          LEFT JOIN people p ON p.user_id = u.id
          WHERE m.channel_id = ${channelId}
            AND m.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM chat_channel_members cm WHERE cm.channel_id = m.channel_id AND cm.user_id = ${userId})
          ORDER BY m.created_at DESC
          LIMIT ${limit}
        `;

    const filtered = rows;

    console.log(`[messages] GET /channels/${channelId}/messages: ${filtered.length} zpráv za ${Date.now() - t0}ms (raw SQL)`);
    res.json(filtered.reverse()); // chronologicky (nejstarší první)
  } catch (err) {
    console.error('[messages] /messages error:', err.message);
    next(err);
  }
});

// Pošli zprávu
router.post('/channels/:id/messages', async (req, res, next) => {
  try {
    await ensureMember(req.params.id, req.user.id);
    const content = String(req.body.content || '').trim();
    // Přílohy: [{ kind: 'image'|'file', url, name, size, mime }]
    const rawAttachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    const attachments = rawAttachments.slice(0, 20).map(a => ({
      kind: (a && a.kind === 'image') ? 'image' : 'file',
      url: String(a?.url || '').slice(0, 1000),
      name: a?.name ? String(a.name).slice(0, 255) : undefined,
      size: typeof a?.size === 'number' ? a.size : undefined,
      mime: a?.mime ? String(a.mime).slice(0, 100) : undefined,
    })).filter(a => a.url);

    if (!content && attachments.length === 0) {
      return res.status(400).json({ error: 'Prázdná zpráva' });
    }
    if (content.length > 10000) return res.status(400).json({ error: 'Zpráva je příliš dlouhá' });

    const channelId = req.params.id;
    const message = await prisma.chatMessage.create({
      data: {
        channel_id: channelId,
        sender_id: req.user.id,
        sender_type: 'user',
        content,
        attachments: attachments.length ? attachments : undefined,
      },
      include: { sender: { select: { id: true, username: true, display_name: true, person: { select: { photo_url: true } } } } },
    });

    // Vrať odpověď klientovi hned — side effects (notifikace, emaily) poběží na pozadí
    res.status(201).json(message);

    // Side effects v pozadí — klient je mezitím happy
    (async () => {
      try {
        // Update channel + paralelní fetch členů a "others" najednou
        const [, membersWithChannel] = await Promise.all([
          prisma.chatChannel.update({
            where: { id: channelId },
            data: { last_message_at: message.created_at },
          }),
          prisma.chatChannelMember.findMany({
            where: { channel_id: channelId },
            include: { channel: { select: { type: true, name: true, admin_task_id: true } } },
          }),
        ]);

        // SSE push všem členům
        const allIds = membersWithChannel.map(m => m.user_id);
        bus.publishToUsers(allIds, 'message', { channel_id: channelId, message });

        // Notifikace ostatním (kromě odesílatele, nemutovaným) — PARALELNĚ
        const senderLabel = req.user.displayName || req.user.username;
        const channelMeta = membersWithChannel[0]?.channel || {};
        let preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
        if (!preview && attachments.length) {
          const hasImg = attachments.some(a => a.kind === 'image');
          preview = hasImg ? `📷 Obrázek (${attachments.length})` : `📎 Soubor (${attachments.length})`;
        }
        const link = channelMeta.type === 'task' && channelMeta.admin_task_id
          ? `/modules/admin-tasks/?task=${channelMeta.admin_task_id}`
          : `/modules/chat/?channel=${channelId}`;

        const toNotify = membersWithChannel.filter(m => m.user_id !== req.user.id && !m.muted);
        await Promise.all(toNotify.map(m => {
          let title = senderLabel;
          if (channelMeta.type === 'group' && channelMeta.name) title = `${senderLabel} v ${channelMeta.name}`;
          if (channelMeta.type === 'task' && channelMeta.name) title = `${senderLabel} u ${channelMeta.name}`;
          return createNotification({
            userId: m.user_id,
            type: 'chat_message',
            title,
            body: preview,
            link,
            meta: { channel_id: channelId, message_id: message.id },
          });
        }));

        // AI účastník
        if (req.body.ai === true || /@ai\b/i.test(content)) {
          triggerAiReply({ channelId, triggerMessage: message, fromUser: req.user })
            .catch(e => console.error('AI reply error:', e.message));
        }
      } catch (bgErr) {
        console.error('[messages] background side-effects error:', bgErr.message);
      }
    })();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// Označ přečtené do teď
router.post('/channels/:id/read', async (req, res, next) => {
  try {
    await ensureMember(req.params.id, req.user.id);
    const now = new Date();
    await prisma.chatChannelMember.update({
      where: { channel_id_user_id: { channel_id: req.params.id, user_id: req.user.id } },
      data: { last_read_at: now },
    });
    res.json({ ok: true, last_read_at: now });

    // Broadcast read receipt ostatním členům (doubletick) — asynchronně,
    // klient má odpověď rychle
    (async () => {
      try {
        const members = await prisma.chatChannelMember.findMany({
          where: { channel_id: req.params.id },
          select: { user_id: true },
        });
        const others = members.map(m => m.user_id).filter(id => id !== req.user.id);
        if (others.length) {
          bus.publishToUsers(others, 'read', {
            channel_id: req.params.id,
            reader_id: req.user.id,
            last_read_at: now,
          });
        }
      } catch (e) {
        console.warn('[messages] read broadcast failed:', e.message);
      }
    })();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── USER PICKER ───────────────────────────────────────────────────────────

router.get('/users/searchable', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = { id: { not: req.user.id } };
    if (q) {
      where.OR = [
        { username: { contains: q, mode: 'insensitive' } },
        { display_name: { contains: q, mode: 'insensitive' } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, username: true, display_name: true,
        person: { select: { photo_url: true, first_name: true, last_name: true } },
      },
      take: 20,
      orderBy: { display_name: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// ─── AI účastník v chatu ───────────────────────────────────────────────────
// Zavolá orchestrátor, odpověď vloží jako zprávu se sender_type: 'ai'

async function triggerAiReply({ channelId, triggerMessage, fromUser }) {
  try {
    // Lazy require (orchestrátor může být těžký modul)
    const { processQuery } = require('../services/ai/orchestrator');

    // Vezmi posledních 10 zpráv jako historii
    const history = await prisma.chatMessage.findMany({
      where: { channel_id: channelId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      take: 10,
      include: { sender: { select: { display_name: true, username: true } } },
    });

    const conversationHistory = history.reverse().map(m => ({
      role: m.sender_type === 'ai' ? 'assistant' : 'user',
      content: m.sender_type === 'user'
        ? `${m.sender?.display_name || m.sender?.username || 'User'}: ${m.content}`
        : m.content,
    }));

    const result = await processQuery({
      message: triggerMessage.content,
      currentModule: 'Chat',
      assistantSlug: null, // auto-routing
      history: conversationHistory.slice(0, -1), // bez poslední zprávy (to je prompt)
      enableMultiAgent: false,
    });

    const aiMsg = await prisma.chatMessage.create({
      data: {
        channel_id: channelId,
        sender_id: null,
        sender_type: 'ai',
        sender_label: result.assistant?.name || 'Claude',
        content: result.response || '(AI nevrátila odpověď)',
      },
    });

    await prisma.chatChannel.update({
      where: { id: channelId },
      data: { last_message_at: aiMsg.created_at },
    });

    const memberIds = await channelMemberIds(channelId);
    bus.publishToUsers(memberIds, 'message', { channel_id: channelId, message: aiMsg });
  } catch (e) {
    // Zapíšeme systémovou chybovou zprávu do kanálu aby user věděl co se stalo
    try {
      const errMsg = await prisma.chatMessage.create({
        data: {
          channel_id: channelId,
          sender_id: null,
          sender_type: 'system',
          sender_label: 'HolyOS',
          content: `⚠️ AI nedokázala odpovědět: ${e.message || 'neznámá chyba'}`,
        },
      });
      const memberIds = await channelMemberIds(channelId);
      bus.publishToUsers(memberIds, 'message', { channel_id: channelId, message: errMsg });
    } catch (_) {}
    throw e;
  }
}

// Export helper pro jiné moduly (např. systémové oznámení z task routes)
async function postSystemMessage(channelId, content, label = 'HolyOS') {
  const msg = await prisma.chatMessage.create({
    data: {
      channel_id: channelId,
      sender_id: null,
      sender_type: 'system',
      sender_label: label,
      content,
    },
  });
  await prisma.chatChannel.update({
    where: { id: channelId },
    data: { last_message_at: msg.created_at },
  });
  const memberIds = await channelMemberIds(channelId);
  bus.publishToUsers(memberIds, 'message', { channel_id: channelId, message: msg });
  return msg;
}

router.postSystemMessage = postSystemMessage;

// Vytvoří task-kanál (type='task', admin_task_id=taskId), pokud ještě
// neexistuje. Jako členy přidá autora požadavku a (volitelně) aktéra změny.
// Používá se z admin-tasks.routes.js při změně stavu, abychom mohli do chatu
// doručit systémovou zprávu i v případě, kdy autor zatím kanál neotevřel.
async function ensureTaskChannel(taskId, actorUserId) {
  const task = await prisma.adminTask.findUnique({
    where: { id: taskId },
    select: { id: true, created_by: true, page_title: true },
  });
  if (!task) return null;

  let channel = await prisma.chatChannel.findFirst({
    where: { type: 'task', admin_task_id: taskId },
    select: { id: true },
  });

  if (!channel) {
    const memberIds = new Set();
    if (task.created_by) memberIds.add(task.created_by);
    if (actorUserId && actorUserId !== task.created_by) memberIds.add(actorUserId);
    if (memberIds.size === 0) return null; // nikoho komu poslat

    channel = await prisma.chatChannel.create({
      data: {
        type: 'task',
        name: `Požadavek #${task.id}${task.page_title ? ` — ${task.page_title}` : ''}`.slice(0, 255),
        admin_task_id: taskId,
        created_by: actorUserId || task.created_by,
        members: {
          create: [...memberIds].map(uid => ({
            user_id: uid,
            role: uid === (actorUserId || task.created_by) ? 'admin' : 'member',
          })),
        },
      },
      select: { id: true },
    });

    // Notifikace autorovi o tom, že byl přidán do nového task-kanálu
    // (channel_update ho donutí refreshnout seznam)
    bus.publishToUsers([...memberIds], 'channel_update', { channel_id: channel.id });
  } else {
    // Kanál je, ale autor v něm nemusí být — doplň ho
    if (task.created_by) {
      const isMember = await prisma.chatChannelMember.findUnique({
        where: { channel_id_user_id: { channel_id: channel.id, user_id: task.created_by } },
      }).catch(() => null);
      if (!isMember) {
        await prisma.chatChannelMember.create({
          data: { channel_id: channel.id, user_id: task.created_by, role: 'member' },
        });
        bus.publishToUser(task.created_by, 'channel_update', { channel_id: channel.id });
      }
    }
  }
  return channel;
}

router.ensureTaskChannel = ensureTaskChannel;

module.exports = router;
