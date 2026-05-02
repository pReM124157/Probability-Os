let holidayCache = {
  year: null,
  dates: new Set()
};

export async function fetchIndianHolidays(year) {
  try {
    // cache check
    if (holidayCache.year === year) {
      return holidayCache.dates;
    }

    const res = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/IN`
    );

    const data = await res.json();

    const tradingKeywords = [
      "Diwali",
      "Holi",
      "Good Friday",
      "Independence Day",
      "Republic Day",
      "Gandhi Jayanti",
      "Dussehra",
      "Muharram",
      "Ramzan",
      "Ganesh Chaturthi",
      "Ambedkar Jayanti",
      "Mahashivratri"
    ];

    const holidayDates = new Set(
      data
        .filter(h =>
          tradingKeywords.some(k =>
            h.localName.toLowerCase().includes(k.toLowerCase()) ||
            h.name.toLowerCase().includes(k.toLowerCase())
          )
        )
        .map(h => h.date) // format: YYYY-MM-DD
    );

    // store in cache
    holidayCache = {
      year,
      dates: holidayDates
    };

    return holidayDates;

  } catch (err) {
    console.error("HOLIDAY API ERROR:", err);
    return new Set(); // fallback safe
  }
}