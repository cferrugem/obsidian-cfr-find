import { MarkdownView } from 'obsidian'

/**
 * Brings a match into view WITHOUT changing how the user reads the note:
 * - reading view: scroll to the match's line via ephemeral state (the same
 *   mechanism internal links use) — the view mode is left untouched;
 * - source/live preview: select the match and scroll it into view, retrying
 *   once shortly after in case the editor was still being laid out.
 */
export async function jumpToMatch(
  view: MarkdownView,
  start: number,
  length: number,
  line: number
): Promise<void> {
  if (view.getMode() === 'preview') {
    view.setEphemeralState({ line })
    return
  }
  const editor = view.editor
  const from = editor.offsetToPos(start)
  const to = editor.offsetToPos(start + length)
  editor.setSelection(from, to)
  editor.scrollIntoView({ from, to }, true)
  window.setTimeout(() => {
    try {
      editor.setSelection(from, to)
      editor.scrollIntoView({ from, to }, true)
    } catch {
      // View was closed in the meantime: nothing to do.
    }
  }, 100)
}
