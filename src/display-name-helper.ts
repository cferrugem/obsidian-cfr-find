import { TFile } from "obsidian";
import { DisplayNameMode } from "./settings";
import type CfrFindPlugin from "./main";

export function getDisplayName(
    plugin: CfrFindPlugin,
    file: TFile
): string {
    if (plugin.settings.displayNameMode === DisplayNameMode.Title) {
        return file.basename
    }

    const cache = plugin.app.metadataCache.getFileCache(file);
    const aliases = cache?.frontmatter?.aliases

    if (Array.isArray(aliases) && aliases.length > 0) {
        return aliases[0]
    }

    if (typeof aliases === 'string') {
        return aliases
    }

    return file.basename
}
