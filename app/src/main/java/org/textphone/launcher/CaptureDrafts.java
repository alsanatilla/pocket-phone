package org.textphone.launcher;

import android.content.Context;
import org.json.JSONObject;
import java.util.List;
import java.util.ArrayList;

/** Explicit task captures only; independent of an already open note/task editor. */
final class CaptureDrafts {
    static final class Draft {String key,token,title,issue="";TaskSource source;long remind,task,updated;}
    static String key(TaskSource source){try{byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(source.json().toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));StringBuilder value=new StringBuilder();for(byte b:hash)value.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return value.toString();}catch(java.security.NoSuchAlgorithmException error){throw new IllegalStateException(error);}}
    static synchronized Draft read(Context c,String key){if(key==null)return null;String raw=c.getSharedPreferences("pocket_capture_drafts",0).getString(key,null);if(raw==null)return null;try{JSONObject v=new JSONObject(raw);Draft d=new Draft();d.key=key;d.source=TaskSource.read(v.optJSONObject("source"));if(d.source==null)return null;d.token=v.getString("token");d.title=v.optString("title");d.remind=v.optLong("remind");d.task=v.optLong("task");d.issue=v.optString("issue");d.updated=v.getLong("updated");
        return d;}catch(org.json.JSONException bad){return null;}}
    static synchronized void save(Context c,Draft d){Draft accepted=read(c,d.key);if(accepted!=null&&accepted.token.equals(d.token)&&accepted.task>0){d.task=accepted.task;d.issue=accepted.issue;}
        try{JSONObject v=new JSONObject().put("source",d.source.json()).put("token",d.token).put("title",d.title).put("remind",d.remind).put("task",d.task).put("issue",d.issue).put("updated",System.currentTimeMillis());
            List<Draft> all=list(c);boolean existing=false;for(Draft old:all)if(old.key.equals(d.key))existing=true;android.content.SharedPreferences.Editor edit=c.getSharedPreferences("pocket_capture_drafts",0).edit();if(all.size()>=20&&!existing)throw new IllegalStateException("Finish or discard a task draft first (20 unfinished captures).");
            if(!edit.putString(d.key,v.toString()).commit())throw new IllegalStateException("Task draft could not be kept.");
        }catch(org.json.JSONException error){throw new IllegalStateException("Task draft could not be kept.",error);}}
    static synchronized void accepted(Context c,String key,String token,long task,String issue){Draft d=read(c,key);if(d!=null&&d.token.equals(token)){d.task=task;d.issue=issue==null?"":issue;save(c,d);}}
    static synchronized void clear(Context c,String key,String token){Draft d=read(c,key);if(d!=null&&d.token.equals(token))c.getSharedPreferences("pocket_capture_drafts",0).edit().remove(key).commit();}
    static synchronized List<Draft> list(Context c){List<Draft> values=new ArrayList<>();for(String key:c.getSharedPreferences("pocket_capture_drafts",0).getAll().keySet()){Draft d=read(c,key);if(d!=null)values.add(d);}java.util.Collections.sort(values,(a,b)->Long.compare(b.updated,a.updated));return values;}
    private CaptureDrafts(){}
}
