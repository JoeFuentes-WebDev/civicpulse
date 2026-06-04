/**
 * Pull a street / intersection phrase from the report text (no LLM).
 * Returns null when the description does not name a place.
 */
export function extractPlaceFromDescription(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  const patterns = [
    /\bon\s+([^,.]+?\s+near\s+[^,.]+?)(?=[,.]|$)/i,
    /\bon\s+([^,.]+?\s+by\s+[^,.]+?)(?=[,.]|$)/i,
    /\bon\s+([^,.]+?\s+at\s+[^,.]+?)(?=[,.]|$)/i,
    /\bon\s+([^,.]+?\s+(?:and|&)\s+[^,.]+?)(?=[,.]|$)/i,
    /\bat\s+([^,.]+?\s+(?:and|&)\s+[^,.]+?)(?=[,.]|$)/i,
    /([^,.]+?\s+by\s+[^,.]+?)(?=[,.]|$)/i,
    /\bon\s+([^,.]+?)(?=[,.]|$)/i,
  ];

  for (const pattern of patterns) {
    const match = t.match(pattern);
    const place = match?.[1]?.trim();
    if (!place || place.length < 3) continue;
    if (/^(the|a|an|my|this)\b/i.test(place)) continue;
    return place;
  }

  return null;
}

function intersectionQueries(a: string, b: string): string[] {
  const left = ensureStreetSuffix(a);
  const right = ensureStreetSuffix(b);
  const forward = `${left} and ${right}`;
  const reverse = `${right} and ${left}`;
  const slash = `${right} / ${left}`;
  const slashReverse = `${left} / ${right}`;

  const aNumbered = /^\d/.test(a.trim());
  const bNumbered = /^\d/.test(b.trim());

  // Slash format resolves SF intersections better than "and" (e.g. 8th & Mission).
  const base = [slash, slashReverse, forward, reverse];
  if (aNumbered && !bNumbered) return unique([slash, slashReverse, reverse, forward]);
  if (bNumbered && !aNumbered) return unique([slash, slashReverse, forward, reverse]);
  return unique(base);
}

/** One or more search strings to try with Nominatim (order can matter). */
export function geocodeQueryVariants(mention: string): string[] {
  const trimmed = mention.trim();

  const nearMatch = trimmed.match(/^(.+?)\s+near\s+(.+)$/i);
  if (nearMatch) {
    return unique([trimmed, ...intersectionQueries(nearMatch[1], nearMatch[2])]);
  }

  const byMatch = trimmed.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return unique([trimmed, ...intersectionQueries(byMatch[1], byMatch[2])]);
  }

  const andMatch = trimmed.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (andMatch) {
    return unique([...intersectionQueries(andMatch[1], andMatch[2]), trimmed]);
  }

  return [ensureStreetSuffix(trimmed)];
}

/** @deprecated Use geocodeQueryVariants — kept for callers that need a single string. */
export function normalizeMentionForGeocode(mention: string): string {
  return geocodeQueryVariants(mention)[0];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ensureStreetSuffix(part: string): string {
  const trimmed = part.trim();

  if (/\b(street|st|avenue|ave|boulevard|blvd|road|rd|way|drive|dr|lane|ln)\b/i.test(trimmed)) {
    return normalizeStreetCasing(trimmed);
  }
  if (/^\d+(st|nd|rd|th)?$/i.test(trimmed)) {
    return `${trimmed} Street`;
  }
  return `${trimmed} Street`;
}

/** "9th street" → "9th Street" */
function normalizeStreetCasing(part: string): string {
  return part
    .replace(/\bstreet\b/gi, 'Street')
    .replace(/\bst\.\b/gi, 'St')
    .replace(/\bst\b/gi, 'St')
    .replace(/\bavenue\b/gi, 'Avenue')
    .replace(/\bave\b/gi, 'Ave')
    .replace(/\bboulevard\b/gi, 'Boulevard')
    .replace(/\bblvd\b/gi, 'Blvd');
}
