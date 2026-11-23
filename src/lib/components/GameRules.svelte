<script lang="ts">
  import { petanqueSides } from '#lib/domain/games/petanque';
  import type { MatchRecord } from '#lib/domain/records';
  import { ruleGuide, RULES_REVIEWED_AT, type RuleText } from '#lib/application/rule-guide';
  import { translate } from '#lib/i18n/catalog';
  import { messages, getLocale } from '#lib/i18n/index';
  let { match }: { match: MatchRecord } = $props();
  const guide = $derived(ruleGuide(match));
  const t = (message: RuleText) => translate(getLocale(), message.key, message.values);
</script>

<details class="rule-guide">
  <summary class="button secondary"><h2>{messages.four21.ruleSummary}</h2></summary>
  <div class="rule-content">
    <section>
      <h3>{translate(getLocale(), 'ruleGuide.headings.goal')}</h3>
      <p class="rule-goal">{t(guide.goal)}</p>
    </section>
    <section>
      <h3>{translate(getLocale(), 'ruleGuide.headings.play')}</h3>
      <ol>
        {#each guide.play as item (item.key)}<li>{t(item)}</li>{/each}
      </ol>
    </section>
    {#if guide.scoring.length}
      <section>
        <h3>{translate(getLocale(), 'ruleGuide.headings.scoring')}</h3>
        <table>
          <caption class="sr-only">{translate(getLocale(), 'ruleGuide.headings.scoring')}</caption>
          <thead
            ><tr
              ><th scope="col">{translate(getLocale(), 'ruleGuide.table.situation')}</th><th
                scope="col">{translate(getLocale(), 'ruleGuide.table.result')}</th
              ></tr
            ></thead
          >
          <tbody
            >{#each guide.scoring as row (row.label.key + (row.label.values?.name ?? ''))}<tr
                ><th scope="row">{t(row.label)}</th><td>{t(row.value)}</td></tr
              >{/each}</tbody
          >
        </table>
      </section>
    {/if}
    {#if guide.notes.length}
      <section>
        <h3>{translate(getLocale(), 'ruleGuide.headings.settings')}</h3>
        <ul>
          {#each guide.notes as item (item.key)}<li>{t(item)}</li>{/each}
        </ul>
      </section>
    {/if}
    <section>
      <h3>{translate(getLocale(), 'ruleGuide.headings.ending')}</h3>
      <ul>
        {#each guide.ending as item (item.key)}<li>{t(item)}</li>{/each}
      </ul>
    </section>
    {#if match.rulesSnapshot.gameId === 'petanque'}
      <section>
        <h3>{messages.petanque.roster}</h3>
        <ul class="team-members">
          {#each petanqueSides(match) as team (team.id)}<li>
              <strong>{team.name}</strong><span
                >{team.playerIds
                  .map(
                    (id) =>
                      match.playersSnapshot.find((player) => player.id === id)?.displayName ?? id,
                  )
                  .join(' · ')}</span
              >
            </li>{/each}
        </ul>
      </section>
    {/if}
    <footer class="rule-sources">
      <h3>{translate(getLocale(), 'ruleGuide.headings.sources')}</h3>
      {#if guide.sources.length}
        <ul>
          {#each guide.sources as source (source.key)}<li>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer external"
                referrerpolicy="no-referrer"
                >{translate(getLocale(), `ruleGuide.sources.${source.key}`)}<span class="sr-only">
                  · {translate(getLocale(), 'ruleGuide.external')}</span
                ></a
              >
            </li>{/each}
        </ul>
        <p class="source-note">
          {translate(getLocale(), 'ruleGuide.reviewed', {
            date: new Intl.DateTimeFormat(getLocale(), {
              dateStyle: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${RULES_REVIEWED_AT}T00:00:00Z`)),
          })}
        </p>
        <p class="source-note">{translate(getLocale(), 'ruleGuide.offline')}</p>
      {:else}<p>{translate(getLocale(), 'ruleGuide.customSource')}</p>{/if}
    </footer>
  </div>
</details>

<style>
  summary h2 {
    margin: 0;
    font: inherit;
  }
  .rule-content {
    display: grid;
    gap: var(--space-5);
    padding-block: var(--space-4);
    line-height: 1.6;
  }
  section,
  .rule-sources {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  h3 {
    margin: 0;
    color: var(--muted-text);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  p,
  ul,
  ol {
    margin: 0;
  }
  ul,
  ol {
    display: grid;
    gap: var(--space-2);
    padding-inline-start: 1.3rem;
  }
  ol {
    list-style-type: decimal;
  }
  ul {
    list-style-type: disc;
  }
  li::marker {
    color: var(--accent);
    font-weight: 600;
  }
  li {
    padding-inline-start: var(--space-1);
  }
  .rule-goal {
    font-weight: 600;
  }
  table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: var(--space-2) var(--space-3);
    text-align: start;
    vertical-align: top;
    overflow-wrap: anywhere;
    border-bottom: 1px solid var(--border);
  }
  thead {
    background: var(--soft);
    color: var(--muted-text);
    font-size: 0.75rem;
  }
  th {
    font-weight: 600;
  }
  th:first-child {
    width: 44%;
  }
  .rule-sources {
    border-top: 1px solid var(--border);
    padding-block-start: var(--space-4);
  }
  .rule-sources a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    overflow-wrap: anywhere;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .source-note {
    color: var(--muted-text);
    font-size: 0.8rem;
  }
  @media (max-width: 480px) {
    th,
    td {
      padding-inline: var(--space-2);
    }
  }
</style>
