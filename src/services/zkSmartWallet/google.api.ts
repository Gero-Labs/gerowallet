import axios from 'axios'

export type GoogleCertKey = {
  kid: string
  n: string
  e: string
  [key: string]: unknown
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
