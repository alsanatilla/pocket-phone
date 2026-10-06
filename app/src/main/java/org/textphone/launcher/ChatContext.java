package org.textphone.launcher;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** The source snapshots a person explicitly attached to a message. */
final class ChatContext {
    final String kind, title, text, uid;
    final long id;
    ChatContext(String kind, long id, String title, String text) {
        this(kind, Long.toString(id), title, text);
    }
    private ChatContext(String kind, String uid, String title, String text) {
        if (!java.util.Arrays.asList("thought", "task", "note").contains(kind) || !uid.matches("[a-zA-Z0-9_-]{1,100}") || title.length() > 500 || text.length() > 8000)
            throw new IllegalArgumentException("This context is unavailable.");
        this.kind=kind; this.uid=uid; long number=0;try{number=Long.parseLong(uid);}catch(NumberFormatException ignored){}this.id=number; this.title=title; this.text=text;
    }
    static List<ChatContext> read(String raw) {
        try {
            if(raw.length()>200000)throw new IllegalArgumentException("Context is too large.");
            JSONArray array=new JSONArray(raw); if(array.length()>3)throw new IllegalArgumentException("Attach up to three sources.");
            List<ChatContext> result=new ArrayList<>();
            for(int i=0;i<array.length();i++){JSONObject item=array.getJSONObject(i);result.add(new ChatContext(item.getString("kind"),item.optString("uid",item.optString("id")),item.getString("title"),item.getString("text")));}
            return result;
        } catch(org.json.JSONException invalid){throw new IllegalArgumentException("Saved context could not be read.",invalid);}
    }
    static String write(List<ChatContext> items) {
        try { JSONArray array=new JSONArray(); for(ChatContext item:items)array.put(new JSONObject().put("kind",item.kind).put("uid",item.uid).put("id",item.id).put("title",item.title).put("text",item.text));return array.toString(); }
        catch(org.json.JSONException invalid){throw new IllegalStateException("Context could not be saved.",invalid);}
    }
    static String prompt(ClaudeChatRepository.Turn turn) {
        StringBuilder text=new StringBuilder(turn.text);
        List<ChatContext> items=read(turn.context);
        if(!items.isEmpty()){text.append("\n\nAttached Pocket context:\n");for(ChatContext item:items)text.append("\n--- ").append(item.kind).append(": ").append(item.title).append(" ---\n").append(item.text).append('\n');}
        return text.toString();
    }
}
