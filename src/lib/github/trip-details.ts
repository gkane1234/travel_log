const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DayNote = { date: string; text: string };

/** A missing file or a blank note is not a day that would be dropped. */
export function isBlankDayNote(text: string | null | undefined): boolean {
  return text == null || text.trim() === "";
}

/**
 * Inclusive start/end. A blank end date is a single day (the start).
 * Returns null when the dates are missing or the end is before the start.
 */
export function tripDateRange(start: string, end: string): { start: string; end: string } | null {
  if (!ISO_DATE.test(start)) return null;
  const last = end.trim() || start;
  if (!ISO_DATE.test(last) || last < start) return null;
  return { start, end: last };
}

/** Dates of stored notes that would fall outside the new range. Blank notes are ignored. */
export function dayNotesOutsideRange(notes: DayNote[], start: string, end: string): string[] {
  const range = tripDateRange(start, end);
  if (!range) return [];
  const dates = new Set<string>();
  for (const note of notes) {
    if (!ISO_DATE.test(note.date) || isBlankDayNote(note.text)) continue;
    if (note.date < range.start || note.date > range.end) dates.add(note.date);
  }
  return [...dates].sort();
}

export function dateRangeRefusal(dates: string[]): string {
  const listed = dates.join(", ");
  return `Cannot save these dates. These day notes would no longer be in the trip: ${listed}. The notes were left in place.`;
}
