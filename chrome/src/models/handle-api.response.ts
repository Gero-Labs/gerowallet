export type HandleApiResponse = {
  hex: string;
  name: string;
  image: string;
  standard_image: string;
  holder: string;
  length: number;
  og_number: number;
  rarity: string;
  utxo: string;
  characters: string;
  numeric_modifiers: string;
  default_in_wallet: string;
  resolved_addresses: {
    ada: string;
  };
  created_slot_number: number;
  updated_slot_number: number;
  has_datum: boolean;
  svg_version: string;
  image_hash: string;
  standard_image_hash: string;
};
