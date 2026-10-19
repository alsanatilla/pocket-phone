package org.textphone.launcher;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A four-unit Start board. Tile views keep their identity while readings, order and sizes change, and every layout change
 * animates. Editing works like a phone home screen: a long press starts it and picks the tile up; tiles jiggle; a dragged
 * tile follows the finger while the others make room; the corner handle resizes it between small, square and wide; the
 * badge unpins it; tapping empty board space ends it. Layout changes are saved when the finger lifts.
 */
final class LiveTileBoard extends ViewGroup {
    interface Actions { void open(String kind); void edit(String kind); void changed(); void editing(boolean on); void failed(RuntimeException error); }
    private final Activity activity;
    private final PlannerStore planner;
    private final Actions actions;
    private final List<SharedPreferences> observed = new ArrayList<>();
    private final Map<String, Tile> tiles = new LinkedHashMap<>();
    private final Map<String, Rect> slots = new HashMap<>(), placed = new HashMap<>();
    /** Kinds as drawn: the saved order, or a preview while a tile is being dragged. */
    private List<String> order = new ArrayList<>();
    private TileLayout.Metrics metrics = new TileLayout.Metrics(1, 1, 0);
    private boolean editing, attached, pending;
    private static final int NONE = 0, PRESS = 1, DRAG = 2, RESIZE = 3, REMOVE = 4, EMPTY = 5;
    private int gesture = NONE, dragDirection;
    private String active, armed, startSize;
    private List<String> startOrder;
    private Rect anchor;
    private float downX, downY, grabX, grabY, lastRawX, lastRawY;
    private final int slop;
    private static final int RESIZE_ACTION = 0x01020001, EARLIER = 0x01020002, LATER = 0x01020003, UNPIN = 0x01020004;
    private final Runnable changed = this::refresh;
    private final SharedPreferences.OnSharedPreferenceChangeListener listener = (prefs, key) -> {
        removeCallbacks(changed); if (attached) postDelayed(changed, 100);
    };
    private final Runnable minute = new Runnable() {
        @Override public void run() { if (!attached || getWindowVisibility() != VISIBLE) return; refresh(); schedule(); }
    };
    // Near the top or bottom of the visible page a dragged tile scrolls it, and keeps finding its place as the board moves.
    private final Runnable scrollDrag = new Runnable() {
        @Override public void run() {
            if (gesture != DRAG || dragDirection == 0 || !attached) return;
            ScrollView scroll = scrollParent();
            if (scroll != null) { scroll.scrollBy(0, dp(12) * dragDirection); int[] at = new int[2]; getLocationOnScreen(at); dragTo(lastRawX - at[0], lastRawY - at[1]); }
            postDelayed(this, 16);
        }
    };

    LiveTileBoard(Activity activity, PlannerStore planner, Actions actions) {
        super(activity); this.activity = activity; this.planner = planner; this.actions = actions;
        slop = ViewConfiguration.get(activity).getScaledTouchSlop();
        setTag("live_tile_board"); setClipChildren(false); setClipToPadding(false);
        refresh();
    }
    boolean editing() { return editing; }
    void editing(boolean value) {
        if (editing == value) return;
        if (!value && gesture != NONE) finish(false);
        editing = value; armed = null; emphasis();
        for (Tile tile : tiles.values()) { tile.invalidate(); tile.describe(); }
    }
    /** Edit mode shrinks tiles a little and jiggles them; a lifted tile grows instead and keeps still. */
    private void emphasis() {
        boolean motion = editing && attached && PageMotion.enabled(activity);
        for (Tile tile : tiles.values()) {
            boolean lifted = gesture == DRAG && tile.kind.equals(active);
            float scale = lifted ? 1.05f : editing ? .94f : 1f;
            tile.setScaleX(scale); tile.setScaleY(scale); tile.setTranslationZ(lifted ? dp(12) : 0);
            tile.wobble(motion && !lifted);
        }
    }
    void refresh() {
        // A sync must not move tiles out from under a finger; it lands when the finger lifts.
        if (gesture == DRAG || gesture == RESIZE) { pending = true; return; }
        pending = false;
        List<String> kinds = TodayTiles.visible(activity);
        boolean changed = !kinds.equals(order);
        for (Iterator<Map.Entry<String, Tile>> it = tiles.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, Tile> entry = it.next();
            if (!kinds.contains(entry.getKey())) { entry.getValue().still(); removeView(entry.getValue()); it.remove(); changed = true; }
        }
        for (String kind : kinds) {
            String size = TodayTiles.size(activity, kind); Tile tile = tiles.get(kind);
            if (tile == null || !tile.size.equals(size)) { place(kind, size); changed = true; }
        }
        order = new ArrayList<>(kinds);
        if (changed) { requestLayout(); emphasis(); }
        for (Tile tile : tiles.values()) tile.reading(LiveTileData.read(activity, planner, tile.kind));
    }
    /** A tile of this size for the kind; a resize replaces the view, which keeps its place and animates from it. */
    private Tile place(String kind, String size) {
        Tile old = tiles.remove(kind), tile = new Tile(kind, size);
        if (old != null) { old.still(); removeView(old); }
        tiles.put(kind, tile); addView(tile);
        return tile;
    }
    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow(); attached = true;
        for (String name : new String[]{"pocket_planner", "pocket_agenda", "pocket_parking", "pocket_gym", "pocket_movement",
                "pocket_coros_auth", "pocket_journal", "pocket_receipt", "pocket_workspace_extras", "text_phone"}) {
            SharedPreferences prefs = activity.getSharedPreferences(name, 0); prefs.registerOnSharedPreferenceChangeListener(listener); observed.add(prefs);
        }
        SharedPreferences clock = ClockStore.prefs(activity); clock.registerOnSharedPreferenceChangeListener(listener); observed.add(clock);
        refresh(); emphasis(); schedule();
    }
    @Override protected void onDetachedFromWindow() {
        attached = false;
        for (SharedPreferences prefs : observed) prefs.unregisterOnSharedPreferenceChangeListener(listener);
        observed.clear(); removeCallbacks(changed); removeCallbacks(minute);
        if (gesture != NONE) finish(false);
        for (Tile tile : tiles.values()) tile.still();
        super.onDetachedFromWindow();
    }
    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (minute == null) return;
        removeCallbacks(minute);
        if (attached && visibility == VISIBLE) { refresh(); schedule(); }
    }
    private void schedule() { removeCallbacks(minute); if (attached && getWindowVisibility() == VISIBLE) postDelayed(minute, 60000 - System.currentTimeMillis() % 60000 + 30); }
    int dp(float value) { return PocketDesign.dp(activity, value); }

    /** Dense first-fit packing in order (TileLayout): a small tile is 1×1, a square 2×2 and a wide tile 4×2. */
    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec), available = Math.max(4, width - getPaddingLeft() - getPaddingRight());
        float gap = dp(8), unit = Math.max(1, (available - gap * 3) / 4f);
        float scale = getResources().getConfiguration().fontScale * (activity.getSharedPreferences("text_phone", 0).getBoolean("large_text", false) ? 1.15f : 1f);
        metrics = new TileLayout.Metrics(unit, Math.max(unit, dp(72) * scale), gap);
        List<String> sizes = new ArrayList<>(); for (String kind : order) sizes.add(tiles.get(kind).size);
        int[][] cells = TileLayout.pack(sizes, 4); int rows = 0; slots.clear();
        for (int i = 0; i < order.size(); i++) {
            float[] box = TileLayout.box(cells[i], metrics);
            int left = getPaddingLeft() + Math.round(box[0]), top = getPaddingTop() + Math.round(box[1]);
            Rect slot = new Rect(left, top, getPaddingLeft() + Math.round(box[0] + box[2]), getPaddingTop() + Math.round(box[1] + box[3]));
            slots.put(order.get(i), slot); rows = Math.max(rows, cells[i][1] + cells[i][3]);
            tiles.get(order.get(i)).measure(MeasureSpec.makeMeasureSpec(slot.width(), MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(slot.height(), MeasureSpec.EXACTLY));
        }
        setMeasuredDimension(resolveSize(width, widthSpec), resolveSize(getPaddingTop() + getPaddingBottom() + Math.round(rows == 0 ? 0 : rows * (metrics.rowUnit + gap) - gap), heightSpec));
    }
    /** Tiles that move slide from where they were drawn; the dragged tile stays under the finger. */
    @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
        boolean animate = attached && PageMotion.enabled(activity);
        for (String kind : order) {
            Tile tile = tiles.get(kind); Rect slot = slots.get(kind), before = placed.get(kind);
            if (tile == null || slot == null) continue;
            tile.layout(slot.left, slot.top, slot.right, slot.bottom);
            if (gesture == DRAG && kind.equals(active)) { follow(tile); placed.put(kind, new Rect(slot)); continue; }
            if (before != null && (before.left != slot.left || before.top != slot.top)) {
                tile.animate().cancel();
                if (animate) {
                    tile.setTranslationX(tile.getTranslationX() + before.left - slot.left); tile.setTranslationY(tile.getTranslationY() + before.top - slot.top);
                    tile.animate().translationX(0).translationY(0).setDuration(220).setInterpolator(new DecelerateInterpolator(2f)).start();
                } else { tile.setTranslationX(0); tile.setTranslationY(0); }
            }
            placed.put(kind, new Rect(slot));
        }
        placed.keySet().retainAll(order);
    }

    // ── Editing gestures. The board takes every touch while editing; outside it, only a drag the long press began. ──
    /** A long press on a tile starts editing and picks that tile up: moving the same finger drags it. */
    private void pickUp(Tile tile) {
        if (!editing) { editing(true); actions.editing(true); }
        armed = tile.kind; // The finger stays where it went down; moving it from there drags the tile it holds.
        disallowScroll(true); performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
    }
    @Override public boolean onInterceptTouchEvent(MotionEvent e) {
        int action = e.getActionMasked();
        if (action == MotionEvent.ACTION_DOWN) {
            armed = null; downX = e.getX(); downY = e.getY(); lastRawX = e.getRawX(); lastRawY = e.getRawY();
            if (editing) { begin(e.getX(), e.getY()); return true; }
            return false;
        }
        if (armed != null && action == MotionEvent.ACTION_MOVE && Math.hypot(e.getX() - downX, e.getY() - downY) > slop) {
            String kind = armed; armed = null; lastRawX = e.getRawX(); lastRawY = e.getRawY();
            Tile tile = tiles.get(kind);
            if (tile != null) { startDrag(kind, downX, downY); dragTo(e.getX(), e.getY()); return true; }
        }
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) { if (armed != null) disallowScroll(false); armed = null; }
        return false;
    }
    @Override public boolean onTouchEvent(MotionEvent e) {
        if (gesture == NONE) return false;
        float x = e.getX(), y = e.getY(); lastRawX = e.getRawX(); lastRawY = e.getRawY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: return true;
            case MotionEvent.ACTION_MOVE:
                boolean moved = Math.hypot(x - downX, y - downY) > slop;
                if (gesture == PRESS && moved) startDrag(active, downX, downY);
                if (gesture == DRAG) dragTo(x, y);
                else if (gesture == RESIZE) resizeTo(x, y);
                else if (gesture == REMOVE && !badge(slots.get(active)).contains((int)x, (int)y)) gesture = NONE;
                else if (gesture == EMPTY && moved) { gesture = NONE; return false; }
                return true;
            case MotionEvent.ACTION_UP: finish(true); return true;
            case MotionEvent.ACTION_CANCEL: finish(false); return true;
            default: return true;
        }
    }
    private void begin(float x, float y) {
        active = null; gesture = EMPTY;
        for (int i = order.size() - 1; i >= 0; i--) {
            String kind = order.get(i); Rect slot = slots.get(kind);
            if (slot == null) continue;
            if (badge(slot).contains((int)x, (int)y)) { active = kind; gesture = REMOVE; break; }
            if (handle(slot).contains((int)x, (int)y)) {
                active = kind; gesture = RESIZE; startSize = tiles.get(kind).size; anchor = new Rect(slot);
                disallowScroll(true); break;
            }
            if (slot.contains((int)x, (int)y)) { active = kind; gesture = PRESS; disallowScroll(true); break; }
        }
    }
    private Rect badge(Rect slot) { return new Rect(slot.left - dp(6), slot.top - dp(6), slot.left + dp(34), slot.top + dp(34)); }
    private Rect handle(Rect slot) { return new Rect(slot.right - dp(34), slot.bottom - dp(34), slot.right + dp(6), slot.bottom + dp(6)); }
    private void startDrag(String kind, float fromX, float fromY) {
        Tile tile = tiles.get(kind); Rect slot = slots.get(kind);
        if (tile == null || slot == null) { gesture = NONE; return; }
        tile.animate().cancel();
        gesture = DRAG; active = kind; startOrder = new ArrayList<>(order);
        grabX = fromX - (slot.left + tile.getTranslationX()); grabY = fromY - (slot.top + tile.getTranslationY());
        disallowScroll(true); emphasis();
    }
    private void follow(Tile tile) {
        Rect slot = slots.get(tile.kind); if (slot == null) return;
        int[] at = new int[2]; getLocationOnScreen(at);
        tile.setTranslationX(lastRawX - at[0] - grabX - slot.left); tile.setTranslationY(lastRawY - at[1] - grabY - slot.top);
    }
    /** The dragged tile follows the finger; once its centre is clearly nearer another slot, the order changes and the others make room. */
    private void dragTo(float x, float y) {
        Tile tile = tiles.get(active); Rect slot = slots.get(active);
        if (tile == null || slot == null) return;
        tile.setTranslationX(x - grabX - slot.left); tile.setTranslationY(y - grabY - slot.top);
        List<String> others = new ArrayList<>(order); others.remove(active);
        List<String> sizes = new ArrayList<>(); for (String kind : others) sizes.add(tiles.get(kind).size);
        int current = order.indexOf(active);
        int index = TileLayout.dropIndex(sizes, tile.size, x - grabX + slot.width() / 2f - getPaddingLeft(), y - grabY + slot.height() / 2f - getPaddingTop(), 4, metrics, current);
        if (index != current) {
            others.add(index, active); order = others;
            performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK); requestLayout();
        }
        Rect visible = new Rect(); getGlobalVisibleRect(visible);
        dragDirection = lastRawY < visible.top + dp(56) ? -1 : lastRawY > visible.bottom - dp(56) ? 1 : 0;
        removeCallbacks(scrollDrag); if (dragDirection != 0) postDelayed(scrollDrag, 16);
    }
    /** The handle snaps the tile to the size whose footprint is nearest where it is dragged, measured from where the tile was. */
    private void resizeTo(float x, float y) {
        float cols = (x - anchor.left + metrics.gap) / (metrics.unit + metrics.gap), rows = (y - anchor.top + metrics.gap) / (metrics.rowUnit + metrics.gap);
        String size = TileLayout.snap(cols, rows); Tile tile = tiles.get(active);
        if (tile == null || size.equals(tile.size)) return;
        place(active, size).reading(LiveTileData.read(activity, planner, active));
        performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK); requestLayout(); emphasis();
    }
    /** Ends a gesture. A lifted finger keeps what it did and saves it; a cancelled gesture puts everything back. */
    private void finish(boolean keep) {
        int was = gesture; String kind = active;
        gesture = NONE; active = null; dragDirection = 0; removeCallbacks(scrollDrag); disallowScroll(false);
        try {
            if (was == PRESS && keep) actions.edit(kind);
            else if (was == REMOVE && keep) { List<String> next = new ArrayList<>(order); next.remove(kind); TodayTiles.saveVisible(activity, next); actions.changed(); }
            else if (was == EMPTY && keep) { editing(false); actions.editing(false); }
            else if (was == DRAG) {
                Tile tile = tiles.get(kind);
                if (tile != null) {
                    boolean animate = attached && PageMotion.enabled(activity);
                    if (animate) tile.animate().translationX(0).translationY(0).setDuration(200).setInterpolator(new DecelerateInterpolator(2f)).start();
                    else { tile.setTranslationX(0); tile.setTranslationY(0); }
                }
                if (!keep) order = startOrder; else if (!order.equals(startOrder)) { TodayTiles.saveVisible(activity, order); actions.changed(); }
                requestLayout();
            } else if (was == RESIZE) {
                Tile tile = tiles.get(kind);
                if (tile != null && !tile.size.equals(startSize)) {
                    if (keep) { TodayTiles.resize(activity, kind, tile.size); actions.changed(); } else place(kind, startSize).reading(LiveTileData.read(activity, planner, kind));
                    requestLayout();
                }
            }
        } catch (RuntimeException error) { actions.failed(error); pending = true; }
        emphasis();
        if (pending) refresh();
    }
    private void disallowScroll(boolean value) { ViewParent parent = getParent(); if (parent != null) parent.requestDisallowInterceptTouchEvent(value); }
    private ScrollView scrollParent() { for (ViewParent p = getParent(); p != null; p = p.getParent()) if (p instanceof ScrollView) return (ScrollView)p; return null; }

    private final class Tile extends LinearLayout {
        final String kind, size;
        final TextView value, detail, name;
        final MiniChart chart;
        String dataKey = "";
        final int ink = WarmWorkspace.INK;
        final int fill;
        final Paint mark = new Paint(Paint.ANTI_ALIAS_FLAG);
        ObjectAnimator wobble;

        Tile(String kind, String size) {
            super(activity); this.kind = kind; this.size = size;
            fill = color(kind); boolean small = "small".equals(size);
            setTag("today_tile_" + kind); setOrientation(VERTICAL); setGravity(Gravity.TOP);
            setPadding(dp(small ? 8 : 12), dp(small ? 6 : 10), dp(small ? 8 : 12), dp(small ? 6 : 10));
            setFocusable(true); setClickable(true); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
            setDescendantFocusability(FOCUS_BLOCK_DESCENDANTS);
            value = label(small ? 32 : 46, true); value.setTag("live_value_" + kind);
            detail = label(13, false); detail.setMaxLines(2); detail.setSingleLine(false); detail.setEllipsize(TextUtils.TruncateAt.END); detail.setTag("live_detail_" + kind);
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
            addView(name, new LinearLayout.LayoutParams(-1, -2));
            // Taps and keyboard or switch access: open the app, or while editing, the tile's menu.
            setOnClickListener(v -> { if (editing) actions.edit(kind); else actions.open(kind); });
            setOnLongClickListener(v -> { pickUp(this); return true; });
            GradientDrawable base = new GradientDrawable(); base.setColor(fill);
            setBackground(new RippleDrawable(ColorStateList.valueOf(0x33000000), base, null));
        }
        TextView label(float sp, boolean pixel) {
            TextView view = new TextView(activity); PocketDesign.text(view, sp, ink);
            if (pixel) { view.setTypeface(PocketFonts.pixel(activity)); view.setTextSize(PocketDesign.typeSize(activity, sp)); }
            view.setIncludeFontPadding(false); view.setSingleLine(true); view.setEllipsize(TextUtils.TruncateAt.END); view.setPadding(0,0,0,0);
            view.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
            return view;
        }
        LiveTileData data;
        void reading(LiveTileData data) {
            String label = TodayTiles.label(activity, kind), key = data.key() + "\n" + label;
            if (key.equals(dataKey)) return; dataKey = key; this.data = data;
            value.setText(data.value); detail.setText(data.detail);
            name.setText(label);
            if (!"small".equals(size) && !data.status.isEmpty()) {
                // Status goes with the reading; the app name remains a stable scan point at the foot.
                detail.setText(data.detail + (data.detail.isEmpty() ? "" : "\n") + data.status);
                detail.setMaxLines("wide".equals(size) ? 3 : 2);
            }
            if (android.os.Build.VERSION.SDK_INT >= 26) value.setAutoSizeTextTypeUniformWithConfiguration("small".equals(size) ? 18 : 26, "small".equals(size) ? 32 : 46, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
            chart.data(data.progress, data.bars);
            describe();
        }
        void describe() {
            if (data == null) return;
            setContentDescription(TodayTiles.label(activity, kind) + ", " + data.value + ", " + data.detail + ", " + data.status + ". " + size + " tile."
                    + (editing ? " Editing: drag to move, drag the corner to resize, the badge unpins it." : ""));
        }
        /** A small alternating tilt while editing, like a home screen's jiggle. */
        void wobble(boolean on) {
            if (!on) { still(); return; }
            if (wobble != null) return;
            float tilt = (Math.abs(kind.hashCode()) % 2 == 0 ? 1 : -1) * .9f;
            wobble = ObjectAnimator.ofFloat(this, View.ROTATION, -tilt, tilt);
            wobble.setDuration(130 + Math.abs(kind.hashCode()) % 40); wobble.setRepeatMode(ValueAnimator.REVERSE); wobble.setRepeatCount(ValueAnimator.INFINITE);
            wobble.start();
        }
        void still() { if (wobble != null) { wobble.cancel(); wobble = null; } setRotation(0); }
        /** While editing: the unpin badge in the top corner and the resize handle in the bottom one. */
        @Override protected void dispatchDraw(Canvas c) {
            super.dispatchDraw(c);
            if (!editing || gesture == DRAG && kind.equals(active)) return;
            float r = dp(10), cx = dp(13), cy = dp(13);
            mark.setStyle(Paint.Style.FILL); mark.setColor(ink); c.drawCircle(cx, cy, r, mark);
            mark.setColor(fill); c.drawRect(cx - dp(5), cy - dp(1), cx + dp(5), cy + dp(1), mark);
            mark.setStyle(Paint.Style.STROKE); mark.setStrokeWidth(dp(3)); mark.setStrokeCap(Paint.Cap.ROUND); mark.setColor(ink);
            c.drawArc(new RectF(getWidth() - dp(28), getHeight() - dp(28), getWidth() - dp(7), getHeight() - dp(7)), 0, 90, false, mark);
        }
        @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) {
            super.onInitializeAccessibilityNodeInfo(info); info.setClassName("android.widget.Button");
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(RESIZE_ACTION, "Resize tile"));
            List<String> visible = TodayTiles.visible(activity); int at = visible.indexOf(kind);
            if (at > 0) info.addAction(new AccessibilityNodeInfo.AccessibilityAction(EARLIER, "Move earlier"));
            if (at >= 0 && at < visible.size() - 1) info.addAction(new AccessibilityNodeInfo.AccessibilityAction(LATER, "Move later"));
            info.addAction(new AccessibilityNodeInfo.AccessibilityAction(UNPIN, "Unpin tile"));
        }
        @Override public boolean performAccessibilityAction(int action, Bundle args) {
            if (action == RESIZE_ACTION) { actions.edit(kind); return true; }
            if (action == EARLIER || action == LATER || action == UNPIN) {
                try {
                    List<String> visible = TodayTiles.visible(activity); int at = visible.indexOf(kind), to = at + (action == EARLIER ? -1 : 1);
                    if (action == UNPIN) { visible.remove(kind); TodayTiles.saveVisible(activity, visible); }
                    else if (at >= 0 && to >= 0 && to < visible.size()) TodayTiles.move(activity, kind, visible.get(to));
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
    private static int color(String kind) {
        if ("tasks".equals(kind) || "brief".equals(kind) || "pip".equals(kind)) return WarmWorkspace.AMBER;
        if ("notes".equals(kind) || "paper".equals(kind)) return 0xFFDDD0B6;
        if ("clock".equals(kind) || "focus".equals(kind)) return 0xFFD8B095;
        return WarmWorkspace.color(kind);
    }
}
