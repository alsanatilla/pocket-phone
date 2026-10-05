package org.textphone.launcher;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Reading hierarchy uses separate views, so long titles never dim their second line. */
final class ReadableRows {
    static LinearLayout item(Context context,String title,String detail,int detailColor,String tag,Runnable open) {
        LinearLayout row=new LinearLayout(context);row.setOrientation(LinearLayout.VERTICAL);row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0,dp(context,8),0,dp(context,8));row.setMinimumHeight(dp(context,64));
        TextView name=text(context,title,18,PocketDesign.WHITE);name.setMaxLines(3);name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        name.setTag(tag+"_title");row.addView(name,new LinearLayout.LayoutParams(-1,-2));
        if(detail!=null&&!detail.isEmpty()) {TextView secondary=text(context,detail,14,detailColor);secondary.setTag(tag+"_detail");secondary.setMaxLines(3);secondary.setEllipsize(android.text.TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams meta=new LinearLayout.LayoutParams(-1,-2);meta.topMargin=dp(context,4);row.addView(secondary,meta);}
        row.setTag(tag);row.setContentDescription(title+(detail==null||detail.isEmpty()?"":", "+detail));
        if(open!=null){PocketDesign.list(row);row.setFocusable(true);row.setOnClickListener(v->open.run());
            for(int i=0;i<row.getChildCount();i++)row.getChildAt(i).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);}
        return row;
    }
    static TextView text(Context c,String value,int size,int color){TextView text=new TextView(c);text.setText(value);PocketDesign.text(text,size,color);return text;}
    static String[] excerpt(String markdown) {
        String title="",body="";
        for(String line:markdown.split("\\n")) {
            String clean=line.trim().replaceFirst("^(?:#{1,6} +|[-*+] +(?:\\[[ xX]\\] *)?|> ?|\\d+[.)] +)","")
                    .replace("**","").replace("__","").replace("`","").trim();
            if(clean.isEmpty())continue;if(title.isEmpty())title=clean;else{body=clean;break;}
        }
        return new String[]{title.isEmpty()?"Untitled note":title,body};
    }
    private static int dp(Context c,int v){return PocketDesign.dp(c,v);}
    private ReadableRows(){}
}
