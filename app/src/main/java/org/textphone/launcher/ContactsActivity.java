package org.textphone.launcher;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.provider.ContactsContract;
import java.util.List;

public final class ContactsActivity extends PocketActivity {
    private volatile int generation;
    private String searchText = ""; private Runnable pendingSearch;
    private boolean detail; private long detailId; private boolean resumedOnce, hadAccess;
    private boolean editing; private long editingId; private ContactBook.Detail editingPerson;
    private EditText editName, editPhone, editEmail;
    private String editToken;
    @Override protected void onCreate(Bundle state) { super.onCreate(state);
        if (state != null && state.getBoolean("editing")) { ContactBook.Detail person = new ContactBook.Detail(); person.raw = state.getLong("raw");
            person.name = state.getString("original_name", ""); person.phone = state.getString("original_phone", ""); person.email = state.getString("original_email", ""); editor(state.getLong("id"), person);editName.setText(state.getString("name",""));editPhone.setText(state.getString("phone",""));editEmail.setText(state.getString("email","")); editToken = state.getString("save_token", editToken); }
        else { if (state != null) searchText = state.getString("search", ""); if(state!=null&&state.getLong("detail_id")!=0)show(state.getLong("detail_id"));else listing(); }
        hadAccess=permitted(Manifest.permission.READ_CONTACTS);
    }
    private void listing() {
        if (pendingSearch != null) ui.removeCallbacks(pendingSearch); detail = editing = false; screen("contacts");appSettings(()->new android.app.AlertDialog.Builder(this).setTitle("Contacts settings").setItems(new String[]{"Allow contacts","Android app settings"},(dialog,index)->{if(index==0)permissions(this::listing,Manifest.permission.READ_CONTACTS);else NotificationAccess.appInfo(this);}).setNegativeButton("Close",null).show());
        if (!permitted(Manifest.permission.READ_CONTACTS)) {
            body.addView(label("Contacts access is off. Open Settings to allow the address book.",16,GRAY));return;
        }
        EditText query = input("Search names", InputType.TYPE_CLASS_TEXT); query.setTag("contact_search"); query.setText(searchText); query.setSelection(query.length());
        action("+ contact", () -> permissions(() -> beginEdit(0, new ContactBook.Detail()), Manifest.permission.WRITE_CONTACTS));
        ContactDraft.Value draft=ContactDraft.read(this);if(draft!=null)action("continue draft",()->permissions(()->resumeDraft(draft),Manifest.permission.WRITE_CONTACTS));
        LinearLayout list = new LinearLayout(this); list.setOrientation(LinearLayout.VERTICAL); body.addView(list);
        Runnable search = () -> { int current = ++generation; String term = query.getText().toString().trim(); loadPage(() -> current == generation ? ContactBook.list(getContentResolver(), term) : java.util.Collections.<ContactBook.Person>emptyList(), values -> {
            if (current != generation || detail) return; list.removeAllViews();
            if (values.isEmpty()) list.addView(label("No contacts", 14, GRAY));
            for (ContactBook.Person person : values) list.addView(item(person.name, () -> show(person.id)), new LinearLayout.LayoutParams(-1, -2));
        }); };
        pendingSearch = search;
        query.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int c, int f) {} public void onTextChanged(CharSequence s, int a, int b, int c) { searchText = s.toString(); generation++; ui.removeCallbacks(search); ui.postDelayed(search, 100); }
            public void afterTextChanged(Editable e) {} }); search.run();
    }
    private void show(long id) { if (pendingSearch != null) ui.removeCallbacks(pendingSearch); detail = true; detailId=id; editing = false; generation++; int current = generation;
        screen("contact", "contact:" + id); body.addView(label("Loading contact…", 14, GRAY));
        loadPage(() -> ContactBook.read(getContentResolver(), id), person -> {
        if (current != generation || !detail) return;
        body.removeAllViews(); body.addView(label(person.name, 22, WHITE));
        for (String number : person.numbers) { body.addView(label(number, 18, WHITE));
            commands(body, new String[]{"call", "message"}, 0, () -> startActivity(new Intent(this, PhoneActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("number", number)),
                    () -> startActivity(new Intent(this, MessagesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("address", number))); }
        if (!person.email.isEmpty()) {android.widget.TextView email=label(person.email,15,GRAY);email.setTextIsSelectable(true);body.addView(email);}
        action("edit", () -> permissions(() -> beginEdit(id, person), Manifest.permission.WRITE_CONTACTS));
        action("delete", () -> permissions(() -> confirm("Delete this contact?", () -> load(() ->
                getContentResolver().delete(android.content.ContentUris.withAppendedId(ContactsContract.Contacts.CONTENT_URI, id), null, null), ignored -> listing())), Manifest.permission.WRITE_CONTACTS));
    }); }
    private void beginEdit(long id,ContactBook.Detail person){ContactDraft.Value draft=ContactDraft.read(this);if(draft==null){editor(id,person);return;}if(draft.id==id){resumeDraft(draft);return;}
        new android.app.AlertDialog.Builder(this).setTitle("Unfinished contact").setMessage("Keep editing your draft or discard it to start this contact.").setNegativeButton("Cancel",null).setNeutralButton("Continue draft",(d,w)->resumeDraft(draft)).setPositiveButton("Discard draft",(d,w)->{ContactDraft.clear(this,draft.token);editor(id,person);}).show();}
    private void resumeDraft(ContactDraft.Value draft){if(draft.id==0){editor(0,draft.person);editToken=draft.token;return;}loadPage(()->ContactBook.read(getContentResolver(),draft.id),saved->{editor(draft.id,saved);editName.setText(draft.person.name);editPhone.setText(draft.person.phone);editEmail.setText(draft.person.email);editToken=draft.token;});}
    private void editor(long id, ContactBook.Detail person) { detail = editing = true; detailId=id; editingId = id; editingPerson = person; editToken = java.util.UUID.randomUUID().toString(); generation++; screen(id == 0 ? "+ contact" : "edit contact");
        EditText name = input("Name", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);name.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(500)});name.setTag("contact_name"); name.setText(person.name);
        EditText phone = input("Phone", InputType.TYPE_CLASS_PHONE);phone.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(200)});phone.setTag("contact_phone"); phone.setText(person.phone);
        EditText email = input("Email", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);email.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(500)});email.setTag("contact_email"); email.setText(person.email);
        editName = name; editPhone = phone; editEmail = email;
        if (person.numbers.size() > 1) body.addView(label("Edits the primary number; other numbers are kept.", 12, GRAY));
        android.widget.Button save = action("save", () -> {});
        PocketDesign.primary(save);
        save.setOnClickListener(control -> { String n = name.getText().toString(), p = phone.getText().toString(), e = email.getText().toString(), token = editToken;
            loadAction(control, () -> {long raw=ContactBook.save(getContentResolver(), person.raw, n, p, e, token);ContactDraft.accepted(getApplicationContext(),token,raw,n,p,e);return raw;}, raw -> {
                person.raw = raw;
                if (n.equals(name.getText().toString()) && p.equals(phone.getText().toString()) && e.equals(email.getText().toString())) {ContactDraft.clear(this,token);listing();}
                else message("Saved the tapped version. Your newer edits are still here.");
            }); });
        action("discard draft",()->confirm("Discard this contact draft?",()->{ContactDraft.clear(this,editToken);editing=false;if(id==0)back(this::listing);else back(()->show(id));}));
    }
    private void keepDraft(){if(!editing||editName==null)return;String name=editName.getText().toString(),phone=editPhone.getText().toString(),email=editEmail.getText().toString();
        if(editingId==0&&name.isEmpty()&&phone.isEmpty()&&email.isEmpty())return;
        if(editingId!=0&&name.equals(editingPerson.name)&&phone.equals(editingPerson.phone)&&email.equals(editingPerson.email)){ContactDraft.clear(this,editToken);return;}
        ContactDraft.save(this,editingId,editingPerson.raw,name,phone,email,editToken);}
    @Override protected void onPause(){keepDraft();super.onPause();}
    @Override protected void onResume(){super.onResume();boolean access=permitted(Manifest.permission.READ_CONTACTS);if(resumedOnce&&!editing){if(!access||!hadAccess)listing();else if(detail)show(detailId);else listing();}hadAccess=access;resumedOnce=true;}
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("search", searchText); out.putLong("detail_id",detail&&!editing?detailId:0); out.putBoolean("editing", editing); if (editing) { out.putLong("id", editingId); out.putLong("raw", editingPerson.raw);
        out.putString("name", editName.getText().toString()); out.putString("phone", editPhone.getText().toString()); out.putString("email", editEmail.getText().toString());out.putString("original_name",editingPerson.name);out.putString("original_phone",editingPerson.phone);out.putString("original_email",editingPerson.email); out.putString("save_token", editToken); } super.onSaveInstanceState(out); }
    @Override protected boolean hasInternalBack() { return detail; }
    @Override protected String backPageKey(String rootPage) { return editing && editingId!=0 ? "contact:"+editingId : rootPage; }
    @Override public void onBackPressed() { keepDraft();if (editing && editingId!=0) back(() -> show(editingId)); else if (detail) back(this::listing); else super.onBackPressed(); }
}
