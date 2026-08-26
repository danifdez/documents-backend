import {
  buildActiveConversationContext,
  MAX_ACTIVE_CONVERSATION_CHARS,
  MAX_ACTIVE_CONVERSATION_MESSAGES,
} from '../../../src/conversation/conversation-context';
import * as revisions from '../../../src/conversation/conversation-artifact-revision.entity';

function revision(
  contents: string[],
): revisions.ConversationArtifactRevisionEntity {
  return Object.assign(new revisions.ConversationArtifactRevisionEntity(), {
    artifactId: '018f1d8a-54d7-7d63-a1ee-000000000801',
    revision: contents.length,
    sessionId: '018f1d8a-54d7-7d63-a1ee-000000000802',
    parentRevision: contents.length - 1 || null,
    contentHash: `sha256:${'a'.repeat(64)}`,
    messages: contents.map((content, index) => ({
      messageId: index + 1,
      turnId: `018f1d8a-54d7-7d63-a1ee-${String(index).padStart(12, '0')}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content,
      executionId: null,
      error: null,
      createdAt: new Date(2026, 0, index + 1).toISOString(),
    })),
    createdAt: new Date(),
  });
}

describe('conversation context', () => {
  it('keeps the exact revision when the conversation fits', () => {
    const context = buildActiveConversationContext(
      revision(['First', 'Second', 'Current request']),
    );

    expect(context.conversation.map((message) => message.content)).toEqual([
      'First',
      'Second',
      'Current request',
    ]);
    expect(context.continuityCapsule).toBeNull();
    expect(context.conversationContext).toMatchObject({
      revision: 3,
      contentHash: `sha256:${'a'.repeat(64)}`,
    });
  });

  it('caps recent messages and links a deterministic continuity capsule', () => {
    const context = buildActiveConversationContext(
      revision(
        Array.from({ length: 30 }, (_, index) => `message-${index + 1}`),
      ),
    );

    expect(context.conversation).toHaveLength(MAX_ACTIVE_CONVERSATION_MESSAGES);
    expect(context.conversation.at(-1)?.content).toBe('message-30');
    expect(context.continuityCapsule).toMatchObject({
      schemaVersion: 'continuity-capsule/1',
      omittedMessageCount: 6,
      omittedTurnCount: 6,
      sourceConversation: context.conversationContext,
    });
    expect(context.continuityCapsule?.digest).toContain('message-6');
  });

  it('bounds oversized messages while preserving their head and tail', () => {
    const oversized = `HEAD-${'x'.repeat(40_000)}-TAIL`;
    const context = buildActiveConversationContext(revision([oversized]));
    const active = context.conversation[0].content;

    expect(active.length).toBeLessThanOrEqual(MAX_ACTIVE_CONVERSATION_CHARS);
    expect(active).toContain('HEAD-');
    expect(active).toContain('-TAIL');
    expect(active).toContain('[...content clipped...]');
    expect(context.continuityCapsule?.truncatedMessageIds).toEqual([1]);
  });

  it('keeps a contiguous recent window after reaching the character limit', () => {
    const context = buildActiveConversationContext(
      revision([
        'old-small-message',
        `boundary-${'b'.repeat(10_000)}`,
        `recent-${'r'.repeat(16_000)}`,
        `latest-${'l'.repeat(10_000)}`,
      ]),
    );

    expect(context.conversation).toHaveLength(2);
    expect(context.conversation[0].content).toContain('recent-');
    expect(context.conversation[1].content).toContain('latest-');
    expect(context.continuityCapsule?.omittedMessageCount).toBe(2);
  });
});
