package org.textphone.launcher;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Date-only task deadlines follow the phone's local calendar, including DST changes. */
final class PlannerDates {
    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }
    static Date parse(String day) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US); format.setLenient(false);
        ParsePosition position = new ParsePosition(0); Date value = format.parse(day, position);
        if (!day.matches("\\d{4}-\\d{2}-\\d{2}") || value == null || position.getIndex() != day.length())
            throw new IllegalArgumentException("Choose a valid due date.");
        return value;
    }
    static void validate(String day) { if (!day.isEmpty()) parse(day); }
    static String day(int year, int month, int day) {
        String value = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day); validate(value); return value;
    }
    static Calendar calendar(String day) { Calendar value = Calendar.getInstance(); if (!day.isEmpty()) value.setTime(parse(day)); return value; }
    static String label(String due) {
        if (due.isEmpty()) return "No due date";
        String today = today();
        if (due.equals(today)) return "Today";
        String value = java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(parse(due));
        return due.compareTo(today) < 0 ? "Overdue · " + value : value;
    }
}
