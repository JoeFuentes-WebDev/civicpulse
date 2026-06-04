import { formatNominatimAddress } from './formatAddress';
import { geocodeQueryVariants } from './extractPlaceFromDescription';

const NOMINATIM_HEADERS = { 'User-Agent': 'CivicPulse/1.0' };

export async function reverseGeocode(lat: number, lng: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res = await fetch(url, { headers: NOMINATIM_HEADERS });
  const data = await res.json();

  const addr = data.address ?? {};

  return {
    lat,
    lng,
    address: formatNominatimAddress(data),
    display_name: data.display_name as string | undefined,
    city:
      (addr.city as string | undefined) ||
      (addr.town as string | undefined) ||
      'San Francisco',
    state: addr.state as string | undefined,
    zip: addr.postcode as string | undefined,
    neighborhood:
      (addr.neighbourhood as string | undefined) ||
      (addr.suburb as string | undefined),
    country: addr.country as string | undefined,
  };
}

async function searchNominatim(query: string, city: string) {
  const q = encodeURIComponent(`${query}, ${city}, California`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  const res = await fetch(url, { headers: NOMINATIM_HEADERS });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

export async function forwardGeocode(mention: string, city: string) {
  const variants = geocodeQueryVariants(mention);

  for (const normalized of variants) {
    const hit = await searchNominatim(normalized, city);
    if (!hit) continue;

    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      address: formatNominatimAddress({
        display_name: hit.display_name,
        address: hit.address,
      }),
      display_name: hit.display_name as string,
    };
  }

  return null;
}
