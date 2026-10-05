package org.textphone.launcher;

import android.content.Context;
import android.content.Intent;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** App-label metadata is cached off the UI thread; message content never enters this worker. */
final class NoticeLabels {
    private static final Map<String,String> labels=new ConcurrentHashMap<>();
    private static final Set<String> pending=java.util.Collections.newSetFromMap(new ConcurrentHashMap<>());
    private static final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"Pocket app labels");t.setDaemon(true);return t;});
    private static String key(String pkg){return java.util.Locale.getDefault().toLanguageTag()+":"+pkg;}
    static String get(String pkg){return labels.get(key(pkg));}
    static void load(Context context,List<NoticeFeed.Item> notices){Context app=context.getApplicationContext();for(NoticeFeed.Item i:notices){String pkg=i.notice.getPackageName(),key=key(pkg);if(labels.containsKey(key)||labels.size()+pending.size()>=128||!pending.add(key))continue;
            worker.submit(()->{String label=NoticeFeed.fallbackSource(pkg);try{CharSequence name=app.getPackageManager().getApplicationInfo(pkg,0).loadLabel(app.getPackageManager());if(name!=null&&name.length()>0&&!name.toString().equals(pkg))label=name.toString();}catch(android.content.pm.PackageManager.NameNotFoundException|RuntimeException ignored){}
                labels.put(key,label);pending.remove(key);app.sendBroadcast(new Intent(PhoneNotifications.ACTION_UPDATED).setPackage(app.getPackageName()));});}}
    private NoticeLabels(){}
}
