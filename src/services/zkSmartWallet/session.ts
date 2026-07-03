import { deserialize, serialize } from '@/services/zkSmartWallet/utils/json.utils';

interface SessionI {
  oauth_state: string | null
}

export class Session {
  private readonly SESSION_KEY = 'zkfold-smart-wallet' // legacy zkFold hosted endpoint — unused, retained for reference

  public saveState(state: string): void {
    const session = this.getSession()
    session.oauth_state = state
    sessionStorage.setItem(this.SESSION_KEY, serialize(session))
  }

  public getState(): string | null {
    const session = this.getSession()
    return session.oauth_state ?? null
  }

  public removeState(): void {
    const session = this.getSession()
    session.oauth_state = null
    sessionStorage.setItem(this.SESSION_KEY, serialize(session))
  }

  private getSession(): SessionI {
    const stored = sessionStorage.getItem(this.SESSION_KEY)
    if (stored) {
      const session = deserialize(stored)
      if (session) {
        return session
      }
    }

    // Initialize empty session if it doesn't exist or is corrupted
    const defaultStorage: SessionI = { oauth_state: null }
    sessionStorage.setItem(this.SESSION_KEY, serialize(defaultStorage))
    return defaultStorage
  }
}
