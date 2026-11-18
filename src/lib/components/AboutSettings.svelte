<script lang="ts">
  import { onDestroy } from 'svelte';
  import Icon from './Icon.svelte';
  import { messages, getLocale } from '#lib/i18n/index';
  import { appVersion, repositoryUrl, technologies } from '#lib/application/app-info';
  import {
    checkGithubRelease,
    ReleaseCheckError,
    type ReleaseCheckResult,
    type ReleaseCheckFailure,
  } from '#lib/application/github-release';
  let checking = $state(false);
  let result = $state.raw<ReleaseCheckResult>();
  let error = $state<ReleaseCheckFailure | ''>('');
  let checkedAt = $state<Date>();
  let controller: AbortController | undefined;
  let disposed = false;
  const dateFormat = $derived(
    new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }),
  );
  onDestroy(() => {
    disposed = true;
    controller?.abort();
  });
  async function check() {
    if (checking) return;
    error = '';
    if (!navigator.onLine) {
      error = 'offline';
      return;
    }
    checking = true;
    controller = new AbortController();
    try {
      const latest = await checkGithubRelease(appVersion, controller.signal);
      if (disposed) return;
      result = latest;
      checkedAt = new Date();
    } catch (failure) {
      if (!disposed) error = failure instanceof ReleaseCheckError ? failure.code : 'unavailable';
    } finally {
      controller = undefined;
      if (!disposed) checking = false;
    }
  }
</script>

<section class="panel settings-panel" aria-labelledby="about-title">
  <h2 id="about-title">{messages.about.title}</h2>
  <p>{messages.about.intro}</p>
  <p><span class="badge">{messages.about.version(appVersion)}</span></p>
  <div class="about-actions">
    <a
      class="button secondary"
      href={repositoryUrl}
      target="_blank"
      rel="noopener noreferrer external"
      referrerpolicy="no-referrer"><Icon name="globe" />{messages.about.github}</a
    >
  </div>
  <div class="about-section">
    <h3>{messages.about.technologies}</h3>
    <ul class="about-technologies" aria-label={messages.about.technologies}>
      {#each technologies as technology (technology)}<li class="badge">
          {messages.about.stack[technology]}
        </li>{/each}
    </ul>
  </div>
  <div class="about-section">
    <h3>{messages.about.releases}</h3>
    <p class="field-hint">{messages.about.checkHint}</p>
    <div class="about-actions">
      <button class="button secondary" disabled={checking} onclick={check}
        ><Icon name="replay" />{checking ? messages.about.checking : messages.about.check}</button
      >
    </div>
    <div class="release-result" aria-live="polite" aria-atomic="true">
      {#if result}
        {#if result.status === 'none'}<p>{messages.about.noRelease}</p>{:else}
          <p class:available={result.status === 'available'}>
            {messages.about.results[result.status](result.release.tag)}
          </p>
          <p class="field-hint">
            {messages.about.published(dateFormat.format(new Date(result.release.publishedAt)))}
          </p>
          <a
            class="button secondary"
            href={result.release.url}
            target="_blank"
            rel="noopener noreferrer external"
            referrerpolicy="no-referrer"><Icon name="arrow-right" />{messages.about.viewRelease}</a
          >
        {/if}
        {#if checkedAt}<p class="field-hint">
            {messages.about.checked(dateFormat.format(checkedAt))}
          </p>{/if}
      {/if}
    </div>
    {#if error}<p class="error" role="alert">{messages.about.errors[error]}</p>{/if}
  </div>
</section>

<style>
  .about-section,
  .release-result:not(:empty) {
    display: grid;
    gap: var(--space-3);
  }
  .about-section h3,
  .about-section p {
    margin: 0;
  }
  h3 {
    font-size: 1rem;
    font-weight: 650;
  }
  .about-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .about-technologies {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .available {
    font-weight: 650;
    color: var(--success);
  }
  .release-result > a {
    justify-self: start;
  }
</style>
