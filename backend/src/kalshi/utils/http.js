export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.body = json;
      throw error;
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
