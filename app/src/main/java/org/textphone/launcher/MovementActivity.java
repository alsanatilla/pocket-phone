package org.textphone.launcher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.text.DateFormat;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.DoubleFunction;
import org.json.JSONArray;
import org.json.JSONObject;

/** COROS cockpit and saved activity instruments, using the web's readings, units and cache format. */
public final class MovementActivity extends PocketActivity {
    private static final int GREEN = PocketDesign.MOVEMENT, BLUE = PocketDesign.CALENDAR;
    private CorosRepository repository;
    private boolean busy, visible, settings, direct, allCharts, more, sample;
    private int selected=-1,tab=0,period=28,weekOffset=0;
    private String gymId="",filter="all";
    private LocalDate selectedDay=LocalDate.now();
    private boolean hasReadings;
    private java.util.List<MovementData.Session> feed=new java.util.ArrayList<>();
    private java.util.List<AgendaStore.Event> plans=new java.util.ArrayList<>();
    private android.app.AlertDialog planDialog;
    private Scores.Result todayScores;
    private String activityId = "", owner = "", settingsReturn = "movement";
    private CorosRepository.Snapshot snapshot;
    private final Map<String, JSONObject> details = new HashMap<>();
    private final Map<String, String> errors = new HashMap<>();
    private final Set<String> loadingDetails = new HashSet<>();
    private final Runnable claim = this::completeLogin;
    private final Runnable redraw = () -> { if (visible && !closed && !busy) render(); };
    private final BroadcastReceiver updated = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { queueRedraw(); }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); repository = CorosRepository.get(this);
        if (state != null) {
            tab=state.getInt("tab");period=state.getInt("period",28);weekOffset=state.getInt("weekOffset");selectedDay=LocalDate.parse(state.getString("day",LocalDate.now().toString()));gymId=state.getString("gym","");filter=state.getString("filter","all"); selected = state.getInt("score", -1); settings = state.getBoolean("settings"); direct = state.getBoolean("direct");
            activityId = state.getString("activity", ""); allCharts = state.getBoolean("charts"); more = state.getBoolean("more"); settingsReturn = state.getString("settingsReturn", "movement");
        } else chooseScore(getIntent());
        render();
    }
    private void chooseScore(Intent intent) {
        int chosen = intent.getIntExtra("score", -1);
        if (chosen >= 0 && chosen < 3) { tab=0; gymId=""; selected = chosen; settings = false; activityId = ""; direct = true; }
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); chooseScore(intent); render(); }
    @android.annotation.SuppressLint("UnspecifiedRegisterReceiverFlag")
    @Override protected void onStart() {
        super.onStart(); IntentFilter filter = new IntentFilter(CorosRepository.ACTION_UPDATED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(updated, filter, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(updated, filter);
    }
    @Override protected void onStop() { unregisterReceiver(updated); ui.removeCallbacks(redraw); super.onStop(); }
    @Override protected void onResume() {
        super.onResume(); visible = true; render();
        if (repository.pending()) completeLogin(); else if (repository.connected()) refresh(false);
    }
    @Override protected void onPause() { visible = false; ui.removeCallbacks(claim); ui.removeCallbacks(redraw); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putInt("tab",tab);state.putInt("period",period);state.putInt("weekOffset",weekOffset);state.putString("day",selectedDay.toString());state.putString("gym",gymId);state.putString("filter",filter); state.putInt("score", selected); state.putBoolean("settings", settings); state.putBoolean("direct", direct);
        state.putString("activity", activityId); state.putBoolean("charts", allCharts); state.putBoolean("more", more); state.putString("settingsReturn", settingsReturn); super.onSaveInstanceState(state);
    }
    @Override protected boolean hasInternalBack() { return settings || !gymId.isEmpty() || !activityId.isEmpty() || selected >= 0 && !direct; }
    @Override protected String backPageKey(String rootPage) { return settings ? settingsReturn : "movement"; }
    @Override protected String scene() { return PixelBackdrop.TERRAIN; }
    @Override public void onBackPressed() {
        if (hasInternalBack()) back(() -> { if (settings) settings = false; else if (!gymId.isEmpty()) gymId = ""; else if (!activityId.isEmpty()) activityId = ""; else selected = -1; render(); });
        else super.onBackPressed();
    }
    private void queueRedraw() { ui.removeCallbacks(redraw); ui.postDelayed(redraw, 120); }
    @Override protected void onCloudSynced() { queueRedraw(); }
    @Override protected boolean canRefreshData() { return repository.connected() || CloudSync.enabled(this); }
    @Override protected void refreshPageData() throws Exception {
        Exception failure = null;
        if (CloudSync.enabled(this)) try { CloudSync.run(getApplicationContext()); } catch (Exception error) { failure = error; }
        if (repository.connected()) repository.refresh(true);
        if (failure != null) throw failure;
    }
    @Override protected void onPageRefreshed() { render(); }

    private void render() {
        ui.removeCallbacks(redraw);
        String currentOwner = repository.detailOwner();
        if (!owner.equals(currentOwner)) { owner=currentOwner;details.clear();errors.clear();loadingDetails.clear();if(planDialog!=null){planDialog.dismiss();planDialog=null;} }
        snapshot=repository.cached();hasReadings=snapshot!=null;sample=false;
        if(snapshot==null)try{snapshot=new CorosRepository.Snapshot(new JSONObject().put("updated",System.currentTimeMillis()));}catch(Exception e){throw new IllegalStateException(e);}
        feed=MovementData.feed(snapshot.activities,GymStore.workouts(this));plans=MovementData.plans(this);todayScores=computeScores(28);
        CorosData.Activity activity = findActivity(activityId); if (activity == null) activityId = "";
        String key = activity == null ? "movement" : "movement-activity-" + activity.id;
        screen(settings ? "movement settings" : activity == null ? "movement" : activity.type.toLowerCase(Locale.ROOT), settings ? "movement-settings" : key);
        if (settings) { renderSettings(); return; }
        appSettings(() -> { settingsReturn = key; settings = true; render(); });
        if(!gymId.isEmpty()){renderGym();return;}
        if (activity != null) { renderActivity(activity); return; }
        renderSource();
        commands(body,new String[]{"overview","activities","trends"},tab,()->chooseTab(0),()->chooseTab(1),()->chooseTab(2)).setTag("movement_tabs");
        if(tab==0)overview();else if(tab==1)activities();else trends();
    }
    private void chooseTab(int next){tab=next;selected=-1;direct=false;render();}
    private Scores.Result computeScores(int days){
        JSONObject p=snapshot.cockpit.optJSONObject("profile"),health=snapshot.cockpit.optJSONObject("daily");
        return Scores.compute(LocalDate.now(),ZoneId.systemDefault(),snapshot.activities,snapshot.hrv,snapshot.resting,snapshot.daily,p==null?0:p.optInt("age"),p!=null&&"Female".equals(p.optString("gender")),repository.observedMax(),health==null?0:health.optInt("restingHr"),days);
    }
    private void overview(){
        LinearLayout cards=row();cards.setTag("movement_scores");
        if(getResources().getConfiguration().fontScale>1.25f||getSharedPreferences("text_phone",0).getBoolean("large_text",false))cards.setOrientation(LinearLayout.VERTICAL);
        Scores.Result s=todayScores;boolean daily=snapshot.daily.containsKey(LocalDate.now());for(CorosData.Activity a:snapshot.activities)if(a.day(ZoneId.systemDefault()).equals(LocalDate.now()))daily=true;
        score(cards,0,"recovery",s.recovery==null?Double.NaN:s.recovery.score,s.recovery==null?"—":s.recovery.score+"%",s.recovery==null?"no reading":s.recovery.zone);
        score(cards,1,"strain",daily?s.strain.strain:Double.NaN,daily?s.strain.strain+"%":"—",daily?"target "+s.strain.low+"–"+s.strain.high+"%":"no reading");
        score(cards,2,"condition",snapshot.activities.isEmpty()?Double.NaN:s.conditioning.score,snapshot.activities.isEmpty()?"—":String.valueOf(s.conditioning.score),snapshot.activities.isEmpty()?"no history":conditionLabel(s.conditioning.status));body.addView(cards);
        if(selected>=0){note("Pocket estimate · COROS readings",GRAY);scorePanel(s,snapshot.cockpit);}
        section("next session");AgendaStore.Event next=null;java.util.List<JSONObject> workouts=GymStore.workouts(this);
        for(AgendaStore.Event p:plans)if(!MovementData.done(p,workouts)&&(!MovementData.day(p.when).isBefore(LocalDate.now())||MovementData.workout(p,workouts)!=null)){next=p;break;}
        PlannerStore.Entry nextTask=null;for(PlannerStore.Entry t:MovementData.trainingTasks(this))if(!t.done&&t.due.compareTo(LocalDate.now().toString())>=0){nextTask=t;break;}
        if(nextTask!=null&&(next==null||nextTask.due.compareTo(MovementData.day(next.when).toString())<0))trainingTaskRow(nextTask);
        else if(next==null)action("plan a session",()->editPlan(null)).setTag("movement_plan_empty");else planRow(next,true);
        lastNight();weekPlan();
        LinearLayout pip=row();pip.setGravity(Gravity.CENTER_VERTICAL);pip.setTag("movement_pip");pip.setClickable(true);pip.setFocusable(true);pip.setContentDescription("Talk training with Pip");
        View sprite=PocketDesign.navMascot(this,54);sprite.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);pip.addView(sprite,new LinearLayout.LayoutParams(dp(54),dp(54)));TextView text=compact("talk training with Pip  →",14,YELLOW);pip.addView(text,new LinearLayout.LayoutParams(0,-2,1));pip.setOnClickListener(v->askTraining());body.addView(pip);
    }
    private void editPlan(AgendaStore.Event event){if(planDialog!=null)planDialog.dismiss();planDialog=MovementPlanEditor.show(this,event,selectedDay,this::render);}
    private void planRow(AgendaStore.Event p,boolean featured){
        java.util.List<JSONObject> workouts=GymStore.workouts(this);JSONObject workout=MovementData.workout(p,workouts);boolean done=MovementData.done(p,workouts);
        LinearLayout block=column();if(featured){block.setBackgroundColor(PocketDesign.PLANE);block.setPadding(dp(12),dp(8),dp(12),dp(8));}
        TextView title=compact(time(p.when)+" · "+p.title,16,WHITE);block.addView(title);
        int count=p.training.optJSONArray("exercises").length();block.addView(compact((featured?date(MovementData.day(p.when))+" · ":"")+p.training.optString("sport")+" · "+p.minutes+" min"+(count>0?" · "+count+" exercises":"")+(done?" · done":""),13,GRAY));
        LinearLayout controls=row();Button edit=button("edit",()->editPlan(p));PocketDesign.command(edit,false);controls.addView(edit,new LinearLayout.LayoutParams(0,-2,1));
        boolean gym="gym".equals(p.training.optString("sport"));Button launch=button(gym?(done?"view":workout==null?"start":"resume"):done?"reopen":"done",()->{
            AgendaStore.Event current=AgendaStore.find(this,p.id);if(current==null){message("This session was removed.");return;}
            if(gym){JSONObject w=GymStore.startPlan(this,current);if(w.optLong("ended")>0)startActivity(new Intent(this,GymActivity.class).putExtra("pocket_workout",w.optString("id")));else startActivity(new Intent(this,GymActivity.class).putExtra("pocket_resume",true));}
            else {try{current.training.put("completedAt",done?0:System.currentTimeMillis());AgendaStore.save(this,current);render();}catch(Exception e){message(e.getMessage());}}
        });launch.setTag("movement_plan_start_"+p.uid);PocketDesign.command(launch,true);controls.addView(launch,new LinearLayout.LayoutParams(0,-2,1));block.addView(controls);body.addView(block);
    }
    private void lastNight(){
        section("last night");JSONObject d=snapshot.cockpit.optJSONObject("daily"),n=latestSleep(d==null?null:d.optJSONArray("days")),h=latest(snapshot.cockpit.optJSONArray("hrv")),r=latest(snapshot.cockpit.optJSONArray("resting"));
        JSONObject sleep=n==null?null:n.optJSONObject("sleep");double base=0;int count=0;
        if(r!=null)for(java.util.Map.Entry<LocalDate,Integer> e:snapshot.resting.entrySet())if(e.getKey().toString().compareTo(r.optString("date"))<0){base+=e.getValue();count++;}
        String delta=count>0?((r.optDouble("bpm")-base/count)>=0?"+":"")+Math.round(r.optDouble("bpm")-base/count)+" vs baseline":"";
        String[][] values={{"sleep",sleep==null?"—":minutes(sleep.optDouble("total")),n==null?"no reading":shortDate(n.optString("date"))},
            {"HRV",number(h,"avg"," ms"),h==null?"no reading":shortDate(h.optString("date"))+(h.has("low")?" · normal "+number(h,"low","")+"–"+number(h,"high",""):"")},
            {"resting HR",number(r,"bpm"," bpm"),r==null?"no reading":shortDate(r.optString("date"))+" · "+delta}};
        LinearLayout line=row();boolean large=getResources().getConfiguration().fontScale>1.25f||getSharedPreferences("text_phone",0).getBoolean("large_text",false);if(large)line.setOrientation(LinearLayout.VERTICAL);
        for(String[] value:values){LinearLayout cell=column();cell.setPadding(0,dp(8),dp(6),dp(8));cell.addView(compact(value[0],12,GRAY));TextView big=compact(value[1],28,WHITE);big.setTypeface(PocketFonts.pixel(this));cell.addView(big);cell.addView(compact(value[2],12,GRAY));cell.setClickable(true);cell.setFocusable(true);cell.setContentDescription(String.join(", ",value));cell.setOnClickListener(v->{selected=0;render();});line.addView(cell,large?new LinearLayout.LayoutParams(-1,-2):new LinearLayout.LayoutParams(0,-2,1));}body.addView(line);
    }
    private void weekPlan(){
        LocalDate monday=MovementData.monday(LocalDate.now()).plusWeeks(weekOffset);if(selectedDay.isBefore(monday)||selectedDay.isAfter(monday.plusDays(6)))selectedDay=monday;
        section(weekOffset==0?"this week":date(monday)+" – "+date(monday.plusDays(6)));
        commands(body,new String[]{"‹","today","›"},-1,()->{weekOffset--;selectedDay=monday.minusWeeks(1);render();},()->{weekOffset=0;selectedDay=LocalDate.now();render();},()->{weekOffset++;selectedDay=monday.plusWeeks(1);render();});
        int completed=0,planned=0;double total=0;java.util.List<JSONObject> workouts=GymStore.workouts(this);
        for(MovementData.Session s:feed)if(!MovementData.day(s.start).isBefore(monday)&&MovementData.day(s.start).isBefore(monday.plusDays(7))){completed++;total+=s.seconds;}
        for(AgendaStore.Event p:plans)if(!MovementData.day(p.when).isBefore(monday)&&MovementData.day(p.when).isBefore(monday.plusDays(7))&&!MovementData.done(p,workouts)&&MovementData.workout(p,workouts)==null)planned++;
        java.util.List<PlannerStore.Entry> trainingTasks=MovementData.trainingTasks(this);for(PlannerStore.Entry t:trainingTasks)if(!t.done&&t.due.compareTo(monday.toString())>=0&&t.due.compareTo(monday.plusDays(7).toString())<0)planned++;
        note(completed+" completed · "+planned+" planned · "+moving((int)total),GRAY);
        LinearLayout rail=row();rail.setTag("movement_week");
        for(int i=0;i<7;i++){LocalDate d=monday.plusDays(i);int count=0,pending=0;for(MovementData.Session s:feed)if(MovementData.day(s.start).equals(d))count++;for(AgendaStore.Event p:plans)if(MovementData.day(p.when).equals(d)&&!MovementData.done(p,workouts))pending++;
            for(PlannerStore.Entry t:trainingTasks)if(!t.done&&t.due.equals(d.toString()))pending++;
            String day=d.format(DateTimeFormatter.ofPattern("EEE",Locale.getDefault()));Button b=button(day+"\n"+d.getDayOfMonth()+"\n"+(count>0?"●":pending>0?"◇":"·"),()->{selectedDay=d;render();});PocketDesign.text(b,12,d.equals(selectedDay)?YELLOW:GRAY);b.setPadding(0,dp(6),0,dp(6));b.setMinWidth(0);b.setMinimumWidth(0);b.setSelected(d.equals(selectedDay));b.setContentDescription(date(d)+", "+count+" completed, "+pending+" planned");rail.addView(b,new LinearLayout.LayoutParams(0,-2,1));}body.addView(rail);
        boolean any=false;java.util.Set<String> logged=new java.util.HashSet<>();for(MovementData.Session s:feed)if(MovementData.day(s.start).equals(selectedDay)){sessionRow(s);any=true;if(s.workout!=null)logged.add(s.workout.optString("plan_uid"));}for(AgendaStore.Event p:plans)if(MovementData.day(p.when).equals(selectedDay)&&!logged.contains(p.uid)){planRow(p,false);any=true;}for(PlannerStore.Entry t:trainingTasks)if(t.due.equals(selectedDay.toString())){trainingTaskRow(t);any=true;}if(!any)note("No sessions",GRAY);
        action("+ plan session",()->editPlan(null)).setTag("movement_plan_add");
    }
    private void activities(){
        HorizontalScrollView scroll=new HorizontalScrollView(this);scroll.setHorizontalScrollBarEnabled(false);LinearLayout filters=row();
        String[] names={"all","run","gym","ride","swim","walk","other"};for(String name:names){Button b=button(name,()->{filter=name;render();});PocketDesign.command(b,name.equals(filter));b.setSelected(name.equals(filter));b.setTag("movement_filter_"+name);filters.addView(b);}scroll.addView(filters);body.addView(scroll);
        int count=0;double total=0,km=0;for(MovementData.Session s:feed)if(filter.equals("all")||filter.equals(s.sport)){count++;total+=s.seconds;km+=s.km;}
        note(count+" sessions · "+moving((int)total)+(!filter.equals("all")&&!filter.equals("gym")&&km>0?" · "+decimal(km,1)+" km":""),GRAY);
        for(MovementData.Session s:feed)if(filter.equals("all")||filter.equals(s.sport))sessionRow(s);if(count==0)note("No activities",GRAY);
    }
    private void sessionRow(MovementData.Session s){
        LinearLayout line=row();line.setGravity(Gravity.CENTER_VERTICAL);line.setPadding(0,dp(12),0,dp(12));line.setClickable(true);line.setFocusable(true);line.setTag(s.workout!=null?"movement_gym_"+s.workout.optString("id"):"movement_activity_"+s.coros.id);
        TextView symbol=compact(s.sport.equals("gym")?"Ⅱ":s.sport.equals("ride")?"○":s.sport.equals("swim")?"≈":"↗",24,s.sport.equals("gym")?YELLOW:GREEN);symbol.setGravity(Gravity.CENTER);symbol.setBackgroundColor(PocketDesign.PLANE);line.addView(symbol,new LinearLayout.LayoutParams(dp(40),dp(44)));
        LinearLayout text=column();text.setPadding(dp(10),0,dp(8),0);text.addView(compact(s.name,16,WHITE));text.addView(compact(date(MovementData.day(s.start))+" · "+s.source+" · "+moving((int)s.seconds),12,GRAY));line.addView(text,new LinearLayout.LayoutParams(0,-2,1));
        TextView value=compact(s.workout!=null?GymStore.setCount(s.workout)+" sets":s.km>0?decimal(s.km,1)+" km":moving((int)s.seconds),25,WHITE);value.setTypeface(PocketFonts.pixel(this));line.addView(value);line.setContentDescription(s.name+", "+s.source+", "+date(MovementData.day(s.start))+", "+value.getText());
        line.setOnClickListener(v->{if(s.workout!=null)gymId=s.workout.optString("id");else activityId=s.coros.id;render();});body.addView(line);
    }
    private void renderGym(){
        MovementData.Session session=null;for(MovementData.Session s:feed)if(s.workout!=null&&gymId.equals(s.workout.optString("id")))session=s;
        if(session==null){gymId="";render();return;}JSONObject workout=session.workout;section(session.name);note(date(MovementData.day(session.start))+" · "+session.source,GRAY);
        metrics(new String[][]{{"duration",moving((int)session.seconds)},{"sets",String.valueOf(GymStore.setCount(workout))},{"volume",integer(GymStore.volume(workout))+" kg"}});
        action("open Gym log",()->startActivity(new Intent(this,GymActivity.class).putExtra("pocket_workout",workout.optString("id"))));
        java.util.List<CorosData.Activity> choices=MovementData.choices(workout,snapshot.activities,GymStore.workouts(this));
        if(!workout.optString("coros_id").isEmpty())action("unlink COROS recording",()->{GymStore.update(this,gymId,w->w.remove("coros_id"));render();});
        else if(!choices.isEmpty())action("link COROS recording",()->{String requestOwner=owner;String[] names=new String[choices.size()];for(int i=0;i<names.length;i++)names[i]=time(choices.get(i).start)+" · "+choices.get(i).name+" · "+moving(choices.get(i).seconds);new android.app.AlertDialog.Builder(this).setTitle("COROS recording").setItems(names,(dialog,index)->{if(requestOwner.equals(repository.detailOwner())){GymStore.update(this,workout.optString("id"),w->w.put("coros_id",choices.get(index).id));render();}}).setNegativeButton("cancel",null).show();});
        if(session.coros!=null)renderActivity(session.coros);
    }
    private void trends(){
        commands(body,new String[]{"7 days","28 days","90 days"},period==7?0:period==28?1:2,()->{period=7;render();},()->{period=28;render();},()->{period=90;render();});String[] dates=dateKeys(LocalDate.now(),period);Scores.Result all=computeScores(period);
        double[] recovery=new double[period],strain=new double[period],condition=new double[period],training=new double[period];
        for(int i=0;i<period;i++){Scores.Recovery r=all.recoveries.get(i);recovery[i]=r==null?Double.NaN:r.score;boolean known=snapshot.daily.containsKey(LocalDate.parse(dates[i])),history=false;
            for(CorosData.Activity a:snapshot.activities){if(a.day(ZoneId.systemDefault()).toString().equals(dates[i]))known=true;if(a.day(ZoneId.systemDefault()).toString().compareTo(dates[i])<=0)history=true;}
            strain[i]=known?all.strains.get(i):Double.NaN;condition[i]=history?all.conditioning.trail.get(90-period+i):Double.NaN;
            for(MovementData.Session s:feed)if(MovementData.day(s.start).toString().equals(dates[i]))training[i]+=s.seconds/60;
        }
        trendCard("recovery",recovery,dates,MovementChart.Kind.LINE,GREEN,v->integer(v)+"%");trendCard("training time",training,dates,MovementChart.Kind.BARS,YELLOW,MovementActivity::minutes);
        trendCard("resting HR",onDays(snapshot.cockpit.optJSONArray("resting"),"bpm",dates),dates,MovementChart.Kind.LINE,YELLOW,v->integer(v)+" bpm");
        trendCard("HRV",onDays(snapshot.cockpit.optJSONArray("hrv"),"avg",dates),dates,MovementChart.Kind.LINE,GREEN,v->integer(v)+" ms");JSONObject daily=snapshot.cockpit.optJSONObject("daily");
        trendCard("sleep",onDays(daily==null?null:daily.optJSONArray("days"),"sleep.total",dates),dates,MovementChart.Kind.BARS,BLUE,MovementActivity::minutes);
        trendCard("strain",strain,dates,MovementChart.Kind.BARS,YELLOW,v->integer(v)+"%");trendCard("condition",condition,dates,MovementChart.Kind.LINE,BLUE,MovementActivity::integer);fitness(snapshot.cockpit.optJSONObject("fitness"));
    }
    private void trendCard(String name,double[] values,String[] dates,MovementChart.Kind kind,int color,DoubleFunction<String> format){
        if(!present(values)){section(name);note("No readings in this period",GRAY);return;}plot(name,values,dates,kind,color,format);int count=0,last=0;for(int i=0;i<values.length;i++)if(Double.isFinite(values[i])){count++;last=i;}note(count+"/"+values.length+" days · latest "+shortDate(dates[last]),GRAY);
    }
    private void askTraining(){
        StringBuilder text=new StringBuilder("Help me plan my training. Check reading dates and propose changes for me to review.\n\nMovement snapshot: ").append(LocalDate.now()).append(". COROS saved: ").append(hasReadings?new Date(snapshot.updated):"unavailable").append(".\nPocket estimates from COROS: recovery ").append(todayScores.recovery==null?"unavailable":todayScores.recovery.score).append("; strain ").append(snapshot.daily.containsKey(LocalDate.now())||todayScores.strain.workouts>0?todayScores.strain.strain:"unavailable").append("; condition ").append(snapshot.activities.isEmpty()?"unavailable":todayScores.conditioning.score).append(".\n");
        JSONObject h=latest(snapshot.cockpit.optJSONArray("hrv")),r=latest(snapshot.cockpit.optJSONArray("resting")),daily=snapshot.cockpit.optJSONObject("daily"),n=latestSleep(daily==null?null:daily.optJSONArray("days"));
        text.append("HRV: ").append(number(h,"avg"," ms")).append(" (").append(text(h,"date")).append("). Resting HR: ").append(number(r,"bpm"," bpm")).append(" (").append(text(r,"date")).append("). Sleep: ").append(n==null?"unavailable":number(n.optJSONObject("sleep"),"total"," min")+" ("+n.optString("date")+")").append(".\nThis week:\n");
        LocalDate monday=MovementData.monday(LocalDate.now());int count=0;for(MovementData.Session s:feed)if(!MovementData.day(s.start).isBefore(monday)&&MovementData.day(s.start).isBefore(monday.plusDays(7))&&count++<20)text.append(s.name).append(", ").append(MovementData.day(s.start)).append(", ").append(moving((int)s.seconds)).append(", ").append(s.source).append('\n');
        text.append("Planned:\n");count=0;for(AgendaStore.Event p:plans)if(!MovementData.done(p,GymStore.workouts(this))&&!MovementData.day(p.when).isBefore(monday)&&count++<14)text.append(p.title).append(", ").append(date(MovementData.day(p.when))).append(' ').append(time(p.when)).append(", ").append(p.minutes).append(" min, ").append(p.training.optString("sport")).append(", ").append(p.training.optJSONArray("exercises")).append('\n');
        text.append("Pip training tasks:\n");for(PlannerStore.Entry task:MovementData.trainingTasks(this))if(!task.done&&task.due.compareTo(monday.toString())>=0)text.append(task.due).append(": ").append(task.text).append('\n');
        startActivity(new Intent(this,MainActivity.class).putExtra("pocket_movement_context",text.toString()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private String time(long at){return android.text.format.DateFormat.getTimeFormat(this).format(new Date(at));}
    private void trainingTaskRow(PlannerStore.Entry t){action(t.text+"\n"+shortDate(t.due)+" · Pip training"+(t.done?" · done":""),()->startActivity(new Intent(this,OrganizerActivity.class).putExtra("pocket_task",t.id))).setTag("movement_training_task_"+t.id);}
    private String conditionLabel(String s){switch(s){case "calibrating":return "building base";case "maintaining":return "steady";case "overtraining":return "high load";case "productive":return "building";case "detraining":return "easing off";default:return s;}}
    @Override protected void onDestroy(){if(planDialog!=null)planDialog.dismiss();super.onDestroy();}
    private void renderSource() {
        if (!repository.connected()) {
            if (repository.pending()) { action("check COROS sign-in", this::completeLogin).setTag("coros_check"); action("start again", this::connect); }
            else action(hasReadings ? "reconnect COROS" : "connect COROS", this::connect).setTag("coros_connect");
        }
        if (sample) { section("SAMPLE DATA").setTag("movement_sample"); return; }
        String device = !hasReadings ? "" : CorosData.string(snapshot.cockpit, "device"); if (device != null && !device.isEmpty()) note(device, GRAY);
        String time = !hasReadings ? "" : DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(snapshot.updated));
        if (repository.connected()) {
            Button source = action(busy ? "COROS · refreshing…" : "COROS · " + (repository.error().isEmpty() ? time : "retry"), () -> refresh(true)); source.setTag("movement_refresh"); source.setEnabled(!busy);
        } else if (!time.isEmpty()) note("COROS · " + time, GRAY);
        if (!repository.error().isEmpty()) note(repository.error(), PocketDesign.WARNING);
    }
    private void renderSettings() {
        action("open COROS", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://training.coros.com/"))));
        if (repository.connected() || repository.pending()) action("disconnect COROS", () -> confirm("Disconnect COROS?", () -> {
            if (busy) return; busy = true;
            load(() -> { repository.disconnect(); return true; }, done -> { busy = false; settings = false; render(); }, error -> { busy = false; message(error.getMessage()); });
        }));
        action("open web movement", () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CloudSync.WEB + "#/movement"))));
    }
    private void score(LinearLayout host,int index,String title,double number,String value,String meta){
        int color=index==0?GREEN:index==1?YELLOW:BLUE,ink=index==0?PocketDesign.INK:color;
        LinearLayout cell=column();cell.setPadding(dp(10),dp(14),dp(10),dp(14));cell.setBackgroundColor(index==0?GREEN:PocketDesign.PLANE);cell.setClickable(true);cell.setFocusable(true);cell.setTag("movement_score_"+index);cell.setSelected(selected==index);
        TextView name=compact(title,18,ink);name.setTypeface(PocketFonts.pixel(this));name.setTextSize(18);name.setTag("movement_score_name_"+index);name.setMaxLines(1);cell.addView(name);
        TextView reading=compact(value,44,ink);reading.setTypeface(PocketFonts.pixel(this));reading.setTextSize(44);reading.setSingleLine(true);
        if(value.endsWith("%")){android.text.SpannableString styled=new android.text.SpannableString(value);styled.setSpan(new android.text.style.RelativeSizeSpan(.4f),value.length()-1,value.length(),0);reading.setText(styled);}cell.addView(reading);
        View segments=new View(this){final android.graphics.Paint paint=new android.graphics.Paint();@Override protected void onDraw(android.graphics.Canvas canvas){float slot=getWidth()/16f;paint.setColor(ink);for(int i=0;i<16;i++){paint.setAlpha(Double.isFinite(number)&&i<number/100*16?210:40);canvas.drawRect(i*slot,0,(i+1)*slot-dp(2),getHeight(),paint);}}};segments.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);cell.addView(segments,new LinearLayout.LayoutParams(-1,dp(10)));
        TextView status=compact(meta,12,index==0?0xFF283322:GRAY);status.setPadding(0,dp(9),0,0);cell.addView(status);
        cell.setContentDescription(title+" "+value+", "+meta+(selected==index?". Close details.":". Show details."));
        cell.setOnClickListener(v->{selected=selected==index?-1:index;direct=false;render();});
        LinearLayout.LayoutParams layout=host.getOrientation()==LinearLayout.VERTICAL?new LinearLayout.LayoutParams(-1,-2):new LinearLayout.LayoutParams(0,-1,1);if(index>0){if(host.getOrientation()==LinearLayout.VERTICAL)layout.topMargin=dp(8);else layout.leftMargin=dp(8);}host.addView(cell,layout);
    }
    private void scorePanel(Scores.Result scores, JSONObject deck) {
        String[] dates = dateKeys(LocalDate.now(), 28);
        if (selected == 0) {
            section("RECOVERY");
            if (scores.recovery != null) for (Scores.Part p : scores.recovery.parts) note((p.z > .3 ? "▲ " : p.z < -.3 ? "▼ " : "· ") + p.text, WHITE);
            double[] history = new double[scores.recoveries.size()]; for (int i = 0; i < history.length; i++) history[i] = scores.recoveries.get(i) == null ? Double.NaN : scores.recoveries.get(i).score;
            plot("RECOVERY · 28 MORNINGS", history, dates, MovementChart.Kind.LINE, GREEN, v -> integer(v) + "%").bounds(0, 100);
            gauges(deck); JSONObject daily = deck.optJSONObject("daily"); JSONArray days = daily == null ? null : daily.optJSONArray("days");
            trend("SLEEP · 28 NIGHTS", days, "sleep.total", dates, MovementChart.Kind.BARS, BLUE, MovementActivity::minutes);
            MovementChart hrv = trend("HRV · MS", deck.optJSONArray("hrv"), "avg", dates, MovementChart.Kind.LINE, GREEN, v -> integer(v) + " ms");
            if (hrv != null) hrv.band(onDays(deck.optJSONArray("hrv"), "low", dates), onDays(deck.optJSONArray("hrv"), "high", dates));
            trend("RESTING HR · BPM", deck.optJSONArray("resting"), "bpm", dates, MovementChart.Kind.LINE, YELLOW, v -> integer(v) + " bpm");
            MovementChart stress = trend("STRESS · 0–100", days, "stress", dates, MovementChart.Kind.BARS, YELLOW, MovementActivity::integer); if (stress != null) stress.bounds(0, 100);
            JSONObject own = deck.optJSONObject("recovery");
            if (metric(own, "percent") != null) { section("COROS TRAINING RECOVERY"); note(integer(own.optDouble("percent")) + "% · " + text(own, "level"), GREEN); if (CorosData.string(own, "full") != null) note(text(own, "full"), GRAY); }
        } else if (selected == 1) {
            section("STRAIN"); metrics(new String[][]{{"workouts", String.valueOf(scores.strain.workouts)}, {"active TRIMP", integer(scores.strain.active)}, {"everyday TRIMP", integer(scores.strain.passive)}, {"target", scores.strain.low + "–" + scores.strain.high + "%"}});
            double[] history = new double[scores.strains.size()]; for (int i = 0; i < history.length; i++) history[i] = scores.strains.get(i);
            plot("STRAIN · 28 DAYS", history, dates, MovementChart.Kind.BARS, YELLOW, v -> integer(v) + "%");
            JSONObject daily = deck.optJSONObject("daily"); trend("STEPS · 28 DAYS", daily == null ? null : daily.optJSONArray("days"), "steps", dates, MovementChart.Kind.BARS, GREEN, MovementActivity::integer);
        } else {
            section("CONDITIONING"); Scores.Conditioning c = scores.conditioning;
            metrics(new String[][]{{"7-day TRIMP", integer(c.acute)}, {"42-day TRIMP", integer(c.chronic)}, {"balance", c.chronic > 0 ? decimal(c.acute / c.chronic, 2) : "—"}, {"status", c.status}});
            double[] history = new double[28]; for (int i = 0; i < 28; i++) history[i] = c.trail.get(c.trail.size() - 28 + i);
            plot("CONDITIONING · 28 DAYS", history, dates, MovementChart.Kind.LINE, BLUE, MovementActivity::integer).bounds(0, 100); fitness(deck.optJSONObject("fitness"));
            double[] shortLoad = onDays(deck.optJSONArray("load"), "short", dates), longLoad = onDays(deck.optJSONArray("load"), "long", dates);
            if (present(shortLoad) || present(longLoad)) loadPlot(shortLoad, longLoad, dates);
        }
        action("how it's calculated", () -> method(scores)).setTag("movement_method");
    }
    private void gauges(JSONObject deck) {
        JSONObject hrv = latest(deck.optJSONArray("hrv")), rest = latest(deck.optJSONArray("resting")); section("HRV");
        if (metric(hrv, "avg") == null) note("—", GRAY);
        else {
            metrics(new String[][]{{"HRV", integer(hrv.optDouble("avg")) + " ms"}, {"baseline", number(hrv, "baseline", " ms")}});
            double value = hrv.optDouble("avg"), low = hrv.optDouble("low", value), high = hrv.optDouble("high", value);
            MovementChart meter = new MovementChart(this, MovementChart.Kind.METER, new double[]{value}, new String[0], GREEN).bounds(Math.min(low, value) - 12, Math.max(high, value) + 12).baseline(hrv.optDouble("baseline", Double.NaN));
            if (metric(hrv, "low") != null && metric(hrv, "high") != null) meter.band(new double[]{low}, new double[]{high}); body.addView(meter);
            note(text(hrv, "status") + " · " + text(hrv, "date"), GRAY); if (metric(hrv, "low") != null) note("normal " + integer(low) + "–" + integer(high) + " ms", GRAY);
        }
        section("RESTING HR");
        if (metric(rest, "bpm") == null) note("—", GRAY);
        else {
            JSONArray all = deck.optJSONArray("resting"); double[] data = new double[all.length()]; for (int i = 0; i < data.length; i++) data[i] = all.optJSONObject(i) == null ? Double.NaN : all.optJSONObject(i).optDouble("bpm", Double.NaN);
            double avg = average(data), low = min(data), high = max(data); metrics(new String[][]{{"resting HR", number(rest, "bpm", " bpm")}, {"28-day avg", integer(avg) + " bpm"}});
            body.addView(new MovementChart(this, MovementChart.Kind.METER, new double[]{rest.optDouble("bpm")}, new String[0], YELLOW).bounds(low - 3, high + 3).baseline(avg)); note(text(rest, "date") + " · " + integer(low) + "–" + integer(high) + " bpm", GRAY);
        }
        section("LAST SLEEP"); JSONObject daily = deck.optJSONObject("daily"), night = latestSleep(daily == null ? null : daily.optJSONArray("days"));
        if (night == null) { note("—", GRAY); return; }
        JSONObject sleep = night.optJSONObject("sleep"), score = dated(deck.optJSONArray("sleep"), night.optString("date"));
        metrics(new String[][]{{"sleep", minutes(sleep.optDouble("total", Double.NaN))}, {"score", number(score, "score", "")}});
        double[] stages = new double[4]; String[] names = {"deep", "light", "rem", "awake"}; for (int i = 0; i < 4; i++) stages[i] = sleep.optDouble(names[i], Double.NaN);
        body.addView(new MovementChart(this, MovementChart.Kind.STACK, stages, new String[0], BLUE).title("Sleep stages")); metrics(new String[][]{{"deep", minutes(stages[0])}, {"light", minutes(stages[1])}, {"REM", minutes(stages[2])}, {"awake", minutes(stages[3])}}); note(night.optString("date"), GRAY);
        if (score != null && CorosData.string(score, "window") != null) note(text(score, "window").replaceAll("\\d{4}-\\d{2}-\\d{2} ", ""), GRAY);
        JSONObject hr = sleep.optJSONObject("hr"); if (hr != null) note("sleep HR " + number(hr, "avg", " bpm") + " · " + number(hr, "min", "") + "–" + number(hr, "max", ""), GRAY);
    }
    private void fitness(JSONObject fitness) {
        if (fitness == null) return; java.util.ArrayList<String[]> cells = new java.util.ArrayList<>();
        if (metric(fitness, "vo2max") != null) cells.add(new String[]{"VO2max", number(fitness, "vo2max", "")});
        if (metric(fitness, "level") != null) cells.add(new String[]{"running level", number(fitness, "level", "")});
        if (CorosData.string(fitness, "threshold") != null) cells.add(new String[]{"threshold", text(fitness, "threshold")});
        JSONArray predictions = fitness.optJSONArray("predictions"); if (predictions != null) for (int i = 0; i < predictions.length(); i++) { JSONArray p = predictions.optJSONArray(i); if (p != null && p.length() == 2) cells.add(new String[]{p.optString(0), p.optString(1)}); }
        if (!cells.isEmpty()) { section("FITNESS · COROS"); metrics(cells.toArray(new String[0][])); }
    }
    private void method(Scores.Result scores) {
        String[] methods = {
            "HRV against your COROS baseline (50%), resting heart rate against the previous 28 days (30%) and sleep against 8 hours plus extra after a hard day (20%). Missing inputs are excluded. An ordinary morning is near 60%; 67% and up is primed, below 34% is run down.",
            "Workout TRIMP weights minutes by average heart rate against a maximum of " + scores.maxHr + " bpm. Everyday steps outside workouts add load. The logarithmic scale is open-ended: 100% is about an hour of hard effort. The target follows your previous two weeks and today's recovery.",
            "Conditioning follows a 42-day weighted average of workout TRIMP on a 0–100 scale. The status compares your 7-day and 42-day load. Less than 28 days of history is still calibrating."
        };
        new android.app.AlertDialog.Builder(this).setTitle("Pocket " + new String[]{"recovery", "strain", "conditioning"}[selected]).setMessage(methods[selected] + "\n\nPocket estimates from COROS readings. Bevel's formulas are not public; these are not Bevel or COROS scores.").setPositiveButton("Close", null).show();
    }
    private CorosData.Activity findActivity(String id) { if (snapshot != null) for (CorosData.Activity item : snapshot.activities) if (item.id.equals(id)) return item; return null; }
    private void renderActivity(CorosData.Activity item) {
        int index = snapshot.activities.indexOf(item) + 1; note(item.type + " · " + date(item.day(ZoneId.systemDefault())) + (sample ? " · SAMPLE DATA" : " · " + index + "/" + snapshot.activities.size()), GRAY);
        TextView title = label(item.name, 32, WHITE); title.setTypeface(PocketFonts.pixel(this)); body.addView(title);
        JSONObject ready = details.get(item.id); if (sample) ready = MovementSample.detail(item); else if (ready == null) ready = repository.cachedDetail(item.id); if (ready != null) details.put(item.id, ready);
        boolean loading = loadingDetails.contains(item.id);
        if (ready == null && !errors.containsKey(item.id) && !loading && repository.connected()) { fetchDetail(item, false); loading = true; }
        JSONObject path = ready == null ? null : ready.optJSONObject("path");
        if (path != null) { MovementChart route = MovementChart.route(this, path); route.setTag("movement_route"); body.addView(route, new LinearLayout.LayoutParams(-1, dp(190))); }
        else { TextView empty = label(loading ? "LOADING FROM COROS…" : errors.containsKey(item.id) ? "ROUTE NOT AVAILABLE" : "NO GPS TRACK", PocketDesign.META, GRAY); empty.setGravity(Gravity.CENTER); body.addView(empty, new LinearLayout.LayoutParams(-1, dp(150))); }
        metrics(new String[][]{{"distance", decimal(item.km, 1) + " km"}, {"moving", moving(item.seconds)}, {item.paceLabel, item.pace == null ? "—" : item.pace}, {"climb", number(ready, "climb", " m")}, {"avg heart rate", item.hr > 0 ? item.hr + " bpm" : "—"}, {"kcal", item.kcal > 0 ? String.valueOf(item.kcal) : "—"}});
        if (loading) note("Loading activity…", GRAY); String error = errors.get(item.id); if (error != null) note(error, PocketDesign.WARNING);
        boolean partial = ready != null && ready.optBoolean("partial"); if (partial) note("Some activity data is unavailable", PocketDesign.WARNING);
        if (!sample && !loading && (ready == null || partial || error != null)) {
            if (repository.connected()) action("retry activity", () -> fetchDetail(item, true)).setTag("movement_detail_retry"); else action("reconnect COROS", this::connect).setTag("coros_connect");
        }
        if (ready == null) return;
        JSONObject series = ready.optJSONObject("series"); if (series != null) activityCharts(series, item.type.equals("RIDE"));
        JSONObject laps = ready.optJSONObject("laps"); JSONArray facts = ready.optJSONArray("detail");
        if (laps != null && laps.optJSONArray("laps") != null && laps.optJSONArray("laps").length() > 0 || series != null && series.optJSONArray("hrBands") != null && series.optJSONArray("hrBands").length() > 0 || facts != null && facts.length() > 0) {
            Button fold = action(more ? "− splits & metrics" : "+ splits & metrics", () -> { more = !more; render(); }); fold.setTag("movement_more"); fold.setContentDescription((more ? "Collapse" : "Expand") + " splits, time by heart rate and every metric");
            if (more) {
                splits(laps, item.type.equals("RIDE")); bands(series);
                if (facts != null && facts.length() > 0) {
                    section("EVERY METRIC · COROS");
                    for (int i = 0; i < facts.length(); i++) {
                        JSONArray pair = facts.optJSONArray(i);
                        if (pair != null && pair.length() >= 2) { note(pair.optString(0), GRAY); note(pair.optString(1), WHITE); }
                    }
                }
            }
        }
    }
    private void fetchDetail(CorosData.Activity item, boolean force) {
        if (loadingDetails.contains(item.id)) return; String requestOwner = owner; loadingDetails.add(item.id); errors.remove(item.id);
        load(() -> repository.detail(item, force), value -> {
            if (!requestOwner.equals(repository.detailOwner())) return; loadingDetails.remove(item.id); details.put(item.id, value);
            if ((activityId.equals(item.id) || !gymId.isEmpty()) && !settings && visible) render();
        }, error -> {
            if (!requestOwner.equals(repository.detailOwner())) return; loadingDetails.remove(item.id); errors.put(item.id, error.getMessage() == null ? "Activity unavailable" : error.getMessage());
            if ((activityId.equals(item.id) || !gymId.isEmpty()) && !settings && visible) render();
        });
        if (force) render();
    }
    private void activityCharts(JSONObject series, boolean ride) {
        String[] keys = {"pace", "hr", "altitude", "cadence", "power", "contact", "oscillation", "ratio", "step"};
        String[] names = {ride ? "SPEED" : "PACE", "HEART RATE", "ELEVATION", "CADENCE", "POWER", "GROUND CONTACT", "VERT. OSCILLATION", "VERT. RATIO", "STEP LENGTH"};
        double[] axis = MovementChart.array(series.optJSONArray("x")); if (axis.length == 0) return;
        String unit = series.optString("unit", "km"); String[] ticks = new String[axis.length]; for (int i = 0; i < ticks.length; i++) ticks[i] = decimal(axis[i], 2) + " " + unit;
        MovementChart.Cursor cursor = new MovementChart.Cursor(); int extra = 0; section("ALONG THE WAY"); final TextView readout = compact("average", PocketDesign.SMALL, GRAY); readout.setTag("movement_cursor");
        readout.setFocusable(true); readout.setClickable(true); readout.setMinHeight(dp(48)); readout.setContentDescription("Clear chart cursor and show averages"); readout.setOnClickListener(view -> cursor.set(-1));
        for (int channel = 0; channel < keys.length; channel++) {
            final int which = channel; double[] data = MovementChart.array(series.optJSONArray(keys[channel])); if (!present(data)) continue;
            if (channel >= 3) { extra++; if (!allCharts) continue; }
            if (data.length != axis.length) { int length = data.length; data = Arrays.copyOf(data, axis.length); if (length < axis.length) Arrays.fill(data, length, axis.length, Double.NaN); }
            if (channel == 0 && ride) for (int i = 0; i < data.length; i++) data[i] = data[i] > 0 ? 3600 / data[i] : Double.NaN;
            DoubleFunction<String> format = value -> channelValue(which, value, ride); final double[] values = data; final TextView reading = plotHead(names[channel], format.apply(average(values)));
            MovementChart chart = new MovementChart(this, MovementChart.Kind.LINE, data, ticks, channel == 0 ? GREEN : channel == 1 ? YELLOW : BLUE).invert(channel == 0 && !ride).title(names[channel]).format(format); chart.setTag("movement_chart_" + keys[channel]);
            chart.linked(cursor, point -> { reading.setText(format.apply(point >= 0 && point < values.length ? values[point] : average(values))); readout.setText(point >= 0 && point < ticks.length ? ticks[point] : "average"); }); body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150)));
        }
        body.addView(readout); if (extra > 0) action(allCharts ? "− fewer charts" : "+ " + extra + " more charts", () -> { allCharts = !allCharts; render(); }).setTag("movement_more_charts");
    }
    private static String channelValue(int channel, double value, boolean ride) {
        if (!Double.isFinite(value)) return "—";
        switch (channel) { case 0: return ride ? decimal(value, 1) + " km/h" : pace(value) + " /km"; case 1: return integer(value) + " bpm"; case 2: return integer(value) + " m"; case 3: return integer(value) + (ride ? " rpm" : " spm"); case 4: return integer(value) + " W"; case 5: return integer(value) + " ms"; case 6: return decimal(value / 10, 1) + " cm"; case 7: return decimal(value, 1) + "%"; default: return decimal(value / 1000, 2) + " m"; }
    }
    private void splits(JSONObject source, boolean ride) {
        JSONArray laps = source == null ? null : source.optJSONArray("laps"); if (laps == null || laps.length() == 0) return;
        section("SPLITS · " + decimal(source.optDouble("every"), 1) + " KM"); java.util.ArrayList<String> fields = new java.util.ArrayList<>(); fields.add("km"); fields.add(ride ? "speed" : "pace");
        for (String field : new String[]{"adjusted", "hr", "maxHr", "cadence", "power", "stride", "contact", "oscillation", "ratio", "climb", "descent"}) {
            if (ride && field.equals("adjusted")) continue; for (int i = 0; i < laps.length(); i++) if (metric(laps.optJSONObject(i), field) != null) { fields.add(field); break; }
        }
        Map<String, String> names = new HashMap<>(); String[][] pairs = {{"km", "KM"}, {"speed", "KM/H"}, {"pace", "PACE"}, {"adjusted", "ADJUSTED"}, {"hr", "HR"}, {"maxHr", "MAX HR"}, {"cadence", ride ? "RPM" : "SPM"}, {"power", "W"}, {"stride", "STRIDE"}, {"contact", "GCT"}, {"oscillation", "V.OSC"}, {"ratio", "V.RATIO"}, {"climb", "↑ M"}, {"descent", "↓ M"}};
        for (String[] pair : pairs) names.put(pair[0], pair[1]);
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setTag("movement_splits"); LinearLayout table = column(); table.addView(tableRow(fields.stream().map(names::get).toArray(String[]::new), GRAY, -1));
        double fastestSpeed = 0;
        for (int i = 0; i < laps.length(); i++) if (laps.optJSONObject(i) != null) fastestSpeed = Math.max(fastestSpeed, lapSpeed(laps.optJSONObject(i)));
        JSONArray fastest = source.optJSONArray("fastest"); double cumulative = 0;
        for (int i = 0; i < laps.length(); i++) {
            JSONObject lap = laps.optJSONObject(i); if (lap == null) continue; cumulative += lap.optDouble("km"); boolean best = false;
            if (fastest != null) for (int j = 0; j < fastest.length(); j++) if (fastest.optInt(j) == lap.optInt("index", i + 1)) best = true;
            String[] cells = new String[fields.size()]; for (int j = 0; j < cells.length; j++) cells[j] = fields.get(j).equals("km") ? decimal(cumulative, 2) : splitValue(lap, fields.get(j));
            LinearLayout line = tableRow(cells, best ? GREEN : WHITE, fastestSpeed > 0 ? lapSpeed(lap) / fastestSpeed : 0); line.setTag("movement_split_" + lap.optInt("index", i + 1)); table.addView(line);
        }
        scroll.addView(table, new HorizontalScrollView.LayoutParams(-2, -2)); body.addView(scroll, new LinearLayout.LayoutParams(-1, -2));
    }
    private static String splitValue(JSONObject lap, String key) {
        Double value = metric(lap, key); if (value == null) return "—";
        switch (key) { case "pace": case "adjusted": return pace(value); case "speed": return decimal(value, 1); case "stride": return decimal(value / 100, 2) + " m"; case "contact": return integer(value) + " ms"; case "oscillation": return decimal(value, 1) + " cm"; case "ratio": return decimal(value, 1) + "%"; default: return integer(value); }
    }
    private static double lapSpeed(JSONObject lap) { double pace = lap.optDouble("pace", 0), speed = lap.optDouble("speed", 0); return pace > 0 ? 3600 / pace : speed > 0 && Double.isFinite(speed) ? speed : 0; }
    private LinearLayout tableRow(String[] cells, int color, double fraction) {
        LinearLayout line = row(); line.setBackground(PocketDesign.separator(this));
        for (int i = 0; i < cells.length; i++) {
            TextView cell = compact(cells[i], PocketDesign.SMALL, color); cell.setPadding(dp(4), dp(10), dp(6), dp(10)); line.addView(cell, new LinearLayout.LayoutParams(dp(96), -2));
            if (i == 0) {
                LinearLayout track = row(); track.setPadding(dp(4), 0, dp(4), 0);
                if (fraction >= 0) { View bar = new View(this); bar.setBackgroundColor(color == GREEN ? GREEN : PocketDesign.LINE); track.addView(bar, new LinearLayout.LayoutParams(0, dp(8), (float) Math.max(.001, fraction))); track.addView(new View(this), new LinearLayout.LayoutParams(0, dp(8), (float) Math.max(0, 1 - fraction))); }
                line.addView(track, new LinearLayout.LayoutParams(dp(56), dp(32)));
            }
        }
        return line;
    }
    private void bands(JSONObject series) {
        JSONArray bands = series == null ? null : series.optJSONArray("hrBands"); if (bands == null || bands.length() == 0) return; section("TIME BY HEART RATE"); double top = 0;
        for (int i = 0; i < bands.length(); i++) if (bands.optJSONObject(i) != null) top = Math.max(top, bands.optJSONObject(i).optDouble("share"));
        for (int i = 0; i < bands.length(); i++) {
            JSONObject band = bands.optJSONObject(i); if (band == null || band.optDouble("share") < .005) continue; double share = band.optDouble("share"); int from = band.optInt("from"); LinearLayout line = row();
            line.addView(compact(from + "–" + (from + 9), 12, GRAY), new LinearLayout.LayoutParams(dp(76), -2));
            LinearLayout track = row(); View bar = new View(this); bar.setBackgroundColor(share == top ? YELLOW : GREEN); track.addView(bar, new LinearLayout.LayoutParams(0, dp(8), (float) (share / top))); track.addView(new View(this), new LinearLayout.LayoutParams(0, dp(8), (float) (1 - share / top)));
            line.addView(track, new LinearLayout.LayoutParams(0, -2, 1)); TextView percent = compact(integer(share * 100) + "%", 12, WHITE); percent.setGravity(Gravity.END); line.addView(percent, new LinearLayout.LayoutParams(dp(52), -2)); line.setPadding(0, dp(5), 0, dp(5)); line.setContentDescription(from + " to " + (from + 9) + " bpm, " + integer(share * 100) + " percent"); body.addView(line);
        }
    }
    private void connect() {
        if (busy) return; busy = true; load(repository::begin, url -> { busy = false; render(); startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void completeLogin() {
        if (busy || !visible || !repository.pending()) return; busy = true;
        load(repository::finish, done -> { busy = false; render(); if (done) refresh(true); else if (visible && repository.pending()) ui.postDelayed(claim, 3_000); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private void refresh(boolean force) {
        if (busy || !repository.connected()) return; busy = true; render(); load(() -> repository.refresh(force), value -> { busy = false; render(); }, error -> { busy = false; render(); message(error.getMessage()); });
    }
    private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView compact(String text, int size, int color) { TextView view = label(text, size, color); view.setPadding(0, dp(3), 0, dp(3)); return view; }
    private void note(String text, int color) { body.addView(compact(text, PocketDesign.SMALL, color)); }
    private void metrics(String[][] cells) {
        for (int offset = 0; offset < cells.length; offset += 2) {
            LinearLayout line = row(); line.setGravity(Gravity.TOP);
            for (int i = offset; i < Math.min(cells.length, offset + 2); i++) { LinearLayout cell = column(); cell.setPadding(0, dp(6), dp(10), dp(8)); TextView value = compact(cells[i][1], 26, WHITE); value.setTypeface(PocketFonts.pixel(this)); cell.addView(value); cell.addView(compact(cells[i][0], PocketDesign.META, GRAY)); line.addView(cell, new LinearLayout.LayoutParams(0, -2, 1)); } body.addView(line);
        }
    }
    private TextView plotHead(String title, String value) { LinearLayout line = row(); line.setPadding(0, dp(14), 0, 0); TextView name = compact(title, 11, GRAY), reading = compact(value, 13, WHITE); name.setMaxLines(2); reading.setGravity(Gravity.END); line.addView(name, new LinearLayout.LayoutParams(0, -2, 1)); line.addView(reading, new LinearLayout.LayoutParams(0, -2, 1)); body.addView(line); return reading; }
    private MovementChart plot(String title, double[] values, String[] dates, MovementChart.Kind kind, int color, DoubleFunction<String> format) {
        TextView reading = plotHead(title, format.apply(last(values))); String[] labels = Arrays.stream(dates).map(MovementActivity::shortDate).toArray(String[]::new); MovementChart chart = new MovementChart(this, kind, values, labels, color).title(title).format(format);
        chart.linked(new MovementChart.Cursor(), index -> reading.setText(index >= 0 && index < values.length ? shortDate(dates[index]) + " · " + format.apply(values[index]) : format.apply(last(values)))); body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150))); return chart;
    }
    private MovementChart trend(String title, JSONArray rows, String field, String[] dates, MovementChart.Kind kind, int color, DoubleFunction<String> format) { double[] values = onDays(rows, field, dates); return present(values) ? plot(title, values, dates, kind, color, format) : null; }
    private void loadPlot(double[] shortLoad, double[] longLoad, String[] dates) {
        TextView reading = plotHead("COROS LOAD · SHORT / LONG", integer(last(shortLoad)) + " / " + integer(last(longLoad)));
        MovementChart chart = new MovementChart(this, MovementChart.Kind.PAIR, shortLoad, Arrays.stream(dates).map(MovementActivity::shortDate).toArray(String[]::new), BLUE).paired(longLoad).title("COROS load: blue short-term, cream long-term");
        chart.linked(new MovementChart.Cursor(), index -> reading.setText(index >= 0 && index < shortLoad.length ? shortDate(dates[index]) + " · " + integer(shortLoad[index]) + " / " + integer(longLoad[index]) : integer(last(shortLoad)) + " / " + integer(last(longLoad))));
        body.addView(chart, new LinearLayout.LayoutParams(-1, dp(150)));
    }
    static double[] onDays(JSONArray rows, String field, String[] dates) {
        double[] values = new double[dates.length]; Arrays.fill(values, Double.NaN);
        for (int i = 0; i < dates.length; i++) { JSONObject row = dated(rows, dates[i]); if (row == null) continue; String[] path = field.split("\\."); for (int j = 0; j < path.length - 1 && row != null; j++) row = row.optJSONObject(path[j]); if (row != null) values[i] = row.optDouble(path[path.length - 1], Double.NaN); } return values;
    }
    private static JSONObject dated(JSONArray rows, String date) { if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && date.equals(row.optString("date"))) return row; } return null; }
    private static JSONObject latest(JSONArray rows) { JSONObject last = null; if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && (last == null || row.optString("date").compareTo(last.optString("date")) > 0)) last = row; } return last; }
    private static JSONObject latestSleep(JSONArray rows) { JSONObject last = null; if (rows != null) for (int i = 0; i < rows.length(); i++) { JSONObject row = rows.optJSONObject(i); if (row != null && row.optJSONObject("sleep") != null && (last == null || row.optString("date").compareTo(last.optString("date")) > 0)) last = row; } return last; }
    private static String[] dateKeys(LocalDate end, int count) { String[] dates = new String[count]; for (int i = 0; i < count; i++) dates[i] = end.minusDays(count - i - 1).toString(); return dates; }
    private static String date(LocalDate date) { return date.format(DateTimeFormatter.ofPattern("EEE, d MMM", Locale.getDefault())); }
    private static String shortDate(String date) { try { return LocalDate.parse(date).format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())); } catch (RuntimeException unknown) { return date; } }
    private static Double metric(JSONObject row, String key) { return CorosData.metric(row, key); }
    private static String text(JSONObject row, String key) { String value = row == null ? null : CorosData.string(row, key); return value == null ? "" : value; }
    private static String number(JSONObject row, String key, String unit) { Double value = metric(row, key); return value == null ? "—" : decimal(value, value == Math.rint(value) ? 0 : 1) + unit; }
    static String moving(int seconds) { int mins = Math.max(0, seconds) / 60; return mins >= 60 ? mins / 60 + "h " + mins % 60 + "m" : mins + "m"; }
    private static String minutes(double minutes) { return Double.isFinite(minutes) ? moving((int) Math.round(minutes * 60)) : "—"; }
    static String pace(double seconds) { if (!Double.isFinite(seconds) || seconds <= 0) return "—"; long rounded = Math.round(seconds); return rounded / 60 + ":" + String.format(Locale.ROOT, "%02d", rounded % 60); }
    private static String decimal(double value, int places) { return Double.isFinite(value) ? String.format(Locale.getDefault(), "%." + places + "f", value) : "—"; }
    private static String integer(double value) { return Double.isFinite(value) ? String.format(Locale.getDefault(), "%,d", Math.round(value)) : "—"; }
    private static boolean present(double[] data) { for (double value : data) if (Double.isFinite(value)) return true; return false; }
    private static double last(double[] data) { for (int i = data.length - 1; i >= 0; i--) if (Double.isFinite(data[i])) return data[i]; return Double.NaN; }
    private static double average(double[] data) { double sum = 0; int count = 0; for (double value : data) if (Double.isFinite(value)) { sum += value; count++; } return count > 0 ? sum / count : Double.NaN; }
    private static double min(double[] data) { double low = Double.POSITIVE_INFINITY; for (double value : data) if (Double.isFinite(value)) low = Math.min(low, value); return Double.isFinite(low) ? low : Double.NaN; }
    private static double max(double[] data) { double high = Double.NEGATIVE_INFINITY; for (double value : data) if (Double.isFinite(value)) high = Math.max(high, value); return Double.isFinite(high) ? high : Double.NaN; }
}
