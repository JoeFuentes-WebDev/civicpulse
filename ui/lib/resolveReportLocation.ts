import { extractPlaceFromDescription } from './extractPlaceFromDescription';
import { forwardGeocode, reverseGeocode } from './geocode';

export type ReportLocationSource =
  | 'gps'
  | 'description'
  | 'description_not_found';

export type ResolvedReportLocation = {
  lat: number;
  lng: number;
  source: ReportLocationSource;
  mention?: string;
  address?: string;
  /** Set when text named a place but forward geocode returned no results. */
  geocodeFailed?: boolean;
};

/**
 * Prefer a place named in the report text over raw device GPS
 * (GPS is often wrong on desktop / indoors).
 */
export async function resolveReportCoordinates(input: {
  text?: string;
  lat: number;
  lng: number;
}): Promise<ResolvedReportLocation> {
  const gpsPlace = await reverseGeocode(input.lat, input.lng);
  const city = gpsPlace.city;

  const mention = input.text ? extractPlaceFromDescription(input.text) : null;

  if (!mention) {
    return {
      lat: input.lat,
      lng: input.lng,
      source: 'gps',
      address: gpsPlace.address,
    };
  }

  const geocoded = await forwardGeocode(mention, city);
  if (!geocoded) {
    return {
      lat: input.lat,
      lng: input.lng,
      source: 'description_not_found',
      mention,
      address: gpsPlace.address,
      geocodeFailed: true,
    };
  }

  return {
    lat: geocoded.lat,
    lng: geocoded.lng,
    source: 'description',
    mention,
    address: geocoded.address,
  };
}
