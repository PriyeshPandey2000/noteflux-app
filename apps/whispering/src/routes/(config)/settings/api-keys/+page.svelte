<script lang="ts">
	import {
		// COMMENTED OUT: BYOK API key inputs - using only Groq for SaaS model
		// AnthropicApiKeyInput,
		// ElevenLabsApiKeyInput,
		// GoogleApiKeyInput,
		GroqApiKeyInput,
		// OpenAiApiKeyInput,
	} from '$lib/components/settings';
	import { Separator } from '$lib/ui/separator';
</script>

<svelte:head>
	<title>API Keys - NoteFlux</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h3 class="text-lg font-medium">API Keys</h3>
		<p class="text-muted-foreground text-sm">
			Configure your API keys for NoteFlux.
		</p>
	</div>
	<Separator />

	<!-- COMMENTED OUT: BYOK API key inputs - using only Groq for SaaS model -->
	<!-- <OpenAiApiKeyInput /> -->
	<!-- <AnthropicApiKeyInput /> -->
	
	<GroqApiKeyInput />
	
	<!-- <GoogleApiKeyInput /> -->
	<!-- <ElevenLabsApiKeyInput /> -->
</div>
