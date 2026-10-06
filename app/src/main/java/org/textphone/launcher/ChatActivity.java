package org.textphone.launcher;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Small, persisted records of provider events and actual local reads, never inferred from prose. */
final class ChatActivity {
    private final Map<String, JSONObject> rows = new LinkedHashMap<>();
    private final Consumer<String> changed;
    ChatActivity(Consumer<String> changed) { this.changed = changed; }

    void record(String id, String name, JSONObject input, String state, String summary, JSONArray sources) throws JSONException {
        if (id == null || id.isEmpty()) return;
        JSONObject row = rows.get(id);
        if (row == null) {
            if (rows.size() >= 32) return;
            row = new JSONObject().put("id", id).put("started", System.currentTimeMillis()); rows.put(id, row);
        }
        if (name != null) row.put("name", name).put("kind", "web_search".equals(name) ? "web" : "tool");
        if (input != null) row.put("input", input.toString()).put("title", title(row.optString("name"), input));
        if (state != null) { row.put("state", state); if (!("queued".equals(state) || "running".equals(state))) row.put("ended", System.currentTimeMillis()); }
        if (summary != null) row.put("summary", summary);
        if (sources != null) row.put("sources", sources);
        changed.accept(normalize(new JSONArray(rows.values()).toString()));
    }

    static JSONArray read(String raw) {
        JSONArray clean = new JSONArray();
        try {
            if (raw == null || raw.length() > 128000) return clean;
            JSONArray values = new JSONArray(raw == null ? "[]" : raw);
            if (values.length() > 32) return clean;
            for (int i = 0; i < values.length(); i++) {
                JSONObject row = values.optJSONObject(i); if (row == null || row.optString("id").isEmpty()) continue;
                String state = row.optString("state");
                if (!("queued".equals(state) || "running".equals(state) || "done".equals(state) || "failed".equals(state) || "stopped".equals(state))) continue;
                JSONObject safe = new JSONObject().put("id", clip(row.optString("id"), 200)).put("kind", "web".equals(row.optString("kind")) ? "web" : "tool")
                        .put("name", clip(row.optString("name"), 80)).put("title", clip(row.optString("title"), 240))
                        .put("input", clip(row.optString("input"), 1024)).put("state", state).put("summary", clip(row.optString("summary"), 500))
                        .put("started", Math.max(0, row.optLong("started"))).put("ended", Math.max(0, row.optLong("ended")));
                JSONArray links = new JSONArray(), supplied = row.optJSONArray("sources");
                if (supplied != null) for (int n = 0; n < Math.min(8, supplied.length()); n++) {
                    JSONObject link = supplied.optJSONObject(n); if (link == null) continue;
                    JSONObject valid = source(link.optString("href", link.optString("url")), link.optString("title")); if (valid != null) links.put(valid);
                }
                safe.put("sources", links); clean.put(safe);
                if (clean.toString().length() > 64000) { clean.remove(clean.length() - 1); break; }
            }
        } catch (JSONException | RuntimeException damaged) { return new JSONArray(); }
        return clean;
    }
    static String normalize(String raw) { return read(raw).toString(); }
    static String settle(String raw, String state) {
        JSONArray values = read(raw);
        try { for (int i = 0; i < values.length(); i++) { JSONObject row = values.getJSONObject(i);
            if ("queued".equals(row.optString("state")) || "running".equals(row.optString("state")))
                row.put("state", state).put("ended", System.currentTimeMillis()).put("summary", "stopped".equals(state) ? "Stopped" : "No result returned");
        } } catch (JSONException impossible) { return "[]"; }
        return values.toString();
    }
    static JSONObject source(String href, String title) {
        if (href == null || href.length() > 2048) return null;
        try {
            if (!href.matches("^/(notes|tasks|thoughts|gym|movement)(/.*)?$")) {
                URI uri = new URI(href);
                if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null) return null;
            }
            return new JSONObject().put("href", href).put("title", clip(title == null || title.isEmpty() ? href : title, 160));
        } catch (java.net.URISyntaxException | JSONException invalid) { return null; }
    }
    static String title(String name, JSONObject input) {
        String query = clip(input.optString("query"), 200), label;
        if ("web_search".equals(name)) label = "search web";
        else if (name.startsWith("search_")) label = "search " + name.substring(7);
        else if ("read_note".equals(name)) return "read note";
        else if ("coros_summary".equals(name)) return "read COROS cache · " + input.optInt("days", 7) + " days";
        else if ("gym_summary".equals(name)) return "read Gym · " + input.optInt("days", 7) + " days";
        else label = name.replace('_', ' ');
        return label + (query.isEmpty() ? "" : " · “" + query + "”");
    }
    static String summary(String name, JSONObject result) {
        if (result.has("error") || !result.optBoolean("available", true)) return result.optString("message", result.optString("error", "No cached data"));
        if ("read_note".equals(name)) return result.optString("title", "Note read");
        if ("coros_summary".equals(name)) return (result.optBoolean("stale") ? "stale cache" : "cached readings") + " · " + result.optString("last_updated");
        return result.optInt("matched") + ("gym_summary".equals(name) ? " workouts" : " matches") + (result.optBoolean("truncated") ? " · partial" : "");
    }
    static String mark(String state) { return "done".equals(state) ? "□" : "failed".equals(state) ? "△" : "stopped".equals(state) ? "−" : "running".equals(state) ? "◌" : "◇"; }
    static String heading(JSONArray rows) {
        java.util.Set<String> names = new java.util.LinkedHashSet<>(); boolean failed = false, stopped = false;
        JSONObject pending = null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i); if (row == null) continue; String state = row.optString("state");
            if ("running".equals(state)) return mark(state) + " " + row.optString("title");
            if ("queued".equals(state) && pending == null) pending = row;
            String name = row.optString("name");
            names.add("web_search".equals(name) ? "Web" : name.contains("note") ? "Notes" : name.contains("thought") ? "Thoughts" : name.contains("task") ? "Tasks" : name.contains("gym") ? "Gym" : name.contains("coros") ? "COROS" : row.optString("title"));
            failed |= "failed".equals(state); stopped |= "stopped".equals(state);
        }
        if (pending != null) return mark("queued") + " " + pending.optString("title");
        return (failed ? "△ " : stopped ? "− " : "□ ") + String.join(" + ", names) + " · " + rows.length()
                + (rows.length() == 1 ? " step" : " steps") + (failed ? " · failed" : stopped ? " · stopped" : "");
    }
    static String phase(String value) {
        return "requesting".equals(value) ? "◌ linking up" : "thinking".equals(value) ? "◇ turning it over" : "writing".equals(value) ? "□ writing" : "preparing reply".equals(value) ? "◇ lining it up" : "◌ " + value;
    }
    static JSONArray sources(String name, JSONObject result) {
        JSONArray links = new JSONArray();
        if (result.has("error") || !result.optBoolean("available", true)) return links;
        if ("coros_summary".equals(name)) { links.put(source("/movement", "Movement · COROS cache")); return links; }
        if ("read_note".equals(name)) { links.put(source("/notes/" + result.optString("id"), result.optString("title"))); return links; }
        String kind = "search_notes".equals(name) ? "notes" : "search_thoughts".equals(name) ? "thoughts" : "search_tasks".equals(name) ? "tasks" : "gym";
        JSONArray items = result.optJSONArray("gym".equals(kind) ? "workouts" : kind);
        if (items != null) for (int i = 0; i < Math.min(5, items.length()); i++) {
            JSONObject item = items.optJSONObject(i); if (item == null) continue;
            String title = item.optString("title", item.optString("text", "Workout"));
            JSONObject link = source("/" + kind + "/" + item.optString("id"), title); if (link != null) links.put(link);
        }
        return links;
    }
    private static String clip(String value, int limit) { return value.length() <= limit ? value : value.substring(0, limit); }
}
