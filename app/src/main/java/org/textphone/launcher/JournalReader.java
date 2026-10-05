package org.textphone.launcher;

import android.content.Context;
import android.util.Base64;
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.anthropic.models.beta.messages.BetaBase64ImageSource;
import com.anthropic.models.beta.messages.BetaContentBlock;
import com.anthropic.models.beta.messages.BetaContentBlockParam;
import com.anthropic.models.beta.messages.BetaImageBlockParam;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaOutputConfig;
import com.anthropic.models.beta.messages.BetaStopReason;
import com.anthropic.models.beta.messages.BetaTextBlockParam;
import com.anthropic.models.beta.messages.MessageCreateParams;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads one journal page with Claude Sonnet 5.5 and turns it into a note. Chosen in a comparison on the user's own
 * handwriting: Sonnet read German cursive almost word for word and placed every line; Haiku 4.5 missed a quarter of the words.
 */
final class JournalReader {
    static final String MODEL = "claude-sonnet-5-5";
    /** Per million tokens, for the cost shown on each page. */
    private static final double INPUT_PRICE = 2.0, OUTPUT_PRICE = 10.0;
    private static final Pattern TIME = Pattern.compile("(\\d{1,2})[:.](\\d{2})");
    private static final Pattern TODO_TITLE = Pattern.compile("(?i).*\\b(todos?|to-?dos?|aufgaben|tasks?|erledigen)\\b.*");
    static final String PROMPT = "Transcribe this photo of a handwritten journal page. Write exactly what is on the paper; do not correct, translate or complete anything.\n\n"
            + "Rules:\n"
            + "- Transcribe only the page(s) actually written on. Ignore text showing through from the back of the paper (faint, mirrored) and small scraps of a neighbouring page at the photo edge. A neighbouring page counts only if a real part of it is legible; then make it its own page and end cut words with […].\n"
            + "- Keep every handwritten line as its own line, even if it continues a sentence.\n"
            + "- Braces, brackets or arrows that tie several lines to a note: record them as a group with the indexes of the lines they cover and the note's text. Do not repeat the note as a normal line.\n"
            + "- Put a written date and the printed page number in \"date\" and \"page_number\", not in the lines.\n"
            + "- Mark words you are unsure of in \"uncertain\".\n\n"
            + "Return only JSON, no prose:\n"
            + "{\"pages\":[{\"title\":\"\",\"date\":\"\",\"page_number\":\"\",\"cut_off\":false,\n"
            + "  \"lines\":[{\"text\":\"\",\"sign\":\"dash|arrow|box|bullet|none\",\"ink\":\"black|blue|other\",\"uncertain\":[],\"top\":0.0,\"bottom\":0.0}],\n"
            + "  \"groups\":[{\"lines\":[0,1],\"mark\":\"brace|bracket|arrow\",\"note\":\"\"}]}]}\n"
            + "\"sign\" is the mark at the start of the line, written separately from \"text\". \"top\"/\"bottom\" are the line's vertical position as a fraction of the photo height. Line indexes in \"groups\" count from 0 within the page.";

    /** Retry later: the phone is offline, Claude is busy, or a server hiccup. */
    static final class Later extends Exception { Later(String message) { super(message); } }

    /** Reads the page and stores the result. Permanent problems end in FAILED with a reason the user can act on. */
    static void read(Context c, String uid) throws Later {
        String key = ClaudeKey.read(c);
        if (key == null) {
            JournalStore.update(c, uid, p -> p.put("state", JournalStore.WAITING)
                    .put("error", "Add your Claude API key in Journal → Settings to read this page."));
            return;
        }
        // A page uploaded on the web has its photo only in Drive until this phone fetches it.
        if (!JournalStore.image(c, uid).isFile()) {
            try { if (!CloudSync.downloadPageImage(c, uid)) { fail(c, uid, "The photo isn't on this phone. Turn on Settings → Cloud sync to read pages added on the web."); return; } }
            catch (CloudSync.SignInNeeded e) { fail(c, uid, "Sign in again in Settings → Cloud sync to fetch this page's photo."); return; }
            catch (IOException e) { throw later(c, uid, "Offline; the photo is fetched once the phone is online."); }
        }
        JournalStore.update(c, uid, p -> p.put("state", JournalStore.READING));
        AnthropicClient client = AnthropicOkHttpClient.builder().apiKey(key).timeout(Duration.ofSeconds(90)).maxRetries(2).build();
        try {
            String image = Base64.encodeToString(JournalStore.forReading(c, uid), Base64.NO_WRAP);
            MessageCreateParams params = MessageCreateParams.builder()
                    .model(MODEL).maxTokens(8000L)
                    .outputConfig(BetaOutputConfig.builder().effort(BetaOutputConfig.Effort.LOW).build())
                    // If a safety check declines the page, the server retries on a fallback model instead of failing.
                    .addBeta("server-side-fallback-2026-07-01").putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
                    .addUserMessageOfBetaContentBlockParams(List.of(
                            BetaContentBlockParam.ofImage(BetaImageBlockParam.builder().source(BetaBase64ImageSource.builder()
                                    .data(image).mediaType(BetaBase64ImageSource.MediaType.IMAGE_JPEG).build()).build()),
                            BetaContentBlockParam.ofText(BetaTextBlockParam.builder().text(PROMPT).build())))
                    .build();
            BetaMessage message = client.beta().messages().create(params);
            BetaStopReason stop = message.stopReason().orElse(null);
            if (BetaStopReason.REFUSAL.equals(stop)) { fail(c, uid, "Claude declined to read this page."); return; }
            if (BetaStopReason.MAX_TOKENS.equals(stop)) { fail(c, uid, "The page was too long to read in one go."); return; }
            StringBuilder text = new StringBuilder();
            for (BetaContentBlock block : message.content()) block.text().ifPresent(t -> text.append(t.text()));
            double cents = (message.usage().inputTokens() * INPUT_PRICE + message.usage().outputTokens() * OUTPUT_PRICE) / 1e6 * 100;
            apply(c, uid, parse(text.toString()), cents);
        } catch (UnauthorizedException e) { fail(c, uid, "Claude rejected the API key. Check it in Journal → Settings.");
        } catch (RateLimitException e) { throw later(c, uid, "Claude is busy; the page will be read later.");
        } catch (AnthropicIoException e) { throw later(c, uid, "Offline; the page will be read once the phone is online.");
        } catch (AnthropicServiceException e) {
            if (e.statusCode() >= 500) throw later(c, uid, "Claude had a problem; the page will be read later.");
            fail(c, uid, e.statusCode() == 400 && String.valueOf(e.getMessage()).contains("credit") ? "Your Claude account has no credit left." : "Claude could not read this page (" + e.statusCode() + ").");
        } catch (IOException e) { fail(c, uid, "The photo could not be opened.");
        } catch (JSONException e) { fail(c, uid, "Claude's answer could not be understood. Try reading the page again.");
        } finally { client.close(); }
    }
    private static Later later(Context c, String uid, String why) { JournalStore.update(c, uid, p -> p.put("state", JournalStore.WAITING).put("error", why)); return new Later(why); }
    private static void fail(Context c, String uid, String why) { JournalStore.update(c, uid, p -> p.put("state", JournalStore.FAILED).put("error", why)); }

    static JSONObject parse(String answer) throws JSONException {
        int start = answer.indexOf('{'), end = answer.lastIndexOf('}');
        if (start < 0 || end < start) throw new JSONException("No JSON in the answer.");
        return new JSONObject(answer.substring(start, end + 1));
    }

    /** The written page, not a scrap of its neighbour: the first page that isn't cut off, else the first page. */
    static JSONObject mainPage(JSONObject result) throws JSONException {
        JSONArray pages = result.optJSONArray("pages");
        if (pages == null || pages.length() == 0) throw new JSONException("No page in the answer.");
        for (int i = 0; i < pages.length(); i++) if (!pages.getJSONObject(i).optBoolean("cut_off")) return pages.getJSONObject(i);
        return pages.getJSONObject(0);
    }

    private static void apply(Context c, String uid, JSONObject result, double cents) throws JSONException {
        JSONObject page = mainPage(result);
        JSONArray lines = page.optJSONArray("lines") == null ? new JSONArray() : page.optJSONArray("lines");
        JSONArray groups = page.optJSONArray("groups") == null ? new JSONArray() : page.optJSONArray("groups");
        String title = page.optString("title", "").trim();
        boolean todos = TODO_TITLE.matcher(title).matches();
        // One note line per handwritten line, so each line can show its strip of the photo. Continuations indent under their item.
        List<String> note = new ArrayList<>(); note.add("# " + (title.isEmpty() ? "Journal page" : title));
        String meta = joinNonEmpty(" · ", page.optString("date"), page.optString("page_number").isEmpty() ? "" : "p. " + page.optString("page_number"));
        if (!meta.isEmpty()) note.add("_" + meta + "_");
        JSONArray kept = new JSONArray(); boolean inItem = false;
        for (int i = 0; i < lines.length(); i++) {
            JSONObject line = lines.getJSONObject(i); String text = line.optString("text", "").trim(); String sign = line.optString("sign", "none");
            String noteLine = text.isEmpty() ? "" : i == 0 && text.equals(title) ? note.get(0)
                    : !"none".equals(sign) ? (todos ? "- [ ] " : "- ") + text : inItem ? "  " + text : text;
            if (noteLine.equals(note.get(0))) { kept.put(new JSONObject().put("text", text).put("note_line", noteLine).put("sign", sign).put("top", line.optDouble("top", 0)).put("bottom", line.optDouble("bottom", 0))); continue; }
            if (!noteLine.isEmpty()) { note.add(noteLine); inItem = !"none".equals(sign) || inItem; }
            kept.put(new JSONObject().put("text", text).put("note_line", noteLine).put("sign", sign).put("ink", line.optString("ink", "black"))
                    .put("uncertain", line.optJSONArray("uncertain") == null ? new JSONArray() : line.optJSONArray("uncertain"))
                    .put("top", line.optDouble("top", 0)).put("bottom", line.optDouble("bottom", 0)));
        }
        // A brace like "ab 16:30" becomes a thought that comes back at that time; any other note is kept as text.
        for (int g = 0; g < groups.length(); g++) {
            JSONObject group = groups.getJSONObject(g); JSONArray covered = group.optJSONArray("lines"); List<String> items = new ArrayList<>();
            for (int k = 0; covered != null && k < covered.length(); k++) { int index = covered.optInt(k, -1); if (index >= 0 && index < lines.length()) items.add(shortItem(lines.getJSONObject(index).optString("text"))); }
            String label = group.optString("note", "").trim(); Matcher time = TIME.matcher(label);
            if (items.isEmpty()) continue;
            if (time.find()) note.add(">> " + android.text.TextUtils.join(", ", items) + " @" + String.format(Locale.ROOT, "%02d:%s", Integer.parseInt(time.group(1)), time.group(2)));
            else if (!label.isEmpty()) note.add("_" + label + ": " + android.text.TextUtils.join(", ", items) + "_");
        }
        String text = android.text.TextUtils.join("\n", note);
        PlannerStore planner = new PlannerStore(c.getSharedPreferences("pocket_planner", 0));
        JSONObject current = JournalStore.find(c, uid); String noteUid = current == null ? "" : current.optString("note", "");
        PlannerStore.Entry existing = NoteSync.byUid(planner, noteUid);
        long id = planner.save(existing == null ? 0 : existing.id, "note", text);
        String linked = NoteSync.uid(planner, id);
        NoteThoughts.parkNew(c, planner, id, existing == null ? "" : existing.text, text);
        String pageTitle = title.isEmpty() ? "Journal page" : title;
        JournalStore.update(c, uid, p -> p.put("state", JournalStore.DONE).put("error", "").put("title", pageTitle).put("date", page.optString("date", "")).put("page_number", page.optString("page_number", ""))
                .put("lines", kept).put("groups", groups).put("note", linked).put("model", MODEL).put("cents", Math.round(cents * 100) / 100.0));
        ReceiptTape.log(c, ReceiptTape.PAGE, pageTitle);
    }
    /** "Kartone entsorgen" → "Kartone entsorgen"; long items are cut so the thought stays one readable line. */
    private static String shortItem(String text) { String t = text.trim(); return t.length() > 40 ? t.substring(0, 39) + "…" : t; }
    private static String joinNonEmpty(String separator, String... parts) {
        StringBuilder out = new StringBuilder(); for (String part : parts) if (part != null && !part.trim().isEmpty()) { if (out.length() > 0) out.append(separator); out.append(part.trim()); }
        return out.toString();
    }
    private JournalReader() { }
}
