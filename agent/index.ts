import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool, stepCountIs } from 'ai';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Simulates GPS coordinates from device
// In production: replaced by Location.getCurrentPositionAsync() in Expo
async function getDeviceLocation() {
  return {
    lat: 37.7599,
    lng: -122.4148,
  };
}

dotenv.config();

const client = anthropic('claude-sonnet-4-20250514');

const resolve_location = tool({
  description: `Resolves a GPS coordinate into a human-readable address 
                including city, zip code, neighborhood, and state. 
                Always call this first before any other tool.`,
  inputSchema: z.object({
    lat: z.number().describe('Latitude coordinate'),
    lng: z.number().describe('Longitude coordinate'),
  }),
  execute: async ({ lat, lng }) => {
    console.log('resolve_location called with:', lat, lng);
    
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CivicPulse/1.0' }
    });
    const data = await res.json();

    return {
      address: data.display_name,
      city: data.address.city || data.address.town,
      state: data.address.state,
      zip: data.address.postcode,
      neighborhood: data.address.neighbourhood || data.address.suburb,
      country: data.address.country,
    };
  }
});

const classify_report = tool({
  description: `Classifies a civic issue into an SF 311 service category.
                  ALWAYS call this after resolve_location() has returned.
                  Use the city and neighborhood from resolve_location's output.`,
  inputSchema: z.object({
    description: z.string().describe('The user\'s plain language description of the issue'),
    city: z.string().describe('City where the issue is located'),
    neighborhood: z.string().describe('Neighborhood where the issue is located'),
  }),
  execute: async ({ description, city, neighborhood }) => {
    console.log('classify_report called with:', description, city, neighborhood);

    // SF 311 service code lookup
    const serviceCategories: Record<string, { service_code: string; category: string }> = {
      pothole: { service_code: 'pothole_sf', category: 'Street Defect' },
      graffiti: { service_code: 'graffiti_sf', category: 'Graffiti' },
      dumping: { service_code: 'dumping_sf', category: 'Illegal Dumping' },
      streetlight: { service_code: 'streetlight_sf', category: 'Street Light Outage' },
      sidewalk: { service_code: 'sidewalk_sf', category: 'Sidewalk Damage' },
      homeless: { service_code: 'encampment_sf', category: 'Homeless Encampment' },
      drug: { service_code: 'druguse_sf', category: 'Open Air Drug Use' },
      abandoned_vehicle: { service_code: 'abandoned_vehicle_sf', category: 'Abandoned Vehicle' },
      trash: { service_code: 'dumping_sf', category: 'Illegal Dumping' },
    };

    // Simple keyword matching for POC
    // In production: use generateObject() for smarter classification
    const lowerCaseDescription = description.toLowerCase();
    let match = { service_code: 'other_sf', category: 'Other' };
    let severity = 2;
    let confidence = 0.75; 

    if (lowerCaseDescription.includes('pothole')) { match = serviceCategories.pothole; severity = 3; confidence = 0.95}
    else if (lowerCaseDescription.includes('graffiti')) { match = serviceCategories.graffiti; severity = 2; }
    else if (lowerCaseDescription.includes('dump') || lowerCaseDescription.includes('trash')) { match = serviceCategories.dumping; severity = 3; }
    else if (lowerCaseDescription.includes('light')) { match = serviceCategories.streetlight; severity = 3; }
    else if (lowerCaseDescription.includes('sidewalk')) { match = serviceCategories.sidewalk; severity = 2; }
    else if (lowerCaseDescription.includes('tent') || lowerCaseDescription.includes('homeless') || lowerCaseDescription.includes('encampment')) { match = serviceCategories.homeless; severity = 3; }
    else if (lowerCaseDescription.includes('drug') || lowerCaseDescription.includes('shooting') || lowerCaseDescription.includes('needle')) { match = serviceCategories.drug; severity = 5; }
    else if (lowerCaseDescription.includes('car') || lowerCaseDescription.includes('vehicle')) { match = serviceCategories.abandoned_vehicle; severity = 2; }

    return {
      category: match.category,
      service_code: match.service_code,
      severity,
      confidence, 
      reasoning: `Classified "${description}" as ${match.category} in ${neighborhood}, ${city}`,
    };
  }
});

const check_location_history = tool({
  description: `Checks if a location has been reported before.
              ALWAYS call this after classify_report() has returned.
              Use the same lat/lng from the original user location.`,
  inputSchema: z.object({
    lat: z.number().describe('Latitude of the reported issue'),
    lng: z.number().describe('Longitude of the reported issue'),
  }),
  execute: async ({ lat, lng }) => {
    console.log('check_location_history called with:', lat, lng);

    // Mocked for POC — replaced by Supabase query in Phase 2
    return {
      priorReportCount: 3,
      lastReportedDate: '2026-05-01',
      lastStatus: 'closed_unresolved',
      isRepeatLocation: true,
      pattern: 'Reported 3 times in last 60 days, closed without resolution each time',
    };
  }
});

const draft_submission = tool({
  description: `Drafts a complete SF 311 submission from the classified report.
                Call this after check_location_history() has returned.
                Uses all collected data to format a proper 311 report.`,
  inputSchema: z.object({
    description: z.string().describe('Original user description of the issue'),
    service_code: z.string().describe('311 service code from classify_report'),
    category: z.string().describe('Issue category from classify_report'),
    severity: z.number().describe('Severity 1-5 from classify_report'),
    address: z.string().describe('Resolved address from resolve_location'),
    lat: z.number().describe('Latitude'),
    lng: z.number().describe('Longitude'),
    is_repeat: z.boolean().describe('Whether this is a repeat location'),
    prior_report_count: z.number().describe('Number of prior reports at this location'),
  }),
  execute: async ({ description, service_code, category, severity, address, lat, lng, is_repeat, prior_report_count }) => {
    console.log('draft_submission called');

    const repeatNote = is_repeat
      ? `NOTE: This location has been reported ${prior_report_count} times previously with no resolution.`
      : '';

    return {
      service_code,
      description: `${description}. ${repeatNote}`.trim(),
      lat,
      lng,
      address_string: address,
      severity,
      category,
      first_name: 'CivicPulse',
      last_name: 'User',
      email: 'report@civicpulse.app',
      is_repeat_location: is_repeat,
      prior_report_count,
      submitted_at: new Date().toISOString(),
    };
  }
});

const submit_to_311 = tool({
  description: `Submits the drafted report to SF 311 via the Open311 API.
                Only call this if confidence >= 0.90 AND severity <= 3.
                Otherwise stop and return the draft for human review.`,
  inputSchema: z.object({
    service_code: z.string().describe('311 service code'),
    description: z.string().describe('Full report description'),
    lat: z.number().describe('Latitude'),
    lng: z.number().describe('Longitude'),
    address_string: z.string().describe('Human readable address'),
  }),
  execute: async ({ service_code, description, lat, lng, address_string }) => {
    console.log('submit_to_311 called');

    // SF Open311 dev endpoint
    const url = 'http://mobile311-dev.sfgov.org/open311/v2/requests.json';
    
    const body = new URLSearchParams({
      api_key: 'yourapikey',
      service_code,
      description,
      lat: lat.toString(),
      long: lng.toString(),
      address_string,
      first_name: 'CivicPulse',
      last_name: 'User',
      email: 'report@civicpulse.app',
    });

    // Mocked for POC until we get a dev API key
    console.log('Would POST to 311:', Object.fromEntries(body));
    
    return {
      service_request_id: `SF311-POC-${Date.now()}`,
      status: 'open',
      status_notes: 'Report received and queued for review',
      submitted_at: new Date().toISOString(),
    };
  }
});
// Exported agent function — called by POST /api/run
export async function runCivicAgent(input: {
  text?: string;
  lat: number;
  lng: number;
}) {
  const result = await generateText({
    model: client,
    system: `You are a civic reporting agent for San Francisco.
             The user's current GPS coordinates are: ${input.lat}, ${input.lng}.
             When given a report you MUST follow these steps in order:
             1. Call resolve_location() to get the address
             2. Call classify_report() to categorize the issue
             3. Call check_location_history() to check for prior reports
             4. Call draft_submission() with all collected data
             5. If confidence >= 0.90 AND severity <= 3: call submit_to_311() automatically
                If confidence < 0.90 OR severity > 3: stop and return the draft for human review`,
    prompt: input.text || 'No description provided.',
    tools: { resolve_location, classify_report, check_location_history, draft_submission, submit_to_311 },
    stopWhen: stepCountIs(5),
  });

  return {
    text: result.text,
    steps: result.steps.length,
    toolCalls: result.steps.flatMap(s => s.toolCalls ?? []).map(tc => ({
      tool: tc.toolName,
      input: tc.input,
    })),
  };
}

// Local test runner
async function main() {
  console.log('Running agent...\n');
  const location = await getDeviceLocation();
  console.log('Device location:', location);

  const result = await runCivicAgent({
    text: 'There is a pothole on Valencia near 18th.',
    lat: location.lat,
    lng: location.lng,
  });

  console.log('\nFinal response:', result.text);
  console.log('Steps taken:', result.steps);
  console.log('Tool calls:', JSON.stringify(result.toolCalls, null, 2));
}

main();