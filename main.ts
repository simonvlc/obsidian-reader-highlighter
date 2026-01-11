import { MarkdownView, Platform, Plugin, TFile } from 'obsidian';

// State for mobile selection adjustment mode
interface AdjustmentState {
  block: HTMLElement;
  file: TFile | null;
  originalText: string;
  debounceTimer?: ReturnType<typeof setTimeout>;
  isDragging: boolean;
  lastSelectionRange?: Range;
}

// State for floating remove button
interface RemoveButtonState {
  button: HTMLElement;
  mark: HTMLElement;
  file: TFile | null;
  highlightText: string;
}

export default class ReaderHighlighterPlugin extends Plugin {
  private boundContainers = new WeakSet<HTMLElement>();
  private documentEventsBound = false;
  private adjustmentState?: AdjustmentState;
  private removeButtonState?: RemoveButtonState;

  private static readonly RERENDER_DELAY_MS = 50;
  private static readonly TOUCHEND_PERSIST_DELAY_MS = 50;

  async onload(): Promise<void> {
    this.refreshPreviewBindings();
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.refreshPreviewBindings())
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.refreshPreviewBindings())
    );
  }

  onunload(): void {
    this.exitAdjustmentMode();
    this.dismissRemoveButton();
  }

  private refreshPreviewBindings(): void {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (view.getMode() !== 'preview') continue;
      this.attachPreviewHandlers(view);
    }
  }

  private attachPreviewHandlers(view: MarkdownView): void {
    const container = (view as any).previewMode?.containerEl as HTMLElement | undefined;
    if (!container || this.boundContainers.has(container)) return;
    this.boundContainers.add(container);

    const handleSelection = (evt: Event) => this.handleSelectionEvent(evt, view, container);

    this.registerDomEvent(container, 'mouseup', handleSelection);
    this.registerDomEvent(container, 'keyup', handleSelection);
    this.registerDomEvent(container, 'touchend', (evt) => {
      window.setTimeout(() => this.handleSelectionEvent(evt, view, container), 10);
    });
    this.registerDomEvent(container, 'dblclick', (evt) => this.handleDoubleClick(evt, view, container));

    // Handle taps on existing highlights (mobile only)
    this.registerDomEvent(container, 'click', (evt) => this.handleHighlightTap(evt, view, container));

    // Register selectionchange listener once at document level
    if (!this.documentEventsBound) {
      this.documentEventsBound = true;
      this.registerDomEvent(document, 'selectionchange', () => this.handleSelectionChange());

      // Register click handler to dismiss remove button when clicking elsewhere
      this.registerDomEvent(document, 'click', (evt) => this.handleDocumentClick(evt));

      // Register touch events to detect handle dragging on mobile
      if (this.isMobile()) {
        this.registerDomEvent(document, 'touchstart', () => this.handleTouchStart());
        this.registerDomEvent(document, 'touchend', () => this.handleTouchEnd());
      }
    }
  }

  private async handleSelectionEvent(event: Event, view: MarkdownView, container: HTMLElement): Promise<void> {
    if (view.getMode() !== 'preview') return;
    if (event instanceof MouseEvent && event.detail >= 2) return;

    // If in adjustment mode, ignore new selection events (user is adjusting)
    if (this.adjustmentState) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;

    const range = selection.getRangeAt(0).cloneRange();
    const block = this.getBlock(range.startContainer);
    if (!block || block !== this.getBlock(range.endContainer)) return;

    const markdown = this.serializeRangeToMarkdown(range);
    if (!markdown) return;

    selection.removeAllRanges();

    const persisted = await this.persistHighlight(view.file, markdown);

    if (persisted) {
      // Wait for re-render, then find and show the mark element with remove button
      this.showRemoveButtonAfterRerender(container, markdown, view.file);
    }
  }

  private async handleDoubleClick(event: MouseEvent, view: MarkdownView, container: HTMLElement): Promise<void> {
    if (view.getMode() !== 'preview') return;

    // Exit any existing adjustment mode
    if (this.adjustmentState) {
      this.exitAdjustmentMode();
    }

    const target = event.target as Node | null;
    if (!target || !container.contains(target)) return;

    const block = this.getBlock(target);
    if (!block) return;

    const range = document.createRange();
    range.selectNodeContents(block);

    const markdown = this.serializeRangeToMarkdown(range);
    if (!markdown) return;

    window.getSelection()?.removeAllRanges();

    const persisted = await this.persistHighlight(view.file, markdown);

    if (persisted) {
      // Wait for re-render, then find and show the mark element with remove button
      this.showRemoveButtonAfterRerender(container, markdown, view.file);
    }
  }

  private handleDocumentClick(event: MouseEvent): void {
    // Dismiss remove button if clicking outside of it
    if (!this.removeButtonState) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Don't dismiss if clicking the button itself
    if (this.removeButtonState.button.contains(target)) return;

    // Don't dismiss if clicking the same mark element (will be handled by handleHighlightTap)
    if (this.removeButtonState.mark.contains(target)) return;

    this.dismissRemoveButton();
  }

  private handleHighlightTap(event: MouseEvent, view: MarkdownView, container: HTMLElement): void {
    if (view.getMode() !== 'preview') return;

    // Check if tap/click was on a mark element
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const mark = target.closest('mark');
    if (!mark || !container.contains(mark)) return;

    const markText = this.serializeRangeToMarkdown(this.createRangeForElement(mark as HTMLElement));

    // If remove button is already showing for this highlight, do nothing
    if (this.removeButtonState?.highlightText === markText) return;

    // Don't interfere if already in adjustment mode for this highlight (mobile)
    if (this.adjustmentState?.originalText === markText) return;

    // Exit any existing adjustment mode
    this.exitAdjustmentMode();

    // Show the floating remove button
    this.showRemoveButton(mark as HTMLElement, view.file, markText);

    // On mobile, also enter adjustment mode with selection handles
    if (this.isMobile()) {
      const block = this.getBlock(mark);
      if (!block) return;

      // Select the mark contents to show native handles
      const range = document.createRange();
      range.selectNodeContents(mark);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      // Enter adjustment mode
      this.enterAdjustmentMode(block, view.file, markText);
      console.debug('[Reader Highlighter] Tapped existing highlight, entering adjustment mode');
    }
  }

  private createRangeForElement(element: Element): Range {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range;
  }

  private getBlock(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) return null;
    const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
    return block instanceof HTMLElement ? block : null;
  }

  private serializeRangeToMarkdown(range: Range): string {
    return this.fragmentToMarkdown(range.cloneContents()).trim();
  }

  private fragmentToMarkdown(fragment: DocumentFragment): string {
    return Array.from(fragment.childNodes).map((node) => this.nodeToMarkdown(node)).join('');
  }

  private nodeToMarkdown(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node as Text).data;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const childContent = Array.from(el.childNodes)
      .map((child) => this.nodeToMarkdown(child))
      .join('');

    switch (el.tagName.toLowerCase()) {
      case 'strong':
      case 'b':
        return `**${childContent}**`;
      case 'em':
      case 'i':
        return `*${childContent}*`;
      case 'code':
        return `\`${childContent}\``;
      case 'a': {
        const href = el.getAttribute('href');
        return href ? `[${childContent}](${href})` : childContent;
      }
      case 'mark':
        return childContent;
      case 'del':
        return `~~${childContent}~~`;
      case 'br':
        return '\n';
      default:
        return childContent;
    }
  }

  private async persistHighlight(file: TFile | null, markdown: string): Promise<boolean> {
    if (!file) return false;
    const wrapped = `==${markdown}==`;

    try {
      const content = await this.app.vault.read(file);

      const existingMatches = this.findAllOccurrences(content, wrapped);
      if (existingMatches.length > 1) {
        console.warn('[Reader Highlighter] Ambiguous existing highlight, aborting removal.');
        return false;
      }

      if (existingMatches.length === 1) {
        const idx = existingMatches[0];
        const newContent = content.slice(0, idx) + markdown + content.slice(idx + wrapped.length);
        await this.app.vault.modify(file, newContent);
        return true;
      }

      const positions = this.findOccurrencesOutsideHighlight(content, markdown);
      if (positions.length !== 1) {
        console.warn('[Reader Highlighter] Ambiguous selection, aborting highlight.');
        return false;
      }

      const idx = positions[0];
      const newContent = content.slice(0, idx) + wrapped + content.slice(idx + markdown.length);
      await this.app.vault.modify(file, newContent);
      return true;
    } catch (error) {
      console.error('[Reader Highlighter] Failed to persist highlight', error);
      return false;
    }
  }

  private async persistAdjustedHighlight(
    file: TFile | null,
    originalText: string,
    newText: string
  ): Promise<boolean> {
    if (!file) return false;
    if (!originalText || !newText) return false;
    const originalWrapped = `==${originalText}==`;
    if (originalText === newText) return true;

    try {
      const content = await this.app.vault.read(file);
      const matches = this.findAllOccurrences(content, originalWrapped);
      if (matches.length !== 1) {
        console.warn('[Reader Highlighter] Ambiguous existing highlight, aborting adjustment.');
        return false;
      }

      const idx = matches[0];

      // First, unwrap the original highlight to restore plain text
      const unwrappedContent =
        content.slice(0, idx) + originalText + content.slice(idx + originalWrapped.length);

      // Now find and wrap only the new selection within the unwrapped content
      // The new text should exist within the original text's location
      const newPositions = this.findOccurrencesOutsideHighlight(unwrappedContent, newText);

      // Find the position that's within or near the original highlight location
      const nearbyPosition = newPositions.find(
        (pos) => pos >= idx && pos <= idx + originalText.length
      );

      if (nearbyPosition === undefined) {
        console.warn('[Reader Highlighter] Could not find new text position, aborting adjustment.');
        return false;
      }

      const newWrapped = `==${newText}==`;
      const newContent =
        unwrappedContent.slice(0, nearbyPosition) +
        newWrapped +
        unwrappedContent.slice(nearbyPosition + newText.length);

      await this.app.vault.modify(file, newContent);
      return true;
    } catch (error) {
      console.error('[Reader Highlighter] Failed to adjust highlight', error);
      return false;
    }
  }

  private findAllOccurrences(content: string, needle: string): number[] {
    const positions: number[] = [];
    if (!needle) return positions;
    let idx = content.indexOf(needle);
    while (idx !== -1) {
      positions.push(idx);
      idx = content.indexOf(needle, idx + needle.length);
    }
    return positions;
  }

  private findOccurrencesOutsideHighlight(content: string, selection: string): number[] {
    const positions: number[] = [];
    if (!selection) return positions;

    let idx = content.indexOf(selection);
    while (idx !== -1) {
      const before = content.slice(Math.max(0, idx - 2), idx);
      const after = content.slice(idx + selection.length, idx + selection.length + 2);

      if (before !== '==' && after !== '==') {
        positions.push(idx);
      }
      idx = content.indexOf(selection, idx + selection.length);
    }

    return positions;
  }

  private isMobile(): boolean {
    return Platform.isMobile || Platform.isPhone || (this.app as any).isMobile;
  }

  // --- Adjustment Mode (Mobile Native Selection) ---

  private showRemoveButtonAfterRerender(container: HTMLElement, text: string, file: TFile | null): void {
    // Wait for Obsidian to re-render the preview after file modification
    setTimeout(() => {
      const mark = this.findMarkElement(container, text);
      if (!mark) {
        console.debug('[Reader Highlighter] Could not find mark element after re-render');
        return;
      }

      // Show the floating remove button
      this.showRemoveButton(mark, file, text);

      // On mobile, also enter adjustment mode with selection handles
      if (this.isMobile()) {
        const block = this.getBlock(mark);
        if (!block) {
          console.debug('[Reader Highlighter] Could not find block for mark element');
          return;
        }

        // Select the mark element contents
        const range = document.createRange();
        range.selectNodeContents(mark);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Enter adjustment mode
        this.enterAdjustmentMode(block, file, text);
      }
    }, ReaderHighlighterPlugin.RERENDER_DELAY_MS);
  }

  private findMarkElement(container: HTMLElement, text: string): HTMLElement | null {
    const marks = container.querySelectorAll('mark');
    const normalizedText = this.normalizeText(text);

    for (const mark of Array.from(marks)) {
      const markText = this.normalizeText(mark.textContent || '');
      if (markText === normalizedText) {
        return mark as HTMLElement;
      }
    }

    // If no exact match, try to find the most recent mark (last in DOM order)
    // This helps when multiple highlights have similar text
    if (marks.length > 0) {
      console.debug('[Reader Highlighter] Using last mark element as fallback');
      return marks[marks.length - 1] as HTMLElement;
    }

    return null;
  }

  private normalizeText(text: string): string {
    // Normalize whitespace and trim
    return text.replace(/\s+/g, ' ').trim();
  }

  private enterAdjustmentMode(block: HTMLElement, file: TFile | null, originalText: string): void {
    this.exitAdjustmentMode();
    this.adjustmentState = { block, file, originalText, isDragging: false };
    console.debug('[Reader Highlighter] Entered adjustment mode for:', originalText);
  }

  private exitAdjustmentMode(): void {
    if (!this.adjustmentState) return;
    if (this.adjustmentState.debounceTimer) {
      clearTimeout(this.adjustmentState.debounceTimer);
    }
    console.debug('[Reader Highlighter] Exited adjustment mode');
    this.adjustmentState = undefined;
  }

  private handleSelectionChange(): void {
    // Only process if in adjustment mode on mobile
    if (!this.adjustmentState || !this.isMobile()) return;

    const selection = window.getSelection();

    // Selection collapsed = user tapped elsewhere, exit without persisting
    if (!selection || selection.isCollapsed) {
      this.exitAdjustmentMode();
      return;
    }

    // Verify selection is still within the original block
    const range = selection.getRangeAt(0);
    const startBlock = this.getBlock(range.startContainer);
    const endBlock = this.getBlock(range.endContainer);

    if (
      !startBlock ||
      !endBlock ||
      startBlock !== this.adjustmentState.block ||
      endBlock !== this.adjustmentState.block
    ) {
      // Selection left the block - cancel adjustment
      console.debug('[Reader Highlighter] Selection left block, canceling adjustment');
      this.exitAdjustmentMode();
      selection.removeAllRanges();
      return;
    }

    // Mark as dragging when selection changes
    this.adjustmentState.isDragging = true;

    // Store the latest selection range, but don't persist yet
    this.adjustmentState.lastSelectionRange = range.cloneRange();

    // Clear any existing debounce timer (we'll persist on touchend instead)
    if (this.adjustmentState.debounceTimer) {
      clearTimeout(this.adjustmentState.debounceTimer);
      this.adjustmentState.debounceTimer = undefined;
    }
  }

  private handleTouchStart(): void {
    // Track that user is potentially starting to drag selection handles
    if (!this.adjustmentState || !this.isMobile()) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      this.adjustmentState.isDragging = true;
    }
  }

  private handleTouchEnd(): void {
    // User released touch - now we can persist the adjusted selection
    if (!this.adjustmentState || !this.isMobile()) return;
    if (!this.adjustmentState.isDragging) return;

    this.adjustmentState.isDragging = false;

    // Use a short delay to ensure selectionchange has fired with final position
    this.adjustmentState.debounceTimer = setTimeout(() => {
      if (!this.adjustmentState?.lastSelectionRange) return;
      this.persistAdjustment(this.adjustmentState.lastSelectionRange);
    }, ReaderHighlighterPlugin.TOUCHEND_PERSIST_DELAY_MS);
  }

  private async persistAdjustment(range: Range): Promise<void> {
    if (!this.adjustmentState) return;

    const newText = this.serializeRangeToMarkdown(range);
    if (!newText) {
      console.warn('[Reader Highlighter] Could not serialize adjusted selection');
      return;
    }

    // Skip if text unchanged
    if (newText === this.adjustmentState.originalText) {
      return;
    }

    const success = await this.persistAdjustedHighlight(
      this.adjustmentState.file,
      this.adjustmentState.originalText,
      newText
    );

    if (success && this.adjustmentState) {
      // Update state to reflect new text (in case user continues adjusting)
      this.adjustmentState.originalText = newText;
      console.debug('[Reader Highlighter] Adjusted highlight to:', newText);
    }
  }

  // --- Floating Remove Button ---

  private showRemoveButton(mark: HTMLElement, file: TFile | null, highlightText: string): void {
    // Dismiss any existing button first
    this.dismissRemoveButton();

    // Create button element
    const button = document.createElement('button');
    button.className = 'reader-highlight-remove-button';
    button.setAttribute('aria-label', 'Remove highlight');
    button.innerHTML = '×';

    // Position the button centered below the highlight
    const rect = mark.getBoundingClientRect();
    const buttonWidth = this.isMobile() ? 44 : 32;
    const margin = 8;

    // Position below the highlight
    const top = rect.bottom + margin + window.scrollY;

    // Center horizontally on the highlight
    let left = rect.left + rect.width / 2 - buttonWidth / 2 + window.scrollX;
    // Keep within viewport
    if (left + buttonWidth > window.innerWidth - margin) {
      left = window.innerWidth - buttonWidth - margin;
    }
    left = Math.max(margin, left);

    button.style.top = `${top}px`;
    button.style.left = `${left}px`;

    // Add to document
    document.body.appendChild(button);

    // Set up click handler to remove highlight
    button.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.removeHighlight(file, highlightText);
    });

    // Set up keyboard handler for accessibility
    button.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        evt.stopPropagation();
        this.removeHighlight(file, highlightText);
      } else if (evt.key === 'Escape') {
        this.dismissRemoveButton();
      }
    });

    // Store state
    this.removeButtonState = {
      button,
      mark,
      file,
      highlightText,
    };

    // Focus button for keyboard accessibility (desktop)
    if (!this.isMobile()) {
      button.focus();
    }

    console.debug('[Reader Highlighter] Showing remove button for:', highlightText);
  }

  private dismissRemoveButton(): void {
    if (!this.removeButtonState) return;

    this.removeButtonState.button.remove();
    this.removeButtonState = undefined;

    console.debug('[Reader Highlighter] Dismissed remove button');
  }

  private async removeHighlight(file: TFile | null, highlightText: string): Promise<void> {
    this.dismissRemoveButton();

    if (!file || !highlightText) return;

    const wrapped = `==${highlightText}==`;

    try {
      const content = await this.app.vault.read(file);
      const matches = this.findAllOccurrences(content, wrapped);

      if (matches.length !== 1) {
        console.warn('[Reader Highlighter] Ambiguous highlight, aborting removal.');
        return;
      }

      const idx = matches[0];
      const newContent = content.slice(0, idx) + highlightText + content.slice(idx + wrapped.length);
      await this.app.vault.modify(file, newContent);

      console.debug('[Reader Highlighter] Removed highlight:', highlightText);
    } catch (error) {
      console.error('[Reader Highlighter] Failed to remove highlight', error);
    }
  }
}
