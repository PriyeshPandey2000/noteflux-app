# Recordings row actions: overflow menu declutter

Every recording row (recordings page + homepage "Recent" list, shared column) currently renders up to 9 icon
buttons plus a duration label: play, transcribe/status, transform, edit, copy text, copy transform output,
view runs, download, delete. Goal: keep the 3 core actions visible, move the rest behind a `⋯` menu.

## Kept visible

1. **Transcribe / status** button (Play/Repeat/Alert by transcription state) — primary action + status signal
2. **Copy text** button — the frequent "take my transcript" action
3. Play/duration stays in the separate Audio column (untouched)

## Moved into `⋯` dropdown menu (order)

1. Edit — `EditRecordingModal`
2. Transform — `TransformationPicker`, converted from popover to a submenu so it can live inside the menu
   without popover-anchor problems (transformations are few; the picker keeps its server query + select callback)
3. Copy transformation output — shown only when the latest run has a `completed` output
4. View runs — `ViewTransformationRunsDialog`
5. Download
6. Separator
7. Delete — `variant="destructive"`, last, keeps its confirmation dialog

## Files to change

- `routes/(config)/recordings/row-actions/RecordingRowActions.svelte` — main restructure
- `routes/(config)/recordings/row-actions/EditRecordingModal.svelte` — add `useMenuTrigger` prop
- `routes/(config)/recordings/row-actions/ViewTransformationRunsDialog.svelte` — add `useMenuTrigger` prop
- `routes/(config)/recordings/row-actions/TransformationPicker.svelte` — rewrite trigger from popover to
  `DropdownMenu.Sub` (single consumer, so no mode flag)
- Shared `actionsColumn` means both the recordings page and homepage update together

## Todos

- [ ] Restructure `RecordingRowActions.svelte`: visible transcribe + copy text + `⋯` trigger (MoreHorizontalIcon),
      menu items for edit/transform/copy-transform-output/history/download/delete, 3 skeletons while loading
- [ ] Add `useMenuTrigger` to `EditRecordingModal.svelte` (swap `Modal.Trigger` button for a `DropdownMenu.Item`)
- [ ] Add `useMenuTrigger` to `ViewTransformationRunsDialog.svelte` (swap `Dialog.Trigger` for a `DropdownMenu.Item`)
- [ ] Convert `TransformationPicker.svelte` to a `DropdownMenu.Sub` submenu of transformations + "Manage transformations"
- [ ] Run `bun run check`, fix type errors
- [ ] Verify both table locations render correctly in the browser

## Review

Implemented as planned, with two course corrections found during testing.

**Correction 1: `useMenuTrigger` was abandoned.** The plan was to give `EditRecordingModal` and
`ViewTransformationRunsDialog` a `useMenuTrigger` prop that swapped their trigger button for a
`DropdownMenu.Item`. During browser testing the modals opened then closed instantly. The real cause was that
both dialogs were rendered *inside* `<DropdownMenu.Content>`. bits-ui's `PopperLayer` (`forceMount={false}`)
unmounts the menu's children after the close animation, so selecting Edit destroyed the dialog component
along with the menu. Deferring the open with `setTimeout(..., 0)` only masked the timing; the component was
still being torn down.

The fix: both components now take a plain `open = $bindable(false)` prop, and `RecordingRowActions` renders
them as siblings *after* `</DropdownMenu.Root>`, driven by parent state (`isEditOpen`, `isViewRunsOpen`).
Confirmed in the browser with a MutationObserver: the Edit dialog mounts and stays mounted. This is simpler
than `useMenuTrigger` and removes the coupling to the menu lifecycle.

**Correction 2: bits-ui prop is `onSelect`, not `onselect`.** All menu items used lowercase `onselect`, which
Svelte 5 treats as a DOM `select` event listener that never fires on a div. Every item closed the menu but did
nothing. Renamed to `onSelect` in 7 places across 4 files.

**Icon pass (premium + coherent).** Auditing the icon usage surfaced two problems that made the UI feel
inconsistent:

- The app mixes Lucide (dominant) with three bespoke Heroicons overrides in `$lib/components/icons`
  (Pencil, Trash, Clipboard, all at `stroke-width="1.5"`), plus near-duplicate Lucide imports
  (`Trash` *and* `Trash2`, `Loader` *and* `Loader2`).
- Menu items force `[&_svg:not([class*='size-'])]:size-4`, but the custom Heroicons hard-code `class="size-6"`,
  so the Delete/Edit icons rendered at 24px next to 16px Lucide icons.

Changes:
- `app.css`: `svg.lucide { stroke-width: 1.5 }` so every Lucide icon matches the Heroicons weight. Applies
  globally; confirmed computed stroke is `1.5px`.
- `RecordingRowActions.svelte`: Edit now uses the custom Heroicons `PencilIcon` (coherent with
  `EditTransformationModal`), `View runs` → `ListChecksIcon`, `Download` → `ArrowDownToLineIcon`; custom
  Pencil/Trash pass `class="size-4"` so they match the 16px Lucide icons.
- Deduplicated trash app-wide onto the custom Heroicons `TrashIcon`: `Qwen3ASRModelCard`,
  `ParakeetModelCard` (were `Trash2Icon`), `Configuration.svelte`, `dictionary/+page.svelte`,
  `EditTransformationModal.svelte` (were Lucide `TrashIcon`).
- `PermissionsScreen.svelte`: `LoaderIcon` → `Loader2Icon` (same arc spinner as the other 8 usages).

**Verification.** `bun run check` shows no errors in touched files (70 pre-existing baseline errors remain
elsewhere). In the browser: the `⋯` menu opens with Edit | Transform | View runs | Download | Delete;
all icons render at 16px with 1.5 stroke; the Edit dialog opens and persists. `bun tauri build` succeeds
(bundles produced; only the pre-existing updater signing error without `TAURI_SIGNING_PRIVATE_KEY`).

**Follow-ups not done:** the `Copy`/`Clipboard` overview still mixes Lucide `CopyIcon` with the custom
Heroicons `ClipboardIcon` in different places; left alone because they are genuinely different metaphors
(duplicate vs clipboard).