Spec: Automatic Highlights in Reader Mode (Obsidian)

Problem

In Obsidian’s Reader (Preview) mode, users can read content but cannot naturally annotate it. Highlighting requires switching modes, interrupting reading flow.

Goal

Enable instant, frictionless highlighting directly in Reader mode, with highlights that persist safely into the note.

⸻

Plugin metadata

	•	Plugin name: Reader Highlighter
	•	Version: 0.0.1
	•	Author: Simón Muñoz
	•	Description: Highlight text in Reader mode and persist it to Markdown.

⸻

User experience

Core behavior (Reader mode only)

1. Automatic highlight on selection
	•	When a user selects text in Reader mode:
	•	The text is automatically highlighted.
	•	No buttons, pop-ups, confirmations, or menus appear.
	•	Releasing the selection finalizes the highlight.
	• If selection spans inline formatting, preserve it: ==some **bold** text==


Key principle:

Selecting text is the action. No other interaction is required or supported for creating highlights. On mobile, native OS selection handles appear immediately after a highlight is created so the user can adjust it in place.

⸻

2. Paragraph highlight via double-click
	•	When the user double-clicks any word inside a paragraph:
	•	The entire paragraph is highlighted.
	•	This applies consistently to:
	•	Plain paragraphs
	•	List items
	•	Blockquotes
	•	Headings

Explicit rule:
A “paragraph” is a single rendered block. Highlighting never spans multiple blocks.

⸻

3. Mobile highlight adjustment via native OS selection
	•	On mobile devices, immediately after a highlight is applied:
	•	The highlighted text remains selected
	•	The OS selection handles appear at the selection boundaries
	•	Users drag the native handles to extend or reduce the selection
	•	When the selection stabilizes (short debounce), the highlight is updated in the note
	•	Dismissing the selection (tap elsewhere) leaves the highlight unchanged

Constraints:
	•	Native selection handles are mobile-only (no desktop adjustment)
	•	Multi-paragraph highlights remain unsupported
	•	Undo/redo of selection adjustments is not supported

⸻

4. Persistence
	•	Highlights are saved directly in the note file.
	•	They persist across:
	•	Closing and reopening the note
	•	App restarts
	•	Sync across devices

⸻

Interaction constraints (intentional)

Allowed interactions
	•	Selecting text on screen (mouse, touch, or keyboard selection) is the primary way to create or remove highlights.
	•	On mobile only: Immediately after highlighting, use native selection handles to adjust the selection.

Disallowed interactions
	•	No command palette actions
	•	No context menu items
	•	No keyboard shortcuts dedicated to highlighting
	•	No UI affordances except native OS selection handles (shown immediately after a highlight on mobile)

This ensures the feature:
	•	Feels native and invisible during initial highlighting
	•	Has zero learning curve for basic highlighting
	•	Cannot be triggered accidentally outside reading flow
	•	Provides mobile-specific refinement without cluttering the desktop experience

⸻

Behavior rules & safety guarantees

Supported interactions

The plugin guarantees correct behavior for:
	•	Single, continuous selections
	•	Paragraph-level highlighting via double-click
	•	Mobile native selection adjustment right after highlighting

Guardrails (safe defaults)
	•	If the selection cannot be safely or unambiguously applied:
	•	The operation is cancelled silently or with minimal feedback
	•	The plugin always prioritizes content integrity over feature completeness

⸻

Highlight representation (safe assumption)
	•	Highlights are persisted using standard Markdown highlight syntax:
==highlighted text==

Rationale:
	•	Human-readable and reversible by users
	•	Widely understood in Obsidian
	•	Low risk of file corruption
	•	Compatible with sync, diffing, and manual edits

(No alternative formats in v1.)

⸻

Accessibility & platform support
	•	Works on desktop and mobile
	•	Fully usable via:
	•	Mouse selection
	•	Touch selection
	•	Keyboard-based text selection
	•	Does not rely on hover states or precision pointing

⸻

Performance expectations (user-facing)
	•	Highlighting feels instant
	•	No noticeable delay after selection
	•	Large notes remain responsive
	•	No background processing outside the active note

⸻

Testing & quality bar (behavioral)

Required coverage
	•	Selecting text immediately applies a highlight
	•	Double-clicking any word highlights the entire paragraph
	•	Highlights persist after reload and sync
	•	Unsupported selections never modify the note
	•	Re-selecting highlighted text correctly removes the highlight
	•	On mobile, native selection handles appear right after highlighting
	•	On mobile, adjusting the native selection updates the highlight boundaries
	•	On mobile, selection stabilization persists the adjusted highlight
	•	On mobile, dismissing the selection leaves the highlight unchanged
	•	On mobile, tapping an existing highlight enters adjustment mode
	•	Adjusting highlight boundaries never deletes text from the note

Failure handling
	•	In all failure cases:
	•	The note remains unchanged
	•	No partial or corrupted highlights are introduced

⸻

Non-goals (explicit)
	•	❌ Undo / redo support (including handle adjustment undo)
	•	❌ Command-based or menu-based highlighting
	•	❌ Highlight colors, styles, or categories
	•	❌ Comments, annotations, or metadata
	•	❌ Exporting or sharing highlights
	•	❌ Multi-paragraph highlights (even with handle adjustment)
	•	❌ Desktop adjustment via selection handles (mobile-only)

Undo, multi-paragraph support, and advanced controls are intentionally deferred to future versions.

⸻

Implementation guidelines

Technical approach

Language & tooling
	•	TypeScript with Obsidian API types
	•	Use the official obsidian module for all plugin APIs
	•	Plugin extends the Plugin base class from obsidian
	•	Required files: main.ts, manifest.json, styles.css (optional)
	•	Node.js v16 or higher
	•	Build tool: esbuild (configured via esbuild.config.mjs)
	•	esbuild format: CommonJS (cjs), target: es2018, with tree-shaking enabled

Plugin lifecycle
	•	Use onload() to initialize event listeners and register view handlers
	•	Use registerEvent() for App/Workspace events, registerDomEvent() for DOM events, and registerInterval() for intervals
	•	All registrations are automatically cleaned up when the plugin unloads—no manual cleanup in onunload() is required
	•	The framework handles automatic cleanup recursively for all child components
	•	Never manually remove event listeners; rely on the declarative registration system

File modification
	•	Use app.vault.modify(file, newContent) or app.vault.process(file, processor) for all file changes
	•	Never write to files directly via filesystem APIs
	•	Always work with TFile objects from Obsidian's vault API
	•	Modifications should be atomic and transactional where possible

Reader mode detection
	•	Listen for workspace layout changes via app.workspace events
	•	Identify Reader mode views using MarkdownView.getMode() === 'preview'
	•	Register handlers only on preview mode leaves
	•	Use leaf.view instanceof MarkdownView to identify markdown views

Selection handling
	•	Use native Selection API (window.getSelection())
	•	Listen to mouseup and touchend events on preview containers
	•	Map preview DOM to source positions using MarkdownView APIs
	•	Handle selection within preview DOM, not source editor
	•	Known limitation: Selection boundary mapping may be inaccurate for characters hidden by Live Preview rendering. Test thoroughly in both Source and Live Preview modes.

Block boundary detection
	•	Use DOM traversal to find containing block elements
	•	Target elements: p, li, blockquote > p, h1-h6, etc.
	•	Use element.closest() to find the nearest block ancestor
	•	Verify both selection start and end are in same block

Mobile detection
	•	Use Platform.isMobile or Platform.isPhone from obsidian module
	•	Also use app.isMobile for comprehensive mobile detection
	•	Platform is imported from 'obsidian'
	•	Tablets are considered mobile for this plugin
	•	For testing: Use app.emulateMobile(!this.app.isMobile) in developer console to toggle mobile emulation on desktop
	•	Always verify on actual mobile devices, as desktop emulation differs from real mobile behavior

Native selection adjustment
	•	On mobile, keep the selection active after applying the highlight
	•	Use selectionchange events to observe user adjustments immediately after highlight creation
	•	Debounce persistence (e.g., 200-300ms) before writing to the note
	•	Cancel adjustment if the selection collapses or leaves the original block

Re-rendering and mark element selection
	•	After persisting a highlight, Obsidian re-renders the preview which clears the DOM selection
	•	To show native OS handles on mobile, wait for re-render (~50ms delay) then find and select the <mark> element
	•	Use querySelectorAll('mark') to find highlight elements in the container
	•	Match by normalized text content (collapse whitespace, trim) for reliable matching
	•	Tapping an existing <mark> element on mobile should also enter adjustment mode

Highlight adjustment safety
	•	When adjusting highlight boundaries, never lose text from the note
	•	Adjustment algorithm: (1) unwrap the original highlight, (2) find the new selection text within the unwrapped content, (3) wrap only the new selection
	•	This ensures shrinking a highlight (e.g., "A B C" → "A B") preserves the excluded text ("C")
	•	Verify the new text position is within or near the original highlight location to avoid ambiguity

Error handling
	•	Wrap all file modifications in try-catch blocks
	•	Log errors using console.error for debugging
	•	On failure, ensure DOM state is rolled back
	•	Never leave partial highlights in either DOM or file

Performance
	•	Debounce handle drag events to ~60fps max
	•	Use event delegation where possible
	•	Avoid re-parsing entire document on each highlight
	•	Cache frequently accessed DOM elements and file references

⸻

Acceptance criteria (v1 ship-ready)
	1.	Plugin installs successfully in Obsidian and loads without errors.
	2.	Plugin metadata is correct (name, version, author, description).
	3.	Selecting text in Reader mode automatically highlights it.
	4.	Double-clicking any word highlights the entire paragraph.
	5.	On mobile, native OS selection handles appear immediately after a highlight is created.
	6.	On mobile, dragging native selection handles adjusts the highlight boundaries.
	7.	On mobile, when the selection stabilizes, the adjusted highlight persists to markdown.
	8.	On mobile, dismissing the selection leaves the highlight unchanged.
	9.	Highlights persist reliably across sessions and devices.
	10.	Unsupported selections never alter the note.
	11.	The feature works consistently on desktop and mobile.
	12.	Highlights are created via on-screen text selection. On mobile, users can adjust right after creation via native selection handles.

⸻

Deferred (future exploration)
	•	Undo / redo
	•	Multi-paragraph highlights
	•	Highlight management tools
	•	Annotation and commenting
