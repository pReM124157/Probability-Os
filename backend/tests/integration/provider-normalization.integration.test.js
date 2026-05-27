import { describe, it, expect } from "vitest";
import {
  normalizeYahooQuote,
  normalizeAlphaQuote,
  normalizeTwelveDataQuote,
  normalizeFinnhubQuote,
  toNumber
} from "../../src/services/marketData.service.js";

describe("Provider normalization integration", () => {
  it("normalizes Yahoo quote", () => {
    const out = normalizeYahooQuote({
      symbol: "TCS.NS",
      regularMarketPrice: "3500.50",
      regularMarketPreviousClose: "3480.10",
      regularMarketChangePercent: "1.2"
    }, "TCS.NS");

    expect(out.regularMarketPrice).toBe(3500.5);
    expect(out.regularMarketPreviousClose).toBe(3480.1);
    expect(out.regularMarketChangePercent).toBe(1.2);
  });

  it("normalizes Alpha quote with multiple field variants", () => {
    const out = normalizeAlphaQuote({
      "Global Quote": {
        "05. price": "3490.00",
        "08. previous close": "3478.20",
        "10. change percent": "0.34%"
      }
    }, "RELIANCE");

    expect(out.regularMarketPrice).toBe(3490);
    expect(out.regularMarketPreviousClose).toBe(3478.2);
    expect(out.regularMarketChangePercent).toBeCloseTo(0.34, 2);
  });

  it("normalizes TwelveData quote using price/close/previous_close", () => {
    const out = normalizeTwelveDataQuote({
      close: "3480.00",
      previous_close: "3460.00",
      percent_change: "0.57"
    }, "HDFCBANK");

    expect(out.regularMarketPrice).toBe(3480);
    expect(out.regularMarketPreviousClose).toBe(3460);
    expect(out.regularMarketChangePercent).toBe(0.57);
  });

  it("normalizes Finnhub quote using c/pc/o/h/l/v", () => {
    const out = normalizeFinnhubQuote({
      c: "2450.5",
      pc: "2430",
      o: "2440",
      h: "2461",
      l: "2425",
      v: "12000"
    }, "NSE:INFY");

    expect(out.regularMarketPrice).toBe(2450.5);
    expect(out.regularMarketPreviousClose).toBe(2430);
    expect(out.open).toBe(2440);
    expect(out.high).toBe(2461);
    expect(out.low).toBe(2425);
    expect(out.volume).toBe(12000);
  });

  it("handles malformed responses", () => {
    const alpha = normalizeAlphaQuote({ error: true }, "X");
    const td = normalizeTwelveDataQuote({ status: "error" }, "X");
    const fh = normalizeFinnhubQuote({ c: "bad" }, "X");

    expect(alpha.regularMarketPrice).toBeNull();
    expect(td.regularMarketPrice).toBeNull();
    expect(fh.regularMarketPrice).toBeNull();
  });

  it("parses numeric strings safely", () => {
    expect(toNumber("1,234.56")).toBe(1234.56);
    expect(toNumber(" 98.4 ")).toBe(98.4);
    expect(toNumber("invalid")).toBeNull();
  });

  it("handles missing fields", () => {
    const out = normalizeYahooQuote({}, "TCS");
    expect(out.regularMarketPrice).toBeNull();
    expect(out.regularMarketPreviousClose).toBeNull();
    expect(out.regularMarketChangePercent).toBe(0);
  });
});
