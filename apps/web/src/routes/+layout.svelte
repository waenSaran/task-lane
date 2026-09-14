<script lang="ts">
  import "../app.css";

  let { children } = $props();
</script>

<svelte:head>
  <title>Task Lane</title>
  <meta
    name="description"
    content="Local planning orchestration for Plane and /plan-feature"
  />
</svelte:head>

{@render children()}
