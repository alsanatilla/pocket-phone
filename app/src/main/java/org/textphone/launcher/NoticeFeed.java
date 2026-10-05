package org.textphone.launcher;

import android.app.Notification;
import android.app.RemoteInput;
import android.os.Build;
import android.os.Parcelable;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;

/** Active Android notifications only; no saved message history or proprietary inbox access. */
final class NoticeFeed {
    static final class Item {
        final StatusBarNotification notice;
        final String source,title,body;
        Item(StatusBarNotification notice){this.notice=notice;source=source(notice.getPackageName());Notification n=notice.getNotification();
            CharSequence conversation=Build.VERSION.SDK_INT>=24?n.extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE):null;
            CharSequence heading=n.extras.getCharSequence(Notification.EXTRA_TITLE);title=conversation!=null?conversation.toString():heading!=null?heading.toString():source;body=body(n);}
        Notification.Action reply(){Notification.Action[] actions=notice.getNotification().actions;if(actions!=null)for(Notification.Action action:actions)if(action!=null&&action.actionIntent!=null&&freeform(action)!=null)return action;return null;}
        String identity(){String shortcut=Build.VERSION.SDK_INT>=26?notice.getNotification().getShortcutId():null;return notice.getPackageName()+"\n"+(shortcut==null?"":shortcut)+"\n"+title;}
    }
    static List<Item> read(boolean messagesOnly) {
        StatusBarNotification[] active=PhoneNotifications.active();HashSet<String> childGroups=new HashSet<>();
        for(StatusBarNotification notice:active)if((notice.getNotification().flags&Notification.FLAG_GROUP_SUMMARY)==0)childGroups.add(notice.getPackageName()+"\n"+notice.getGroupKey());
        List<Item> items=new ArrayList<>();for(StatusBarNotification notice:active){Notification n=notice.getNotification();
            if(messagesOnly&&!message(notice))continue;
            if((n.flags&Notification.FLAG_GROUP_SUMMARY)!=0&&childGroups.contains(notice.getPackageName()+"\n"+notice.getGroupKey()))continue;
            Item item=item(notice);if(item!=null)items.add(item);}
        Collections.sort(items,(a,b)->Long.compare(b.notice.getPostTime(),a.notice.getPostTime()));return items;
    }
    static boolean message(StatusBarNotification notice){String p=notice.getPackageName();return Notification.CATEGORY_MESSAGE.equals(notice.getNotification().category)||"com.whatsapp".equals(p)||"com.whatsapp.w4b".equals(p)||"org.thoughtcrime.securesms".equals(p)||"org.telegram.messenger".equals(p);}
    static Item find(String key){for(StatusBarNotification n:PhoneNotifications.active())if(n.getKey().equals(key))return item(n);return null;}
    // Notification extras belong to other apps; one unreadable notice must not break the feed.
    private static Item item(StatusBarNotification notice){try{return new Item(notice);}catch(RuntimeException malformed){return null;}}
    static RemoteInput freeform(Notification.Action action){RemoteInput[] inputs=action.getRemoteInputs();if(inputs!=null)for(RemoteInput r:inputs)if(r.getAllowFreeFormInput())return r;return null;}
    static String source(String pkg){String label=NoticeLabels.get(pkg);return label==null?fallbackSource(pkg):label;}
    static String fallbackSource(String pkg){switch(pkg){case "com.whatsapp":return "WhatsApp";case "com.whatsapp.w4b":return "WhatsApp Business";case "org.thoughtcrime.securesms":return "Signal";case "org.telegram.messenger":return "Telegram";case "com.google.android.apps.messaging":return "Google Messages";case "org.textphone.launcher":return "Pocket";default:return pkg.substring(pkg.lastIndexOf('.')+1);}}
    private static String body(Notification n){
        if(Build.VERSION.SDK_INT>=24){Parcelable[] bundles=n.extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            if(bundles!=null){StringBuilder text=new StringBuilder();
                if(Build.VERSION.SDK_INT>=30){List<Notification.MessagingStyle.Message> messages=Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles);
                    for(int i=Math.max(0,messages.size()-3);i<messages.size();i++){Notification.MessagingStyle.Message m=messages.get(i);appendMessage(text,m.getSender(),m.getText());}}
                else { // The public message-array parser was added in API 30; earlier Android uses these native bundle fields.
                    for(int i=Math.max(0,bundles.length-3);i<bundles.length;i++)if(bundles[i] instanceof android.os.Bundle){android.os.Bundle message=(android.os.Bundle)bundles[i];appendMessage(text,message.getCharSequence("sender"),message.getCharSequence("text"));}}
                if(text.length()>0)return text.toString();}}
        CharSequence big=n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT);if(big!=null&&big.length()>0)return big.toString();
        CharSequence[] lines=n.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);if(lines!=null&&lines.length>0){StringBuilder b=new StringBuilder();for(int i=Math.max(0,lines.length-3);i<lines.length;i++){if(lines[i]==null)continue;if(b.length()>0)b.append('\n');b.append(lines[i]);}if(b.length()>0)return b.toString();}
        CharSequence text=n.extras.getCharSequence(Notification.EXTRA_TEXT);return text==null?"":text.toString();
    }
    private static void appendMessage(StringBuilder text,CharSequence sender,CharSequence content){if(content==null||content.length()==0)return;if(text.length()>0)text.append('\n');if(sender!=null&&sender.length()>0)text.append(sender).append(": ");text.append(content);}
    private NoticeFeed(){}
}
