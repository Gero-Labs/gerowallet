const adjectives = [
  'Cosmic', 'Neon', 'Stellar', 'Lunar', 'Solar', 'Atomic', 'Crystal', 'Shadow',
  'Ember', 'Frost', 'Iron', 'Golden', 'Silver', 'Crimson', 'Azure', 'Violet',
  'Thunder', 'Storm', 'Blazing', 'Silent', 'Swift', 'Noble', 'Brave', 'Bold',
  'Phantom', 'Mystic', 'Primal', 'Savage', 'Epic', 'Hyper', 'Turbo', 'Ultra',
  'Dark', 'Bright', 'Wild', 'Rapid', 'Lucky', 'Rogue', 'Alpha', 'Omega',
  'Vivid', 'Cyber', 'Radiant', 'Titan', 'Apex', 'Nova', 'Zen', 'Pixel',
];

const nouns = [
  'Phoenix', 'Dragon', 'Wolf', 'Falcon', 'Panther', 'Tiger', 'Hawk', 'Viper',
  'Raven', 'Eagle', 'Cobra', 'Jaguar', 'Lynx', 'Orca', 'Fox', 'Bear',
  'Spark', 'Pulse', 'Flare', 'Bolt', 'Surge', 'Wave', 'Blaze', 'Comet',
  'Vault', 'Forge', 'Shield', 'Blade', 'Crown', 'Tower', 'Nexus', 'Core',
  'Orbit', 'Prism', 'Shard', 'Cipher', 'Node', 'Atlas', 'Titan', 'Zenith',
  'Phantom', 'Ghost', 'Spectre', 'Wraith', 'Knight', 'Ranger', 'Nomad', 'Rebel',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateWalletName(): string {
  return `${pick(adjectives)} ${pick(nouns)}`;
}