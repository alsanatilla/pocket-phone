package org.textphone.launcher;

import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The one merge rule shared with the web page (docs/js/store.js): per item, the later edit wins; a tie keeps the local copy. */
final class SyncMerge {
    static JSONArray byId(JSONArray local, JSONArray remote, String idKey, String updatedKey) throws JSONException {
        Map<String, JSONObject> merged = new LinkedHashMap<>();
        if (local != null) for (int i = 0; i < local.length(); i++) { JSONObject item = local.optJSONObject(i); if (item != null && item.has(idKey)) merged.put(item.get(idKey).toString(), item); }
        if (remote != null) for (int i = 0; i < remote.length(); i++) {
            JSONObject item = remote.optJSONObject(i); if (item == null || !item.has(idKey)) continue;
            String id = item.get(idKey).toString(); JSONObject mine = merged.get(id);
            if (mine == null || item.optLong(updatedKey) > mine.optLong(updatedKey)) merged.put(id, item);
        }
        JSONArray out = new JSONArray(); for (JSONObject item : merged.values()) out.put(item); return out;
    }
    private SyncMerge() { }
}
