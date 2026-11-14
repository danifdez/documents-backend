import { strict as assert } from 'assert';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ResourceEntity } from '../../src/resource/resource.entity';

// Run explicitly against a disposable profile; never fall back to the local DB.
// Load that profile's environment, then use ts-node/register and
// tsconfig-paths/register. Remove the profile with ./manage after the probe:
// canonical execution events are append-only and must not be deleted in place.
async function main(): Promise<void> {
  assert.equal(process.env.DOCUMENTS_OWNERSHIP_TEST_DATABASE, 'isolated');
  assert.equal(process.env.POSTGRES_HOST, '127.0.0.1');
  assert.equal(process.env.POSTGRES_PORT, '5434');
  assert.equal(process.env.AUTH_ENABLED, 'true');
  assert.equal(process.env.NODE_ENV, 'test');
  process.env.OTEL_SDK_DISABLED = 'true';
  for (const key of Object.keys(process.env))
    if (key.startsWith('OTEL_EXPORTER_OTLP')) delete process.env[key];
  const app = await NestFactory.create(AppModule.register(), { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const database = app.get(DataSource);
  const auth = app.get(AuthService);
  const users: Array<{ id: number; token: string }> = [];
  const executionIds: string[] = [];
  let checks = 0;
  try {
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    async function request(
      method: string,
      path: string,
      token?: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      return fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    for (let index = 0; index < 2; index++) {
      const username = 'ownership-' + randomUUID();
      const password = randomUUID();
      const user = await auth.createUser({
        username,
        password,
        permissions: {
          ask: true,
          summarize: true,
          translate: true,
          'entity-extraction': true,
          'key-points': true,
          keywords: true,
        },
      });
      // Keep each identity separate; the disposable profile owns these fixtures.
      users.push({ id: user.id, token: '' });
      const response = await request('POST', '/auth/login', undefined, {
        username,
        password,
      });
      assert.equal(response.status, 201, 'Real user login must succeed');
      users[index].token = (await response.json()).accessToken;
      assert.ok(users[index].token);
    }
    const resource = await database.getRepository(ResourceEntity).save({
      name: 'ownership-test-' + randomUUID(),
      content: '<p>The library opens on Monday.</p>',
      language: 'en',
      status: 'ready',
    });
    const resourceId = resource.id;
    const routes: Array<[string, Record<string, unknown>]> = [
      ['/model/ask', { question: 'When does the library open?' }],
      [
        '/model/summarize',
        {
          type: 'workspace-selection',
          text: 'The library opens on Monday.',
          targetLanguage: 'en',
        },
      ],
      ['/model/translate', { resourceId, targetLanguage: 'es' }],
      ['/model/extract-entities', { resourceId }],
      ['/model/key-points', { resourceId, targetLanguage: 'en' }],
      ['/model/keywords', { resourceId, targetLanguage: 'en' }],
      ['/model/semantic-search', { query: 'library' }],
      [
        '/browser-inference',
        {
          requestJson: '{"messages":[{"role":"user","content":"Hello"}]}',
          label: 'ownership-test',
          detail: 'test',
        },
      ],
    ];
    for (const [route, payload] of routes) {
      for (const [index, owner] of users.entries()) {
        const other = users[1 - index];
        const response = await request(
          'POST',
          route,
          owner.token,
          {
            ...payload,
            ownerPrincipal: String(other.id),
            userId: other.id,
            scope: { ownerPrincipal: String(other.id) },
          },
          { 'x-user-id': String(other.id) },
        );
        assert.equal(response.status, 201, route + ' must create an execution');
        const { executionId } = await response.json();
        assert.equal(typeof executionId, 'string');
        executionIds.push(executionId);
        const stored = await database
          .getRepository(ExecutionEntity)
          .findOneByOrFail({ executionId });
        assert.equal(
          stored.ownerPrincipal,
          String(owner.id),
          route + ' must use the authenticated owner, ignoring forged fields',
        );
        for (const suffix of ['progress', 'events', 'bundle']) {
          const path = '/executions/' + executionId + '/' + suffix;
          const headers =
            suffix === 'bundle' ? { 'x-evaluation-consent': 'granted' } : {};
          const own = await request(
            'GET',
            path,
            owner.token,
            undefined,
            headers,
          );
          assert.equal(own.status, 200, route + ' owner can read ' + suffix);
          const denied = await request(
            'GET',
            path,
            other.token,
            undefined,
            headers,
          );
          assert.equal(
            denied.status,
            404,
            route + ' other user cannot read ' + suffix,
          );
          assert.equal((await denied.json()).message, 'Execution not found');
          const anonymous = await request(
            'GET',
            path,
            undefined,
            undefined,
            headers,
          );
          assert.equal(
            anonymous.status,
            401,
            'Anonymous reads must be rejected',
          );
          checks += 3;
        }
        const noConsent = await request(
          'GET',
          '/executions/' + executionId + '/bundle',
          owner.token,
        );
        assert.equal(noConsent.status, 403, 'Owner still needs export consent');
        checks++;
      }
    }
    console.log(
      JSON.stringify({
        routes: routes.length,
        executions: executionIds.length,
        accessChecks: checks,
        forgedOwnershipIgnored: true,
        authenticationAndConsentPreserved: true,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
