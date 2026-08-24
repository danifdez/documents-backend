import { CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'execution_step_dependencies' })
@Index('IDX_execution_step_dependencies_depends_on', ['dependsOnStepId'])
export class ExecutionStepDependencyEntity {
  @PrimaryColumn({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @PrimaryColumn({ name: 'depends_on_step_id', type: 'uuid' })
  dependsOnStepId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
