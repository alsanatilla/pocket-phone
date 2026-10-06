package org.textphone.launcher;

import android.content.Context;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Portable paired turns shared with web Pip; API credentials never enter this format. */
final class ChatCloudCodec {
    static String device(Context context) {
        android.content.SharedPreferences prefs = context.getSharedPreferences("pocket_chat_cloud", 0);
        String id = prefs.getString("device", "");
        if (id.isEmpty()) { id = UUID.randomUUID().toString(); prefs.edit().putString("device", id).commit(); }
        return id;
    }
    static String canonical(Object value) throws JSONException {
        if (value instanceof JSONObject) {
            JSONObject obj=(JSONObject)value; List<String> keys=new ArrayList<>(); obj.keys().forEachRemaining(keys::add); java.util.Collections.sort(keys);
            List<String> parts=new ArrayList<>(); for(String key:keys) parts.add(JSONObject.quote(key)+":"+canonical(obj.get(key))); return "{"+String.join(",",parts)+"}";
        }
        if(value instanceof JSONArray){List<String> parts=new ArrayList<>();JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)parts.add(canonical(array.get(i)));return "["+String.join(",",parts)+"]";}
        return value instanceof String ? JSONObject.quote((String)value) : String.valueOf(value);
    }
    private static JSONObject copy(JSONObject value) throws JSONException { return value==null?new JSONObject():new JSONObject(value.toString()); }
    private static boolean newer(Object a,Object b,long left,long right) throws JSONException { return left!=right?left>right:canonical(a).compareTo(canonical(b))>0; }
    static JSONObject merge(JSONObject stored, JSONObject incoming) throws JSONException {
        if(stored==null)return copy(incoming);
        if(stored.optBoolean("deleted")||incoming.optBoolean("deleted"))return copy(incoming.optBoolean("deleted")&&(!stored.optBoolean("deleted")||incoming.optLong("updated")>stored.optLong("updated"))?incoming:stored);
        JSONObject latest=copy(newer(incoming,stored,incoming.optLong("updated"),stored.optLong("updated"))?incoming:stored);
        long a=incoming.optLong("draftUpdated",incoming.optLong("updated")),b=stored.optLong("draftUpdated",stored.optLong("updated"));
        JSONObject draft=newer(new JSONArray().put(incoming.optString("draft")).put(incoming.optJSONArray("context")),new JSONArray().put(stored.optString("draft")).put(stored.optJSONArray("context")),a,b)?incoming:stored;
        latest.put("draft",draft.optString("draft")).put("context",draft.optJSONArray("context")).put("draftUpdated",draft.optLong("draftUpdated",draft.optLong("updated")));
        Map<String,JSONObject> turns=new LinkedHashMap<>();JSONArray old=stored.getJSONArray("turns"),fresh=incoming.getJSONArray("turns");
        for(int i=0;i<old.length();i++){JSONObject turn=old.getJSONObject(i);turns.put(turn.getString("uid"),turn);}
        for(int i=0;i<fresh.length();i++){JSONObject turn=fresh.getJSONObject(i),previous=turns.get(turn.getString("uid"));if(previous==null||newer(turn,previous,turn.optLong("updated",incoming.optLong("updated")),previous.optLong("updated",stored.optLong("updated"))))turns.put(turn.getString("uid"),turn);}
        List<JSONObject> sorted=new ArrayList<>(turns.values());sorted.sort(Comparator.comparingLong((JSONObject t)->t.optLong("created")).thenComparing(t->t.optString("uid")));
        return latest.put("turns",new JSONArray(sorted)).put("updated",Math.max(stored.optLong("updated"),incoming.optLong("updated")));
    }
    static JSONObject encode(Context context, ChatStore.Record record, JSONObject previous) throws JSONException {
        if(record.deleted)return new JSONObject().put("uid",record.id).put("deleted",true).put("updated",record.updated);
        if(previous!=null&&previous.optBoolean("deleted"))return previous;
        JSONObject result=copy(previous);
        ChatProvider.Config provider=record.provider==null?ChatProvider.get(context):record.provider;
        try{provider.validate();}catch(IllegalArgumentException invalid){provider=ChatProvider.defaults("anthropic");}
        JSONObject config=result.optJSONObject("config");
        if(config==null||!provider.identity.equals(config.optString("provider")+"|"+config.optString("baseUrl")+"|"+config.optString("model")))
            config=new JSONObject().put("provider",provider.provider).put("model",provider.model).put("baseUrl",provider.baseUrl).put("maxTokens",provider.maxTokens).put("thinking",false).put("webSearch",provider.webSearch);
        JSONArray attached=new JSONArray(record.draftContext);String draft=record.draft;
        boolean sameDraft=previous!=null&&clip(previous.optString("draft"),ClaudeChatRepository.MAX_INPUT_CHARS).equals(draft)&&canonical(previous.optJSONArray("context")).equals(canonical(attached));
        result.put("uid",record.id).put("title",record.title).put("created",record.created).put("updated",record.updated).put("config",config)
                .put("draft",sameDraft?previous.optString("draft"):draft).put("context",sameDraft?previous.optJSONArray("context"):attached)
                .put("draftUpdated",sameDraft?previous.optLong("draftUpdated",previous.optLong("updated")):record.updated).put("returnedModel",record.model);
        Map<String,JSONObject> turns=new LinkedHashMap<>();JSONArray before=result.optJSONArray("turns");
        if(before!=null)for(int i=0;i<before.length();i++){JSONObject turn=before.getJSONObject(i);turns.put(turn.getString("uid"),turn);}
        for(int i=0;i+1<record.turns.size();i+=2){
            ClaudeChatRepository.Turn user=record.turns.get(i),reply=record.turns.get(i+1);JSONObject old=turns.get(user.id),turn=copy(old);
            String status="complete".equals(reply.state)?"done":"pending".equals(reply.state)?"streaming":reply.state;
            boolean remote=old!=null&&"streaming".equals(old.optString("status"))&&!device(context).equals(old.optString("owner"))&&!"pending".equals(reply.state)
                    &&clip(old.optString("answer"),ClaudeChatRepository.MAX_OUTPUT_CHARS).equals(reply.text)&&clip(old.optString("reasoning"),ClaudeChatRepository.MAX_REASONING_CHARS).equals(reply.reasoning);
            if(remote)continue;
            String generated=UUID.nameUUIDFromBytes((user.id+":assistant").getBytes(StandardCharsets.UTF_8)).toString();
            if(old==null||old.has("assistantUid")||!generated.equals(reply.id))turn.put("assistantUid",reply.id);
            turn.put("uid",user.id).put("created",user.created)
                    .put("text",old!=null&&clip(old.optString("text"),ClaudeChatRepository.MAX_INPUT_CHARS).equals(user.text)?old.optString("text"):user.text)
                    .put("answer",old!=null&&clip(old.optString("answer"),ClaudeChatRepository.MAX_OUTPUT_CHARS).equals(reply.text)?old.optString("answer"):reply.text)
                    .put("reasoning",old!=null&&clip(old.optString("reasoning"),ClaudeChatRepository.MAX_REASONING_CHARS).equals(reply.reasoning)?old.optString("reasoning"):reply.reasoning)
                    .put("context",new JSONArray(user.context)).put("activity",ChatActivity.read(reply.activity)).put("status",status);
            JSONObject a=copy(old),b=copy(turn);a.remove("updated");b.remove("updated");
            if(old==null||!canonical(a).equals(canonical(b))){turn.put("updated",record.updated).put("owner",device(context));if(i+2==record.turns.size())turn.put("usage",usage(record.usage));}
            else turn.put("updated",old.optLong("updated",previous.optLong("updated")));
            turns.put(user.id,turn);
        }
        List<JSONObject> sorted=new ArrayList<>(turns.values());sorted.sort(Comparator.comparingLong((JSONObject t)->t.optLong("created")).thenComparing(t->t.optString("uid")));
        return result.put("turns",new JSONArray(sorted)).put("usage",usage(record.usage));
    }
    private static JSONObject usage(ClaudeChatClient.Usage value) throws JSONException {return new JSONObject().put("inputTokens",value.inputTokens).put("outputTokens",value.outputTokens).put("cacheReadTokens",value.cacheReadTokens).put("cacheWriteTokens",value.cacheWriteTokens);}
    static ChatProvider.Config provider(JSONObject value) throws JSONException {JSONObject cfg=value.getJSONObject("config");ChatProvider.Config config=new ChatProvider.Config(cfg.getString("provider"),cfg.getString("model"),cfg.getString("baseUrl"),cfg.optInt("maxTokens",2048),true,cfg.optBoolean("webSearch"));config.validate();return config;}
    static ChatStore.Record decode(JSONObject value) throws JSONException {
        String uid=value.getString("uid");long updated=value.getLong("updated");if(!uid.matches("[a-zA-Z0-9_-]{1,100}")||updated<0)throw new JSONException("Invalid chat");
        if(value.optBoolean("deleted"))return new ChatStore.Record(uid,"","","",ClaudeChatRepository.MODEL,null,ClaudeChatClient.Usage.EMPTY,java.util.Collections.emptyList(),0,updated,0,true,false);
        ChatProvider.Config config=provider(value);List<ClaudeChatRepository.Turn> turns=new ArrayList<>();JSONArray pairs=value.getJSONArray("turns");int chars=0;
        for(int i=pairs.length()-1;i>=0&&turns.size()<ClaudeChatRepository.MAX_TURNS;i--){JSONObject pair=pairs.getJSONObject(i);String text=clip(pair.getString("text"),ClaudeChatRepository.MAX_INPUT_CHARS),answer=clip(pair.getString("answer"),ClaudeChatRepository.MAX_OUTPUT_CHARS),reasoning=clip(pair.optString("reasoning"),ClaudeChatRepository.MAX_REASONING_CHARS);
            String attached=pair.optJSONArray("context")==null?"[]":pair.getJSONArray("context").toString();ChatContext.read(attached);
            chars+=text.length()+answer.length()+attached.length();if(chars>ClaudeChatRepository.MAX_HISTORY_CHARS)break;
            if(text.trim().isEmpty())continue;
            String id=pair.getString("uid"),replyId=pair.optString("assistantUid",UUID.nameUUIDFromBytes((id+":assistant").getBytes(StandardCharsets.UTF_8)).toString());
            String state=pair.getString("status");state="done".equals(state)?"complete":"streaming".equals(state)?"pending":state;
            if(!java.util.Arrays.asList("complete","pending","failed","stopped").contains(state))throw new JSONException("Invalid reply state");
            turns.add(0,new ClaudeChatRepository.Turn(replyId,"assistant",answer,state,reasoning,pair.optLong("created"),"[]",ChatActivity.normalize(pair.optJSONArray("activity")==null?"[]":pair.getJSONArray("activity").toString())));
            turns.add(0,new ClaudeChatRepository.Turn(id,"user",text,"complete","",pair.optLong("created"),attached));
        }
        JSONObject usage=value.optJSONObject("usage");ClaudeChatClient.Usage counts=usage==null?ClaudeChatClient.Usage.EMPTY:new ClaudeChatClient.Usage(usage.optLong("inputTokens"),usage.optLong("outputTokens"),usage.optLong("cacheReadTokens"),usage.optLong("cacheWriteTokens"));
        String context=value.getJSONArray("context").toString();ChatContext.read(context);
        return new ChatStore.Record(uid,clip(value.optString("title"),80),clip(value.optString("draft"),ClaudeChatRepository.MAX_INPUT_CHARS),"",value.optString("returnedModel",config.model),config,counts,turns,value.optLong("created",updated),updated,0,false,false,context);
    }
    private static String clip(String value,int limit){return value.length()<=limit?value:value.substring(0,limit);}
    private ChatCloudCodec() { }
}
