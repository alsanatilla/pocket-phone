package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.AnthropicClientImpl;
import com.anthropic.core.ClientOptions;
import com.anthropic.core.RequestOptions;
import com.anthropic.core.http.Headers;
import com.anthropic.core.http.HttpClient;
import com.anthropic.core.http.HttpRequest;
import com.anthropic.core.http.HttpResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Exercise the actual SSE adapters and SDK accumulator with local fake HTTP responses. No keys or network. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class PipStreamingTest {
    private Context context;
    @Before public void setup() { context = RuntimeEnvironment.getApplication(); PocketChatTools.enabled(context, PocketChatTools.NOTES, true); }

    @Test public void anthropicThinkingAndToolRemarksStayOutOfTheAnswerAndSignaturesContinue() throws Exception {
        Capture capture = new Capture(); ChatProvider.Config config = ChatProvider.defaults("anthropic");
        List<JSONObject> bodies = new ArrayList<>();
        String first = anthropicStart("first")
                + event("content_block_start", "{\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"\"}}")
                + event("content_block_delta", "{\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Find the relevant note.\"}}")
                + event("content_block_delta", "{\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"opaque-signature\"}}")
                + event("content_block_stop", "{\"index\":0}")
                + anthropicText(1, "I'll look in your notes.")
                + event("content_block_start", "{\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"read_1\",\"name\":\"search_notes\",\"input\":{}}}")
                + event("content_block_delta", "{\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"query\\\":\\\"run\\\"}\"}}")
                + event("content_block_stop", "{\"index\":2}") + anthropicEnd("tool_use");
        String second = anthropicStart("second") + anthropicText(0, "No running notes were found.") + anthropicEnd("end_turn");
        HttpClient http = new HttpClient() {
            public HttpResponse execute(HttpRequest request, RequestOptions options) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); request.body().writeTo(bytes);
                try { bodies.add(new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8))); }
                catch (Exception invalid) { throw new AssertionError(invalid); }
                String sse = bodies.size() == 1 ? first : second;
                return new HttpResponse() {
                    public int statusCode() { return 200; }
                    public Headers headers() { return Headers.builder().put("content-type", "text/event-stream").build(); }
                    public InputStream body() { return new ByteArrayInputStream(sse.getBytes(StandardCharsets.UTF_8)); }
                    public void close() { }
                };
            }
            public CompletableFuture<HttpResponse> executeAsync(HttpRequest request, RequestOptions options) { return CompletableFuture.completedFuture(execute(request, options)); }
            public void close() { }
        };
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, config, "chat-one",
                List.of(new ClaudeChatClient.Message("user", "Find my running notes")), 64_000, capture);
        AnthropicClient client = new AnthropicClientImpl(ClientOptions.builder().httpClient(http)
                .baseUrl("https://api.anthropic.com").maxRetries(0).build());
        try {
            invoke(call, "runAnthropic", AnthropicClient.class, client);
        } finally { client.close(); }
        assertTrue(capture.complete); assertEquals("No running notes were found.", capture.answer.toString());
        assertTrue(capture.trail.toString().contains("Find the relevant note.")); assertEquals(1, capture.interims);
        assertTrue(capture.order.indexOf("interim") < capture.order.indexOf("step")); assertEquals(2, bodies.size());
        assertEquals("ephemeral", bodies.get(0).getJSONObject("cache_control").getString("type"));
        assertEquals("summarized", bodies.get(0).getJSONObject("thinking").getString("display"));
        JSONArray continuation = bodies.get(1).getJSONArray("messages").getJSONObject(1).getJSONArray("content");
        assertEquals("opaque-signature", continuation.getJSONObject(0).getString("signature"));
        assertEquals("I'll look in your notes.", continuation.getJSONObject(1).getString("text"));
        assertTrue(bodies.get(0).get("system").toString().contains("You are pip"));
    }

    @Test public void compatibleReasoningDoesNotDuplicateAndToolFollowupRetainsItsProtocol() throws Exception {
        Capture capture = new Capture(); List<JSONObject> bodies = new ArrayList<>();
        ChatProvider.Config config = new ChatProvider.Config("compatible", "test-model", "https://example.invalid/v1", 2048, true);
        String first = compatible(new JSONObject().put("reasoning_content", "Find a note.").put("reasoning", "Find a note."), null)
                + compatible(new JSONObject().put("content", "I'll check."), null)
                + compatible(new JSONObject().put("tool_calls", new JSONArray().put(new JSONObject().put("index", 0)
                        .put("id", "tool_1").put("type", "function").put("function", new JSONObject().put("name", "search_notes").put("arguments", "{\"query\":\"run\"}")))), "tool_calls")
                + "data: [DONE]\n\n";
        String second = compatible(new JSONObject().put("reasoning_content", "Now answer."), null)
                + compatible(new JSONObject().put("content", "No notes matched."), "stop") + "data: [DONE]\n\n";
        ClaudeChatClient.Call call = new ClaudeChatClient.Call(context, config, "chat-two",
                List.of(new ClaudeChatClient.Message("user", "Find running notes")), 64_000, capture,
                () -> new okhttp3.OkHttpClient.Builder().addInterceptor(chain -> {
                    okio.Buffer body = new okio.Buffer(); chain.request().body().writeTo(body);
                    try { bodies.add(new JSONObject(body.readUtf8())); } catch (Exception invalid) { throw new AssertionError(invalid); }
                    return new okhttp3.Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                            .header("Content-Type", "text/event-stream").body(okhttp3.ResponseBody.create(
                                    bodies.size() == 1 ? first : second, okhttp3.MediaType.parse("text/event-stream"))).build();
                }).build());
        invoke(call, "runCompatible", String.class, "local-fake-key");
        assertTrue(capture.complete); assertEquals("No notes matched.", capture.answer.toString());
        assertEquals(1, capture.trail.toString().split("Find a note\\.", -1).length - 1);
        assertTrue(capture.trail.toString().contains("Now answer.")); assertEquals(1, capture.interims);
        assertTrue(capture.order.indexOf("interim") < capture.order.indexOf("step"));
        JSONObject continued = bodies.get(1).getJSONArray("messages").getJSONObject(2);
        assertEquals("I'll check.", continued.getString("content")); assertEquals("Find a note.", continued.getString("reasoning_content"));
        assertEquals("tool_1", continued.getJSONArray("tool_calls").getJSONObject(0).getString("id"));
        assertEquals("tool", bodies.get(1).getJSONArray("messages").getJSONObject(3).getString("role"));
        assertTrue(bodies.get(0).getJSONArray("messages").getJSONObject(0).getString("content").contains("You are pip"));
    }

    @Test public void thinkingConfigurationOnlyTargetsSupportedModels() {
        assertTrue(ClaudeChatClient.adaptiveThinking("claude-sonnet-5-5")); assertTrue(ClaudeChatClient.adaptiveThinking("claude-opus-4-6"));
        assertTrue(ClaudeChatClient.adaptiveThinking("claude-mythos-preview")); assertFalse(ClaudeChatClient.adaptiveThinking("claude-haiku-4-5"));
        assertFalse(ClaudeChatClient.adaptiveThinking("claude-sonnet-4-5")); assertFalse(ClaudeChatClient.adaptiveThinking("claude-sonnet-4-7"));
    }
    private static void invoke(ClaudeChatClient.Call call, String name, Class<?> type, Object argument) throws Exception {
        Method method = ClaudeChatClient.Call.class.getDeclaredMethod(name, type); method.setAccessible(true); method.invoke(call, argument);
    }
    private static String event(String type, String json) throws Exception {
        return "event: " + type + "\ndata: " + new JSONObject(json).put("type", type) + "\n\n";
    }
    private static String anthropicStart(String id) throws Exception {
        return event("message_start", "{\"message\":{\"id\":\"" + id + "\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-5-5\",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,\"usage\":{\"input_tokens\":100,\"output_tokens\":0}}}");
    }
    private static String anthropicText(int index, String text) throws Exception {
        return event("content_block_start", "{\"index\":" + index + ",\"content_block\":{\"type\":\"text\",\"text\":\"\"}}")
                + event("content_block_delta", new JSONObject().put("index", index).put("delta", new JSONObject().put("type", "text_delta").put("text", text)).toString())
                + event("content_block_stop", "{\"index\":" + index + "}");
    }
    private static String anthropicEnd(String reason) throws Exception {
        return event("message_delta", "{\"delta\":{\"stop_reason\":\"" + reason + "\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":30}}") + event("message_stop", "{}");
    }
    private static String compatible(JSONObject delta, String finish) throws Exception {
        return "data: " + new JSONObject().put("model", "test-model").put("choices", new JSONArray().put(new JSONObject().put("index", 0)
                .put("delta", delta).put("finish_reason", finish == null ? JSONObject.NULL : finish))) + "\n\n";
    }
    private static final class Capture implements ClaudeChatClient.Listener {
        final StringBuilder answer = new StringBuilder(), trail = new StringBuilder(); final List<String> order = new ArrayList<>();
        boolean complete; int interims;
        public boolean text(String delta) { answer.append(delta); return true; }
        public void reasoning(String delta) { trail.append(delta); }
        public void interim() { interims++; order.add("interim"); answer.setLength(0); }
        public void step(String label) { order.add("step"); trail.append("\n").append(label).append("\n"); }
        public void done(String model, ClaudeChatClient.Usage usage) { complete = true; }
        public void failed(String reason) { fail(reason); }
    }
}
