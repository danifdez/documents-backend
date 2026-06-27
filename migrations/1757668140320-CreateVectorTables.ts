import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVectorTables1757668140320 implements MigrationInterface {
    name = 'CreateVectorTables1757668140320'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

        // Workspace RAG: heterogeneous sources (resource/doc/knowledge). No single
        // parent table, so cleanup is app-driven via delete_by_source.
        await queryRunner.query(`
            CREATE TABLE "rag_chunks" (
                "id" text PRIMARY KEY,
                "embedding" vector(384) NOT NULL,
                "source_type" text NOT NULL,
                "source_id" text NOT NULL,
                "project_id" text,
                "payload" jsonb NOT NULL DEFAULT '{}'::jsonb
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_rag_chunks_source_id" ON "rag_chunks" ("source_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_rag_chunks_project_id" ON "rag_chunks" ("project_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_rag_chunks_embedding" ON "rag_chunks" USING hnsw ("embedding" vector_cosine_ops)`);

        // Assistant working-folder files: single parent (indexed_files) → FK + CASCADE.
        await queryRunner.query(`
            CREATE TABLE "indexed_file_chunks" (
                "id" text PRIMARY KEY,
                "embedding" vector(384) NOT NULL,
                "indexed_file_id" integer NOT NULL,
                "owner_tag" text NOT NULL,
                "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
                CONSTRAINT "FK_indexed_file_chunks_file" FOREIGN KEY ("indexed_file_id") REFERENCES "indexed_files"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_indexed_file_chunks_file_id" ON "indexed_file_chunks" ("indexed_file_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_indexed_file_chunks_owner_tag" ON "indexed_file_chunks" ("owner_tag")`);
        await queryRunner.query(`CREATE INDEX "IDX_indexed_file_chunks_embedding" ON "indexed_file_chunks" USING hnsw ("embedding" vector_cosine_ops)`);

        // Assistant personal memory: 1-to-1 with the memory entry → FK + CASCADE.
        await queryRunner.query(`
            CREATE TABLE "memory_vectors" (
                "memory_id" integer PRIMARY KEY,
                "embedding" vector(384) NOT NULL,
                "assistant_id" text NOT NULL,
                "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
                CONSTRAINT "FK_memory_vectors_entry" FOREIGN KEY ("memory_id") REFERENCES "assistant_memory_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_memory_vectors_assistant_id" ON "memory_vectors" ("assistant_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_memory_vectors_embedding" ON "memory_vectors" USING hnsw ("embedding" vector_cosine_ops)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "memory_vectors"`);
        await queryRunner.query(`DROP TABLE "indexed_file_chunks"`);
        await queryRunner.query(`DROP TABLE "rag_chunks"`);
    }
}
