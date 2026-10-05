'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { User, FamilyGroup, FamilyRole } from './auth-types'
import { ROLE_EMOJI } from './auth-types'
import {
  fetchFamilyGroup,
  createFamilyGroup,
  addFamilyGroupMember,
  removeFamilyGroupMember,
  updateFamilyGroupMemberRole,
  updateFamilyGroupMemberDateOfBirth,
  acceptFamilyInvite as apiAcceptFamilyInvite,
  type ApiFamilyGroup,
} from './api'
import { getApiBase } from './env'
import { getAttribution } from './attribution'

interface AuthContextValue {
  user: User | null
  family: FamilyGroup | null
  isAuthenticated: boolean
  isLoading: boolean
  signUp: (name: string, email: string, password: string, ref?: string) => Promise<User>
  signIn: (email: string, password: string) => Promise<void>
  /** PRD-123: accept a per-member invite — verifies the token, lands signed in. */
  acceptFamilyInvite: (token: string, password: string) => Promise<void>
  updateEmail: (email: string) => Promise<User>
  updateProfile: (patch: { name?: string; email?: string }) => Promise<User>
  signInWithProvider: (provider: 'google') => Promise<void>
  signOut: () => void
  createFamily: (name: string, forUser?: User) => Promise<void>
  inviteMember: (name: string, email: string, role: FamilyRole, dateOfBirth?: string) => Promise<void>
  removeMember: (id: string) => Promise<void>
  updateMemberRole: (id: string, role: FamilyRole) => Promise<void>
  updateMemberDateOfBirth: (id: string, dateOfBirth: string) => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'family-auth'
const TOKEN_KEY = 'lifekeel_token'

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
  email_verified?: boolean
}

async function apiAuthRequest(path: string, body: Record<string, unknown>): Promise<{ token: string; user: ApiUser }> {
  let res: Response
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // fetch itself throwing (offline, DNS, CORS) is a browser-level error
    // like "Failed to fetch" — exactly the wrong moment to surface raw
    // technical text to someone trying to get back into the app. Nothing
    // was sent, so there's nothing at risk either way.
    throw new Error("Couldn't reach LifeKeel — check your connection and try again. Nothing was saved.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // A response the server did send but without a specific message is
    // rarer, but still shouldn't read as data loss — distinct wording
    // from the network-failure case above.
    throw new Error(data.error || "That didn't go through — try again in a moment.")
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
        setUser({ id: me.user_id, name: me.name ?? cached?.user?.name ?? '', email: me.email ?? cached?.user?.email ?? '', avatar: '', country: me.country, emailVerified: me.email_verified })

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

  const signUp = async (name: string, email: string, password: string, ref?: string) => {
    const attribution = getAttribution()
    const { token, user: apiUser } = await apiAuthRequest('/auth/signup', {
      name,
      email,
      password,
      workspace: uniqueWorkspaceSlug(name || email),
      ...(ref ? { ref } : {}),
      ...(attribution ? { attribution } : {}),
    })
    localStorage.setItem(TOKEN_KEY, token)
    const u: User = { id: apiUser.id, name: apiUser.name, email: apiUser.email, avatar: '', emailVerified: apiUser.email_verified }
    persist(u, null)
    return u
  }

  // PUT /auth/profile accepts name and/or email — the backend has
  // supported both since this route was built, but until now the only
  // frontend caller (updateEmail below) only ever sent email, and nothing
  // in the app let a user change their own name at all: the Settings
  // profile row rendered as a tappable button (haptic + press animation)
  // whose onClick did literally nothing.
  const updateProfile = async (patch: { name?: string; email?: string }): Promise<User> => {
    const token = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`${getApiBase()}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || 'Could not update profile.')
    }
    const u: User = { id: data.user.id, name: data.user.name, email: data.user.email, avatar: '', emailVerified: data.user.email_verified }
    persist(u, family)
    return u
  }

  // KEEL-017 follow-up: links a real email to an already-authenticated
  // account — used when onboarding's recovery-email question is answered
  // by someone who signed up first, whose account therefore already
  // exists and isn't touched by signUp() above.
  const updateEmail = (email: string): Promise<User> => updateProfile({ email })

  const signIn = async (email: string, password: string) => {
    const { token, user: apiUser } = await apiAuthRequest('/auth/login', { email, password })
    localStorage.setItem(TOKEN_KEY, token)
    const u: User = { id: apiUser.id, name: apiUser.name, email: apiUser.email, avatar: '', emailVerified: apiUser.email_verified }
    // Restore the real family roster on login, same as the mount rehydration
    // path — a returning user who already built a household shouldn't be
    // routed back through family-setup. A failed fetch used to be
    // indistinguishable from "no family yet" (both ended at family=null and
    // AuthGate's "Set up your family" screen, which reads as account loss);
    // now it throws so the login page surfaces a retryable error instead.
    let f: FamilyGroup | null = null
    try {
      const apiFamily = await fetchFamilyGroup()
      f = apiFamily ? toFamilyGroup(apiFamily) : null
    } catch {
      throw new Error("Signed in, but we couldn't load your family. Check your connection and try again.")
    }
    persist(u, f)
  }

  // Accepting a per-member invite is both account creation/linking AND the
  // first sign-in — the accept route returns a session token, so this mirrors
  // signIn's persist path rather than routing the invitee back through login.
  const acceptFamilyInvite = async (token: string, password: string) => {
    const { token: sessionToken, user: apiUser } = await apiAcceptFamilyInvite(token, password)
    if (sessionToken) localStorage.setItem(TOKEN_KEY, sessionToken)
    const u: User = { id: apiUser.id, name: apiUser.name, email: apiUser.email, avatar: '', emailVerified: apiUser.email_verified }
    let f: FamilyGroup | null = null
    try {
      const apiFamily = await fetchFamilyGroup()
      f = apiFamily ? toFamilyGroup(apiFamily) : null
    } catch {
      throw new Error("Invite accepted, but we couldn't load your family. Check your connection and sign in.")
    }
    persist(u, f)
  }

  // Google sign-in: redirect to the API's OAuth flow with app=family so the
  // callback redirects back to the LifeKeel app after authentication.
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
  const inviteMember = async (name: string, email: string, role: FamilyRole, dateOfBirth?: string) => {
    // Optimistic: show the pending member immediately; the roster shouldn't
    // wait on the network for an action the user just confirmed.
    const previous = family
    if (family) {
      const optimistic = {
        ...family,
        members: [
          ...family.members,
          {
            id: `pending-${Date.now()}`,
            name,
            email,
            role,
            emoji: ROLE_EMOJI[role],
            status: 'pending' as const,
            joinedAt: new Date().toISOString(),
            ...(dateOfBirth ? { dateOfBirth } : {}),
          },
        ],
      }
      persist(user, optimistic)
    }
    try {
      const apiFamily = await addFamilyGroupMember(name, email, role, dateOfBirth)
      persist(user, toFamilyGroup(apiFamily))
    } catch (err) {
      persist(user, previous)
      throw err
    }
  }

  const removeMember = async (id: string) => {
    const previous = family
    if (family) {
      persist(user, { ...family, members: family.members.filter((m) => m.id !== id) })
    }
    try {
      const apiFamily = await removeFamilyGroupMember(id)
      persist(user, toFamilyGroup(apiFamily))
    } catch (err) {
      persist(user, previous)
      throw err
    }
  }

  const updateMemberRole = async (id: string, role: FamilyRole) => {
    const previous = family
    if (family) {
      persist(user, {
        ...family,
        members: family.members.map((m) => (m.id === id ? { ...m, role, emoji: ROLE_EMOJI[role] } : m)),
      })
    }
    try {
      const apiFamily = await updateFamilyGroupMemberRole(id, role)
      persist(user, toFamilyGroup(apiFamily))
    } catch (err) {
      persist(user, previous)
      throw err
    }
  }

  const updateMemberDateOfBirth = async (id: string, dateOfBirth: string) => {
    const previous = family
    if (family) {
      persist(user, {
        ...family,
        members: family.members.map((m) => (m.id === id ? { ...m, dateOfBirth } : m)),
      })
    }
    try {
      const apiFamily = await updateFamilyGroupMemberDateOfBirth(id, dateOfBirth)
      persist(user, toFamilyGroup(apiFamily))
    } catch (err) {
      persist(user, previous)
      throw err
    }
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
      setUser({ id: me.user_id, name: me.name ?? '', email: me.email ?? '', avatar: '', country: me.country })
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
        acceptFamilyInvite,
        updateEmail,
        updateProfile,
        signInWithProvider,
        signOut,
        createFamily,
        inviteMember,
        removeMember,
        updateMemberRole,
        updateMemberDateOfBirth,
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
