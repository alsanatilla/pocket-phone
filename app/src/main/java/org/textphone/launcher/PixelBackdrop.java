package org.textphone.launcher;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

/** Static original sky artwork; same ordered-dither kernel as the browser. */
final class PixelBackdrop extends Drawable {
    private static final int[] BAYER = {0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
    private final int height, cell, accent;
    private final Paint paint = new Paint();
    private Bitmap image;
    private int columns, rows;

    PixelBackdrop(Context context, int accent, int heightDp) {
        this.accent = accent;
        height = PocketDesign.dp(context, heightDp);
        cell = Math.max(1, PocketDesign.dp(context, 2));
        paint.setAntiAlias(false); paint.setFilterBitmap(false); paint.setDither(false);
    }

    private static double clamp(double value) { return Math.max(0, Math.min(1, value)); }
    private static double smooth(double a, double b, double value) {
        double t = clamp((value-a)/(b-a)); return t*t*(3-2*t);
    }
    static int shade(int x, int y, int width, int height) {
        double u=(x+.5)/width, v=(y+.5)/height, aspect=(double)width/height;
        double cloud=Math.sin(u*19+Math.sin(v*11)*2)+.55*Math.sin(u*43-v*17)+.3*Math.cos(u*83+v*29);
        double light=.11+.13*smooth(-.3,1.25,cloud)*(1-smooth(.32,.64,v));
        double moon=Math.hypot((u-.78)*aspect,v-.19);
        light+=.11*Math.exp(-moon*19);
        if(moon<.066)light=.65;
        double ridge=.53+.045*Math.sin(u*14)+.03*Math.sin(u*31+1);
        if(v>ridge)light=.075+.035*Math.sin(v*125+u*23);
        if(v>ridge+.09)light*=.72;
        light*=1-smooth(.46,.99,v);
        light*=.3+.7*smooth(.10,.68,u);
        double value=clamp(light)*10; int base=(int)Math.floor(value);
        return Math.min(7,base+(value-base>(BAYER[(y%4)*4+x%4]+.5)/16?1:0));
    }

    @Override public void draw(Canvas canvas) {
        Rect bounds=getBounds();
        if(bounds.width()<=0||bounds.height()<=0)return;
        int drawHeight=Math.min(height,bounds.height());
        int width=Math.max(1,(bounds.width()+cell-1)/cell), high=Math.max(1,(drawHeight+cell-1)/cell);
        if(image==null||columns!=width||rows!=high){
            columns=width;rows=high;int[] pixels=new int[width*high];
            int red=accent>>16&255, green=accent>>8&255, blue=accent&255;
            for(int y=0;y<high;y++)for(int x=0;x<width;x++){
                int level=shade(x,y,width,high);
                int r=(int)Math.round((red*.55+255*.45)*level/7);
                int g=(int)Math.round((green*.55+255*.45)*level/7);
                int b=(int)Math.round((blue*.55+255*.45)*level/7);
                pixels[y*width+x]=0xff000000|r<<16|g<<8|b;
            }
            image=Bitmap.createBitmap(pixels,width,high,Bitmap.Config.ARGB_8888);
        }
        int saved=canvas.save();canvas.clipRect(bounds);
        canvas.drawColor(PocketDesign.BLACK);
        canvas.drawBitmap(image,null,new Rect(bounds.left,bounds.top,bounds.left+width*cell,bounds.top+high*cell),paint);
        canvas.restoreToCount(saved);
    }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
