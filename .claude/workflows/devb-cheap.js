export const meta = {
  name: 'devb-cheap',
  description: 'Cost-aware dev loop for InterPoll: a sonnet router classifies the task, then the script assembles only the phases and model tiers that task deserves — escalating to better models only on failure.',
  whenToUse: 'The default for day-to-day work in this repo. It spends haiku/sonnet on mechanical work, reaches for opus only on judgment or after a failure, and hands genuinely architectural tasks off to the full `devb` pipeline. Pass the task as args (string, or {task, maxRoute, force}).',
  phases: [
    { title: 'Route',     detail: 'sonnet — classify blast radius, pick route + model tiers' },
    { title: 'Scout',     detail: 'haiku — locate files (skipped on micro)' },
    { title: 'Plan',      detail: 'sonnet — slices (standard only)' },
    { title: 'Implement', detail: 'router-chosen tier' },
    { title: 'Verify',    detail: 'haiku — vitest + lint' },
    { title: 'Diagnose',  detail: 'opus — only when verify fails' },
    { title: 'Repair',    detail: 'sonnet — fix what diagnosis named' },
    { title: 'Review',    detail: 'opus — only if the router asked for it' },
  ],
}

const input = typeof args === 'string' ? { task: args } : (args || {})
const TASK = input.task
if (!TASK) throw new Error('devb-cheap: pass the task, e.g. Workflow({name:"devb-cheap", args:"fix the empty voters node"})')

const RANK = { micro: 0, small: 1, standard: 2, deep: 3 }
const TIERS = ['haiku', 'sonnet', 'opus']
const bump = m => TIERS[Math.min(TIERS.indexOf(m) + 1, 2)] || 'sonnet'

const ROUTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['route', 'why', 'files', 'touchesSensitive', 'models', 'wantsReview', 'slices'],
  properties: {
    route: { type: 'string', enum: ['micro', 'small', 'standard', 'deep'] },
    why: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    touchesSensitive: { type: 'boolean', description: 'True if any sensitive-set path is involved.' },
    wantsReview: { type: 'boolean', description: 'True if an opus adversarial review is worth its cost here.' },
    slices: { type: 'integer', minimum: 1, maximum: 4 },
    models: {
      type: 'object', additionalProperties: false,
      required: ['scout', 'planner', 'implementer', 'verifier'],
      properties: {
        scout:       { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
        planner:     { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
        implementer: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
        verifier:    { type: 'string', enum: ['haiku', 'sonnet', 'opus'] },
      },
    },
  },
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['goal', 'slices', 'testCommand'],
  properties: {
    goal: { type: 'string' },
    testCommand: { type: 'string' },
    slices: {
      type: 'array', maxItems: 4,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'files', 'instructions'],
        properties: {
          title: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'string', description: 'Self-contained; the implementer sees only this.' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pass', 'report'],
  properties: {
    pass: { type: 'boolean', description: 'True only if the suite the change touches is green and no new lint error was introduced.' },
    report: { type: 'string', description: 'The full verdict in the required shape, including verbatim failing output.' },
    newFailures: { type: 'array', items: { type: 'string' }, description: 'Spec names that fail now; omit ones you confirmed already failed before this diff.' },
  },
}

const DIAG_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cause', 'file', 'fix', 'preExisting'],
  properties: {
    cause: { type: 'string' },
    file: { type: 'string' },
    fix: { type: 'string', description: 'Actionable on its own — what to change and to what.' },
    preExisting: { type: 'boolean', description: 'True if this failure was not caused by the new diff.' },
  },
}

// ---- Route -----------------------------------------------------------------
phase('Route')
const r = await agent(
  `Classify this task and pick the route and model tiers.\n\nTask: ${TASK}\n\n` +
  `Grep the repo to find which files it actually lands in before deciding. Guessing high on the ` +
  `sensitive set is correct; guessing low is not.`,
  { agentType: 'devb-router', model: 'sonnet', effort: 'low', label: 'route', phase: 'Route', schema: ROUTE_SCHEMA }
)
if (!r) return { error: 'router failed — rerun, or use the full devb workflow' }

// Deterministic floors the router cannot undercut.
let route = r.route
if (r.touchesSensitive && RANK[route] < RANK.deep) { log(`floor: sensitive paths → deep (router said ${r.route})`); route = 'deep' }
if (input.maxRoute && RANK[route] > RANK[input.maxRoute]) { log(`capped by caller: ${route} → ${input.maxRoute}`); route = input.maxRoute }
if (input.force) { log(`forced by caller: ${route} → ${input.force}`); route = input.force }
log(`route ${route} — ${r.why}`)

// deep is not this workflow's job; hand it to the full pipeline.
if (route === 'deep') {
  log('handing off to the full devb pipeline')
  const deep = await workflow('devb', { task: TASK })
  return { route: 'deep', why: r.why, handedOffTo: 'devb', ...deep }
}

const M = r.models
const files = (r.files || []).join(', ') || '(router named none)'

// ---- Scout (skipped on micro) ----------------------------------------------
let recon = `Router's file guess: ${files}`
if (route !== 'micro') {
  phase('Scout')
  recon = await agent(
    `Locate what is needed for: ${TASK}\nRouter's starting guess: ${files}\n` +
    `Report path:line anchors, the symbols that matter, and the unit_tests/ specs that cover this.`,
    { agentType: 'devb-scout', model: M.scout, label: 'scout', phase: 'Scout' }
  ) || recon
}

// ---- Plan (standard only) --------------------------------------------------
let plan
if (route === 'standard') {
  phase('Plan')
  plan = await agent(
    `Task: ${TASK}\n\nScout findings:\n${recon}\n\nProduce a plan of at most ${r.slices} slices. Each slice's ` +
    `"instructions" must be self-contained — the implementer sees only that field. Keep it tight; this is the ` +
    `cost-aware pipeline, so do not invent work the task did not ask for.`,
    { agentType: 'devb-planner', model: M.planner, effort: 'medium', label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA }
  )
}
if (!plan) {
  plan = {
    goal: TASK,
    testCommand: 'npm run test',
    slices: [{ title: 'implement', files: r.files || [], instructions: `${TASK}\n\nContext:\n${recon}` }],
  }
}

// ---- Implement -------------------------------------------------------------
phase('Implement')
const built = (await parallel(plan.slices.map(s => () =>
  agent(`Slice: ${s.title}\nFiles: ${s.files.join(', ')}\n\n${s.instructions}\n\nGoal: ${plan.goal}\n` +
        `Stay inside these files unless the change is impossible without touching another.`,
    { agentType: 'devb-implementer', model: M.implementer, label: `impl:${s.title}`.slice(0, 48), phase: 'Implement' })
))).filter(Boolean)
if (!built.length) return { route, error: 'no slice implemented' }

// ---- Verify, with escalation on failure ------------------------------------
const verify = (tag, model) => agent(
  `Verify the working tree after: ${plan.goal}\n\nRun ${plan.testCommand}, then npm run lint.\n` +
  `Set pass:false only for a failure this change caused — a spec that was already red at HEAD, or a ` +
  `missing tool (e.g. eslint not installed), is reported in the report field but does not fail the verdict.`,
  { agentType: 'devb-verifier', model, label: `verify${tag}`, phase: 'Verify', schema: VERDICT_SCHEMA })

phase('Verify')
let verdict = await verify('', M.verifier)
let diagnosis = null
let repaired = false

// The whole point of routing cheap: when cheap work fails, pay for a good diagnosis once.
if (verdict && verdict.pass === false) {
  phase('Diagnose')
  log('verify failed → escalating diagnosis to opus')
  diagnosis = await agent(
    `Tests failed after this change. Find the actual cause — do not guess, and do not fix anything.\n\n` +
    `Goal: ${plan.goal}\nImplementer reports:\n${built.join('\n---\n')}\n\nVerifier output:\n${verdict.report}\n\n` +
    `Decide in particular whether this failure was caused by the new diff or was already failing before it.`,
    { agentType: 'devb-reviewer', model: 'opus', effort: 'high', label: 'diagnose', phase: 'Diagnose', schema: DIAG_SCHEMA })

  if (diagnosis && !diagnosis.preExisting) {
    phase('Repair')
    const fix = await agent(
      `Repair brief.\nFile: ${diagnosis.file}\nCause: ${diagnosis.cause}\nFix: ${diagnosis.fix}\n\n` +
      `Apply exactly this. Do not refactor anything else.`,
      { agentType: 'devb-implementer', model: bump(M.implementer), label: 'repair', phase: 'Repair' })
    if (fix) {
      built.push(fix)
      repaired = true
      phase('Verify')
      verdict = await verify(':after-repair', M.verifier)
    }
  } else if (diagnosis?.preExisting) {
    log('diagnosis: failure pre-dates this diff — not repairing')
  }
}

// ---- Review (only when the router judged it worth the money) ---------------
let review = null
if (r.wantsReview || route === 'standard') {
  phase('Review')
  review = await agent(
    `Review the working-tree diff.\n\nGoal: ${plan.goal}\nImplementer reports:\n${built.join('\n---\n')}\n\n` +
    `Only report defects with a concrete failure scenario. If there are none, say so in one line — ` +
    `this is the cost-aware pipeline and padding costs real money.`,
    { agentType: 'devb-reviewer', model: 'opus', effort: 'high', label: 'review', phase: 'Review' })
}

return {
  task: TASK,
  route,
  why: r.why,
  models: M,
  agentsSpent: 1 + (route !== 'micro' ? 1 : 0) + (route === 'standard' ? 1 : 0) + plan.slices.length + 1
    + (diagnosis ? 1 : 0) + (repaired ? 2 : 0) + (review ? 1 : 0),
  goal: plan.goal,
  implemented: built,
  verification: verdict ? verdict.report : 'verifier failed — run npm run test yourself',
  passed: verdict ? verdict.pass : null,
  diagnosis,
  repaired,
  review: review || '(review skipped — router judged it not worth the cost)',
}
