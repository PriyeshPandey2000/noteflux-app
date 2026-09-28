<script lang="ts">
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import { SettingsIcon } from '@lucide/svelte';
	import { invoke } from '@tauri-apps/api/core';
</script>

<svelte:head>
	<title>MacOS Accessibility</title>
</svelte:head>

<main class="flex flex-1 items-center justify-center">
	<Card.Root class="w-full max-w-2xl">
		<Card.Header>
			<Card.Title class="text-xl">MacOS Accessibility</Card.Title>
			<Card.Description class="leading-7">
				Follow the steps below to re-enable NoteFlux in your MacOS
				Accessibility settings. This often is needed after installing a new
				version of NoteFlux to get pasting to work, as detailed in this
				<Button
					variant="link"
					size="inline"
					href="https://github.com/enigo-rs/enigo/issues/174"
					target="_blank"
					rel="noopener noreferrer">Github issue</Button
				> for the
				<code
					class="bg-muted relative rounded px-[0.3rem] py-[0.15rem] font-mono text-sm font-semibold"
				>
					enigo
				</code> crate.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-col items-center gap-2">
				<!-- TODO: add our own walkthrough video/asset here -->
				<ol
					class="text-muted-foreground list-inside list-decimal space-y-1 text-sm leading-7"
				>
					<li>
						Go to <span class="text-primary font-semibold tracking-tight">
							System Preferences > Privacy & Security > Accessibility
						</span> or click the button below.
					</li>

					<li>
						Click on <span class="text-primary font-semibold tracking-tight"
							>🎙️ NoteFlux</span
						> and remove it using the minus icon (-).
					</li>
					<li>
						Re-add NoteFlux by pressing the plus icon (+) and selecting <span
							class="text-primary font-semibold tracking-tight"
							>🎙️ NoteFlux.app</span
						>
					</li>
				</ol>
			</div>
		</Card.Content>
		<Card.Footer>
			<Button
				onclick={() => invoke('open_apple_accessibility')}
				variant="default"
				size="sm"
				class="w-full text-sm"
			>
				<SettingsIcon class="mr-2 size-4" />
				Open MacOS Accessibility Settings
			</Button>
		</Card.Footer>
	</Card.Root>
</main>
