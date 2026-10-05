package org.textphone.launcher;

import android.content.Context;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.MotionEvent;
import android.widget.EditText;
import java.util.ArrayDeque;

/** Native typing/scrolling with an in-window formatting wheel and a native selection choice. */
final class MarkdownEditor extends EditText {
    private boolean changing;
    private int changedAt, inserted, replaced;
    private static final class History {
        final NoteMarkdown.Change before;
        final String after;
        History(NoteMarkdown.Change before, String after) { this.before = before; this.after = after; }
    }
    private final ArrayDeque<History> undo = new ArrayDeque<>();
    private NoteFormatWheel wheel;
    private boolean nativeSelection, trackingWheel;
    private float downX, downY, rawX, rawY;
    MarkdownEditor(Context context) {
        super(context);
        addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) { changedAt = start; inserted = count; replaced = before; }
            public void afterTextChanged(Editable text) {
                if (changing || inserted != 1 || replaced != 0 || changedAt >= text.length() || text.charAt(changedAt) != '\n') return;
                NoteMarkdown.Change next = NoteMarkdown.continueLine(text.toString(), changedAt + 1);
                if (next != null && next.text.length() <= PlannerStore.NOTE_LIMIT) { remember(next); apply(next); }
            }
        });
    }
    void configureWheel(Runnable more) {
        wheel = new NoteFormatWheel(this, more);
        setOnLongClickListener(v -> {
            if (nativeSelection) return false;
            int offset = getOffsetForPosition(downX, downY), start = getSelectionStart(), end = getSelectionEnd();
            if (start == end || offset < Math.min(start, end) || offset > Math.max(start, end)) setSelection(Math.max(0, Math.min(length(), offset)));
            trackingWheel = openWheel(rawX, rawY); setPressed(false); return true;
        });
    }
    boolean openWheel(float x, float y) {
        boolean opened = wheel != null && wheel.show(x, y);
        if (opened && getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
        return opened;
    }
    void trackWheel(MotionEvent event) { if (wheel != null) wheel.track(event); }
    boolean wheelShowing() { return wheel != null && wheel.showing(); }
    void dismissWheel() { if (wheel != null) wheel.dismiss(); }
    void nativeSelection() {
        nativeSelection = true;
        try { requestFocus(); super.performLongClick(); }
        finally { nativeSelection = false; }
    }
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = event.getX(); downY = event.getY(); rawX = event.getRawX(); rawY = event.getRawY(); trackingWheel = false; }
        if (trackingWheel) {
            trackWheel(event);
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) { trackingWheel = false; setPressed(false); }
            return true;
        }
        return super.onTouchEvent(event);
    }
    @Override protected void onDetachedFromWindow() { dismissWheel(); super.onDetachedFromWindow(); }
    boolean format(NoteMarkdown.Style style) {
        NoteMarkdown.Change next = NoteMarkdown.format(getText().toString(), getSelectionStart(), getSelectionEnd(), style);
        if (next.text.length() > PlannerStore.NOTE_LIMIT) return false;
        remember(next); apply(next); requestFocus(); return true;
    }
    private void remember(NoteMarkdown.Change next) {
        if (undo.size() == 16) undo.removeFirst();
        undo.addLast(new History(new NoteMarkdown.Change(getText().toString(), Math.max(0, getSelectionStart()), Math.max(0, getSelectionEnd())), next.text));
    }
    boolean undoFormat() {
        if (undo.isEmpty()) return false;
        if (!undo.peekLast().after.contentEquals(getText())) { undo.clear(); return false; }
        apply(undo.removeLast().before); return true;
    }
    private void apply(NoteMarkdown.Change value) {
        changing = true;
        try { getText().replace(0, length(), value.text); setSelection(Math.min(value.start, length()), Math.min(value.end, length())); }
        finally { changing = false; }
    }
}
