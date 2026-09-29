import { describe, expect, it } from 'vitest';
import { foldForSearch, scoreMatch } from './searchScore';

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
