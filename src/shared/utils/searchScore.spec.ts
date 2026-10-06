import { describe, expect, it } from 'vitest';
import { foldForSearch, scoreIndexEntry, scoreMatch } from './searchScore';

describe('search accent folding', () => {
  it('folds case and diacritics', () => {
    expect(foldForSearch('Contraseña de gasto')).toBe('contrasena de gasto');
    expect(foldForSearch('Configuración')).toBe('configuracion');
  });

  it('matches a query typed without accents, and the other way round', () => {
    expect(scoreMatch('Configuración', 'configuracion')).toBe(100);
    expect(scoreMatch('Frase de recuperación', 'recuperacion')).toBeGreaterThan(0);
    expect(scoreMatch('Configuracion', 'configuración')).toBe(100);
  });

  it('still ranks the same way for plain ASCII', () => {
    expect(scoreMatch('Staking', 'staking')).toBe(100);
    expect(scoreMatch('Staking rewards', 'stak')).toBe(80);
    expect(scoreMatch('Unrelated', 'stake')).toBe(0);
  });
});

describe('scoreIndexEntry', () => {
  const keywords = ['recovery phrase', 'seed phrase', 'frase de recuperación'];

  it('ranks exact keyword over keyword prefix over keyword substring', () => {
    expect(scoreIndexEntry(keywords, 'Recovery Phrase', 'seed phrase')).toBe(100);
    expect(scoreIndexEntry(keywords, 'Recovery Phrase', 'seed')).toBe(90);
    expect(scoreIndexEntry(keywords, 'Unrelated', 'phrase')).toBe(50);
  });

  it('falls back to the resolved title', () => {
    expect(scoreIndexEntry([], 'Wiederherstellungsphrase', 'wiederher')).toBe(80);
  });

  it('folds accents and trims the query', () => {
    expect(scoreIndexEntry(keywords, '', '  frase de recuperacion ')).toBe(100);
  });

  it('scores nothing for an empty or unrelated query', () => {
    expect(scoreIndexEntry(keywords, 'Recovery Phrase', '   ')).toBe(0);
    expect(scoreIndexEntry(keywords, 'Recovery Phrase', 'staking')).toBe(0);
  });
});
