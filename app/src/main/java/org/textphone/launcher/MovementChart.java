package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.IntConsumer;
import java.util.function.DoubleFunction;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native instruments with missing-data gaps and a shared, touch/keyboard-accessible activity cursor. */
final class MovementChart extends View {
    enum Kind { LINE, BARS, PAIR, RING, METER, STACK, ROUTE }
    static final class Cursor {
        int index = -1; final List<MovementChart> plots = new ArrayList<>();
        void set(int index) { this.index = index; for (MovementChart plot : plots) { plot.invalidate(); plot.read.accept(index); } }
    }
    private final Kind kind; private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final double[] values; private final String[] labels; private final int color;
    private double[] second, low, high; private boolean inverted; private double min = Double.NaN, max = Double.NaN, baseline = Double.NaN;
    private String title = "", ringText = ""; private Path route; private double[] routeStart; private Cursor cursor;
    private IntConsumer read = index -> {}; private float downX, downY;
    private DoubleFunction<String> format = value -> Double.isFinite(value) ? String.format(Locale.getDefault(), "%.1f", value) : "no reading";
    MovementChart(Context context, Kind kind, double[] values, String[] labels, int color) {
        super(context); this.kind = kind; this.values = values; this.labels = labels; this.color = color;
        setMinimumHeight(dp(kind == Kind.RING ? 100 : kind == Kind.METER || kind == Kind.STACK ? 30 : 150));
        if (kind == Kind.LINE || kind == Kind.BARS || kind == Kind.PAIR) { linked(new Cursor(), index -> {}); setFocusable(true); setClickable(true); }
    }
    MovementChart title(String value) { title = value; setContentDescription(value); return this; }
    MovementChart bounds(double min, double max) { this.min = min; this.max = max; return this; }
    MovementChart paired(double[] values) { second = values; return this; }
    MovementChart band(double[] low, double[] high) { this.low = low; this.high = high; return this; }
    MovementChart baseline(double value) { baseline = value; return this; }
    MovementChart invert(boolean value) { inverted = value; return this; }
    MovementChart format(DoubleFunction<String> value) { format = value; return this; }
    void linked(Cursor cursor, IntConsumer read) { if (this.cursor != null) this.cursor.plots.remove(this); this.cursor = cursor; this.read = read; cursor.plots.add(this); }
    static MovementChart ring(Context context, double score, String text, int color) { MovementChart chart = new MovementChart(context, Kind.RING, new double[]{score}, new String[0], color); chart.ringText = text; chart.setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); return chart; }
    static MovementChart route(Context context, JSONObject source) {
        MovementChart chart = new MovementChart(context, Kind.ROUTE, new double[0], new String[0], PocketDesign.MOVEMENT); chart.route = new Path();
        java.util.regex.Matcher points = java.util.regex.Pattern.compile("([ML])\\s*([-+\\d.eE]+)[,\\s]+([-+\\d.eE]+)").matcher(source.optString("d")); int count = 0;
        while (points.find() && count++ < 1000) { try { float x = Float.parseFloat(points.group(2)), y = Float.parseFloat(points.group(3)); if (!Float.isFinite(x) || !Float.isFinite(y)) continue; if (points.group(1).equals("M")) chart.route.moveTo(x, y); else chart.route.lineTo(x, y); } catch (NumberFormatException ignored) {} }
        JSONArray start = source.optJSONArray("start"); if (start != null && start.length() == 2) chart.routeStart = new double[]{start.optDouble(0), start.optDouble(1)}; chart.title("Activity route"); return chart;
    }
    private int dp(float n) { return PocketDesign.dp(getContext(), n); }
    @Override protected void onMeasure(int width, int height) { setMeasuredDimension(resolveSize(dp(280), width), resolveSize(getMinimumHeight(), height)); }
    private void ink(int color, Paint.Style style, float stroke) { paint.setColor(color); paint.setStyle(style); paint.setStrokeWidth(dp(stroke)); paint.setStrokeCap(Paint.Cap.ROUND); }
    private float left() { return dp(14); } private float right() { return Math.max(left() + 1, getWidth() - dp(14)); }
    private float x(int index) { return left() + index / (float) Math.max(1, values.length - 1) * (right() - left()); }
    private float y(double value, double min, double max) { double share = (value - min) / (max - min); if (inverted) share = 1 - share; return (float) (dp(12) + (1 - share) * Math.max(1, getHeight() - dp(42))); }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas); if (getWidth() == 0 || getHeight() == 0) return;
        if (kind == Kind.RING) {
            float side = Math.min(getWidth(), getHeight()) - dp(12), cx = getWidth() / 2f, cy = getHeight() / 2f; RectF box = new RectF(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2);
            ink(PocketDesign.LINE, Paint.Style.STROKE, 3); canvas.drawOval(box, paint);
            if (Double.isFinite(values[0])) { ink(color, Paint.Style.STROKE, 3); canvas.drawArc(box, -90, (float) Math.max(0, Math.min(360, values[0] * 3.6)), false, paint); }
            ink(color, Paint.Style.FILL, 1); paint.setTypeface(PocketFonts.pixel(getContext())); paint.setTextSize(dp(32)); paint.setTextAlign(Paint.Align.CENTER);
            while (paint.measureText(ringText) > side - dp(10) && paint.getTextSize() > dp(18)) paint.setTextSize(paint.getTextSize() - 1);
            canvas.drawText(ringText, cx, cy - (paint.ascent() + paint.descent()) / 2, paint); return;
        }
        if (kind == Kind.ROUTE) { if (route == null) return; canvas.save(); canvas.scale(getWidth() / 320f, getHeight() / 190f); ink(color, Paint.Style.STROKE, 1.5f); canvas.drawPath(route, paint);
            if (routeStart != null && Double.isFinite(routeStart[0]) && Double.isFinite(routeStart[1])) { ink(color, Paint.Style.FILL, 1); canvas.drawCircle((float) routeStart[0], (float) routeStart[1], 4, paint); } canvas.restore(); return; }
        if (kind == Kind.STACK) { double total = 0; for (double v : values) if (Double.isFinite(v)) total += Math.max(0, v); if (total == 0) return;
            float at = 0; int[] tones = {PocketDesign.MOVEMENT, PocketDesign.MUTED, PocketDesign.CALENDAR, PocketDesign.LINE};
            for (int i = 0; i < values.length; i++) if (Double.isFinite(values[i])) { float width = (float) (Math.max(0, values[i]) / total * getWidth()); ink(tones[i % tones.length], Paint.Style.FILL, 1); canvas.drawRect(at, dp(5), at + width, getHeight() - dp(5), paint); at += width; } return; }
        if (kind == Kind.METER) {
            ink(PocketDesign.LINE, Paint.Style.FILL, 1); canvas.drawRect(left(), dp(12), right(), dp(18), paint);
            if (Double.isFinite(min) && Double.isFinite(max) && max > min) {
                if (low != null && high != null && Double.isFinite(low[0]) && Double.isFinite(high[0])) { ink(PocketDesign.MUTED, Paint.Style.FILL, 1); canvas.drawRect(meterX(low[0]), dp(12), meterX(high[0]), dp(18), paint); }
                if (Double.isFinite(baseline)) { ink(PocketDesign.WHITE, Paint.Style.STROKE, 1); canvas.drawLine(meterX(baseline), dp(6), meterX(baseline), dp(24), paint); }
                if (values.length > 0 && Double.isFinite(values[0])) { ink(color, Paint.Style.FILL, 1); canvas.drawCircle(meterX(values[0]), dp(15), dp(4), paint); }
            } return;
        }
        double bottom = Double.isFinite(min) ? min : Double.POSITIVE_INFINITY, top = Double.isFinite(max) ? max : Double.NEGATIVE_INFINITY;
        for (double[] channel : new double[][]{values, second, low, high}) if (channel != null) for (double v : channel) if (Double.isFinite(v)) { if (!Double.isFinite(min)) bottom = Math.min(bottom, v); if (!Double.isFinite(max)) top = Math.max(top, v); }
        if (kind == Kind.BARS || kind == Kind.PAIR) bottom = Math.min(0, bottom);
        if (!Double.isFinite(bottom) || !Double.isFinite(top)) { text(canvas, "—", getWidth() / 2f, getHeight() / 2f, Paint.Align.CENTER); return; }
        if (top <= bottom) { top += 1; bottom -= kind == Kind.LINE ? 1 : 0; }
        if (kind == Kind.LINE && !Double.isFinite(min)) { double space = Math.max(.5, (top - bottom) * .08); top += space; bottom -= space; }
        ink(PocketDesign.LINE, Paint.Style.STROKE, 1); float base = getHeight() - dp(30); canvas.drawLine(left(), base, right(), base, paint);
        if (low != null && high != null) { ink(0x554F5949, Paint.Style.FILL, 1); for (int i = 0; i < Math.min(low.length, high.length); i++) if (Double.isFinite(low[i]) && Double.isFinite(high[i])) { float w = (right() - left()) / Math.max(1, values.length - 1); canvas.drawRect(x(i) - w / 2, y(high[i], bottom, top), x(i) + w / 2, y(low[i], bottom, top), paint); } }
        if (kind == Kind.BARS) { ink(color, Paint.Style.FILL, 1); float width = Math.max(1, (right() - left()) / Math.max(1, values.length) - dp(3));
            for (int i = 0; i < values.length; i++) if (Double.isFinite(values[i])) canvas.drawRect(x(i) - width / 2, y(values[i], bottom, top), x(i) + width / 2, y(0, bottom, top), paint);
        } else { path(canvas, values, bottom, top, color); if (second != null) path(canvas, second, bottom, top, PocketDesign.WHITE); }
        if (cursor != null && cursor.index >= 0 && cursor.index < values.length) {
            int index = cursor.index; ink(PocketDesign.WHITE, Paint.Style.STROKE, 1); canvas.drawLine(x(index), dp(10), x(index), base, paint);
            if (Double.isFinite(values[index])) { ink(color, Paint.Style.FILL, 1); canvas.drawCircle(x(index), y(values[index], bottom, top), dp(3), paint); }
        }
        if (labels.length > 0) { text(canvas, labels[0], left(), getHeight() - dp(6), Paint.Align.LEFT); text(canvas, labels[labels.length - 1], right(), getHeight() - dp(6), Paint.Align.RIGHT); }
    }
    private float meterX(double value) { return left() + (float) Math.max(0, Math.min(1, (value - min) / (max - min))) * (right() - left()); }
    private void path(Canvas canvas, double[] data, double min, double max, int color) {
        Path path = new Path(); boolean continued = false;
        for (int i = 0; i < Math.min(values.length, data.length); i++) { if (!Double.isFinite(data[i])) { continued = false; continue; } if (continued) path.lineTo(x(i), y(data[i], min, max)); else path.moveTo(x(i), y(data[i], min, max)); continued = true; }
        ink(color, Paint.Style.STROKE, 1.5f); canvas.drawPath(path, paint);
    }
    private void text(Canvas canvas, String text, float x, float y, Paint.Align align) { ink(PocketDesign.MUTED, Paint.Style.FILL, 1); paint.setTypeface(PocketFonts.body(getContext())); paint.setTextSize(11 * getResources().getDisplayMetrics().scaledDensity); paint.setTextAlign(align); canvas.drawText(text, x, y, paint); }
    private int indexAt(float x) { return Math.max(0, Math.min(values.length - 1, Math.round((x - left()) / (right() - left()) * (values.length - 1)))); }
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (cursor == null || values.length == 0) return super.onTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = event.getX(); downY = event.getY(); cursor.set(indexAt(downX)); return true; }
        if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
            float dx = Math.abs(event.getX() - downX), dy = Math.abs(event.getY() - downY); int slop = ViewConfiguration.get(getContext()).getScaledTouchSlop();
            if (dy > dx && dy > slop) return false;
            if (dx > slop && getParent() != null) getParent().requestDisallowInterceptTouchEvent(true); cursor.set(indexAt(event.getX())); return true;
        }
        if (event.getActionMasked() == MotionEvent.ACTION_UP) { performClick(); if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(false); return true; }
        if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) { if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(false); return true; }
        return super.onTouchEvent(event);
    }
    @Override public boolean performClick() { super.performClick(); announce(); return true; }
    private void step(int direction) { if (values.length == 0 || cursor == null) return; int jump = Math.max(1, values.length / 50); cursor.set(Math.max(0, Math.min(values.length - 1, (cursor.index < 0 ? direction > 0 ? -jump : values.length - 1 + jump : cursor.index) + direction * jump))); announce(); }
    private void announce() { if (cursor != null && cursor.index >= 0 && cursor.index < values.length) announceForAccessibility(title + ", " + (cursor.index < labels.length ? labels[cursor.index] : "") + ", " + format.apply(values[cursor.index])); }
    @Override public boolean onKeyDown(int code, KeyEvent event) {
        if (cursor != null && (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT)) { step(code == KeyEvent.KEYCODE_DPAD_LEFT ? -1 : 1); return true; }
        if (cursor != null && code == KeyEvent.KEYCODE_ESCAPE) { cursor.set(-1); return true; } return super.onKeyDown(code, event);
    }
    @Override public void onInitializeAccessibilityNodeInfo(AccessibilityNodeInfo info) { super.onInitializeAccessibilityNodeInfo(info); if (cursor != null) { info.setScrollable(true); info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD); info.addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_BACKWARD); } }
    @Override public boolean performAccessibilityAction(int action, Bundle args) {
        if (cursor != null && (action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD || action == AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) { step(action == AccessibilityNodeInfo.ACTION_SCROLL_FORWARD ? 1 : -1); return true; } return super.performAccessibilityAction(action, args);
    }
    static double[] array(JSONArray values) { if (values == null) return new double[0]; double[] data = new double[values.length()]; for (int i = 0; i < data.length; i++) data[i] = values.optDouble(i, Double.NaN); return data; }
}
