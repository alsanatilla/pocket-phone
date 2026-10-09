package org.textphone.launcher;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.SharedPreferences;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MovementRepositoryTest {
    private Context c; private SharedPreferences prefs; private FakeIO io; private CorosRepository repo;
    @Before public void reset() {
        c=RuntimeEnvironment.getApplication(); prefs=c.getSharedPreferences("pocket_movement",0); prefs.edit().clear().commit(); CloudSync.prefs(c).edit().clear().commit(); c.getSharedPreferences("pocket_coros_auth",0).edit().clear().commit();
        io=new FakeIO();repo=new CorosRepository(c,io);
    }
    private void account(String id) { CloudSync.prefs(c).edit().putString("pocket_id",id).putString("transport","pocket").commit();prefs.edit().putBoolean("cloud_owned",true).putBoolean("cloud_connected",true).commit(); }
    static JSONObject value() throws Exception { return new JSONObject().put("detail",new JSONArray("[[\"Distance\",\"6.2 km\"]]")).put("laps",new JSONObject().put("laps",new JSONArray("[{\"maxHr\":193}]"))); }
    @Test public void acceptsRichBrowserCacheAndKeepsOlderCompactSnapshotCompatible() throws Exception {
        account("fixture-account"); CorosRepository.Snapshot sample=MovementSample.snapshot();
        JSONObject data=new JSONObject().put("updated",sample.updated).put("activities",new JSONObject().put("list",CorosData.recordsJson(sample.activities))).put("cockpit",sample.cockpit);
        repo.accept(new JSONObject().put("accountId","fixture-account").put("connected",true).put("data",data));
        assertEquals(39,repo.cached().activities.size());assertEquals("SAMPLE WATCH",repo.cached().cockpit.getString("device"));assertNotNull(repo.cached().scores.recovery);assertEquals(28,repo.cached().hrv.size());
        JSONObject legacy=new JSONObject().put("updated",System.currentTimeMillis()).put("activities", "").put("hrv", "");
        repo.accept(new JSONObject().put("accountId","fixture-account").put("connected",false).put("data",new JSONObject().put("native",legacy)));
        assertFalse(repo.connected());assertEquals(0,repo.cached().activities.size());
        try {repo.accept(new JSONObject().put("accountId","someone-else"));fail();}catch(IOException expected){}assertNotNull(repo.cached());
    }
    @Test public void downloadsRawDetailAndPublishesExactSharedCacheWithoutSignedUrl() throws Exception {
        account("fixture-account");io.answer=new JSONObject().put("detail","Workout Time: 38:00\nDistance: 6.2 km").put("laps",lapText()).put("fitUrl","https://coros.example/activity.fit?signed=fixture");io.bytes=MovementFitTest.file(true,1000,false,true,false);
        JSONObject detail=repo.detail(item(),false);assertNotNull(detail.optJSONObject("path"));assertNotNull(detail.optJSONObject("series"));assertEquals(2,detail.getJSONArray("detail").length());assertNotNull(repo.cachedDetail("123"));
        assertEquals(1,io.downloads);assertEquals(1,io.puts);assertFalse(io.sent.toString().contains("signed"));assertFalse(io.sent.has("fitUrl"));assertEquals(185,repo.observedMax());
        assertEquals(detail.toString(),new CorosRepository(c,io).detail(item(),false).toString());assertEquals(1,io.downloads);assertEquals(1,io.gets);
    }
    @Test public void browserGeneratedDetailLoadsWithoutFetchingCorosOrFitAgain() throws Exception {
        account("fixture-account");io.answer=new JSONObject().put("cached",value()); JSONObject detail=repo.detail(item(),false);
        assertEquals(193,repo.observedMax());assertEquals(0,io.downloads);assertEquals(0,io.puts);assertNotNull(detail.optJSONObject("laps"));assertNotNull(repo.cachedDetail("123"));
    }
    @Test public void failedUploadRemainsQueuedAndCachedReadsRetryTheAcknowledgement() throws Exception {
        account("fixture-account");repo.rememberDetail("fixture-account","123",value(),false);io.failPut=true;
        assertNotNull(repo.detail(item(),false));assertEquals(1,io.puts);assertFalse(cacheEntry("123").getBoolean("shared"));io.failPut=false;
        assertNotNull(repo.detail(item(),false));assertEquals(2,io.puts);assertTrue(cacheEntry("123").getBoolean("shared"));
    }
    @Test public void failedFitKeepsPartialMetricsRetryableAndDoesNotPoisonOfflineCache() throws Exception {
        account("fixture-account");io.answer=new JSONObject().put("detail","Distance: 6.2 km").put("laps",lapText()).put("fitUrl","https://coros.example/activity.fit");io.bytes=new byte[20];
        JSONObject partial=repo.detail(item(),false);assertTrue(partial.getBoolean("partial"));assertEquals(1,partial.getJSONArray("detail").length());assertNull(repo.cachedDetail("123"));assertEquals(0,io.puts);
        io.bytes=MovementFitTest.file(true,10,false,true,false);assertFalse(repo.detail(item(),true).optBoolean("partial"));assertNotNull(repo.cachedDetail("123"));
    }
    @Test public void offlineDetailsStayReadableAndCacheCannotCrossAccounts() throws Exception {
        repo.rememberDetail("local","123",value(),true);assertNotNull(repo.detail(item(),false));assertEquals(0,io.gets);
        account("other-account");assertNull(repo.cachedDetail("123"));assertEquals(0,repo.observedMax());
        try{repo.rememberDetail("local","123",value(),true);fail();}catch(IOException expected){}
        try{repo.rememberDetail("other-account","123",value().put("fitUrl","https://private.example/file.fit"),true);fail();}catch(IOException expected){}
    }
    @Test public void cacheEvictsOldestAndLimitsRoutePayloads() throws Exception {
        for(int i=0;i<25;i++)repo.rememberDetail("local","id-"+i,value(),true);
        assertNull(repo.cachedDetail("id-0"));assertNotNull(repo.cachedDetail("id-24"));assertEquals(20,new JSONObject(prefs.getString("activity_details","{}")).getJSONObject("entries").length());
        try{repo.rememberDetail("local","huge",value().put("padding",new String(new char[1000001]).replace('\0','x')),true);fail();}catch(IOException expected){}
    }
    @Test public void disconnectDoesNotDeletePreviouslyOpenedActivities() throws Exception {
        repo.rememberDetail("local","123",value(),true);repo.disconnect();assertNotNull(repo.cachedDetail("123"));assertNotNull(repo.detail(item(),false));
    }
    private JSONObject cacheEntry(String id)throws Exception{return new JSONObject(prefs.getString("activity_details","{}")).getJSONObject("entries").getJSONObject(id);}
    static CorosData.Activity item(){return new CorosData.Activity("123",100,"Run",System.currentTimeMillis(),6.2,2280,148);}
    static String lapText(){return "{\"lapGroups\":[{\"type\":2,\"lapDistance\":100000,\"fastLapIndexList\":[1],\"laps\":[{\"lapIndex\":1,\"distance\":100000,\"time\":300,\"avgPace\":300,\"avgSpeedV2\":1200,\"avgHr\":150,\"maxHr\":185,\"avgCadence\":170}]}]}";}
    static final class FakeIO implements CorosRepository.DetailIO {
        JSONObject answer,sent;byte[] bytes;int gets,puts,downloads;boolean failPut;List<String> calls=new ArrayList<>();
        @Override public JSONObject api(String method,String path,JSONObject body)throws IOException{calls.add(method+" "+path);if(method.equals("GET")){gets++;if(answer==null)throw new IOException("offline");return answer;}puts++;if(failPut)throw new IOException("offline");sent=body.optJSONObject("value");return new JSONObject();}
        @Override public String tool(String name,JSONObject args)throws IOException{throw new IOException("offline");}
        @Override public byte[] download(String url)throws IOException{downloads++;if(bytes==null)throw new IOException("offline");return bytes;}
    }
}
