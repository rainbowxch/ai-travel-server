export interface TimeBlock {
  start: string
  end: string
  title: string
  type: 'sight' | 'food' | 'transport' | 'rest' | 'shopping'
  why: string
  pics?: string[]
  costEstimate?: number
  tips?: string[]
  openingHours?: string
  activities?: string[]
}

export interface DayPlan {
  dayIndex: number
  theme: string
  blocks: TimeBlock[]
  notes?: string[]
}

export interface Itinerary {
  meta: {
    city: string
    days: number
    summary: string
    budgetTotal: number
    constraints: string[]
    dates?: string
    peopleCount?: string
  }
  days: DayPlan[]
}

export interface AgentStep {
  tool: string
  status: 'running' | 'done' | 'error'
  args?: string
  result?: string
  error?: string
}

export interface ChatResponse {
  type: 'itinerary' | 'text'
  content: string | null
  itinerary: Itinerary | null
  steps: AgentStep[]
}
