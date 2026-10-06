package org.textphone.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.widget.LinearLayout;
import java.util.List;

/** SMS and installed messaging apps stay available; Android supplies the active message feed. */
public final class ChatsActivity extends PocketActivity {
    private boolean registered;private LinearLayout messages;private String signature="";
    private final BroadcastReceiver changes=new BroadcastReceiver(){public void onReceive(Context c,Intent i){refresh();}};
    @Override protected void onCreate(Bundle b){super.onCreate(b);render();}
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart(){super.onStart();IntentFilter f=new IntentFilter(PhoneNotifications.ACTION_UPDATED);if(Build.VERSION.SDK_INT>=33)registerReceiver(changes,f,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(changes,f);registered=true;}
    @Override protected void onResume(){super.onResume();NotificationAccess.connect(this);refresh();}
    @Override protected void onStop(){if(registered){unregisterReceiver(changes);registered=false;}super.onStop();}
    private void render(){screen("messages");messages=new LinearLayout(this);messages.setOrientation(LinearLayout.VERTICAL);messages.setTag("chat_feed");body.addView(messages,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout commands=softKeys(new String[]{"sms inbox","apps"},-1,()->startActivity(new Intent(this,MessagesActivity.class)),this::messagingApps);commands.setTag("chat_commands");
        commands.getChildAt(0).setTag("chat_sms");commands.getChildAt(1).setTag("chat_apps");
        appSettings(()->startActivity(new Intent(this,NotificationSetupActivity.class)));refresh();}
    private void messagingApps(){String[] names={"WhatsApp","WhatsApp Business","Signal","Telegram"},packages={"com.whatsapp","com.whatsapp.w4b","org.thoughtcrime.securesms","org.telegram.messenger"};java.util.List<String> labels=new java.util.ArrayList<>();java.util.List<Intent> intents=new java.util.ArrayList<>();
        for(int i=0;i<names.length;i++){Intent launch=getPackageManager().getLaunchIntentForPackage(packages[i]);if(launch!=null){labels.add(names[i]);intents.add(launch);}}
        if(labels.isEmpty()){message("No supported messaging app is installed. SMS inbox is available below.");return;}
        new android.app.AlertDialog.Builder(this).setTitle("Messaging apps").setItems(labels.toArray(new String[0]),(dialog,index)->{if(!closed)startActivity(intents.get(index));}).setNegativeButton("Close",null).show();}
    private void refresh(){if(messages==null||closed)return;boolean allowed=NotificationAccess.allowed(this);List<NoticeFeed.Item> feed=allowed&&PhoneNotifications.connected()?NoticeFeed.read(true):java.util.Collections.emptyList();NoticeLabels.load(this,feed);StringBuilder key=new StringBuilder().append(allowed).append(PhoneNotifications.connected());for(NoticeFeed.Item i:feed)key.append('|').append(i.notice.getKey()).append('|').append(i.notice.getPostTime()).append('|').append(i.source).append('|').append(i.title).append('|').append(i.body).append(i.reply()!=null).append(i.notice.isClearable());
        if(key.toString().equals(signature))return;signature=key.toString();messages.removeAllViews();
        if(!NotificationAccess.allowed(this)||!PhoneNotifications.connected()){
            messages.addView(label(NotificationAccess.allowed(this)?"Waiting for Android to connect.":"Notification access is off. Open Settings to show active messages.",16,GRAY));return;}
        if(feed.isEmpty())messages.addView(label("No active messages. Open your messaging app for earlier conversations.",16,GRAY));
        for(NoticeFeed.Item i:feed)NoticeRows.add(this,messages,i,this::message,this::refresh);
    }
}
