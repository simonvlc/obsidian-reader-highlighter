# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reader Highlighter** is an Obsidian plugin in active development that enables automatic text highlighting in Reader (Preview) mode. Users select text to highlight it instantly—no UI menus or confirmations. Highlights persist as standard Markdown syntax (`==text==`) in note files.

See [SPEC.md](SPEC.md) for the complete specification, acceptance criteria, and implementation guidelines.

**Note**: Version numbers in manifest.json auto-increment via a post-edit hook after each change.

## Development Commands

### Setup
```bash
npm install
```

### Build & Development
```bash
npm run dev      # Watch mode for development (auto-rebuilds on changes)
npm run build    # Production build
```

Note: Linting, formatting, and testing scripts are not currently configured in this project.

**Important**: After making any code changes, always run `npm run build` to compile the plugin before the user can test it.

### Development Environment
- Develop in a dedicated test vault to prevent data loss
- Use developer console: `app.emulateMobile(!this.app.isMobile)` to test mobile behavior on desktop
- Monitor developer console for warnings and errors
- Reload Obsidian after changes (automatic with `npm run dev`)

## Architecture & Key Concepts

### Plugin Structure

- **main.ts**: Plugin entry point extending the `Plugin` base class
  - `onload()`: Initialize event listeners and register handlers
  - `onunload()`: No manual cleanup needed; the framework handles it automatically
- **manifest.json**: Plugin metadata (name, version, author, description); version auto-increments via post-edit hook
- **styles.css**: Styling for highlights and mobile handles (required for proper mobile handle rendering)
- **esbuild.config.mjs**: Build configuration (format: CommonJS, target: es2018, tree-shaking enabled)

### Core Interaction Flow

The plugin operates exclusively in Reader mode (preview) and handles three interaction patterns:

1. **Text Selection → Auto-Highlight**: When user selects text, it's immediately highlighted in the DOM. On selection release, the highlight is persisted to the file as `==text==`.

2. **Double-Click → Paragraph Highlight**: Double-clicking any word highlights the entire containing block (paragraph, list item, blockquote, heading). Block boundaries are determined via DOM traversal using `element.closest()`.

3. **Mobile Native Selection Adjustment** (mobile only): Immediately after a highlight is applied on mobile, the text remains selected and native OS selection handles appear. Users drag the native handles to adjust boundaries. After a short debounce (200-300ms), the adjusted highlight is persisted. Tapping elsewhere dismisses the selection and leaves the highlight unchanged.

### Selection & File Modification Pipeline

1. **Detect selection** via `mouseup`/`touchend` events on the preview container
2. **Map preview DOM to source positions** using MarkdownView APIs
3. **Verify safety**: Ensure selection is continuous, within a single block, and unambiguous
4. **Apply visual feedback**: Temporarily highlight in DOM with CSS classes (e.g., `.highlight-preview`)
5. **Persist to file**: Use `app.vault.modify()` or `app.vault.process()` to wrap selected text in `==markers==`
6. **Rollback on failure**: If modification fails, remove DOM highlights immediately

**Known Limitation**: Selection boundary mapping may be inaccurate for characters hidden by Live Preview rendering. Test thoroughly in both Source and Live Preview modes.

### Plugin Lifecycle & Event Management

Modern Obsidian plugins use **declarative registration** for automatic cleanup:

- Use `this.registerEvent()` for App/Workspace events
- Use `this.registerDomEvent()` for DOM events on persistent elements
- Use `this.registerInterval()` for setInterval calls
- **All registrations are automatically cleaned up when the plugin unloads**—no manual cleanup in `onunload()` is required
- The framework handles automatic recursive cleanup for all child components

**Never manually manage event listeners**; rely on the registration system.

### Mobile vs Desktop

- **Detection**: Use `app.isMobile` and `Platform.isMobile`/`Platform.isPhone` from the obsidian module; tablets are considered mobile
- **Desktop**: Selection-only interaction; no adjustment handles
- **Mobile**: Native OS selection handles appear immediately after highlighting; use `selectionchange` events to observe adjustments; debounce persistence (200-300ms) before writing to note
- **Testing**: Use `app.emulateMobile(!this.app.isMobile)` in dev console, but always verify on actual devices as desktop emulation differs from real mobile behavior

### Reader Mode Detection

- Listen for workspace layout changes via `app.workspace` events
- Use `MarkdownView.getMode() === 'preview'` to identify preview mode
- Use `leaf.view instanceof MarkdownView` to confirm markdown views
- Register handlers only on preview-mode leaves

### Safe Defaults & Guardrails

- **Unsupported selections** (ambiguous, multi-block, etc.) are cancelled silently or with minimal feedback
- **Content integrity > feature completeness**: Never leave partial or corrupted highlights
- **Atomic operations**: File modifications wrapped in try-catch; DOM state rolled back on failure
- **No undo/redo support** for selection adjustments or highlights in v1

### Performance Considerations

- Debounce mobile selection adjustment persistence to 200-300ms
- Use event delegation where possible
- Avoid re-parsing the entire document on each highlight
- Cache frequently accessed DOM elements and file references
- Large notes should remain responsive with no background processing outside the active note

## Important Implementation Notes

- **File modifications**: Always use `app.vault.modify()` or `app.vault.process()` with TFile objects—never use filesystem APIs directly
- **DOM tracking**: DOM modifications are automatically cleaned up via the registration system; no manual tracking needed
- **Selection API**: Use native `window.getSelection()` for working with text selections in preview DOM
- **Inline formatting**: Preserve inline formatting inside selections (e.g., `==some **bold** text==`)
- **Intentional minimalism**: The plugin is deliberately minimal—no colors, styles, categories, comments, annotations, exporting, multi-paragraph highlights, or undo support in v1
- **Desktop adjustment**: No selection handle adjustment on desktop (mobile-only feature)

## Acceptance Criteria (v1)

See [SPEC.md](SPEC.md) lines 252-264 for the full list. Key behaviors include:
- Text selection immediately highlights in preview
- Double-click highlights entire paragraph
- Re-selecting highlighted text removes the highlight
- On mobile, native OS selection handles appear immediately after highlighting
- On mobile, dragging native handles adjusts highlight boundaries
- On mobile, selection stabilization persists the adjusted highlight
- On mobile, dismissing selection leaves highlight unchanged
- Highlights persist across sessions and sync
- Unsupported selections never modify the note
