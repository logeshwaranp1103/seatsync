/**
 * Time and Slot Utilities for SeatSync
 * Timezone Target: Asia/Kolkata (IST)
 */

/**
 * Converts a time string (e.g. "08:00:00", "08:00", "08:00 AM", "04:00 PM")
 * or an ISO timestamp to total minutes from 00:00 (midnight) for chronological sorting.
 */
export function timeToMinutes(timeInput) {
  if (!timeInput) return 0;
  
  const timeStr = String(timeInput).trim();

  // 1. ISO timestamp string (e.g. 2026-08-08T08:00:00.000Z or 2026-08-08 08:00:00)
  if (timeStr.includes('T') || (timeStr.includes('-') && timeStr.includes(':'))) {
    try {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        const options = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false };
        const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
        let hours = 0;
        let minutes = 0;
        for (const p of parts) {
          if (p.type === 'hour') hours = parseInt(p.value, 10);
          if (p.type === 'minute') minutes = parseInt(p.value, 10);
        }
        return hours * 60 + minutes;
      }
    } catch {
      // Fall through to string regex parsing
    }
  }

  // 2. 12-Hour format with AM/PM (e.g., "08:00 AM", "4:00 PM", "12:30 PM")
  const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const period = ampmMatch[4].toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 3. 24-Hour format (e.g., "08:00:00", "16:00", "08:00")
  const militaryMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (militaryMatch) {
    const hours = parseInt(militaryMatch[1], 10);
    const minutes = parseInt(militaryMatch[2], 10);
    return hours * 60 + minutes;
  }

  return 0;
}

/**
 * Formats a time string or timestamp into standard 12-hour format "hh:mm AM/PM"
 * in Asia/Kolkata timezone.
 */
export function formatSlotTime(timeInput) {
  if (!timeInput) return '';

  const timeStr = String(timeInput).trim();

  // If already properly formatted 12-hour string (e.g. "08:00 AM", "04:00 PM")
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(timeStr)) {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    const h = match[1].padStart(2, '0');
    return `${h}:${match[2]} ${match[3].toUpperCase()}`;
  }

  // Handle ISO string or full timestamp
  if (timeStr.includes('T') || (timeStr.includes('-') && timeStr.includes(':'))) {
    try {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(date);
      }
    } catch {
      // Fallback
    }
  }

  // 24-Hour time format (e.g. "08:00:00" or "16:00")
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (!isNaN(hours) && !isNaN(minutes)) {
      const period = hours >= 12 ? 'PM' : 'AM';
      const formattedHours = hours % 12 || 12;
      const hStr = formattedHours < 10 ? `0${formattedHours}` : `${formattedHours}`;
      const mStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
      return `${hStr}:${mStr} ${period}`;
    }
  }

  return timeStr;
}

/**
 * Formats start and end times into a clean range string: "08:00 AM – 09:00 AM"
 */
export function formatSlotRange(startTime, endTime) {
  const formattedStart = formatSlotTime(startTime);
  const formattedEnd = formatSlotTime(endTime);
  if (!formattedStart && !formattedEnd) return '';
  if (!formattedStart) return formattedEnd;
  if (!formattedEnd) return formattedStart;
  return `${formattedStart} – ${formattedEnd}`;
}

/**
 * Determines period category from slot start_time:
 * - Starting before 11:00 AM (mins < 660) -> MORNING
 * - Starting 11:00 AM to before 4:00 PM (660 <= mins < 960) -> AFTERNOON
 * - Starting 4:00 PM and later (mins >= 960) -> EVENING
 */
export function getSlotPeriod(startTime) {
  const mins = timeToMinutes(startTime);
  if (mins < 660) return 'MORNING';
  if (mins < 960) return 'AFTERNOON';
  return 'EVENING';
}

/**
 * Strips hardcoded parenthetical time ranges from slot names and appends the actual DB time range.
 * Example: "Morning Slot 1 (08:00 AM - 09:00 AM)" with 08:00 to 09:00 -> "Morning Slot 1 (08:00 AM – 09:00 AM)"
 * Example: "Evening Slot (12:00 AM – 11:59 PM)" with 16:00 to 17:00 -> "Evening Slot (04:00 PM – 05:00 PM)"
 */
export function formatSlotTitle(rawName, startTime, endTime) {
  const range = formatSlotRange(startTime, endTime);
  if (!rawName) return range;

  // Remove any existing parenthetical time pattern
  let cleanName = rawName
    .replace(/\s*\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*\)/gi, '')
    .trim();

  if (!cleanName) {
    const periodStr = getSlotPeriod(startTime);
    const capitalizedPeriod = periodStr.charAt(0).toUpperCase() + periodStr.slice(1).toLowerCase();
    cleanName = `${capitalizedPeriod} Slot`;
  }

  return range ? `${cleanName} (${range})` : cleanName;
}

/**
 * Returns a new array of slots sorted chronologically ascending by raw start time.
 */
export function sortSlotsChronologically(slots) {
  if (!Array.isArray(slots)) return [];
  return [...slots].sort((a, b) => {
    const tA = timeToMinutes(a.start_time || a.startTime);
    const tB = timeToMinutes(b.start_time || b.startTime);
    return tA - tB;
  });
}
