function normalizeSymbol(raw = "") {
  return String(raw || "")
    .toUpperCase()
    .replace(/,/g, "")
    .trim();
}

function validSymbol(symbol) {
  return /^[A-Z][A-Z0-9.-]{1,14}$/.test(symbol);
}

function parseQuantity(raw) {
  if (raw == null || raw === "") return 1;
  const cleaned = String(raw).replace(/,/g, "").trim();
  const qty = Number(cleaned);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

function splitLines(message = "") {
  return String(message || "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseAddCommand(message = "") {
  const lines = splitLines(message);
  if (!lines.length) return { entries: [], errors: [] };

  const head = lines[0].replace(/^\/add\s*/i, "").trim();
  const payloadLines = [];
  if (head) payloadLines.push(head);
  payloadLines.push(...lines.slice(1));

  const entries = [];
  const errors = [];

  for (const row of payloadLines) {
    const clean = row.replace(/,/g, " ").trim();
    if (!clean) continue;
    const parts = clean.split(/\s+/).filter(Boolean);
    const symbol = normalizeSymbol(parts[0]);
    const quantity = parseQuantity(parts[1]);

    if (!validSymbol(symbol)) {
      errors.push({ input: row, symbol, reason: "Invalid symbol" });
      continue;
    }
    if (quantity == null) {
      errors.push({ input: row, symbol, reason: "Invalid quantity" });
      continue;
    }

    entries.push({ symbol, quantity });
  }

  return { entries, errors };
}

export function parseRemoveCommand(message = "") {
  const lines = splitLines(message);
  if (!lines.length) return { symbols: [], errors: [] };

  const head = lines[0].replace(/^\/remove\s*/i, "").trim();
  const payloadLines = [];
  if (head) payloadLines.push(head);
  payloadLines.push(...lines.slice(1));

  const symbols = [];
  const errors = [];

  for (const row of payloadLines) {
    const token = normalizeSymbol(row.split(/\s+/)[0] || "");
    if (!validSymbol(token)) {
      errors.push({ input: row, symbol: token, reason: "Invalid symbol" });
      continue;
    }
    symbols.push(token);
  }

  return { symbols, errors };
}
