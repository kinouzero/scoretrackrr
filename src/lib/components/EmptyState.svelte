<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  let { icon, title, detail }: { icon: IconName; title: string; detail: string } = $props();
</script>

<section class="empty-state panel">
  <span class="empty-symbol"><Icon name={icon} size={48} /></span>
  <h2>{title}</h2>
  <p>{detail}</p>
</section>
