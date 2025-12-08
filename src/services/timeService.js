import { config } from "../config.js";

function getHourInTimezone(now, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour");
    return Number(hourPart?.value ?? 0);
  } catch {
    // Fallback: server local time
    return now.getHours();
  }
}

export function isBotActiveNow(now = new Date()) {
  const hour = getHourInTimezone(now, config.TIMEZONE);
  const start = config.BOT_ACTIVE_START;
  const end = config.BOT_ACTIVE_END;

  // start == end → interpret as "always active"
  if (start === end) return true;

  if (start < end) {
    // e.g. 9–17
    return hour >= start && hour < end;
  }

  // e.g. 21–9
  return hour >= start || hour < end;
}
