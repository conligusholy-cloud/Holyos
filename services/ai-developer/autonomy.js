// =============================================================================
// HolyOS — AI Vývojář / autonomy resolver (mix-autonomy podle typu úkolu)
// =============================================================================
// Brief kap. 5.2 + 6.4. Místo singleton settings.default_autonomy se autonomy
// vyřeší per-task:
//   1) task.autonomy_override (pokud set) → vyhrává nad vším ostatním
//   2) CHANGE_TYPE_TO_AUTONOMY[task.change_type] (pokud known)
//   3) settings.default_autonomy (fallback)
//
// Použití v runner.processTask: resolveAutonomy({ changeType, override,
// defaultAutonomy }) → 'full_auto' | 'pr_review' | 'plan_review'.

const CHANGE_TYPES = [
  'documentation',
  'ui_change',
  'bug_fix',
  'refactor',
  'new_feature',
  'integration',
  'data_migration',
];

const AUTONOMY_MODES = ['full_auto', 'pr_review', 'plan_review'];

// Defaultní mapping change_type → autonomy. Konzervativní: vyšší riziko = víc kontroly.
//   documentation → full_auto (drobné, low-risk, agent jen mění md)
//   ui_change     → pr_review (frontend, agent commitne PR, Tomáš zreviewuje)
//   bug_fix       → pr_review (potřebuje code review)
//   refactor      → pr_review (low-risk změny ale chceme PR review)
//   new_feature   → pr_review (default)
//   integration   → plan_review (API integrace = high risk, schvalujem plán PŘED kódem)
//   data_migration → plan_review (DB schema = max risk)
const CHANGE_TYPE_TO_AUTONOMY = {
  documentation: 'full_auto',
  ui_change: 'pr_review',
  bug_fix: 'pr_review',
  refactor: 'pr_review',
  new_feature: 'pr_review',
  integration: 'plan_review',
  data_migration: 'plan_review',
};

function resolveAutonomy({ changeType, override, defaultAutonomy } = {}) {
  if (override && AUTONOMY_MODES.includes(override)) return override;
  if (changeType && CHANGE_TYPE_TO_AUTONOMY[changeType]) return CHANGE_TYPE_TO_AUTONOMY[changeType];
  return AUTONOMY_MODES.includes(defaultAutonomy) ? defaultAutonomy : 'pr_review';
}

module.exports = {
  resolveAutonomy,
  CHANGE_TYPES,
  AUTONOMY_MODES,
  CHANGE_TYPE_TO_AUTONOMY,
};
