<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  let { game }: { game: string } = $props();
  const icons: Record<string, IconName> = {
    skyjo: 'cards',
    belote: 'cards',
    tarot: 'cards',
    rummy: 'cards',
    uno: 'cards',
    qwixx: 'dice',
    clever: 'dice',
    petanque: 'petanque',
    yams: 'dice',
    '421': 'four-21',
    '5000-10000': 'farkle',
    darts: 'darts',
    'skull-king': 'skull-king',
    'flip-7': 'cards',
    molkky: 'molkky',
    '6-qui-prend': 'six-nimmt',
    'times-up': 'times-up',
  };
</script>

<Icon name={icons[game] ?? 'games'} size="100%" />
