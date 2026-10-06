package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/**
 * The pull-to-refresh and sync loader: pip at one of his activities, a turning cartridge or a spinning coin, picked at random.
 * Frames are baked bitmaps from {@link RetroSprites}; nothing is allocated per frame.
 */
final class RetroLoadingView extends View {
    private static final int PIP = 0, CART = 1, COIN = 2;
    private final Paint paint = new Paint();
    private final java.util.Random random = new java.util.Random();
    private boolean active, attached;
    private int frame, kind, activity;
    private float pulled;
    private final Runnable tick = new Runnable() { public void run() {
        if (!playing()) return;
        frame++; String[] frames = frames();
        if (kind == PIP && frame % frames.length == 0 && frame >= frames.length * 2) { activity = (activity + 1 + random.nextInt(SpriteArt.ACTIVITIES - 1)) % SpriteArt.ACTIVITIES; frame = 0; }
        invalidate(); postDelayed(this, step());
    }};
    RetroLoadingView(Context context) {
        super(context);
        setContentDescription("Syncing Pocket"); setFocusable(false);
        setMinimumHeight(PocketDesign.dp(context, 96)); setMinimumWidth(PocketDesign.dp(context, 96));
        choose();
    }
    private void choose() { kind = new int[]{PIP, PIP, CART, COIN}[random.nextInt(4)]; activity = random.nextInt(SpriteArt.ACTIVITIES); frame = 0; }
    private String[] frames() { return kind == PIP ? SpriteArt.activity(activity) : kind == CART ? RetroSprites.CART : RetroSprites.COIN; }
    private long step() { return kind == PIP ? 110 : kind == CART ? 70 : 80; }
    void running(boolean value) {
        if (value && !active) choose();
        active = value; if (!value) pulled = 0;
        removeCallbacks(tick); invalidate(); if (playing()) postDelayed(tick, step());
    }
    /** While pulling, pip crouches further the further the page is pulled; the cartridge and coin turn with the finger. */
    void pull(float progress) { if (!active) { pulled = Math.max(0, Math.min(.999f, progress)); invalidate(); } }
    private boolean playing() { return active && attached && isShown() && getWindowVisibility()==VISIBLE && getContext() instanceof android.app.Activity && PageMotion.enabled((android.app.Activity)getContext()); }
    private void resume() { removeCallbacks(tick); if(playing())postDelayed(tick, step()); }
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();attached=true;resume();}
    @Override protected void onDetachedFromWindow(){attached=false;removeCallbacks(tick);super.onDetachedFromWindow();}
    @Override protected void onVisibilityChanged(View v,int visibility){super.onVisibilityChanged(v,visibility);if(paint!=null)resume();}
    @Override protected void onWindowVisibilityChanged(int visibility){super.onWindowVisibilityChanged(visibility);if(paint!=null)resume();}
    @Override protected void onDraw(Canvas canvas) {
        boolean pulling = !active && pulled > 0;
        String[] frames = pulling && kind == PIP ? SpriteArt.activity(SpriteArt.PULL) : frames();
        int index = pulling ? Math.min(frames.length - 1, (int)(pulled * frames.length)) : frame % frames.length;
        SpriteArt.draw(canvas, getWidth(), getHeight(), frames[index], PocketDesign.accent(getContext()), paint);
    }
}
