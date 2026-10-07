package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** A browser checkpoint stays portable when the phone updates the reply and token counts. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 35})
public class ChatCloudCodecTest {
    @Test public void changedNativeReplyPreservesBrowserCheckpointsAndResumeMetadata() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        String identity = "compatible|https://provider.example/v1|fixture";
        String observation = new JSONObject().put("source", "pocket:note:n1").put("id", "n1")
                .put("text", "Completed observation").put("request_identity", identity)
                .put("access_fingerprint", "101100").toString();
        String proposal = new JSONObject().put("kind", "proposal").put("requires_confirmation", true)
                .put("proposal", new JSONObject().put("kind", "task").put("title", "Chosen action")
                        .put("text", "Context").put("due", "").put("steps", new JSONArray())
                        .put("when", "").put("minutes", 60)).toString();
        JSONArray activity = new JSONArray()
                .put(new JSONObject().put("id", "read").put("name", "read_note").put("state", "done")
                        .put("input", "{\"id\":\"n1\"}").put("result", observation))
                .put(new JSONObject().put("id", "proposal").put("name", "propose_action").put("state", "done")
                        .put("input", "{}").put("result", proposal).put("applied_href", "/tasks/saved")
                        .put("applied", 1200));
        JSONObject metadata = new JSONObject().put("request_identity", identity).put("read_access", "notes|tasks|calendar")
                .put("web_access", true).put("notes_restricted", true).put("output_tokens", 9);
        JSONObject previous = new JSONObject().put("uid", "codec-fixture").put("title", "Research")
                .put("created", 1000).put("updated", 1500).put("draft", "").put("context", new JSONArray())
                .put("config", new JSONObject().put("provider", "compatible").put("baseUrl", "https://provider.example/v1")
                        .put("model", "fixture").put("maxTokens", 2048).put("webSearch", true))
                .put("turns", new JSONArray().put(new JSONObject().put("uid", "turn-fixture").put("created", 1000)
                        .put("updated", 1500).put("text", "Research this").put("answer", "Partial reply")
                        .put("reasoning", "Local previous notes").put("status", "stopped")
                        .put("context", new JSONArray()).put("activity", activity).put("usage", metadata)));

        ChatStore.Record decoded = ChatCloudCodec.decode(previous);
        List<ClaudeChatRepository.Turn> turns = new ArrayList<>(decoded.turns);
        ClaudeChatRepository.Turn reply = turns.get(1);
        turns.set(1, new ClaudeChatRepository.Turn(reply.id, "assistant", "Finished reply", "complete",
                reply.reasoning, reply.created, reply.context, reply.activity));
        ChatStore.Record changed = new ChatStore.Record(decoded.id, decoded.title, decoded.draft, "", decoded.model,
                decoded.provider, new ClaudeChatClient.Usage(12, 34, 2, 3), turns,
                decoded.created, 2000, 1, false, false, decoded.draftContext);
        JSONObject encoded = ChatCloudCodec.encode(context, changed, previous);
        JSONObject portableTurn = encoded.getJSONArray("turns").getJSONObject(0);
        JSONObject usage = portableTurn.getJSONObject("usage");
        assertEquals(identity, usage.getString("request_identity"));
        assertEquals("notes|tasks|calendar", usage.getString("read_access"));
        assertTrue(usage.getBoolean("web_access"));
        assertTrue(usage.getBoolean("notes_restricted"));
        assertEquals(34, usage.getLong("outputTokens"));
        JSONArray checkpoints = portableTurn.getJSONArray("activity");
        assertEquals(observation, checkpoints.getJSONObject(0).getString("result"));
        assertEquals(proposal, checkpoints.getJSONObject(1).getString("result"));
        assertEquals("/tasks/saved", checkpoints.getJSONObject(1).getString("applied_href"));
        assertEquals(1200, checkpoints.getJSONObject(1).getLong("applied"));
        ChatStore.Record roundTrip = ChatCloudCodec.decode(encoded);
        JSONArray restored = ChatActivity.read(roundTrip.turns.get(1).activity);
        assertEquals(observation, restored.getJSONObject(0).getString("result"));
        assertEquals("/tasks/saved", restored.getJSONObject(1).getString("applied_href"));
    }
}
