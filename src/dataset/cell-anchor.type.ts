/**
 * Per-cell traceability for cells populated by the dataset extraction pipeline.
 *
 * Stored as JSONB inside `DatasetRecordEntity.cellMetadata`, keyed by `DatasetField.key`.
 * Cells without an anchor entry (e.g. manually entered values or legacy CSV imports)
 * simply omit their key from the map; the UI treats "missing key" as "no anchor".
 *
 * Consumed by:
 *  - `dataset.extract-row` worker (writes the anchor at extraction time)
 *  - `DatasetExtractionService` (re-extraction + manual-edit confirmation)
 *  - Frontend popover (`DatasetRecordTable.vue`) to surface source, page, quote
 *  - CSV export with `include_anchors=true` (auxiliary columns)
 */
export interface CellAnchor {
    sourceResourceId: number;
    page: number | null;
    quote: string;
    extractedAt: string;
    model: string;
    promptVersion: string;
    editedByUser: boolean;
}

export type ExtractionStatus = 'pending' | 'in_progress' | 'extracted' | 'failed';
