# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Reader Highlighter** is an Obsidian plugin (v0.0.1) that enables automatic text highlighting in Reader (Preview) mode. Users select text to highlight it instantly—no UI menus or confirmations. Highlights persist as standard Markdown syntax (`==text==`) in note files.

See [SPEC.md](SPEC.md) for the complete specification, acceptance criteria, and implementation guidelines.

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

### Code Quality
```bash
npm run lint     # Run linter
npm run format   # Format code (if configured)
```

### Testing
When tests are configured:
```bash
npm test                    # Run all tests
npm test -- path/to/test.ts # Run single test file
```

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
- **manifest.json**: Plugin metadata (name, version, author, description)
- **styles.css** (optional): Styling for highlights and mobile handles
- **esbuild.config.mjs**: Build configuration (format: CommonJS, target: es2018, tree-shaking enabled)

### Core Interaction Flow

The plugin operates exclusively in Reader mode (preview) and handles three interaction patterns:

1. **Text Selection → Auto-Highlight**: When user selects text, it's immediately highlighted in the DOM. On selection release, the highlight is persisted to the file as `==text==`.

2. **Double-Click → Paragraph Highlight**: Double-clicking any word highlights the entire containing block (paragraph, list item, blockquote, heading). Block boundaries are determined via DOM traversal using `element.closest()`.

3. **Mobile Handle Adjustment** (mobile only): After a highlight exists on mobile, draggable handles appear at the start and end. Users can drag handles to adjust boundaries with a live preview. On release, the adjusted selection is persisted. Handles are dismissed by tapping outside them.

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

- **Detection**: Use `app.isMobile` and `Platform.isMobile`/`Platform.isPhone` from the obsidian module
- **Desktop**: No handles; selection-only interaction
- **Mobile**: Handles appear post-highlight for boundary adjustment; drag events debounced to ~60fps via `requestAnimationFrame`
- **Testing**: Use `app.emulateMobile(!this.app.isMobile)` in dev console, but always verify on actual devices

### Reader Mode Detection

- Listen for workspace layout changes via `app.workspace` events
- Use `MarkdownView.getMode() === 'preview'` to identify preview mode
- Use `leaf.view instanceof MarkdownView` to confirm markdown views
- Register handlers only on preview-mode leaves

### Safe Defaults & Guardrails

- **Unsupported selections** (ambiguous, multi-block, etc.) are cancelled silently or with minimal feedback
- **Content integrity > feature completeness**: Never leave partial or corrupted highlights
- **Atomic operations**: File modifications wrapped in try-catch; DOM state rolled back on failure
- **No undo/redo support** for handle adjustments or highlights in v1

### Performance Considerations

- Debounce handle drag events to ~60fps max via `requestAnimationFrame`
- Use event delegation where possible
- Avoid re-parsing the entire document on each highlight
- Cache frequently accessed DOM elements and file references
- Large notes should remain responsive with no background processing outside the active note

## Important Implementation Notes

- **File modifications**: Always use `app.vault.modify()` or `app.vault.process()` with TFile objects—never use filesystem APIs directly
- **DOM tracking**: DOM modifications are automatically cleaned up via the registration system; no manual tracking needed
- **Selection API**: Use native `window.getSelection()` for working with text selections in preview DOM
- **Inline formatting**: Preserve inline formatting inside selections (e.g., `==some **bold** text==`)
- **Intentional minimalism**: The plugin is deliberately minimal—no colors, styles, categories, comments, annotations, exporting, or undo support in v1

## Acceptance Criteria (v1)

See [SPEC.md](SPEC.md) lines 252-264 for the full list. Key behaviors include:
- Text selection immediately highlights in preview
- Double-click highlights entire paragraph
- Mobile handles allow boundary adjustment
- Highlights persist across sessions and sync
- Unsupported selections never modify the note
