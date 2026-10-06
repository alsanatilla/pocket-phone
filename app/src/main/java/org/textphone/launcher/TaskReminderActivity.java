package org.textphone.launcher;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;

public final class TaskReminderActivity extends PocketActivity {
    private long task,when;private Button date,save;
    @Override protected void onCreate(Bundle state){super.onCreate(state);task=getIntent().getLongExtra("task",0);PlannerStore.Entry entry=new PlannerStore(getSharedPreferences("pocket_planner",0)).find(task);screen("reminder");
        if(entry==null||entry.done){body.addView(label("This task is completed or removed.",16,GRAY));return;}body.addView(label(entry.text,18,WHITE));ClockStore.Entry previous=TaskReminders.find(this,task);when=state!=null?state.getLong("when"):previous!=null&&previous.enabled?previous.due:System.currentTimeMillis()+3600000;
        date=action("",()->ReminderPicker.show(this,when,value->{when=value;updateDate();}));date.setTag("task_reminder_date");updateDate();save=headerAction("save",this::save,true);save.setTag("task_reminder_save");
        if(previous!=null)action("remove reminder",()->loadAction(save,()->{TaskReminders.cancel(getApplicationContext(),task);return true;},done->finish()));
        body.addView(label("Completing this task cancels its reminders. Reopening it keeps reminders off until you set one.",14,GRAY));}
    private void updateDate(){date.setText(java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM,java.text.DateFormat.SHORT).format(new java.util.Date(when)));}
    private void save(){if(when<=System.currentTimeMillis())throw new IllegalArgumentException("Choose a future reminder time.");if(Build.VERSION.SDK_INT>=33&&!permitted(Manifest.permission.POST_NOTIFICATIONS)){permissions(this::save,Manifest.permission.POST_NOTIFICATIONS);return;}
        if(Build.VERSION.SDK_INT>=31&&!AlarmScheduler.allowed(this)){message("Allow exact alarms, then tap save again.");startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,android.net.Uri.parse("package:"+getPackageName())));return;}
        long time=when;android.content.Context app=getApplicationContext();loadAction(save,()->{TaskReminders.set(app,task,time);return time;},saved->{if(when==saved)finish();else message("Saved the tapped time. Your newer choice is still here.");});}
    @Override protected void onSaveInstanceState(Bundle state){state.putLong("when",when);super.onSaveInstanceState(state);}
}
