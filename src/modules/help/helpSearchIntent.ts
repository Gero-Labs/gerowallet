import { reactive } from 'vue';

/**
 * The search a person just submitted, held in memory until its outcome is known and counted. The text is
 * only compared with the route's own query to tie the outcome to this submission; it is never sent anywhere.
 */
export const helpSearchIntent = reactive({ pending: null as string | null });
