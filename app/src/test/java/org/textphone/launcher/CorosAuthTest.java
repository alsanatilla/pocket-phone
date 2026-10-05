package org.textphone.launcher;

import static org.junit.Assert.*;
import android.net.Uri;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk={23,35})
public class CorosAuthTest {
    private static final String ISSUER = "https://mcpeu.coros.com";
    static final class Memory implements CorosAuth.Store {
        final Map<String,String> values = new HashMap<>();
        public String get(String name) { return values.get(name); }
        public void put(String name,String value) { if(value==null) values.remove(name); else values.put(name,value); }
    }
    @Test public void browserLoginSurvivesRecreationUsesPkceAndExchangesOnlyMatchingState() throws Exception {
        Memory memory = new Memory(); List<String> requests = new ArrayList<>();
        CorosAuth.Transport transport = (method,url,headers,body) -> {
            requests.add(url);
            if(url.equals(CorosAuth.DISCOVERY)) return reply("{\"issuer\":\""+ISSUER+"\",\"registration_endpoint\":\""+ISSUER+"/register\",\"token_endpoint\":\""+ISSUER+"/token\",\"authorization_endpoint\":\""+ISSUER+"/authorize\"}");
            if(url.endsWith("/register")) { try { assertEquals("none",new JSONObject(body).getString("token_endpoint_auth_method")); } catch(Exception e){throw new IOException(e);} return reply("{\"client_id\":\"fixture-client\"}"); }
            if(url.endsWith("login-sessions")) return reply("{\"sessionId\":\"fixture\",\"pollToken\":\"poll-secret\",\"loginUrl\":\""+ISSUER+"/cli/login/fixture\",\"expiresAt\":\"2099-01-01T00:00:00Z\"}");
            if(url.endsWith("/claim")) { assertEquals("poll-secret",headers.get("X-Poll-Token")); return reply("{\"status\":\"authorized\",\"loginTicket\":\"ticket\"}"); }
            if(url.contains("/authorize?")) {
                Uri query=Uri.parse(url); assertEquals("S256",query.getQueryParameter("code_challenge_method")); assertEquals("ticket",query.getQueryParameter("login_ticket"));
                assertEquals(43,query.getQueryParameter("code_challenge").length());
                return new CorosAuth.Reply(302,"",CorosAuth.REDIRECT+"?code=fixture-code&state="+query.getQueryParameter("state"));
            }
            assertTrue(url.endsWith("/token")); Uri form=Uri.parse("https://fixture/?"+body);
            assertEquals("fixture-code",form.getQueryParameter("code")); assertEquals(43,form.getQueryParameter("code_verifier").length());
            return reply("{\"access_token\":\"access\",\"refresh_token\":\"refresh\",\"expires_in\":3600}");
        };
        assertEquals(ISSUER+"/cli/login/fixture",new CorosAuth(memory,transport).begin());
        assertTrue(new CorosAuth(memory,transport).finish());
        assertNull(memory.get("pending")); assertNotNull(memory.get("tokens"));
        assertFalse(requests.stream().anyMatch(url->url.startsWith("http:")));
    }
    @Test public void mismatchedStateCannotExchangeCodeOrSaveTokens() throws Exception {
        Memory memory=pending(); int[] exchanges={0};
        CorosAuth auth=new CorosAuth(memory,(method,url,headers,body)->{
            if(url.endsWith("/claim")) return reply("{\"status\":\"authorized\",\"loginTicket\":\"ticket\"}");
            if(url.contains("authorize")) return new CorosAuth.Reply(302,"",CorosAuth.REDIRECT+"?code=code&state=wrong");
            exchanges[0]++; return reply("{}");
        });
        try { auth.finish(); fail(); } catch(IOException expected){assertTrue(expected.getMessage().contains("match"));}
        assertEquals(0,exchanges[0]); assertNull(memory.get("tokens"));
    }
    @Test public void pendingClaimIsRetainedAndExpiredLoginIsCleared() throws Exception {
        Memory memory=pending(); CorosAuth auth=new CorosAuth(memory,(method,url,headers,body)->reply("{\"status\":\"pending\"}"));
        assertFalse(auth.finish()); assertNotNull(memory.get("pending"));
        JSONObject pending=new JSONObject(memory.get("pending")); pending.put("expires",1); memory.put("pending",pending.toString());
        try { auth.finish(); fail(); } catch(IOException expected){assertTrue(expected.getMessage().contains("timed out"));}
        assertNull(memory.get("pending"));
    }
    @Test public void refreshRotatesAndTransientNetworkFailureKeepsLogin() throws Exception {
        Memory memory=tokens(); int[] refreshes={0};
        CorosAuth auth=new CorosAuth(memory,(method,url,headers,body)->{
            if(url.endsWith("/token")) { refreshes[0]++; return reply("{\"access_token\":\"new-access\",\"refresh_token\":\"rotated\",\"expires_in\":3600}"); }
            assertEquals("Bearer new-access",headers.get("Authorization"));
            try { JSONObject request=new JSONObject(body); return reply(request.getString("method").equals("initialize")?"{\"result\":{}}":"{\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"Age: 40\"}]}}"); }
            catch(Exception e){throw new IOException(e);}
        });
        assertEquals("Age: 40",auth.tool("queryUserInfo",new JSONObject()));
        assertEquals(1,refreshes[0]); assertEquals("rotated",new JSONObject(memory.get("tokens")).getString("refresh"));
        memory=tokens(); CorosAuth failed=new CorosAuth(memory,(method,url,headers,body)->{throw new IOException("offline");});
        try { failed.tool("queryUserInfo",new JSONObject()); fail(); } catch(IOException expected) { }
        assertNotNull(memory.get("tokens"));
    }
    @Test public void deniedRefreshClearsLoginAndUntrustedEndpointsAreRejected() throws Exception {
        Memory memory=tokens(); CorosAuth auth=new CorosAuth(memory,(method,url,headers,body)->new CorosAuth.Reply(400,"{}",null));
        try { auth.tool("queryUserInfo",new JSONObject()); fail(); } catch(CorosAuth.Expired expected) { }
        assertNull(memory.get("tokens"));
        for(String url:new String[]{"https://coros.com.evil.test/mcp","http://mcpeu.coros.com/mcp","https://user@mcpeu.coros.com/mcp"})
            try{CorosAuth.endpoint(url);fail(url);}catch(IOException expected){}
    }
    private static CorosAuth.Reply reply(String text){return new CorosAuth.Reply(200,text,null);}
    private static Memory pending() throws Exception {
        Memory memory=new Memory(); memory.put("pending",new JSONObject().put("issuer",ISSUER).put("token",ISSUER+"/token").put("client","fixture")
                .put("verifier","verifier").put("state","right").put("authorize",ISSUER+"/authorize?state=right").put("session","fixture").put("poll","poll")
                .put("expires",System.currentTimeMillis()+600000).toString()); return memory;
    }
    private static Memory tokens() throws Exception {
        Memory memory=new Memory(); memory.put("tokens",new JSONObject().put("issuer",ISSUER).put("token",ISSUER+"/token").put("client","fixture")
                .put("access","old-access").put("refresh","old-refresh").put("expires",1).toString()); return memory;
    }
}
