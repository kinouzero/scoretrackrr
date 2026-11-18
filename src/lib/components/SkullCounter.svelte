<script lang="ts">
  import Icon from './Icon.svelte';
  import { messages } from '#lib/i18n/index';
  let {
    id,
    label,
    value,
    maximum,
    disabled = false,
    onchange,
  }: {
    id: string;
    label: string;
    value: number;
    maximum: number;
    disabled?: boolean;
    onchange: (value: number) => void;
  } = $props();
</script>

<div class="stepper">
  <button
    type="button"
    aria-label={messages.skull.decrease(label)}
    disabled={disabled || value <= 0}
    onclick={() => onchange(Math.max(0, value - 1))}><Icon name="minus" size={18} /></button
  >
  <output {id} aria-label={label}><strong>{value}</strong><small> / {maximum}</small></output>
  <button
    type="button"
    aria-label={messages.skull.increase(label)}
    disabled={disabled || value >= maximum}
    onclick={() => onchange(Math.min(maximum, value + 1))}><Icon name="plus" size={18} /></button
  >
</div>

<style>
  .stepper {
    display: grid;
    grid-template-columns: 44px minmax(44px, 1fr) 44px;
    gap: var(--space-2);
    align-items: center;
  }
  button {
    min-height: 44px;
    display: grid;
    place-items: center;
    border: 1px solid var(--input-border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  output {
    text-align: center;
    min-height: 44px;
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0.5rem 0;
    font-variant-numeric: tabular-nums;
  }
  strong {
    font-size: 1.25rem;
    color: var(--text);
  }
  small {
    color: var(--muted-text);
  }
</style>
