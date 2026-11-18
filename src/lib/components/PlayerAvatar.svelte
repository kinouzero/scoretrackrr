<script lang="ts">
  import Icon from './Icon.svelte';
  import { playerInitials, type PlayerProfileInput } from '#lib/domain/players';
  let { profile }: { profile: PlayerProfileInput } = $props();
  let failedImage = $state<string>();
  const avatar = $derived(profile.avatar ?? 'initials');
</script>

<span class="player-avatar" style:border-color={profile.color} aria-hidden="true">
  {#if avatar === 'gravatar' && profile.avatarImage && failedImage !== profile.avatarImage}
    <img
      src={profile.avatarImage}
      alt=""
      width="48"
      height="48"
      onerror={() => {
        failedImage = profile.avatarImage;
      }}
    />
  {:else if avatar !== 'initials' && avatar !== 'gravatar'}
    <Icon name={avatar} size="1.2em" />
  {:else}
    {playerInitials(profile.displayName) || '·'}
  {/if}
</span>
