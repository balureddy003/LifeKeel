'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { User, FamilyGroup, FamilyRole } from './auth-types'
import {
  fetchFamilyGroup,
  createFamilyGroup,
  addFamilyGroupMember,
  removeFamilyGroupMember,
  updateFamilyGroupMemberRole,
  type ApiFamilyGroup,
} from './api'
import { getApiBase } from './env'

interface AuthContextValue {
  user: User | null
  family: FamilyGroup | null
  isAuthenticated: boolean
  isLoading: boolean
  signUp: (name: string, email: string, password: string) => Promise<User>
  signIn: (email: string, password: string) => Promise<void>
  updateEmail: (email: string) => Promise<User>
  signInWithProvider: (provider: 'google') => Promise<void>
  signOut: () => void
  createFamily: (name: string, forUser?: User) => Promise<void>
  inviteMember: (name: string, email: string, role: FamilyRole) => Promise<void>
  removeMember: (id: string) => Promise<void>
  updateMemberRole: (id: string, role: FamilyRole) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'family-auth'
const TOKEN_KEY = 'agentoak_token'

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'family'
}

// Every signup needs a unique workspace slug — the backend rejects a
// collision outright (see apps/api routes/auth-users.ts) rather than
// silently joining an existing tenant, so a random suffix is required,
// not just cosmetic.
function uniqueWorkspaceSlug(seed: string): string {
  return `${slugify(seed)}-${Math.random().toString(36).slice(2, 8)}`
}

// The API's FamilyMember doesn't carry the client-only `emoji` field — the
// client type keeps it (always '' today) for the UI components that expect it.
function toFamilyGroup(api: ApiFamilyGroup): FamilyGroup {
  return {
    id: api.id,
    name: api.name,
    inviteCode: api.inviteCode,
    members: api.members.map((m) => ({ ...m, emoji: '' })),
  }
}

interface ApiUser {
  id: string
  email: string
  name: string
  tenant_id: string
}

async function apiAuthRequest(path: string, body: Record<string, unknown>): Promise<{ token: string; user: ApiUser }> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.')
  }
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [family, setFamily] = useState<FamilyGroup | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const restore = async () => {
      try {
        const token = localStorage.getItem(TOKEN_KEY)
        if (!token) {
          setIsLoading(false)
          return
        }
        // Verify the stored token against the real API rather than trusting
        // stale localStorage — an expired/revoked token should sign the
        // user out instead of leaving the app in a half-authenticated state.
        const res = await fetch(`${getApiBase()}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(STORAGE_KEY)
          setIsLoading(false)
          return
        }
        const me = await res.json()
        const raw = localStorage.getItem(STORAGE_KEY)
        const cached = raw ? JSON.parse(raw) : null
        setUser({ id: me.user_id, name: me.name ?? cached?.user?.name ?? '', email: me.email ?? cached?.user?.email ?? '', avatar: '' })

        // The family roster is persisted server-side now — fetch the real
        // one instead of only trusting the local cache, so a login on a
        // fresh session restores the household instead of re-onboarding.
        const apiFamily = await fetchFamilyGroup()
        setFamily(apiFamily ? toFamilyGroup(apiFamily) : cached?.family ?? null)
      } catch {
        // Network failure on rehydrate — fall back to cached local state
        // rather than force a logout, since the app is offline-first.
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
      }
      setIsLoading(false)
    }
    restore()
  }, [])

  const persist = (u: User | null, f: FamilyGroup | null) => {
    setUser(u)
    setFamily(f)
    try {
      if (u) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: u, family: f }))
      } else {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch {
      // ignore
    }
  }

  const signUp = async (name: string, email: string, password: string) => {
    const { token, user: apiUser } = await apiAuthRequest('/auth/signup', {
      name,
      email,
      password,
      workspace: uniqueWorkspaceSlug(name || email),
    })
    localStorage.setItem(TOKEN_KEY, token)
    const u: User = { id: apiUser.id, name: apiUser.name, email: apiUser.email, avatar: '' }
    persist(u, null)
    return u
  }

  // OAK-017 follow-up: links a real email to an already-authenticated
  // account (PUT /auth/profile) — used when onboarding's recovery-email
  // question is answered by someone who signed up first, whose account
  // therefore already exists and isn't touched by signUp() above.
  const updateEmail = async (email: string): Promise<User> => {
    const token = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`${getApiBase()}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || 'Could not update email.')
    }
    const u: User = { id: data.user.id, name: data.user.name, email: data.user.email, avatar: '' }
    persist(u, family)
    return u
  }

  const signIn = async (email: string, password: string) => {
    const { token, user: apiUser } = await apiAuthRequest('/auth/login', { email, password })
    localStorage.setItem(TOKEN_KEY, token)
    const u: User = { id: apiUser.id, name: apiUser.name, email: apiUser.email, avatar: '' }
    // Restore the real family roster on login, same as the mount rehydration
    // path — a returning user who already built a household shouldn't be
    // routed back through family-setup.
    let f: FamilyGroup | null = null
    try {
      const apiFamily = await fetchFamilyGroup()
      f = apiFamily ? toFamilyGroup(apiFamily) : null
    } catch {
      // ignore — falls through to family-setup, same as any first-time user
    }
    persist(u, f)
  }

  // Google sign-in: redirect to the API's OAuth flow with app=family so the
  // callback redirects back to the Agent Oak app after authentication.
  const signInWithProvider = async (provider: 'google') => {
    window.location.href = `${getApiBase()}/auth/${provider}/login?app=family`
  }

  const signOut = () => {
    persist(null, null)
  }

  const createFamily = async (name: string, forUser?: User) => {
    const owner = forUser ?? user
    if (!owner) return
    const apiFamily = await createFamilyGroup(name)
    persist(owner, toFamilyGroup(apiFamily))
  }

  // No local `!family` guard here — the API enforces that a family must
  // exist (404 otherwise). Guarding on local state is unsafe right after
  // createFamily(): setFamily() hasn't re-rendered yet, so a caller that
  // chains inviteMember() immediately after awaiting createFamily() would
  // see a stale null `family` and bail even though the family now exists.
  const inviteMember = async (name: string, email: string, role: FamilyRole) => {
    const apiFamily = await addFamilyGroupMember(name, email, role)
    persist(user, toFamilyGroup(apiFamily))
  }

  const removeMember = async (id: string) => {
    const apiFamily = await removeFamilyGroupMember(id)
    persist(user, toFamilyGroup(apiFamily))
  }

  const updateMemberRole = async (id: string, role: FamilyRole) => {
    const apiFamily = await updateFamilyGroupMemberRole(id, role)
    persist(user, toFamilyGroup(apiFamily))
  }

  const refresh = async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    try {
      const res = await fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const me = await res.json()
      setUser({ id: me.user_id, name: me.name ?? '', email: me.email ?? '', avatar: '' })
      const apiFamily = await fetchFamilyGroup()
      setFamily(apiFamily ? toFamilyGroup(apiFamily) : null)
    } catch {
      // ignore — keep existing state
    }
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
        updateEmail,
        signInWithProvider,
        signOut,
        createFamily,
        inviteMember,
        removeMember,
        updateMemberRole,
        refresh,
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
