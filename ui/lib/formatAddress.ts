/** Nominatim reverse-geocode JSON (partial). */
export type NominatimReverseResult = {
  display_name?: string;
  address?: Record<string, string | undefined>;
};

/**
 * Short street-level line for UI and 311 (not Nominatim's comma-separated display_name).
 * Example: "1185 Market Street, San Francisco, California 94102"
 */
export function formatNominatimAddress(data: NominatimReverseResult): string {
  const a = data.address;
  if (!a) {
    return data.display_name ?? 'Unknown location';
  }

  const streetLine = [a.house_number, a.road ?? a.street ?? a.pedestrian]
    .filter(Boolean)
    .join(' ');

  const city = a.city ?? a.town ?? a.village;
  const region = a.state;
  const zip = a.postcode;

  const parts: string[] = [];
  if (streetLine) {
    parts.push(streetLine);
  } else {
    const area = a.neighbourhood ?? a.suburb ?? a.quarter;
    if (area) parts.push(area);
  }
  if (city) parts.push(city);
  if (region && zip) parts.push(`${region} ${zip}`);
  else if (region) parts.push(region);
  else if (zip) parts.push(zip);

  if (parts.length > 0) {
    return parts.join(', ');
  }

  return data.display_name ?? 'Unknown location';
}
