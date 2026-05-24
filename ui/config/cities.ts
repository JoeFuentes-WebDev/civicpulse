export type CityConfig = {
  id: string
  name: string
  state: string
  open311BaseUrl: string
  apiKeyEnvVar: string        // name of the env var holding the API key
  defaultLat: number
  defaultLng: number
  mayorEmail?: string
  supervisorLookupUrl?: string
  notes?: string
}

export const cities: CityConfig[] = [
  {
    id: 'san_francisco',
    name: 'San Francisco',
    state: 'CA',
    open311BaseUrl: 'https://mobile311-dev.sfgov.org/open311/v2',
    apiKeyEnvVar: 'SF_311_API_KEY',
    defaultLat: 37.7749,
    defaultLng: -122.4194,
    mayorEmail: 'mayor@sfgov.org',
    supervisorLookupUrl: 'https://sf.gov/find-your-supervisor',
    notes: 'Dev environment. Switch to production URL before launch.'
  },
  {
    id: 'oakland',
    name: 'Oakland',
    state: 'CA',
    open311BaseUrl: 'https://seeclickfix.com/open311/v2',
    apiKeyEnvVar: 'OAKLAND_311_API_KEY',
    defaultLat: 37.8044,
    defaultLng: -122.2712,
    mayorEmail: 'cao@oaklandca.gov',
    notes: 'Oakland uses SeeClickFix for Open311.'
  },
  {
    id: 'san_jose',
    name: 'San Jose',
    state: 'CA',
    open311BaseUrl: 'https://311.sanjoseca.gov/open311/v2',
    apiKeyEnvVar: 'SANJOSE_311_API_KEY',
    defaultLat: 37.3382,
    defaultLng: -121.8863,
    mayorEmail: 'mayor@sanjoseca.gov',
  },
  {
    id: 'sacramento',
    name: 'Sacramento',
    state: 'CA',
    open311BaseUrl: 'https://crm.cityofsacramento.org/open311/v2',
    apiKeyEnvVar: 'SACRAMENTO_311_API_KEY',
    defaultLat: 38.5816,
    defaultLng: -121.4944,
    mayorEmail: 'mayor@cityofsacramento.org',
  },
  {
    id: 'long_beach',
    name: 'Long Beach',
    state: 'CA',
    open311BaseUrl: 'https://longbeach.gov/open311/v2',
    apiKeyEnvVar: 'LONGBEACH_311_API_KEY',
    defaultLat: 33.7701,
    defaultLng: -118.1937,
    mayorEmail: 'mayor@longbeach.gov',
  },
]

// Lookup by city name — called after resolve_location()
export function getCityConfig(cityName: string): CityConfig | null {
  const normalized = cityName.toLowerCase().replace(/\s+/g, '_');
  return cities.find(c => c.id === normalized) ?? null;
}

// Check if a city is supported
export function isCitySupported(cityName: string): boolean {
  return getCityConfig(cityName) !== null;
}