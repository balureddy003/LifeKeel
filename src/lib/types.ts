export interface FamilyMember {
  id: string
  name: string
  role: string
  emoji: string
  relation: 'owner' | 'spouse' | 'child'
  financialRole?: string
  netWorth?: string
  income?: string[]
  assets?: string[]
  protection?: string[]
  responsibilities?: string[]
  branches?: FamilyBranch[]
}

export interface FamilyBranch {
  label: string
  icon: string
  items: string[]
}

export interface HealthCategory {
  label: string
  status: 'green' | 'yellow' | 'red'
}

export interface LifeEvent {
  id: string
  emoji: string
  label: string
}

export interface ResponseAction {
  id: string
  label: string
  done: boolean
}

export interface MoneySource {
  label: string
  emoji: string
  amount: string
}

export interface ChatSuggestion {
  id: string
  label: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}
