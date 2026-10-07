package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.BiFunction;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;

/** Deterministic SSE fixtures: no provider requests, API credentials or production data. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class ClaudeAgentTransportTest {
    private Context context;
    private ChatProvider.Config config;
    private PlannerStore planner;
    private long note;
    private final List<JSONObject> sent = new ArrayList<>();
    private final Recording listener = new Recording();

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("pocket_chat_provider", 0).edit().clear().putString("provider", "compatible")
                .putString("base_url", "https://fixture.invalid/v1").putString("model", "fixture-model")
                .putInt("max_tokens", 8192).commit();
        context.getSharedPreferences("pocket_chat_access", 0).edit().clear().commit();
        context.getSharedPreferences("pocket_planner", 0).edit().clear().commit();
        config = ChatProvider.get(context); PocketChatTools.enabled(context, PocketChatTools.NOTES, true);
        planner = new PlannerStore(context.getSharedPreferences("pocket_planner", 0));
        note = planner.save(0, "note", "Original fixture note\nThe meeting starts at ten.");
    }

    @Test public void eightToolContinuationsPreserveIdsAndReserveBoundedFinalTokens() throws Exception {
        run((round, body) -> round < 8 ? tools(call("id-" + round, "search_notes", "{\"query\":\"q" + round + "\"}")) : answer("Finished."), "[]", "");
        assertTrue(listener.done); assertEquals(9, sent.size()); assertEquals("none", sent.get(8).getString("tool_choice"));
        int caps = 0; for (JSONObject body : sent) caps += body.getInt("max_tokens"); assertTrue(caps <= config.maxTokens);
        JSONArray history = sent.get(8).getJSONArray("messages");
        int results = 0;
        for (int i = 0; i < history.length(); i++) if ("tool".equals(history.getJSONObject(i).optString("role"))) {
            assertEquals("id-" + results, history.getJSONObject(i).getString("tool_call_id")); results++;
        }
        assertEquals(8, results); assertEquals(8, completed(listener.activity, false));
    }

    @Test public void oversizedBatchStopsAtTwentyAndStillRequestsSynthesis() throws Exception {
        JSONArray requested = new JSONArray(); for (int i = 0; i < 23; i++) requested.put(call("batch-" + i, "search_notes", "{}"));
        run((round, body) -> round == 0 ? tools(requested) : answer("Bounded answer."), "[]", "");
        assertEquals(2, sent.size()); assertEquals("none", sent.get(1).getString("tool_choice")); assertTrue(listener.done);
        assertEquals(20, completed(listener.activity, false)); assertEquals(23, completed(listener.activity, true));
        JSONArray history = sent.get(1).getJSONArray("messages");
        int resultIndex = 0; for (int i = 0; i < history.length(); i++) if ("tool".equals(history.getJSONObject(i).optString("role"))) {
            JSONObject row = history.getJSONObject(i); assertEquals("batch-" + resultIndex, row.getString("tool_call_id"));
            if (resultIndex >= 20) assertEquals("retrieval_limit", new JSONObject(row.getString("content")).getString("error"));
            resultIndex++;
        }
        assertEquals(23, resultIndex);
    }

    @Test public void unofferedToolReturnsAnErrorWithoutChangingSavedRecords() throws Exception {
        run((round, body) -> round == 0 ? tools(call("bad", "delete_note", "{\"id\":1}")) : answer("No change made."), "[]", "");
        JSONArray history = sent.get(1).getJSONArray("messages"); JSONObject result = new JSONObject(history.getJSONObject(history.length() - 1).getString("content"));
        assertEquals("unavailable_tool", result.getString("error")); assertEquals(1, planner.entries().size()); assertTrue(listener.done);
    }

    @Test public void canonicalRunCacheKeepsReadSnapshotAndEncryptedReasoningContinuation() throws Exception {
        run((round, body) -> {
            if (round == 0) return "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_details\":[{\"index\":0,\"type\":\"reasoning.encrypted\",\"data\":\"abc\"}]}}]}\n\n"
                    + "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_details\":[{\"index\":0,\"type\":\"reasoning.encrypted\",\"data\":\"def\"}]}}]}\n\n"
                    + tools(call("first", "read_note", "{\"id\":" + note + ",\"offset\":0}"));
            if (round == 1) {
                planner.save(note, "note", "Changed fixture note");
                return tools(call("second", "read_note", "{\"offset\":0,\"id\":" + note + "}"));
            }
            return answer("Cached answer.");
        }, "[]", "");
        JSONArray history = sent.get(2).getJSONArray("messages");
        List<String> results = new ArrayList<>(); JSONObject assistant = null;
        for (int i = 0; i < history.length(); i++) {
            JSONObject row = history.getJSONObject(i); if ("tool".equals(row.optString("role"))) results.add(row.getString("content"));
            if (row.has("reasoning_details")) assistant = row;
        }
        assertEquals(2, results.size()); assertEquals(results.get(0), results.get(1)); assertTrue(results.get(1).contains("Original fixture"));
        assertNotNull(assistant); assertEquals("abcdef", assistant.getJSONArray("reasoning_details").getJSONObject(0).getString("data"));
        assertEquals(ClaudeChatClient.cacheKey("read_note", new JSONObject("{\"id\":1,\"offset\":0}")),
                ClaudeChatClient.cacheKey("read_note", new JSONObject("{\"offset\":0,\"id\":1}")));
    }

    @Test public void explicitContinueReusesPermittedCompletedResultsAndKeepsPriorProposal() throws Exception {
        String observed = PocketChatTools.execute(context, "read_note", new JSONObject().put("id", note));
        JSONArray previous = new JSONArray().put(checkpoint("read", "read_note", new JSONObject().put("id", note), observed))
                .put(checkpoint("proposal", "propose_action", new JSONObject(), "{\"proposal\":{\"kind\":\"note\",\"text\":\"Keep this\"}}").put("applied_href", "/notes/99"));
        planner.save(note, "note", "New saved text");
        run((round, body) -> round == 0 ? tools(call("read", "read_note", "{\"id\":" + note + "}")) : answer("Continued."), previous.toString(), "UNTRUSTED PARTIAL");
        String system = sent.get(0).getJSONArray("messages").getJSONObject(0).getString("content");
        assertTrue(system.contains("Original fixture")); assertTrue(system.contains("incomplete_notes")); assertTrue(system.contains("UNTRUSTED PARTIAL"));
        JSONArray history = sent.get(1).getJSONArray("messages"); assertTrue(history.getJSONObject(history.length() - 1).getString("content").contains("Original fixture"));
        JSONArray rows = ChatActivity.read(listener.activity); assertEquals(3, rows.length());
        JSONObject proposal = null; for (int i = 0; i < rows.length(); i++) if ("proposal".equals(rows.getJSONObject(i).getString("id"))) proposal = rows.getJSONObject(i);
        assertNotNull(proposal); assertEquals("/notes/99", proposal.getString("applied_href"));
    }

    @Test public void revokedContinueSourceAndItsPartialAnswerDoNotEnterModelContext() throws Exception {
        String observed = PocketChatTools.execute(context, "read_note", new JSONObject().put("id", note));
        String previous = new JSONArray().put(checkpoint("old", "read_note", new JSONObject().put("id", note), observed)).toString();
        PocketChatTools.enabled(context, PocketChatTools.NOTES, false);
        run((round, body) -> answer("No source access."), previous, "PRIVATE PARTIAL");
        String wire = sent.get(0).toString(); assertFalse(wire.contains("Original fixture")); assertFalse(wire.contains("PRIVATE PARTIAL"));
        assertTrue(listener.done);
    }

    @Test public void unstampedOrDifferentProviderCheckpointIsRetainedButNeverSentToTheModel() throws Exception {
        String observed = PocketChatTools.execute(context, "read_note", new JSONObject().put("id", note));
        JSONObject legacy = new JSONObject().put("id", "legacy").put("name", "read_note").put("state", "done")
                .put("input", new JSONObject().put("id", note).toString()).put("result", observed);
        JSONObject other = checkpoint("other", "read_note", new JSONObject().put("id", note), observed);
        other.put("result", new JSONObject(other.getString("result")).put("request_identity", "compatible|https://other.invalid/v1|other-model").toString());
        run((round, body) -> answer("Fresh source needed."), new JSONArray().put(legacy).put(other).toString(), "PRIVATE PARTIAL");
        assertFalse(sent.get(0).toString().contains("Original fixture")); assertFalse(sent.get(0).toString().contains("PRIVATE PARTIAL"));
        assertEquals(2, ChatActivity.read(listener.activity).length());
    }

    @Test public void webSearchAndPageReadBudgetIsSharedAndBoundedAtEight() throws Exception {
        context.getSharedPreferences("pocket_chat_provider", 0).edit().putBoolean("web_search", true).commit(); config = ChatProvider.get(context);
        JSONObject input = new JSONObject().put("url", "https://fixture.invalid/source");
        String observed = new JSONObject().put("title", "Cached fixture page").put("url", input.getString("url")).put("content", "A fixture fact.").toString();
        String previous = new JSONArray().put(checkpoint("page", "read_web_page", input, observed)).toString();
        JSONArray requested = new JSONArray(); for (int i = 0; i < 9; i++) requested.put(call("web-" + i, "read_web_page", input.toString()));
        run((round, body) -> round == 0 ? tools(requested) : answer("Web synthesis."), previous, "");
        assertEquals(8, (int) ReflectionHelpers.getField(lastCall, "webCalls")); assertTrue(listener.done);
        JSONArray history = sent.get(1).getJSONArray("messages");
        JSONObject finalResult = new JSONObject(history.getJSONObject(history.length() - 1).getString("content"));
        assertEquals("retrieval_limit", finalResult.getString("error")); assertEquals("none", sent.get(1).getString("tool_choice"));
    }

    @Test public void cumulativeToolDataStopsAtFortyEightThousandWithCompletedCheckpoints() throws Exception {
        planner.save(note, "note", "Large fixture note\n" + "x".repeat(7800));
        JSONArray requested = new JSONArray(); for (int i = 0; i < 10; i++) requested.put(call("large-" + i, "read_note", "{\"id\":" + note + "}"));
        run((round, body) -> round == 0 ? tools(requested) : answer("Partial source synthesis."), "[]", "");
        int data = ReflectionHelpers.getField(lastCall, "toolData"); assertTrue(data <= 48000); assertTrue(data > 30000);
        assertEquals("none", sent.get(1).getString("tool_choice")); assertTrue(listener.done);
        JSONArray rows = ChatActivity.read(listener.activity); assertEquals(10, completed(listener.activity, true));
        for (int i = 0; i < rows.length(); i++) assertTrue(rows.getJSONObject(i).getString("result").length() <= 8000);
    }

    @Test public void cachedReadChecksPermissionsAgainBeforeReusingItsResult() throws Exception {
        run((round, body) -> {
            if (round == 0) return tools(call("first", "read_note", "{\"id\":" + note + "}"));
            if (round == 1) { PocketChatTools.enabled(context, PocketChatTools.NOTES, false); return tools(call("second", "read_note", "{\"id\":" + note + "}")); }
            return answer("Access changed.");
        }, "[]", "");
        JSONArray history = sent.get(2).getJSONArray("messages");
        assertEquals("access_disabled", new JSONObject(history.getJSONObject(history.length() - 1).getString("content")).getString("error"));
        assertTrue(listener.done);
    }

    @Test public void serverSearchCheckpointKeepsReadableSourcesAndOmitsOpaqueContinuationData() throws Exception {
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, config, "fixture", List.of(new ClaudeChatClient.Message("user", "Question")), 10000, listener);
        JSONObject block = new JSONObject().put("content", new JSONArray().put(new JSONObject().put("url", "https://fixture.invalid/source")
                .put("title", "Fixture source").put("encrypted_content", "opaque".repeat(3000))));
        String result = ReflectionHelpers.callInstanceMethod(call, "boundedServerObservation", ReflectionHelpers.ClassParameter.from(JSONObject.class, block));
        assertTrue(result.length() <= 8000); assertTrue(result.contains("Fixture source")); assertFalse(result.contains("encrypted_content"));
        assertEquals(config.identity, new JSONObject(result).getString("request_identity"));
        com.anthropic.core.Timeout timeout = ReflectionHelpers.getStaticField(ClaudeChatClient.class, "TIMEOUT");
        assertEquals(java.time.Duration.ofSeconds(90), timeout.read()); assertEquals(java.time.Duration.ofMinutes(5), timeout.request());
    }

    @Test public void absoluteAndIdleDeadlineChecksKeepUserCancellationSeparate() throws Exception {
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, config, "fixture", List.of(new ClaudeChatClient.Message("user", "Question")), 10000, listener);
        long now = System.nanoTime(); ReflectionHelpers.setField(call, "startedNanos", now - TimeUnit.MINUTES.toNanos(6));
        ReflectionHelpers.setField(call, "lastProgressNanos", now); ReflectionHelpers.callInstanceMethod(call, "checkDeadline");
        String reason = ReflectionHelpers.getField(call, "timeoutReason"); assertTrue(reason.contains("five-minute")); assertFalse(call.cancelled());
        ClaudeChatClient.Call idle = new ClaudeChatClient.Call(context, config, "fixture", List.of(new ClaudeChatClient.Message("user", "Question")), 10000, listener);
        ReflectionHelpers.setField(idle, "startedNanos", now); ReflectionHelpers.setField(idle, "lastProgressNanos", now - TimeUnit.SECONDS.toNanos(100));
        ReflectionHelpers.callInstanceMethod(idle, "checkDeadline"); String idleReason = ReflectionHelpers.getField(idle, "timeoutReason"); assertTrue(idleReason.contains("90 seconds"));
    }

    private ClaudeChatClient.Call lastCall;
    private void run(BiFunction<Integer, JSONObject, String> script, String previous, String partial) throws Exception {
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, config, "fixture", List.of(new ClaudeChatClient.Message("user", "Research the fixture")),
                50000, listener, previous, partial, () -> new OkHttpClient.Builder().addInterceptor(chain -> {
                    Buffer buffer = new Buffer(); chain.request().body().writeTo(buffer);
                    JSONObject body; try { body = new JSONObject(buffer.readUtf8()); } catch (Exception bad) { throw new AssertionError(bad); }
                    int round = sent.size(); sent.add(body); String data = script.apply(round, body);
                    return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                            .header("Content-Type", "text/event-stream").body(ResponseBody.create(data, MediaType.parse("text/event-stream"))).build();
                }).build());
        lastCall = call;
        Method method = call.getClass().getDeclaredMethod("runCompatible", String.class); method.setAccessible(true);
        try { method.invoke(call, "test-only-key"); } finally { call.cancel(); Thread.interrupted(); }
    }

    private JSONObject checkpoint(String id, String name, JSONObject input, String result) throws Exception {
        String stamped = new JSONObject(result).put("request_identity", config.identity).put("access_fingerprint", PocketChatTools.accessFingerprint(context)).toString();
        return new JSONObject().put("id", id).put("name", name).put("state", "done").put("input", input.toString()).put("result", stamped);
    }
    private static int completed(String raw, boolean failures) {
        int count = 0; JSONArray rows = ChatActivity.read(raw);
        for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i);
            if (("done".equals(row.optString("state")) || failures && "failed".equals(row.optString("state"))) && !row.optString("result").isEmpty()) count++;
        }
        return count;
    }
    private static JSONObject call(String id, String name, String args) {
        try { return new JSONObject().put("index", 0).put("id", id).put("type", "function")
                .put("function", new JSONObject().put("name", name).put("arguments", args)); }
        catch (Exception impossible) { throw new AssertionError(impossible); }
    }
    private static String tools(JSONObject call) { return tools(new JSONArray().put(call)); }
    private static String tools(JSONArray calls) {
        try {
            for (int i = 0; i < calls.length(); i++) calls.getJSONObject(i).put("index", i);
            return "data: " + new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("index", 0)
                    .put("delta", new JSONObject().put("tool_calls", calls)).put("finish_reason", "tool_calls"))) + "\n\ndata: [DONE]\n\n";
        } catch (Exception impossible) { throw new AssertionError(impossible); }
    }
    private static String answer(String text) {
        try { return "data: " + new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("index", 0)
                .put("delta", new JSONObject().put("content", text)).put("finish_reason", "stop"))) + "\n\ndata: [DONE]\n\n"; }
        catch (Exception impossible) { throw new AssertionError(impossible); }
    }
    private static class Recording implements ClaudeChatClient.Listener {
        String activity = "[]"; boolean done;
        public boolean text(String value) { return true; }
        public synchronized void activity(String value) {
            JSONArray rows = ChatActivity.read(value);
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (("done".equals(row.optString("state")) || "failed".equals(row.optString("state")))
                        && !"propose_action".equals(row.optString("name"))) assertFalse("A completed native tool must checkpoint its result atomically", row.optString("result").isEmpty());
            }
            activity = value;
        }
        public void done(String model, ClaudeChatClient.Usage usage) { done = true; }
        public void failed(String reason) { fail(reason); }
    }
}
