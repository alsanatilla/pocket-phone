package org.textphone.launcher;

import android.app.Activity;
import android.content.ClipData;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.DragEvent;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/** A four-unit Start board. Views keep their identity while readings change; only layout edits repack it. */
final class LiveTileBoard extends ViewGroup {
    interface Actions { void open(String kind); void edit(String kind); void changed(); void failed(RuntimeException error); }
    private final Activity activity;
    private final PlannerStore planner;
    private final Actions actions;
    private final List<SharedPreferences> observed = new ArrayList<>();
    private final List<Rect> cells = new ArrayList<>();
    private String layout = "";
    private boolean editing, attached;
    private String dragged, dropTarget;
    private int dragDirection;
    private static final int RESIZE = 0x01020001, EARLIER = 0x01020002, LATER = 0x01020003, UNPIN = 0x01020004;
    /** Degrees a pressed tile leans at its edge. */
    private static final float TILT = 6f;
    private final Runnable changed = this::refresh;
    private final SharedPreferences.OnSharedPreferenceChangeListener listener = (prefs, key) -> {
        removeCallbacks(changed); if (attached) postDelayed(changed, 100);
    };
    private final Runnable minute = new Runnable() {
        @Override public void run() { if (!attached || getWindowVisibility() != VISIBLE) return; refresh(); schedule(); }
    };
    private final Runnable scrollDrag = new Runnable() {
        @Override public void run() {
            if (dragged == null || dragDirection == 0 || !attached) return;
            ScrollView scroll = scrollParent();
            if (scroll != null) scroll.scrollBy(0, dp(12) * dragDirection);
            postDelayed(this, 32);
        }
    };

    LiveTileBoard(Activity activity, PlannerStore planner, Actions actions) {
        super(activity); this.activity = activity; this.planner = planner; this.actions = actions;
        setTag("live_tile_board"); setClipChildren(false);
        setOnDragListener((v, event) -> drag(event));
        refresh();
    }
    boolean editing() { return editing; }
    void editing(boolean value) {
        editing = value; emphasis(true);
    }
    /**
     * Tiles are borderless: edit mode shrinks them a little, and the tile under a drag returns to full size.
     * The change eases out over 200 ms and retargets if it is interrupted; a rebuilt board takes its sizes at once.
     */
    private void emphasis(boolean animate) {
        boolean motion = animate && PageMotion.enabled(activity);
        for (int i = 0; i < getChildCount(); i++) {
            Tile tile = (Tile)getChildAt(i); float scale = tile.rest();
            if (!motion) { tile.animate().cancel(); tile.setScaleX(scale); tile.setScaleY(scale); tile.setRotationX(0); tile.setRotationY(0); }
            else if (tile.target != scale) tile.animate().scaleX(scale).scaleY(scale).rotationX(0).rotationY(0).setDuration(200).setInterpolator(PageMotion.OUT).start();
            tile.target = scale;
        }
    }
    void refresh() {
        if (dragged != null) return; // A sync must not move targets out from under an active drag.
        String next = TodayTiles.layoutKey(activity);
        if (!next.equals(layout) || getChildCount() == 0) {
            layout = next; removeAllViews();
            for (String kind : TodayTiles.visible(activity)) addView(new Tile(kind, TodayTiles.size(activity, kind)));
            requestLayout(); emphasis(false);
        }
        for (int i = 0; i < getChildCount(); i++) ((Tile)getChildAt(i)).reading(LiveTileData.read(activity, planner, ((Tile)getChildAt(i)).kind));
    }
    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow(); attached = true;
        for (String name : new String[]{"pocket_planner", "pocket_agenda", "pocket_parking", "pocket_gym", "pocket_movement",
                "pocket_coros_auth", "pocket_journal", "pocket_receipt", "pocket_workspace_extras", "text_phone"}) {
            SharedPreferences prefs = activity.getSharedPreferences(name, 0); prefs.registerOnSharedPreferenceChangeListener(listener); observed.add(prefs);
        }
        SharedPreferences clock = ClockStore.prefs(activity); clock.registerOnSharedPreferenceChangeListener(listener); observed.add(clock);
        refresh(); schedule();
    }
    @Override protected void onDetachedFromWindow() {
        attached = false;
        for (SharedPreferences prefs : observed) prefs.unregisterOnSharedPreferenceChangeListener(listener);
        observed.clear(); removeCallbacks(changed); removeCallbacks(minute); endDrag(); super.onDetachedFromWindow();
    }
    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (minute == null) return;
        removeCallbacks(minute);
        if (attached && visibility == VISIBLE) { refresh(); schedule(); }
    }
    private void schedule() { removeCallbacks(minute); if (attached && getWindowVisibility() == VISIBLE) postDelayed(minute, 60000 - System.currentTimeMillis() % 60000 + 30); }
    int dp(float value) { return PocketDesign.dp(activity, value); }

    /** Dense first-fit packing in order: each tile takes the first free spot that fits, so small tiles fill gaps. A small tile is 1×1, a square 2×2, and a wide tile 4×2. */
    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec), gap = dp(8), available = Math.max(4, width - getPaddingLeft() - getPaddingRight());
        float unit = Math.max(1, (available - gap * 3) / 4f);
        float scale = getResources().getConfiguration().fontScale * (activity.getSharedPreferences("text_phone", 0).getBoolean("large_text", false) ? 1.15f : 1f);
        float heightUnit = Math.max(unit, dp(72) * scale);
        cells.clear(); List<boolean[]> used = new ArrayList<>(); int rows = 0;
        for (int i = 0; i < getChildCount(); i++) {
            Tile tile = (Tile)getChildAt(i); int columns = tile.columns(), height = tile.rows(), position = 0;
            while (!fits(used, position / 4, position % 4, columns, height)) position++;
            int row = position / 4, col = position % 4;
            while (used.size() < row + height) used.add(new boolean[4]);
            for (int r = row; r < row + height; r++) for (int c = col; c < col + columns; c++) used.get(r)[c] = true;
            rows = Math.max(rows, row + height);
            int left = getPaddingLeft() + Math.round(col * (unit + gap));
            int top = getPaddingTop() + Math.round(row * (heightUnit + gap));
            int right = getPaddingLeft() + Math.round((col + columns) * (unit + gap) - gap);
            int bottom = getPaddingTop() + Math.round((row + height) * (heightUnit + gap) - gap);
            cells.add(new Rect(left, top, right, bottom));
            tile.measure(MeasureSpec.makeMeasureSpec(right - left, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(bottom - top, MeasureSpec.EXACTLY));
        }
        setMeasuredDimension(resolveSize(width, widthSpec), resolveSize(getPaddingTop() + getPaddingBottom() + Math.round(rows == 0 ? 0 : rows * (heightUnit + gap) - gap), heightSpec));
    }
    private static boolean fits(List<boolean[]> used, int row, int col, int width, int height) {
        if (col + width > 4) return false;
        for (int r = row; r < Math.min(row + height, used.size()); r++) for (int c = col; c < col + width; c++) if (used.get(r)[c]) return false;
        return true;
    }
    @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
        for (int i = 0; i < getChildCount(); i++) { Rect cell = cells.get(i); getChildAt(i).layout(cell.left, cell.top, cell.right, cell.bottom); }
    }
    private boolean drag(DragEvent event) {
        if (event.getLocalState() != this || dragged == null) return false;
        switch (event.getAction()) {
            case DragEvent.ACTION_DRAG_STARTED: return true;
            case DragEvent.ACTION_DRAG_LOCATION: {
                float best = Float.MAX_VALUE; dropTarget = null;
                for (int i = 0; i < cells.size(); i++) {
                    Rect r = cells.get(i); float x = event.getX(), y = event.getY();
                    float distance = r.contains((int)x, (int)y) ? 0 : Math.abs(r.centerX() - x) + Math.abs(r.centerY() - y);
                    if (distance < best) { best = distance; dropTarget = ((Tile)getChildAt(i)).kind; }
                }
                Rect visible = new Rect(); getGlobalVisibleRect(visible); int[] screen = new int[2]; getLocationOnScreen(screen);
                float y = screen[1] + event.getY();
                dragDirection = y < visible.top + dp(48) ? -1 : y > visible.bottom - dp(48) ? 1 : 0;
                removeCallbacks(scrollDrag); if (dragDirection != 0) post(scrollDrag);
                emphasis(true); return true;
            }
            case DragEvent.ACTION_DROP: {
                try { if (dropTarget != null) TodayTiles.move(activity, dragged, dropTarget); }
                catch (RuntimeException error) { actions.failed(error); }
                return true;
            }
            case DragEvent.ACTION_DRAG_EXITED: dropTarget = null; dragDirection = 0; removeCallbacks(scrollDrag); emphasis(true); return true;
            case DragEvent.ACTION_DRAG_ENDED: endDrag(); refresh(); return true;
            default: return true;
        }
    }
    private void endDrag() {
        dragged = dropTarget = null; dragDirection = 0; removeCallbacks(scrollDrag);
        for (int i = 0; i < getChildCount(); i++) getChildAt(i).setAlpha(1f);
        emphasis(true);
    }
    private ScrollView scrollParent() { for (ViewParent p = getParent(); p != null; p = p.getParent()) if (p instanceof ScrollView) return (ScrollView)p; return null; }

    private final class Tile extends LinearLayout {
        final String kind, size;
        final TextView value, detail, name;
        final MiniChart chart;
        String dataKey = "";
        final int ink = WarmWorkspace.INK;
        final GradientDrawable base = new GradientDrawable();
        int fill;
        float target = 1f;
        private float touchX, touchY;
        private String rolling;

        Tile(String kind, String size) {
            super(activity); this.kind = kind; this.size = size;
            boolean small = "small".equals(size);
            setTag("today_tile_" + kind); setOrientation(VERTICAL); setGravity(Gravity.TOP);
            setPadding(dp(small ? 8 : 12), dp(small ? 6 : 10), dp(small ? 8 : 12), dp(small ? 6 : 10));
            setFocusable(true); setClickable(true); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
            setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
            value = label(small ? 32 : 46, true); value.setTag("live_value_" + kind);
            detail = label(13, false); detail.setMaxLines("wide".equals(size) ? 2 : 2); detail.setSingleLine(false); detail.setEllipsize(TextUtils.TruncateAt.END); detail.setTag("live_detail_" + kind);
            name = label(13, false); name.setTag("live_label_" + kind);
            chart = new MiniChart(); chart.setVisibility(GONE);
            if ("pip".equals(kind)) {
                PipNavView pip = new PipNavView(activity, small ? 48 : 96); pip.setTag("live_pip"); pip.setBackground(null);
                pip.setClickable(false); pip.setFocusable(false); pip.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
                addView(pip, new LinearLayout.LayoutParams(-1, 0, 1)); value.setVisibility(GONE);
            } else addView(value, new LinearLayout.LayoutParams(-1, -2));
            if (!small) {
                LinearLayout.LayoutParams preview = new LinearLayout.LayoutParams(-1, 0, 1); preview.topMargin = dp(2); addView(detail, preview);
                LinearLayout.LayoutParams plot = new LinearLayout.LayoutParams(-1, dp(12)); plot.bottomMargin = dp(6); addView(chart, plot);
            } else if (!"pip".equals(kind)) addView(new View(activity), new LinearLayout.LayoutParams(1, 0, 1));
            // The foot is the scan point: icon and name. A small tile has room for the icon only; Pip's sprite is its own icon.
            if (!(small && "pip".equals(kind))) {
                LinearLayout foot = new LinearLayout(activity); foot.setGravity(Gravity.CENTER_VERTICAL);
                WarmWorkspace.Glyph glyph = new WarmWorkspace.Glyph(activity, kind, ink); glyph.setTag("live_glyph_" + kind);
                foot.addView(glyph, new LinearLayout.LayoutParams(dp(18), dp(18)));
                if (!small) { LinearLayout.LayoutParams text = new LinearLayout.LayoutParams(0, -2, 1); text.leftMargin = dp(6); foot.addView(name, text); }
                addView(foot, new LinearLayout.LayoutParams(-1, -2));
            }
            setOnClickListener(v -> { if (editing) actions.edit(kind); else actions.open(kind); });
            setOnLongClickListener(v -> {
                if (!editing) { actions.edit(kind); return true; }
                dragged = kind; dropTarget = kind;
                boolean started = startDragAndDrop(ClipData.newPlainText("Pocket tile", kind), new View.DragShadowBuilder(this), LiveTileBoard.this, 0);
                if (started) setAlpha(.4f); else { endDrag(); actions.edit(kind); }
                return true;
            });
            fill(false); setBackground(new RippleDrawable(ColorStateList.valueOf(0x33000000), base, null));
        }
        /** Every tile wears the chosen accent, as on Windows Phone. Colour changes only to flag something, such as overdue tasks. */
        void fill(boolean alert) {
            int next = alert ? WarmWorkspace.OVERDUE : PocketDesign.accent(activity);
            if (next != fill) { fill = next; base.setColor(fill); }
        }
        float rest() { return editing && !(kind.equals(dropTarget) && !kind.equals(dragged)) ? .94f : 1f; }
        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { touchX = event.getX(); touchY = event.getY(); }
            return super.onTouchEvent(event);
        }
        /**
         * Windows Phone tilt: a pressed tile dips and leans away from the finger, then settles back.
         * Pressed state arrives after the tap timeout, so a scroll never tilts a tile.
         */
        @Override public void setPressed(boolean pressed) {
            boolean changed = pressed != isPressed(); super.setPressed(pressed);
            if (!changed || getWidth() == 0 || !PageMotion.enabled(activity)) return;
            float rest = rest();
            if (pressed && dragged == null) {
                float x = Math.max(-1, Math.min(1, touchX / getWidth() * 2 - 1)), y = Math.max(-1, Math.min(1, touchY / getHeight() * 2 - 1));
                setCameraDistance(getResources().getDisplayMetrics().density * 8000);
                animate().scaleX(rest * .97f).scaleY(rest * .97f).rotationY(x * TILT).rotationX(-y * TILT).setDuration(100).setInterpolator(PageMotion.OUT).start();
            } else if (!pressed) animate().scaleX(rest).scaleY(rest).rotationX(0).rotationY(0).setDuration(200).setInterpolator(PageMotion.OUT).start();
        }
        /** A live reading rolls in: the old value lifts out quickly and the new one rises into place. A newer reading mid-roll just replaces the incoming text. */
        private void roll(String next) {
            boolean running = rolling != null; rolling = next; if (running) return;
            float lift = dp(8);
            value.animate().translationY(-lift).alpha(0).setDuration(90).setInterpolator(PageMotion.OUT).withLayer().withEndAction(() -> {
                value.setText(rolling); rolling = null; value.setTranslationY(lift);
                value.animate().translationY(0).alpha(1).setDuration(220).setInterpolator(PageMotion.OUT).withLayer().withEndAction(null).start();
            }).start();
        }
        int columns() { return "wide".equals(size) ? 4 : "small".equals(size) ? 1 : 2; }
        int rows() { return "small".equals(size) ? 1 : 2; }
        TextView label(float sp, boolean pixel) {
            TextView view = new TextView(activity); PocketDesign.text(view, sp, ink);
            if (pixel) { view.setTypeface(PocketFonts.pixel(activity)); view.setTextSize(PocketDesign.typeSize(activity, sp)); }
            view.setIncludeFontPadding(false); view.setSingleLine(true); view.setEllipsize(TextUtils.TruncateAt.END); view.setPadding(0,0,0,0);
            view.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
            return view;
        }
        void reading(LiveTileData data) {
            fill(data.alert);
            String key = data.key(); if (key.equals(dataKey)) return;
            // The first reading is drawn as is; later changes to the headline value roll in, like a Windows Phone live tile.
            boolean live = !dataKey.isEmpty() && isAttachedToWindow() && PageMotion.enabled(activity); dataKey = key;
            String shown = rolling != null ? rolling : value.getText().toString();
            if (live && !shown.equals(data.value)) roll(data.value);
            else if (!live) { value.animate().cancel(); rolling = null; value.setAlpha(1); value.setTranslationY(0); value.setText(data.value); }
            detail.setText(data.detail);
            name.setText(TodayTiles.label(activity, kind));
            if (!"small".equals(size) && !data.status.isEmpty()) {
                // Status goes with the reading; the app name remains a stable scan point at the foot.
                // An alert leads with its status, so the warning colour is never the only signal.
                detail.setText(data.alert ? data.status + (data.detail.isEmpty() ? "" : "\n") + data.detail
                        : data.detail + (data.detail.isEmpty() ? "" : "\n") + data.status);
                detail.setMaxLines("wide".equals(size) ? 3 : 2);
            }
            if (android.os.Build.VERSION.SDK_INT >= 26) value.setAutoSizeTextTypeUniformWithConfiguration("small".equals(size) ? 18 : 26, "small".equals(size) ? 32 : 46, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
            chart.data(data.progress, data.bars);
            setContentDescription(TodayTiles.label(activity, kind) + ", " + data.value + ", " + data.detail + ", " + data.status + ". " + size + " tile.");
        }
        @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
            super.onInitializeAccessibilityNodeInfo(info); info.setClassName("android.widget.Button");
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(RESIZE, "Resize tile"));
            List<String> order = TodayTiles.visible(activity); int at = order.indexOf(kind);
            if (at > 0) info.addAction(new AccessibilityNodeInfo.AccessibilityAction(EARLIER, "Move earlier"));
            if (at >= 0 && at < order.size() - 1) info.addAction(new AccessibilityNodeInfo.AccessibilityAction(LATER, "Move later"));
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(UNPIN, "Unpin tile"));
        }
        @Override public boolean performAccessibilityAction(int action, Bundle args) {
            if (action == RESIZE) { actions.edit(kind); return true; }
            if (action == EARLIER || action == LATER || action == UNPIN) {
                try {
                    List<String> order = TodayTiles.visible(activity); int at = order.indexOf(kind), to = at + (action == EARLIER ? -1 : 1);
                    if (action == UNPIN) { order.remove(kind); TodayTiles.saveVisible(activity, order); }
                    else if (at >= 0 && to >= 0 && to < order.size()) TodayTiles.move(activity, kind, order.get(to));
                    refresh(); actions.changed();
                } catch (RuntimeException error) { actions.failed(error); }
                return true;
            }
            return super.performAccessibilityAction(action, args);
        }
        final class MiniChart extends View {
            final Paint paint = new Paint(); int progress = -1; double[] bars;
            MiniChart() { super(activity); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
            void data(int progress, double[] bars) { this.progress = progress; this.bars = bars; setVisibility(progress >= 0 || bars != null ? VISIBLE : GONE); invalidate(); }
            @Override protected void onDraw(Canvas c) {
                int count = bars == null ? 12 : bars.length; if (count == 0) return;
                double max = 1; if (bars != null) for (double v : bars) max = Math.max(max, v);
                float gap = dp(3), width = Math.max(1, (getWidth() - (count - 1) * gap) / count);
                for (int i = 0; i < count; i++) {
                    paint.setColor(ink); paint.setAlpha(bars == null && i >= Math.round(progress * count / 100f) ? 35 : 170);
                    float height = bars == null ? dp(4) : (float)Math.max(dp(2), getHeight() * bars[i] / max);
                    c.drawRect(i * (width + gap), getHeight() - height, i * (width + gap) + width, getHeight(), paint);
                }
            }
        }
    }
}
