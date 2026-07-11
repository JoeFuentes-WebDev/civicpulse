import { anthropic } from '@ai-sdk/anthropic';
import { generateText, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';
import { forwardGeocode, reverseGeocode } from './geocode';
import {
  formatSf311ServicesForPrompt,
  getSf311Services,
  normalizeSf311Classification,
} from './sf311Services';
import { AgentStep } from '../shared/types';
import { getLocationHistory } from './getLocationHistory';

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const client = anthropic(CLAUDE_MODEL);

const resolve_location = tool({
  description: `Resolves a GPS coordinate into a human-readable address 
                including city, zip code, neighborhood, and state. 
                Always call this first before any other tool.`,
  inputSchema: z.object({
    lat: z.number().describe('Latitude coordinate'),
    lng: z.number().describe('Longitude coordinate'),
  }),
  execute: async ({ lat, lng }) => {
    const place = await reverseGeocode(lat, lng);

    return {
      address: place.address,
      display_name: place.display_name,
      city: place.city,
      state: place.state,
      zip: place.zip,
      neighborhood: place.neighborhood,
      country: place.country,
    };
  }
});

/**
 * Builds the classify_report tool. When a photoUrl is supplied, the image is
 * passed to Claude Vision so classification (category + severity) can use what
 * the photo actually shows, not just the text description.
 */
function buildClassifyReport(photoUrl?: string) {
  return tool({
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
      const services = await getSf311Services();
      const serviceList = formatSf311ServicesForPrompt(services);

      const promptText = `You are an SF 311 classification expert for ${city}, California.

              Classify this civic issue into exactly ONE official SF Open311 service type.
              You MUST set service_code to one of the codes below exactly as written.
              Set category to the matching service_name from the same line.

              User description: "${description}"
              User GPS location: ${gps_address}
              Neighborhood: ${neighborhood}
              ${photoUrl ? 'A photo of the issue is attached. Use what it shows to choose the category and severity; if it disagrees with the text, trust the photo and explain why in reasoning.' : ''}

              Official SF Open311 service types (POC — only these may be used):
              ${serviceList}

              Mapping hints when the issue does not match perfectly:
              - Potholes, cracks, street defects → input:Pothole & Street Issues
              - Graffiti, broken fixtures, damaged public property → PW:BSM:Damage Property
              - Parking signs, traffic signs → input:Parking & Traffic Sign Repair
              - Trees, branches, fallen limbs → PW:BUF:Tree Maintenance
              - Flyers, posters, illegal ads → input:Illegal Postings
              - Scooter or bike blocking sidewalk → input:Improper Scooter and Bike Parking
              - Park, playground, rec center issues → RPD:General:General
              - Anything else → pick the closest type above; lower confidence if unsure

              Location rules (important):
              - If the description names a street, intersection, or landmark
                (e.g. "Valencia near 18th", "on Mission at 24th", "by Dolores Park"),
                set is_different_location to true and location_mention to that phrase
                unless gps_address already names the same streets/intersection.
              - If there is no place in the description, set location_mention to null
                and is_different_location to false.`;

      const schema = z.object({
        category: z.string(),
        service_code: z.string(),
        severity: z.number().min(1).max(5),
        confidence: z.number().min(0).max(1),
        reasoning: z.string(),
        location_mention: z.string().nullable(),
        is_different_location: z.boolean(),
      });

      const classificationResult = await generateText({
        model: client,
        output: Output.object({ schema }),
        ...(photoUrl
          ? {
              messages: [
                {
                  role: 'user' as const,
                  content: [
                    { type: 'text' as const, text: promptText },
                    { type: 'image' as const, image: photoUrl },
                  ],
                },
              ],
            }
          : { prompt: promptText }),
      });

      return normalizeSf311Classification(services, classificationResult.output);
    },
  });
}

const check_location_history = tool({
  description: `Checks if a location has been reported before.
              ALWAYS call this after classify_report() has returned.
              Use the same lat/lng from the original user location.`,
  inputSchema: z.object({
    lat: z.number().describe('Latitude of the reported issue'),
    lng: z.number().describe('Longitude of the reported issue'),
  }),
  execute: async ({ lat, lng }) => getLocationHistory(lat, lng),
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

const geocode_address = tool({
  description: `Converts a text address, intersection, or landmark to GPS coordinates.
                Call this when classify_report returns is_different_location: true.
                Use the location_mention from classify_report as input.`,
  inputSchema: z.object({
    address: z.string().describe('Street address, intersection, or landmark to geocode'),
    city: z.string().describe('City for context'),
  }),
  execute: async ({ address, city }) => {
    const result = await forwardGeocode(address, city);

    if (!result) {
      return { error: 'Location not found', lat: null, lng: null };
    }

    return {
      lat: result.lat,
      lng: result.lng,
      address: result.address,
      display_name: result.display_name,
    };
  }
});
// Exported agent function — called by POST /api/run
export async function runCivicAgent(
  input: { text?: string; lat: number; lng: number; photoUrl?: string },
  onStep?: (step: AgentStep) => Promise<void>
) {
  const classify_report = buildClassifyReport(input.photoUrl);

  const system = `You are a civic reporting agent for California cities.
         The user's current GPS coordinates are: ${input.lat}, ${input.lng}.
         ${input.photoUrl ? 'A photo of the issue is attached to the user message — use it to inform the description and classification.' : ''}
         When given a report you MUST follow these steps in order:
         1. Call resolve_location() with the GPS coordinates
         2. Call classify_report() with the resolved location details
         3. If classify_report returns is_different_location: true AND location_mention is not null:
            - Call geocode_address() with the location_mention and city
            - Use the geocoded lat/lng AND display_name for draft_submission and submit
            - Do not use the GPS reverse-geocode address when the user named a different place
            If is_different_location: false:
            - Continue using the original GPS coordinates and resolve_location address
         4. Call check_location_history() with the confirmed coordinates
         5. Call draft_submission() with all collected data
         Do NOT submit to 311 — the app submits after you finish.`;

  const result = await generateText({
    model: client,
    system,
    tools: { resolve_location, geocode_address, classify_report, check_location_history, draft_submission },
    stopWhen: stepCountIs(5),
    ...(input.photoUrl
      ? {
          messages: [
            {
              role: 'user' as const,
              content: [
                {
                  type: 'text' as const,
                  text: input.text?.trim() || 'Analyze the attached photo and report the civic issue it shows.',
                },
                { type: 'image' as const, image: input.photoUrl },
              ],
            },
          ],
        }
      : { prompt: input.text || 'No description provided.' }),
    onStepFinish: async (step) => {
      if (onStep && step.toolCalls?.length > 0) {
        const toolCall = step.toolCalls[0];
        await onStep({
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          status: 'complete',
          output: toolCall.input as Record<string, unknown>,
          timestamp: new Date(),
        });
      }
    },
  });

  return {
    text: result.text,
    steps: result.steps.length,
    toolCalls: result.steps.flatMap(s => s.toolCalls ?? []).map(tc => ({
      tool: tc.toolName,
      input: tc.input,
    })),
    toolResults: result.steps.flatMap(s => s.toolResults ?? []).map(tr => ({
      tool: tr.toolName,
      result: tr.output,
    })),
  };
}

