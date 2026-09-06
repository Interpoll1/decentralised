export const meta = {
  name: 'devb',
  description: 'Managed tiered dev loop for InterPoll: opus manager scopes → haiku scouts → opus architect + planner → sonnet implementers → haiku verify + opus review → opus manager gates and orders rework',
  whenToUse: 'Any non-trivial change to this repo where you want cheap models doing the legwork and expensive models doing the judgment. Pass the task as args (string, or {task, slices, reworkRounds}).',
  phases: [
    { title: 'Intake',    detail: 'opus manager — scope, size, definition of done' },
    { title: 'Scout',     detail: 'haiku — locate files, tests, platform twins' },
    { title: 'Design',    detail: 'opus architect — placement, invariants, rejected alternatives' },
    { title: 'Plan',      detail: 'opus planner — file-by-file slices' },
    { title: 'Implement', detail: 'sonnet — one agent per slice' },
    { title: 'Verify',    detail: 'haiku — vitest + lint, verbatim failures' },
    { title: 'Review',    detail: 'opus — adversarial diff review' },
    { title: 'Gate',      detail: 'opus manager — ship / rework / escalate' },
    { title: 'Rework',    detail: 'sonnet — one agent per blocking defect' },
  ],
}

// ---- input -----------------------------------------------------------------
const input = typeof args === 'string' ? { task: args } : (args || {})
const TASK = input.task
if (!TASK) throw new Error('devb: pass the task, e.g. Workflow({name:"devb", args:"fix X in gunService"})')
const MAX_SLICES = Math.min(input.slices ?? 4, 6)
const MAX_REWORK = Math.min(input.reworkRounds ?? 1, 2)

// ---- schemas ---------------------------------------------------------------
const INTAKE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['deliverable', 'size', 'inScope', 'outOfScope', 'risk', 'definitionOfDone'],
  properties: {
    deliverable: { type: 'string' },
    size: { type: 'string', enum: ['trivial', 'standard', 'deep'] },
    inScope: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    risk: { type: 'string', description: 'The one way this hurts users if it ships wrong.' },
    definitionOfDone: { type: 'string', description: 'Observable condition, not "code written".' },
  },
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['goal', 'slices', 'doNotTouch', 'testCommand', 'risks'],
  properties: {
    goal: { type: 'string' },
    slices: {
      type: 'array', maxItems: 6,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'files', 'instructions'],
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string', description: 'Self-contained; the implementer sees only this.' },
          dependsOnPrevious: { type: 'boolean' },
        },
      },
    },
    doNotTouch: { type: 'array', items: { type: 'string' } },
    testCommand: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['decision', 'rationale', 'briefs'],
  properties: {
    decision: { type: 'string', enum: ['SHIP', 'REWORK', 'ESCALATE'] },
    rationale: { type: 'string' },
    escalationQuestion: { type: 'string', description: 'Required when decision is ESCALATE: the exact question for the user.' },
    briefs: {
      type: 'array', maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'defect', 'correct'],
        properties: {
          file: { type: 'string' },
          defect: { type: 'string' },
          correct: { type: 'string', description: 'What correct looks like — actionable on its own.' },
        },
      },
    },
  },
}

// ---- 1. Intake (manager) ---------------------------------------------------
phase('Intake')
const brief = await agent(
  `Mode: INTAKE\n\nRaw task: ${TASK}\n\nScope and size it. Inspect the repo as needed before deciding.`,
  { agentType: 'devb-manager', model: 'opus', effort: 'high', label: 'intake', phase: 'Intake', schema: INTAKE_SCHEMA }
)
if (!brief) return { error: 'intake failed — manager returned nothing' }
log(`intake: ${brief.size} — ${brief.deliverable}`)

// ---- 2. Scout (cheap, parallel, read-only) ---------------------------------
phase('Scout')
const LENSES = [
  { key: 'code',     ask: `Locate the source files, services, stores and views involved in: ${brief.deliverable}. Report path:line anchors and the symbols that matter.` },
  { key: 'tests',    ask: `Locate the existing specs in unit_tests/ that cover, or should cover: ${brief.deliverable}. Report which are at risk and the exact vitest command for each.` },
  { key: 'platform', ask: `For the task "${brief.deliverable}": does it touch the @platform seam, config.ts runtime config, gunService.ts namespacing/wire-filter, or Tor-safety ICE handling? Report which src/platform/web and src/platform/tauri files are implicated, and any config keys. If none, say NONE and stop.` },
]
const recon = (await parallel(LENSES.map(l => () =>
  agent(l.ask, { agentType: 'devb-scout', model: 'haiku', label: `scout:${l.key}`, phase: 'Scout' })
))).filter(Boolean)
if (!recon.length) return { brief, error: 'all scouts failed — nothing to design from' }
const RECON = recon.map((r, i) => `### ${LENSES[i]?.key || i}\n${r}`).join('\n\n')

// ---- 3. Design (architect) — skipped when the manager sized it trivial ------
let design = 'TRIVIAL — architect skipped by manager sizing.'
if (brief.size !== 'trivial') {
  phase('Design')
  design = await agent(
    `Task: ${brief.deliverable}\nIn scope: ${brief.inScope.join('; ')}\nOut of scope: ${brief.outOfScope.join('; ')}\n` +
    `Manager's stated risk: ${brief.risk}\n\nScout findings:\n${RECON}\n\nMake the architectural decision.`,
    { agentType: 'devb-architect', model: 'opus', effort: 'high', label: 'architect', phase: 'Design' }
  ) || 'architect failed — planner proceeds without a design decision'
}

// ---- 4. Plan ---------------------------------------------------------------
phase('Plan')
const plan = await agent(
  `Task: ${brief.deliverable}\nDefinition of done: ${brief.definitionOfDone}\nOut of scope (do not plan work here): ${brief.outOfScope.join('; ')}\n\n` +
  `Architect's decision:\n${design}\n\nScout findings:\n${RECON}\n\n` +
  `Produce the implementation plan, honouring the architect's placement decision. Split into at most ${MAX_SLICES} slices ` +
  `that can be implemented INDEPENDENTLY where possible — each slice's "instructions" must be self-contained (file paths, ` +
  `exact symbols, what to write), because the implementer sees only that field. Mark dependsOnPrevious:true only for a slice ` +
  `that genuinely cannot start until the previous one lands.`,
  { agentType: 'devb-planner', model: 'opus', effort: 'high', label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA }
)
if (!plan) return { brief, design, error: 'planner failed' }
log(`plan: ${plan.slices.length} slice(s) — ${plan.goal}`)

// ---- 5. Implement ----------------------------------------------------------
const guard = `\n\nDo NOT touch: ${(plan.doNotTouch || []).join(', ') || '(nothing listed)'}.` +
              `\nOut of scope: ${brief.outOfScope.join('; ') || '(none)'}` +
              `\nOverall goal for context: ${plan.goal}`

phase('Implement')
const built = []
const independent = plan.slices.filter(s => !s.dependsOnPrevious)
const dependent   = plan.slices.filter(s => s.dependsOnPrevious)

if (independent.length) {
  const rs = await parallel(independent.map(s => () =>
    agent(`Slice: ${s.title}\nFiles: ${s.files.join(', ')}\n\n${s.instructions}${guard}`,
      { agentType: 'devb-implementer', model: 'sonnet', label: `impl:${s.title}`.slice(0, 48), phase: 'Implement' })
  ))
  built.push(...rs.filter(Boolean))
}
for (const s of dependent) {
  const r = await agent(
    `Slice: ${s.title}\nFiles: ${s.files.join(', ')}\n\n${s.instructions}${guard}\n\n` +
    `Already landed by earlier slices:\n${built.join('\n---\n') || '(nothing yet)'}`,
    { agentType: 'devb-implementer', model: 'sonnet', label: `impl:${s.title}`.slice(0, 48), phase: 'Implement' })
  if (r) built.push(r)
}
if (!built.length) return { brief, design, plan, error: 'no slice implemented' }

// ---- 6-8. Verify + Review, then Gate; rework loop --------------------------
const runChecks = async (round) => {
  const tag = round ? `:rework${round}` : ''
  const jobs = [
    () => agent(
      `Verify the working tree after this change: ${plan.goal}\n\nRun: ${plan.testCommand}\nThen the full suite (npm run test) and npm run lint.\nReport in the required shape.`,
      { agentType: 'devb-verifier', model: 'haiku', label: `verify${tag}`, phase: 'Verify' }),
  ]
  if (brief.size === 'deep' || round === 0) {
    jobs.push(() => agent(
      `Review the working-tree diff for this change.\n\nGoal: ${plan.goal}\nArchitect's decision:\n${design}\n\n` +
      `Risks flagged at plan time:\n- ${(plan.risks || []).join('\n- ')}\n\nImplementer reports:\n${built.join('\n---\n')}`,
      { agentType: 'devb-reviewer', model: 'opus', effort: 'high', label: `review${tag}`, phase: 'Review' }))
  }
  const [v, r] = await parallel(jobs)
  return { verdict: v, review: r }
}

let round = 0
let checks = await runChecks(0)
let gate = null

while (true) {
  phase('Gate')
  gate = await agent(
    `Mode: GATE\n\nDeliverable: ${brief.deliverable}\nDefinition of done: ${brief.definitionOfDone}\n` +
    `Rework rounds already spent: ${round} of ${MAX_REWORK}\n\n` +
    `Plan goal: ${plan.goal}\nPlan risks:\n- ${(plan.risks || []).join('\n- ')}\n\n` +
    `Implementer reports:\n${built.join('\n---\n')}\n\n` +
    `VERIFIER OUTPUT (authoritative, do not soften):\n${checks.verdict || '(verifier failed to report)'}\n\n` +
    `REVIEWER FINDINGS:\n${checks.review || '(no review this round)'}\n\n` +
    `Decide SHIP, REWORK or ESCALATE. If REWORK, write one brief per blocking defect.`,
    { agentType: 'devb-manager', model: 'opus', effort: 'high', label: `gate:r${round}`, phase: 'Gate', schema: GATE_SCHEMA }
  )
  if (!gate) { gate = { decision: 'ESCALATE', rationale: 'gate agent failed', briefs: [], escalationQuestion: 'Manager gate failed — review the verifier output manually. Proceed?' }; break }
  log(`gate r${round}: ${gate.decision}`)
  if (gate.decision !== 'REWORK' || !gate.briefs.length) break
  if (round >= MAX_REWORK) { gate = { ...gate, decision: 'ESCALATE', escalationQuestion: gate.escalationQuestion || `Rework budget (${MAX_REWORK}) exhausted with defects outstanding. Keep going, or hand back?` }; break }

  round++
  phase('Rework')
  const fixes = await parallel(gate.briefs.map(b => () =>
    agent(`Rework brief.\nFile: ${b.file}\nDefect: ${b.defect}\nCorrect behavior: ${b.correct}${guard}\n\n` +
          `Fix exactly this. Do not refactor anything else.`,
      { agentType: 'devb-implementer', model: 'sonnet', label: `fix:${b.file}`.slice(0, 48), phase: 'Rework' })
  ))
  built.push(...fixes.filter(Boolean))
  checks = await runChecks(round)
}

return {
  task: TASK,
  intake: brief,
  design,
  goal: plan.goal,
  slices: plan.slices.map(s => s.title),
  implemented: built,
  verification: checks.verdict || 'verifier failed — run npm run test yourself',
  review: checks.review || 'no review performed',
  gate,
  reworkRounds: round,
  doNotTouch: plan.doNotTouch,
}
