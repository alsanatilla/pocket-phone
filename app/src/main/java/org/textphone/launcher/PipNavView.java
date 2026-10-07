package org.textphone.launcher;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** The real Pip sprite in navigation. Its transparent sheet gives the character room to move. */
final class PipNavView extends View {
    private final Activity activity;
    private final SpriteArt art = new SpriteArt();
    private final Paint pixels = new Paint();
    private final int frameSize;
    private int frame, loops, pose, accent;
    private boolean attached, motionAllowed;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!playing()) return;
            frame++;
            if (frame % SpriteArt.frames(false, pose) == 0 && ++loops >= 2) {
                loops = 0; frame = 0; pose = (pose + 1) % SpriteArt.ACTIVITIES;
            }
            invalidate();
            postDelayed(this, SpriteArt.step(false, pose));
        }
    };

    PipNavView(Activity activity, int frameDp) {
        super(activity);
        this.activity = activity;
        frameSize = PocketDesign.dp(activity, Math.max(48, frameDp));
        accent = PocketDesign.accent(activity);
        setMinimumWidth(PocketDesign.dp(activity, 48));
        setMinimumHeight(PocketDesign.dp(activity, 48));
        setContentDescription("Pip");
        setFocusable(true);
        setClickable(true);
        setBackground(PocketDesign.interaction(activity, PocketDesign.INK));
        setTag("pip_nav_mascot");
        SpriteArt.prepare(activity, accent, this);
    }

    private boolean playing() {
        return attached && hasWindowFocus() && motionAllowed && isShown() && getWindowVisibility() == VISIBLE
                && !activity.isFinishing();
    }
    private void refresh() {
        removeCallbacks(tick);
        accent = PocketDesign.accent(activity);
        motionAllowed = PageMotion.enabled(activity);
        if (!motionAllowed) frame = 0;
        invalidate();
        if (playing()) postDelayed(tick, SpriteArt.step(false, pose));
    }
    @Override protected void onAttachedToWindow() { super.onAttachedToWindow(); attached = true; refresh(); }
    @Override protected void onDetachedFromWindow() { attached = false; removeCallbacks(tick); super.onDetachedFromWindow(); }
    @Override protected void onVisibilityChanged(View changed, int visibility) { super.onVisibilityChanged(changed, visibility); if (activity != null) refresh(); }
    @Override protected void onWindowVisibilityChanged(int visibility) { super.onWindowVisibilityChanged(visibility); if (activity != null) refresh(); }
    @Override public void onWindowFocusChanged(boolean hasFocus) { super.onWindowFocusChanged(hasFocus); if (activity != null) refresh(); }
    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        setMeasuredDimension(resolveSize(frameSize, widthSpec), resolveSize(frameSize, heightSpec));
    }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        // Native focus feedback stays available, including when reduced motion freezes the sprite.
        int currentAccent = PocketDesign.accent(activity);
        if (accent != currentAccent) { accent = currentAccent; SpriteArt.prepare(activity, accent, this); }
        int side = Math.min(frameSize, Math.min(getWidth(), getHeight()));
        int save = canvas.save();
        float factor = side / (float)Math.max(1, Math.min(getWidth(), getHeight()));
        canvas.scale(factor, factor, getWidth() / 2f, getHeight() / 2f);
        art.draw(this, canvas, false, pose, motionAllowed ? frame : 2, accent, pixels);
        canvas.restoreToCount(save);
    }
}
