/** Extracts searchable text from a .canvas JSON file (nodes + edge labels). */
export function extractCanvasText(json: string): string {
  try {
    const canvas = JSON.parse(json) as {
      nodes?: { text?: string; file?: string; url?: string; label?: string }[]
      edges?: { label?: string }[]
    }
    const parts: string[] = []
    for (const node of canvas.nodes ?? []) {
      if (node.text) parts.push(node.text)
      if (node.file) parts.push(node.file)
      if (node.url) parts.push(node.url)
      if (node.label) parts.push(node.label)
    }
    for (const edge of canvas.edges ?? []) {
      if (edge.label) parts.push(edge.label)
    }
    return parts.join('\n')
  } catch {
    return ''
  }
}
