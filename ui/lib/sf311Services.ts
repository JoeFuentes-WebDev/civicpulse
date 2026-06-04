import { getSf311Config, isSf311Configured, sf311AuthHeaders } from './sf311Config';

export type Sf311Service = {
  service_code: string;
  service_name: string;
  metadata?: boolean;
  type?: string;
  group?: string;
};

/** Cached copy of the 7 partner types — used if live fetch fails. */
export const SF311_POC_SERVICES: Sf311Service[] = [
  { service_code: 'input:Pothole & Street Issues', service_name: 'Pothole or street issues', group: 'Repair' },
  { service_code: 'PW:BSM:Damage Property', service_name: 'Damaged public property', group: 'Repair' },
  { service_code: 'input:Parking & Traffic Sign Repair', service_name: 'Parking and traffic sign repair', group: 'Repair' },
  { service_code: 'PW:BUF:Tree Maintenance', service_name: 'Tree maintenance', group: 'General' },
  { service_code: 'input:Illegal Postings', service_name: 'Illegal postings', group: 'Cleaner streets' },
  { service_code: 'input:Improper Scooter and Bike Parking', service_name: 'Improper scooter and bicycle parking', group: 'Parking and transportation' },
  { service_code: 'RPD:General:General', service_name: 'Park requests', group: 'General' },
];

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedServices: Sf311Service[] | null = null;
let cachedAt = 0;

/** Official SF Open311 partner catalog (7 types for POC). */
export async function getSf311Services(): Promise<Sf311Service[]> {
  if (cachedServices && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedServices;
  }

  const { servicesUrl } = getSf311Config();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (isSf311Configured()) {
    Object.assign(headers, sf311AuthHeaders());
  }

  const res = await fetch(servicesUrl, { headers });
  if (!res.ok) {
    console.warn(`SF311 services fetch failed (${res.status}); using POC fallback list`);
    cachedServices = SF311_POC_SERVICES;
    cachedAt = Date.now();
    return cachedServices;
  }

  const data = (await res.json()) as Sf311Service[];
  cachedServices = data.length > 0 ? data : SF311_POC_SERVICES;
  cachedAt = Date.now();
  return data;
}

export function formatSf311ServicesForPrompt(services: Sf311Service[]): string {
  return services
    .map(s => `- ${s.service_code}: ${s.service_name}`)
    .join('\n');
}

export async function isValidSf311ServiceCode(code: string): Promise<boolean> {
  const services = await getSf311Services();
  return services.some(s => s.service_code === code);
}

export function findSf311Service(
  services: Sf311Service[],
  serviceCode: string
): Sf311Service | undefined {
  return services.find(s => s.service_code === serviceCode);
}

/** Ensure classifier output uses a valid Open311 service_code + service_name. */
export function normalizeSf311Classification(
  services: Sf311Service[],
  output: {
    category: string;
    service_code: string;
    severity: number;
    confidence: number;
    reasoning: string;
    location_mention: string | null;
    is_different_location: boolean;
  }
) {
  const matched = findSf311Service(services, output.service_code);
  if (matched) {
    return { ...output, category: matched.service_name };
  }

  const fallback =
    findSf311Service(services, 'PW:BSM:Damage Property') ?? services[0];

  return {
    ...output,
    service_code: fallback.service_code,
    category: fallback.service_name,
    confidence: Math.min(output.confidence, 0.75),
    reasoning: `${output.reasoning} (Invalid service_code remapped to ${fallback.service_name}.)`,
  };
}
