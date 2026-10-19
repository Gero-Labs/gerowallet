import type { ShippingAddress } from './cardOrder';

/**
 * The cardholder details Zione needs before it issues a card, in the order the form shows
 * them. `GET /api/cards/cardholder-details/missing` names the ones that are still empty.
 */
export const CARDHOLDER_FIELDS = [
  'firstName', 'lastName', 'birthDate', 'nationality', 'phone',
  'address', 'city', 'region', 'zipCode', 'country',
] as const;

export type CardholderField = typeof CARDHOLDER_FIELDS[number];
export type CardholderDetails = Record<CardholderField, string>;

export interface DetailsSaveResult {
  /** Fields Zione still lists as missing after a save. */
  remaining: CardholderField[];
  /** The home address just saved, when the whole address was part of the form. */
  residential: ShippingAddress | null;
}

export const PERSONAL_FIELDS: readonly CardholderField[] = ['firstName', 'lastName', 'birthDate', 'nationality', 'phone'];
export const RESIDENCE_FIELDS: readonly CardholderField[] = ['address', 'city', 'region', 'zipCode', 'country'];

/** Field limits of `POST /api/cards/cardholder-details`. */
export const CARDHOLDER_LIMITS = {
  firstName: 30,
  lastName: 30,
  address: 30,
  city: 100,
  region: 100,
  zipCode: 10,
} as const;

/**
 * Zione's character rules. Names take Latin letters, spaces and hyphens; address fields also
 * take digits. Accents, commas and full stops are refused ("contains forbidden symbols!"),
 * and the same rule applies to the delivery address of a physical card.
 */
const NAME_PATTERN = /^[a-zA-Z -]*$/;
const TEXT_PATTERN = /^[a-zA-Z0-9 -]*$/;

export type TextKind = 'name' | 'text';

/** Letters that Unicode decomposition does not reduce to a base letter plus an accent. */
const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L',
  đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'Th', ı: 'i', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T',
};

/**
 * Rewrites text into the characters Zione accepts where that needs no guessing:
 * accents are dropped (Vnoučkova → Vnouckova), commas and full stops become spaces, slashes
 * become hyphens and apostrophes go. Anything else (another script, `#`, `&`) is left for
 * {@link invalidCharacters} to report.
 */
export function toProviderText(value: string): string {
  return value
    .replace(/[\u0080-￿]/g, char => SPECIAL_LETTERS[char] ?? char)
    // NFKD also folds compatibility forms: º → o, ² → 2, full-width letters → ASCII.
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’‘`´"“”]/g, '')
    .replace(/[,.;:]/g, ' ')
    .replace(/[/\\_–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The distinct characters Zione would refuse in `value`, in the order they first appear. */
export function invalidCharacters(value: string, kind: TextKind): string[] {
  const pattern = kind === 'name' ? NAME_PATTERN : TEXT_PATTERN;
  return [...new Set([...value].filter(char => !pattern.test(char)))];
}

/** Picks the known fields out of a `missing_fields` response, in form order. */
export function parseMissingFields(data: unknown): CardholderField[] {
  const listed = (data as { missing_fields?: unknown } | null)?.missing_fields;
  if (!Array.isArray(listed)) return [];
  return CARDHOLDER_FIELDS.filter(field => listed.includes(field));
}

/** `yyyy-mm-dd` (a date input's value) as Zione's `dd.MM.yyyy`, or '' when malformed. */
export function toProviderBirthDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/** The latest birth date of someone who is 18 on `today`, as `yyyy-mm-dd`. */
export function latestAdultBirthDate(today: Date): string {
  const year = today.getFullYear() - 18;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** True when `isoDate` is a real date on which the person was born at least 18 years before `today`. */
export function isAdultBirthDate(isoDate: string, today: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
  return isoDate <= latestAdultBirthDate(today) && year >= 1900;
}

/** The request body for the listed fields only: Zione validates every field it receives. */
export function toCardholderPayload(values: CardholderDetails, fields: readonly CardholderField[]): Partial<CardholderDetails> {
  const payload: Partial<CardholderDetails> = {};
  for (const field of fields) {
    payload[field] = field === 'birthDate' ? toProviderBirthDate(values.birthDate) : values[field].trim();
  }
  return payload;
}

/** Zione's per-field messages from a 422 response (`errors: { zipCode: ['…'] }`). */
export function cardholderFieldErrors(error: unknown): Partial<Record<CardholderField, string>> {
  const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  const errors = (response?.data as { errors?: unknown } | null)?.errors;
  if (response?.status !== 422 || !errors || typeof errors !== 'object') return {};
  const result: Partial<Record<CardholderField, string>> = {};
  for (const field of CARDHOLDER_FIELDS) {
    const messages = (errors as Record<string, unknown>)[field];
    const first = Array.isArray(messages) ? messages.find(message => typeof message === 'string') : messages;
    if (typeof first === 'string' && first.trim()) result[field] = first.trim();
  }
  return result;
}

/**
 * The residential address the user just gave Zione, as a delivery address. Null unless the
 * whole address was part of this form: a partial one would mix typed and unknown values.
 */
export function residentialAddress(values: CardholderDetails, fields: readonly CardholderField[]): ShippingAddress | null {
  if (!RESIDENCE_FIELDS.every(field => fields.includes(field) && values[field].trim())) return null;
  return {
    streetAddress: values.address.trim(),
    city: values.city.trim(),
    stateProvince: values.region.trim(),
    zipCode: values.zipCode.trim(),
    countryCode: values.country,
    phone: fields.includes('phone') ? values.phone : '',
  };
}

export function emptyCardholderDetails(): CardholderDetails {
  return {
    firstName: '', lastName: '', birthDate: '', nationality: '', phone: '',
    address: '', city: '', region: '', zipCode: '', country: '',
  };
}
