import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';
import { getCityConfig, isCitySupported } from '../config/cities';

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
  description: `Classifies a civic issue into the correct 311 category.
                Also extracts any location mention from the description.
                Call this after resolve_location() has returned.`,
  inputSchema: z.object({
    description: z.string().describe('The user\'s plain language description'),
    city: z.string().describe('City from resolve_location'),
    neighborhood: z.string().describe('Neighborhood from resolve_location'),
    gps_address: z.string().describe('Full address from resolve_location'),
  }),
  execute: async ({ description, city, neighborhood, gps_address }) => {
    console.log('classify_report called with:', description);

    const classificationResult = await generateText({
      model: client,
      output: Output.object({
        schema: z.object({
          category: z.string(),
          service_code: z.string(),
          severity: z.number().min(1).max(5),
          confidence: z.number().min(0).max(1),
          reasoning: z.string(),
          location_mention: z.string().nullable(),
          is_different_location: z.boolean(),
        }),
      }),
      prompt: `You are an SF 311 classification expert for ${city}, California.
              
              Classify this civic issue and extract any location information.
              
              User description: "${description}"
              User GPS location: ${gps_address}
              Neighborhood: ${neighborhood}
              
              Available SF 311 service codes:
              - pothole_sf: Potholes, road damage, street defects
              - graffiti_sf: Graffiti, vandalism, tagging
              - dumping_sf: Illegal dumping, trash, debris
              - streetlight_sf: Street light outages
              - sidewalk_sf: Sidewalk or curb damage
              - encampment_sf: Homeless encampments, tents
              - druguse_sf: Open air drug use, needles, paraphernalia
              - abandoned_vehicle_sf: Abandoned cars, trucks, vehicles
              - tree_sf: Fallen trees, branches, tree maintenance
              - noise_sf: Noise complaints, loud parties
              - parking_sf: Illegal parking, blocking driveways
              - water_sf: Water main breaks, flooding, sewage
              - other_sf: Anything that doesn't fit above
              
              Also check: does the description mention a specific location 
              that is DIFFERENT from the GPS location?
              If yes, extract it. If no, set location_mention to null.`,
    });

    return classificationResult.output;
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
  description: `Submits the drafted report to the city's 311 API.
                Only call this if confidence >= 0.90 AND severity <= 3.
                Otherwise stop and return the draft for human review.`,
  inputSchema: z.object({
    service_code: z.string().describe('311 service code'),
    description: z.string().describe('Full report description'),
    lat: z.number().describe('Latitude'),
    lng: z.number().describe('Longitude'),
    address_string: z.string().describe('Human readable address'),
    city: z.string().describe('City name from resolve_location'),
  }),
  execute: async (params) => {
    const { city } = params;
    console.log('Full submission params:', params);
    console.log('submit_to_311 called for city:', city);

    const config = getCityConfig(city);

    if (!config) {
      return {
        error: true,
        message: `${city} is not yet supported. Currently serving California cities only.`,
      };
    }

    // Mocked for POC — Phase 2 uses real API key from config.apiKeyEnvVar
    console.log('Would POST to:', config.open311BaseUrl);

    return {
      service_request_id: `${config.id.toUpperCase()}-POC-${Date.now()}`,
      status: 'open',
      status_notes: 'Report received and queued for review',
      city: config.name,
      submitted_at: new Date().toISOString(),
    };
  }
});

const geocode_address = tool({
  description: `Converts a text address, intersection, or landmark to GPS coordinates.
                Call this when classify_report returns is_different_location: true.
                Use the location_mention from classify_report as input.`,
  inputSchema: z.object({
    address: z.string().describe('Street address, intersection, or landmark to geocode'),
    city: z.string().describe('City for context'),
  }),
  execute: async ({ address, city }) => {
    console.log('geocode_address called with:', address, city);

    const query = encodeURIComponent(`${address}, ${city}, California`);
    const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'CivicPulse/1.0' }
    });

    const data = await res.json();

    if (!data || data.length === 0) {
      return { error: 'Location not found', lat: null, lng: null };
    }

    const result = data[0];

    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
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
    system: `You are a civic reporting agent for California cities.
         The user's current GPS coordinates are: ${input.lat}, ${input.lng}.
         When given a report you MUST follow these steps in order:
         1. Call resolve_location() with the GPS coordinates
         2. Call classify_report() with the resolved location details
         3. If classify_report returns is_different_location: true AND location_mention is not null:
            - Call geocode_address() with the location_mention and city
            - Use the geocoded coordinates for all subsequent steps
            If is_different_location: false:
            - Continue using the original GPS coordinates
         4. Call check_location_history() with the confirmed coordinates
         5. Call draft_submission() with all collected data
         6. If confidence >= 0.90 AND severity <= 3: call submit_to_311() automatically
            If confidence < 0.90 OR severity > 3: stop and return draft for human review`,
    prompt: input.text || 'No description provided.',
    tools: { resolve_location, classify_report, check_location_history, draft_submission, submit_to_311, geocode_address },
    stopWhen: stepCountIs(6),
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

