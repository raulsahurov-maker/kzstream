package kz.kzstream.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

import java.util.regex.Pattern;

/** Слушает уведомления банков и отправляет входящие переводы на сервер KZStream. */
public class KaspiListener extends NotificationListenerService {

    // Похоже на денежную сумму в тенге
    private static final Pattern MONEY = Pattern.compile("\\d[\\d\\s\\u00a0\\u202f]*([.,]\\d{1,2})?\\s*(₸|тг|тенге|KZT)|(₸|KZT)\\s*\\d", Pattern.CASE_INSENSITIVE);
    private static final String[] BANKS = {"kaspi", "halyk", "jusan", "freedom", "bcc", "forte", "homecredit", "eubank", "bereke", "otbasy", "rbk"};

    @Override
    public void onListenerConnected() {
        Sender.log(this, "Доступ к уведомлениям включён");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            String pkg = sbn.getPackageName();
            if (getPackageName().equals(pkg)) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            Bundle ex = n.extras;
            if (ex == null) return;
            String title = str(ex.getCharSequence(Notification.EXTRA_TITLE));
            String text = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (text.isEmpty()) text = str(ex.getCharSequence(Notification.EXTRA_TEXT));
            CharSequence[] lines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null && lines.length > 0) {
                StringBuilder sb = new StringBuilder(text);
                for (CharSequence cs : lines) { String l = str(cs); if (!l.isEmpty() && !text.contains(l)) sb.append('\n').append(l); }
                text = sb.toString().trim();
            }
            String sub = str(ex.getCharSequence(Notification.EXTRA_SUB_TEXT));
            if (!sub.isEmpty() && !text.contains(sub)) text = text + "\n" + sub;
            String full = title + "\n" + text;

            boolean onlyBanks = Sender.prefs(this).getBoolean("onlyBanks", true);
            boolean isBank = false;
            String lp = pkg.toLowerCase();
            for (String b : BANKS) if (lp.contains(b)) { isBank = true; break; }
            // отправляем только то, что похоже на сумму в тенге — остальные уведомления не покидают телефон
            if (!MONEY.matcher(full).find()) return;
            if (onlyBanks && !isBank) return;

            JSONObject body = new JSONObject();
            body.put("title", title);
            body.put("text", text);
            body.put("package", pkg);
            body.put("key", sbn.getKey() + "|" + sbn.getPostTime());
            Sender.send(this, body, null);
        } catch (Exception e) {
            Sender.log(this, "Ошибка: " + e.getMessage());
        }
    }

    private static String str(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
