import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssistantEntity } from '../../assistant/assistant.entity';
import { AgentEntity } from '../../agent/agent.entity';
import { ownerPrincipalFromUser } from '../owner-principal';

abstract class OwnedResourceGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  protected authEnabled(): boolean {
    return this.configService.get('AUTH_ENABLED') === 'true';
  }

  protected ownerPrincipal(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest();
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return ownerPrincipalFromUser(request.user);
  }

  protected numericParam(context: ExecutionContext, names: string[]): number {
    const request = context.switchToHttp().getRequest();
    for (const name of names) {
      const value = request.params?.[name];
      if (value !== undefined) return Number(value);
    }
    return Number.NaN;
  }

  abstract canActivate(context: ExecutionContext): Promise<boolean>;
}

@Injectable()
export class AssistantOwnedGuard extends OwnedResourceGuard {
  constructor(
    @InjectRepository(AssistantEntity)
    private readonly repository: Repository<AssistantEntity>,
    configService: ConfigService,
  ) {
    super(configService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.authEnabled()) return true;
    const ownerPrincipal = this.ownerPrincipal(context);
    const id = this.numericParam(context, ['assistantId', 'ownerId']);
    if (!Number.isInteger(id) || id <= 0) {
      throw new NotFoundException('Assistant not found');
    }
    const exists = await this.repository.exists({
      where: { id, ownerPrincipal },
    });
    if (!exists) throw new NotFoundException('Assistant not found');
    return true;
  }
}

@Injectable()
export class AgentOwnedGuard extends OwnedResourceGuard {
  constructor(
    @InjectRepository(AgentEntity)
    private readonly repository: Repository<AgentEntity>,
    configService: ConfigService,
  ) {
    super(configService);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.authEnabled()) return true;
    const ownerPrincipal = this.ownerPrincipal(context);
    const id = this.numericParam(context, ['agentId', 'ownerId']);
    if (!Number.isInteger(id) || id <= 0) {
      throw new NotFoundException('Agent not found');
    }
    const exists = await this.repository.exists({
      where: { id, ownerPrincipal },
    });
    if (!exists) throw new NotFoundException('Agent not found');
    return true;
  }
}
