import axios from 'axios'

export type GoogleTokenResponse = {
  id_token?: string
  [key: string]: unknown
}

export type GoogleCertKey = {
  kid: string
  n: string
  e: string
  [key: string]: unknown
}

export class GoogleApi {
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectURL: string

  constructor(clientId: string, clientSecret: string, redirectURL: string) {
    /**
     * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI
     * from the client_secret.json file. To get these credentials for your application, visit
     * https://console.cloud.google.com/apis/credentials.
     */
    this.clientId = clientId
    this.clientSecret = clientSecret
    this.redirectURL = redirectURL
  }

  public getAuthUrl(state: string): string {
    // Example access scopes for Web2 login: user email is used.
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ]

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectURL,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      state: state
    })

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  public async getJWTFromCode(code: string): Promise<string | null> {
    const tokenEndpoint = 'https://oauth2.googleapis.com/token'

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectURL
    })

    const { data } = await axios.post<GoogleTokenResponse>(
      tokenEndpoint,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    return data.id_token || null
  }

  public getUserId(jwt: string): string {
    const parts = jwt.split(".")
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.email
  }


}

export function getKeyId(jwt: string): string {
  const parts = jwt.split(".")
  const header = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(header).kid
}

export async function getMatchingKey(keyId: string): Promise<GoogleCertKey | null> {
  const { data } = await axios.get<{ keys: GoogleCertKey[] }>('https://www.googleapis.com/oauth2/v3/certs')

  for (const k of data.keys) {
    if (k.kid === keyId) {
      k.e = k.e.replace(/-/g, '+').replace(/_/g, '/')
      k.n = k.n.replace(/-/g, '+').replace(/_/g, '/')
      return k
    }
  }
  return null
}

export function getSignature(jwt: string): string {
  const parts = jwt.split(".")
  return parts[2].replace(/-/g, '+').replace(/_/g, '/')
}

export function stripSignature(jwt: string): string {
  const parts = jwt.split(".")
  return `${parts[0]}.${parts[1]}`
}
