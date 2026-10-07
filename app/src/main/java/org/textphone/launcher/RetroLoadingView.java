package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/**
 * The pull-to-refresh and sync loader: pip (PS1) at one of his activities, or the PS2-style memory-card save screen,
 * picked at random. Frames come from sprite sheets in assets; nothing is allocated per frame.
 */
final class RetroLoadingView extends View {
    private final Paint paint = new Paint();
    private final SpriteArt art = new SpriteArt();
    private final java.util.Random random = new java.util.Random();
    private boolean active, attached, saveScreen;
    private int frame, activity;
    private float pulled;
    private final Runnable tick = new Runnable() { public void run() {
        if (!playing()) return;
        frame++;
        if (!saveScreen && frame % SpriteArt.frames(false, activity) == 0 && frame >= SpriteArt.frames(false, activity) * 2) { activity = (activity + 1 + random.nextInt(SpriteArt.ACTIVITIES - 1)) % SpriteArt.ACTIVITIES; frame = 0; }
        invalidate(); postDelayed(this, SpriteArt.step(saveScreen, activity));
    }};
    RetroLoadingView(Context context) {
        super(context);
        setContentDescription("Syncing Pocket"); setFocusable(false);
        setMinimumHeight(PocketDesign.dp(context, 96)); setMinimumWidth(PocketDesign.dp(context, 96));
        choose(); SpriteArt.prepare(context, PocketDesign.accent(context), this);
    }
    private void choose() { saveScreen = random.nextInt(3) == 0; activity = random.nextInt(SpriteArt.ACTIVITIES); frame = 0; }
    void running(boolean value) {
        if (value && !active) choose();
        active = value; if (!value) pulled = 0;
        removeCallbacks(tick); invalidate(); if (playing()) postDelayed(tick, SpriteArt.step(saveScreen, activity));
    }
    /** While pulling, pip crouches further the further the page is pulled. */
    void pull(float progress) { if (!active) { pulled = Math.max(0, Math.min(.999f, progress)); invalidate(); } }
    private boolean playing() { return active && attached && isShown() && getWindowVisibility()==VISIBLE && getContext() instanceof android.app.Activity && PageMotion.enabled((android.app.Activity)getContext()); }
    private void resume() { removeCallbacks(tick); if(playing())postDelayed(tick, SpriteArt.step(saveScreen, activity)); }
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();attached=true;resume();}
    @Override protected void onDetachedFromWindow(){attached=false;removeCallbacks(tick);super.onDetachedFromWindow();}
    @Override protected void onVisibilityChanged(View v,int visibility){super.onVisibilityChanged(v,visibility);if(paint!=null)resume();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(paint!=null)resume();}
    @Override protected void onDraw(Canvas canvas) {
        int accent = PocketDesign.accent(getContext());
        if (!active && pulled > 0) { int n = SpriteArt.frames(false, SpriteArt.PULL); art.draw(this, canvas, false, SpriteArt.PULL, Math.min(n - 1, (int)(pulled * n)), accent, paint); return; }
        art.draw(this, canvas, saveScreen, activity, frame, accent, paint);
    }
}
