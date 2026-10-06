package org.textphone.launcher;

import android.app.PendingIntent;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;

/** A user-authored reply, never an automatic response or a saved notification inbox. */
public final class NotificationReplyActivity extends PocketActivity {
    private NoticeFeed.Item target;private EditText reply;private boolean submitted;private String key;
    @Override protected void onCreate(Bundle state){super.onCreate(state);key=getIntent().getStringExtra("notice_key");target=NoticeFeed.find(key);
        screen("reply");if(!NotificationAccess.allowed(this)||target==null||target.reply()==null){body.addView(label("This message no longer offers a reply. Open the messaging app.",16,GRAY));return;}
        body.addView(label(target.source,14,GRAY));body.addView(label(target.title,20,WHITE));body.addView(label(target.body,16,GRAY));
        if(state!=null&&!state.getString("identity",target.identity()).equals(target.identity())){body.addView(label("The conversation changed. Open the app to reply.",16,GRAY));return;}
        reply=input("Your reply",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);reply.setTag("notification_reply");reply.setMinLines(3);reply.setMaxLines(8);reply.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(4000)});
        if(state!=null){submitted=state.getBoolean("submitted");reply.setText(state.getString("reply",""));}else reply.setText(ReplyDrafts.read(this,target));
        Button send=action("send",()->{});send.setTag("notification_send");PocketDesign.primary(send);send.setEnabled(!submitted);
        send.setOnClickListener(v->{if(submitted)return;String text=reply.getText().toString().trim();if(text.isEmpty()){message("Write a reply first.");return;}send.setEnabled(false);
            try{NoticeActions.reply(this,target,text);submitted=true;reply.setText("");ReplyDrafts.save(this,target,"");message("Reply submitted to "+target.source+".");}
            catch(PendingIntent.CanceledException|SecurityException|IllegalArgumentException|IllegalStateException error){send.setEnabled(true);message(error instanceof PendingIntent.CanceledException?"This reply has expired. Open the app.":error.getMessage());}});
        action("open conversation",()->{try{NoticeActions.open(this,target);}catch(PendingIntent.CanceledException error){message("This notification has expired.");}});
    }
    @Override protected void onSaveInstanceState(Bundle b){b.putBoolean("submitted",submitted);if(reply!=null)b.putString("reply",reply.getText().toString());if(target!=null)b.putString("identity",target.identity());super.onSaveInstanceState(b);}
    @Override protected void onPause(){if(reply!=null&&target!=null)ReplyDrafts.save(this,target,submitted?"":reply.getText().toString());super.onPause();}
}
