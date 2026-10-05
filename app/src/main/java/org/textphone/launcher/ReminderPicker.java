package org.textphone.launcher;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import java.util.Calendar;

final class ReminderPicker {
    interface Picked{void accept(long value);}
    static void show(Activity owner,long value,Picked picked){Calendar date=Calendar.getInstance();date.setTimeInMillis(value>System.currentTimeMillis()?value:System.currentTimeMillis()+3600000);date.set(Calendar.SECOND,0);date.set(Calendar.MILLISECOND,0);
        new DatePickerDialog(owner,(p,y,m,d)->{date.set(Calendar.YEAR,y);date.set(Calendar.MONTH,m);date.set(Calendar.DAY_OF_MONTH,d);
            new TimePickerDialog(owner,(clock,h,min)->{date.set(Calendar.HOUR_OF_DAY,h);date.set(Calendar.MINUTE,min);picked.accept(date.getTimeInMillis());},date.get(Calendar.HOUR_OF_DAY),date.get(Calendar.MINUTE),owner.getSharedPreferences("text_phone",0).getBoolean("twenty_four_hour",android.text.format.DateFormat.is24HourFormat(owner))).show();
        },date.get(Calendar.YEAR),date.get(Calendar.MONTH),date.get(Calendar.DAY_OF_MONTH)).show();}
    private ReminderPicker(){}
}
