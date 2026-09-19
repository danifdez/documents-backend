import {
  bibliographyCitationForms,
  dateSurfaceForms,
  entityTermsOf,
  hasBoundedOccurrence,
  knowledgeTermsOf,
  matchDateInText,
  matchTaggedTermsInText,
  matchTermsInText,
} from '../../../src/search/page-match.util';

describe('page-match.util', () => {
  describe('hasBoundedOccurrence', () => {
    it('matches whole words only', () => {
      expect(hasBoundedOccurrence('el banco de españa', 'banco')).toBe(true);
      expect(hasBoundedOccurrence('bancos centrales', 'banco')).toBe(false);
    });

    it('does not trust the classic word boundary with accents', () => {
      // \b would fail on Álvaro (á) and José (é), which is the whole point.
      expect(hasBoundedOccurrence('álvaro salió', 'álvaro')).toBe(true);
      expect(hasBoundedOccurrence('josé vino', 'josé')).toBe(true);
      expect(hasBoundedOccurrence('peralvaro', 'álvaro')).toBe(false);
    });
  });

  describe('matchTermsInText', () => {
    it('returns the matched terms in the order given', () => {
      const text = 'La OMS y el Banco de España publicaron el informe.';
      expect(matchTermsInText(text, ['Banco de España', 'OMS', 'PIB'])).toEqual([
        'Banco de España',
        'OMS',
      ]);
    });

    it('ignores partial appearances', () => {
      expect(matchTermsInText('bancos', ['banco'])).toEqual([]);
    });
  });

  describe('matchTaggedTermsInText', () => {
    it('keeps each term kind', () => {
      const matched = matchTaggedTermsInText('ver (garcía, 2024) y @gar2024', [
        { term: '(garcía, 2024)', kind: 'authorYear' },
        { term: '@gar2024', kind: 'citeKey' },
      ]);
      expect(matched).toEqual([
        { term: '(garcía, 2024)', kind: 'authorYear' },
        { term: '@gar2024', kind: 'citeKey' },
      ]);
    });
  });

  describe('entityTermsOf', () => {
    it('collects name, aliases and translations of at least 3 chars', () => {
      const terms = entityTermsOf({
        name: 'Banco de España',
        aliases: [{ value: 'BdE' }, { value: 'ab' }],
        translations: { en: 'Bank of Spain', fr: 'x' },
      });
      expect(terms).toContain('Banco de España');
      expect(terms).toContain('BdE');
      expect(terms).toContain('Bank of Spain');
      expect(terms).not.toContain('ab');
      expect(terms).not.toContain('x');
    });
  });

  describe('knowledgeTermsOf', () => {
    it('uses the title and the tags', () => {
      const terms = knowledgeTermsOf({ title: 'Sistema inmune', tags: ['biología', ''] });
      expect(terms).toEqual(['Sistema inmune', 'biología']);
    });
  });

  describe('bibliographyCitationForms', () => {
    const entry = {
      citeKey: 'garcia2024',
      title: 'Una historia de la ciencia moderna en España',
      shortTitle: 'Historia de la ciencia',
      creators: [{ creatorType: 'author', lastName: 'García', firstName: 'Ana' }],
      year: '2024',
      doi: '10.1000/xyz123',
      isbn: '9783161484100',
    };

    it('builds author-year inline citations', () => {
      const terms = bibliographyCitationForms(entry).map((t) => t.term);
      expect(terms).toContain('García (2024)');
      expect(terms).toContain('(García, 2024)');
    });

    it('builds citeKey wrappers, including LaTeX', () => {
      const terms = bibliographyCitationForms(entry).map((t) => t.term);
      expect(terms).toContain('garcia2024');
      expect(terms).toContain('@garcia2024');
      expect(terms).toContain('\\cite{garcia2024}');
      expect(terms).toContain('[garcia2024]');
    });

    it('matches the title and short title', () => {
      const matched = matchTaggedTermsInText(
        'El libro Una historia de la ciencia moderna en España lo explica.',
        bibliographyCitationForms(entry),
      );
      expect(matched.some((m) => m.kind === 'title')).toBe(true);
    });

    it('matches identifiers', () => {
      const matched = matchTaggedTermsInText(
        'doi:10.1000/xyz123',
        bibliographyCitationForms(entry),
      );
      expect(matched.some((m) => m.kind === 'identifier')).toBe(true);
    });

    it('never emits a bare year, so numeric citations cannot slip in', () => {
      const terms = bibliographyCitationForms(entry).map((t) => t.term);
      expect(terms).not.toContain('2024');
    });

    it('does not match a numeric citation [3]', () => {
      const matched = matchTaggedTermsInText(
        'según el informe [3]',
        bibliographyCitationForms(entry),
      );
      expect(matched).toEqual([]);
    });

    it('uses et al. for three or more authors', () => {
      const terms = bibliographyCitationForms({
        creators: [
          { creatorType: 'author', lastName: 'Uno' },
          { creatorType: 'author', lastName: 'Dos' },
          { creatorType: 'author', lastName: 'Tres' },
        ],
        year: '2019',
      }).map((t) => t.term);
      expect(terms).toContain('Uno et al. (2019)');
      expect(terms).toContain('(Uno et al., 2019)');
    });

    it('uses both spellings for two authors', () => {
      const terms = bibliographyCitationForms({
        creators: [
          { creatorType: 'author', lastName: 'Uno' },
          { creatorType: 'author', lastName: 'Dos' },
        ],
        year: '2019',
      }).map((t) => t.term);
      expect(terms).toContain('Uno & Dos (2019)');
      expect(terms).toContain('Uno y Dos (2019)');
    });
  });

  describe('dateSurfaceForms', () => {
    it('returns day, month and year forms', () => {
      const forms = dateSurfaceForms('1492-10-12');
      const precisions = new Set(forms.map((f) => f.precision));
      expect(precisions).toEqual(new Set(['day', 'month', 'year']));
      expect(forms.map((f) => f.term)).toContain('12 de octubre de 1492');
      expect(forms.map((f) => f.term)).toContain('12/10/1492');
      expect(forms.map((f) => f.term)).toContain('october 12, 1492');
    });

    it('accepts a bare year', () => {
      expect(dateSurfaceForms('1789')).toEqual([
        { term: '1789', precision: 'year' },
      ]);
    });

    it('returns nothing for an unparsable date', () => {
      expect(dateSurfaceForms('')).toEqual([]);
      expect(dateSurfaceForms('sin fecha')).toEqual([]);
    });
  });

  describe('matchDateInText', () => {
    it('prefers the full date over the bare year', () => {
      const found = matchDateInText('La toma fue el 12 de octubre de 1492.', '1492-10-12');
      expect(found).toEqual({ term: '12 de octubre de 1492', precision: 'day' });
    });

    it('falls back to the year when only the year appears', () => {
      const found = matchDateInText('Era el año 1789.', '1789-07-14');
      expect(found).toEqual({ term: '1789', precision: 'year' });
    });

    it('returns null when nothing matches', () => {
      expect(matchDateInText('no hay fechas aquí', '1492-10-12')).toBeNull();
    });
  });
});
