interface CardHttp {
  get(url: string): Promise<unknown>;
  post(url: string): Promise<unknown>;
}

/**
 * Ends the provider-side session on sign-out: first the user session (it needs
 * the still-valid token), then the access token itself. Both are best-effort;
 * local sign-out must never wait on, or fail because of, the provider.
 */
export async function endProviderSession(http: CardHttp): Promise<void> {
  try {
    await http.get('/api/kaiserex/logout');
  } catch {
    // best-effort
  }
  try {
    await http.post('/api/kaiserex/revoke-token');
  } catch {
    // best-effort; older gero-backend builds answer 404
  }
}
