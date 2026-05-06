// HolyOS — Jednorázový seed: testovací AdminTask pro AI Vývojáře
//
// Vytvoří jeden úkol přiřazený AI Vývojáři (ai-vyvojar), s vyplněnými
// akceptačními kritérii a target_repo_id na holyos-ai-playground.
// Bezpečné: aktivní repo musí existovat, autor je 'tomas.holy'.
//
// Použití (proti aktuální DATABASE_URL z .env — typicky Railway public):
//   node scripts/seed-test-ai-task.js
//
// Spustí se vždy znovu — vytvoří NOVÝ úkol (žádný upsert), takže lze
// volat opakovaně pro další testy. ID nového úkolu se vypíše do stdoutu.

const { prisma } = require('../config/database');

const REPO_NAME = 'holyos-ai-playground';
const CREATOR_USERNAME = 'tomas.holy';

const PAGE_TITLE = 'AI test #1: přidej sekci do README';
const DESCRIPTION =
  'Test úkol pro modul AI Vývojář — ověření end-to-end flow ' +
  '(clone → Claude → commit → PR). Triviální zadání, žádné riziko.';

const ACCEPTANCE_CRITERIA = `Cíl: V repu holyos-ai-playground přidat do souboru README.md na konec novou sekci.

Definice hotovo:
- Soubor README.md končí novou sekcí s nadpisem "## AI Vývojář byl tady"
- Pod nadpisem jsou 2–3 řádky uvítacího textu v češtině (libovolný obsah, krátký)
- Žádný jiný soubor v repu se nemění

Modul: globální (test). Typ změny: documentation.

Testovatelnost: po mergi PR bude README na main obsahovat tu sekci.`;

async function main() {
  console.log('Hledám repo a usera…');

  const repo = await prisma.agentRepo.findFirst({
    where: { name: REPO_NAME, active: true },
  });
  if (!repo) {
    console.error(`Repo "${REPO_NAME}" nenalezen nebo není aktivní. Přidej ho přes UI nejdřív.`);
    process.exit(1);
  }

  const creator = await prisma.user.findUnique({
    where: { username: CREATOR_USERNAME },
  });
  if (!creator) {
    console.error(`User "${CREATOR_USERNAME}" nenalezen.`);
    process.exit(1);
  }

  console.log(`  repo:    ${repo.name} (id=${repo.id})`);
  console.log(`  creator: ${creator.username} (id=${creator.id})`);

  const task = await prisma.adminTask.create({
    data: {
      status: 'new',
      priority: 'medium',
      page_title: PAGE_TITLE,
      description: DESCRIPTION,
      assignable_to_ai: true,
      acceptance_criteria: ACCEPTANCE_CRITERIA,
      affected_module: 'global-test',
      target_repo_id: repo.id,
      created_by: creator.id,
    },
  });

  console.log('');
  console.log('  ✅ Vytvořen testovací AdminTask');
  console.log(`     id:       ${task.id}`);
  console.log(`     title:    ${task.page_title}`);
  console.log(`     repo:     ${repo.name}`);
  console.log(`     creator:  ${creator.username}`);
  console.log('');
  console.log('Worker úkol zvedne do 30 s po zapnutí (AGENT_WORKER_ENABLED=true + Master switch ON).');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
