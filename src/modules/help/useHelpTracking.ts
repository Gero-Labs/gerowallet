import { trackHelp, type HelpEventInput, type HomeClickSubject } from './helpAnalytics';
import { useHelpChain } from './helpNavigation';
import { updateOpenSource } from './helpUpdates';

/**
 * Anonymous usage counting for Help Center components: events are tagged with the Help surface and the
 * chain filter on screen when they happen. Safe to call from any handler; it never throws or waits.
 */
export function useHelpTracking() {
  const chain = useHelpChain();
  const track = (event: HelpEventInput): void => {
    try { trackHelp({ ...event, surface: 'help', chain: chain.value }); } catch { /* counting must never get in the way */ }
  };
  /** A link inside a Help home widget was followed. */
  const home = (subject: HomeClickSubject): void => track({ type: 'home_click', subject });
  /** An update item (a Blog post, an X post, a news headline) was opened; sources the Updates page does not list are ignored. */
  const updateOpened = (source: string): void => {
    const subject = updateOpenSource(source);
    if (subject) track({ type: 'update_open', subject });
  };
  return { track, home, updateOpened };
}
