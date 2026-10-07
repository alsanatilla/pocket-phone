package org.textphone.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.view.View;
import android.widget.LinearLayout;

/** Small native marks shared by the launcher and its workspace. Content stays on a plain surface. */
final class WarmWorkspace {
    static final int INK = 0xFF12110F, PLANE = 0xFF1E1C18, TEXT = 0xFFF0E9DD,
            MUTED = 0xFFB6AC9D, LINE = 0xFF3E392F, AMBER = 0xFFECC981,
            CALENDAR = 0xFFA5BFDC, THOUGHT = 0xFFC1AED5, MOVEMENT = 0xFFADBF9C,
            OVERDUE = 0xFFEFA58E;

    static void rule(LinearLayout host) {
        View line = new View(host.getContext()); line.setBackgroundColor(LINE);
        line.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        host.addView(line, new LinearLayout.LayoutParams(-1, Math.max(1, PocketDesign.dp(host.getContext(), 1))));
    }

    static int color(String kind) {
        if ("movement".equals(kind) || "gym".equals(kind) || "recovery".equals(kind)) return MOVEMENT;
        if ("thoughts".equals(kind) || "notes".equals(kind) || "paper".equals(kind) || "thought".equals(kind)) return THOUGHT;
        if ("agenda".equals(kind) || "calendar".equals(kind) || "condition".equals(kind)) return CALENDAR;
        return MUTED;
    }

    static final class Meter extends View {
        private final Paint paint = new Paint(); private final int color; private int score = -1;
        Meter(Context context, int color) { super(context); this.color = color; setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
        void score(int value) { score = value; invalidate(); }
        @Override protected void onDraw(Canvas canvas) {
            float gap = PocketDesign.dp(getContext(), 3), width = Math.max(0, (getWidth() - gap * 9) / 10f);
            int filled = score < 0 ? 0 : Math.max(0, Math.min(10, Math.round(score / 10f)));
            for (int i = 0; i < 10; i++) { paint.setColor(i < filled ? color : LINE); float left = i * (width + gap); canvas.drawRect(left, 0, left + width, getHeight(), paint); }
        }
    }

    /** Pixel-shaped navigation and app marks drawn without a font-dependent symbol. */
    static final class Glyph extends View {
        private final Paint paint = new Paint(); private final String kind; private final int color;
        Glyph(Context context, String kind, int color) { super(context); this.kind = kind; this.color = color; setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO); }
        @Override protected void onDraw(Canvas canvas) {
            float width = getWidth() - getPaddingLeft() - getPaddingRight(), height = getHeight() - getPaddingTop() - getPaddingBottom();
            float scale = Math.min(width, height) / 18f; canvas.save();
            canvas.translate(getPaddingLeft() + (width - 18 * scale) / 2, getPaddingTop() + (height - 18 * scale) / 2); canvas.scale(scale, scale); paint.setColor(color);
            if ("capture".equals(kind)) { rect(canvas,8,2,10,16); rect(canvas,2,8,16,10); }
            else if ("search".equals(kind)) { outline(canvas,2,2,12,12); rect(canvas,11,11,14,14); rect(canvas,13,13,16,16); }
            else if ("apps".equals(kind) || "group".equals(kind)) { rect(canvas,2,2,7,7);rect(canvas,11,2,16,7);rect(canvas,2,11,7,16);rect(canvas,11,11,16,16); }
            else if ("today".equals(kind)) { rect(canvas,2,8,4,16);rect(canvas,14,8,16,16);rect(canvas,4,14,14,16);rect(canvas,7,10,11,16);for(int i=0;i<6;i++){rect(canvas,3+i,7-i,5+i,9-i);rect(canvas,10+i,2+i,12+i,4+i);} }
            else if ("calendar".equals(kind) || "agenda".equals(kind) || "clock".equals(kind)) { outline(canvas,2,3,16,16);rect(canvas,2,6,16,8);rect(canvas,5,1,7,5);rect(canvas,11,1,13,5);rect(canvas,5,10,7,12);rect(canvas,10,10,12,12); }
            else if ("tasks".equals(kind)) { rect(canvas,2,5,5,7);rect(canvas,4,3,6,7);rect(canvas,6,2,8,4);rect(canvas,10,4,16,6);rect(canvas,2,12,5,14);rect(canvas,4,10,6,14);rect(canvas,6,9,8,11);rect(canvas,10,11,16,13); }
            else if ("thoughts".equals(kind)) { outline(canvas,2,2,16,12);rect(canvas,7,12,11,15);rect(canvas,6,16,12,18); }
            else if ("movement".equals(kind) || "gym".equals(kind)) { rect(canvas,2,9,5,11);rect(canvas,5,5,7,11);rect(canvas,7,3,9,7);rect(canvas,9,5,11,15);rect(canvas,11,10,13,15);rect(canvas,13,9,16,11); }
            else if ("phone".equals(kind) || "contacts".equals(kind)) { outline(canvas,5,1,13,17);rect(canvas,8,13,10,15); }
            else if ("messages".equals(kind) || "pip".equals(kind)) { outline(canvas,2,3,16,13);rect(canvas,4,13,7,16);rect(canvas,5,7,13,9); }
            else if ("camera".equals(kind) || "photos".equals(kind)) { outline(canvas,2,5,16,15);rect(canvas,6,2,12,5);outline(canvas,6,7,12,13); }
            else if ("dice".equals(kind)) { outline(canvas,2,2,16,16);rect(canvas,5,5,7,7);rect(canvas,11,5,13,7);rect(canvas,8,8,10,10);rect(canvas,5,11,7,13);rect(canvas,11,11,13,13); }
            else { outline(canvas,3,2,15,16);rect(canvas,6,5,12,7);rect(canvas,6,9,12,11);rect(canvas,6,13,10,15); }
            canvas.restore();
        }
        private void rect(Canvas c,float left,float top,float right,float bottom) { c.drawRect(left,top,right,bottom,paint); }
        private void outline(Canvas c,float l,float t,float r,float b) { rect(c,l,t,r,t+1);rect(c,l,b-1,r,b);rect(c,l,t,l+1,b);rect(c,r-1,t,r,b); }
    }
    private WarmWorkspace() { }
}
