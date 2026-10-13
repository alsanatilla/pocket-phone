package org.textphone.launcher;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.text.InputFilter;
import android.text.InputType;
import android.widget.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.Instant;
import java.util.LinkedHashMap;
import org.json.JSONArray;
import org.json.JSONObject;

final class MovementPlanEditor {
    static AlertDialog show(Activity activity, AgendaStore.Event original, LocalDate date, Runnable changed) {
        String owner=CorosRepository.get(activity).detailOwner();
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);int pad=PocketDesign.dp(activity,20);form.setPadding(pad,0,pad,0);
        EditText title=field(activity,form,"session",original==null?"":original.title,InputType.TYPE_CLASS_TEXT,500);
        TextView sportLabel=new TextView(activity);PocketDesign.text(sportLabel,PocketDesign.META,PocketDesign.MUTED);sportLabel.setText("sport");form.addView(sportLabel);
        Spinner sport=new Spinner(activity);sport.setContentDescription("sport");sport.setAdapter(new ArrayAdapter<>(activity,android.R.layout.simple_spinner_dropdown_item,MovementData.SPORTS));
        if(original!=null)sport.setSelection(java.util.Arrays.asList(MovementData.SPORTS).indexOf(original.training.optString("sport")));form.addView(sport);
        LocalDateTime[] when={original==null?date.atTime(18,0):Instant.ofEpochMilli(original.when).atZone(ZoneId.systemDefault()).toLocalDateTime()};
        if(original==null&&date.equals(LocalDate.now())&&when[0].isBefore(LocalDateTime.now()))when[0]=LocalDateTime.now().plusHours(1).withMinute(0).withSecond(0).withNano(0);
        Button dateButton=new Button(activity),timeButton=new Button(activity);PocketDesign.command(dateButton,false);PocketDesign.command(timeButton,false);
        Runnable labels=()->{dateButton.setText(when[0].toLocalDate().toString());timeButton.setText(when[0].toLocalTime().toString());};labels.run();
        dateButton.setOnClickListener(v->new DatePickerDialog(activity,(p,y,m,d)->{when[0]=LocalDate.of(y,m+1,d).atTime(when[0].toLocalTime());labels.run();},when[0].getYear(),when[0].getMonthValue()-1,when[0].getDayOfMonth()).show());
        timeButton.setOnClickListener(v->new TimePickerDialog(activity,(p,h,m)->{when[0]=when[0].toLocalDate().atTime(h,m);labels.run();},when[0].getHour(),when[0].getMinute(),android.text.format.DateFormat.is24HourFormat(activity)).show());form.addView(dateButton);form.addView(timeButton);
        EditText duration=field(activity,form,"minutes",String.valueOf(original==null?60:original.minutes),InputType.TYPE_CLASS_NUMBER,4);
        JSONArray saved=original==null?new JSONArray():original.training.optJSONArray("exercises");StringBuilder lines=new StringBuilder();for(int i=0;i<saved.length();i++){if(i>0)lines.append('\n');lines.append(saved.optString(i));}
        EditText names=field(activity,form,"exercises · one per line",lines.toString(),InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE,1829);names.setMinLines(3);
        sport.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int pos,long id){names.setVisibility(pos==0?android.view.View.VISIBLE:android.view.View.GONE);((android.view.View)names.getTag()).setVisibility(names.getVisibility());}});
        TextView error=new TextView(activity);PocketDesign.text(error,PocketDesign.META,PocketDesign.WARNING);form.addView(error);
        ScrollView scroll=new ScrollView(activity);scroll.addView(form);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle(original==null?"plan session":"edit session").setView(scroll).setNegativeButton("cancel",null).setPositiveButton("save",null).create();
        if(original!=null)dialog.setButton(AlertDialog.BUTTON_NEUTRAL,"remove",(d,w)->new AlertDialog.Builder(activity).setTitle("Remove this session?").setNegativeButton("cancel",null).setPositiveButton("remove",(confirm,which)->{if(owner.equals(CorosRepository.get(activity).detailOwner())){AgendaStore.delete(activity,original.id);changed.run();}}).show());
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(!owner.equals(CorosRepository.get(activity).detailOwner())){dialog.dismiss();return;}
            try{
                AgendaStore.Event current=original==null?null:AgendaStore.find(activity,original.id);
                if(original!=null&&(current==null||current.updated!=original.updated))throw new IllegalStateException("This session changed. Close and reopen it.");
                AgendaStore.Event event=original==null?new AgendaStore.Event():original.copy();event.title=title.getText().toString().trim();event.minutes=Integer.parseInt(duration.getText().toString());
                long at=when[0].atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();event.when=at;
                LinkedHashMap<String,String> unique=new LinkedHashMap<>();for(String name:names.getText().toString().split("\\n")){String clean=name.trim();if(!clean.isEmpty())unique.put(clean.toLowerCase(java.util.Locale.ROOT),clean);}
                JSONArray exercises=new JSONArray();if(sport.getSelectedItemPosition()==0)for(String name:unique.values())exercises.put(name);
                event.training=original==null?new JSONObject():MovementData.copy(original.training);event.training.put("sport",MovementData.SPORTS[sport.getSelectedItemPosition()]).put("exercises",exercises);
                if(!MovementData.validTraining(event.training))throw new IllegalArgumentException("Use up to 30 exercises, 60 characters each.");
                AgendaStore.validateMinutes(event.minutes);if(event.title.isEmpty())throw new IllegalArgumentException("Enter a session name.");
                if(original!=null&&event.alarm!=0){ClockStore.Entry alarm=ClockStore.find(activity,event.alarm);if(alarm!=null){AlarmScheduler.cancel(activity,alarm.id);alarm.due=Math.max(0,alarm.due+at-original.when);alarm.title=event.title;ClockStore.save(activity,alarm);if(alarm.due>System.currentTimeMillis()&&AlarmScheduler.allowed(activity))AlarmScheduler.arm(activity,alarm);}}
                AgendaStore.save(activity,event);dialog.dismiss();changed.run();
            }catch(Exception failure){error.setText(failure instanceof NumberFormatException?"Use 1 to 1440 minutes.":failure.getMessage());}
        }));dialog.show();return dialog;
    }
    private static EditText field(Activity a,LinearLayout host,String label,String value,int type,int limit){TextView l=new TextView(a);PocketDesign.text(l,PocketDesign.META,PocketDesign.MUTED);l.setText(label);host.addView(l);EditText input=new EditText(a);PocketDesign.text(input,PocketDesign.BODY,PocketDesign.CREAM);input.setInputType(type);input.setText(value);input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(limit)});input.setId(android.view.View.generateViewId());l.setLabelFor(input.getId());input.setContentDescription(label);input.setTag(l);host.addView(input);return input;}
    private MovementPlanEditor(){}
}
