// =============================================================================
// HolyOS — AI konfigurace (Claude API)
// =============================================================================

module.exports = {
  // Výchozí model pro provozní asistenty
  defaultModel: process.env.AI_MODEL || 'claude-sonnet-4-6',

  // Rychlý model pro routing (výběr agenta)
  routingModel: process.env.AI_ROUTING_MODEL || 'claude-haiku-4-5-20251001',

  // API klíč
  apiKey: process.env.ANTHROPIC_API_KEY || '',

  // Maximální tokeny pro odpověď
  maxTokens: parseInt(process.env.AI_MAX_TOKENS || '4096', 10),

  // Definice asistentů (výchozí konfigurace)
  assistants: {
    skladnik: {
      name: 'Skladník',
      slug: 'skladnik',
      role: 'Správa zásob, objednávek a příjmu materiálu',
      mcpServers: ['holyos-warehouse'],
    },
    personalista: {
      name: 'Personalista',
      slug: 'personalista',
      role: 'Správa zaměstnanců, docházky, dovolených a směn',
      mcpServers: ['holyos-hr'],
    },
    koordinator: {
      name: 'Koordinátor',
      slug: 'koordinator',
      role: 'Vytváření úkolů, přiřazování lidem, sledování termínů',
      mcpServers: ['holyos-tasks', 'holyos-hr'],
    },
    mistr: {
      name: 'Mistr',
      slug: 'mistr',
      role: 'Plánování výroby, přiřazování pracovišť, optimalizace procesů',
      mcpServers: ['holyos-production', 'holyos-warehouse'],
    },
    technik: {
      name: 'Technik',
      slug: 'technik',
      role: 'Práce se soubory, generování reportů, export dat',
      mcpServers: ['holyos-system'],
    },
  },
};
