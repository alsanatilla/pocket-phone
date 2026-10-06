package org.textphone.launcher;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import android.widget.LinearLayout;
import android.widget.TextView;

final class NoticeRows {
    interface Feedback{void show(String text);}
    static void add(Activity owner,LinearLayout host,NoticeFeed.Item item,Feedback feedback,Runnable refresh) {
        String tag="notice_"+item.notice.getKey();LinearLayout row=new LinearLayout(owner);row.setOrientation(LinearLayout.VERTICAL);row.setPadding(0,dp(owner,12),0,dp(owner,12));row.setTag(tag);
        String time=android.text.format.DateFormat.getTimeFormat(owner).format(new java.util.Date(item.notice.getPostTime()));
        TextView app=ReadableRows.text(owner,item.source+" · "+time,12,PocketDesign.MUTED);row.addView(app);
        TextView title=ReadableRows.text(owner,item.title,18,PocketDesign.WHITE);title.setPadding(0,dp(owner,8),0,dp(owner,4));row.addView(title);
        TextView body=ReadableRows.text(owner,item.body.isEmpty()?"Open the app to read this notice.":item.body,16,item.body.isEmpty()?PocketDesign.MUTED:PocketDesign.WHITE);body.setMaxLines(8);body.setEllipsize(android.text.TextUtils.TruncateAt.END);row.addView(body);
        LinearLayout controls=new LinearLayout(owner);controls.setPadding(0,dp(owner,4),0,0);
        TextView open=control(owner,controls,"open",()->{try{NoticeActions.open(owner,item);}catch(PendingIntent.CanceledException|IllegalStateException|SecurityException|IllegalArgumentException e){feedback.show(e instanceof PendingIntent.CanceledException?"This notification has expired.":e.getMessage());}});
        open.setEnabled(item.notice.getNotification().contentIntent!=null);open.setTag(tag+"_open");
        if(item.reply()!=null){TextView reply=control(owner,controls,"reply",()->owner.startActivity(new Intent(owner,NotificationReplyActivity.class).putExtra("notice_key",item.notice.getKey())));reply.setTag(tag+"_reply");}
        TextView more=control(owner,controls,"more",()->{String[] choices=item.notice.isClearable()?new String[]{"Make task","Dismiss"}:new String[]{"Make task"};new android.app.AlertDialog.Builder(owner).setTitle(item.title).setItems(choices,(dialog,index)->{if(index==0)owner.startActivity(TaskCaptureActivity.intent(owner,TaskSource.message(item)));else if(PhoneNotifications.dismiss(item.notice.getKey()))refresh.run();else feedback.show("Android is keeping this notification, or it has already gone.");}).setNegativeButton("Close",null).show();});more.setTag(tag+"_more");
        open.setContentDescription("Open "+item.source+", "+item.title);more.setContentDescription("More actions for "+item.title+": make a task"+(item.notice.isClearable()?" or dismiss":""));
        row.addView(controls);host.addView(row,new LinearLayout.LayoutParams(-1,-2));
    }
    private static TextView control(Activity activity,LinearLayout parent,String label,Runnable click){boolean first=parent.getChildCount()==0;TextView t=ReadableRows.text(activity,label,14,PocketDesign.WHITE);PocketDesign.command(t,first);t.setOnClickListener(v->click.run());parent.addView(t,PocketDesign.commandCell(activity,first));return t;}
    private static int dp(Activity a,int v){return PocketDesign.dp(a,v);}
    private NoticeRows(){}
}
