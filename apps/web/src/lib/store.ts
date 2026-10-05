import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppMode } from './modes'
import { MODE_CONFIGS } from './modes'

interface User {
  id: string
  name: string
  email: string
  emoji: string
}

interface FamilyMember {
  id: string
  name: string
  email: string
  emoji: string
  role: string
  status: 'active' | 'pending'
  completion: number
}

interface Family {
  id: string
  name: string
  inviteCode: string
  members: FamilyMember[]
}

interface AIContext {
  lastQuery: string | null
  lastResponse: string | null
  sources: { label: string; type: string }[]
}

interface AppState {
  // Auth
  user: User | null
  isAuthenticated: boolean
  signIn: (email: string, name?: string) => void
  signUp: (name: string, email: string) => void
  signOut: () => void

  // Family
  family: Family | null
  createFamily: (name: string) => void
  inviteMember: (name: string, email: string, role: string) => void
  removeMember: (id: string) => void

  // Mode
  mode: AppMode
  setMode: (mode: AppMode) => void
  modeConfig: () => typeof MODE_CONFIGS[AppMode]

  // AI Context (for Perplexity-style citations)
  aiContext: AIContext
  setAIContext: (query: string, response: string, sources: { label: string; type: string }[]) => void

  // UI State
  cmdkOpen: boolean
  setCmdkOpen: (open: boolean) => void
  emergencyOpen: boolean
  setEmergencyOpen: (open: boolean) => void

  // Connectors
  connectedConnectors: string[]
  setConnectorConnected: (id: string, connected: boolean) => void

  // Documents
  uploadedDocumentCount: number
  incrementDocumentCount: () => void

  // Financial profile (manual entry — no live investment connector for family app)
  financialProfileSubmitted: boolean
  setFinancialProfileSubmitted: () => void
  profileCompleteness: number
  setProfileCompleteness: (pct: number) => void

  // Inbox (demo item dismissal persistence)
  dismissedInboxIds: string[]
  dismissInboxItemLocal: (id: string) => void

  // Inbox badge — set by the inbox page on load/dismiss so the tab bar
  // can show a badge without fetching inbox items on every page.
  inboxUnreadCount: number
  setInboxUnreadCount: (count: number) => void

  // Insight dismissal learning — per-detector count of explicit dismisses.
  // A family that dismisses the same kind of insight twice is telling Keel
  // it's noise; surfaces that *feature* an insight (the Home hero card)
  // should stop picking that detector, while the insight itself still
  // exists and still counts as open elsewhere.
  detectorDismissals: Record<string, number>
  noteDetectorDismissal: (detectorId: string) => void
}

const generateId = () => Math.random().toString(36).substring(2, 11)
const generateInviteCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase()

const DEFAULT_FAMILY: Family = {
  id: 'fam-1',
  name: 'The Reddy Family',
  inviteCode: 'RDY422',
  members: [
    { id: '1', name: 'Balu', email: 'balu@family.ai', emoji: '', role: 'Organizer', status: 'active', completion: 92 },
    { id: '2', name: 'Priya', email: 'priya@family.ai', emoji: '', role: 'Parent', status: 'active', completion: 74 },
    { id: '3', name: 'Emma', email: 'emma@family.ai', emoji: '', role: 'Child', status: 'active', completion: 100 },
    { id: '4', name: 'Lucas', email: 'lucas@family.ai', emoji: '', role: 'Child', status: 'active', completion: 100 },
  ],
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      user: null,
      isAuthenticated: false,
      signIn: (email, name) =>
        set({
          user: { id: generateId(), email, name: name ?? email.split('@')[0] ?? 'User', emoji: '' },
          isAuthenticated: true,
          family: DEFAULT_FAMILY,
        }),
      signUp: (name, email) =>
        set({
          user: { id: generateId(), name, email, emoji: '' },
          isAuthenticated: true,
          family: DEFAULT_FAMILY,
        }),
      signOut: () =>
        set({ user: null, isAuthenticated: false, family: null }),

      // Family
      family: null,
      createFamily: (name) =>
        set({
          family: {
            id: generateId(),
            name,
            inviteCode: generateInviteCode(),
            members: [
              { id: generateId(), name: get().user?.name ?? 'You', email: get().user?.email ?? '', emoji: get().user?.emoji ?? '', role: 'Organizer', status: 'active' as const, completion: 0 },
            ],
          },
        }),
      inviteMember: (name, email, role) =>
        set((state) => ({
          family: state.family
            ? {
                ...state.family,
                members: [
                  ...state.family.members,
                  { id: generateId(), name, email, emoji: '', role, status: 'pending' as const, completion: 0 },
                ],
              }
            : state.family,
        })),
      removeMember: (id) =>
        set((state) => ({
          family: state.family
            ? { ...state.family, members: state.family.members.filter((m) => m.id !== id) }
            : state.family,
        })),

      // Mode
      mode: 'organizer',
      setMode: (mode) => set({ mode }),
      modeConfig: () => MODE_CONFIGS[get().mode],

      // AI Context
      aiContext: { lastQuery: null, lastResponse: null, sources: [] },
      setAIContext: (query, response, sources) =>
        set({ aiContext: { lastQuery: query, lastResponse: response, sources } }),

      // UI State
      cmdkOpen: false,
      setCmdkOpen: (open) => set({ cmdkOpen: open }),
      emergencyOpen: false,
      setEmergencyOpen: (open) => set({ emergencyOpen: open }),

      // Connectors
      connectedConnectors: [],
      setConnectorConnected: (id, connected) =>
        set((state) => ({
          connectedConnectors: connected
            ? [...state.connectedConnectors, id]
            : state.connectedConnectors.filter((c) => c !== id),
        })),

      // Documents
      uploadedDocumentCount: 0,
      incrementDocumentCount: () =>
        set((state) => ({ uploadedDocumentCount: state.uploadedDocumentCount + 1 })),

      // Financial profile
      financialProfileSubmitted: false,
      setFinancialProfileSubmitted: () => set({ financialProfileSubmitted: true }),
      profileCompleteness: 0,
      setProfileCompleteness: (pct: number) => set({ profileCompleteness: pct }),

      // Inbox (demo item dismissal persistence)
      dismissedInboxIds: [],
      dismissInboxItemLocal: (id) =>
        set((state) => ({ dismissedInboxIds: [...state.dismissedInboxIds, id] })),

      // Inbox badge
      inboxUnreadCount: 0,
      setInboxUnreadCount: (count) => set({ inboxUnreadCount: count }),

      // Insight dismissal learning
      detectorDismissals: {},
      noteDetectorDismissal: (detectorId) =>
        set((state) => ({
          detectorDismissals: {
            ...state.detectorDismissals,
            [detectorId]: (state.detectorDismissals[detectorId] ?? 0) + 1,
          },
        })),
    }),
    {
      name: 'family-ai-store',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        family: state.family,
        mode: state.mode,
        dismissedInboxIds: state.dismissedInboxIds,
        detectorDismissals: state.detectorDismissals,
        profileCompleteness: state.profileCompleteness,
        financialProfileSubmitted: state.financialProfileSubmitted,
      }),
    }
  )
)
