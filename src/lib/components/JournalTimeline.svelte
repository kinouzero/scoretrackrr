<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import type { IconName } from './icons';
  import type { AuditEntry } from '#lib/domain/journal';
  import { messages } from '#lib/i18n/index';

  let {
    entries,
    label,
    owner,
    sequence,
    date,
  }: {
    entries: readonly AuditEntry[];
    label: (entry: AuditEntry) => string;
    owner: (id: string) => string;
    sequence: (id: string) => number;
    date: Intl.DateTimeFormat;
  } = $props();

  const icons = {
    start: 'play',
    resume: 'play',
    pause: 'pause',
    record: 'plus',
    correct: 'edit',
    undo: 'undo',
    finish: 'check',
    cancel: 'cancel',
    authority_transfer: 'transfer',
  } satisfies Record<AuditEntry['action']['type'], IconName>;
</script>

<ol class="journal-entries" aria-label={messages.matches.journal}>
  {#each entries as entry (entry.event.id)}
    <li class="journal-entry" class:superseded={!!entry.supersededBy} data-kind={entry.action.type}>
      <span class="event-marker" aria-hidden="true">
        <Icon name={icons[entry.action.type]} size={16} />
      </span>
      <div class="event-content">
        <div class="event-heading">
          <h3>{messages.matches.actionNumber(entry.event.sequence)}</h3>
          <time datetime={entry.event.timestamp}
            >{date.format(new Date(entry.event.timestamp))}</time
          >
        </div>
        <p class="event-description">{label(entry)}</p>
        {#if entry.supersededBy}
          <p class="revision-label">{messages.matches.superseded(sequence(entry.supersededBy))}</p>
        {/if}
        <p class="event-author">
          {messages.matches.byAuthor(owner(entry.event.actorPlayerId))}
          {#if entry.event.payload.proposal && typeof entry.event.payload.proposal === 'object' && !Array.isArray(entry.event.payload.proposal)}
            · {messages.sharing.proposedBy(
              owner((entry.event.payload.proposal as { playerId: string }).playerId),
            )}
          {/if}
        </p>
      </div>
    </li>
  {/each}
</ol>

<style>
  .journal-entries {
    list-style: none;
    margin: var(--space-5) 0 0;
    padding: 0;
  }
  .journal-entry {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    gap: var(--space-4);
    padding-block-end: var(--space-4);
  }
  .journal-entry::before {
    content: '';
    position: absolute;
    inset-inline-start: 15px;
    inset-block: 16px 0;
    width: 1px;
    background: var(--border);
  }
  .journal-entry:last-child {
    padding-block-end: 0;
  }
  .journal-entry:last-child::before {
    display: none;
  }
  .event-marker {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--soft);
    color: var(--accent);
  }
  [data-kind='start'] .event-marker,
  [data-kind='resume'] .event-marker,
  [data-kind='finish'] .event-marker {
    color: var(--success);
    border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  }
  [data-kind='correct'] .event-marker,
  [data-kind='pause'] .event-marker {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 45%, var(--border));
  }
  [data-kind='undo'] .event-marker,
  [data-kind='cancel'] .event-marker {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  }
  .superseded .event-marker {
    color: var(--muted-text);
    border-color: var(--border);
  }
  .event-content {
    min-width: 0;
    display: grid;
    justify-items: start;
    gap: var(--space-1);
    padding-block: var(--space-1) var(--space-4);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    overflow-wrap: anywhere;
  }
  .journal-entry:last-child .event-content {
    padding-block-end: 0;
    border-bottom: 0;
  }
  .event-heading {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    color: var(--muted-text);
  }
  h3,
  time,
  .event-author {
    font-size: 0.75rem;
    line-height: 1.5;
  }
  h3 {
    font-weight: 650;
  }
  time {
    font-variant-numeric: tabular-nums;
  }
  .event-description {
    font-size: 0.95rem;
    font-weight: 650;
    line-height: 1.55;
  }
  .event-author {
    color: var(--muted-text);
  }
  .revision-label {
    padding: var(--space-1) var(--space-2);
    border-radius: 8px;
    background: var(--soft);
    color: var(--muted-text);
    font-size: 0.75rem;
    line-height: 1.5;
  }
  @media (max-width: 480px) {
    .journal-entry {
      gap: var(--space-3);
    }
  }
</style>
