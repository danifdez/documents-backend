// Pure text-matching helpers shared by the page-augmentation endpoints. Kept
// free of Nest/TypeORM so the tricky parts —Unicode word boundaries and the
// citation/date surface forms— can be unit-tested without a database.

export interface TaggedTerm {
  term: string;
  kind: string;
}

export interface DateSurfaceForm {
  term: string;
  precision: 'day' | 'month' | 'year';
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const MONTHS_EN = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
];

// `\b` does not work with accented characters (é, ñ…), so a term only counts
// when neither neighbour is a letter or a digit of any alphabet.
const isWordChar = (c: string): boolean => /[\p{L}\p{N}_]/u.test(c);

/**
 * Does `lowerTerm` appear in `lowerText` with clean boundaries on both sides?
 * Both arguments must already be lower-cased by the caller.
 */
export function hasBoundedOccurrence(
  lowerText: string,
  lowerTerm: string,
): boolean {
  if (!lowerTerm) return false;
  let searchFrom = 0;
  while (searchFrom < lowerText.length) {
    const idx = lowerText.indexOf(lowerTerm, searchFrom);
    if (idx === -1) return false;
    const charBefore = idx > 0 ? lowerText[idx - 1] : ' ';
    const charAfter =
      idx + lowerTerm.length < lowerText.length
        ? lowerText[idx + lowerTerm.length]
        : ' ';
    if (!isWordChar(charBefore) && !isWordChar(charAfter)) {
      return true;
    }
    searchFrom = idx + 1;
  }
  return false;
}

/** The terms from `terms` that appear in `text`, in the order they were given. */
export function matchTermsInText(text: string, terms: string[]): string[] {
  const lowerText = (text ?? '').toLowerCase();
  const matched: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (hasBoundedOccurrence(lowerText, term.toLowerCase())) {
      matched.push(term);
    }
  }
  return matched;
}

/** Same as {@link matchTermsInText} but preserving each term's `kind`. */
export function matchTaggedTermsInText(
  text: string,
  terms: TaggedTerm[],
): TaggedTerm[] {
  const lowerText = (text ?? '').toLowerCase();
  const matched: TaggedTerm[] = [];
  for (const entry of terms) {
    if (!entry.term) continue;
    if (hasBoundedOccurrence(lowerText, entry.term.toLowerCase())) {
      matched.push(entry);
    }
  }
  return matched;
}

/** Every way an entity can be named: its name, aliases and translations. */
export function entityTermsOf(entity: any): string[] {
  const terms: string[] = [];
  if (entity?.name && entity.name.length >= 3) {
    terms.push(entity.name);
  }
  if (Array.isArray(entity?.aliases)) {
    for (const alias of entity.aliases) {
      if (alias?.value && alias.value.length >= 3) {
        terms.push(alias.value);
      }
    }
  }
  if (entity?.translations && typeof entity.translations === 'object') {
    for (const value of Object.values(entity.translations)) {
      if (typeof value === 'string' && value.length >= 3) {
        terms.push(value);
      }
    }
  }
  return terms;
}

/** A knowledge entry is matched by its title and its tags. */
export function knowledgeTermsOf(entry: any): string[] {
  const terms: string[] = [];
  if (entry?.title && entry.title.length >= 3) {
    terms.push(entry.title);
  }
  if (Array.isArray(entry?.tags)) {
    for (const tag of entry.tags) {
      if (typeof tag === 'string' && tag.length >= 3) {
        terms.push(tag);
      }
    }
  }
  return terms;
}

function authorList(entry: any): { last: string }[] {
  const creators = Array.isArray(entry?.creators) ? entry.creators : [];
  return creators
    .filter((c: any) => c && c.creatorType === 'author')
    .map((c: any) => ({ last: (c.lastName ?? c.name ?? '').trim() }))
    .filter((a: { last: string }) => a.last.length > 0);
}

function dedupe(terms: TaggedTerm[]): TaggedTerm[] {
  const seen = new Set<string>();
  const out: TaggedTerm[] = [];
  for (const entry of terms) {
    const key = entry.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * The concrete forms in which a bibliography entry can be cited inside a page.
 * Numeric citations (`[3]`, `(12, 15)`) are deliberately left out: they point
 * at the page's own reference list, which we cannot see, so matching them would
 * only produce false positives.
 */
export function bibliographyCitationForms(entry: any): TaggedTerm[] {
  const terms: TaggedTerm[] = [];
  const authors = authorList(entry);
  const year = entry?.year ? String(entry.year) : '';

  if (authors.length > 0 && year) {
    const first = authors[0].last;
    const second = authors.length > 1 ? authors[1].last : '';
    const short =
      authors.length === 1
        ? first
        : authors.length === 2
          ? `${first} & ${second}`
          : `${first} et al.`;
    const shortAnd =
      authors.length === 2 ? `${first} y ${second}` : short;
    const forms = [
      `${short} (${year})`,
      `(${short}, ${year})`,
      `${shortAnd} (${year})`,
      `(${shortAnd}, ${year})`,
    ];
    for (const form of forms) {
      terms.push({ term: form, kind: 'authorYear' });
    }
  }

  const citeKey = entry?.citeKey ? String(entry.citeKey) : '';
  if (citeKey.length >= 3) {
    for (const form of [
      citeKey,
      `[${citeKey}]`,
      `@${citeKey}`,
      `\\cite{${citeKey}}`,
      `\\citep{${citeKey}}`,
      `\\citet{${citeKey}}`,
    ]) {
      terms.push({ term: form, kind: 'citeKey' });
    }
  }

  const title = entry?.title ? String(entry.title).trim() : '';
  if (title.length >= 20) {
    terms.push({ term: title, kind: 'title' });
  }
  const shortTitle = entry?.shortTitle ? String(entry.shortTitle).trim() : '';
  if (shortTitle.length >= 8 && shortTitle !== title) {
    terms.push({ term: shortTitle, kind: 'title' });
  }

  const doi = entry?.doi ? String(entry.doi).trim() : '';
  if (doi.length >= 6) {
    terms.push({ term: doi, kind: 'identifier' });
    terms.push({ term: `doi:${doi}`, kind: 'identifier' });
    terms.push({ term: `https://doi.org/${doi}`, kind: 'identifier' });
  }
  for (const [value, label] of [
    [entry?.isbn, 'isbn'],
    [entry?.issn, 'issn'],
  ] as const) {
    const id = value ? String(value).trim() : '';
    if (id.length >= 6) {
      terms.push({ term: id, kind: 'identifier' });
      terms.push({ term: `${label}:${id}`, kind: 'identifier' });
    }
  }
  const url = entry?.url ? String(entry.url).trim() : '';
  if (url.length >= 8) {
    terms.push({ term: url, kind: 'identifier' });
  }

  return dedupe(terms);
}

/**
 * The textual forms a `YYYY-MM-DD` date takes in prose. The bare year is kept
 * but flagged as `year` so callers can prefer a full-date match.
 */
export function dateSurfaceForms(isoDate: string): DateSurfaceForm[] {
  const raw = (isoDate ?? '').trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!full) {
    const yearOnly = /^(\d{4})$/.exec(raw);
    return yearOnly ? [{ term: yearOnly[1], precision: 'year' }] : [];
  }

  const year = full[1];
  const month = full[2];
  const day = full[3];
  const dayNum = String(Number(day));
  const monthNum = String(Number(month));
  const es = MONTHS_ES[Number(month) - 1];
  const en = MONTHS_EN[Number(month) - 1];

  const forms: DateSurfaceForm[] = [
    { term: `${year}-${month}-${day}`, precision: 'day' },
    { term: `${day}/${month}/${year}`, precision: 'day' },
    { term: `${day}-${month}-${year}`, precision: 'day' },
    { term: `${dayNum}/${monthNum}/${year}`, precision: 'day' },
    { term: `${dayNum} de ${es} de ${year}`, precision: 'day' },
    { term: `${dayNum} ${es} ${year}`, precision: 'day' },
    { term: `${dayNum} ${en} ${year}`, precision: 'day' },
    { term: `${en} ${dayNum}, ${year}`, precision: 'day' },
    { term: `${dayNum} de ${es}`, precision: 'month' },
    { term: `${es} de ${year}`, precision: 'month' },
    { term: year, precision: 'year' },
  ];
  return forms;
}

/**
 * The highest-precision form of `isoDate` that appears in `text`, or null.
 */
export function matchDateInText(
  text: string,
  isoDate: string,
): DateSurfaceForm | null {
  const forms = dateSurfaceForms(isoDate);
  const order: Array<'day' | 'month' | 'year'> = ['day', 'month', 'year'];
  for (const precision of order) {
    const candidates = forms
      .filter((f) => f.precision === precision)
      .map((f) => f.term);
    const matched = matchTermsInText(text, candidates);
    if (matched.length > 0) {
      return { term: matched[0], precision };
    }
  }
  return null;
}
