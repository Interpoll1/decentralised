// Execution budgets are separate from the deterministic analysis policy.
export const DEFAULT_DEADLINE_MS = 5000;
export const MAX_DEADLINE_MS = 10000;
export const validDeadlineMs = value => Number.isInteger(value) && value >= 1 && value <= MAX_DEADLINE_MS;

// CLI override is explicit and trailing. No automatic retries or budget growth.
export function parseExecutionArgs(input) {
  const args = [...input];
  let deadlineMs = DEFAULT_DEADLINE_MS;
  const at = args.indexOf('--deadline-ms');
  if (at !== -1) {
    if (at !== args.length - 2 || !/^[0-9]+$/.test(args.at(-1))) throw Error('RUN_OPTIONS');
    deadlineMs = Number(args.at(-1));
    args.splice(at, 2);
  }
  if (!validDeadlineMs(deadlineMs)) throw Error('RUN_OPTIONS');
  return { args, deadlineMs };
}
