/**
 * Wraps this context's `fetch` with the response-signature check (`installSignedFetch`).
 * Import it first in every extension entry (options, side panel, background), so the
 * wrapper is in place before any code, the swap widget included, calls `fetch`.
 * In the default `off` mode it installs nothing.
 */
import { installSignedFetch } from './signedResponses';

installSignedFetch(globalThis);
