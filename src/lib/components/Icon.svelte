<script lang="ts">
  import { iconPaths, type IconName } from './icons';
  let {
    name,
    size = 20,
    filled = false,
  }: { name: IconName; size?: number | string; filled?: boolean } = $props();
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"><path d={iconPaths[name]} /></svg
>

<style>
  svg {
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
  }
</style>
