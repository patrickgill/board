import { lineNumbers, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, EditorView, Decoration, WidgetType, keymap, scrollPastEnd } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { defaultKeymap, historyKeymap, history, indentWithTab, moveLineUp, moveLineDown } from '@codemirror/commands';

// ---------------------------------------------------------------------------
// Remote cursor effects & state field
// ---------------------------------------------------------------------------

const setCursorEffect = StateEffect.define();
const clearCursorEffect = StateEffect.define();

const remoteCursorField = StateField.define({
    create() { return Decoration.none; },
    update(decos, tr) {
        decos = decos.map(tr.changes);
        for (const e of tr.effects) {
            if (e.is(setCursorEffect)) {
                const { id, offset, colorIndex } = e.value;
                const pos = Math.min(offset, tr.newDoc.length);
                const mark = Decoration.widget({
                    widget: new RemoteCursorWidget(id, colorIndex),
                    side: 1,
                });
                decos = decos.update({
                    filter: (_f, _t, deco) => deco.spec.widget?.id !== id,
                    add: [mark.range(pos)],
                });
            } else if (e.is(clearCursorEffect)) {
                const id = e.value;
                decos = decos.update({
                    filter: (_f, _t, deco) => deco.spec.widget?.id !== id,
                });
            }
        }
        return decos;
    },
    provide: f => EditorView.decorations.from(f),
});

class RemoteCursorWidget extends WidgetType {
    constructor(id, colorIndex) {
        super();
        this.id = id;
        this.colorIndex = colorIndex;
    }
    toDOM() {
        const el = document.createElement('span');
        el.className = `cm-remote-cursor cursor-color-${this.colorIndex}`;
        return el;
    }
    eq(other) {
        return other.id === this.id && other.colorIndex === this.colorIndex;
    }
    ignoreEvent() { return true; }
}

// ---------------------------------------------------------------------------
// Heading line-size decorations (StateField — Decoration.line is block-level)
// ---------------------------------------------------------------------------

const HEADING_LINE_CLASSES = {
    'ATXHeading1': 'cm-md-h1',
    'ATXHeading2': 'cm-md-h2',
    'ATXHeading3': 'cm-md-h3',
    'ATXHeading4': 'cm-md-h4',
    'ATXHeading5': 'cm-md-h5',
    'ATXHeading6': 'cm-md-h6',
    'SetextHeading1': 'cm-md-h1',
    'SetextHeading2': 'cm-md-h2',
};

function buildHeadingDecos(state) {
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const decos = [];
    syntaxTree(state).iterate({
        enter(node) {
            const cls = HEADING_LINE_CLASSES[node.name];
            if (!cls) return;
            const line = state.doc.lineAt(node.from);
            // Only style heading lines where the cursor is NOT present
            // (when cursor is on the line, raw # markers are visible, so
            // extra size on the # looks odd — still apply, Obsidian does too)
            decos.push(Decoration.line({ class: cls }).range(line.from));
            return false;
        }
    });
    return Decoration.set(decos, true);
}

const headingLineField = StateField.define({
    create(state) { return buildHeadingDecos(state); },
    update(_decos, tr) { return buildHeadingDecos(tr.state); },
    provide: f => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Live-preview field: hides markers, renders images/links/HRs
// ---------------------------------------------------------------------------

const HIDE_MARKERS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark']);

// Parse [text](url) or ![alt](url) — finds "](" separator, takes url up to last ")"
function parseMarkdownLink(text) {
    const sep = text.indexOf('](');
    if (sep < 0) return null;
    const label = text.slice(text.indexOf('[') + 1, sep);
    const url = text.slice(sep + 2, text.lastIndexOf(')'));
    return { label, url };
}

class ImageWidget extends WidgetType {
    constructor(src, alt) {
        super();
        this.src = src;
        this.alt = alt;
    }
    toDOM() {
        const img = document.createElement('img');
        img.src = this.src;
        img.alt = this.alt;
        img.title = this.alt;
        img.className = 'cm-md-image';
        img.onerror = () => { img.style.display = 'none'; };
        return img;
    }
    eq(other) {
        return this.src === other.src && this.alt === other.alt;
    }
    ignoreEvent() { return true; }
}

class HRWidget extends WidgetType {
    toDOM() {
        const el = document.createElement('span');
        el.className = 'cm-md-hr';
        return el;
    }
    eq() { return true; }
    ignoreEvent() { return true; }
}

function buildLivePreviewDecos(state) {
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const decos = [];

    syntaxTree(state).iterate({
        enter(node) {
            // --- Simple marker hiding (HeaderMark, EmphasisMark, CodeMark) ---
            if (HIDE_MARKERS.has(node.name)) {
                const nodeLine = state.doc.lineAt(node.from).number;
                if (nodeLine === cursorLine) return;

                let from = node.from;
                let to = node.to;

                // For header marks, also hide the trailing space ("## " → hidden)
                if (node.name === 'HeaderMark') {
                    const lineEnd = state.doc.lineAt(from).to;
                    if (to < lineEnd && state.doc.sliceString(to, to + 1) === ' ') {
                        to += 1;
                    }
                }

                decos.push(Decoration.replace({}).range(from, to));
                return;
            }

            // --- Image: replace ![alt](url) with <img> widget ---
            if (node.name === 'Image') {
                const nodeLine = state.doc.lineAt(node.from).number;
                if (nodeLine === cursorLine) return false;
                const text = state.doc.sliceString(node.from, node.to);
                const link = parseMarkdownLink(text);
                if (link) {
                    decos.push(Decoration.replace({
                        widget: new ImageWidget(link.url, link.label),
                    }).range(node.from, node.to));
                }
                return false; // don't recurse — whole node replaced
            }

            // --- Link: hide [ and ](url), style visible text ---
            if (node.name === 'Link') {
                const nodeLine = state.doc.lineAt(node.from).number;
                if (nodeLine === cursorLine) return; // show raw on cursor line
                const marks = node.node.getChildren('LinkMark');
                if (marks.length >= 2) {
                    // Hide opening [
                    decos.push(Decoration.replace({}).range(marks[0].from, marks[0].to));
                    // Hide from ] to end of Link — covers ](url)
                    decos.push(Decoration.replace({}).range(marks[1].from, node.to));
                    // Style remaining text as a link
                    const textFrom = marks[0].to;
                    const textTo = marks[1].from;
                    if (textFrom < textTo) {
                        decos.push(Decoration.mark({ class: 'cm-md-link' }).range(textFrom, textTo));
                    }
                }
                // Don't return false — let child EmphasisMark/CodeMark be hidden too
                return;
            }

            // --- Horizontal rule: replace --- with styled line ---
            if (node.name === 'HorizontalRule') {
                const nodeLine = state.doc.lineAt(node.from).number;
                if (nodeLine === cursorLine) return false;
                decos.push(Decoration.replace({
                    widget: new HRWidget(),
                }).range(node.from, node.to));
                return false;
            }
        }
    });

    return Decoration.set(decos, true);
}

const livePreviewField = StateField.define({
    create(state) { return buildLivePreviewDecos(state); },
    update(_decos, tr) { return buildLivePreviewDecos(tr.state); },
    provide: f => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function buildTheme(name) {
    const dark = name === 'dark';
    return EditorView.theme({
        '&': {
            height: '100%',
            fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontSize: '15px',
            background: dark ? '#1e1e1e' : '#ffffff',
            color: dark ? '#cccccc' : '#333333',
        },
        '.cm-content': {
            padding: '20px 0',
            lineHeight: '1.6',
            caretColor: dark ? '#aeafad' : '#000000',
        },
        '.cm-line': {
            padding: '0 20px',
        },
        '.cm-cursor': {
            borderLeftColor: dark ? '#aeafad' : '#000000',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            background: dark ? '#264f78 !important' : '#add6ff !important',
        },
        '.cm-gutters': {
            background: dark ? '#1e1e1e' : '#ffffff',
            color: dark ? '#555' : '#aaa',
            border: 'none',
            borderRight: `1px solid ${dark ? '#333' : '#e0e0e0'}`,
        },
        '.cm-lineNumbers .cm-gutterElement': {
            padding: '0 8px',
            minWidth: '40px',
        },
        '.cm-scroller': {
            fontFamily: 'inherit',
        },
    }, { dark });
}

// ---------------------------------------------------------------------------
// suppress onChange flag (via StateField + StateEffect)
// ---------------------------------------------------------------------------

const suppressEffect = StateEffect.define();
const suppressField = StateField.define({
    create: () => false,
    update(val, tr) {
        for (const e of tr.effects) {
            if (e.is(suppressEffect)) return e.value;
        }
        return val;
    },
});

// ---------------------------------------------------------------------------
// hashCode helper
// ---------------------------------------------------------------------------

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

// ---------------------------------------------------------------------------
// Markdown keyboard shortcuts (bold, italic, link)
// ---------------------------------------------------------------------------

function wrapWith(view, prefix, suffix) {
    const { from, to } = view.state.selection.main;
    if (from === to) {
        // Empty selection: insert markers and place cursor between
        const insert = prefix + suffix;
        view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + prefix.length },
        });
        return true;
    }
    const selected = view.state.sliceDoc(from, to);
    // Check if already wrapped — unwrap
    if (selected.startsWith(prefix) && selected.endsWith(suffix) && selected.length >= prefix.length + suffix.length) {
        const inner = selected.slice(prefix.length, selected.length - suffix.length);
        view.dispatch({
            changes: { from, to, insert: inner },
            selection: { anchor: from, head: from + inner.length },
        });
        return true;
    }
    // Wrap selection
    const wrapped = prefix + selected + suffix;
    view.dispatch({
        changes: { from, to, insert: wrapped },
        selection: { anchor: from + prefix.length, head: to + prefix.length },
    });
    return true;
}

function insertLink(view) {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const linkText = `[${selected}](url)`;
    const urlStart = from + selected.length + 3; // past [selected](
    const urlEnd = urlStart + 3; // length of "url"
    view.dispatch({
        changes: { from, to, insert: linkText },
        selection: { anchor: urlStart, head: urlEnd },
    });
    return true;
}

const markdownKeymap = [
    { key: 'Mod-b', run: (view) => wrapWith(view, '**', '**') },
    { key: 'Mod-i', run: (view) => wrapWith(view, '*', '*') },
    { key: 'Mod-k', run: insertLink },
    { key: 'Alt-ArrowUp', run: moveLineUp },
    { key: 'Alt-ArrowDown', run: moveLineDown },
];

function findLinkUrl(view, pos) {
    let node = syntaxTree(view.state).resolve(pos);
    while (node) {
        if (node.name === 'Link') {
            const link = parseMarkdownLink(view.state.sliceDoc(node.from, node.to));
            if (link) return link.url;
        }
        node = node.parent;
    }
    return null;
}

const ctrlClickLink = EditorView.domEventHandlers({
    mousedown(event, view) {
        if (!event.metaKey && !event.ctrlKey) return false;
        const linkEl = event.target.closest('.cm-md-link');
        const pos = linkEl ? view.posAtDOM(linkEl) : view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const url = findLinkUrl(view, pos);
        if (!url) return false;
        event.preventDefault();
        window.open(url, '_blank');
        return true;
    },
});

// ---------------------------------------------------------------------------
// GoEditor.init
// ---------------------------------------------------------------------------

function init(element, { theme = 'dark', onChange, onCursorChange } = {}) {
    const themeCompartment = new Compartment();

    const startState = EditorState.create({
        doc: '',
        extensions: [
            history(),
            keymap.of([indentWithTab, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
            markdown(),
            lineNumbers(),
            highlightActiveLineGutter(),
            drawSelection(),
            dropCursor(),
            rectangularSelection(),
            scrollPastEnd(),
            EditorView.lineWrapping,
            syntaxHighlighting(defaultHighlightStyle),
            remoteCursorField,
            suppressField,
            themeCompartment.of(buildTheme(theme)),
            headingLineField,
            livePreviewField,
            ctrlClickLink,
            EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    if (!update.state.field(suppressField) && onChange) {
                        onChange(update.state.doc.toString());
                    }
                }
                if (update.selectionSet && onCursorChange) {
                    onCursorChange(update.state.selection.main.head);
                }
            }),
        ],
    });

    const view = new EditorView({ state: startState, parent: element });

    return {
        getValue() {
            return view.state.doc.toString();
        },
        setValue(text) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text },
                effects: suppressEffect.of(true),
            });
            view.dispatch({ effects: suppressEffect.of(false) });
        },
        setTheme(name) {
            view.dispatch({
                effects: themeCompartment.reconfigure(buildTheme(name)),
            });
        },
        getCursorOffset() {
            return view.state.selection.main.head;
        },
        setCursorOffset(n) {
            const pos = Math.min(n, view.state.doc.length);
            view.dispatch({ selection: { anchor: pos } });
        },
        getSelection() {
            const sel = view.state.selection.main;
            return { from: sel.from, to: sel.to };
        },
        insertAt(from, to, text) {
            view.dispatch({ changes: { from, to, insert: text } });
        },
        setRemoteCursor(id, offset) {
            const colorIndex = Math.abs(hashCode(id)) % 8;
            view.dispatch({
                effects: setCursorEffect.of({ id, offset, colorIndex }),
            });
        },
        clearRemoteCursor(id) {
            view.dispatch({ effects: clearCursorEffect.of(id) });
        },
        destroy() {
            view.destroy();
        },
    };
}

window.GoEditor = { init };
