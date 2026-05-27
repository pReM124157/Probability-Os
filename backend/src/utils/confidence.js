export function normalizeConfidenceScore(value, { assumeScale = "auto" } = {}) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;

  let normalized = raw;
  if (assumeScale === "0_10" || (assumeScale === "auto" && raw <= 10)) {
    normalized = raw * 10;
  }

  return Math.max(0, Math.min(100, Number(normalized.toFixed(2))));
}

export function toConfidence10(value100) {
  const v = Number(value100);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Number((v / 10).toFixed(2))));
}

