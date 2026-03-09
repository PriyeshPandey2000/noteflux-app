import { doubleMetaphone } from 'double-metaphone';

type DictionaryEntry = { word: string; phoneticCode: string };

export function getPhoneticCode(word: string): string {
	const [primary] = doubleMetaphone(word);
	return primary;
}

export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
	if (!entries.length) return text;

	// Pre-built hash map: phoneticCode → correctWord
	const index = new Map(entries.map((e) => [e.phoneticCode, e.word]));

	// Replace word-by-word, preserve punctuation/spacing
	return text.replace(/\b[\w'-]+\b/g, (word) => {
		const code = getPhoneticCode(word);
		const correct = index.get(code);
		// Skip if no match or already correctly spelled
		if (!correct || word.toLowerCase() === correct.toLowerCase()) return word;
		return correct;
	});
}
