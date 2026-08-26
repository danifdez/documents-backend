# Background actions

Documents runs longer actions in the background so users can continue working. Examples include extracting a file, generating a summary, translating content, identifying entities, building a search index, and analyzing a dataset.

## Action states

An action moves through the following observable states:

```text
queued → running → waiting → running → completed
             ↘ failed      ↘ cancelled
```

- **Queued** means the action is waiting for a compatible processing service.
- **Running** means one or more parts are being processed.
- **Waiting** means the action is waiting for another required part or condition.
- **Completed** means the final result has been accepted and applied.
- **Failed** means Documents could not produce a valid result.
- **Cancelled** means processing was stopped and its result will not be applied.

Some actions are divided into several parts. Documents waits for every required part before producing the final result, so partial output is not presented as a completed action.

## Priorities and capacity

Work can have high, normal, or background priority. Documents also considers when the work becomes available, any deadline, the required capability, and the processing capacity currently in use. This lets interactive work take precedence without losing queued background work.

## Interruptions and recovery

Documents keeps a durable history of each action. If a processor stops responding, unfinished work can be made available for another attempt. Late results from an expired attempt are ignored, and repeated delivery of the same accepted result does not apply the result twice.

Cancellation is checked before and after processing. Work already being calculated may need to finish locally, but its output is discarded if the cancellation was observed.

## Progress and notifications

The application receives progress, completion, failure, and cancellation updates in real time. A user can leave the current screen while an action runs and see its result once Documents has finalized it.

Action history is scoped to the signed-in owner when authentication is enabled. Evaluation evidence can only be exported when the caller explicitly grants the required evaluation consent.
