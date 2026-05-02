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

    const tradingHolidayNames = [
      "Republic Day",
      "Holi",
      "Good Friday",
      "Independence Day",
      "Gandhi Jayanti",
      "Dussehra",
      "Diwali",
      "Christmas",
      "Maharashtra Day",
      "Ambedkar Jayanti",
      "Mahashivratri",
      "Ramzan Id",
      "Bakri Id",
      "Muharram",
      "Ganesh Chaturthi",
      "Guru Nanak Jayanti"
    ];

    const holidayDates = new Set(
      data
        .filter(h => tradingHolidayNames.includes(h.localName) || tradingHolidayNames.includes(h.name))
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