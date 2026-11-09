<script lang="ts">
	// Self-hosted fonts: bundled into the build so the dashboard never calls a font CDN.
	import '@fontsource-variable/fraunces/opsz.css';
	import '@fontsource/ibm-plex-sans/400.css';
	import '@fontsource/ibm-plex-sans/500.css';
	import '@fontsource/ibm-plex-sans/600.css';
	import '@fontsource/ibm-plex-mono/400.css';
	import '@fontsource/ibm-plex-mono/500.css';
	import '@fontsource/ibm-plex-mono/600.css';
	import '../app.css';
	let { children } = $props();
</script>

{@render children()}
