package org.textphone.launcher;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/** A user-selected source becomes a task; accepting a write never replaces another editor's draft. */
public class TaskCaptureActivity extends PocketActivity {
    private CaptureDrafts.Draft draft;private EditText title;private Button save,reminder;private boolean submitted;
    static Intent intent(Context c,TaskSource source){return new Intent(c,TaskCaptureActivity.class).putExtra("task_source",source.json().toString());}
    @Override protected void onCreate(Bundle state){super.onCreate(state);screen("New task");
        if(state!=null)draft=CaptureDrafts.read(this,state.getString("draft_key"));
        if(draft==null&&!(this instanceof TaskShareActivity))draft=CaptureDrafts.read(this,getIntent().getStringExtra("draft_key"));
        if(draft==null&&state!=null&&state.containsKey("capture_source")){try{draft=new CaptureDrafts.Draft();draft.source=TaskSource.read(new org.json.JSONObject(state.getString("capture_source")));draft.key=state.getString("draft_key");draft.token=state.getString("capture_token");draft.title=state.getString("capture_title","");draft.remind=state.getLong("capture_remind");draft.task=state.getLong("capture_task");draft.issue=state.getString("capture_issue","");if(draft.source==null)draft=null;}catch(org.json.JSONException bad){draft=null;}}
        if(draft==null){TaskSource source;
            if(this instanceof TaskShareActivity){CharSequence text=Intent.ACTION_SEND.equals(getIntent().getAction())?getIntent().getCharSequenceExtra(Intent.EXTRA_TEXT):null;if(text==null||text.length()==0){message("Share text or a link to make a task.");return;}
                if(text.length()>8000){message("This shared text is too long. Select up to 8,000 characters.");return;}source=TaskSource.shared(getIntent().getStringExtra(Intent.EXTRA_SUBJECT),text.toString());}
            else {try{source=TaskSource.read(new org.json.JSONObject(getIntent().getStringExtra("task_source")));}catch(org.json.JSONException|NullPointerException bad){source=null;}}
            if(source==null){message("This capture is unavailable.");return;}String key=CaptureDrafts.key(source);draft=CaptureDrafts.read(this,key);
            if(draft==null){draft=new CaptureDrafts.Draft();draft.key=key;draft.token=java.util.UUID.randomUUID().toString();draft.source=source;String seed=source.title();draft.title=seed.substring(0,Math.min(500,seed.length()));}}
        if(draft.task>0){savedScreen(draft.task,draft.issue);return;}
        try{CaptureDrafts.save(this,draft);}catch(IllegalStateException full){draft=null;body.addView(label(full.getMessage(),16,GRAY));action("Open Today",()->startActivity(new Intent(this,OrganizerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));return;}
        title=input("Task title",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);title.setTag("task_capture_title");title.setMinLines(2);title.setMaxLines(4);title.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(500)});title.setText(draft.title);
        reminder=action(reminderLabel(),this::chooseReminder);reminder.setTag("task_capture_reminder");
        body.addView(label("Source · "+draft.source.name,14,GRAY));TextView source=label(draft.source.text,16,GRAY);source.setMaxLines(8);source.setEllipsize(android.text.TextUtils.TruncateAt.END);source.setTextIsSelectable(true);source.setTag("task_capture_source");body.addView(source);
        save=headerAction("save",this::save,true);save.setTag("task_capture_save");
    }
    private String reminderLabel(){return draft.remind==0?"Reminder · None":"Reminder · "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(new java.util.Date(draft.remind));}
    private void chooseReminder(){Runnable choose=()->ReminderPicker.show(this,draft.remind,value->{draft.remind=value;reminder.setText(reminderLabel());});if(draft.remind==0)choose.run();else new android.app.AlertDialog.Builder(this).setTitle("Reminder").setItems(new String[]{"Change time","Remove reminder"},(dialog,index)->{if(index==0)choose.run();else{draft.remind=0;reminder.setText(reminderLabel());}}).show();}
    private void save(){if(submitted||save==null||!save.isEnabled())return;String text=title.getText().toString().trim();if(text.isEmpty())throw new IllegalArgumentException("Enter a task title.");
        if(draft.remind!=0){if(draft.remind<=System.currentTimeMillis())throw new IllegalArgumentException("Choose a future reminder time.");
            if(Build.VERSION.SDK_INT>=33&&!permitted(Manifest.permission.POST_NOTIFICATIONS)){permissions(this::save,Manifest.permission.POST_NOTIFICATIONS);return;}
            if(Build.VERSION.SDK_INT>=31&&!AlarmScheduler.allowed(this)){message("Allow exact alarms, then tap save again.");startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:"+getPackageName())));return;}}
        draft.title=text;CaptureDrafts.save(this,draft);String key=draft.key,token=draft.token;TaskSource source=draft.source.token(token);long when=draft.remind;Context app=getApplicationContext();title.setEnabled(false);reminder.setEnabled(false);
        loadAction(save,()->{long id=new PlannerStore(app.getSharedPreferences("pocket_planner",0)).captureTask(text,source);String issue="";
            if(when>0)try{TaskReminders.set(app,id,when);}catch(RuntimeException failure){issue=failure.getMessage()==null?"Reminder could not be scheduled.":failure.getMessage();}
            CloudSync.changed(app);CaptureDrafts.accepted(app,key,token,id,issue);return new Object[]{id,issue};},result->{draft.task=(long)result[0];draft.issue=(String)result[1];submitted=true;CaptureDrafts.clear(this,key,token);savedScreen(draft.task,draft.issue);},error->{title.setEnabled(true);reminder.setEnabled(true);message(error.getMessage()==null?"Could not save. Your draft is kept.":error.getMessage());});}
    private void savedScreen(long task,String issue){submitted=true;if(title!=null)((android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(title.getWindowToken(),0);screen("Task saved");body.addView(label(draft.title,18,WHITE));if(issue!=null&&!issue.isEmpty())body.addView(label("Task saved. Reminder needs attention: "+issue,16,PocketDesign.WARNING));
        action("Open task",()->{CaptureDrafts.clear(this,draft.key,draft.token);startActivity(new Intent(this,OrganizerActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("pocket_task",task));finish();});action("Done",()->{CaptureDrafts.clear(this,draft.key,draft.token);finish();});}
    @Override protected void onPause(){if(draft!=null&&!submitted){if(title!=null)draft.title=title.getText().toString();try{CaptureDrafts.save(this,draft);}catch(IllegalStateException failure){message(failure.getMessage());}}super.onPause();}
    @Override protected void onSaveInstanceState(Bundle state){if(draft!=null){if(title!=null)draft.title=title.getText().toString();if(!submitted)try{CaptureDrafts.save(this,draft);}catch(IllegalStateException failure){message(failure.getMessage());}state.putString("draft_key",draft.key);state.putString("capture_source",draft.source.json().toString());state.putString("capture_token",draft.token);state.putString("capture_title",draft.title);state.putLong("capture_remind",draft.remind);state.putLong("capture_task",draft.task);state.putString("capture_issue",draft.issue);}super.onSaveInstanceState(state);}
}
