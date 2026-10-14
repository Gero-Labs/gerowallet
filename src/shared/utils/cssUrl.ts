/** Quote asset URLs: Vite's inline SVG data URLs contain literal quotes which
 * are invalid in an unquoted CSS url(), leaving a mask's solid fill visible. */
export function cssUrl(source: string | undefined): string {
  return source ? `url(${JSON.stringify(source)})` : 'none';
}
