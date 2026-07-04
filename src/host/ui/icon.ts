import { addIcon } from 'obsidian'

export const CFR_FIND_ICON = 'cfr-find'

/**
 * CFR Find's own mark: a magnifier with a lightning bolt — search, but fast.
 * Registered once so it can be used in the ribbon, modals, and anywhere
 * Obsidian accepts an icon id.
 */
export function registerCfrFindIcon(): void {
  addIcon(
    CFR_FIND_ICON,
    `
    <g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round">
      <circle cx="43" cy="43" r="27"/>
      <line x1="63" y1="63" x2="88" y2="88" stroke-width="10"/>
    </g>
    <path d="M48 24 L32 46 L42 46 L37 62 L54 39 L44 39 Z" fill="currentColor"/>
    `
  )
}
