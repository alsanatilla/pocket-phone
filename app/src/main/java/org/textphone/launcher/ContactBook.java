package org.textphone.launcher;

import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.database.Cursor;
import android.provider.ContactsContract;
import java.util.ArrayList;
import java.util.List;

final class ContactBook {
    static final class Person { final long id; final String name; Person(long id, String name) { this.id = id; this.name = name == null ? "Unnamed" : name; } }
    static final class Detail { long raw; String name = "", phone = "", email = ""; final List<String> numbers = new ArrayList<>(); }
    static List<Person> list(ContentResolver resolver, String search) {
        List<Person> items = new ArrayList<>();
        try (Cursor c = resolver.query(ContactsContract.Contacts.CONTENT_URI,
                new String[]{"_id", "display_name"}, search.isEmpty() ? null : "display_name LIKE ?",
                search.isEmpty() ? null : new String[]{"%" + search + "%"}, "display_name COLLATE LOCALIZED ASC")) {
            if (c == null) throw new IllegalStateException("Contacts unavailable. Try again.");
            while (c.moveToNext()) items.add(new Person(c.getLong(0), c.getString(1)));
        } return items;
    }
    static Detail read(ContentResolver resolver, long id) {
        Detail result = new Detail();
        try (Cursor c = resolver.query(ContactsContract.Data.CONTENT_URI,
                new String[]{"raw_contact_id", "mimetype", "data1"}, "contact_id = ?", new String[]{Long.toString(id)}, "is_super_primary DESC, is_primary DESC")) {
            if (c != null) while (c.moveToNext()) {
                if (result.raw == 0) result.raw = c.getLong(0);
                String type = c.getString(1), value = c.getString(2);
                if (ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE.equals(type) && result.name.isEmpty()) {
                    result.name = value == null ? "" : value; result.raw = c.getLong(0);
                }
                if (ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE.equals(type) && value != null) {
                    if (result.phone.isEmpty()) result.phone = value; if (!result.numbers.contains(value)) result.numbers.add(value);
                }
                if (ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE.equals(type) && result.email.isEmpty()) result.email = value == null ? "" : value;
            }
        } if (result.raw == 0) throw new IllegalArgumentException("This contact was removed. Refresh contacts."); return result;
    }
    static void save(ContentResolver resolver, long raw, String name, String phone, String email) throws Exception { save(resolver, raw, name, phone, email, null); }
    static synchronized long save(ContentResolver resolver, long raw, String name, String phone, String email, String token) throws Exception {
        if (name.trim().isEmpty()) throw new IllegalArgumentException("Enter a name.");
        String marker = "vnd.android.cursor.item/vnd.org.textphone.save";
        if (raw == 0 && token != null) try (Cursor existing = resolver.query(ContactsContract.Data.CONTENT_URI,
                new String[]{"raw_contact_id"}, "mimetype = ? AND data1 = ?", new String[]{marker, token}, null)) {
            if (existing == null) throw new IllegalStateException("Contacts unavailable. Try again.");
            if (existing.moveToFirst()) raw = existing.getLong(0);
        }
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        if (raw == 0) ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue("account_type", null).withValue("account_name", null).build());
        String[] types = {ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
                ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE};
        String[] values = {name.trim(), phone.trim(), email.trim()};
        for (int i = 0; i < types.length; i++) {
            long existing = 0;
            if (raw != 0) try (Cursor c = resolver.query(ContactsContract.Data.CONTENT_URI, new String[]{"_id"},
                    "raw_contact_id = ? AND mimetype = ?", new String[]{Long.toString(raw), types[i]}, "is_primary DESC")) {
                if (c != null && c.moveToFirst()) existing = c.getLong(0);
            }
            if (existing != 0) ops.add(ContentProviderOperation.newUpdate(ContactsContract.Data.CONTENT_URI)
                    .withSelection("_id = ?", new String[]{Long.toString(existing)}).withValue("data1", values[i]).build());
            else if (!values[i].isEmpty()) {
                ContentProviderOperation.Builder insert = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                        .withValue("mimetype", types[i]).withValue("data1", values[i]);
                if (i > 0) insert.withValue("data2", i == 1 ? 2 : 1);
                if (raw == 0) insert.withValueBackReference("raw_contact_id", 0); else insert.withValue("raw_contact_id", raw);
                ops.add(insert.build());
            }
        }
        if (raw == 0 && token != null) ops.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference("raw_contact_id", 0).withValue("mimetype", marker).withValue("data1", token).build());
        android.content.ContentProviderResult[] result = resolver.applyBatch(ContactsContract.AUTHORITY, ops);
        return raw != 0 ? raw : android.content.ContentUris.parseId(result[0].uri);
    }
}
