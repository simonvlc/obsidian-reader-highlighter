import { MarkdownView, Platform, Plugin, TFile } from 'obsidian';

// Type for identifying which handle is being dragged
type DragHandle = 'start' | 'end';

interface HandleState {
  root: HTMLElement;
  host: HTMLElement;
  block: HTMLElement;
  range: Range;
  highlightText: string;
  file: TFile | null;
  layer: HTMLElement;
  startHandle: HTMLElement;
  endHandle: HTMLElement;
  active?: DragHandle;
  activeHandleEl?: HTMLElement;
  previewRange?: Range;
  originalPosition?: string;
  pointerId?: number;
  touchId?: number;
}

export default class ReaderHighlighterPlugin extends Plugin {
  private boundContainers = new WeakSet<HTMLElement>();
  private boundScrollHosts = new WeakSet<HTMLElement>();
  private documentEventsBound = false;
  private handleState?: HandleState;
  private dragFrame?: number;

  async onload() {
    this.refreshPreviewBindings();
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.refreshPreviewBindings();
      })
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.refreshPreviewBindings();
      })
    );
  }

  onunload() {
    this.removeHandles();
  }

  private refreshPreviewBindings() {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (view.getMode() !== 'preview') continue;
      this.attachPreviewHandlers(view);
    }
  }

  private attachPreviewHandlers(view: MarkdownView) {
    const container = (view as any).previewMode?.containerEl as HTMLElement | undefined;
    if (!container || this.boundContainers.has(container)) return;
    this.boundContainers.add(container);

    this.registerDomEvent(container, 'mouseup', (evt) => {
      this.handleSelectionEvent(evt, view, container);
    });
    this.registerDomEvent(container, 'keyup', (evt) => {
      this.handleSelectionEvent(evt, view, container);
    });
    this.registerDomEvent(container, 'touchend', (evt) => {
      window.setTimeout(() => this.handleSelectionEvent(evt, view, container), 10);
    });
    this.registerDomEvent(container, 'dblclick', (evt) => {
      this.handleDoubleClick(evt, view, container);
    });
    this.registerDomEvent(
      container,
      'touchstart',
      (evt) => {
        this.handleTouchStart(evt, container);
      },
      { passive: false }
    );
    this.registerDomEvent(container, 'pointerdown', (evt) => {
      this.handlePointerDown(evt, container);
    });
    if (!this.documentEventsBound) {
      this.documentEventsBound = true;
      this.registerDomEvent(
        document,
        'touchmove',
        (evt) => {
          this.handleTouchMove(evt);
        },
        { passive: false, capture: true }
      );
      this.registerDomEvent(
        document,
        'touchend',
        (evt) => {
          this.handleTouchEnd(evt);
        },
        { passive: false, capture: true }
      );
      this.registerDomEvent(
        document,
        'touchcancel',
        (evt) => {
          this.handleTouchCancel(evt);
        },
        { passive: false, capture: true }
      );
      this.registerDomEvent(document, 'pointermove', (evt) => {
        this.handlePointerMove(evt);
      }, true);
      this.registerDomEvent(document, 'pointerup', (evt) => {
        this.handlePointerUp(evt);
      }, true);
      this.registerDomEvent(window, 'scroll', () => {
        this.positionHandles();
      });
    }
    this.registerDomEvent(container, 'scroll', () => {
      this.positionHandles();
    });
    this.registerDomEvent(container, 'click', (evt) => {
      this.dismissHandlesIfNeeded(evt, container);
    });
  }

  private async handleSelectionEvent(event: Event, view: MarkdownView, container: HTMLElement) {
    if (view.getMode() !== 'preview') return;
    if (event instanceof MouseEvent && event.detail >= 2) return;
    if (this.handleState?.active) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0).cloneRange();

    const startBlock = this.getBlock(range.startContainer);
    const endBlock = this.getBlock(range.endContainer);
    if (!startBlock || !endBlock || startBlock !== endBlock) return;

    const markdown = this.serializeRangeToMarkdown(range);
    if (!markdown) return;

    const persisted = await this.persistHighlight(view.file, markdown);
    if (persisted && this.isMobile()) {
      this.showHandles(range, startBlock, container, markdown, view.file);
    }
    selection.removeAllRanges();
  }

  private async handleDoubleClick(event: MouseEvent, view: MarkdownView, container: HTMLElement) {
    if (view.getMode() !== 'preview') return;
    const target = event.target as Node | null;
    if (!target || !container.contains(target)) return;
    const block = this.getBlock(target);
    if (!block) return;

    const range = document.createRange();
    range.selectNodeContents(block);
    const markdown = this.serializeRangeToMarkdown(range);
    if (!markdown) return;

    const persisted = await this.persistHighlight(view.file, markdown);
    if (persisted && this.isMobile()) {
      this.showHandles(range, block, container, markdown, view.file);
    }
    window.getSelection()?.removeAllRanges();
  }

  private getBlock(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) return null;
    const block = element.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6');
    return block instanceof HTMLElement ? block : null;
  }

  private serializeRangeToMarkdown(range: Range): string {
    const fragment = range.cloneContents();
    const markdown = this.fragmentToMarkdown(fragment).trim();
    return markdown;
  }

  private fragmentToMarkdown(fragment: DocumentFragment): string {
    let buffer = '';
    fragment.childNodes.forEach((node) => {
      buffer += this.nodeToMarkdown(node);
    });
    return buffer;
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
    const selection = markdown;
    const wrapped = `==${selection}==`;

    try {
      const content = await this.app.vault.read(file);

      const existingMatches = this.findAllOccurrences(content, wrapped);
      if (existingMatches.length > 1) {
        console.warn('[Reader Highlighter] Ambiguous existing highlight, aborting removal.');
        return false;
      }

      if (existingMatches.length === 1) {
        const existingIndex = existingMatches[0];
        const newContent =
          content.slice(0, existingIndex) +
          selection +
          content.slice(existingIndex + wrapped.length);
        await this.app.vault.modify(file, newContent);
        return true;
      }

      const positions = this.findOccurrencesOutsideHighlight(content, selection);
      if (positions.length !== 1) {
        console.warn('[Reader Highlighter] Ambiguous selection, aborting highlight.');
        return false;
      }

      const idx = positions[0];
      const newContent = content.slice(0, idx) + wrapped + content.slice(idx + selection.length);
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
    const newWrapped = `==${newText}==`;
    if (originalWrapped === newWrapped) return true;

    try {
      const content = await this.app.vault.read(file);
      const matches = this.findAllOccurrences(content, originalWrapped);
      if (matches.length !== 1) {
        console.warn('[Reader Highlighter] Ambiguous existing highlight, aborting adjustment.');
        return false;
      }

      const idx = matches[0];
      const newContent =
        content.slice(0, idx) + newWrapped + content.slice(idx + originalWrapped.length);
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
    return Platform.isMobile || Platform.isPhone || this.app.isMobile;
  }

  // Handle rendering and drag-to-adjust on mobile
  private showHandles(
    range: Range,
    block: HTMLElement,
    rootContainer: HTMLElement,
    highlightText: string,
    file: TFile | null
  ) {
    if (!this.isMobile()) return;
    this.removeHandles();

    const host = this.findScrollContainer(block, rootContainer) ?? rootContainer;

    const computedPosition = getComputedStyle(host).position;
    const originalPosition =
      computedPosition === 'static' ? host.style.position || undefined : undefined;
    if (computedPosition === 'static') {
      host.style.position = 'relative';
    }

    const layer = document.createElement('div');
    layer.className = 'reader-highlight-handle-layer';
    host.appendChild(layer);

    const startHandle = document.createElement('div');
    startHandle.className = 'reader-highlight-handle';
    startHandle.dataset.handle = 'start';

    const endHandle = document.createElement('div');
    endHandle.className = 'reader-highlight-handle';
    endHandle.dataset.handle = 'end';

    layer.appendChild(startHandle);
    layer.appendChild(endHandle);

    this.handleState = {
      root: rootContainer,
      host,
      block,
      range: range.cloneRange(),
      highlightText,
      file,
      layer,
      startHandle,
      endHandle,
      originalPosition
    };

    if (!this.boundScrollHosts.has(host)) {
      this.boundScrollHosts.add(host);
      this.registerDomEvent(host, 'scroll', () => this.positionHandles());
    }

    this.positionHandles();
  }

  private positionHandles(rangeOverride?: Range) {
    if (!this.handleState) return;
    const range = rangeOverride ?? this.handleState.previewRange ?? this.handleState.range;
    const rects = range.getClientRects();
    if (!rects.length) return;

    const hostRect = this.handleState.host.getBoundingClientRect();
    const scrollLeft = this.handleState.host.scrollLeft;
    const scrollTop = this.handleState.host.scrollTop;
    const startRect = rects[0];
    const endRect = rects[rects.length - 1];

    const startLeft = startRect.left - hostRect.left + scrollLeft;
    const startTop = startRect.bottom - hostRect.top + scrollTop;
    const endLeft = endRect.right - hostRect.left + scrollLeft;
    const endTop = endRect.bottom - hostRect.top + scrollTop;

    this.handleState.startHandle.style.left = `${startLeft}px`;
    this.handleState.startHandle.style.top = `${startTop}px`;
    this.handleState.endHandle.style.left = `${endLeft}px`;
    this.handleState.endHandle.style.top = `${endTop}px`;
  }

  private handlePointerDown(event: PointerEvent, container: HTMLElement) {
    if (!this.isMobile()) return;
    const target = this.resolveHandleTarget(event.target, event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const handleType = (target.dataset.handle as DragHandle | undefined) ?? 'start';
    if (!this.handleState || this.handleState.root !== container) return;
    target.setPointerCapture(event.pointerId);
    this.handleState.active = handleType;
    this.setActiveHandle(target);
    this.handleState.pointerId = event.pointerId;
    this.handleState.touchId = undefined;
  }

  private handleTouchStart(event: TouchEvent, container: HTMLElement) {
    if (!this.isMobile()) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const target = this.resolveHandleTarget(event.target, touch.clientX, touch.clientY);
    if (!target) return;
    if (!this.handleState || this.handleState.root !== container) return;
    if (this.handleState.pointerId !== undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const handleType = (target.dataset.handle as DragHandle | undefined) ?? 'start';
    this.handleState.active = handleType;
    this.setActiveHandle(target);
    this.handleState.touchId = touch.identifier;
    this.handleState.pointerId = undefined;
  }

  private handlePointerMove(event: PointerEvent) {
    if (!this.isMobile()) return;
    if (!this.handleState || !this.handleState.active) return;
    if (this.handleState.pointerId !== undefined && this.handleState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    this.setDragging(true);
    if (this.dragFrame) {
      cancelAnimationFrame(this.dragFrame);
    }

    this.dragFrame = requestAnimationFrame(() => {
      this.updateDragAtPoint(event.clientX, event.clientY);
    });
  }

  private handleTouchMove(event: TouchEvent) {
    if (!this.isMobile()) return;
    if (!this.handleState || !this.handleState.active) return;
    if (this.handleState.pointerId !== undefined) return;
    if (this.handleState.touchId === undefined) return;
    const touch = this.getTouchById(event.touches, this.handleState.touchId);
    if (!touch) return;
    event.preventDefault();
    this.setDragging(true);
    if (this.dragFrame) {
      cancelAnimationFrame(this.dragFrame);
    }
    this.dragFrame = requestAnimationFrame(() => {
      this.updateDragAtPoint(touch.clientX, touch.clientY);
    });
  }

  private async handleTouchEnd(event: TouchEvent) {
    if (!this.isMobile()) return;
    if (!this.handleState || !this.handleState.active) return;
    if (this.handleState.pointerId !== undefined) return;
    if (this.handleState.touchId === undefined) return;
    const touch = this.getTouchById(event.changedTouches, this.handleState.touchId);
    if (!touch) return;
    event.preventDefault();
    await this.finalizeDrag();
  }

  private handleTouchCancel(event: TouchEvent) {
    if (!this.isMobile()) return;
    if (!this.handleState || !this.handleState.active) return;
    if (this.handleState.pointerId !== undefined) return;
    if (this.handleState.touchId === undefined) return;
    const touch = this.getTouchById(event.changedTouches, this.handleState.touchId);
    if (!touch) return;
    event.preventDefault();
    this.clearPreviewSelection();
  }

  private async handlePointerUp(event: PointerEvent) {
    if (!this.isMobile()) return;
    if (!this.handleState || !this.handleState.active) return;
    if (this.handleState.pointerId !== undefined && this.handleState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    await this.finalizeDrag();
  }

  private updateDragAtPoint(clientX: number, clientY: number) {
    if (!this.handleState || !this.handleState.active) return;
    const caretRange = this.withHandlesHiddenForHitTest(() =>
      this.rangeFromPoint(clientX, clientY)
    );
    if (!caretRange) return;
    const baseRange = this.handleState.previewRange ?? this.handleState.range;
    const isStartDrag = this.handleState.active === 'start';

    const startNode = isStartDrag ? caretRange.startContainer : baseRange.startContainer;
    const startOffset = isStartDrag ? caretRange.startOffset : baseRange.startOffset;
    const endNode = isStartDrag ? baseRange.endContainer : caretRange.startContainer;
    const endOffset = isStartDrag ? baseRange.endOffset : caretRange.startOffset;

    const ordered =
      this.comparePositions(startNode, startOffset, endNode, endOffset) <= 0
        ? {
            startNode,
            startOffset,
            endNode,
            endOffset
          }
        : {
            startNode: endNode,
            startOffset: endOffset,
            endNode: startNode,
            endOffset: startOffset
          };

    const newRange = document.createRange();
    newRange.setStart(ordered.startNode, ordered.startOffset);
    newRange.setEnd(ordered.endNode, ordered.endOffset);

    // Keep the drag limited to the original block
    const startBlock = this.getBlock(newRange.startContainer);
    const endBlock = this.getBlock(newRange.endContainer);
    if (
      !startBlock ||
      !endBlock ||
      startBlock !== this.handleState.block ||
      endBlock !== this.handleState.block
    ) {
      return;
    }

    this.handleState.previewRange = newRange;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(newRange);
    this.positionHandles(newRange);
  }

  private async finalizeDrag() {
    if (!this.handleState || !this.handleState.active) return;
    const range = this.handleState.previewRange ?? this.handleState.range;
    const block = this.getBlock(range.startContainer);
    if (!block || block !== this.handleState.block) {
      this.clearPreviewSelection();
      this.handleState.active = undefined;
      return;
    }

    const markdown = this.serializeRangeToMarkdown(range);
    if (!markdown) {
      this.clearPreviewSelection();
      this.handleState.active = undefined;
      return;
    }

    const file = this.handleState.file;
    const originalText = this.handleState.highlightText;
    const persisted = originalText
      ? await this.persistAdjustedHighlight(file, originalText, markdown)
      : await this.persistHighlight(file, markdown);
    if (persisted && this.handleState) {
      this.showHandles(range, block, this.handleState.root, markdown, file);
    }
    this.clearPreviewSelection();
  }

  private getTouchById(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i += 1) {
      const touch = list.item(i);
      if (touch && touch.identifier === id) return touch;
    }
    return null;
  }

  private dismissHandlesIfNeeded(event: MouseEvent, container: HTMLElement) {
    if (!this.isMobile()) return;
    if (!this.handleState || this.handleState.root !== container) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.classList.contains('reader-highlight-handle')) return;
    this.removeHandles();
  }

  private clearPreviewSelection() {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    if (this.handleState) {
      this.setActiveHandle(null);
      this.setDragging(false);
      this.handleState.active = undefined;
      this.handleState.previewRange = undefined;
      this.handleState.pointerId = undefined;
      this.handleState.touchId = undefined;
    }
  }

  private removeHandles() {
    if (!this.handleState) return;
    this.setActiveHandle(null);
    this.setDragging(false);
    this.handleState.layer.remove();
    if (this.handleState.originalPosition !== undefined) {
      this.handleState.host.style.position = this.handleState.originalPosition;
    }
    this.handleState = undefined;
  }

  private findScrollContainer(block: HTMLElement, root: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = block;
    while (el && el !== root) {
      if (this.isScrollable(el)) return el;
      el = el.parentElement;
    }
    return this.isScrollable(root) ? root : null;
  }

  private isScrollable(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    const canScrollY = el.scrollHeight > el.clientHeight + 1;
    const overflowY = style.overflowY;
    const scrollableY = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    return canScrollY && scrollableY;
  }

  private setActiveHandle(handle: HTMLElement | null) {
    if (!this.handleState) return;
    if (this.handleState.activeHandleEl) {
      this.handleState.activeHandleEl.classList.remove('reader-highlight-handle--active');
    }
    if (handle) {
      handle.classList.add('reader-highlight-handle--active');
      this.handleState.layer.classList.add('reader-highlight-handle-layer--active');
      this.handleState.activeHandleEl = handle;
    } else {
      this.handleState.layer.classList.remove('reader-highlight-handle-layer--active');
      this.handleState.activeHandleEl = undefined;
    }
  }

  private setDragging(active: boolean) {
    if (!this.handleState) return;
    if (active) {
      this.handleState.layer.classList.add('reader-highlight-handle-layer--dragging');
    } else {
      this.handleState.layer.classList.remove('reader-highlight-handle-layer--dragging');
    }
  }

  private resolveHandleTarget(
    target: EventTarget | null,
    clientX?: number,
    clientY?: number
  ): HTMLElement | null {
    if (target instanceof HTMLElement) {
      const handle = target.closest('.reader-highlight-handle');
      if (handle instanceof HTMLElement) return handle;
    }
    if (clientX !== undefined && clientY !== undefined) {
      const element = document.elementFromPoint(clientX, clientY);
      if (element instanceof HTMLElement) {
        const handle = element.closest('.reader-highlight-handle');
        if (handle instanceof HTMLElement) return handle;
      }
    }
    return null;
  }

  private comparePositions(
    startNode: Node,
    startOffset: number,
    endNode: Node,
    endOffset: number
  ): number {
    const rangeA = document.createRange();
    rangeA.setStart(startNode, startOffset);
    rangeA.setEnd(startNode, startOffset);

    const rangeB = document.createRange();
    rangeB.setStart(endNode, endOffset);
    rangeB.setEnd(endNode, endOffset);

    return rangeA.compareBoundaryPoints(Range.START_TO_START, rangeB);
  }

  private rangeFromPoint(x: number, y: number): Range | null {
    const doc = (this.handleState?.root?.ownerDocument ?? document) as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const caretRange = doc.caretRangeFromPoint?.(x, y);
    if (caretRange) return caretRange;
    const caretPos = doc.caretPositionFromPoint?.(x, y);
    if (caretPos) {
      const range = document.createRange();
      range.setStart(caretPos.offsetNode, caretPos.offset);
      range.collapse(true);
      return range;
    }
    return this.rangeFromPointFallback(doc, x, y);
  }

  private rangeFromPointFallback(doc: Document, x: number, y: number): Range | null {
    const element = doc.elementFromPoint(x, y);
    if (!element) return null;
    const scope = this.handleState?.block ?? element;
    const textNode = this.findNearestTextNode(scope, x, y);
    if (!textNode) return null;
    const offset = this.closestOffsetInTextNode(textNode, x, y);
    const range = doc.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    return range;
  }

  private findNearestTextNode(root: Element, x: number, y: number): Text | null {
    const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let bestNode: Text | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.length) continue;
      const range = (root.ownerDocument ?? document).createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (!rects.length) continue;

      for (const rect of Array.from(rects)) {
        const withinY = y >= rect.top && y <= rect.bottom;
        const verticalPenalty = withinY ? 0 : Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
        const horizontalPenalty =
          x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        const score = verticalPenalty * 1000 + horizontalPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestNode = node;
        }
      }
    }

    return bestNode;
  }

  private closestOffsetInTextNode(node: Text, x: number, y: number): number {
    const textLength = node.data.length;
    if (textLength === 0) return 0;
    const doc = node.ownerDocument ?? document;
    const range = doc.createRange();
    let low = 0;
    let high = textLength;
    let best = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      range.setStart(node, 0);
      range.setEnd(node, mid);
      const rects = range.getClientRects();
      if (!rects.length) {
        low = mid + 1;
        continue;
      }
      const lastRect = rects[rects.length - 1];
      const above = y < lastRect.top;
      const below = y > lastRect.bottom;

      if (above) {
        high = mid - 1;
        continue;
      }
      if (below) {
        low = mid + 1;
        continue;
      }

      // Same line as the touch point.
      if (x < lastRect.left) {
        high = mid - 1;
      } else if (x > lastRect.right) {
        best = mid;
        low = mid + 1;
      } else {
        best = mid;
        break;
      }
    }

    return Math.min(Math.max(best, 0), textLength);
  }

  private withHandlesHiddenForHitTest<T>(fn: () => T): T {
    if (!this.handleState) return fn();
    const previousPointer = this.handleState.layer.style.pointerEvents;
    const previousVisibility = this.handleState.layer.style.visibility;
    this.handleState.layer.style.pointerEvents = 'none';
    this.handleState.layer.style.visibility = 'hidden';
    const result = fn();
    this.handleState.layer.style.pointerEvents = previousPointer;
    this.handleState.layer.style.visibility = previousVisibility;
    return result;
  }
}
