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
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.RawMessageStreamEvent;
import com.anthropic.models.messages.StopReason;
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
import java.util.concurrent.atomic.AtomicBoolean;

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

    interface Listener {
        boolean text(String delta);
        void done(String model);
        void failed(String reason);
    }

    static final class Call implements Runnable {
        private final Context context;
        private final List<Message> messages;
        private final int outputLimit;
        private final Listener listener;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private final Object resources = new Object();
        private volatile CancelableTransport transport;
        private volatile Thread worker;
        private int characters;

        Call(Context context, List<Message> messages, int outputLimit, Listener listener) {
            this.context = context.getApplicationContext();
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
        }

        @Override public void run() {
            if (cancelled()) return;
            worker = Thread.currentThread();
            AnthropicClient client = null;
            try {
                if (cancelled()) return;
                // Read a fresh key for every explicit Send/Retry; changing Settings takes effect immediately.
                String key = ClaudeKey.read(context);
                if (key == null || key.isEmpty())
                    throw new SafeFailure("Add a Claude API key to start chatting.");
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
                        .model(ClaudeChatRepository.MODEL).maxTokens(4096L)
                        .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.LOW).build());
                for (Message message : messages) {
                    if ("user".equals(message.role)) params.addUserMessage(message.text);
                    else params.addAssistantMessage(message.text);
                }
                if (cancelled()) return;
                boolean started = false, stopped = false;
                String model = ClaudeChatRepository.MODEL;
                StopReason stop = null;
                try (StreamResponse<RawMessageStreamEvent> response = client.messages().createStreaming(params.build())) {
                    Iterator<RawMessageStreamEvent> events = response.stream().iterator();
                    while (!cancelled() && events.hasNext()) {
                        RawMessageStreamEvent event = events.next();
                        if (cancelled()) return;
                        if (event.isMessageStart()) {
                            if (started) throw new SafeFailure("Claude's reply could not be completed. Retry.");
                            started = true;
                            String actual = event.asMessageStart().message().model().asString();
                            if (actual.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}")) model = actual;
                            event.asMessageStart().message().content().forEach(block ->
                                    block.text().ifPresent(text -> append(text.text())));
                        } else if (event.isContentBlockStart()) {
                            event.asContentBlockStart().contentBlock().text().ifPresent(text -> append(text.text()));
                        } else if (event.isContentBlockDelta()) {
                            event.asContentBlockDelta().delta().text().ifPresent(text -> append(text.text()));
                        } else if (event.isMessageDelta()) {
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
                listener.done(model);
            } catch (SafeFailure failure) {
                if (!cancelled()) listener.failed(failure.getMessage());
            } catch (AnthropicServiceException failure) {
                if (!cancelled()) listener.failed(serviceReason(failure));
            } catch (AnthropicIoException | CancellationException failure) {
                if (!cancelled()) listener.failed("Could not connect to Claude. Check your internet connection, then retry.");
            } catch (RuntimeException failure) {
                if (!cancelled()) listener.failed("Claude's reply could not be completed. Retry.");
            } finally {
                if (client != null) {
                    try { client.close(); } catch (RuntimeException ignored) { }
                }
                CancelableTransport current;
                synchronized (resources) { current = transport; transport = null; }
                if (current != null) current.close();
                worker = null;
            }
        }

        private void append(String delta) {
            if (delta.isEmpty()) return;
            if (cancelled()) throw new CancellationException();
            if (delta.length() > outputLimit - characters) {
                String reason = outputLimit < ClaudeChatRepository.MAX_OUTPUT_CHARS
                        ? "This chat is full. Clear the conversation to start a new chat."
                        : "Claude reached the reply limit. Try a shorter question.";
                throw new SafeFailure(reason);
            }
            if (!listener.text(delta)) { cancel(); throw new CancellationException(); }
            characters += delta.length();
        }
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
