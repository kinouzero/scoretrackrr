<script lang="ts">
  import type { TeamProfileInput } from '#lib/domain/teams';
  import Icon from './Icon.svelte';
  import { playerInitials } from '#lib/domain/players';
  let { team }: { team: TeamProfileInput } = $props();
</script>

<span class="player-avatar" style:border-color={team.color} aria-hidden="true"
  >{#if team.avatar && team.avatar !== 'initials'}<Icon
      name={team.avatar === 'boules' ? 'petanque' : team.avatar}
      size="1.2em"
    />{:else}{playerInitials(team.name) || '·'}{/if}</span
>
