export const meta = {
  name: 'grunt',
  description: 'Haiku-only fleet for mechanical work. You (opus) decide the decomposition and supply explicit jobs; haiku agents execute and return claims carrying reproducible evidence; a second haiku pass independently re-runs them. Nothing here is trusted on assertion.',
  whenToUse: 'Sweeps, counts, call-site hunts, log scraping, running commands and reporting output — work where checking the answer is cheaper than producing it. Pass explicit jobs: args = "one job" or {jobs: ["...","..."], crossCheck: true}. Never use it for judgment, design, or code that must be correct on first read.',
  phases: [
    { title: 'Grunt', detail: 'haiku — one agent per job, evidence-bearing claims' },
    { title: 'Check', detail: 'haiku — independent re-run of each claim' },
  ],
}

const input = typeof args === 'string' ? { jobs: [args] } : (args || {})
const JOBS = (input.jobs || []).filter(j => typeof j === 'string' && j.trim())
if (!JOBS.length) throw new Error('grunt: pass explicit jobs — args: "one job" or {jobs: [...]}. Decomposition is the supervisor\'s job, not the fleet\'s.')
if (JOBS.length > 12) throw new Error(`grunt: ${JOBS.length} jobs is beyond this workflow's purpose — split it across runs.`)
const CROSS_CHECK = input.crossCheck !== false

const CLAIM = {
  type: 'object', additionalProperties: false,
  required: ['claim', 'path', 'line', 'evidence', 'command'],
  properties: {
    claim: { type: 'string', description: 'What was found, in one sentence.' },
    path: { type: 'string', description: 'Repo-relative path, copied from tool output.' },
    line: { type: 'integer', description: 'Line number copied from tool output (grep -n). Use 0 only for whole-file facts.' },
    evidence: { type: 'string', description: 'The matching line verbatim — not paraphrased, not tidied.' },
    command: { type: 'string', description: 'Exact shell command reproducing this finding from the repo root.' },
  },
}

const GRUNT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'searched', 'findings', 'notFound', 'unsure'],
  properties: {
    status: { type: 'string', enum: ['complete', 'partial', 'blocked'] },
    searched: { type: 'array', items: { type: 'string' }, description: 'The patterns/commands actually run, verbatim. Defines the limit of what these findings prove.' },
    findings: { type: 'array', maxItems: 40, items: CLAIM },
    notFound: { type: 'array', items: { type: 'string' }, description: 'Things looked for and genuinely absent. A correct, valuable result.' },
    unsure: { type: 'array', items: { type: 'string' }, description: 'Anything believed but not established by tool output. Belongs here, never in findings.' },
    blockedBy: { type: 'string', description: 'Required when status is blocked: exactly what stopped the job, with the error text.' },
  },
}

const CHECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['index', 'reproduced', 'note'],
        properties: {
          index: { type: 'integer', description: 'Index of the claim as given.' },
          reproduced: { type: 'string', enum: ['yes', 'no', 'unchecked'] },
          note: { type: 'string', description: 'One line on what the command actually printed. Required when not "yes".' },
        },
      },
    },
  },
}

// Each job runs, then its own claims are re-run by a different agent — pipelined,
// so job B is still sweeping while job A's claims are already being checked.
phase('Grunt')
const results = await pipeline(
  JOBS,
  (job, _orig, i) => agent(
    `Job ${i + 1} of ${JOBS.length}:\n\n${job}\n\n` +
    `Return only what tools printed in this session. Report NOT FOUND where nothing was found — ` +
    `that is a correct answer, not a failure. Every finding needs path, line, verbatim evidence, ` +
    `and a command that reproduces it from the repo root.`,
    { agentType: 'haiku-grunt', model: 'haiku', label: `grunt:${i + 1}`, phase: 'Grunt', schema: GRUNT_SCHEMA }
  ),
  async (res, job, i) => {
    if (!res) return { job, error: 'grunt agent returned nothing' }
    if (!CROSS_CHECK || !res.findings.length) return { job, ...res, verdicts: null }
    const check = await agent(
      `Re-run and check these claims. You did not make them.\n\nClaims:\n` +
      res.findings.map((f, n) => `[${n}] ${f.claim}\n    path: ${f.path}:${f.line}\n    evidence: ${f.evidence}\n    command: ${f.command}`).join('\n\n') +
      `\n\nRun each command. Report reproduced yes/no/unchecked per index. Default to "no" when unsure.`,
      { agentType: 'haiku-checker', model: 'haiku', label: `check:${i + 1}`, phase: 'Check', schema: CHECK_SCHEMA }
    )
    return { job, ...res, verdicts: check ? check.verdicts : null }
  }
)

// Partition by what actually survived an independent re-run. Plain code, not an agent.
const confirmed = [], unconfirmed = [], unchecked = []
for (const r of results.filter(Boolean)) {
  if (r.error || !r.findings) continue
  r.findings.forEach((f, n) => {
    const v = r.verdicts ? r.verdicts.find(x => x.index === n) : null
    const row = { ...f, job: r.job, note: v?.note }
    if (!v || v.reproduced === 'unchecked') unchecked.push(row)
    else if (v.reproduced === 'yes') confirmed.push(row)
    else unconfirmed.push(row)
  })
}

log(`${confirmed.length} confirmed / ${unconfirmed.length} failed re-run / ${unchecked.length} unchecked`)

return {
  // Read in this order. The warning is not decoration — the run above produced
  // failed re-runs at a rate you should assume is normal, not exceptional.
  supervisorNote:
    'Haiku wrote every claim below and haiku checked it. Both can be wrong in the same direction. ' +
    'CONFIRMED means one cheap agent reproduced another cheap agent\'s command — it is a filter, not a proof. ' +
    'Before anything here changes a decision, run its `command` yourself; that is one bash call and it is the ' +
    'whole reason the commands are attached. Treat UNCONFIRMED and UNCHECKED as unwritten.',
  confirmed,
  unconfirmed,
  unchecked,
  notFound: results.filter(Boolean).flatMap(r => (r.notFound || []).map(x => ({ job: r.job, absent: x }))),
  unsure: results.filter(Boolean).flatMap(r => (r.unsure || []).map(x => ({ job: r.job, unsure: x }))),
  searched: results.filter(Boolean).map(r => ({ job: r.job, patterns: r.searched, status: r.status, blockedBy: r.blockedBy })),
  spotCheck: confirmed.slice(0, 5).map(f => f.command),
}
