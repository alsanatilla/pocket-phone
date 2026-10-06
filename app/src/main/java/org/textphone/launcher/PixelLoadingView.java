package org.textphone.launcher;

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;

/** The same little pip and playful activities as the browser's pip-pixels.js. */
final class PixelLoadingView extends View {
    private static final int GRID = 32, FRAMES = 64;
    private static final long FRAME_MS = 50;
    private final Activity activity;
    private final Paint pixels = new Paint();
    private boolean running, paused = true, attached, destroyed, scheduled, motionAllowed;
    private int frame, accent, phase, activityPose;
    private final java.util.Random random=new java.util.Random();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            scheduled = false;
            if (!visibleRunning() || !motionAllowed) return;
            frame = (frame + 1) % FRAMES;
            if(frame==0)activityPose=(activityPose+1+random.nextInt(5))%6;
            invalidate();
            schedule();
        }
    };

    PixelLoadingView(Activity activity) {
        super(activity);
        this.activity = activity;
        accent = PocketDesign.accent(activity);
        pixels.setAntiAlias(false);
        pixels.setDither(false);
        setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        setFocusable(false);
        setClickable(false);
        setMinimumWidth(PocketDesign.dp(activity, 44));
        setMinimumHeight(PocketDesign.dp(activity, 44));
        setTag("chat_pixel_loading");
    }

    void setRunning(boolean value) {
        if (running == value || destroyed) return;
        running = value;
        if(value)activityPose=random.nextInt(6);
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
        if (phase != next) { phase = next; invalidate(); }
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
        if (!scheduled && visibleRunning() && motionAllowed) scheduled = postDelayed(tick, FRAME_MS);
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int cell = Math.max(1, Math.min(getWidth(), getHeight()) / GRID);
        int left = (getWidth() - GRID * cell) / 2, top = (getHeight() - GRID * cell) / 2;
        double angle = frame * Math.PI * 2 / FRAMES;
        int x=8,y=10;
        if(activityPose==1)x+=Math.round((float)Math.sin(angle)*5);
        if(activityPose==2)y+=Math.round((float)Math.sin(angle*2));
        if(activityPose==4)y-=Math.round((float)Math.abs(Math.sin(angle))*4);
        pixels.setColor(accent);
        rectangle(canvas,left,top,cell,x+4,y,x+12,y+1);rectangle(canvas,left,top,cell,x+2,y+1,x+14,y+2);
        rectangle(canvas,left,top,cell,x+1,y+2,x+15,y+9);rectangle(canvas,left,top,cell,x+2,y+9,x+14,y+10);rectangle(canvas,left,top,cell,x+3,y+10,x+13,y+11);
        int step=activityPose==1&&frame%16<8?1:0;
        rectangle(canvas,left,top,cell,x+4,y+11+step,x+6,y+13+step);rectangle(canvas,left,top,cell,x+10,y+12-step,x+12,y+14-step);
        int gaze=activityPose==1?(int)Math.signum(Math.cos(angle)):0,eye=frame>=48&&frame<51?1:2;
        pixels.setColor(PocketDesign.BLACK);
        rectangle(canvas,left,top,cell,x+4+gaze,y+4,x+6+gaze,y+4+eye);rectangle(canvas,left,top,cell,x+10+gaze,y+4,x+12+gaze,y+4+eye);
        pixels.setColor(accent);
        if(activityPose==0){int wave=Math.round((float)Math.sin(angle*3));rectangle(canvas,left,top,cell,x-1,y+6,x+1,y+10);rectangle(canvas,left,top,cell,x+15,y+4+wave,x+17,y+8+wave);rectangle(canvas,left,top,cell,x+17,y+2+wave,x+19,y+4+wave);}
        else if(activityPose==2){rectangle(canvas,left,top,cell,x-1,y+6,x+1,y+8);rectangle(canvas,left,top,cell,x+15,y+6,x+17,y+8);for(int i=0;i<3;i++){double arc=angle+i*Math.PI*2/3;int bx=15+Math.round((float)Math.cos(arc)*11),by=5+Math.round((float)Math.sin(arc)*3);rectangle(canvas,left,top,cell,bx,by,bx+2,by+2);}}
        else if(activityPose==3){rectangle(canvas,left,top,cell,x-1,y+7,x+1,y+10);rectangle(canvas,left,top,cell,x+15,y+7,x+17,y+10);pixels.setColor(PocketDesign.WHITE);rectangle(canvas,left,top,cell,x+3,y+9,x+13,y+14);pixels.setColor(PocketDesign.BLACK);rectangle(canvas,left,top,cell,x+8,y+9,x+9,y+14);rectangle(canvas,left,top,cell,x+4,y+10,x+7,y+11);int line=y+11+(frame%32<16?0:1);rectangle(canvas,left,top,cell,x+10,line,x+12,line+1);}
        else if(activityPose==4){rectangle(canvas,left,top,cell,x-1,y+4,x+1,y+7);rectangle(canvas,left,top,cell,x+15,y+4,x+17,y+7);rectangle(canvas,left,top,cell,x-2,y+2,x,y+4);rectangle(canvas,left,top,cell,x+17,y+2,x+19,y+4);}
        else if(activityPose==5){rectangle(canvas,left,top,cell,x-1,y+8,x+1,y+11);rectangle(canvas,left,top,cell,x+15,y+8,x+17,y+11);pixels.setColor(PocketDesign.WHITE);rectangle(canvas,left,top,cell,x+3,y+10,x+13,y+14);pixels.setColor(PocketDesign.BLACK);rectangle(canvas,left,top,cell,x+4,y+11,x+7,y+12);rectangle(canvas,left,top,cell,x+5,y+10,x+6,y+13);int press=frame%16<8?1:0;rectangle(canvas,left,top,cell,x+10+press,y+11,x+11+press,y+12);rectangle(canvas,left,top,cell,x+10,y+12,x+11,y+13);}
        else{rectangle(canvas,left,top,cell,x-1,y+6+step,x+1,y+9+step);rectangle(canvas,left,top,cell,x+15,y+7-step,x+17,y+10-step);}
    }

    private void rectangle(Canvas canvas, int left, int top, int cell, int x, int y, int right, int bottom) {
        canvas.drawRect(left + x * cell, top + y * cell, left + right * cell, top + bottom * cell, pixels);
    }
}
