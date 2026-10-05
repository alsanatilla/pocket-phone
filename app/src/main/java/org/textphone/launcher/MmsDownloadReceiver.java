package org.textphone.launcher;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;

public final class MmsDownloadReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) { if (intent.getData() == null) return; int result = getResultCode(); PendingResult pending = goAsync();
        new Thread(() -> { File file = MmsFiles.file(c, intent.getData()); try {
            if (result != Activity.RESULT_OK) throw new java.io.IOException("Carrier download failed.");
            if (file.length() > MmsCodec.LIMIT) throw new java.io.IOException("MMS too large.");
            ByteArrayOutputStream data = new ByteArrayOutputStream(); try (FileInputStream input = new FileInputStream(file)) { byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) { if (data.size() + count > MmsCodec.LIMIT) throw new java.io.IOException("MMS too large."); data.write(buffer, 0, count); } }
            MmsCodec.Pdu pdu = MmsCodec.decode(data.toByteArray()); if (pdu.type != 132) throw new java.io.IOException("Unexpected MMS response.");
            try { NativeMms.save(c, pdu, intent.getIntExtra("subscription", -1));
                if (intent.getLongExtra("failed_id", 0) != 0) MmsInbox.delete(c, intent.getLongExtra("failed_id", 0));
                MessageAlerts.show(c, pdu.from, pdu.text.isEmpty() ? "MMS attachment" : pdu.text);
            } catch (Exception storage) { MmsInbox.save(c, pdu, null, intent.getIntExtra("subscription", -1), intent.getLongExtra("failed_id", 0)); }
        } catch (Exception e) { try { MmsCodec.Pdu notice = new MmsCodec.Pdu(); notice.text = "MMS download failed";
            MmsInbox.save(c, notice, intent.getStringExtra("location"), intent.getIntExtra("subscription", -1), intent.getLongExtra("failed_id", 0));
        } catch (Exception ignored) { MessageAlerts.show(c, "MMS", "MMS download failed."); } }
        finally { file.delete(); c.revokeUriPermission(intent.getData(), Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            c.sendBroadcast(new Intent("org.textphone.launcher.MESSAGES_CHANGED").setPackage(c.getPackageName())); pending.finish(); }
        }, "Pocket MMS").start();
    }
}
