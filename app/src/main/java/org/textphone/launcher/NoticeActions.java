package org.textphone.launcher;

import android.app.Activity;
import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.app.Notification;
import android.app.RemoteInput;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

/** PendingIntent belongs to the notifying app. Pocket acts only after an explicit foreground tap. */
final class NoticeActions {
    static void open(Activity activity,NoticeFeed.Item item) throws PendingIntent.CanceledException {
        PendingIntent action=item.notice.getNotification().contentIntent;if(action==null)throw new IllegalArgumentException("Open the app to read this notice.");send(activity,action,null);
    }
    static void reply(Activity activity,NoticeFeed.Item original,String text) throws PendingIntent.CanceledException {
        android.app.KeyguardManager lock=activity.getSystemService(android.app.KeyguardManager.class);if(lock!=null&&lock.isDeviceLocked())throw new IllegalStateException("Unlock the phone to reply.");
        if(!NotificationAccess.allowed(activity)||!PhoneNotifications.connected())throw new IllegalStateException("Notification access is off. Return to setup.");
        NoticeFeed.Item fresh=NoticeFeed.find(original.notice.getKey());if(fresh==null)throw new IllegalStateException("This notification is no longer active. Open the app to reply.");
        if(!fresh.identity().equals(original.identity()))throw new IllegalStateException("The conversation changed. Open the app to reply.");
        Notification.Action action=fresh.reply();if(action==null)throw new IllegalStateException("This app no longer offers notification replies.");
        RemoteInput input=NoticeFeed.freeform(action);Bundle result=new Bundle();result.putCharSequence(input.getResultKey(),text);
        Intent fill=new Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND);RemoteInput.addResultsToIntent(new RemoteInput[]{input},fill,result);
        if(Build.VERSION.SDK_INT>=28)RemoteInput.setResultsSource(fill,RemoteInput.SOURCE_FREE_FORM_INPUT);send(activity,action.actionIntent,fill);
    }
    private static void send(Activity owner,PendingIntent action,Intent fill) throws PendingIntent.CanceledException {
        Bundle options=null;if(Build.VERSION.SDK_INT>=34){ActivityOptions opt=ActivityOptions.makeBasic();opt.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);options=opt.toBundle();}
        action.send(owner,0,fill,null,null,null,options);
    }
    private NoticeActions(){}
}
