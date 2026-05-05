// HolyOS — Seed AI Vývojář (Fáze 1 / MVP)
//
// Idempotentní:
//   1) servisní user `ai-vyvojar` (display_name "Alan, AI Vývojář")
//      — heslo je náhodný neuhádnutelný hash, login přes UI není možný
//      — jeho user_id používá ChatMessage.sender_id pro zprávy v task channelech
//   2) singleton AgentSettings(id=1) — jen kdyby chyběl (migrace ho vloží,
//      tohle je fallback pro lokální/dev prostředí kde migrace neproběhla)
//
// Použití:
//   node scripts/seed-ai-developer.js
//
// Vrací informaci o vytvořených/aktualizovaných záznamech do stdout.

const { prisma } = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const AI_DEV_USERNAME = 'ai-vyvojar';
const AI_DEV_DISPLAY = 'Alan, AI Vývojář';
const AI_DEV_ROLE = 'system_agent';

async function ensureAiDeveloperUser() {
  // Vygeneruj nepoužitelné heslo — uživatel se nikdy nebude přihlašovat
  // přes login form. Zachováváme bcrypt formát kvůli kompatibilitě s requireAuth.
  const unguessable = crypto.randomBytes(48).toString('hex');
  const hash = await bcrypt.hash(unguessable, 12);

  const existing = await prisma.user.findUnique({ where: { username: AI_DEV_USERNAME } });

  if (existing) {
    // Aktualizuj jen display_name a roli (heslo nepřepisujeme, ať se nezruší
    // jiné případně nastavené hash). Pokud se náhodou změnila role na "user",
    // vrátíme ji zpět na system_agent.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        display_name: AI_DEV_DISPLAY,
        role: AI_DEV_ROLE,
        is_super_admin: false,
      },
    });
    console.log(`  ✅ AI Vývojář user '${AI_DEV_USERNAME}' (id=${existing.id}) — refresh`);
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      username: AI_DEV_USERNAME,
      display_name: AI_DEV_DISPLAY,
      password_hash: hash,
      role: AI_DEV_ROLE,
      is_super_admin: false,
    },
  });
  console.log(`  ✅ AI Vývojář user '${AI_DEV_USERNAME}' (id=${created.id}) — created`);
  return created;
}

async function ensureAgentSettings() {
  const existing = await prisma.agentSettings.findUnique({ where: { id: 1 } });
  if (existing) {
    console.log(`  ✅ AgentSettings(id=1) — exists (enabled=${existing.enabled})`);
    return existing;
  }

  const created = await prisma.agentSettings.create({
    data: {
      id: 1,
      enabled: false,
      default_autonomy: 'pr_review',
      max_concurrent_runs: 1,
      max_runs_per_day: 5,
      daily_token_budget: 1000000,
      default_timeout_minutes: 30,
      max_commits_per_run: 10,
      auto_merge_wait_minutes: 15,
    },
  });
  console.log(`  ✅ AgentSettings(id=1) — created (enabled=${created.enabled})`);
  return created;
}

async function main() {
  console.log('Seeding AI Vývojář (Fáze 1)…');
  const user = await ensureAiDeveloperUser();
  const settings = await ensureAgentSettings();
  console.log('Done. ai-vyvojar user_id =', user.id, '| agent enabled =', settings.enabled);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
