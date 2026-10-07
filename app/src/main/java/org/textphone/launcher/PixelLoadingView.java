package org.textphone.launcher;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** pip as a PS1-style 3D sprite with six little activities; the same sheets as the browser (drawn by tools/sprites/ps1). */
final class PixelLoadingView extends View {
    private final Activity activity;
    private final Paint pixels = new Paint();
    private final SpriteArt art = new SpriteArt();
    private boolean running, paused = true, attached, destroyed, scheduled, motionAllowed, phaseLocked;
    private int frame, loops, accent, phase, activityPose;
    private final java.util.Random random=new java.util.Random();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            scheduled = false;
            if (!visibleRunning() || !motionAllowed) return;
            frame++;
            if(frame%SpriteArt.frames(false,activityPose)==0&&++loops>=2){loops=0;frame=0;if(!phaseLocked)activityPose=(activityPose+1+random.nextInt(SpriteArt.ACTIVITIES-1))%SpriteArt.ACTIVITIES;}
            invalidate();
            schedule();
        }
    };

    PixelLoadingView(Activity activity) {
        super(activity);
        this.activity = activity;
        accent = PocketDesign.accent(activity);
        SpriteArt.prepare(activity, accent, this);
        pixels.setAntiAlias(false);
        pixels.setDither(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        setFocusable(false);
        setClickable(false);
        setMinimumWidth(PocketDesign.dp(activity, 96));
        setMinimumHeight(PocketDesign.dp(activity, 96));
        setTag("chat_pixel_loading");
    }

    void setRunning(boolean value) {
        if (running == value || destroyed) return;
        running = value;
        if(value&&!phaseLocked)activityPose=random.nextInt(SpriteArt.ACTIVITIES);
        if (!value) frame = 0;
        update();
    }

    void setPaused(boolean value) {
        if (paused == value || destroyed) return;
        paused = value;
        update();
    }

    void refresh() { if (!destroyed) update(); }

    void setPhase(String status) {
        int next = status.startsWith("reading") ? 1 : "writing".equals(status) ? 2 : 0;
        if (phase != next) { phase = next; phaseLocked = next != 0; if (next == 1) activityPose = 3; else if (next == 2) activityPose = 5; frame = 0; loops = 0; invalidate(); }
    }

    void destroy() {
        destroyed = true;
        running = false;
        paused = true;
        removeCallbacks(tick);
        scheduled = false;
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        attached = true;
        update();
    }

    @Override protected void onDetachedFromWindow() {
        attached = false;
        removeCallbacks(tick);
        scheduled = false;
        super.onDetachedFromWindow();
    }

    @Override protected void onVisibilityChanged(View changed, int visibility) {
        super.onVisibilityChanged(changed, visibility);
        if (activity != null) update();
    }

    @Override protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        if (activity != null) update();
    }

    private boolean visibleRunning() {
        return !destroyed && running && !paused && attached && isShown() && getWindowVisibility() == View.VISIBLE;
    }

    private void update() {
        removeCallbacks(tick);
        scheduled = false;
        if (destroyed) return;
        accent = PocketDesign.accent(activity);
        motionAllowed = PageMotion.enabled(activity);
        if (!motionAllowed) frame = 0;
        invalidate();
        if (visibleRunning() && motionAllowed) schedule();
    }

    private void schedule() {
        if (!scheduled && visibleRunning() && motionAllowed) scheduled = postDelayed(tick, SpriteArt.step(false, activityPose));
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // Still frames (motion off, or not yet running) show a mid-animation pose.
        art.draw(this, canvas, false, activityPose, running && motionAllowed ? frame : 2, accent, pixels);
    }
}
