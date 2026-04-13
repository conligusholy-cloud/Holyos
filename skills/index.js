// =============================================================================
// HolyOS — Skills Registry
// Centrální registr všech skill handlerů
// =============================================================================

const skills = {
  // HR
  'list-employees':      require('./hr/list-employees'),
  'check-attendance':    require('./hr/check-attendance'),
  'list-leave-requests': require('./hr/list-leave-requests'),

  // Warehouse
  'stock-check':     require('./warehouse/stock-check'),
  'list-orders':     require('./warehouse/list-orders'),
  'list-companies':  require('./warehouse/list-companies'),

  // Production
  'list-products':       require('./production/list-products'),
  'list-workstations':   require('./production/list-workstations'),
  'product-operations':  require('./production/product-operations'),

  // System
  'system-stats': require('./system/system-stats'),
};

// Slug → handler (s podtržítky pro Claude tool_use names)
const skillsByToolName = {};
for (const [slug, handler] of Object.entries(skills)) {
  const toolName = slug.replace(/-/g, '_');
  skillsByToolName[toolName] = handler;
}

/**
 * Vrátí skill handlery pro daného asistenta (z DB assistant_skills)
 * @param {Array} assistantSkills - pole { skill: { slug } }
 */
function getSkillHandlersForAssistant(assistantSkills) {
  return assistantSkills
    .map(as => skills[as.skill.slug])
    .filter(Boolean);
}

/**
 * Vrátí Claude tool definitions pro asistenta
 */
function getToolDefinitions(assistantSkills) {
  return getSkillHandlersForAssistant(assistantSkills)
    .map(s => s.toToolDefinition());
}

/**
 * Najde handler podle tool_use name (s podtržítky)
 */
function getHandlerByToolName(toolName) {
  return skillsByToolName[toolName] || null;
}

module.exports = {
  skills,
  skillsByToolName,
  getSkillHandlersForAssistant,
  getToolDefinitions,
  getHandlerByToolName,
};
