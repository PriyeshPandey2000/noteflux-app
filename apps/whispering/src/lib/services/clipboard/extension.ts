import { tryAsync } from 'wellcrafted/result';

import { type ClipboardService, ClipboardServiceErr } from './types';

export function createClipboardServiceExtension(): ClipboardService {
	return {
		copyToClipboard: (text) =>
			tryAsync({
				mapErr: (error) =>
					ClipboardServiceErr({
						cause: error,
						context: { text },
						message: 'Unable to copy to clipboard',
					}),
				try: () => navigator.clipboard.writeText(text),
			}),

		typeAtCursor: (text) =>
			tryAsync({
				mapErr: (error) =>
					ClipboardServiceErr({
						cause: error,
						context: { text },
						message: 'Unable to type text at cursor position',
					}),
				try: () => writeTextToCursor(text),
			}),

		pasteFromClipboard: () =>
			tryAsync({
				mapErr: (error) =>
					ClipboardServiceErr({
						cause: error,
						message: 'Unable to paste from clipboard at cursor position',
					}),
				try: async () => {
					const text = await navigator.clipboard.readText();
					return writeTextToCursor(text);
				},
			}),

		getSelectionWithContext: async () => null,
	};
}

/**
 * Handle the appending of text for non-input and non-textarea elements.
 *
 * @param element - The non-input element.
 * @param text - The text to be appended.
 */
function appendTextToContentEditableElement(
	element: HTMLElement,
	text: string,
): void {
	element.innerHTML += text;
}

/**
 * Handle the insertion of text for input and textarea elements.
 *
 * @param inputElement - The input element.
 * @param text - The text to be inserted.
 */
function insertTextInInputElement(
	inputElement: HTMLInputElement | HTMLTextAreaElement,
	text: string,
): void {
	const startPos = inputElement.selectionStart ?? 0;
	const endPos = inputElement.selectionEnd ?? 0;

	inputElement.focus();
	inputElement.setSelectionRange(startPos, endPos);

	// Use document.execCommand to insert the text, so it gets added to the undo stack
	document.execCommand('insertText', false, text);

	inputElement.dispatchEvent(new Event('input', { bubbles: true }));
}

function isHTMLElement(element: unknown): element is HTMLElement {
	return element instanceof HTMLElement;
}

function isInputOrTextareaElement(
	element: HTMLElement,
): element is HTMLInputElement | HTMLTextAreaElement {
	return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

/**
 * Insert the provided text at the cursor position in the currently active input element or append it
 * to the non-input active element.
 *
 * @param text - The text to be inserted.
 */
function writeTextToCursor(text: string): void {
	const activeElement = document.activeElement;
	if (!isHTMLElement(activeElement)) return;

	if (isInputOrTextareaElement(activeElement)) {
		insertTextInInputElement(activeElement, text);
	} else if (activeElement.isContentEditable) {
		appendTextToContentEditableElement(activeElement, text);
	}
}
