'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { AppMode, ModeConfig } from './modes'
import { MODE_CONFIGS } from './modes'

interface ModeContextValue {
  mode: AppMode
  config: ModeConfig
  setMode: (mode: AppMode) => void
  emergencyActive: boolean
  activateEmergency: () => void
  deactivateEmergency: () => void
}

const ModeContext = createContext<ModeContextValue | null>(null)

const STORAGE_KEY = 'family-mode'

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('organizer')
  const [emergencyActive, setEmergencyActive] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as AppMode | null
      if (stored && MODE_CONFIGS[stored]) setModeState(stored)
    } catch {
      // ignore
    }
  }, [])

  const setMode = (m: AppMode) => {
    setModeState(m)
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {
      // ignore
    }
  }

  return (
    <ModeContext.Provider
      value={{
        mode,
        config: MODE_CONFIGS[mode],
        setMode,
        emergencyActive,
        activateEmergency: () => setEmergencyActive(true),
        deactivateEmergency: () => setEmergencyActive(false),
      }}
    >
      {children}
    </ModeContext.Provider>
  )
}

export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used within ModeProvider')
  return ctx
}
