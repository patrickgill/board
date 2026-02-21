import { lineNumbers, EditorView, Decoration, WidgetType, keymap } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';

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
// Marker-hiding field: hides #, **, *, ` when cursor is NOT on that line
// ---------------------------------------------------------------------------

const HIDE_MARKERS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark']);

function buildMarkerHideDecos(state) {
    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const decos = [];

    syntaxTree(state).iterate({
        enter(node) {
            if (!HIDE_MARKERS.has(node.name)) return;

            // Show raw markers on the line the cursor is on
            const nodeLine = state.doc.lineAt(node.from).number;
            if (nodeLine === cursorLine) return;

            let from = node.from;
            let to = node.to;

            // For header marks, also hide the trailing space (e.g. "## " → hidden)
            if (node.name === 'HeaderMark') {
                const lineEnd = state.doc.lineAt(from).to;
                if (to < lineEnd && state.doc.sliceString(to, to + 1) === ' ') {
                    to += 1;
                }
            }

            decos.push(Decoration.replace({}).range(from, to));
        }
    });

    return Decoration.set(decos, true);
}

const markerHideField = StateField.define({
    create(state) { return buildMarkerHideDecos(state); },
    update(_decos, tr) { return buildMarkerHideDecos(tr.state); },
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
        '.cm-activeLine': {
            background: dark ? '#2a2a2a' : '#f0f0f0',
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
// GoEditor.init
// ---------------------------------------------------------------------------

function init(element, { theme = 'dark', onChange, onCursorChange } = {}) {
    const themeCompartment = new Compartment();

    const startState = EditorState.create({
        doc: '',
        extensions: [
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            markdown(),
            lineNumbers(),
            EditorView.lineWrapping,
            syntaxHighlighting(defaultHighlightStyle),
            remoteCursorField,
            suppressField,
            themeCompartment.of(buildTheme(theme)),
            headingLineField,
            markerHideField,
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
