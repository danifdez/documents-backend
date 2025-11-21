import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateEntityProjects1760100000001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create entity_projects table
        await queryRunner.createTable(
            new Table({
                name: 'entity_projects',
                columns: [
                    {
                        name: 'entity_id',
                        type: 'int',
                        isPrimary: true,
                    },
                    {
                        name: 'project_id',
                        type: 'int',
                        isPrimary: true,
                    },
                    {
                        name: 'created_at',
                        type: 'timestamp',
                        default: 'CURRENT_TIMESTAMP',
                    },
                ],
            }),
            true
        );

        // Add foreign key to entities table
        await queryRunner.createForeignKey(
            'entity_projects',
            new TableForeignKey({
                columnNames: ['entity_id'],
                referencedColumnNames: ['id'],
                referencedTableName: 'entities',
                onDelete: 'CASCADE',
            })
        );

        // Add foreign key to projects table
        await queryRunner.createForeignKey(
            'entity_projects',
            new TableForeignKey({
                columnNames: ['project_id'],
                referencedColumnNames: ['id'],
                referencedTableName: 'projects',
                onDelete: 'CASCADE',
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('entity_projects');
    }
}
