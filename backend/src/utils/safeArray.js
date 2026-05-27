/**
 * Safe Array / Object normalization utilities.
 * Used throughout the scanner and intelligence pipeline to prevent
 * undefined .map()/.filter()/.reduce() crashes on empty or malformed data.
 */

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
