package org.textphone.launcher;

import android.content.Context;
import android.view.MotionEvent;
import android.widget.TextView;

/** Tap or hold to open the editor's wheel; all touch capture stays inside the app. */
@android.annotation.SuppressLint("ViewConstructor")
final class NoteFormatControl extends TextView {
    private final MarkdownEditor editor;
    private float rawX, rawY;
    private boolean tracking;
    NoteFormatControl(Context context, MarkdownEditor editor) {
        super(context); this.editor = editor; setText("Format");
        setContentDescription("Format note. Tap or hold for the formatting wheel, then choose an option.");
        PocketDesign.text(this, PocketDesign.SMALL, PocketDesign.MUTED); PocketDesign.control(this); PocketDesign.quiet(this, PocketDesign.MUTED);
        setMinHeight(PocketDesign.dp(context, PocketDesign.ROW));
        setOnClickListener(v -> { int[] at = new int[2]; getLocationOnScreen(at); editor.openWheel(at[0] + getWidth() / 2f, at[1] + getHeight() / 2f); });
        setOnLongClickListener(v -> { tracking = editor.openWheel(rawX, rawY); setPressed(false); return true; });
    }
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { rawX = event.getRawX(); rawY = event.getRawY(); tracking = false; }
        if (tracking) {
            editor.trackWheel(event);
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) { tracking = false; setPressed(false); }
            return true;
        }
        return super.onTouchEvent(event);
    }
    @Override public boolean performClick() { return super.performClick(); }
}
