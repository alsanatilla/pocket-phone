package org.textphone.launcher;

import android.content.Context;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** One search vocabulary for local records, cached chats and account results. */
final class PocketSearch {
    static final class Hit {
        final String kind, uid, title, body; final long updated; final boolean deleted;
        Hit(String kind,String uid,String title,String body,long updated,boolean deleted) {
            this.kind=kind;this.uid=uid;this.title=title;this.body=body;this.updated=updated;this.deleted=deleted;
        }
        String key(){return kind+":"+uid;}
        String label(){return "note".equals(kind)?"Note":"task".equals(kind)?"Task":"thought".equals(kind)?"Thought":"chat".equals(kind)?"Pip":"paper".equals(kind)?"Paper":"Appointment";}
    }
    static final class Snapshot {
        final Context context;Snapshot(Context context){this.context=context;}
        final Map<String,Hit> copies=new LinkedHashMap<>();final List<Hit> hits=new ArrayList<>();
        List<Hit> combine(JSONArray remote) {
            Map<String,Hit> matched=new LinkedHashMap<>();for(Hit h:hits)matched.put(h.key(),h);
            List<Hit> merged=new ArrayList<>();
            for(int i=0;i<remote.length();i++){
                JSONObject row=remote.optJSONObject(i);if(row==null)continue;
                Hit hit=new Hit(row.optString("kind"),row.optString("uid"),row.optString("title"),row.optString("snippet").replace("\u0001","").replace("\u0002",""),row.optLong("updated"),false);
                if("chat".equals(hit.kind)&&ClaudeChatRepository.get(context).removed(hit.uid))continue;
                Hit copy=copies.get(hit.key());
                if(copy!=null&&(copy.deleted||copy.updated>=hit.updated)){Hit fresh=matched.remove(hit.key());if(fresh!=null)merged.add(fresh);continue;}
                merged.add(hit);matched.remove(hit.key());
            }
            List<Hit> result=new ArrayList<>(matched.values());result.addAll(merged);return result;
        }
    }
    static String[] words(String query) {
        String trimmed=fold(query).replaceAll("[^\\p{L}\\p{N}]+"," ").trim();
        if(trimmed.isEmpty())return new String[0];String[] all=trimmed.split("\\s+");return java.util.Arrays.copyOf(all,Math.min(8,all.length));
    }
    static String fold(String text){return Normalizer.normalize(text.toLowerCase(Locale.ROOT),Normalizer.Form.NFD).replaceAll("\\p{M}+","");}
    static boolean matches(String text,String[] words){String value=fold(text);for(String word:words)if(!value.contains(word))return false;return words.length>0;}
    private static void add(Snapshot result,Hit hit,String[] words){result.copies.put(hit.key(),hit);if(!hit.deleted&&matches(hit.title+"\n"+hit.body,words))result.hits.add(hit);}
    static Snapshot local(Context c,String query) throws JSONException {
        Snapshot result=new Snapshot(c);String[] words=words(query);if(words.length==0)return result;
        JSONArray notes=NoteSync.merge(c,null).getJSONArray("notes");
        for(int i=0;i<notes.length();i++){JSONObject n=notes.getJSONObject(i);String text=n.optString("text");add(result,new Hit("note",n.optString("uid"),ReadableRows.excerpt(text)[0],text,n.optLong("updated"),n.optBoolean("deleted")),words);}
        JSONArray tasks=TaskSync.merge(c,null).getJSONArray("tasks");
        for(int i=0;i<tasks.length();i++){JSONObject t=tasks.getJSONObject(i);StringBuilder body=new StringBuilder();JSONArray steps=t.optJSONArray("steps");if(steps!=null)for(int j=0;j<steps.length();j++){JSONObject s=steps.optJSONObject(j);if(s!=null)body.append(s.optString("text")).append('\n');}
            JSONObject source=t.optJSONObject("source");if(source!=null)body.append(source.optString("text"));
            add(result,new Hit("task",t.optString("uid"),t.optString("text"),body.toString(),t.optLong("updated"),t.optBoolean("deleted")),words);}
        JSONArray thoughts=ParkingStore.merge(c,null).getJSONArray("items");
        for(int i=0;i<thoughts.length();i++){JSONObject t=thoughts.getJSONObject(i);add(result,new Hit("thought",String.valueOf(t.optLong("id")),t.optString("text"),"",t.optLong("updated"),!"parked".equals(t.optString("state"))),words);}
        for(JSONObject page:JournalStore.pages(c)){StringBuilder text=new StringBuilder();JSONArray lines=page.optJSONArray("lines");if(lines!=null)for(int i=0;i<lines.length();i++){JSONObject line=lines.optJSONObject(i);if(line!=null)text.append(line.optString("text")).append('\n');}
            add(result,new Hit("paper",page.optString("uid"),page.optString("title","Paper page"),text.toString(),page.optLong("updated"),page.optBoolean("deleted")),words);}
        for(AgendaStore.Event event:AgendaStore.list(c))add(result,new Hit("appointment",String.valueOf(event.id),event.title,"",event.when,false),words);
        for(ChatStore.Summary chat:ClaudeChatRepository.get(c).chats())result.copies.put("chat:"+chat.id,new Hit("chat",chat.id,chat.title,"",chat.updated,false));
        for(ChatStore.Summary chat:ClaudeChatRepository.get(c).search(words))result.hits.add(new Hit("chat",chat.id,chat.title,"",chat.updated,false));
        result.hits.sort((a,b)->{int scoreA=0,scoreB=0;for(String word:words){if(fold(a.title).contains(word))scoreA+=5;if(fold(b.title).contains(word))scoreB+=5;}return scoreA==scoreB?Long.compare(b.updated,a.updated):Integer.compare(scoreB,scoreA);});
        if(result.hits.size()>40)result.hits.subList(40,result.hits.size()).clear();return result;
    }
    static boolean available(Context c,String kind,String uid){
        PlannerStore planner=new PlannerStore(c.getSharedPreferences("pocket_planner",0));
        if("note".equals(kind))return NoteSync.byUid(planner,uid)!=null;if("task".equals(kind))return TaskSync.byUid(planner,uid)!=null;
        if("paper".equals(kind)){JSONObject p=JournalStore.find(c,uid);return p!=null&&!p.optBoolean("deleted");}
        if("chat".equals(kind))return ClaudeChatRepository.get(c).chats().stream().anyMatch(chat->chat.id.equals(uid));
        if("thought".equals(kind))return ParkingStore.open(c).stream().anyMatch(t->String.valueOf(t.id).equals(uid));return "appointment".equals(kind);
    }
    static void download(Context c,String kind) throws java.io.IOException,JSONException {
        if("chat".equals(kind)){ClaudeChatRepository.get(c).syncCloud();return;}
        JSONObject response=PocketCloud.api(c,"GET","/api/sync",null);
        if(!PocketCloud.accountId(c).equals(response.optString("accountId")))throw new java.io.IOException("Pocket account changed.");
        JSONObject docs=response.getJSONObject("documents"),entry;
        if((entry=docs.optJSONObject("notes.json"))!=null)NoteSync.merge(c,entry.getJSONObject("value"));
        if((entry=docs.optJSONObject("tasks.json"))!=null)TaskSync.merge(c,entry.getJSONObject("value"));
        if((entry=docs.optJSONObject("parking.json"))!=null)ParkingStore.merge(c,entry.getJSONObject("value"));
        if((entry=docs.optJSONObject("journal.json"))!=null)JournalStore.merge(c,entry.getJSONObject("value"));
        CloudSync.changed(c);
    }
    private PocketSearch(){}
}
