import { writable, derived } from 'svelte/store'

const AUTH_TOKEN_KEY = 'desmonitor_auth_token'

interface User {
  id: string
  email: string
  name?: string
  settings?: Record<string, any>
}

interface AuthState {
  token: string | null
  user: User | null
}

function loadToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) } catch { return null }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {}
}

const initialState: AuthState = {
  token: loadToken(),
  user: null,
}

export const authState = writable<AuthState>(initialState)
export const isAuthenticated = derived(authState, ($s) => !!$s.token && !!$s.user)
export const currentUser = derived(authState, ($s) => $s.user)

export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await r.json()
    if (!r.ok) return { ok: false, error: data.error || 'Login failed' }
    saveToken(data.token)
    authState.set({ token: data.token, user: data.user })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Network error' }
  }
}

export async function register(email: string, password: string, name?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })
    const data = await r.json()
    if (!r.ok) return { ok: false, error: data.error || 'Registration failed' }
    saveToken(data.token)
    authState.set({ token: data.token, user: data.user })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Network error' }
  }
}

export async function fetchProfile(): Promise<void> {
  const state: AuthState = { token: null, user: null }
  let token: string | null = null
  authState.subscribe(s => { token = s.token })()
  if (!token) return
  try {
    const r = await fetch('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) { logout(); return }
    const user = await r.json()
    state.token = token
    state.user = user
    authState.set(state)
  } catch {
    logout()
  }
}

export async function updateProfile(updates: { name?: string; settings?: Record<string, any> }): Promise<{ ok: boolean; error?: string }> {
  let token: string | null = null
  authState.subscribe(s => { token = s.token })()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const r = await fetch('/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    })
    if (!r.ok) return { ok: false, error: 'Update failed' }
    const user = await r.json()
    authState.update(s => ({ ...s, user }))
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

export function logout() {
  saveToken(null)
  authState.set({ token: null, user: null })
}

export function getToken(): string | null {
  let token: string | null = null
  authState.subscribe(s => { token = s.token })()
  return token
}
