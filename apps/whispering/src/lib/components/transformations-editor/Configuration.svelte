<script lang="ts">
	import type { Transformation } from '$lib/services/db';

	import {
		LabeledInput,
		LabeledSelect,
		LabeledSwitch,
		LabeledTextarea,
	} from '$lib/components/labeled/index.js';
	import NoteFluxButton from '$lib/components/NoteFluxButton.svelte';
	import {
		AnthropicApiKeyInput,
		GoogleApiKeyInput,
		GroqApiKeyInput,
		OpenAiApiKeyInput,
	} from '$lib/components/settings';
	import {
		TRANSFORMATION_STEP_TYPES,
		TRANSFORMATION_STEP_TYPES_TO_LABELS,
	} from '$lib/constants/database';
	import {
		ANTHROPIC_INFERENCE_MODEL_OPTIONS,
		GOOGLE_INFERENCE_MODEL_OPTIONS,
		GROQ_INFERENCE_MODEL_OPTIONS,
		INFERENCE_PROVIDER_OPTIONS,
		OPENAI_INFERENCE_MODEL_OPTIONS,
	} from '$lib/constants/inference';
	import { generateDefaultTransformationStep } from '$lib/services/db';
	import { TrashIcon } from '$lib/components/icons';
	import * as Accordion from '$lib/ui/accordion';
	import * as Alert from '$lib/ui/alert';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import * as SectionHeader from '$lib/ui/section-header';
	import { Separator } from '$lib/ui/separator';
	import { CopyIcon, PlusIcon } from '@lucide/svelte';
	import { slide } from 'svelte/transition';

	let { transformation = $bindable() }: { transformation: Transformation } =
		$props();

	function addStep() {
		transformation = {
			...transformation,
			steps: [...transformation.steps, generateDefaultTransformationStep()],
		};
	}

	function removeStep(index: number) {
		transformation = {
			...transformation,
			steps: transformation.steps.filter((_, i) => i !== index),
		};
	}

	function duplicateStep(index: number) {
		const stepToDuplicate = transformation.steps[index];
		const duplicatedStep = { ...stepToDuplicate, id: crypto.randomUUID() };
		transformation = {
			...transformation,
			steps: [
				...transformation.steps.slice(0, index + 1),
				duplicatedStep,
				...transformation.steps.slice(index + 1),
			],
		};
	}
</script>

<div class="flex flex-col gap-6 overflow-y-auto h-full px-2">
	<SectionHeader.Root>
		<SectionHeader.Title>Configuration</SectionHeader.Title>
		<SectionHeader.Description>
			Configure the title, description, and steps for how your transformation
			will process your text
		</SectionHeader.Description>
	</SectionHeader.Root>

	<Separator />

	<section class="space-y-4">
		<LabeledInput
			id="title"
			label="Title"
			value={transformation.title}
			oninput={(e) => {
				transformation = {
					...transformation,
					title: e.currentTarget.value,
				};
			}}
			placeholder="e.g., Format Meeting Notes"
			description="A clear, concise name that describes what this transformation does"
		/>
		<LabeledTextarea
			id="description"
			label="Description"
			value={transformation.description}
			oninput={(e) => {
				transformation = {
					...transformation,
					description: e.currentTarget.value,
				};
			}}
			placeholder="e.g., Converts meeting transcripts into bullet points and highlights action items"
			description="Describe what this transformation does, its purpose, and how it will be used"
		/>
	</section>

	<Separator />

	<section class="space-y-6">
		<h3 class="font-medium">Processing Steps</h3>
		{#if transformation.steps.length === 0}
			<Alert.Root variant="warning">
				<Alert.Title>Add your first processing step</Alert.Title>
				<Alert.Description>
					Each step will process your transcribed text in sequence. Start by
					adding a step below to define how your text should be transformed.
				</Alert.Description>
			</Alert.Root>
		{/if}

		<div class="space-y-4">
			{#each transformation.steps as step, index (index)}
				<div
					class="bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm"
					transition:slide
				>
					<Card.Header class="space-y-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<Card.Title class="text-xl">
									Step {index + 1}:
								</Card.Title>
								<LabeledSelect
									id="step-type"
									label="Type"
									selected={step.type}
									items={TRANSFORMATION_STEP_TYPES.map(
										(type) =>
											({
												label: TRANSFORMATION_STEP_TYPES_TO_LABELS[type],
												value: type,
											}) as const,
									)}
									onSelectedChange={(value) => {
										transformation = {
											...transformation,
											steps: transformation.steps.map((s, i) =>
												i === index ? { ...s, type: value } : s,
											),
										};
									}}
									hideLabel
									class="h-8"
									placeholder="Select a step type"
								/>
							</div>
							<div class="flex items-center gap-2">
								<NoteFluxButton
									tooltipContent="Duplicate step"
									variant="ghost"
									size="icon"
									class="size-8"
									onclick={() => duplicateStep(index)}
								>
									<CopyIcon class="size-4" />
								</NoteFluxButton>
								<NoteFluxButton
									tooltipContent="Delete step"
									variant="ghost"
									size="icon"
									class="size-8"
									onclick={() => removeStep(index)}
								>
									<TrashIcon class="size-4" />
								</NoteFluxButton>
							</div>
						</div>
					</Card.Header>
					<Card.Content>
						{#if step.type === 'find_replace'}
							<div class="space-y-6">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
									<LabeledInput
										id="find_replace.findText"
										label="Find Text"
										value={step['find_replace.findText']}
										oninput={(e) => {
											transformation = {
												...transformation,
												steps: transformation.steps.map((s, i) =>
													i === index
														? {
																...s,
																'find_replace.findText': e.currentTarget.value,
															}
														: s,
												),
											};
										}}
										placeholder="Text or pattern to search for in the transcript"
									/>
									<LabeledInput
										id="find_replace.replaceText"
										label="Replace Text"
										value={step['find_replace.replaceText']}
										oninput={(e) => {
											transformation = {
												...transformation,
												steps: transformation.steps.map((s, i) =>
													i === index
														? {
																...s,
																'find_replace.replaceText':
																	e.currentTarget.value,
															}
														: s,
												),
											};
										}}
										placeholder="Text to use as the replacement"
									/>
								</div>
								<Accordion.Root type="single" class="w-full">
									<Accordion.Item class="border-none" value="advanced">
										<Accordion.Trigger class="text-sm">
											Advanced Options
										</Accordion.Trigger>
										<Accordion.Content>
											<LabeledSwitch
												id="find_replace.useRegex"
												label="Use Regex"
												checked={step['find_replace.useRegex']}
												onCheckedChange={(v) => {
													transformation = {
														...transformation,
														steps: transformation.steps.map((s, i) =>
															i === index
																? {
																		...s,
																		'find_replace.useRegex': v,
																	}
																: s,
														),
													};
												}}
												description="Enable advanced pattern matching using regular expressions (for power users)"
											/>
										</Accordion.Content>
									</Accordion.Item>
								</Accordion.Root>
							</div>
						{:else if step.type === 'prompt_transform'}
							<div class="space-y-6">
								{#snippet groqModelOption({ item }: { item: (typeof GROQ_INFERENCE_MODEL_OPTIONS)[number] })}
									<div class="flex items-center gap-2">
										{#if item.icon}
											{@const Icon = item.icon}
											<Icon class="size-4 text-muted-foreground" />
										{/if}
										<span>{item.label}</span>
									</div>
								{/snippet}
								<div class="grid grid-cols-1 gap-4">
									<LabeledSelect
										id="prompt_transform.inference.provider.Groq.model"
										label="Quality"
										items={GROQ_INFERENCE_MODEL_OPTIONS}
										renderOption={groqModelOption}
										selected={step[
											'prompt_transform.inference.provider.Groq.model'
										]}
										placeholder="Select quality level"
										onSelectedChange={(value) => {
											transformation = {
												...transformation,
												steps: transformation.steps.map((s, i) =>
													i === index
														? {
																...s,
																'prompt_transform.inference.provider': 'Groq',
																'prompt_transform.inference.provider.Groq.model':
																	value,
															}
														: s,
												),
											};
										}}
									/>
								</div>

								<LabeledTextarea
									id="prompt_transform.systemPromptTemplate"
									label="The AI's Role"
									value={step['prompt_transform.systemPromptTemplate']}
									oninput={(e) => {
										transformation = {
											...transformation,
											steps: transformation.steps.map((s, i) =>
												i === index
													? {
															...s,
															'prompt_transform.systemPromptTemplate':
																e.currentTarget.value,
														}
													: s,
											),
										};
									}}
									placeholder="You are a professional editor. Be clear and concise."
									description="Who is the AI pretending to be? (e.g., A friendly editor, a strict lawyer)"
								/>
								<LabeledTextarea
									id="prompt_transform.userPromptTemplate"
									label="What to do with your text"
									value={step['prompt_transform.userPromptTemplate']}
									oninput={(e) => {
										transformation = {
											...transformation,
											steps: transformation.steps.map((s, i) =>
												i === index
													? {
															...s,
															'prompt_transform.userPromptTemplate':
																e.currentTarget.value,
														}
													: s,
											),
										};
									}}
								>
									{#snippet description()}
										<p class="text-sm text-muted-foreground">
											Edit the prompt below according to your use case. Don't remove
											the {'{{input}}'} part - it is the actual transcript you
											record {index > 0 ? 'or output from the previous step' : ''}.
										</p>
										{#if step['prompt_transform.userPromptTemplate'] && !step['prompt_transform.userPromptTemplate'].includes('{{input}}')}
											<p class="text-amber-500 text-sm font-semibold mt-1">
												Remember to include {'{{input}}'} in your prompt - this is
												where your text will be inserted!
											</p>
										{/if}
									{/snippet}
								</LabeledTextarea>
								<!-- COMMENTED OUT: API key configuration for SaaS model -->
								<!-- <Accordion.Root type="single" class="w-full">
									<Accordion.Item class="border-none" value="advanced">
										<Accordion.Trigger class="text-sm">
											Advanced Options
										</Accordion.Trigger>
										<Accordion.Content>
											{#if step['prompt_transform.inference.provider'] === 'OpenAI'}
												<OpenAiApiKeyInput />
											{:else if step['prompt_transform.inference.provider'] === 'Groq'}
												<GroqApiKeyInput />
											{:else if step['prompt_transform.inference.provider'] === 'Anthropic'}
												<AnthropicApiKeyInput />
											{:else if step['prompt_transform.inference.provider'] === 'Google'}
												<GoogleApiKeyInput />
											{/if}
										</Accordion.Content>
									</Accordion.Item>
								</Accordion.Root> -->
							</div>
						{/if}
					</Card.Content>
				</div>
			{/each}
		</div>

		<Button
			onclick={addStep}
			variant={transformation.steps.length === 0 ? 'default' : 'outline'}
			class="w-full"
		>
			<PlusIcon class="mr-2 size-4" />
			{transformation.steps.length === 0
				? 'Add Your First Step'
				: 'Add Another Step'}
		</Button>
	</section>
</div>
