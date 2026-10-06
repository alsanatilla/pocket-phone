package org.textphone.launcher;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Short native property transitions; no touch handlers, screenshots or gesture exclusions.
 * Pages move along one horizontal axis: forward enters from the right, Back from the left. The old page
 * fades out first and the new one follows a moment later, so building the new page never stalls a visible frame.
 * Animated pages draw through a hardware layer, so fading them does not redraw their whole tree each frame.
 */
final class PageMotion {
    private static final PathInterpolator EASE = new PathInterpolator(.2f, 0, 0, 1);
    private static final PathInterpolator EXIT = new PathInterpolator(.4f, 0, 1, 1), ENTER = new PathInterpolator(0, 0, .2f, 1);
    static final long EXIT_MS = 90, ENTER_DELAY_MS = 60, ENTER_MS = 210, SHIFT_DP = 24;
    private final Activity activity;
    private final FrameLayout host;
    private final Map<String, View> previews = new LinkedHashMap<>();
    private final Map<String, Integer> scrolls = new LinkedHashMap<>();
    private View current, outgoing, peek;
    private String key, outgoingKey, peekKey;
    private FrameLayout peekContainer;
    private boolean back, gesture, committing;
    private float progress, edge = 1;
    private Runnable restoreCleanup;
    private Integer restoreY;
    private boolean dataReady;

    PageMotion(Activity activity) {
        this.activity = activity; host = new FrameLayout(activity); host.setBackgroundColor(android.graphics.Color.BLACK);
    }
    FrameLayout host() { return host; }
    static boolean enabled(Activity activity) {
        if (Build.VERSION.SDK_INT >= 24) { android.os.UserManager user = activity.getSystemService(android.os.UserManager.class); if (user != null && !user.isUserUnlocked()) return false; }
        if (activity.getSharedPreferences("text_phone", 0).getBoolean("reduce_motion", false)) return false;
        if (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) return false;
        try { return Settings.Global.getFloat(activity.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1) > 0; }
        catch (SecurityException ignored) { return true; }
    }
    private float dp(float value) { return value * activity.getResources().getDisplayMetrics().density; }
    private static void reset(View view) {
        if (view == null) return; view.animate().cancel(); view.animate().setStartDelay(0);
        view.setAlpha(1); view.setTranslationX(0); view.setTranslationY(0); view.setScaleX(1); view.setScaleY(1);
    }
    private void cache(String name, View view) {
        if (name == null || view == null || name.equals(key)) return;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        reset(view); previews.remove(name); previews.put(name, view);
        while (previews.size() > 3) previews.remove(previews.keySet().iterator().next());
    }
    private void finishOutgoing() {
        View old = outgoing; String name = outgoingKey; outgoing = null; outgoingKey = null;
        if (old != null) { old.animate().cancel(); host.getOverlay().remove(old); cache(name, old); }
    }
    private void finishPeek() {
        View old = peek; String name = peekKey; peek = null; peekKey = null;
        if (peekContainer != null) { peekContainer.removeAllViews(); host.removeView(peekContainer); peekContainer = null; }
        cache(name, old);
    }
    private boolean instant;
    void instant(Runnable action) {
        settle(); instant = true;
        try { action.run(); } finally { instant = false; settle(); }
    }
    void show(View next, String destination) {
        boolean fromGesture = committing && gesture;
        finishOutgoing(); if (!fromGesture) reset(current); finishPeek();
        saveScroll(); clearRestore();
        View previous = current; String previousKey = key;
        current = next; key = destination; previews.remove(destination);
        if (previous != null && !destination.equals(previousKey) && previous.findFocus() instanceof android.widget.EditText) {
            android.view.inputmethod.InputMethodManager input = activity.getSystemService(android.view.inputmethod.InputMethodManager.class);
            if (input != null) input.hideSoftInputFromWindow(previous.getWindowToken(), 0);
        }
        if (previous != null) { previous.clearFocus(); host.removeView(previous); }
        host.addView(next, new FrameLayout.LayoutParams(-1, -1));
        restoreScroll();
        boolean animate = !instant && previous != null && !destination.equals(previousKey) && enabled(activity) && host.isLaidOut();
        if (animate) {
            outgoing = previous; outgoingKey = previousKey; host.getOverlay().add(previous);
            if (fromGesture) {
                // The finger already moved the page; finish the same motion instead of starting a new one.
                long duration = Math.max(80, Math.round(200 * (1 - progress)));
                next.animate().alpha(1).translationX(0).scaleX(1).scaleY(1).setDuration(duration).setInterpolator(EASE).start();
                previous.animate().alpha(0).translationX(edge * Math.max(host.getWidth(), dp(240))).setDuration(duration).setInterpolator(EASE)
                        .withLayer().withEndAction(() -> { if (outgoing == previous) finishOutgoing(); }).start();
            } else {
                float direction = back ? 1 : -1;
                next.setAlpha(0); next.setTranslationX(-direction * dp(SHIFT_DP));
                next.animate().alpha(1).translationX(0).scaleX(1).scaleY(1).setStartDelay(ENTER_DELAY_MS).setDuration(ENTER_MS)
                        .setInterpolator(ENTER).withLayer().withEndAction(() -> next.animate().setStartDelay(0)).start();
                previous.animate().alpha(0).translationX(direction * dp(SHIFT_DP)).setDuration(EXIT_MS).setInterpolator(EXIT)
                        .withLayer().withEndAction(() -> { if (outgoing == previous) finishOutgoing(); }).start();
            }
        } else { cache(previousKey, previous); reset(next); }
        gesture = false; committing = false; progress = 0; back = false;
    }
    void back(Runnable action) {
        back = true; committing = gesture;
        try { action.run(); } finally { back = false; committing = false; if (gesture) cancelImmediately(); }
    }
    void startBack(String destination, boolean fromLeft) {
        settle(); if (!enabled(activity) || current == null) return;
        gesture = true; edge = fromLeft ? 1 : -1; progress = 0;
        if (destination != null) { peek = previews.remove(destination); peekKey = destination; }
        if (peek != null) {
            peekContainer = new FrameLayout(activity) {
                @Override public boolean dispatchTouchEvent(android.view.MotionEvent event) { return true; }
            };
            peekContainer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            peekContainer.addView(peek, new FrameLayout.LayoutParams(-1, -1)); host.addView(peekContainer, 0, new FrameLayout.LayoutParams(-1, -1));
            // The parent stays opaque under the moving page; only transforms change per frame.
            peek.setAlpha(1); peek.setTranslationX(-edge * dp(SHIFT_DP));
        }
    }
    void progressBack(float value) {
        if (!gesture || current == null) return; progress = Math.max(0, Math.min(1, value));
        current.setTranslationX(edge * progress * Math.max(host.getWidth(), dp(240)) * .22f);
        current.setScaleX(1 - .04f * progress); current.setScaleY(1 - .04f * progress); current.setAlpha(1);
        if (peek != null) peek.setTranslationX(-edge * dp(SHIFT_DP) * (1 - progress));
    }
    void cancelBack() {
        if (!gesture) return; gesture = false; progress = 0;
        View target = current;
        if (!enabled(activity)) { reset(target); finishPeek(); return; }
        target.animate().translationX(0).scaleX(1).scaleY(1).alpha(1).setStartDelay(0).setDuration(160).setInterpolator(EASE).withEndAction(() -> {
            if (current == target && !gesture) finishPeek();
        }).start();
    }
    private void cancelImmediately() { gesture = false; progress = 0; reset(current); finishPeek(); }
    void settle() { finishOutgoing(); cancelImmediately(); }
    /** Remove visual references before callers recycle a photo bitmap or lose read access. */
    void discardHistory() { settle(); previews.clear(); }
    private static ScrollView scroll(View view) {
        if (view instanceof ScrollView) return (ScrollView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            ScrollView found = scroll(((ViewGroup) view).getChildAt(i)); if (found != null) return found;
        }
        return null;
    }
    private void saveScroll() {
        ScrollView viewport = scroll(current); if (viewport == null || key == null) return;
        scrolls.remove(key); scrolls.put(key, viewport.getScrollY());
        while (scrolls.size() > 32) scrolls.remove(scrolls.keySet().iterator().next());
    }
    private void clearRestore() { if (restoreCleanup != null) restoreCleanup.run(); restoreCleanup = null; restoreY = null; }
    private void restoreScroll() {
        ScrollView viewport = scroll(current); if (viewport == null) return;
        restoreY = scrolls.get(key); dataReady = false;
        if (restoreY == null || restoreY == 0) { restoreY = null; return; }
        View target = current;
        ViewTreeObserver.OnGlobalLayoutListener listener = () -> {
            if (current != target || restoreY == null || viewport.getChildCount() == 0) return;
            int range = Math.max(0, viewport.getChildAt(0).getHeight() - viewport.getHeight() + viewport.getPaddingTop() + viewport.getPaddingBottom());
            if (range >= restoreY || dataReady) { int position = Math.min(range, restoreY); clearRestore(); viewport.scrollTo(0, position); }
        };
        viewport.getViewTreeObserver().addOnGlobalLayoutListener(listener);
        restoreCleanup = () -> { if (viewport.getViewTreeObserver().isAlive()) viewport.getViewTreeObserver().removeOnGlobalLayoutListener(listener); };
    }
    void dataReady() { dataReady = true; }
    void save(BundleWriter writer) { saveScroll(); for (Map.Entry<String, Integer> item : scrolls.entrySet()) writer.put(item.getKey(), item.getValue()); }
    interface BundleWriter { void put(String key, int y); }
    void restore(android.os.Bundle state) { if (state != null) for (String name : state.keySet()) scrolls.put(name, state.getInt(name)); }
    void destroy() { discardHistory(); clearRestore(); }
}
