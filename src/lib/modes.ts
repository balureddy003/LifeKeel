export type AppMode = 'organizer' | 'parent' | 'adult' | 'child' | 'elderly'

export interface ModeConfig {
  mode: AppMode
  fontSize: number
  showMoney: boolean
  showAdvanced: boolean
  showEmergencyButton: boolean
  voiceNavigation: boolean
  simpleLanguage: boolean
  label: string
  emoji: string
}

export const MODE_CONFIGS: Record<AppMode, ModeConfig> = {
  organizer: {
    mode: 'organizer',
    fontSize: 17,
    showMoney: true,
    showAdvanced: true,
    showEmergencyButton: true,
    voiceNavigation: false,
    simpleLanguage: false,
    label: 'Organizer',
    emoji: '',
  },
  parent: {
    mode: 'parent',
    fontSize: 17,
    showMoney: true,
    showAdvanced: true,
    showEmergencyButton: true,
    voiceNavigation: false,
    simpleLanguage: false,
    label: 'Parent',
    emoji: '',
  },
  adult: {
    mode: 'adult',
    fontSize: 17,
    showMoney: true,
    showAdvanced: false,
    showEmergencyButton: true,
    voiceNavigation: false,
    simpleLanguage: true,
    label: 'Adult',
    emoji: '',
  },
  child: {
    mode: 'child',
    fontSize: 18,
    showMoney: false,
    showAdvanced: false,
    showEmergencyButton: false,
    voiceNavigation: false,
    simpleLanguage: true,
    label: 'Child',
    emoji: '',
  },
  elderly: {
    mode: 'elderly',
    fontSize: 22,
    showMoney: true,
    showAdvanced: false,
    showEmergencyButton: true,
    voiceNavigation: true,
    simpleLanguage: true,
    label: 'Elderly',
    emoji: '',
  },
}

export interface LifeNode {
  id: string
  label: string
  emoji: string
  type: 'family' | 'person' | 'category' | 'detail'
  status: 'green' | 'yellow' | 'red'
  children?: LifeNode[]
  story?: string
  explanation?: string
  progress?: number
}

export interface LifeEvent {
  id: string
  emoji: string
  label: string
  category: 'protection' | 'wealth' | 'goals' | 'life'
  description: string
}

export interface TimelineEvent {
  id: string
  emoji: string
  label: string
  year: number
  status: 'done' | 'current' | 'future'
}

export interface RiskArea {
  id: string
  label: string
  emoji: string
  progress: number
  status: 'green' | 'yellow' | 'red'
  story: string
  detail: string
}
