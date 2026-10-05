package org.textphone.launcher;

import android.content.Context;
import org.json.JSONObject;

/** A user-authored contact edit, separate from Android's saved address book. */
final class ContactDraft {
    static final class Value {
        final long id; final ContactBook.Detail person; final String token;
        Value(long id,ContactBook.Detail person,String token){this.id=id;this.person=person;this.token=token;}
    }
    static synchronized void save(Context c,long id,long raw,String name,String phone,String email,String token){
        Value accepted=readKey(c,"accepted");if(accepted!=null&&accepted.token.equals(token)){if(same(accepted,name,phone,email)){clearEdit(c,token);return;}raw=accepted.person.raw;}
        try{JSONObject value=new JSONObject().put("id",id).put("raw",raw).put("name",name).put("phone",phone).put("email",email).put("token",token);
            if(!c.getSharedPreferences("pocket_contact_draft",0).edit().putString("edit",value.toString()).commit())throw new IllegalStateException("Could not keep the contact draft.");
        }catch(org.json.JSONException error){throw new IllegalStateException("Could not keep the contact draft.",error);}
    }
    static synchronized Value read(Context c){return readKey(c,"edit");}
    private static Value readKey(Context c,String key){String raw=c.getSharedPreferences("pocket_contact_draft",0).getString(key,null);if(raw==null)return null;
        try{JSONObject v=new JSONObject(raw);ContactBook.Detail p=new ContactBook.Detail();p.raw=v.getLong("raw");p.name=v.getString("name");p.phone=v.getString("phone");p.email=v.getString("email");String token=v.getString("token");
            if(p.name.length()>500||p.phone.length()>200||p.email.length()>500||token.length()>100||token.isEmpty())return null;return new Value(v.getLong("id"),p,token);
        }catch(org.json.JSONException error){return null;}
    }
    private static boolean same(Value value,String name,String phone,String email){return value.person.name.equals(name)&&value.person.phone.equals(phone)&&value.person.email.equals(email);}
    static synchronized void accepted(Context c,String token,long raw,String name,String phone,String email){
        try{JSONObject value=new JSONObject().put("id",0).put("raw",raw).put("name",name).put("phone",phone).put("email",email).put("token",token);
            c.getSharedPreferences("pocket_contact_draft",0).edit().putString("accepted",value.toString()).commit();Value draft=read(c);
            if(draft!=null&&draft.token.equals(token)){if(same(draft,name,phone,email))clearEdit(c,token);else save(c,draft.id,raw,draft.person.name,draft.person.phone,draft.person.email,token);}
        }catch(org.json.JSONException error){throw new IllegalStateException("Could not keep the saved contact reference.",error);}
    }
    private static void clearEdit(Context c,String token){Value value=read(c);if(value!=null&&value.token.equals(token))c.getSharedPreferences("pocket_contact_draft",0).edit().remove("edit").apply();}
    static synchronized void clear(Context c,String token){android.content.SharedPreferences.Editor edit=c.getSharedPreferences("pocket_contact_draft",0).edit();Value value=read(c),accepted=readKey(c,"accepted");if(value!=null&&value.token.equals(token))edit.remove("edit");if(accepted!=null&&accepted.token.equals(token))edit.remove("accepted");edit.apply();}
    private ContactDraft(){}
}
