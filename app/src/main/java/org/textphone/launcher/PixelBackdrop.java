package org.textphone.launcher;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

/** Static original artwork, one scene per area; same ordered-dither kernel and scenes as docs/js/pixel-backdrop.js. */
final class PixelBackdrop extends Drawable {
    static final String SKY = "sky", STARS = "stars", ROAD = "road", WAVES = "waves", TERRAIN = "terrain", IRON = "iron", TILES = "tiles", RINGS = "rings", GLOW = "glow";
    private static final int[] BAYER = {0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
    private final int height, cell, accent;
    private final String scene;
    private final Paint paint = new Paint();
    private Bitmap image;
    private int columns, rows;

    PixelBackdrop(Context context, int accent, int heightDp) { this(context, accent, heightDp, SKY); }
    PixelBackdrop(Context context, int accent, int heightDp, String scene) {
        this.accent = accent; this.scene = scene == null ? SKY : scene;
        height = PocketDesign.dp(context, heightDp);
        cell = Math.max(1, PocketDesign.dp(context, 2));
        paint.setAntiAlias(false); paint.setFilterBitmap(false); paint.setDither(false);
    }

    private static double clamp(double value) { return Math.max(0, Math.min(1, value)); }
    private static double smooth(double a, double b, double value) {
        double t = clamp((value-a)/(b-a)); return t*t*(3-2*t);
    }
    private static double fract(double value) { return value-Math.floor(value); }
    private static double hash(double a, double b) { return fract(Math.sin(a*127.1+b*311.7)*43758.5453); }

    private static double sky(double u, double v, double aspect) {
        double cloud=Math.sin(u*19+Math.sin(v*11)*2)+.55*Math.sin(u*43-v*17)+.3*Math.cos(u*83+v*29);
        double light=.11+.13*smooth(-.3,1.25,cloud)*(1-smooth(.32,.64,v));
        double moon=Math.hypot((u-.78)*aspect,v-.19);
        light+=.11*Math.exp(-moon*19);
        if(moon<.066)light=.65;
        double ridge=.53+.045*Math.sin(u*14)+.03*Math.sin(u*31+1);
        if(v>ridge)light=.075+.035*Math.sin(v*125+u*23);
        if(v>ridge+.09)light*=.72;
        return light;
    }
    /** Thoughts: a drifting nebula, scattered stars and one bright idea. */
    private static double stars(int x, int y, double u, double v, int width, int height) {
        double band=v-(.78-.55*u)-.06*Math.sin(u*7+1);
        double light=.04+.16*Math.exp(-band*band*26)*(.6+.4*Math.sin(u*31+v*13)*Math.sin(u*11-v*5));
        int gx=x/5, gy=y/5; double r=hash(gx,gy);
        if(r>.88){int d=Math.abs(x-gx*5-(int)Math.floor(hash(gy,gx)*4))+Math.abs(y-gy*5-(int)Math.floor(fract(r*7.3)*4));
            if(d==0)light=.3+(r-.88)*3;else if(d==1&&r>.975)light=Math.max(light,.2);}
        int dx=Math.abs(x-(int)Math.round(width*.8)), dy=Math.abs(y-(int)Math.round(height*.3));
        light+=.14*Math.exp(-Math.hypot(dx,dy)/7);
        if((dx==0||dy==0)&&dx+dy<9)light=Math.max(light,.66-(dx+dy)*.05);
        return light;
    }
    /** Tasks: a road of grid lines running to a striped sun. */
    private static double road(double u, double v, double aspect, int height) {
        double horizon=.36, sx=(u-.74)*aspect;
        if(v<horizon){
            double light=.04+.12*Math.pow(v/horizon,3);
            double sun=Math.hypot(sx,v-horizon), s=(v-horizon+.3)/.3;
            if(sun<.3&&fract(v*26)>s*.6-.08)light=.34+.2*(1-s);
            return light;
        }
        double d=v-horizon, wx=sx/d*1.4, wz=.5/d, pixel=1.2/height;
        boolean across=Math.abs(wx-Math.round(wx))*d/1.4<pixel, deep=Math.abs(wz-Math.round(wz))*d*d/.5<pixel;
        return .03+.3*Math.max(across?smooth(.07,.24,d):0,deep?smooth(.14,.32,d):0);
    }
    /** Notes: still water with a crescent and its reflection. */
    private static double waves(double u, double v, double aspect) {
        double horizon=.4, mx=(u-.8)*aspect;
        if(v<horizon){
            double light=.05+.09*smooth(0,horizon,v);
            double moon=Math.hypot(mx,v-.2), shadow=Math.hypot(mx+.045,v-.18);
            light+=.08*Math.exp(-moon*14);
            if(moon<.085&&shadow>.075)light=.62;
            return light;
        }
        double d=v-horizon, t=1/(d+.05), crest=Math.sin(t*4.6+Math.sin(u*aspect*t*.9+t)*1.4);
        double light=.04+.1*smooth(.45,1,crest)*(1-smooth(.1,.5,d));
        light+=.34*Math.exp(-mx*mx*90/(1+d*30))*smooth(.2,.9,crest);
        return light;
    }
    /** Movement: contour lines of a hill and a dotted route over it. */
    private static double terrain(int x, double u, double v, double aspect, int height) {
        double px=u*aspect, hx=(u-.78)*aspect;
        double lift=.9*Math.exp(-(hx*hx*1.6+(v-.62)*(v-.62)*7))+.45*Math.exp(-((hx+.9)*(hx+.9)*2.4+(v-.82)*(v-.82)*9))+.04*Math.sin(px*5+v*9);
        double ring=fract(lift*9);
        double light=.03+.1*lift+(ring<.16&&lift>.06?.2:0);
        double route=.86-.5*u+.07*Math.sin(u*13);
        if(Math.abs(v-route)*height<1.1&&x%4<2)light=.5;
        return light;
    }
    /** Gym: bars climbing to the right under a light. */
    private static double iron(int x, int y, double u, double v, double aspect, int width, int height) {
        double glow=Math.hypot((u-.82)*aspect,v+.1);
        double light=.04+.16*Math.exp(-glow*2.2);
        int column=x/7; boolean inside=x%7<5; double rise=.16+.5*smooth(.05,1,column*7.0/width)+.08*hash(column,3);
        if(inside&&1-v<rise){light=.09+.07*(1-v);if((1-v)>rise-1.5/height)light=.38;else if((x+y)%4==0)light+=.05;}
        return light;
    }
    /** Apps: a lit mosaic of tiles. */
    private static double tiles(int x, int y, double u, double v) {
        double r=hash(x/6,y/6+17);
        if(x%6==5||y%6==5)return .02;
        return .05+.16*r*smooth(.1,1,u)*(1-v*.5)+(r>.94?.3:0);
    }
    /** Search: sonar rings around a point. */
    private static double rings(double u, double v, double aspect, int height) {
        double dx=(u-.8)*aspect, dy=v-.42, dist=Math.hypot(dx,dy);
        double light=.03+.12*Math.exp(-dist*3);
        if(fract(dist*9-.1)<1.4/height*9&&dist>.04)light+=.24*Math.exp(-dist*1.2);
        double angle=Math.atan2(dy,dx), sweep=fract((angle+2.4)/(2*Math.PI));
        if(sweep<.12&&dist<.9)light+=.18*(1-sweep/.12)*(1-dist);
        if(dist<.03)light=.66;
        return light;
    }

    /** Pip: a glow behind the composer, three fine rings and a bloom in the top corner. */
    private static double glow(int x, int y, int width, int height) {
        double size=Math.min(width,height);
        double d=Math.hypot((x-width*.72)/size*.6,(y-height*1.08)/size);
        double c=Math.hypot((x-width)/size,(y+height*.02)/size);
        double light=.42*Math.exp(-d*3)+.26*Math.exp(-c*4.5);
        light+=.16*Math.exp(-Math.pow((d-.42)*size/1.6,2));
        light+=.11*Math.exp(-Math.pow((d-.66)*size/1.6,2));
        light+=.07*Math.exp(-Math.pow((d-.92)*size/1.6,2));
        if(hash(x/6+31,y/6)>.9&&x%6==2&&y%6==2)light+=.04+1.2*light;
        return Math.max(0,light-.03);
    }

    static int shade(int x, int y, int width, int height) { return shade(SKY, x, y, width, height); }
    static int shade(String scene, int x, int y, int width, int height) {
        double u=(x+.5)/width, v=(y+.5)/height, aspect=(double)width/height, light;
        switch(scene){
            case STARS: light=stars(x,y,u,v,width,height); break;
            case ROAD: light=road(u,v,aspect,height); break;
            case WAVES: light=waves(u,v,aspect); break;
            case TERRAIN: light=terrain(x,u,v,aspect,height); break;
            case IRON: light=iron(x,y,u,v,aspect,width,height); break;
            case TILES: light=tiles(x,y,u,v); break;
            case RINGS: light=rings(u,v,aspect,height); break;
            case GLOW: light=glow(x,y,width,height); break;
            default: light=sky(u,v,aspect);
        }
        if(!GLOW.equals(scene)){
            light*=1-smooth(.46,.99,v);
            // Quiet left side keeps clock, title and date legible over header artwork.
            light*=.3+.7*smooth(.10,.68,u);
        }
        double value=clamp(light)*10; int base=(int)Math.floor(value);
        return Math.min(7,base+(value-base>(BAYER[(y%4)*4+x%4]+.5)/16?1:0));
    }

    @Override public void draw(Canvas canvas) {
        Rect bounds=getBounds();
        if(bounds.width()<=0||bounds.height()<=0)return;
        int drawHeight=GLOW.equals(scene)?bounds.height():Math.min(height,bounds.height());
        int width=Math.max(1,(bounds.width()+cell-1)/cell), high=Math.max(1,(drawHeight+cell-1)/cell);
        if(image==null||columns!=width||rows!=high){
            columns=width;rows=high;int[] pixels=new int[width*high];
            int red=accent>>16&255, green=accent>>8&255, blue=accent&255;
            for(int y=0;y<high;y++)for(int x=0;x<width;x++){
                int level=shade(scene,x,y,width,high);
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
