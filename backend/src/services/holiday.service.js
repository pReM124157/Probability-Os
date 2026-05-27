const NSE_HOLIDAYS_FALLBACK = {
  2026: [
    "2026-01-26",
    "2026-03-06",
    "2026-03-27",
    "2026-04-14",
    "2026-05-01",
    "2026-08-15",
    "2026-10-02",
    "2026-11-12",
    "2026-12-25"
  ]
};

let holidayCache = {
  year: null,
  dates: new Set()
};
let holidayFallbackActive = false;

function logHolidayFallback(reason = "fallback") {
  if (!holidayFallbackActive) {
    holidayFallbackActive = true;
    console.warn(`[HOLIDAY] fallback activated (${reason})`);
  }
}

function clearHolidayFallback() {
  if (holidayFallbackActive) {
    holidayFallbackActive = false;
    console.log("[HOLIDAY] API recovery detected");
  }
}

export async function fetchIndianHolidays(year) {
  try {
    if (holidayCache.year === year) {
      return holidayCache.dates;
    }

    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/IN`);
    if (!res.ok) {
      throw new Error(`Bad response: ${res.status}`);
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      logHolidayFallback("empty_response");
      const fallbackDates = NSE_HOLIDAYS_FALLBACK[year] || [];
      return new Set(fallbackDates);
    }

    let data = [];
    try {
      data = JSON.parse(text);
    } catch (err) {
      logHolidayFallback("invalid_json");
      const fallbackDates = NSE_HOLIDAYS_FALLBACK[year] || [];
      return new Set(fallbackDates);
    }

    const tradingHolidayNames = [
      "Republic Day", "Holi", "Good Friday", "Independence Day",
      "Gandhi Jayanti", "Dussehra", "Diwali", "Christmas",
      "Maharashtra Day", "Ambedkar Jayanti", "Mahashivratri",
      "Ramzan Id", "Bakri Id", "Muharram", "Ganesh Chaturthi", "Guru Nanak Jayanti"
    ];

    const apiDates = data
      .filter(h => tradingHolidayNames.includes(h.localName) || tradingHolidayNames.includes(h.name))
      .map(h => h.date);

    const fallbackDates = NSE_HOLIDAYS_FALLBACK[year] || [];
    const finalDates = new Set([...apiDates, ...fallbackDates]);

    holidayCache = {
      year,
      dates: finalDates
    };
    clearHolidayFallback();

    return finalDates;

  } catch (err) {
    logHolidayFallback(err?.message || "request_failed");
    const fallbackDates = NSE_HOLIDAYS_FALLBACK[year] || [];
    return new Set(fallbackDates);
  }
}
