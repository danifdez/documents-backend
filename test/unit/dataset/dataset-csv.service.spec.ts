import { DatasetCsvService } from '../../../src/dataset/dataset-csv.service';

describe('DatasetCsvService', () => {
  let service: DatasetCsvService;

  beforeEach(() => {
    service = new DatasetCsvService();
  });

  describe('parseAll', () => {
    it('should parse CSV buffer into headers and rows', () => {
      const csv = 'Name,Age\nAlice,30\nBob,25';
      const result = service.parseAll(Buffer.from(csv));
      expect(result.headers).toEqual(['Name', 'Age']);
      expect(result.rows).toEqual([['Alice', '30'], ['Bob', '25']]);
    });

    it('should return empty if buffer is empty', () => {
      const result = service.parseAll(Buffer.from(''));
      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });
  });

  describe('inferSchema', () => {
    it('should infer text type for string columns', () => {
      const schema = service.inferSchema(['Name'], [['Alice'], ['Bob']]);
      expect(schema[0].type).toBe('text');
      expect(schema[0].key).toBe('name');
    });

    it('should infer number type for numeric columns', () => {
      const schema = service.inferSchema(['Score'], [['100'], ['200']]);
      expect(schema[0].type).toBe('number');
    });

    it('should infer boolean type', () => {
      const schema = service.inferSchema(['Active'], [['true'], ['false']]);
      expect(schema[0].type).toBe('boolean');
    });

    it('should infer date type for ISO dates', () => {
      const schema = service.inferSchema(['Date'], [['2025-01-01'], ['2025-06-15']]);
      expect(schema[0].type).toBe('date');
    });

    it('should normalize header to field key', () => {
      const schema = service.inferSchema(['Full Name', 'Date Of Birth'], []);
      expect(schema[0].key).toBe('full_name');
      expect(schema[1].key).toBe('date_of_birth');
    });
  });

  describe('parsePreview', () => {
    it('should return first 10 rows as preview', () => {
      const rows = Array.from({ length: 20 }, (_, i) => `row${i}`);
      const csv = 'Header\n' + rows.join('\n');
      const result = service.parsePreview(Buffer.from(csv));
      expect(result.headers).toEqual(['Header']);
      expect(result.previewRows.length).toBe(10);
      expect(result.totalRows).toBe(20);
    });
  });

  describe('parseAndMap', () => {
    it('should map CSV columns to field keys', () => {
      const csv = 'Name,Age\nAlice,30\nBob,25';
      const mappings = [
        { csvColumn: 'Name', fieldKey: 'name' },
        { csvColumn: 'Age', fieldKey: 'age' },
      ];
      const result = service.parseAndMap(Buffer.from(csv), mappings, true);
      expect(result).toEqual([
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '25' },
      ]);
    });

    it('should return empty for empty buffer', () => {
      const result = service.parseAndMap(Buffer.from(''), [], true);
      expect(result).toEqual([]);
    });
  });
});
