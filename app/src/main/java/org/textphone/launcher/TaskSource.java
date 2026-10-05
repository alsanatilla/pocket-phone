package org.textphone.launcher;

import org.json.JSONObject;

/** Context explicitly chosen by the user when making a task, not a notification archive. */
final class TaskSource {
    final String kind,name,text,ref,pkg,identity,token;final long note;
    TaskSource(String kind,String name,String text,long note,String ref,String pkg,String identity,String token){
        this.kind=kind;this.name=limit(name,200);this.text=limit(text,8000);this.note=note;this.ref=limit(ref,2048);this.pkg=limit(pkg,200);this.identity=limit(identity,1000);this.token=limit(token,80);
    }
    TaskSource token(String token){return new TaskSource(kind,name,text,note,ref,pkg,identity,token);}
    static TaskSource note(long id,String text){return new TaskSource("note",ReadableRows.excerpt(text)[0],text,id,"","","","");}
    static TaskSource message(NoticeFeed.Item item){return new TaskSource("message",item.source+" · "+item.title,item.body,0,item.notice.getKey(),item.notice.getPackageName(),item.identity(),"");}
    static TaskSource shared(String title,String text){return new TaskSource("shared",title==null||title.trim().isEmpty()?"Shared text":title,text,0,"","","","");}
    String title(){return ReadableRows.excerpt(text)[0].equals("Untitled note")?name:ReadableRows.excerpt(text)[0];}
    String link(){java.util.regex.Matcher m=java.util.regex.Pattern.compile("https?://[^\\s<>]+",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);return m.find()?m.group().replaceFirst("[.,;)]+$",""):"";}
    JSONObject json(){try{return new JSONObject().put("kind",kind).put("name",name).put("text",text).put("note",note).put("ref",ref).put("pkg",pkg).put("identity",identity).put("token",token);}catch(org.json.JSONException e){throw new IllegalStateException("Task source could not be saved.",e);}}
    static TaskSource read(JSONObject v){if(v==null)return null;String kind=v.optString("kind");if(!kind.equals("note")&&!kind.equals("message")&&!kind.equals("shared"))return null;return new TaskSource(kind,v.optString("name"),v.optString("text"),v.optLong("note"),v.optString("ref"),v.optString("pkg"),v.optString("identity"),v.optString("token"));}
    private static String limit(String s,int max){return s==null?"":s.substring(0,Math.min(max,s.length()));}
}
