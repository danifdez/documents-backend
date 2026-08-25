import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentsGraph1757668140490 implements MigrationInterface {
  name = 'CreateDocumentsGraph1757668140490';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("LOAD 'age'");
    await queryRunner.query('SET search_path = ag_catalog, "$user", public');
    const [graph] = await queryRunner.query(
      `SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'documents'`,
    );
    if (!graph) {
      await queryRunner.query(`SELECT ag_catalog.create_graph('documents')`);
    }
    await queryRunner.query(`
      SELECT * FROM ag_catalog.cypher('documents', $$
        CREATE (a:Entity {entity_id: -1, schema_marker: true}),
               (b:Entity {entity_id: -2, schema_marker: true}),
               (a)-[:REL {schema_marker: true}]->(b)
        RETURN 1
      $$) AS (ok ag_catalog.agtype)
    `);
    await queryRunner.query(`
      SELECT * FROM ag_catalog.cypher('documents', $$
        MATCH (e:Entity {schema_marker: true}) DETACH DELETE e
        RETURN 1
      $$) AS (ok ag_catalog.agtype)
    `);
    await queryRunner.query(`
      SELECT * FROM ag_catalog.cypher('documents', $$
        MATCH (e:Entity) REMOVE e.project_id, e.resource_id
        RETURN count(e)
      $$) AS (count ag_catalog.agtype)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS entity_entity_id_idx
      ON documents."Entity"
      USING btree (
        ag_catalog.agtype_access_operator(
          properties,
          '"entity_id"'::ag_catalog.agtype
        )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("LOAD 'age'");
    await queryRunner.query('SET search_path = ag_catalog, "$user", public');
    const [graph] = await queryRunner.query(
      `SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'documents'`,
    );
    if (graph) {
      await queryRunner.query(
        `SELECT ag_catalog.drop_graph('documents', true)`,
      );
    }
  }
}
