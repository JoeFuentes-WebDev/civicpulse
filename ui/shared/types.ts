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

export type AgentRun = {
  id: string
  input: CivicReport
  steps: AgentStep[]
  status: 'running' | 'complete' | 'error'
  draft?: string
  serviceRequestId?: string
}