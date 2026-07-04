import { MarkdownView } from 'obsidian'

/**
 * Places the cursor/selection on a match inside an (already active) note.
 * Handles the two reasons a jump can silently land at the top:
 * - reading view: the editor API can't scroll the preview, so the view is
 *   switched to source mode first;
 * - editor not laid out yet right after opening: the selection is re-applied
 *   on a short delay once CodeMirror has settled.
 */
export async function jumpToMatch(
  view: MarkdownView,
  start: number,
  length: number
): Promise<void> {
  if (view.getMode() === 'preview') {
    await view.setState({ ...view.getState(), mode: 'source' }, { history: false })
    await new Promise(resolve => window.setTimeout(resolve, 50))
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
