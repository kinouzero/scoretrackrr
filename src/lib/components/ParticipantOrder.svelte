<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import { messages } from '#lib/i18n/index';
  import { moveParticipant, shuffleParticipants } from '#lib/application/participant-order';
  let {
    items,
    onchange,
  }: { items: { id: string; name: string }[]; onchange: (ids: string[]) => void } = $props();
</script>

{#if items.length > 1}
  <fieldset class="participant-order">
    <legend>{messages.play.order}</legend>
    <p class="field-hint">{messages.play.orderHint}</p>
    <ol>
      {#each items as item, index (item.id)}
        <li>
          <span><small>{index + 1}</small>{item.name}</span>
          <div>
            <button
              type="button"
              class="button secondary icon-button"
              aria-label={messages.play.moveUp(item.name)}
              disabled={index === 0}
              onclick={() => onchange(moveParticipant(items, index, -1).map((item) => item.id))}
              ><Icon name="chevron-up" /></button
            >
            <button
              type="button"
              class="button secondary icon-button"
              aria-label={messages.play.moveDown(item.name)}
              disabled={index === items.length - 1}
              onclick={() => onchange(moveParticipant(items, index, 1).map((item) => item.id))}
              ><Icon name="chevron-down" /></button
            >
          </div>
        </li>
      {/each}
    </ol>
    <button
      class="button secondary"
      type="button"
      onclick={() => onchange(shuffleParticipants(items).map((item) => item.id))}
      ><Icon name="shuffle" />{messages.play.shuffle}</button
    >
  </fieldset>
{/if}
