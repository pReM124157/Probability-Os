const lastExecutionAt = new Map();

export function calculateSchedulerOffset(name) {
  if (name === "recommendation_tracking") return 40 * 1000;
  if (name === "portfolio_surveillance") return 15 * 1000;
  if (name === "backtesting") return 75 * 1000;
  return 5 * 1000;
}

export async function staggerSchedulerExecution(name, fn) {
  const offsetMs = calculateSchedulerOffset(name);
  await new Promise((resolve) => setTimeout(resolve, offsetMs));
  return fn();
}

export function preventSchedulerOverlap(name, minGapMs = 2 * 60 * 1000) {
  const last = lastExecutionAt.get(name) || 0;
  if (Date.now() - last < minGapMs) return false;
  lastExecutionAt.set(name, Date.now());
  return true;
}
