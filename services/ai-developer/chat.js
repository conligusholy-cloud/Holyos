// =============================================================================
// HolyOS — AI Vývojář / chat & notifikace integrace
// =============================================================================
// Posílá zprávy od servisního usera 'ai-vyvojar' (Alan, AI Vývojář) do
// chat threadu daného AdminTask přes ChatChannel typu 'task'.
// Současně vytváří Notification pro autora úkolu.

const { prisma } = require('../../config/database');
const repository = require('./repository');

// Šablony zpráv — držíme stručné a v češtině.
const TEMPLATES = {
  accept: () => 'Beru si to, jdu zkoumat zadání.',
  question: (text) => `Mám otázku k zadání: ${text}`,
  done: (prUrl) => `Hotovo, otevřel jsem PR: ${prUrl}`,
  failed: (reason) => `Narazil jsem na problém a běh skončil chybou: ${reason}`,
  escalated: (reason) => `Eskalace — potřebuji lidskou kontrolu. Důvod: ${reason}`,
  cancelled: () => 'Běh byl zrušen.',
};

async function getOrCreateTaskChannel(adminTaskId, aiUserId) {
  // Podle schema má ChatChannel @@unique([type, admin_task_id])
  let channel = await prisma.chatChannel.findFirst({
    where: { type: 'task', admin_task_id: adminTaskId },
  });

  if (channel) return channel;

  channel = await prisma.chatChannel.create({
    data: {
      type: 'task',
      admin_task_id: adminTaskId,
      name: `Úkol #${adminTaskId}`,
      created_by: aiUserId,
      // Přidej AI Vývojáře jako členy zatím sám sebou — autor úkolu se
      // přihlašuje přes existující admin-tasks logiku, neměníme to tady.
      members: {
        create: [{ user_id: aiUserId, role: 'admin' }],
      },
    },
  });
  return channel;
}

/**
 * Posílá zprávu od servisního usera 'ai-vyvojar' do chat threadu úkolu.
 * @param {number} adminTaskId
 * @param {string} text — obsah zprávy
 * @param {{ template?: keyof typeof TEMPLATES, args?: any[] }} opts
 */
async function postMessage(adminTaskId, text, opts = {}) {
  const aiUserId = await repository.getAiDeveloperUserId();

  let content = text;
  if (opts.template && TEMPLATES[opts.template]) {
    content = TEMPLATES[opts.template](...(opts.args || []));
  }

  const channel = await getOrCreateTaskChannel(adminTaskId, aiUserId);

  const message = await prisma.chatMessage.create({
    data: {
      channel_id: channel.id,
      sender_id: aiUserId,
      sender_type: 'ai',
      sender_label: 'Alan, AI Vývojář',
      content,
    },
  });

  // Aktualizuj last_message_at na kanálu (pro řazení v inboxu)
  await prisma.chatChannel.update({
    where: { id: channel.id },
    data: { last_message_at: message.created_at },
  });

  return { channel, message };
}

/**
 * Vytvoří Notification pro autora AdminTask (created_by).
 */
async function notifyTaskCreator(adminTaskId, { type, title, body, link, meta } = {}) {
  const task = await prisma.adminTask.findUnique({
    where: { id: adminTaskId },
    select: { id: true, created_by: true },
  });
  if (!task || !task.created_by) return null;

  return prisma.notification.create({
    data: {
      user_id: task.created_by,
      type: type || 'task_status',
      title: title || `Úkol #${adminTaskId}`,
      body: body || null,
      link: link || `/modules/admin-tasks/index.html?task=${adminTaskId}`,
      meta: { task_id: adminTaskId, ...(meta || {}) },
    },
  });
}

module.exports = {
  postMessage,
  notifyTaskCreator,
  getOrCreateTaskChannel,
  TEMPLATES,
};
