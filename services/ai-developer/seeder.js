// =============================================================================
// HolyOS — AI Vývojář / seeder (AI jádro navrhuje úkoly z historie, Fáze 4)
// =============================================================================
// On-demand (ne periodicky). Tomáš v UI klikne 🌱 Navrhnout úkoly →
// seeder.propose() agreguje recent failed/escalated AI runs + rejected plans +
// affected_module distribution → Claude haiku navrhne 1-3 AdminTask drafts.
// Tomáš si vybere který accept → POST /api/admin-tasks/ s draftem.
//
// Cíl: AI Vývojář není jen reaktivní (čeká na zadání), ale proaktivní
// (navrhuje co opravit z minulých chyb / opakujících se patternů).

const Anthropic = require('@anthropic-ai/sdk');
const { prisma } = require('../../config/database');

const SEEDER_MODEL = process.env.AI_DEV_SEEDER_MODEL || 'claude-haiku-4-5-20251001';
const SEEDER_MAX_TOKENS = 2000;

const SYSTEM_PROMPT = `Jsi "Alan, AI Vývojář" v HolyOS. Tvoje role v této akci: prozkoumat HISTORII selhání AI Vývojáře a NAVRHNOUT 1-3 nové AdminTasky, které by stálo za to vytvořit (např. opravit opakující se chybu, dořešit nedokončený plán, uzavřít TODO).

VRAŤ POUZE jeden XML tag <proposals>...</proposals> obsahující JSON pole. Žádný markdown, žádný komentář mimo tag.

Tvar JSON:
[
  {
    "page_title": "krátký titulek (max 100 znaků)",
    "description": "strukturovaný popis (3-6 řádků), proč navrhuju a co by mělo být uděláno",
    "acceptance_criteria": "Cíl: ... \nDefinice hotovo: \n- ... \nModul: ... \nTyp změny: ...",
    "affected_module": "modul HolyOSu (HR / Sklad / Účetní doklady / ...) nebo 'globální'",
    "change_type": "bug_fix | new_feature | refactor | ui_change | integration | documentation | data_migration",
    "priority": "low | medium | high",
    "seeder_reason": "krátké česky proč jsi tento úkol navrhl (z které části historie vyplývá)"
  }
]

PRAVIDLA:
- Maximum 3 návrhy. Méně je lepší, pokud nemáš dost solidních pattern.
- Každý návrh musí být KONKRÉTNÍ a AKČNÍ. Ne "zlepši HR modul" ale "Oprav že tabulka HR.people neukazuje sloupec X kvůli chybějícímu mapping".
- Priorita podle dopadu: high = blokuje produkci nebo opakovaně selhává; medium = užitečné fix; low = nice-to-have.
- Pokud history neukazuje smysluplné patterny (málo dat, žádné failures), vrať prázdné pole [].
- Český jazyk, věcný styl.`;

async function propose({ lookbackDays = 30 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY chybí — seeder nelze spustit');

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // 1) Failed/escalated runs
  const failedRuns = await prisma.agentRun.findMany({
    where: { status: { in: ['failed', 'escalated', 'cancelled'] }, started_at: { gte: since } },
    orderBy: { ended_at: 'desc' },
    take: 20,
    select: {
      id: true, status: true, failure_reason: true, summary: true, ended_at: true,
      task: { select: { id: true, page_title: true, affected_module: true, change_type: true } },
    },
  });

  // 2) Rejected approvals
  const rejectedApprovals = await prisma.agentApproval.findMany({
    where: { decision: 'rejected', requested_at: { gte: since } },
    orderBy: { decided_at: 'desc' },
    take: 10,
    select: {
      id: true, kind: true, comment: true, decided_at: true,
      run: { select: { task: { select: { id: true, page_title: true, affected_module: true } } } },
    },
  });

  // 3) Tasks pending (assignable_to_ai but no successful run yet) — recent
  const pendingTasks = await prisma.adminTask.findMany({
    where: {
      assignable_to_ai: true,
      deleted_at: null,
      status: { in: ['new', 'in_progress'] },
      created_at: { gte: since },
    },
    orderBy: { created_at: 'desc' },
    take: 10,
    select: { id: true, page_title: true, affected_module: true, change_type: true, ai_suitability_score: true },
  });

  // 4) Module distribution (kde se nejvíc děje něco)
  const moduleCount = await prisma.agentRun.groupBy({
    by: ['task_id'],
    where: { started_at: { gte: since } },
    _count: { _all: true },
  });

  const stats = {
    period_days: lookbackDays,
    failed_runs_count: failedRuns.length,
    rejected_approvals_count: rejectedApprovals.length,
    pending_tasks_count: pendingTasks.length,
    total_runs_by_task: moduleCount.length,
  };

  // Build user message
  const userMessage = `STATISTIKA POSLEDNÍCH ${lookbackDays} DNÍ:
${JSON.stringify(stats, null, 2)}

FAILED / ESCALATED / CANCELLED RUNS (max 20):
${failedRuns.map((r, i) =>
  `${i + 1}. [${r.status}] #${r.task?.id} "${r.task?.page_title || '?'}" (modul: ${r.task?.affected_module || '?'}, typ: ${r.task?.change_type || '?'}) — ${(r.failure_reason || r.summary || '(bez důvodu)').slice(0, 250)}`
).join('\n') || '(žádné)'}

REJECTED APPROVALS (Tomáš zamítl plán nebo PR):
${rejectedApprovals.map((a, i) =>
  `${i + 1}. ${a.kind} pro #${a.run?.task?.id} "${a.run?.task?.page_title || '?'}" — komentář: ${(a.comment || '(bez)').slice(0, 250)}`
).join('\n') || '(žádné)'}

PENDING TASKS (assignable_to_ai, status new/in_progress):
${pendingTasks.map((t, i) =>
  `${i + 1}. #${t.id} "${t.page_title || '?'}" (modul: ${t.affected_module || '?'}, suitability: ${t.ai_suitability_score ?? '?'})`
).join('\n') || '(žádné)'}

Navrhni 1-3 nové AdminTasky, které by stálo za vytvoření. Vrať <proposals>[...]</proposals>.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: SEEDER_MODEL,
    max_tokens: SEEDER_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return { proposals: [], stats, tokensUsed, reason: 'Claude vrátil žádný text' };

  let parsed = [];
  try {
    const m = textBlock.text.match(/<proposals>([\s\S]*?)<\/proposals>/i);
    const candidate = (m ? m[1] : textBlock.text).trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) parsed = [];
  } catch (e) {
    return { proposals: [], stats, tokensUsed, reason: 'Parser fail: ' + e.message, raw: textBlock.text.slice(0, 500) };
  }

  // Sanitize
  const proposals = parsed.slice(0, 3).map((p) => ({
    page_title: String(p.page_title || '').slice(0, 100),
    description: String(p.description || '').slice(0, 3000),
    acceptance_criteria: String(p.acceptance_criteria || '').slice(0, 3000),
    affected_module: String(p.affected_module || '').slice(0, 100),
    change_type: ['documentation','ui_change','bug_fix','refactor','new_feature','integration','data_migration'].includes(p.change_type) ? p.change_type : null,
    priority: ['low','medium','high'].includes(p.priority) ? p.priority : 'medium',
    seeder_reason: String(p.seeder_reason || '').slice(0, 500),
  })).filter((p) => p.page_title && p.description);

  return { proposals, stats, tokensUsed };
}

module.exports = { propose, SEEDER_MODEL };
