export type CivicReport = {
  text?: string
  photoUrl?: string
  voiceUrl?: string
  lat: number
  lng: number
  timestamp: Date
  userId?: string
}

export type AgentStep = {
  id: string
  name: string
  status: 'pending' | 'running' | 'complete' | 'error'
  output?: Record<string, unknown>
  error?: string
  timestamp: Date
}

/** Structured payload from the agent's draft_submission tool (used for 311 submit). */
export type DraftSubmissionPayload = {
  service_code: string
  description: string
  lat: number
  lng: number
  address_string: string
  severity: number
  category: string
  first_name: string
  last_name: string
  email: string
  is_repeat_location: boolean
  prior_report_count: number
  submitted_at: string
}

export type SubmissionSource = 'auto' | 'user' | 'mock'

export type AgentRun = {
  id: string
  input: CivicReport
  steps: AgentStep[]
  status: 'running' | 'complete' | 'error'
  draft?: string
  /** Set after a successful 311 submit (auto or user-confirmed). */
  serviceRequestId?: string
  /** When true, user must review before submit. Omitted on older runs → treat as true. */
  needsReview?: boolean
  confidence?: number
  severity?: number
  submission?: SubmissionSource
  draftPayload?: DraftSubmissionPayload
  /** How report coordinates were chosen. */
  locationSource?: 'gps' | 'description' | 'description_not_found'
  /** Place phrase from the description when geocoding was attempted. */
  locationMention?: string
  /** Text named a place but forward geocode failed — user must review. */
  locationGeocodeFailed?: boolean
}