package org.textphone.launcher;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Temporary in-window wheel. It never creates a system overlay or excludes Android edge gestures. */
final class NoteFormatWheel {
    private static final String[] LABELS = {"Heading", "Bullets", "Checks", "Bold", "Plain", "Undo", "Select", "More"};
    private static final NoteMarkdown.Style[] STYLES = {NoteMarkdown.Style.HEADING, NoteMarkdown.Style.BULLET,
            NoteMarkdown.Style.CHECKBOX, NoteMarkdown.Style.BOLD, NoteMarkdown.Style.PLAIN};
    private final MarkdownEditor editor;
    private final Runnable more;
    private ViewGroup host;
    private View underlay;
    private int underlayAccessibility;
    private WheelView view;
    private float originX, originY;
    private boolean moved;
    private int selected = -1;
    private android.window.OnBackInvokedCallback back;

    NoteFormatWheel(MarkdownEditor editor, Runnable more) { this.editor = editor; this.more = more; }
    boolean showing() { return view != null; }
    boolean show(float rawX, float rawY) {
        if (!(editor.getContext() instanceof Activity)) return false;
        dismiss();
        host = ((Activity) editor.getContext()).findViewById(android.R.id.content);
        if (host == null || host.getWidth() == 0 || host.getHeight() == 0) return false;
        Rect visible = new Rect(); host.getWindowVisibleDisplayFrame(visible);
        int[] position = new int[2]; host.getLocationOnScreen(position);
        int top = Math.max(0, visible.top - position[1]);
        int bottom = visible.bottom > visible.top ? Math.min(host.getHeight(), visible.bottom - position[1]) : host.getHeight();
        float radius = Math.min(dp(144), Math.min((host.getWidth() - dp(32)) / 2f, (bottom - top - dp(32)) / 2f));
        // A native list remains usable when a keyboard/landscape window is too short for eight large targets.
        if (radius < dp(108)) { more.run(); return false; }
        float centerX = Math.max(radius + dp(16), Math.min(host.getWidth() - radius - dp(16), rawX - position[0]));
        float centerY = Math.max(top + radius + dp(16), Math.min(bottom - radius - dp(16), rawY - position[1]));
        originX = rawX; originY = rawY; moved = false; selected = -1;
        underlay = host.getChildCount() == 0 ? null : host.getChildAt(0);
        if (underlay != null) { underlayAccessibility = underlay.getImportantForAccessibility(); underlay.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS); }
        view = new WheelView(centerX, centerY, radius); view.setTag("note_format_wheel");
        host.addView(view, new ViewGroup.LayoutParams(-1, -1));
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            back = this::dismiss;
            ((Activity) editor.getContext()).getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY, back);
        }
        if (android.os.Build.VERSION.SDK_INT >= 28) view.setAccessibilityPaneTitle("Format note");
        return true;
    }
    void track(MotionEvent event) {
        if (view == null) return;
        if (event.getActionMasked() == MotionEvent.ACTION_CANCEL || event.getPointerCount() != 1) { dismiss(); return; }
        float dx = event.getRawX() - originX, dy = event.getRawY() - originY;
        if (Math.hypot(dx, dy) > dp(24)) moved = true;
        int[] position = new int[2]; view.getLocationOnScreen(position);
        if (moved) highlight(view.indexAt(event.getRawX() - position[0], event.getRawY() - position[1], false));
        if (event.getActionMasked() == MotionEvent.ACTION_UP && moved) {
            if (selected >= 0) choose(selected); else dismiss();
        }
        // Releasing without moving leaves the wheel open for an ordinary tap or accessibility action.
    }
    void dismiss() {
        if (android.os.Build.VERSION.SDK_INT >= 33 && back != null) {
            ((Activity) editor.getContext()).getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(back); back = null;
        }
        WheelView old = view; view = null; selected = -1;
        if (old != null && old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
        if (underlay != null) underlay.setImportantForAccessibility(underlayAccessibility);
        underlay = null; host = null;
        if (editor.getParent() != null) editor.getParent().requestDisallowInterceptTouchEvent(false);
    }
    private void highlight(int index) {
        if (view == null || selected == index) return;
        selected = index;
        if (index >= 0) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        for (int i = 0; i < view.options.length; i++) view.options[i].setTextColor(i == index ? PocketDesign.INK : PocketDesign.WHITE);
        view.invalidate();
    }
    private void choose(int index) {
        if (view == null) return;
        dismiss();
        if (!editor.isAttachedToWindow()) return;
        if (index < STYLES.length) { if (!editor.format(STYLES[index])) Toast.makeText(editor.getContext(), "This note has reached its text limit.", Toast.LENGTH_SHORT).show(); }
        else if (index == 5) { if (!editor.undoFormat()) Toast.makeText(editor.getContext(), "No formatting to undo.", Toast.LENGTH_SHORT).show(); }
        else if (index == 6) editor.nativeSelection();
        else more.run();
    }
    private int dp(int value) { return PocketDesign.dp(editor.getContext(), value); }

    private final class WheelView extends FrameLayout {
        final TextView[] options = new TextView[LABELS.length];
        private final TextView cancel;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF bounds;
        private final float x, y, radius;
        WheelView(float x, float y, float radius) {
            super(editor.getContext()); this.x = x; this.y = y; this.radius = radius;
            bounds = new RectF(x - radius, y - radius, x + radius, y + radius);
            setWillNotDraw(false); setBackgroundColor(0xC0000000);
            for (int i = 0; i < options.length; i++) {
                final int index = i; TextView item = label(LABELS[i], PocketDesign.WHITE);
                item.setTag("note_wheel_" + LABELS[i].toLowerCase(java.util.Locale.ROOT));
                item.setContentDescription(LABELS[i].equals("Select") ? "Android text selection and clipboard" : LABELS[i]);
                item.setOnClickListener(v -> choose(index)); item.setOnFocusChangeListener((v, focused) -> { if (focused) highlight(index); });
                options[i] = item; addView(item, new LayoutParams(dp(80), dp(52)));
            }
            cancel = label("cancel", PocketDesign.MUTED); cancel.setTag("note_wheel_cancel");
            cancel.setOnClickListener(v -> dismiss()); addView(cancel, new LayoutParams(dp(64), dp(56)));
        }
        private TextView label(String text, int color) {
            TextView item = new TextView(getContext()); item.setText(text); PocketDesign.text(item, PocketDesign.SMALL, color);
            item.setGravity(Gravity.CENTER); item.setFocusable(true); item.setMinHeight(dp(52));
            item.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33ECC981), null, null)); return item;
        }
        @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
            float distance = radius * .71f;
            for (int i = 0; i < options.length; i++) {
                double angle = Math.toRadians(i * 45 - 90); int cx = Math.round(x + (float) Math.cos(angle) * distance), cy = Math.round(y + (float) Math.sin(angle) * distance);
                options[i].layout(cx - dp(40), cy - dp(26), cx + dp(40), cy + dp(26));
            }
            cancel.layout(Math.round(x) - dp(32), Math.round(y) - dp(28), Math.round(x) + dp(32), Math.round(y) + dp(28));
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas); paint.setColor(PocketDesign.PLANE); canvas.drawCircle(x, y, radius, paint);
            if (selected >= 0) {
                paint.setColor(PocketDesign.accent(getContext())); canvas.drawArc(bounds, selected * 45 - 112.5f, 45, true, paint);
            }
            paint.setColor(PocketDesign.INK); canvas.drawCircle(x, y, dp(34), paint);
        }
        int indexAt(float px, float py, boolean bounded) {
            double distance = Math.hypot(px - x, py - y);
            if (distance < dp(38) || (bounded && distance > radius)) return -1;
            double angle = (Math.toDegrees(Math.atan2(py - y, px - x)) + 90 + 360) % 360;
            return ((int) Math.floor((angle + 22.5) / 45)) % 8;
        }
        @Override public boolean onInterceptTouchEvent(MotionEvent event) { return true; }
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getPointerCount() != 1 || event.getActionMasked() == MotionEvent.ACTION_CANCEL) { dismiss(); return true; }
            highlight(indexAt(event.getX(), event.getY(), true));
            if (event.getActionMasked() == MotionEvent.ACTION_UP) { if (selected >= 0) choose(selected); else { performClick(); dismiss(); } }
            return true;
        }
        @Override public boolean performClick() { return super.performClick(); }
    }
}
