import { describe, expect, it } from "vitest";
import {
  safeString,
  safeSubstring,
  extractSymbol,
  shouldAnalyze,
  safeObject
} from "../src/core/safety.js";

describe("safety helpers", () => {
  it("safeString returns empty string for null", () => {
    expect(safeString(null)).toBe("");
  });

  it("safeString returns valid strings unchanged", () => {
    expect(safeString("abc")).toBe("abc");
  });

  it("safeSubstring returns empty string for null", () => {
    expect(safeSubstring(null)).toBe("");
  });

  it("safeSubstring truncates strings", () => {
    expect(safeSubstring("abcdef", 3)).toBe("abc");
  });

  it("extractSymbol parses common analyze commands", () => {
    expect(extractSymbol("ANALYZE TCS")).toBe("TCS");
    expect(extractSymbol("/analyze reliance")).toBe("RELIANCE");
    expect(extractSymbol("tcs")).toBe("TCS");
    expect(extractSymbol("   tcs   ")).toBe("TCS");
    expect(extractSymbol("Analyze   reliance")).toBe("RELIANCE");
  });

  it("extractSymbol rejects invalid short inputs", () => {
    expect(extractSymbol("hi")).toBeNull();
  });

  it("shouldAnalyze accepts valid symbols", () => {
    expect(shouldAnalyze("TCS")).toBe(true);
  });

  it("shouldAnalyze rejects ignored or invalid tokens", () => {
    expect(shouldAnalyze("HI")).toBe(false);
  });

  it("safeObject returns an object for null", () => {
    expect(typeof safeObject(null)).toBe("object");
    expect(safeObject(null)).toEqual({});
  });
});
