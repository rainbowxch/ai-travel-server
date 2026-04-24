export interface TimeBlock {
  start: string
  end: string
  title: string
  type: 'sight' | 'food' | 'transport' | 'rest' | 'shopping'
  why: string
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
