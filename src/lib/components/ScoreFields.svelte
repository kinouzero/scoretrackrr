<script lang="ts">
  import Icon from '#lib/components/Icon.svelte';
  import type { InputField } from '#lib/domain/engine/types';
  import { messages } from '#lib/i18n/index';
  let {
    fields,
    owners,
    ownerId = $bindable(''),
    values = $bindable<Record<string, number>>({}),
    prefix,
    disabled = false,
  }: {
    fields: readonly InputField[];
    owners: readonly { id: string; name: string }[];
    ownerId?: string;
    values?: Record<string, number>;
    prefix: string;
    disabled?: boolean;
  } = $props();
  function adjust(field: InputField, delta: number) {
    values = {
      ...values,
      [field.id]: Math.max(field.minimum, Math.min(field.maximum, (values[field.id] ?? 0) + delta)),
    };
  }
</script>

<fieldset class="editor-fields" {disabled}>
  <legend>{messages.generic.entry}</legend>
  <div class="game-field">
    <label for={`${prefix}-owner`}>{messages.petanque.scoringTeam}</label><select
      id={`${prefix}-owner`}
      bind:value={ownerId}
      required
    >
      <option value="">{messages.petanque.chooseOption}</option
      >{#each owners as owner (owner.id)}<option value={owner.id}>{owner.name}</option
        >{/each}</select
    >
  </div>
  {#each fields as field (field.id)}
    <div class="game-field">
      <label for={`${prefix}-${field.id}`}
        >{field.id === 'points' ? messages.generic.points : field.id}</label
      >
      <div class="numeric-entry">
        <button
          class="button secondary"
          type="button"
          aria-label={messages.generic.decrease(field.id)}
          onclick={() => adjust(field, -1)}><Icon name="minus" size={18} /></button
        >
        <input
          id={`${prefix}-${field.id}`}
          type="number"
          min={field.minimum}
          max={field.maximum}
          step={field.integer ? 1 : 'any'}
          bind:value={values[field.id]}
          required
        />
        <button
          class="button secondary"
          type="button"
          aria-label={messages.generic.increase(field.id)}
          onclick={() => adjust(field, 1)}><Icon name="plus" size={18} /></button
        >
      </div>
    </div>
  {/each}
</fieldset>

<style>
  .numeric-entry {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) 48px;
    gap: var(--space-2);
  }
  .numeric-entry button {
    padding: 0.5rem;
  }
</style>
