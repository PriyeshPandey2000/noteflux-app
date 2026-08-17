export type AppCategory = 'chat' | 'email' | 'general' | 'technical' | 'writing';

/**
 * Maps a frontmost app's display name (normalized: trimmed, lowercased) to a
 * behavior category. Keyed on name rather than bundle ID — bundle IDs are
 * unreliable for Electron-wrapped apps (e.g. Cursor ships under a generic
 * ToDesktop identifier), while the display name macOS shows in Cmd+Tab is
 * stable regardless of how the app was packaged.
 */
const APP_NAME_TO_CATEGORY: Record<string, AppCategory> = {
	// Email
	mail: 'email',
	outlook: 'email',
	'microsoft outlook': 'email',
	superhuman: 'email',
	spark: 'email',
	'spark desktop': 'email',
	'canary mail': 'email',
	thunderbird: 'email',
	mailspring: 'email',
	airmail: 'email',
	'proton mail': 'email',

	// Chat
	slack: 'chat',
	discord: 'chat',
	messages: 'chat',
	whatsapp: 'chat',
	telegram: 'chat',
	signal: 'chat',
	teams: 'chat',
	'microsoft teams': 'chat',
	messenger: 'chat',

	// Technical (code editors + terminals)
	cursor: 'technical',
	'visual studio code': 'technical',
	code: 'technical',
	xcode: 'technical',
	terminal: 'technical',
	iterm2: 'technical',
	warp: 'technical',
	'intellij idea': 'technical',
	pycharm: 'technical',
	webstorm: 'technical',
	windsurf: 'technical',

	// Writing (notes/documents)
	notes: 'writing',
	notion: 'writing',
	obsidian: 'writing',
	bear: 'writing',
	pages: 'writing',
	word: 'writing',
	'microsoft word': 'writing',
	craft: 'writing',
	typora: 'writing',
};

function normalizeAppName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Resolves a frontmost app name to a behavior category. Unrecognized apps
 * and browsers both fall to 'general' — safe default, no guessing.
 */
export function resolveAppCategory(name: null | string | undefined): AppCategory {
	if (!name) return 'general';
	return APP_NAME_TO_CATEGORY[normalizeAppName(name)] ?? 'general';
}

/**
 * Short instruction fragments spliced into the existing inline-edit system
 * prompt, one per category. 'general' is intentionally empty — no section
 * gets added, no behavior change from today's default.
 */
export const APP_CATEGORY_PROMPT_FRAGMENTS: Record<AppCategory, string> = {
	chat: `App context: Chat. Keep it casual and concise — do not expand a short reply into a longer one. Preserve emoji/emoticons already present, never invent new ones. Don't add a greeting or sign-off that wasn't spoken.
Example: "yeah sounds good ill send it over" → "Yeah sounds good, I'll send it over."`,
	email: `App context: Email. Match a professional tone if the source is professional. Don't invent a subject line, recipient name, or sign-off that wasn't spoken or already present. Use paragraph breaks between distinct topics.
Example: "hey john just wanted to check on the proposal timeline thanks" → "Hi John, Just wanted to check on the proposal timeline. Thanks."`,
	general: '',
	technical: `App context: Technical (code editor or terminal). Preserve exact variable names, syntax, and technical tokens exactly as spoken. Don't reformat or "improve" code structure. Use a bullet per step only when the instruction lists multiple discrete steps.
Example: "rename get user to fetch user and add a null check" → "Rename getUser to fetchUser and add a null check."`,
	writing: `App context: Notes. Structure with lists or headings only if the spoken content implies structure — a single sentence stays a sentence.
Example: "todo call the dentist buy groceries finish the report" → "To-do:\n- Call the dentist\n- Buy groceries\n- Finish the report"`,
};
