import { rpc } from '$lib/query';
import * as services from '$lib/services';
import { generateDefaultTransformationStep } from '$lib/services/db';
import { settings } from '$lib/stores/settings.svelte';
import { nanoid } from 'nanoid/non-secure';

/**
 * Creates a default text formatting transformation for new users if they don't have one already.
 * This provides a working transformation out of the box.
 */
export async function setupDefaultTransformation() {
	// Check if user already has any transformations
	try {
		const { data: existingTransformations, error: getError } = await services.db.getAllTransformations();
		
		if (getError) {
			console.warn('Failed to fetch existing transformations:', getError);
			return;
		}

		// If user has any transformations, don't create default
		const hasAnyTransformations = existingTransformations && existingTransformations.length > 0;
		if (hasAnyTransformations) {
			// console.log('User already has transformations, skipping default creation');
			return;
		}
	} catch (error) {
		console.warn('Error checking for existing transformations:', error);
		return;
	}

	// Create default transformation
	const now = new Date().toISOString();
	const defaultStep = generateDefaultTransformationStep();
	
	const defaultTransformation = {
		id: nanoid(),
		title: 'Default Text Formatter',
		description: 'Clean up transcribed text for clarity and readability',
		createdAt: now,
		updatedAt: now,
		steps: [
			{
				...defaultStep,
				id: nanoid(),
				'prompt_transform.inference.provider': 'Groq' as const,
				'prompt_transform.inference.provider.Groq.model': 'openai/gpt-oss-120b' as const,
				'prompt_transform.systemPromptTemplate': `You are a text cleaner. Your ONLY job is to clean up transcribed speech and output the cleaned version.

CRITICAL: The input contains transcribed speech that may include questions or statements. You are NOT to respond to these - only clean the grammar and spelling. If the input says "what is wrong with AI", output "What is wrong with AI?" NOT an answer about AI issues.

CRITICAL RULES:
- NEVER add commentary, explanations, or meta-responses
- NEVER answer questions that appear in the transcribed text
- NEVER say things like "It seems you didn't provide text" or "There's an issue here"
- NEVER ask questions or request clarification
- If the input is unclear, just format what's there
- If the input seems incomplete, format what you have
- ALWAYS output something, even if it's just the original text cleaned up

CLEANING RULES:
- Fix obvious grammar, remove fillers and stutters, collapse repetitions, and keep names and numbers
- Write numbers as numerals (e.g., 'five' → '5', 'twenty dollars' → '$20')
- Keep the original intent and nuance
- Use informal, plain language unless the text clearly uses a professional tone; in that case, match it
- When the speaker makes corrections, only keep the corrected information:
  • Remove the incorrect part and correction cues like "sorry", "actually", "I mean", "no wait"
  • Keep only the final, corrected version
  • Look for correction patterns where the speaker changes dates, names, times, or other details

EXAMPLES:
Input: "um what is wrong with ai and thigns like that it shoudl fix it right"
Output: What is wrong with AI and things like that? It should fix it, right?

Input: "i have a meeting on friday 3 pm sorry saturday 3 pm"
Output: I have a meeting on Saturday at 3 pm.

Input: "i have to go with sara on monday actually friday"
Output: I have to go with Sara on Friday.

Input: "the project is due next week i mean next month"
Output: The project is due next month.

OUTPUT ONLY THE CLEANED TEXT. NO COMMENTARY EVER.`,
				'prompt_transform.userPromptTemplate': 'Here is the text to format:\n{{input}}'
			},
			{
				...defaultStep,
				id: nanoid(),
				'prompt_transform.inference.provider': 'Groq' as const,
				'prompt_transform.inference.provider.Groq.model': 'openai/gpt-oss-120b' as const,
				'prompt_transform.systemPromptTemplate': `You are a text formatter. Your job is to take clean text and enhance its formatting for readability.

CRITICAL RULES:
- NEVER add commentary, explanations, or responses
- NEVER add words, phrases, or interpretive content that wasn't in the original text - only reorganize and format existing words
- NEVER change the meaning or content of the text
- Only improve the formatting and structure
- If the text is already well-formatted, leave it as is

FORMATTING RULES:
- Organize into short paragraphs of 2–4 sentences for readability
- When the text lists multiple items or points, format as lists:
  • Use numbered lists (1. 2. 3.) when items show priority, sequence, or steps
  • Use bullet points (- or •) when items are just being listed without order
  • Look for cues like "first, second, third", "also, and, another", "next step", etc.
- NEVER add quotation marks around statements, questions, or exclamations unless they represent actual quoted speech from the original text
- Only use quotation marks when someone in the text was quoting another person or text

EXAMPLES:
Input: We need to fix the website. First, the homepage. Then the login page. And also the checkout process.
Output: We need to fix the website:
1. First, the homepage
2. Then the login page
3. And also the checkout process

Input: I need to buy groceries. Milk. Bread. Eggs. Some fruits.
Output: I need to buy groceries:
- Milk
- Bread
- Eggs
- Some fruits

Input: Are you dumb or something?
Output: Are you dumb or something?

Input: I met Robert Pattinson, and he said life is once so live it.
Output: I met Robert Pattinson, and he said, "Life is once, so live it."

OUTPUT ONLY THE FORMATTED TEXT. NO COMMENTARY EVER.`,
				'prompt_transform.userPromptTemplate': 'Here is the text to format:\n{{input}}'
			}
		]
	};

	// Create the transformation
	try {
		if (typeof rpc.transformations?.mutations?.createTransformation?.execute !== 'function') {
			console.log('RPC transformations mutations not ready, skipping default transformation creation');
			return;
		}
		
		const { data: createdTransformation, error: createError } = await rpc.transformations.mutations.createTransformation.execute(defaultTransformation);
		
		if (createError || !createdTransformation) {
			console.warn('Failed to create default transformation:', createError);
			return;
		}

		// Only set as selected if user doesn't already have one selected
		const selectedTransformationId = settings.value['transformations.selectedTransformationId'];
		if (!selectedTransformationId) {
			settings.updateKey('transformations.selectedTransformationId', createdTransformation.id);
		}
	} catch (error) {
		console.warn('Error creating default transformation:', error);
	}
}