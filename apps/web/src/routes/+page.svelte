<script lang="ts">
  import { onMount } from "svelte";

  type ValidationReport = { checkedAt: string; errors: string[]; warnings: string[] } | null;
  type Repository = {
    id: string;
    name: string;
    sshUrl: string;
    validationStatus: "PENDING" | "VALID" | "INVALID";
    lastSyncedSha: string | null;
    presetRelatedRepoIds: string[];
    lastUsedRelatedRepoIds: string[];
    validationReport: ValidationReport;
    presetText: string;
    lastUsedText: string;
  };

  let repositories: Repository[] = $state([]);
  let sshUrl = $state("");
  let presetText = $state("");
  let message = $state("");
  let error = $state("");
  let loading = $state(true);
  let busy = $state(false);

  function toRepository(value: Omit<Repository, "presetText" | "lastUsedText">): Repository {
    return {
      ...value,
      presetText: value.presetRelatedRepoIds.join("\n"),
      lastUsedText: value.lastUsedRelatedRepoIds.join("\n"),
    };
  }

  function parseIds(value: string): string[] {
    return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
  }

  async function request(url: string, init?: RequestInit): Promise<any> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Request failed");
    return body;
  }

  async function loadRepositories() {
    loading = true;
    try {
      const body = await request("/api/repositories");
      repositories = body.repositories.map(toRepository);
      error = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to load repositories";
    } finally {
      loading = false;
    }
  }

  async function addRepository() {
    busy = true;
    message = "";
    error = "";
    try {
      await request("/api/repositories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sshUrl, presetRelatedRepoIds: parseIds(presetText) }),
      });
      sshUrl = "";
      presetText = "";
      message = "Repository added and validation queued.";
      await loadRepositories();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to add repository";
    } finally {
      busy = false;
    }
  }

  async function saveRepository(repository: Repository) {
    busy = true;
    message = "";
    error = "";
    try {
      await request(`/api/repositories/${repository.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sshUrl: repository.sshUrl,
          presetRelatedRepoIds: parseIds(repository.presetText),
          lastUsedRelatedRepoIds: parseIds(repository.lastUsedText),
        }),
      });
      message = "Repository settings saved.";
      await loadRepositories();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to save repository";
    } finally {
      busy = false;
    }
  }

  async function revalidateRepository(repository: Repository) {
    busy = true;
    message = "";
    error = "";
    try {
      await request(`/api/repositories/${repository.id}/revalidate`, { method: "POST" });
      message = "Validation queued.";
      await loadRepositories();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to queue validation";
    } finally {
      busy = false;
    }
  }

  async function removeRepository(repository: Repository) {
    if (!window.confirm(`Remove ${repository.name}? The local checkout is kept.`)) return;
    busy = true;
    message = "";
    error = "";
    try {
      await request(`/api/repositories/${repository.id}`, { method: "DELETE" });
      message = "Repository removed.";
      await loadRepositories();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to remove repository";
    } finally {
      busy = false;
    }
  }

  onMount(loadRepositories);
</script>

<svelte:head>
  <title>Repositories · Task Lane</title>
</svelte:head>

<main class="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-12">
  <header class="space-y-2">
    <p class="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">Task Lane</p>
    <h1 class="text-4xl font-semibold tracking-tight">Repositories</h1>
    <p class="max-w-2xl text-muted-foreground">
      Register the repositories available to planning. Related repositories are suggestions only and are never attached automatically.
    </p>
  </header>

  {#if message}<p class="rounded-md bg-green-100 px-4 py-3 text-sm text-green-900">{message}</p>{/if}
  {#if error}<p class="rounded-md bg-red-100 px-4 py-3 text-sm text-red-900">{error}</p>{/if}

  <section class="rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="add-repository-heading">
    <h2 id="add-repository-heading" class="text-xl font-semibold">Add repository</h2>
    <form class="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onsubmit={(event) => { event.preventDefault(); void addRepository(); }}>
      <label class="grid gap-2 text-sm font-medium">
        GitHub SSH URL
        <input class="rounded-md border bg-background px-3 py-2 font-mono text-sm" bind:value={sshUrl} placeholder="git@github.com:owner/repository.git" required />
      </label>
      <label class="grid gap-2 text-sm font-medium">
        Preset related repositories
        <textarea class="min-h-10 rounded-md border bg-background px-3 py-2 text-sm" bind:value={presetText} placeholder="One repository ID per line"></textarea>
      </label>
      <button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy} type="submit">Add</button>
    </form>
  </section>

  <section class="space-y-4" aria-labelledby="registered-repositories-heading">
    <div class="flex items-center justify-between">
      <h2 id="registered-repositories-heading" class="text-xl font-semibold">Registered repositories</h2>
      <span class="text-sm text-muted-foreground">{repositories.length} total</span>
    </div>

    {#if loading}
      <p class="rounded-xl border bg-card p-6 text-muted-foreground">Loading repositories…</p>
    {:else if repositories.length === 0}
      <p class="rounded-xl border bg-card p-6 text-muted-foreground">No repositories registered yet.</p>
    {:else}
      {#each repositories as repository (repository.id)}
        <article class="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">{repository.name}</h3>
              <p class="font-mono text-sm text-muted-foreground">{repository.id}</p>
            </div>
            <span class="rounded-full px-3 py-1 text-xs font-semibold {repository.validationStatus === 'VALID' ? 'bg-green-100 text-green-900' : repository.validationStatus === 'INVALID' ? 'bg-red-100 text-red-900' : 'bg-yellow-100 text-yellow-900'}">
              {repository.validationStatus}
            </span>
          </div>

          <div class="grid gap-4 md:grid-cols-3">
            <label class="grid gap-2 text-sm font-medium md:col-span-3">
              GitHub SSH URL
              <input class="rounded-md border bg-background px-3 py-2 font-mono text-sm" bind:value={repository.sshUrl} />
            </label>
            <label class="grid gap-2 text-sm font-medium">
              Preset suggestions
              <textarea class="min-h-24 rounded-md border bg-background px-3 py-2 text-sm" bind:value={repository.presetText}></textarea>
            </label>
            <label class="grid gap-2 text-sm font-medium">
              Last-used suggestions
              <textarea class="min-h-24 rounded-md border bg-background px-3 py-2 text-sm" bind:value={repository.lastUsedText}></textarea>
            </label>
            <div class="space-y-2 text-sm text-muted-foreground">
              <p>Last synced SHA: <code>{repository.lastSyncedSha ?? "—"}</code></p>
              <p>Suggestions require explicit selection by the planning workflow.</p>
            </div>
          </div>

          {#if repository.validationReport}
            <div class="rounded-md bg-muted p-4 text-sm">
              <p class="font-medium">Validation report · {repository.validationReport.checkedAt}</p>
              {#if repository.validationReport.errors.length}
                <ul class="mt-2 list-disc space-y-1 pl-5 text-red-800">
                  {#each repository.validationReport.errors as validationError}
                    <li>{validationError}</li>
                  {/each}
                </ul>
              {:else}
                <p class="mt-2 text-green-800">All required plan-feature files are present.</p>
              {/if}
            </div>
          {/if}

          <div class="flex flex-wrap gap-2">
            <button class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy} onclick={() => void saveRepository(repository)}>Save</button>
            <button class="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50" disabled={busy} onclick={() => void revalidateRepository(repository)}>Revalidate</button>
            <button class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-800 disabled:opacity-50" disabled={busy} onclick={() => void removeRepository(repository)}>Remove</button>
          </div>
        </article>
      {/each}
    {/if}
  </section>
</main>
