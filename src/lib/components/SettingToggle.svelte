<script lang="ts">
  let {
    label,
    hint,
    checked,
    disabled = false,
    onchange,
  }: {
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
  } = $props();
</script>

<label class="setting-toggle">
  <span
    ><strong>{label}</strong>{#if hint}<span class="field-hint">{hint}</span>{/if}</span
  >
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    aria-label={label}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
</label>
