import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parse } = require('csv-parse/sync');

export interface CsvPreview {
    headers: string[];
    previewRows: string[][];
    totalRows: number;
}

export interface CsvColumnMapping {
    csvColumn: string;
    fieldKey: string;
}

@Injectable()
export class DatasetCsvService {
    parseAll(buffer: Buffer): { headers: string[]; rows: string[][] } {
        const content = buffer.toString('utf-8');
        const allRows: string[][] = parse(content, {
            skip_empty_lines: true,
            relax_column_count: true,
        });

        if (allRows.length === 0) {
            return { headers: [], rows: [] };
        }

        return { headers: allRows[0], rows: allRows.slice(1) };
    }

    inferSchema(headers: string[], rows: string[][]): { key: string; name: string; type: 'text' | 'number' | 'boolean' | 'date'; required: boolean }[] {
        return headers.map((header, colIndex) => {
            const values = rows
                .map(row => row[colIndex])
                .filter(v => v !== undefined && v !== null && v !== '');

            return {
                key: this.toFieldKey(header),
                name: header,
                type: this.detectType(values),
                required: false,
            };
        });
    }

    private toFieldKey(header: string): string {
        return header
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
    }

    private detectType(values: string[]): 'text' | 'number' | 'boolean' | 'date' {
        if (values.length === 0) return 'text';

        const sample = values.slice(0, 100);

        if (sample.every(v => v === 'true' || v === 'false')) return 'boolean';
        if (sample.every(v => !isNaN(Number(v)))) return 'number';
        if (sample.every(v => /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(Date.parse(v)))) return 'date';

        return 'text';
    }

    parsePreview(buffer: Buffer): CsvPreview {
        const content = buffer.toString('utf-8');
        const allRows: string[][] = parse(content, {
            skip_empty_lines: true,
            relax_column_count: true,
        });

        if (allRows.length === 0) {
            return { headers: [], previewRows: [], totalRows: 0 };
        }

        const headers = allRows[0];
        const dataRows = allRows.slice(1);
        const previewRows = dataRows.slice(0, 10);

        return {
            headers,
            previewRows,
            totalRows: dataRows.length,
        };
    }

    parseAndMap(buffer: Buffer, mappings: CsvColumnMapping[], skipFirstRow: boolean = true): Record<string, any>[] {
        const content = buffer.toString('utf-8');
        const allRows: string[][] = parse(content, {
            skip_empty_lines: true,
            relax_column_count: true,
        });

        if (allRows.length === 0) return [];

        const headers = allRows[0];
        const dataRows = skipFirstRow ? allRows.slice(1) : allRows;

        // Build column index map
        const columnIndexMap: Map<string, number> = new Map();
        headers.forEach((header, index) => {
            columnIndexMap.set(header, index);
        });

        return dataRows.map(row => {
            const record: Record<string, any> = {};
            for (const mapping of mappings) {
                const colIndex = columnIndexMap.get(mapping.csvColumn);
                if (colIndex !== undefined && colIndex < row.length) {
                    record[mapping.fieldKey] = row[colIndex];
                }
            }
            return record;
        });
    }
}
