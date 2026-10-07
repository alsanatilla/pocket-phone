package org.textphone.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Portable editor drafts and an explicit preference allow-list. Credentials and alarm handles stay local. */
final class WorkspaceExtras {
    private static final Object LOCK = new Object();
    private static final String DRAFTS="drafts.json", PREFS="preferences.json";
    private static final String[] PREFERENCE_IDS={"appearance","dice","pip-defaults","today-tiles","camera","calculator","home-tiles","daily-brief"};
    private static final List<SharedPreferences> WATCHED = new ArrayList<>();
    private static Context app;
    private static int applying;
    private static final Handler UI = new Handler(Looper.getMainLooper());
    private static final Runnable RECONCILE = () -> { Context c=app;if(c!=null)try{document(c,DRAFTS);document(c,PREFS);}catch(RuntimeException ignored){} };
    private static final SharedPreferences.OnSharedPreferenceChangeListener LISTENER=(p,key)->{
        if(key==null||!watched(key))return;UI.removeCallbacks(RECONCILE);UI.postDelayed(RECONCILE,150);
    };
    static void start(Context c) { synchronized(LOCK) {
        if(app!=null)return;app=c.getApplicationContext();
        for(String name:new String[]{"pocket_planner","pocket_capture_drafts","pocket_agenda","text_phone","pocket_dice","pocket_chat_provider","pocket_camera","CalculatorActivity"}){
            SharedPreferences p=app.getSharedPreferences(name,0);p.registerOnSharedPreferenceChangeListener(LISTENER);WATCHED.add(p);
        }
    } }
    private static boolean watched(String key){return key.startsWith("draft_")||key.equals("appointment_draft")||key.matches("[a-f0-9]{64}")||key.equals("accent")||key.equals("large_text")||key.equals("reduce_motion")||key.equals("mode")||key.equals("count")||key.equals("shake")||key.equals("last_face")||key.equals("last_detail")||key.equals("history")||key.equals("provider")||key.equals("model")||key.equals("base_url")||key.equals("max_tokens")||key.equals("prompt_caching")||key.equals("web_search")||key.equals("profile")||key.equals("aspect")||key.equals("quality")||key.equals("size_long")||key.equals("flash")||key.equals("ev")||key.equals("expression")||key.equals("calculated")||key.equals("last_calculation")||homeKey(key);}
    private static boolean homeKey(String key){return key.startsWith("shortcut_")||key.startsWith("tile_pocket_")||key.startsWith("tile_group_");}
    private static SharedPreferences store(Context c){return c.getSharedPreferences("pocket_workspace_extras",0);}
    private static JSONObject read(Context c,String name){try{JSONObject value=new JSONObject(store(c).getString(name,"{\"v\":1,\"items\":[]}"));if(value.optJSONArray("items")!=null)return value;}catch(JSONException ignored){}try{return new JSONObject().put("v",1).put("items",new JSONArray());}catch(JSONException impossible){throw new IllegalStateException(impossible);}}
    static long revision(Context c,String name){synchronized(LOCK){return store(c).getLong(name+"_revision",0);}}
    static JSONObject document(Context c,String name){start(c);synchronized(LOCK){checkName(name);if(applying==0)reconcile(c,name);return read(c,name);}}
    static JSONObject merge(Context c,String name,JSONObject remote,long cloudRevision)throws JSONException {start(c);synchronized(LOCK){
        checkName(name);reconcile(c,name);JSONObject local=read(c,name);Map<String,JSONObject> values=index(local.optJSONArray("items"));
        JSONArray incoming=remote==null?null:remote.optJSONArray("items");if(incoming!=null)for(int i=0;i<incoming.length();i++){
            JSONObject item=valid(name,incoming.optJSONObject(i));if(item==null)continue;JSONObject old=values.get(item.optString("uid"));
            if(old==null||item.optLong("updated")>old.optLong("updated")||item.optLong("updated")==old.optLong("updated")&&(item.optBoolean("deleted")&&!old.optBoolean("deleted")||item.optBoolean("deleted")==old.optBoolean("deleted")&&canonical(item).compareTo(canonical(old))>0))values.put(item.getString("uid"),item);
        }
        JSONObject merged=wrap(values);persist(c,name,merged,false);store(c).edit().putLong(name+"_cloud_revision",cloudRevision).apply();
        applying++;try{if(DRAFTS.equals(name))applyDrafts(c,merged);else applyPreferences(c,merged);}finally{applying--;}
        return merged;
    }}
    static Object preference(Context c,String uid){synchronized(LOCK){JSONObject item=index(read(c,PREFS).optJSONArray("items")).get(uid);return item==null||item.optBoolean("deleted")?null:item.opt("value");}}
    static void preference(Context c,String uid,Object value){start(c);synchronized(LOCK){if(!knownPreference(uid))throw new IllegalArgumentException("Unknown preference.");if(uid.equals("daily-brief")&&!validBrief(value))throw new IllegalArgumentException("Check the brief setting.");put(c,PREFS,uid,"","",value,false);}}
    private static boolean validBrief(Object value){return value instanceof JSONObject&&((JSONObject)value).length()==1&&((JSONObject)value).opt("enabled") instanceof Boolean;}
    static void draft(Context c,String kind,String target,Object value){start(c);synchronized(LOCK){put(c,DRAFTS,kind+":"+(target.isEmpty()?"new":target),kind,target,value,false);}}
    private static void checkName(String name){if(!DRAFTS.equals(name)&&!PREFS.equals(name))throw new IllegalArgumentException("Unknown workspace collection.");}
    private static boolean knownPreference(String id){for(String known:PREFERENCE_IDS)if(known.equals(id))return true;return false;}
    private static Map<String,JSONObject> index(JSONArray items){Map<String,JSONObject> out=new LinkedHashMap<>();if(items!=null)for(int i=0;i<items.length();i++){JSONObject item=items.optJSONObject(i);if(item!=null)out.put(item.optString("uid"),item);}return out;}
    private static JSONObject wrap(Map<String,JSONObject> values)throws JSONException {JSONArray items=new JSONArray();for(JSONObject item:values.values())items.put(item);return new JSONObject().put("v",1).put("items",items);}
    private static void persist(Context c,String name,JSONObject value,boolean local){SharedPreferences p=store(c);if(canonical(read(c,name)).equals(canonical(value)))return;
        SharedPreferences.Editor edit=p.edit().putString(name,value.toString());if(local)edit.putLong(name+"_revision",p.getLong(name+"_revision",0)+1);
        if(!edit.commit())throw new IllegalStateException("Could not keep the workspace settings.");if(local)CloudSync.changed(c);
    }
    private static void put(Context c,String name,String uid,String kind,String target,Object value,boolean deleted){try{
        Map<String,JSONObject> all=index(read(c,name).optJSONArray("items"));JSONObject old=all.get(uid),item=new JSONObject().put("uid",uid).put("value",deleted?JSONObject.NULL:safe(value,0)).put("deleted",deleted);
        if(!kind.isEmpty())item.put("kind",kind).put("target_uid",target);
        if(old!=null&&canonical(old.opt("value")).equals(canonical(item.opt("value")))&&old.optBoolean("deleted")==deleted&&old.optString("kind").equals(kind)&&old.optString("target_uid").equals(target))return;
        item.put("updated",Math.max(System.currentTimeMillis(),old==null?0:old.optLong("updated")+1));all.put(uid,item);persist(c,name,wrap(all),true);
    }catch(JSONException error){throw new IllegalStateException("Could not keep this draft.",error);}}
    private static JSONObject valid(String name,JSONObject source)throws JSONException {if(source==null)return null;String uid=source.optString("uid");long updated=source.optLong("updated");
        if(!uid.matches("[A-Za-z0-9_:.-]{1,200}")||updated<0||updated>System.currentTimeMillis()+600000)return null;
        if(PREFS.equals(name)&&!knownPreference(uid))return null;
        if(PREFS.equals(name)&&uid.equals("daily-brief")&&source.has("deleted")&&!(source.opt("deleted") instanceof Boolean))return null;
        if(PREFS.equals(name)&&uid.equals("daily-brief")&&!source.optBoolean("deleted")&&!validBrief(source.opt("value")))return null;
        String kind=source.optString("kind");if(DRAFTS.equals(name)&&!kind.matches("note|task|thought|capture|appointment"))return null;
        JSONObject item=new JSONObject().put("uid",uid).put("updated",updated).put("deleted",source.optBoolean("deleted")).put("value",source.optBoolean("deleted")?JSONObject.NULL:safe(source.opt("value"),0));
        if(DRAFTS.equals(name))item.put("kind",kind).put("target_uid",clip(source.optString("target_uid"),100));return item;
    }
    private static Object safe(Object value,int depth)throws JSONException {if(depth>10)return JSONObject.NULL;if(value==null||value==JSONObject.NULL)return JSONObject.NULL;if(value instanceof String)return clip((String)value,16000);if(value instanceof Number||value instanceof Boolean)return value;
        if(value instanceof JSONArray){JSONArray out=new JSONArray(),a=(JSONArray)value;for(int i=0;i<Math.min(300,a.length());i++)out.put(safe(a.opt(i),depth+1));return out;}
        if(value instanceof JSONObject){JSONObject out=new JSONObject(),o=(JSONObject)value;java.util.Iterator<String> keys=o.keys();int n=0;while(keys.hasNext()&&n++<100){String key=keys.next();if(key.matches("(?i)(key|api[_-]?key|key_value|key_endpoint|key_last4|password|credential|token|access[_-]?token|refresh[_-]?token|authorization|permission|permissions|alarm|boot)")||key.equals("__proto__")||key.equals("constructor")||key.equals("prototype"))continue;out.put(key,safe(o.opt(key),depth+1));}return out;}return JSONObject.NULL;
    }
    private static String clip(String s,int max){return s==null?"":s.substring(0,Math.min(max,s.length()));}
    private static String canonical(Object value){if(value instanceof JSONObject){JSONObject o=(JSONObject)value;List<String> keys=new ArrayList<>();java.util.Iterator<String> it=o.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);StringBuilder text=new StringBuilder("{");for(String key:keys)text.append(JSONObject.quote(key)).append(':').append(canonical(o.opt(key))).append(',');return text.append('}').toString();}if(value instanceof JSONArray){JSONArray a=(JSONArray)value;StringBuilder text=new StringBuilder("[");for(int i=0;i<a.length();i++)text.append(canonical(a.opt(i))).append(',');return text.append(']').toString();}return value==null||value==JSONObject.NULL?"null":value instanceof String?JSONObject.quote((String)value):String.valueOf(value);}
    private static void reconcile(Context c,String name){try{if(DRAFTS.equals(name))reconcileDrafts(c);else reconcilePreferences(c);}catch(JSONException error){throw new IllegalStateException("Could not read workspace preferences.",error);}}
    private static Set<String> managed(Context c){Set<String> out=new HashSet<>();try{JSONArray a=new JSONArray(store(c).getString("managed_drafts","[]"));for(int i=0;i<a.length();i++)out.add(a.optString(i));}catch(JSONException ignored){}return out;}
    private static void managed(Context c,Set<String> values){JSONArray a=new JSONArray();for(String value:values)a.put(value);store(c).edit().putString("managed_drafts",a.toString()).apply();}
    private static void reconcileDrafts(Context c)throws JSONException {SharedPreferences p=c.getSharedPreferences("pocket_planner",0);PlannerStore planner=new PlannerStore(p);Set<String> live=new HashSet<>(),managed=managed(c);
        for(String key:p.getAll().keySet()){java.util.regex.Matcher m=java.util.regex.Pattern.compile("draft_(note|task|thought)_(\\d+)").matcher(key);if(!m.matches())continue;String kind=m.group(1);long id=Long.parseLong(m.group(2));String target="";
            if(id>0){PlannerStore.Entry e=planner.find(id);if(e!=null&&kind.equals(e.kind))target="note".equals(kind)?NoteSync.uid(planner,id):TaskSync.uid(planner,id);else target=p.getString(kind+"_uid_"+id,"");if(target.isEmpty())continue;}
            JSONObject value=new JSONObject().put("text",p.getString(key,""));if(kind.equals("task")){PlannerStore.TaskDraft meta=planner.taskDraft(id,planner.find(id));value.put("due",meta.due).put("important",meta.important).put("steps",steps(meta.steps));}
            String uid=kind+":"+(target.isEmpty()?"new":target);put(c,DRAFTS,uid,kind,target,value,false);live.add(uid);managed.add(uid);
        }
        for(CaptureDrafts.Draft d:CaptureDrafts.list(c)){String uid="capture:"+d.key;JSONObject source=new JSONObject().put("kind",d.source.kind).put("name",d.source.name).put("text",d.source.text).put("token",d.source.token);
            // A capture token is an idempotency marker, not a provider/session credential.
            if(d.source.note>0){PlannerStore.Entry note=planner.find(d.source.note);if(note!=null&&note.kind.equals("note"))source.put("note_uid",NoteSync.uid(planner,note.id));}
            JSONObject value=new JSONObject().put("key",d.key).put("captureToken",d.token).put("title",d.title).put("source",source).put("remindAt",d.remind).put("issue",d.issue);
            if(d.task>0){PlannerStore.Entry task=planner.find(d.task);if(task!=null&&task.kind.equals("task"))value.put("task_uid",TaskSync.uid(planner,task.id));}
            put(c,DRAFTS,uid,"capture","",value,false);live.add(uid);managed.add(uid);
        }
        AgendaDraft.Value appointment=AgendaDraft.read(c);if(appointment!=null){AgendaStore.Event event=appointment.event,existing=event.id==0?null:AgendaStore.find(c,event.id);String target=existing==null?event.uid:existing.uid;
            if(event.id==0||!target.isEmpty()){String uid="appointment:"+(target.isEmpty()?"new":target);JSONObject value=new JSONObject().put("title",event.title).put("when",event.when).put("minutes",event.minutes).put("remindAt",appointment.remind?Math.max(1,event.when):0);if(event.task>0){PlannerStore.Entry task=planner.find(event.task);if(task!=null)value.put("task_uid",TaskSync.uid(planner,task.id));}put(c,DRAFTS,uid,"appointment",target,value,false);live.add(uid);managed.add(uid);}
        }
        Map<String,JSONObject> all=index(read(c,DRAFTS).optJSONArray("items"));for(String uid:managed)if(!live.contains(uid)){JSONObject old=all.get(uid);if(old!=null&&!old.optBoolean("deleted"))put(c,DRAFTS,uid,old.optString("kind"),old.optString("target_uid"),null,true);}managed(c,managed);
    }
    private static JSONArray steps(String text)throws JSONException {JSONArray out=new JSONArray();for(String line:text.split("\\n")){line=line.trim();if(line.isEmpty())continue;boolean done=line.startsWith("[x]")||line.startsWith("[X]");line=line.replaceFirst("^\\[[ xX]\\]\\s*","");out.put(new JSONObject().put("text",clip(line,160)).put("done",done));if(out.length()>=32)break;}return out;}
    private static String stepsText(JSONArray steps){StringBuilder text=new StringBuilder();if(steps!=null)for(int i=0;i<Math.min(32,steps.length());i++){JSONObject step=steps.optJSONObject(i);if(step!=null){if(text.length()>0)text.append('\n');text.append(step.optBoolean("done")?"[x] ":"[ ] ").append(clip(step.optString("text"),160));}}return text.toString();}
    private static void applyDrafts(Context c,JSONObject doc)throws JSONException {PlannerStore planner=new PlannerStore(c.getSharedPreferences("pocket_planner",0));Set<String> managed=managed(c);JSONObject newestAppointment=null;
        for(JSONObject item:index(doc.optJSONArray("items")).values()){String kind=item.optString("kind"),target=item.optString("target_uid");JSONObject value=item.optJSONObject("value");boolean deleted=item.optBoolean("deleted");
            if(kind.equals("appointment")){if(newestAppointment==null||item.optLong("updated")>newestAppointment.optLong("updated"))newestAppointment=item;continue;}
            if(kind.equals("note")||kind.equals("task")||kind.equals("thought")){PlannerStore.Entry entry=target.isEmpty()?null:kind.equals("note")?NoteSync.byUid(planner,target):TaskSync.byUid(planner,target);if(!target.isEmpty()&&entry==null)continue;long id=entry==null?0:entry.id;if(deleted)planner.clearDraft(kind,id);else if(value!=null){if(kind.equals("task"))planner.draft(id,clip(value.optString("text"),500),value.optString("due"),value.optBoolean("important"),stepsText(value.optJSONArray("steps")));else planner.draft(kind,id,clip(value.optString("text"),8000));}managed.add(item.getString("uid"));
            }else if(kind.equals("capture")){String key=item.optString("uid").replaceFirst("^capture:","");if(!key.matches("[a-f0-9]{64}"))continue;
                if(deleted)c.getSharedPreferences("pocket_capture_drafts",0).edit().remove(key).commit();else if(value!=null){JSONObject source=value.optJSONObject("source");if(source==null)continue;String sourceKind=source.optString("kind");if(!sourceKind.matches("note|message|shared"))continue;PlannerStore.Entry note=NoteSync.byUid(planner,source.optString("note_uid")),task=TaskSync.byUid(planner,value.optString("task_uid"));CaptureDrafts.Draft d=new CaptureDrafts.Draft();d.key=key;d.token=value.optString("captureToken");if(d.token.isEmpty())d.token=java.util.UUID.randomUUID().toString();d.title=clip(value.optString("title"),500);d.source=new TaskSource(sourceKind,source.optString("name"),source.optString("text"),note==null?0:note.id,"","","",d.token);d.remind=value.optLong("remindAt");d.task=task==null?0:task.id;d.issue=value.optString("issue");CaptureDrafts.save(c,d);}managed.add(item.getString("uid"));
            }
        }
        if(newestAppointment!=null){JSONObject item=newestAppointment,value=item.optJSONObject("value");String target=item.optString("target_uid");AgendaStore.Event event=null;if(target.isEmpty())event=new AgendaStore.Event();else for(AgendaStore.Event e:AgendaStore.list(c))if(target.equals(e.uid)){event=e.copy();break;}
            if(item.optBoolean("deleted")){AgendaDraft.Value old=AgendaDraft.read(c);if(old!=null&&(target.isEmpty()&&old.event.id==0||!target.isEmpty()&&old.event.uid.equals(target)))AgendaDraft.clear(c,old.event.id);}
            else if(value!=null&&event!=null){event.uid=target;event.title=clip(value.optString("title"),500);event.when=value.optLong("when");event.minutes=Math.max(1,Math.min(1440,value.optInt("minutes",60)));PlannerStore.Entry task=TaskSync.byUid(planner,value.optString("task_uid"));event.task=task==null?0:task.id;event.alarm=0;AgendaDraft.save(c,event,value.optLong("remindAt")>0);managed.removeIf(uid->uid.startsWith("appointment:"));managed.add(item.getString("uid"));}
        }managed(c,managed);
    }
    private static void reconcilePreferences(Context c)throws JSONException {
        SharedPreferences p=c.getSharedPreferences("text_phone",0);if(p.contains("accent")||p.contains("large_text")||p.contains("reduce_motion"))putPref(c,"appearance",new JSONObject().put("accent",p.getInt("accent",0)).put("largeText",p.getBoolean("large_text",false)).put("reduceMotion",p.getBoolean("reduce_motion",false)));
        p=c.getSharedPreferences("pocket_dice",0);if(p.contains("mode")||p.contains("count")||p.contains("shake")||p.contains("last_face")||p.contains("history"))putPref(c,"dice",new JSONObject().put("mode",p.getString("mode","dice")).put("count",p.getInt("count",2)).put("shake",p.getBoolean("shake",true)).put("lastFace",p.getString("last_face","")).put("lastDetail",p.getString("last_detail","")).put("history",array(p.getString("history","[]"))));
        p=c.getSharedPreferences("pocket_chat_provider",0);if(p.contains("provider")||p.contains("model")){ChatProvider.Config v=ChatProvider.get(c);putPref(c,"pip-defaults",new JSONObject().put("provider",v.provider).put("model",v.model).put("baseUrl",v.baseUrl).put("maxTokens",v.maxTokens).put("promptCaching",v.promptCaching).put("webSearch",v.webSearch));}
        p=c.getSharedPreferences("pocket_camera",0);if(p.contains("profile")||p.contains("aspect")||p.contains("size_long")||p.contains("flash")||p.contains("ev"))putPref(c,"camera",new JSONObject().put("profile",p.getString("profile",CameraProfile.values()[0].name())).put("aspect",p.getString("aspect","FOUR_THREE")).put("quality",p.getString("quality","FINE")).put("sizeLong",p.getInt("size_long",0)).put("flash",p.getString("flash","AUTO")).put("ev",p.getInt("ev",0)));
        p=c.getSharedPreferences("CalculatorActivity",0);if(p.contains("expression")||p.contains("history"))putPref(c,"calculator",new JSONObject().put("expression",p.getString("expression","")).put("calculated",p.getBoolean("calculated",false)).put("lastCalculation",p.getString("last_calculation","")).put("history",array(p.getString("history","[]"))));
        p=c.getSharedPreferences("text_phone",0);JSONObject home=new JSONObject();for(Map.Entry<String,?> entry:p.getAll().entrySet())if(homeKey(entry.getKey())&&entry.getValue() instanceof String)home.put(entry.getKey(),entry.getValue());if(home.length()>0||preference(c,"home-tiles")!=null)putPref(c,"home-tiles",home);
    }
    private static JSONArray array(String text){try{return new JSONArray(text);}catch(JSONException bad){return new JSONArray();}}
    private static void putPref(Context c,String uid,JSONObject value)throws JSONException {Object previous=preference(c,uid);if(previous instanceof JSONObject){JSONObject joined=new JSONObject(previous.toString());java.util.Iterator<String> keys=value.keys();while(keys.hasNext()){String key=keys.next();joined.put(key,value.get(key));}value=joined;}put(c,PREFS,uid,"","",value,false);}
    private static void applyPreferences(Context c,JSONObject doc)throws JSONException {for(JSONObject item:index(doc.optJSONArray("items")).values()){String uid=item.optString("uid");JSONObject value=item.optJSONObject("value");if(item.optBoolean("deleted")){resetPreference(c,uid);continue;}if(value==null)continue;
        if(uid.equals("appearance"))c.getSharedPreferences("text_phone",0).edit().putInt("accent",Math.max(0,Math.min(3,value.optInt("accent")))).putBoolean("large_text",value.optBoolean("largeText")).putBoolean("reduce_motion",value.optBoolean("reduceMotion")).commit();
        else if(uid.equals("dice")){String mode=value.optString("mode","dice");if(!mode.matches("dice|d20|coin|pick"))mode="dice";c.getSharedPreferences("pocket_dice",0).edit().putString("mode",mode).putInt("count",Math.max(1,Math.min(5,value.optInt("count",2)))).putBoolean("shake",value.optBoolean("shake",true)).putString("last_face",value.optString("lastFace")).putString("last_detail",value.optString("lastDetail")).putString("history",value.optJSONArray("history")==null?"[]":value.getJSONArray("history").toString()).commit();}
        else if(uid.equals("pip-defaults")){try{ChatProvider.Config config=new ChatProvider.Config(value.optString("provider"),value.optString("model"),value.optString("baseUrl"),value.optInt("maxTokens",2048),value.optBoolean("promptCaching",true),value.optBoolean("webSearch"));config.validate();ChatProvider.Config old=ChatProvider.get(c);SharedPreferences p=c.getSharedPreferences("pocket_chat_provider",0);SharedPreferences.Editor edit=p.edit().putString("provider",config.provider).putString("model",config.model).putString("base_url",config.baseUrl).putInt("max_tokens",config.maxTokens).putBoolean("prompt_caching",config.promptCaching).putBoolean("web_search",config.webSearch);if(!config.baseUrl.equals(p.getString("key_endpoint",""))){edit.remove("key_value").remove("key_endpoint").remove("key_last4");}edit.commit();if(!old.identity.equals(config.identity))PocketChatTools.reset(c);}catch(IllegalArgumentException invalid){}}
        else if(uid.equals("camera")){SharedPreferences.Editor edit=c.getSharedPreferences("pocket_camera",0).edit();for(String key:new String[]{"profile","aspect","quality","flash"})if(value.has(key))edit.putString(key,clip(value.optString(key),40));edit.putInt("size_long",Math.max(0,Math.min(8192,value.optInt("sizeLong")))).putInt("ev",Math.max(-6,Math.min(6,value.optInt("ev")))).commit();}
        else if(uid.equals("calculator"))c.getSharedPreferences("CalculatorActivity",0).edit().putString("expression",clip(value.optString("expression"),512)).putBoolean("calculated",value.optBoolean("calculated")).putString("last_calculation",clip(value.optString("lastCalculation"),1000)).putString("history",value.optJSONArray("history")==null?"[]":value.getJSONArray("history").toString()).commit();
        else if(uid.equals("home-tiles")){SharedPreferences p=c.getSharedPreferences("text_phone",0);SharedPreferences.Editor edit=p.edit();for(String key:p.getAll().keySet())if(homeKey(key))edit.remove(key);java.util.Iterator<String> keys=value.keys();while(keys.hasNext()){String key=keys.next();if(homeKey(key)&&value.opt(key) instanceof String)edit.putString(key,clip(value.optString(key),16000));}edit.commit();}
    }}
    private static void resetPreference(Context c,String uid){String name;String[] keys;if(uid.equals("appearance")){name="text_phone";keys=new String[]{"accent","large_text","reduce_motion"};}else if(uid.equals("dice")){name="pocket_dice";keys=new String[]{"mode","count","shake","last_face","last_detail","history"};}else if(uid.equals("pip-defaults")){name="pocket_chat_provider";keys=new String[]{"provider","model","base_url","max_tokens","prompt_caching","web_search"};}else if(uid.equals("camera")){name="pocket_camera";keys=new String[]{"profile","aspect","quality","size_long","flash","ev"};}else if(uid.equals("calculator")){name="CalculatorActivity";keys=new String[]{"expression","calculated","last_calculation","history"};}else if(uid.equals("home-tiles")){name="text_phone";List<String> all=new ArrayList<>();for(String key:c.getSharedPreferences(name,0).getAll().keySet())if(homeKey(key))all.add(key);keys=all.toArray(new String[0]);}else return;SharedPreferences.Editor edit=c.getSharedPreferences(name,0).edit();for(String key:keys)edit.remove(key);edit.commit();}
    private WorkspaceExtras(){}
}
