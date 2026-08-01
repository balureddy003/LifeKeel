'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { User, FamilyGroup, FamilyMemberUser, FamilyRole } from './auth-types'

interface AuthContextValue {
  user: User | null
  family: FamilyGroup | null
  isAuthenticated: boolean
  isLoading: boolean
  signUp: (name: string, email: string) => Promise<User>
  signIn: (email: string) => Promise<void>
  signInWithProvider: (provider: 'google') => Promise<void>
  signOut: () => void
  createFamily: (name: string, forUser?: User) => void
  inviteMember: (name: string, email: string, role: FamilyRole) => void
  removeMember: (id: string) => void
  updateMemberRole: (id: string, role: FamilyRole) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'family-auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [family, setFamily] = useState<FamilyGroup | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        setUser(data.user)
        setFamily(data.family)
      }
    } catch {
      // ignore
    }
    setIsLoading(false)
  }, [])

  const persist = (u: User | null, f: FamilyGroup | null) => {
    setUser(u)
    setFamily(f)
    try {
      if (u) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: u, family: f }))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // ignore
    }
  }

  const signUp = async (name: string, email: string) => {
    const u: User = {
      id: `user-${Date.now()}`,
      name,
      email,
      avatar: '',
    }
    persist(u, null)
    return u
  }

  const signIn = async (email: string) => {
    const u: User = {
      id: `user-${Date.now()}`,
      name: (email.split('@')[0] ?? email).replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      email,
      avatar: '',
    }
    persist(u, null)
  }

  const signInWithProvider = async (provider: 'google') => {
    const u: User = {
      id: `user-${Date.now()}`,
      name: 'Google User',
      email: `user@${provider}.com`,
      avatar: '',
    }
    persist(u, null)
  }

  const signOut = () => {
    persist(null, null)
  }

  const createFamily = (name: string, forUser?: User) => {
    const owner = forUser ?? user
    if (!owner) return
    const f: FamilyGroup = {
      id: `family-${Date.now()}`,
      name,
      inviteCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      members: [
        {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          role: 'organizer',
          emoji: '',
          status: 'active',
          joinedAt: new Date().toISOString(),
        },
      ],
    }
    persist(owner, f)
  }

  const inviteMember = (name: string, email: string, role: FamilyRole) => {
    if (!family) return
    const member: FamilyMemberUser = {
      id: `member-${Date.now()}`,
      name,
      email,
      role,
      emoji: '',
      status: 'pending',
      joinedAt: new Date().toISOString(),
    }
    const updated = { ...family, members: [...family.members, member] }
    persist(user, updated)
  }

  const removeMember = (id: string) => {
    if (!family) return
    const updated = { ...family, members: family.members.filter((m) => m.id !== id) }
    persist(user, updated)
  }

  const updateMemberRole = (id: string, role: FamilyRole) => {
    if (!family) return
    const updated = {
      ...family,
      members: family.members.map((m) => (m.id === id ? { ...m, role } : m)),
    }
    persist(user, updated)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        family,
        isAuthenticated: !!user,
        isLoading,
        signUp,
        signIn,
        signInWithProvider,
        signOut,
        createFamily,
        inviteMember,
        removeMember,
        updateMemberRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
