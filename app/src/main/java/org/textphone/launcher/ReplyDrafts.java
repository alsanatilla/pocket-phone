package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;

/** Stores only the user's unfinished reply, never received notification text. */
final class ReplyDrafts {
    private static String key(NoticeFeed.Item item){try{byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest((item.notice.getKey()+"\n"+item.identity()).getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder("draft_");for(byte h:hash)b.append(String.format(java.util.Locale.ROOT,"%02x",h&255));return b.toString();}catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    static String read(Context c,NoticeFeed.Item item){SharedPreferences p=c.getSharedPreferences("pocket_reply_drafts",0);String k=key(item);if(System.currentTimeMillis()-p.getLong(k+"_time",0)>7L*86400000){p.edit().remove(k).remove(k+"_time").apply();return "";}return p.getString(k,"");}
    static void save(Context c,NoticeFeed.Item item,String text){SharedPreferences p=c.getSharedPreferences("pocket_reply_drafts",0);String k=key(item);if(text.isEmpty())p.edit().remove(k).remove(k+"_time").apply();else{
            SharedPreferences.Editor edit=p.edit();for(String old:p.getAll().keySet())if(old.endsWith("_time")&&System.currentTimeMillis()-p.getLong(old,0)>7L*86400000){edit.remove(old).remove(old.substring(0,old.length()-5));}
            // Bound the number of unfinished conversations, preserving the current composition.
            if(p.getAll().size()>80){String oldest=null;long time=Long.MAX_VALUE;for(String old:p.getAll().keySet())if(old.endsWith("_time")&&!old.equals(k+"_time")){long t=p.getLong(old,0);if(t<time){time=t;oldest=old;}}if(oldest!=null){edit.remove(oldest).remove(oldest.substring(0,oldest.length()-5));}}
            edit.putString(k,text).putLong(k+"_time",System.currentTimeMillis()).apply();}}
    private ReplyDrafts(){}
}
