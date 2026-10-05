package org.textphone.launcher;

import android.content.Context;
import com.anthropic.backends.AnthropicBackend;
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.AnthropicClientImpl;
import com.anthropic.client.okhttp.OkHttpClient;
import com.anthropic.core.ClientOptions;
import com.anthropic.core.LogLevel;
import com.anthropic.core.RequestOptions;
import com.anthropic.core.http.HttpClient;
import com.anthropic.core.http.HttpRequest;
import com.anthropic.core.http.HttpResponse;
import com.anthropic.core.http.StreamResponse;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.models.ErrorType;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.RawMessageStreamEvent;
import com.anthropic.models.messages.StopReason;
import java.io.BufferedReader;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Text-only API streaming. No tools, Pocket data, credential discovery or automatic retries. */
final class ClaudeChatClient {
    private static final Duration TIMEOUT = Duration.ofSeconds(90);
    private static final ExecutorService CLOSER = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "Pocket Claude close");
        thread.setDaemon(true);
        return thread;
    });

    static final class Message {
        final String role, text;
        Message(String role, String text) { this.role = role; this.text = text; }
    }

    static final class Usage {
        static final Usage EMPTY = new Usage(0, 0, 0, 0);
        final long inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens;
        Usage(long inputTokens, long outputTokens, long cacheReadTokens, long cacheWriteTokens) {
            this.inputTokens = inputTokens;
            this.outputTokens = outputTokens;
            this.cacheReadTokens = cacheReadTokens;
            this.cacheWriteTokens = cacheWriteTokens;
        }
    }

    interface Listener {
        boolean text(String delta);
        void done(String model, Usage usage);
        void failed(String reason);
    }

    static final class Call implements Runnable {
        private final Context context;
        private final ChatProvider.Config config;
        private final String conversation;
        private final List<Message> messages;
        private final int outputLimit;
        private final Listener listener;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final Object resources = new Object();
        private volatile CancelableTransport transport;
        private volatile okhttp3.Call compatibleCall;
        private volatile Thread worker;
        private int characters;

        Call(Context context, ChatProvider.Config config, String conversation,
                List<Message> messages, int outputLimit, Listener listener) {
            this.context = context.getApplicationContext();
            this.config = config;
            this.conversation = conversation;
            this.messages = Collections.unmodifiableList(new ArrayList<>(messages));
            this.outputLimit = outputLimit;
            this.listener = listener;
        }

        boolean cancelled() { return cancelled.get(); }

        void cancel() {
            if (!cancelled.compareAndSet(false, true)) return;
            Thread thread = worker;
            if (thread != null) thread.interrupt();
            CancelableTransport current = transport;
            if (current != null) current.cancel();
            okhttp3.Call other = compatibleCall;
            if (other != null) other.cancel();
        }

        @Override public void run() {
            if (cancelled()) return;
            worker = Thread.currentThread();
            AnthropicClient client = null;
            try {
                if (cancelled()) return;
                // Read a fresh key for every explicit Send/Retry; changing Settings takes effect immediately.
                String key = ChatProvider.key(context, config);
                if (key == null || key.isEmpty())
                    throw new SafeFailure("Add an API key for this provider to start chatting.");
                for (int index = 0; index < key.length(); index++)
                    if (key.charAt(index) <= 32 || key.charAt(index) >= 127)
                        throw new SafeFailure("Check the API key in Chat settings.");
                if ("compatible".equals(config.provider)) {
                    runCompatible(key);
                    return;
                }
                AnthropicBackend backend = AnthropicBackend.builder().apiKey(key).build();
                CancelableTransport next = new CancelableTransport(OkHttpClient.builder()
                        .backend(backend).timeout(TIMEOUT).build());
                synchronized (resources) {
                    transport = next;
                    if (cancelled()) { next.cancel(); return; }
                }
                // The SDK's ordinary close() does not cancel calls waiting for HTTP headers.
                // This wrapper tracks the raw transport future, whose cancellation cancels the OkHttp call.
                ClientOptions.Builder options = ClientOptions.builder().httpClient(next)
                        .timeout(TIMEOUT).maxRetries(0).logLevel(LogLevel.OFF);
                backend.applyCredentials(next, options);
                client = new AnthropicClientImpl(options.build());
                MessageCreateParams.Builder params = MessageCreateParams.builder()
                        .model(config.model).maxTokens(config.maxTokens);
                if (ClaudeChatRepository.MODEL.equals(config.model))
                    params.outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.LOW).build());
                // Automatic caching moves the prefix breakpoint as this conversation grows (default TTL: five minutes).
                if (config.promptCaching) params.cacheControl(CacheControlEphemeral.builder().build());
                for (Message message : messages) {
                    if ("user".equals(message.role)) params.addUserMessage(message.text);
                    else params.addAssistantMessage(message.text);
                }
                if (cancelled()) return;
                boolean started = false, stopped = false;
                String model = config.model;
                StopReason stop = null;
                UsageCounter usage = new UsageCounter();
                try (StreamResponse<RawMessageStreamEvent> response = client.messages().createStreaming(params.build())) {
                    Iterator<RawMessageStreamEvent> events = response.stream().iterator();
                    while (!cancelled() && events.hasNext()) {
                        RawMessageStreamEvent event = events.next();
                        if (cancelled()) return;
                        if (event.isMessageStart()) {
                            if (started) throw new SafeFailure("Claude's reply could not be completed. Retry.");
                            started = true;
                            String actual = event.asMessageStart().message().model().asString();
                            if (safeModel(actual)) model = actual;
                            usage.anthropicStart(event.asMessageStart().message().usage());
                            event.asMessageStart().message().content().forEach(block ->
                                    block.text().ifPresent(text -> append(text.text())));
                        } else if (event.isContentBlockStart()) {
                            event.asContentBlockStart().contentBlock().text().ifPresent(text -> append(text.text()));
                        } else if (event.isContentBlockDelta()) {
                            event.asContentBlockDelta().delta().text().ifPresent(text -> append(text.text()));
                        } else if (event.isMessageDelta()) {
                            usage.anthropicDelta(event.asMessageDelta().usage());
                            StopReason reason = event.asMessageDelta().delta().stopReason().orElse(null);
                            if (reason != null) stop = reason;
                        } else if (event.isMessageStop()) {
                            stopped = true;
                            break;
                        }
                    }
                }
                if (cancelled()) return;
                if (!started || !stopped || stop == null)
                    throw new SafeFailure("The connection ended before Claude finished. Retry.");
                if (StopReason.MAX_TOKENS.equals(stop))
                    throw new SafeFailure("Claude reached the reply limit. Try a shorter question.");
                if (StopReason.REFUSAL.equals(stop))
                    throw new SafeFailure("Claude could not answer this request. Try rephrasing it.");
                if (!(StopReason.END_TURN.equals(stop) || StopReason.STOP_SEQUENCE.equals(stop)))
                    throw new SafeFailure("Claude's reply could not be completed. Retry.");
                if (characters == 0) throw new SafeFailure("Claude returned an empty reply. Retry.");
                listener.done(model, usage.anthropic());
            } catch (SafeFailure failure) {
                if (!cancelled()) listener.failed(failure.getMessage());
            } catch (AnthropicServiceException failure) {
                if (!cancelled()) listener.failed(serviceReason(failure));
            } catch (AnthropicIoException | CancellationException failure) {
                if (!cancelled()) listener.failed("Could not connect to the provider. Check your internet connection, then retry.");
            } catch (IOException failure) {
                if (!cancelled()) listener.failed("Could not connect to the provider. Check your internet connection, then retry.");
            } catch (JSONException failure) {
                if (!cancelled()) listener.failed("The provider's reply could not be completed. Retry.");
            } catch (RuntimeException failure) {
                if (!cancelled()) listener.failed("The provider's reply could not be completed. Retry.");
            } finally {
                if (client != null) {
                    try { client.close(); } catch (RuntimeException ignored) { }
                }
                CancelableTransport current;
                synchronized (resources) { current = transport; transport = null; }
                if (current != null) current.close();
                compatibleCall = null;
                worker = null;
            }
        }

        private void runCompatible(String key) throws IOException, JSONException {
            okhttp3.HttpUrl endpoint = okhttp3.HttpUrl.parse(config.baseUrl + "/chat/completions");
            if (endpoint == null || !"https".equals(endpoint.scheme()))
                throw new SafeFailure("Enter the provider's HTTPS API base URL in Chat settings.");
            boolean openai = "api.openai.com".equals(endpoint.host());
            JSONArray history = new JSONArray();
            for (Message message : messages)
                history.put(new JSONObject().put("role", message.role).put("content", message.text));
            JSONObject body = new JSONObject().put("model", config.model).put("stream", true)
                    .put("messages", history).put(openai ? "max_completion_tokens" : "max_tokens", config.maxTokens);
            if (openai) body.put("stream_options", new JSONObject().put("include_usage", true));
            okhttp3.Request.Builder request = new okhttp3.Request.Builder().url(endpoint)
                    .header("Authorization", "Bearer " + key).header("Accept", "text/event-stream")
                    .header("User-Agent", "Pocket/0.5.16")
                    .post(okhttp3.RequestBody.create(body.toString(), okhttp3.MediaType.parse("application/json; charset=utf-8")));
            if ("opencode.ai".equals(endpoint.host())) request.header("x-opencode-session", conversation);
            okhttp3.OkHttpClient http = new okhttp3.OkHttpClient.Builder()
                    .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
                    .connectTimeout(15, TimeUnit.SECONDS).readTimeout(90, TimeUnit.SECONDS)
                    .writeTimeout(30, TimeUnit.SECONDS).callTimeout(5, TimeUnit.MINUTES).build();
            okhttp3.Call call = http.newCall(request.build());
            compatibleCall = call;
            try {
                if (cancelled()) { call.cancel(); return; }
                try (okhttp3.Response response = call.execute()) {
                    if (response.code() != 200) throw new SafeFailure(compatibleReason(response.code()));
                    String type = response.header("Content-Type", "").split(";", 2)[0].trim();
                    if (!"text/event-stream".equalsIgnoreCase(type) || response.body() == null)
                        throw new SafeFailure("This endpoint did not return a streamed chat reply. Check its API base URL.");
                    CompatibleStream stream = new CompatibleStream();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                            new BoundedStream(response.body().byteStream()), StandardCharsets.UTF_8.newDecoder()
                                    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)))) {
                        StringBuilder data = new StringBuilder();
                        String line;
                        int lines = 0;
                        while (!cancelled() && (line = readLine(reader)) != null) {
                            if (++lines > 200_000) throw new SafeFailure("The provider's reply could not be completed. Retry.");
                            if (lines == 1 && line.startsWith("\uFEFF")) line = line.substring(1);
                            if (line.isEmpty()) {
                                if (data.length() > 0 && stream.accept(data.toString())) break;
                                data.setLength(0);
                            } else if (line.startsWith("data:")) {
                                String part = line.substring(5);
                                if (part.startsWith(" ")) part = part.substring(1);
                                if (data.length() + part.length() + 1 > 524_288)
                                    throw new SafeFailure("The provider's reply could not be completed. Retry.");
                                if (data.length() > 0) data.append('\n');
                                data.append(part);
                            }
                            // Comments and other SSE metadata are deliberately ignored.
                        }
                        if (!cancelled() && !stream.done && data.length() > 0) stream.accept(data.toString());
                    }
                    if (cancelled()) return;
                    if ("length".equals(stream.finish))
                        throw new SafeFailure("The reply reached the length limit. Try a shorter question.");
                    if ("content_filter".equals(stream.finish) || stream.refusal)
                        throw new SafeFailure("The provider could not answer this request. Try rephrasing it.");
                    if (!stream.done || !"stop".equals(stream.finish))
                        throw new SafeFailure("The connection ended before the provider finished. Retry.");
                    if (characters == 0) throw new SafeFailure("The provider returned an empty reply. Retry.");
                    listener.done(stream.model, stream.usage.compatible());
                }
            } finally {
                compatibleCall = null;
                http.dispatcher().executorService().shutdown();
                http.connectionPool().evictAll();
            }
        }

        private final class CompatibleStream {
            private final UsageCounter usage = new UsageCounter();
            private String model = config.model, finish = "";
            private boolean done, refusal;

            boolean accept(String payload) throws JSONException {
                if ("[DONE]".equals(payload.trim())) { done = true; return true; }
                JSONObject chunk = new JSONObject(payload);
                if (chunk.has("error")) {
                    JSONObject error = chunk.optJSONObject("error");
                    String code = error == null ? "" : error.optString("code", "");
                    if ("invalid_api_key".equals(code) || "authentication_error".equals(code))
                        throw new SafeFailure(compatibleReason(401));
                    if ("insufficient_quota".equals(code) || "billing_error".equals(code))
                        throw new SafeFailure(compatibleReason(402));
                    if ("rate_limit_exceeded".equals(code)) throw new SafeFailure(compatibleReason(429));
                    throw new SafeFailure("The provider could not complete this request. Check API credit and limits, then retry.");
                }
                String actual = chunk.optString("model", "");
                if (safeModel(actual)) model = actual;
                JSONObject tokens = chunk.optJSONObject("usage");
                if (tokens != null) usage.compatible(tokens);
                JSONArray choices = chunk.optJSONArray("choices");
                if (choices == null) throw new SafeFailure("The provider's reply could not be completed. Retry.");
                // The usage-only event has an empty choices array and must be consumed before [DONE].
                for (int index = 0; index < choices.length(); index++) {
                    JSONObject choice = choices.getJSONObject(index);
                    if (choice.optInt("index", 0) != 0) continue;
                    JSONObject delta = choice.optJSONObject("delta");
                    if (delta != null) {
                        Object content = delta.opt("content");
                        if (content instanceof String && !((String) content).isEmpty()) {
                            if (!finish.isEmpty()) throw new SafeFailure("The provider's reply could not be completed. Retry.");
                            append((String) content);
                        } else if (content != null && content != JSONObject.NULL && !(content instanceof String)) {
                            throw new SafeFailure("The provider's reply could not be completed. Retry.");
                        }
                        if (!delta.optString("refusal", "").isEmpty()) refusal = true;
                    }
                    if (!choice.isNull("finish_reason") && choice.has("finish_reason")) {
                        String reason = choice.getString("finish_reason");
                        if (!finish.isEmpty() && !finish.equals(reason))
                            throw new SafeFailure("The provider's reply could not be completed. Retry.");
                        finish = reason;
                    }
                }
                return false;
            }
        }

        private void append(String delta) {
            if (delta.isEmpty()) return;
            if (cancelled()) throw new CancellationException();
            if (delta.length() > outputLimit - characters) {
                String reason = outputLimit < ClaudeChatRepository.MAX_OUTPUT_CHARS
                        ? "This chat is full. Clear the conversation to start a new chat."
                        : "The reply reached the length limit. Try a shorter question.";
                throw new SafeFailure(reason);
            }
            if (!listener.text(delta)) { cancel(); throw new CancellationException(); }
            characters += delta.length();
        }
    }

    static boolean safeModel(String model) {
        return model != null && model.length() <= 120 && model.matches("[A-Za-z0-9][A-Za-z0-9._/:@-]*");
    }

    private static String compatibleReason(int status) {
        if (status == 401 || status == 403) return "The provider rejected the API key. Check this endpoint's key and access in Chat settings.";
        if (status == 402) return "Check this provider's API credit and billing, then retry.";
        if (status == 429) return "The provider is busy or your API usage limit was reached. Try again later.";
        if (status == 408 || status == 504) return "The provider took too long to answer. Retry when you are ready.";
        if (status >= 500) return "The provider is temporarily unavailable. Try again later.";
        if (status >= 300 && status < 400) return "The endpoint redirected this request. Check its API base URL.";
        if (status == 413) return "This conversation is too large. Clear it and start a new chat.";
        if (status == 404) return "The model or endpoint is unavailable. Check the API base URL and model ID.";
        if (status == 400 || status == 422) return "The provider could not accept this request. Check its model, API settings and billing.";
        return "The provider could not answer this request. Retry when you are ready.";
    }

    private static final class UsageCounter {
        private long input, output, cacheRead, cacheWrite;

        void anthropicStart(com.anthropic.models.messages.Usage tokens) {
            input = tokens.inputTokens();
            output = tokens.outputTokens();
            cacheRead = tokens.cacheReadInputTokens().orElse(0L);
            cacheWrite = tokens.cacheCreationInputTokens().orElse(0L);
        }

        void anthropicDelta(com.anthropic.models.messages.MessageDeltaUsage tokens) {
            input = tokens.inputTokens().orElse(input);
            output = tokens.outputTokens();
            cacheRead = tokens.cacheReadInputTokens().orElse(cacheRead);
            cacheWrite = tokens.cacheCreationInputTokens().orElse(cacheWrite);
        }

        Usage anthropic() { return new Usage(input + cacheRead + cacheWrite, output, cacheRead, cacheWrite); }
        Usage compatible() { return new Usage(input, output, cacheRead, cacheWrite); }

        void compatible(JSONObject tokens) {
            input = token(tokens, "prompt_tokens", input);
            output = token(tokens, "completion_tokens", output);
            JSONObject details = tokens.optJSONObject("prompt_tokens_details");
            cacheRead = token(details, "cached_tokens", token(tokens, "prompt_cache_hit_tokens", cacheRead));
            cacheWrite = token(details, "cache_write_tokens", token(tokens, "cache_write_tokens", cacheWrite));
        }

        private static long token(JSONObject values, String name, long previous) {
            if (values == null) return previous;
            long value = values.optLong(name, -1);
            return value >= 0 && value <= 1_000_000_000L ? value : previous;
        }
    }

    /** Bound wire data and individual SSE events independently of the retained answer limit. */
    private static final class BoundedStream extends FilterInputStream {
        private long count;
        BoundedStream(InputStream input) { super(input); }
        @Override public int read() throws IOException {
            int value = in.read();
            if (value != -1) used(1);
            return value;
        }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            int read = in.read(buffer, offset, length);
            if (read > 0) used(read);
            return read;
        }
        private void used(int bytes) {
            count += bytes;
            if (count > 4_000_000) throw new SafeFailure("The provider's reply could not be completed. Retry.");
        }
    }

    private static String readLine(BufferedReader reader) throws IOException {
        StringBuilder line = new StringBuilder();
        int value;
        while ((value = reader.read()) != -1) {
            if (value == '\n') return line.toString();
            if (value == '\r') {
                reader.mark(1);
                if (reader.read() != '\n') reader.reset();
                return line.toString();
            }
            if (line.length() >= 524_288) throw new SafeFailure("The provider's reply could not be completed. Retry.");
            line.append((char) value);
        }
        return line.length() == 0 ? null : line.toString();
    }

    private static String serviceReason(AnthropicServiceException failure) {
        int status = failure.statusCode();
        ErrorType type = null;
        try { type = failure.errorType().orElse(null); } catch (RuntimeException malformed) { }
        if (status == 401 || status == 403 || ErrorType.AUTHENTICATION_ERROR.equals(type)
                || ErrorType.PERMISSION_ERROR.equals(type))
            return "Claude rejected the API key. Check the key and its access in Chat settings.";
        if (status == 402 || ErrorType.BILLING_ERROR.equals(type))
            return "Check your Claude API credit and billing, then retry.";
        if (status == 429 || ErrorType.RATE_LIMIT_ERROR.equals(type))
            return "The Claude API is busy or your usage limit was reached. Try again later.";
        if (status == 408 || status == 504 || ErrorType.TIMEOUT_ERROR.equals(type))
            return "Claude took too long to answer. Retry when you are ready.";
        if (status >= 500 || ErrorType.OVERLOADED_ERROR.equals(type))
            return "Claude is temporarily unavailable. Try again later.";
        if (status == 413) return "This conversation is too large. Clear it and start a new chat.";
        if (status == 404) return "This Claude model is unavailable for your API key. Check the key's access.";
        if (status == 400) return "Claude could not accept this request. Check API billing and limits, then retry.";
        return "Claude could not answer this request. Retry when you are ready.";
    }

    private static final class SafeFailure extends RuntimeException {
        SafeFailure(String reason) { super(reason); }
    }

    /** Track calls before headers and their bodies afterward, so Stop closes either phase promptly. */
    private static final class CancelableTransport implements HttpClient {
        private final HttpClient delegate;
        private final Set<HttpResponse> responses = new HashSet<>();
        private CompletableFuture<HttpResponse> pending;
        private boolean closed;

        CancelableTransport(HttpClient delegate) { this.delegate = delegate; }

        @Override public HttpResponse execute(HttpRequest request, RequestOptions options) {
            CompletableFuture<HttpResponse> future = executeAsync(request, options);
            try {
                return future.get();
            } catch (InterruptedException interrupted) {
                future.cancel(true);
                Thread.currentThread().interrupt();
                throw new AnthropicIoException("The connection did not finish.", interrupted);
            } catch (ExecutionException failure) {
                Throwable cause = failure.getCause();
                if (cause instanceof RuntimeException) throw (RuntimeException) cause;
                throw new AnthropicIoException("The connection did not finish.", cause);
            }
        }

        @Override public CompletableFuture<HttpResponse> executeAsync(HttpRequest request, RequestOptions options) {
            CompletableFuture<HttpResponse> future;
            synchronized (this) { if (closed) throw new CancellationException(); }
            // Request encoding/enqueueing belongs to the worker, outside the cancellation lock.
            future = delegate.executeAsync(request, options);
            boolean cancelled;
            synchronized (this) {
                cancelled = closed;
                if (!cancelled) pending = future;
            }
            future.whenComplete((response, failure) -> {
                boolean discard;
                synchronized (CancelableTransport.this) {
                    if (pending == future) pending = null;
                    discard = closed;
                    if (!discard && response != null) responses.add(response);
                }
                if (discard && response != null) closeResponse(response);
            });
            if (cancelled) future.cancel(true);
            return future;
        }

        void cancel() { release(true); }
        @Override public void close() { release(false); }

        private void release(boolean background) {
            CompletableFuture<HttpResponse> future;
            List<HttpResponse> bodies;
            synchronized (this) {
                if (closed) return;
                closed = true;
                future = pending;
                pending = null;
                bodies = new ArrayList<>(responses);
                responses.clear();
            }
            // The raw SDK transport attaches a cancellation hook that calls OkHttp Call.cancel().
            if (future != null) future.cancel(true);
            Runnable cleanup = () -> {
                for (HttpResponse response : bodies) closeResponse(response);
                try { delegate.close(); } catch (RuntimeException ignored) { }
            };
            if (background) CLOSER.execute(cleanup); else cleanup.run();
        }

        private static void closeResponse(HttpResponse response) {
            try { response.close(); } catch (RuntimeException ignored) { }
        }
    }

    private ClaudeChatClient() { }
}
