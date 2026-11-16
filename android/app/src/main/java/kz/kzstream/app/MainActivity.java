package kz.kzstream.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final int BG = Color.parseColor("#07080D");
    private static final int CARD = Color.parseColor("#12141F");
    private static final int ACCENT = Color.parseColor("#FF3B5C");
    private static final int MUTED = Color.parseColor("#9097AD");

    private EditText linkInput;
    private TextView status, log;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(20);
        root.setPadding(p, dp(28), p, p);
        scroll.addView(root);

        TextView logo = text("KZStream", 26, Color.WHITE, true);
        root.addView(logo);
        root.addView(text("Kaspi-донаты на ваш стрим", 15, MUTED, false));

        status = text("", 15, Color.WHITE, true);
        LinearLayout statusCard = card();
        statusCard.addView(status);
        root.addView(statusCard);

        LinearLayout c1 = card();
        c1.addView(text("1. Ссылка подключения", 16, Color.WHITE, true));
        c1.addView(text("Скопируйте её в кабинете KZStream → «Подключение».", 13, MUTED, false));
        linkInput = new EditText(this);
        linkInput.setHint("https://.../api/ingest/...");
        linkInput.setTextColor(Color.WHITE);
        linkInput.setHintTextColor(Color.parseColor("#636A82"));
        linkInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        linkInput.setText(Sender.link(this));
        c1.addView(linkInput);
        c1.addView(button("Сохранить", true, v -> save()));
        root.addView(c1);

        LinearLayout c2 = card();
        c2.addView(text("2. Разрешения", 16, Color.WHITE, true));
        c2.addView(button("Дать доступ к уведомлениям", true, v ->
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));
        c2.addView(button("Отключить экономию батареи", false, v -> askBattery()));
        CheckBox only = new CheckBox(this);
        only.setText("Только уведомления банков (рекомендуется)");
        only.setTextColor(Color.WHITE);
        only.setChecked(Sender.prefs(this).getBoolean("onlyBanks", true));
        only.setOnCheckedChangeListener((bt, on) -> Sender.prefs(this).edit().putBoolean("onlyBanks", on).apply());
        c2.addView(only);
        root.addView(c2);

        LinearLayout c3 = card();
        c3.addView(text("3. Проверка", 16, Color.WHITE, true));
        c3.addView(button("Проверить связь с сервером", false, v -> ping()));
        c3.addView(button("Отправить тестовый донат 1 000 ₸", false, v -> testDonation()));
        root.addView(c3);

        LinearLayout c4 = card();
        c4.addView(text("Журнал", 16, Color.WHITE, true));
        log = text("", 12, MUTED, false);
        log.setTypeface(Typeface.MONOSPACE);
        c4.addView(log);
        root.addView(c4);

        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        // перезапуск слушателя, если система его выгрузила
        try {
            NotificationListenerService.requestRebind(new ComponentName(this, KaspiListener.class));
        } catch (Exception ignored) { }
    }

    private void save() {
        String l = linkInput.getText().toString().trim();
        if (!l.matches("^https?://.+/api/ingest/[A-Za-z0-9_-]+/?$")) {
            Toast.makeText(this, "Неверная ссылка. Скопируйте её из кабинета.", Toast.LENGTH_LONG).show();
            return;
        }
        Sender.prefs(this).edit().putString("link", l.replaceAll("/$", "")).apply();
        Toast.makeText(this, "Сохранено", Toast.LENGTH_SHORT).show();
        ping();
    }

    private void ping() {
        try {
            JSONObject j = new JSONObject();
            j.put("ping", 1);
            Sender.send(this, j, (ok, msg) -> ui.post(() -> {
                Toast.makeText(this, ok ? "Связь есть: " + msg : msg, Toast.LENGTH_LONG).show();
                refresh();
            }));
        } catch (Exception ignored) { }
    }

    private void testDonation() {
        try {
            JSONObject j = new JSONObject();
            j.put("title", "Kaspi.kz");
            j.put("text", "Перевод 1 000 ₸ от Тест Т.");
            j.put("key", "test-" + System.currentTimeMillis());
            Sender.send(this, j, (ok, msg) -> ui.post(() -> {
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                refresh();
            }));
        } catch (Exception ignored) { }
    }

    private void askBattery() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
            Toast.makeText(this, "Уже отключено ✓", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private boolean listenerEnabled() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(getPackageName());
    }

    private void refresh() {
        boolean link = !Sender.link(this).isEmpty();
        boolean access = listenerEnabled();
        if (link && access) {
            status.setText("● Работает — донаты отправляются на стрим");
            status.setTextColor(Color.parseColor("#3EE6C4"));
        } else {
            status.setText("● Не настроено: " + (!link ? "вставьте ссылку" : "дайте доступ к уведомлениям"));
            status.setTextColor(Color.parseColor("#FF7A45"));
        }
        String l = Sender.prefs(this).getString("log", "");
        log.setText(l.isEmpty() ? "Пока пусто" : l);
    }

    // ---- UI helpers ----
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView text(String s, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private LinearLayout card() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        l.setPadding(p, p, p, p);
        GradientDrawable g = new GradientDrawable();
        g.setColor(CARD);
        g.setCornerRadius(dp(16));
        g.setStroke(dp(1), Color.parseColor("#232739"));
        l.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(14);
        l.setLayoutParams(lp);
        return l;
    }

    private Button button(String s, boolean primary, View.OnClickListener cl) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setColor(primary ? ACCENT : Color.parseColor("#1D2133"));
        g.setCornerRadius(dp(12));
        b.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(48));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        b.setOnClickListener(cl);
        return b;
    }
}
