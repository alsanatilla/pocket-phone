package org.textphone.launcher;

import android.content.Context;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewConfiguration;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ScrollView;

/** Pull only at the top; horizontal navigation and text gestures remain with their owner. */
final class PullRefreshLayout extends FrameLayout {
    private final ScrollView content;
    private final RetroLoadingView indicator;
    private final Runnable refresh;
    private float downX,downY,distance;
    private boolean eligible,dragging,refreshing;
    private final int slop,threshold;
    PullRefreshLayout(Context context,ScrollView scroll,Runnable callback){
        super(context);content=scroll;refresh=callback;slop=ViewConfiguration.get(context).getScaledTouchSlop();threshold=PocketDesign.dp(context,96);
        addView(content,new LayoutParams(-1,-1));indicator=new RetroLoadingView(context);
        LayoutParams p=new LayoutParams(PocketDesign.dp(context,96),PocketDesign.dp(context,96),android.view.Gravity.TOP|android.view.Gravity.CENTER_HORIZONTAL);
        indicator.setVisibility(INVISIBLE);addView(indicator,p);
        content.setAccessibilityDelegate(new View.AccessibilityDelegate(){
            @Override public void onInitializeAccessibilityNodeInfo(View v,android.view.accessibility.AccessibilityNodeInfo info){super.onInitializeAccessibilityNodeInfo(v,info);info.addAction(new android.view.accessibility.AccessibilityNodeInfo.AccessibilityAction(0x01000001,"Refresh Pocket"));}
            @Override public boolean performAccessibilityAction(View v,int action,android.os.Bundle args){if(action==0x01000001){start();return true;}return super.performAccessibilityAction(v,action,args);}
        });
    }
    void busy(boolean value){refreshing=value;distance=value?threshold:0;content.setTranslationY(value?threshold:0);indicator.setVisibility(value?VISIBLE:INVISIBLE);indicator.running(value);}
    private boolean editable(View view,float x,float y){
        if(view instanceof EditText)return true;
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=group.getChildCount()-1;i>=0;i--){View child=group.getChildAt(i);float cx=x+group.getScrollX()-child.getLeft(),cy=y+group.getScrollY()-child.getTop();if(child.getVisibility()==VISIBLE&&cx>=0&&cy>=0&&cx<child.getWidth()&&cy<child.getHeight()&&editable(child,cx,cy))return true;}}
        return false;
    }
    @Override public boolean onInterceptTouchEvent(MotionEvent e){
        if(refreshing)return false;
        if(e.getActionMasked()==MotionEvent.ACTION_DOWN){downX=e.getX();downY=e.getY();eligible=!content.canScrollVertically(-1)&&!editable(content,downX,downY);dragging=false;}
        if(e.getActionMasked()==MotionEvent.ACTION_MOVE&&eligible){float dx=e.getX()-downX,dy=e.getY()-downY;if(Math.abs(dx)>slop&&Math.abs(dx)>Math.abs(dy))eligible=false;else if(dy>slop*2&&dy>Math.abs(dx)*1.5f&&!content.canScrollVertically(-1)){dragging=true;getParent().requestDisallowInterceptTouchEvent(true);return true;}}
        return dragging;
    }
    @Override public boolean onTouchEvent(MotionEvent e){
        if(!dragging)return super.onTouchEvent(e);
        if(e.getActionMasked()==MotionEvent.ACTION_MOVE){distance=Math.min(threshold*1.5f,Math.max(0,(e.getY()-downY)*.5f));content.setTranslationY(distance);indicator.setVisibility(distance>0?VISIBLE:INVISIBLE);indicator.pull(distance/threshold);return true;}
        if(e.getActionMasked()==MotionEvent.ACTION_UP||e.getActionMasked()==MotionEvent.ACTION_CANCEL){boolean commit=e.getActionMasked()==MotionEvent.ACTION_UP&&distance>=threshold;dragging=false;getParent().requestDisallowInterceptTouchEvent(false);if(commit)start();else busy(false);return true;}
        return true;
    }
    private void start(){if(refreshing)return;busy(true);refresh.run();}
}
