package org.textphone.launcher;

import android.Manifest;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.view.View;
import java.util.Calendar;

public final class AgendaActivity extends PocketActivity {
    private boolean editing, direct; private int generation;
    private Calendar selected; private EditText title; private CheckBox remind; private int durationMinutes = 60;
    private Button saveControl;
    private boolean showPast;
    private static final class Row {
        final long when,end;final String title,meta;final Runnable open;final long id;final boolean allDay;
        Row(long when,long end,String title,String meta,long id,boolean allDay,Runnable open){this.when=when;this.end=end;this.title=title;this.meta=meta;this.id=id;this.allDay=allDay;this.open=open;}
    }
    @Override protected void onCreate(Bundle state) { super.onCreate(state);
        if(state!=null)showPast=state.getBoolean("show_past");
        if (state != null && state.getBoolean("editing")) { AgendaStore.Event e = new AgendaStore.Event(); e.id = state.getLong("id"); e.task = state.getLong("task"); e.alarm = state.getLong("alarm");
            e.google = state.getLong("google"); e.calendar = state.getLong("calendar");
            e.when = state.getLong("when"); e.minutes=state.getInt("minutes",60); e.title = state.getString("title", ""); editor(e); remind.setChecked(state.getBoolean("remind")); }
        else if (state == null && getIntent().hasExtra("title")) { AgendaStore.Event e = new AgendaStore.Event(); e.title = getIntent().getStringExtra("title"); e.task = getIntent().getLongExtra("task", 0); e.when = System.currentTimeMillis() + 3600000; editor(e); }
        else if(state == null && getIntent().getLongExtra("appointment_id",0)>0){AgendaStore.Event e=AgendaStore.find(this,getIntent().getLongExtra("appointment_id",0));if(e!=null)editor(e);else listing();}
        else listing();
        // Opened straight into one appointment from elsewhere: Back returns there instead of to the timeline.
        direct = state != null ? state.getBoolean("direct") : editing;
        if(getIntent().getBooleanExtra("app_settings",false))ui.post(this::agendaSettings);
    }
    private AgendaStore.Event current;
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (intent.hasExtra("title")) {
        AgendaStore.Event event = new AgendaStore.Event(); event.title = intent.getStringExtra("title"); event.task = intent.getLongExtra("task", 0); event.when = System.currentTimeMillis() + 3600000; editor(event);
    } else if(intent.getLongExtra("appointment_id",0)>0){AgendaStore.Event event=AgendaStore.find(this,intent.getLongExtra("appointment_id",0));if(event!=null)editor(event);else listing();}else if (!editing) listing();if(intent.hasExtra("title")||intent.getLongExtra("appointment_id",0)>0)direct=editing;if(intent.getBooleanExtra("app_settings",false))agendaSettings(); }
    private String formatted() { return java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(selected.getTime()); }
    private void listing() { editing = false; direct = false; title=null;generation++; screen("agenda");
        AgendaDraft.Value storedDraft=AgendaDraft.read(this);
        if(storedDraft!=null&&storedDraft.event.id!=0){AgendaStore.Event saved=AgendaStore.find(this,storedDraft.event.id);
            if(saved!=null&&saved.title.equals(storedDraft.event.title.trim())&&saved.when/60000==storedDraft.event.when/60000&&saved.minutes==storedDraft.event.minutes&&(saved.alarm!=0)==storedDraft.remind){AgendaDraft.clear(this,storedDraft.event.id);storedDraft=null;}}
        final AgendaDraft.Value draft=storedDraft;
        LinearLayout filters=tabs(new String[]{"upcoming","past"},showPast?1:0,()->{showPast=false;listing();},()->{showPast=true;listing();});filters.setTag("agenda_filters");body.removeView(filters);root.addView(filters,1,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout timeline=new LinearLayout(this);timeline.setOrientation(LinearLayout.VERTICAL);timeline.setTag("agenda_timeline");body.addView(timeline,new LinearLayout.LayoutParams(-1,-2));
        java.util.List<AgendaStore.Event> events=AgendaStore.list(this);java.util.List<Row> rows=new java.util.ArrayList<>();
        for(AgendaStore.Event e:events)rows.add(new Row(e.when,e.end(),e.title,(e.alarm!=0?"Reminder · ":"")+"Pocket calendar",e.id,false,()->editor(e)));
        renderTimeline(timeline,rows);
        appSettings(this::agendaSettings);
        LinearLayout actions=draft==null?softKeys(new String[]{"+ appointment"},0,this::newAppointment)
                :softKeys(new String[]{"+ appointment","continue draft"},0,this::newAppointment,()->{editor(draft.event);remind.setChecked(draft.remind);});
        actions.setTag("agenda_actions");
        if(draft!=null){View resume=actions.getChildAt(1);resume.setTag("agenda_continue_draft");resume.setContentDescription("Continue draft · "+(draft.event.title.isEmpty()?"Untitled":draft.event.title));}
    }
    private void newAppointment(){AgendaDraft.Value draft=AgendaDraft.read(this);if(draft!=null&&draft.event.id==0){editor(draft.event);remind.setChecked(draft.remind);return;}AgendaStore.Event event=new AgendaStore.Event();event.when=System.currentTimeMillis()+3600000;event.title="";editor(event);}
    private void agendaSettings(){new android.app.AlertDialog.Builder(this).setTitle("Pocket calendar").setMessage("Appointments save on this device first. Connect your other devices in Storage & devices.").setPositiveButton("Storage & devices",(dialog,index)->startActivity(new Intent(this,CloudActivity.class))).setNegativeButton("Close",null).show();}
    private void renderTimeline(LinearLayout target,java.util.List<Row> rows) {
        target.removeAllViews();java.util.Collections.sort(rows,(a,b)->showPast?Long.compare(b.when,a.when):Long.compare(a.when,b.when));
        Calendar midnight=Calendar.getInstance();midnight.set(Calendar.HOUR_OF_DAY,0);midnight.set(Calendar.MINUTE,0);midnight.set(Calendar.SECOND,0);midnight.set(Calendar.MILLISECOND,0);
        long today=midnight.getTimeInMillis();midnight.add(Calendar.DAY_OF_MONTH,1);long tomorrow=midnight.getTimeInMillis();midnight.add(Calendar.DAY_OF_MONTH,1);long afterTomorrow=midnight.getTimeInMillis();
        String day="";int count=0;for(Row entry:rows){if(showPast?entry.end>today:entry.end<=today)continue;count++;
            String date=new java.text.SimpleDateFormat("EEE d MMM yyyy",java.util.Locale.getDefault()).format(new java.util.Date(entry.when));
            String key=entry.when>=today&&entry.when<tomorrow?"Today · "+date:entry.when>=tomorrow&&entry.when<afterTomorrow?"Tomorrow · "+date:date;
            if(!key.equals(day)){TextView group=label(key,12,WHITE);PocketDesign.section(group,day.isEmpty());target.addView(group);day=key;}
            LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.TOP);LinearLayout time=new LinearLayout(this);time.setOrientation(LinearLayout.VERTICAL);time.setPadding(0,dp(12),dp(12),dp(12));
            boolean use24=getSharedPreferences("text_phone",0).getBoolean("twenty_four_hour",android.text.format.DateFormat.is24HourFormat(this));
            time.addView(ReadableRows.text(this,entry.allDay?"All day":new java.text.SimpleDateFormat(use24?"HH:mm":"h:mm",java.util.Locale.getDefault()).format(new java.util.Date(entry.when)),entry.allDay?12:18,WHITE));
            if(!entry.allDay&&!use24)time.addView(ReadableRows.text(this,new java.text.SimpleDateFormat("a",java.util.Locale.getDefault()).format(new java.util.Date(entry.when)),12,GRAY));
            if(!entry.allDay){String endDate=new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT).format(new java.util.Date(entry.end));String startDate=new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT).format(new java.util.Date(entry.when));
                time.addView(ReadableRows.text(this,new java.text.SimpleDateFormat(use24?"HH:mm":"h:mm a",java.util.Locale.getDefault()).format(new java.util.Date(entry.end))+(startDate.equals(endDate)?"":"\n"+new java.text.SimpleDateFormat("d MMM",java.util.Locale.getDefault()).format(new java.util.Date(entry.end))),12,GRAY));}
            row.addView(time,new LinearLayout.LayoutParams(dp(84),-2));LinearLayout item=ReadableRows.item(this,entry.title,entry.meta,GRAY,"agenda_event_"+entry.id,null);row.addView(item,new LinearLayout.LayoutParams(0,-2,1));
            row.setTag("agenda_event_"+entry.id);row.setMinimumHeight(dp(72));row.setFocusable(true);PocketDesign.list(row);row.setOnClickListener(v->entry.open.run());
            row.setContentDescription(key+", "+(entry.allDay?"All day":android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(entry.when))+" until "+java.text.DateFormat.getDateTimeInstance().format(new java.util.Date(entry.end)))+", "+entry.title+", "+entry.meta);
            time.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);item.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            target.addView(row,new LinearLayout.LayoutParams(-1,-2));
        }
        if(count==0)target.addView(label(showPast?"No past appointments":"No upcoming appointments",16,GRAY));
    }
    private void editor(AgendaStore.Event e) { editing = true; generation++; current = e.copy(); durationMinutes=e.minutes; screen("appointment", "appointment:"+e.id); selected = Calendar.getInstance(); selected.setTimeInMillis(e.when); selected.set(Calendar.SECOND, 0); selected.set(Calendar.MILLISECOND, 0);
        title = input("Title", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); title.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(500)}); title.setText(e.title); title.setTag("appointment_title");
        Button date = action(formatted(), () -> new DatePickerDialog(this, (p, y, m, d) -> {
            selected.set(Calendar.YEAR, y); selected.set(Calendar.MONTH, m); selected.set(Calendar.DAY_OF_MONTH, d); updateDate();
        }, selected.get(Calendar.YEAR), selected.get(Calendar.MONTH), selected.get(Calendar.DAY_OF_MONTH)).show()); date.setTag("appointment_date");
        action("set time", () -> new TimePickerDialog(this, (p, h, m) -> { selected.set(Calendar.HOUR_OF_DAY, h); selected.set(Calendar.MINUTE, m); updateDate(); }, selected.get(Calendar.HOUR_OF_DAY), selected.get(Calendar.MINUTE), true).show());
        action(durationLabel(), this::chooseDuration).setTag("appointment_duration");
        remind = new CheckBox(this); remind.setText("Remind at appointment time"); PocketDesign.text(remind, PocketDesign.BODY, WHITE); remind.setMinHeight(dp(PocketDesign.CONTROL)); remind.setChecked(e.alarm != 0); body.addView(remind);
        saveControl = action("save", this::save);
        PocketDesign.primary(saveControl);
        if (e.task != 0) action("open tasks", () -> startActivity(new Intent(this, OrganizerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("pocket_task",e.task)));
        if (e.id != 0) action("delete", () -> confirm("Delete this appointment?", () -> load(() -> {
            AgendaSync.delete(this, e.id);AgendaDraft.clear(this,e.id);return true;
        }, ignored -> listing())));
    }
    private void updateDate() { ((Button) body.findViewWithTag("appointment_date")).setText(formatted()); Button duration=body.findViewWithTag("appointment_duration");if(duration!=null)duration.setText(durationLabel()); }
    private String durationLabel(){return "Duration · "+durationMinutes+" min\nUntil "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM,java.text.DateFormat.SHORT).format(new java.util.Date(selected.getTimeInMillis()+durationMinutes*60000L));}
    private void chooseDuration(){int page=generation;int[] values={15,30,45,60,90,120,180};String[] labels={"15 min","30 min","45 min","60 min","90 min","120 min","180 min","Other duration"};
        new android.app.AlertDialog.Builder(this).setTitle("Duration").setItems(labels,(dialog,index)->{if(closed||page!=generation||!editing)return;if(index<values.length){durationMinutes=values[index];updateDate();}else{
            EditText minutes=new EditText(this);minutes.setInputType(InputType.TYPE_CLASS_NUMBER);PocketDesign.input(minutes);minutes.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4)});minutes.setText(Integer.toString(durationMinutes));minutes.setTag("duration_minutes");
            android.app.AlertDialog custom=new android.app.AlertDialog.Builder(this).setTitle("Duration in minutes").setView(minutes).setNegativeButton("Cancel",null).setPositiveButton("Set",null).create();custom.setOnShowListener(ignored->custom.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{if(closed||page!=generation||!editing){custom.dismiss();return;}try{int value=Integer.parseInt(minutes.getText().toString());AgendaStore.validateMinutes(value);durationMinutes=value;updateDate();custom.dismiss();}catch(IllegalArgumentException error){minutes.setError("Use 1 to 1440 minutes.");}}));custom.show();
        }}).setNegativeButton("Cancel",null).show();}
    private void save() { String value = title.getText().toString().trim(); if (value.isEmpty()) throw new IllegalArgumentException("Enter a title.");
        if (remind.isChecked()) {
            if (selected.getTimeInMillis() <= System.currentTimeMillis()) throw new IllegalArgumentException("Choose a future time for a reminder.");
            if (Build.VERSION.SDK_INT >= 33 && !permitted(Manifest.permission.POST_NOTIFICATIONS)) { permissions(this::save, Manifest.permission.POST_NOTIFICATIONS); return; }
            if (!AlarmScheduler.allowed(this)) { message("Allow exact alarms, then save again."); startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + getPackageName()))); return; }
        }
        if (!saveControl.isEnabled()) return;
        if (current.id == 0) current.id = AgendaStore.reserveId(this);
        AgendaStore.Event snapshot = current.copy(); snapshot.title = value; snapshot.when = selected.getTimeInMillis(); snapshot.minutes=durationMinutes;
        boolean reminder = remind.isChecked(); snapshot.syncPending = false;
        android.content.Context application = getApplicationContext();
        loadAction(saveControl, () -> {
            synchronized (AgendaStore.class) {
            AgendaStore.Event stored = AgendaStore.find(application, snapshot.id);
            if (snapshot.alarm == 0 && stored != null) snapshot.alarm = stored.alarm;
            ClockStore.Entry previous = snapshot.alarm == 0 ? null : ClockStore.find(application, snapshot.alarm);
            ClockStore.Entry alarm = null;
            if (reminder) { alarm = new ClockStore.Entry(); alarm.id = snapshot.alarm; alarm.kind = "reminder"; alarm.title = snapshot.title; alarm.due = snapshot.when; alarm.enabled = true;
                alarm.task=snapshot.task;AlarmScheduler.saveAndArm(application, alarm); snapshot.alarm = alarm.id; }
            else snapshot.alarm = 0;
            try { AgendaStore.save(application, snapshot); }
            catch (RuntimeException failure) {
                if (alarm != null) { if (previous == null) { ClockStore.delete(application, alarm.id); AlarmScheduler.cancel(application, alarm.id); } else AlarmScheduler.saveAndArm(application, previous); }
                throw failure;
            }
            if (!reminder && previous != null) { ClockStore.delete(application, previous.id); AlarmScheduler.cancel(application, previous.id); }
            CloudSync.changed(application);
            return snapshot;
            }
        }, saved -> {
            current = saved;
            if (value.equals(title.getText().toString().trim()) && saved.when == selected.getTimeInMillis() && saved.minutes==durationMinutes && reminder == remind.isChecked()) {
                AgendaDraft.clear(this,saved.id);AgendaDraft.clear(this,0);
                if(direct)finish();else{listing();message("Saved.");}
            } else message("Saved the tapped version. Your newer edits are still here.");
        });
    }
    private void keepDraft(){if(!editing||current==null||title==null)return;String text=title.getText().toString();AgendaStore.Event saved=current.id==0?null:AgendaStore.find(this,current.id);
        if(saved!=null&&saved.title.equals(text)&&saved.when/60000==selected.getTimeInMillis()/60000&&saved.minutes==durationMinutes&&(saved.alarm!=0)==remind.isChecked()){AgendaDraft.clear(this,current.id);return;}
        if(text.isEmpty()&&current.id==0&&selected.getTimeInMillis()/60000==current.when/60000&&durationMinutes==current.minutes&&!remind.isChecked())return;
        AgendaStore.Event draft=current.copy();draft.title=text;draft.when=selected.getTimeInMillis();draft.minutes=durationMinutes;AgendaDraft.save(this,draft,remind.isChecked());}
    @Override protected void onResume(){super.onResume();if(!editing)listing();}
    @Override protected void onPause(){keepDraft();super.onPause();}
    @Override protected void onSaveInstanceState(Bundle out) {out.putBoolean("show_past",showPast); out.putBoolean("direct", direct); out.putBoolean("editing", editing && current != null && title != null); if (editing && current != null && title != null) { out.putLong("id", current.id); out.putLong("task", current.task); out.putLong("alarm", current.alarm);
        out.putLong("google", current.google); out.putLong("calendar", current.calendar);
        out.putLong("when", selected.getTimeInMillis()); out.putInt("minutes",durationMinutes); out.putString("title", title.getText().toString()); out.putBoolean("remind", remind.isChecked()); } super.onSaveInstanceState(out); }
    @Override protected boolean hasInternalBack() { return editing && !direct; }
    @Override public void onBackPressed() { if (editing) keepDraft(); if (editing && !direct) back(this::listing); else super.onBackPressed(); }
}
