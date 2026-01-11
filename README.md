# Reader Highlighter

Highlight text directly in Obsidian Reader (Preview) mode. Selecting text applies a highlight immediately and persists it to your note using the standard Markdown syntax `==text==`. Double-click highlights the entire paragraph. On mobile, draggable handles appear after a highlight so you can adjust the boundaries with a live preview.

## Features
- Automatic highlight on text selection in Reader mode
- Double-click to highlight a whole paragraph, list item, blockquote, or heading
- Mobile-only draggable handles to fine-tune highlights
- Highlights persist in the underlying Markdown using `==...==`
- Guardrails to avoid multi-block or ambiguous highlights

## Development
```bash
npm install
npm run dev   # watch mode
npm run build # production build
```

Load the built `main.js` into your Obsidian vault’s `.obsidian/plugins/reader-highlighter` folder along with `manifest.json` and `styles.css`.

See `SPEC.md` for the full product requirements and constraints.
