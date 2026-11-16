package kz.kzstream.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int BG = Color.parseColor("#07080D");
    private static final int CARD = Color.parseColor("#12141F");
    private static final int LINE = Color.parseColor("#232739");
    private static final int ACCENT = Color.parseColor("#FF3B5C");
    private static final int ACCENT2 = Color.parseColor("#FF7A45");
    private static final int MUTED = Color.parseColor("#9097AD");
    private static final int OK = Color.parseColor("#3EE6C4");
    private static final int WARN = Color.parseColor("#FF7A45");

    private final Handler ui = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView todaySum, todayCount, log, planText;
    private LinearLayout checks, lastList;
    private final Runnable refresher = new Runnable() {
        @Override public void run() { refreshMain(); ui.postDelayed(this, 15000); }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 33) {
            try { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 1); } catch (Exception ignored) { }
        }
        show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!Sender.link(this).isEmpty()) {
            KeepAliveService.start(this);
            try { NotificationListenerService.requestRebind(new ComponentName(this, KaspiListener.class)); } catch (Exception ignored) { }
            ui.removeCallbacks(refresher);
            ui.post(refresher);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(refresher);
    }

    private void show() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(26), dp(20), dp(26));
        scroll.addView(root);
        if (Sender.link(this).isEmpty()) buildLogin(); else buildMain();
        setContentView(scroll);
    }

    // ================= ВХОД =================
    private void buildLogin() {
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(logo(72));
        TextView t = text("KZStream", 30, Color.WHITE, true);
        t.setGravity(Gravity.CENTER);
        root.addView(t);
        TextView s = text("Kaspi-донаты на ваш стрим", 15, MUTED, false);
        s.setGravity(Gravity.CENTER);
        root.addView(s);

        LinearLayout c = card();
        c.addView(text("Вход", 20, Color.WHITE, true));
        c.addView(text("Тот же email и пароль, что на сайте", 13, MUTED, false));
        final EditText email = input("Email или ник", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        final EditText pass = input("Пароль", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        c.addView(email);
        c.addView(pass);
        final Button go = button("Войти", true, null);
        go.setOnClickListener(v -> {
            String e = email.getText().toString().trim(), p = pass.getText().toString();
            if (e.isEmpty() || p.isEmpty()) { toast("Введите email и пароль"); return; }
            go.setEnabled(false);
            go.setText("Вход… (до 1 минуты)");
            try {
                JSONObject body = new JSONObject();
                body.put("email", e);
                body.put("password", p);
                Sender.request("POST", Sender.server(this) + "/api/app/login", body, (code, j) -> ui.post(() -> {
                    go.setEnabled(true);
                    go.setText("Войти");
                    if (code == 200 && j.optBoolean("ok")) {
                        Sender.prefs(this).edit()
                                .putString("link", j.optString("ingest"))
                                .putString("token", j.optString("token"))
                                .putString("nick", j.optString("nick"))
                                .putString("plan", j.optString("plan"))
                                .apply();
                        Sender.log(this, "Вход выполнен: " + j.optString("nick"));
                        KeepAliveService.start(this);
                        show();
                        onResume();
                    } else toast(j.optString("error", "Ошибка входа"));
                }));
            } catch (Exception ex) { go.setEnabled(true); }
        });
        c.addView(go);
        c.addView(button("Регистрация на сайте", false, v -> open(Sender.server(this) + "/")));
        root.addView(c);

        TextView adv = text("Сервер: " + Sender.server(this), 11, Color.parseColor("#4A5068"), false);
        adv.setGravity(Gravity.CENTER);
        adv.setPadding(0, dp(16), 0, 0);
        adv.setOnLongClickListener(v -> { askServer(); return true; });
        root.addView(adv);
    }

    private void askServer() {
        final EditText e = input("https://...", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        e.setText(Sender.server(this));
        new android.app.AlertDialog.Builder(this).setTitle("Адрес сервера").setView(e)
                .setPositiveButton("Сохранить", (d, w) -> {
                    String v = e.getText().toString().trim().replaceAll("/+$", "");
                    if (v.startsWith("http")) Sender.prefs(this).edit().putString("server", v).apply();
                    show();
                }).setNegativeButton("Отмена", null).show();
    }

    // ================= ГЛАВНЫЙ ЭКРАН =================
    private void buildMain() {
        LinearLayout head = new LinearLayout(this);
        head.setGravity(Gravity.CENTER_VERTICAL);
        head.addView(logo(46));
        LinearLayout hv = new LinearLayout(this);
        hv.setOrientation(LinearLayout.VERTICAL);
        hv.setPadding(dp(12), 0, 0, 0);
        hv.addView(text(Sender.prefs(this).getString("nick", ""), 20, Color.WHITE, true));
        planText = text("Тариф " + Sender.prefs(this).getString("plan", ""), 13, MUTED, false);
        hv.addView(planText);
        head.addView(hv);
        root.addView(head);

        LinearLayout st = card();
        st.addView(text("Статус", 16, Color.WHITE, true));
        checks = new LinearLayout(this);
        checks.setOrientation(LinearLayout.VERTICAL);
        st.addView(checks);
        root.addView(st);

        LinearLayout today = card();
        today.addView(text("Сегодня", 14, MUTED, false));
        todaySum = text("0 ₸", 34, Color.WHITE, true);
        todaySum.setTextColor(ACCENT2);
        today.addView(todaySum);
        todayCount = text("донатов: 0", 13, MUTED, false);
        today.addView(todayCount);
        root.addView(today);

        LinearLayout last = card();
        last.addView(text("Последние донаты", 16, Color.WHITE, true));
        lastList = new LinearLayout(this);
        lastList.setOrientation(LinearLayout.VERTICAL);
        lastList.addView(text("Загрузка…", 13, MUTED, false));
        last.addView(lastList);
        root.addView(last);

        LinearLayout act = card();
        act.addView(text("Действия", 16, Color.WHITE, true));
        act.addView(button("Отправить тестовый донат 1 000 ₸", true, v -> testDonation()));
        act.addView(button("Открыть кабинет на сайте", false, v -> open(Sender.server(this) + "/app")));
        CheckBox only = new CheckBox(this);
        only.setText("Только уведомления банков");
        only.setTextColor(Color.WHITE);
        only.setChecked(Sender.prefs(this).getBoolean("onlyBanks", true));
        only.setOnCheckedChangeListener((bt, on) -> Sender.prefs(this).edit().putBoolean("onlyBanks", on).apply());
        act.addView(only);
        act.addView(button("Выйти из аккаунта", false, v -> {
            Sender.prefs(this).edit().remove("link").remove("token").remove("nick").apply();
            KeepAliveService.stop(this);
            show();
        }));
        root.addView(act);

        LinearLayout lg = card();
        lg.addView(text("Журнал", 16, Color.WHITE, true));
        log = text("", 12, MUTED, false);
        log.setTypeface(Typeface.MONOSPACE);
        lg.addView(log);
        root.addView(lg);
        refreshChecks();
    }

    private void refreshChecks() {
        if (checks == null) return;
        checks.removeAllViews();
        boolean access = listenerEnabled();
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        boolean battery = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        checks.addView(check(true, "Аккаунт подключён", null, null));
        checks.addView(check(access, access ? "Доступ к уведомлениям есть" : "Нет доступа к уведомлениям", "Дать доступ",
                v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))));
        checks.addView(check(battery, battery ? "Работает в фоне без ограничений" : "Экономия батареи может отключать приём", "Отключить",
                v -> askBattery()));
        if (log != null) {
            String l = Sender.prefs(this).getString("log", "");
            log.setText(l.isEmpty() ? "Пока пусто" : l);
        }
    }

    private void refreshMain() {
        refreshChecks();
        String token = Sender.prefs(this).getString("token", "");
        if (token.isEmpty()) return;
        Sender.request("GET", Sender.server(this) + "/api/app/me/" + token, null, (code, j) -> ui.post(() -> {
            if (code == 404) { toast("Сессия устарела — войдите снова"); Sender.prefs(this).edit().remove("link").apply(); show(); return; }
            if (code != 200 || todaySum == null) return;
            todaySum.setText(money(j.optInt("today")));
            todayCount.setText("донатов: " + j.optInt("today_count"));
            planText.setText("Тариф " + j.optString("plan"));
            lastList.removeAllViews();
            JSONArray arr = j.optJSONArray("last");
            if (arr == null || arr.length() == 0) { lastList.addView(text("Донатов пока нет", 13, MUTED, false)); return; }
            for (int i = 0; i < arr.length(); i++) {
                JSONObject d = arr.optJSONObject(i);
                if (d == null) continue;
                LinearLayout row = new LinearLayout(this);
                row.setOrientation(LinearLayout.VERTICAL);
                row.setPadding(0, dp(8), 0, dp(8));
                TextView top = text(d.optString("name") + "  ·  " + money(d.optInt("amount")), 15, Color.WHITE, true);
                row.addView(top);
                String msg = d.optString("message");
                if (!msg.isEmpty()) row.addView(text(msg, 13, MUTED, false));
                lastList.addView(row);
            }
        }));
    }

    private void testDonation() {
        try {
            JSONObject j = new JSONObject();
            j.put("title", "Kaspi.kz");
            j.put("text", "Перевод 1 000 ₸ от Тест Т.\nПривет! Это тестовый донат из приложения");
            j.put("key", "test-" + System.currentTimeMillis());
            Sender.send(this, j, (ok, msg) -> ui.post(() -> { toast(msg); refreshMain(); }));
        } catch (Exception ignored) { }
    }

    private void askBattery() {
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

    private void open(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    private static String money(int n) {
        return NumberFormat.getIntegerInstance(new Locale("ru")).format(n).replace(' ', ' ') + " ₸";
    }

    // ================= UI =================
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView text(String s, int size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(3), 0, dp(3));
        return t;
    }

    private View logo(int size) {
        TextView l = new TextView(this);
        l.setText("▶");
        l.setTextColor(Color.WHITE);
        l.setTextSize(size / 3f);
        l.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{ACCENT, ACCENT2});
        g.setCornerRadius(dp(size / 4));
        l.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(size), dp(size));
        lp.bottomMargin = dp(8);
        l.setLayoutParams(lp);
        return l;
    }

    private LinearLayout card() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable g = new GradientDrawable();
        g.setColor(CARD);
        g.setCornerRadius(dp(18));
        g.setStroke(dp(1), LINE);
        l.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(14);
        l.setLayoutParams(lp);
        return l;
    }

    private EditText input(String hint, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setInputType(type);
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.parseColor("#636A82"));
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor("#0D0F18"));
        g.setCornerRadius(dp(12));
        g.setStroke(dp(1), LINE);
        e.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(10);
        e.setLayoutParams(lp);
        return e;
    }

    private Button button(String s, boolean primary, View.OnClickListener cl) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable g = primary
                ? new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, new int[]{ACCENT, ACCENT2})
                : new GradientDrawable();
        if (!primary) { g.setColor(Color.parseColor("#1D2133")); g.setStroke(dp(1), LINE); }
        g.setCornerRadius(dp(12));
        b.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(50));
        lp.topMargin = dp(10);
        b.setLayoutParams(lp);
        if (cl != null) b.setOnClickListener(cl);
        return b;
    }

    private View check(boolean ok, String label, String action, View.OnClickListener cl) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));
        TextView dot = text(ok ? "●" : "●", 16, ok ? OK : WARN, true);
        row.addView(dot);
        TextView t = text(label, 14, Color.WHITE, false);
        t.setPadding(dp(10), 0, dp(10), 0);
        row.addView(t, new LinearLayout.LayoutParams(0, -2, 1f));
        if (!ok && action != null) {
            Button b = new Button(this);
            b.setText(action);
            b.setAllCaps(false);
            b.setTextColor(Color.WHITE);
            b.setTextSize(13);
            GradientDrawable g = new GradientDrawable();
            g.setColor(ACCENT);
            g.setCornerRadius(dp(10));
            b.setBackground(g);
            b.setPadding(dp(12), 0, dp(12), 0);
            b.setOnClickListener(cl);
            row.addView(b, new LinearLayout.LayoutParams(-2, dp(38)));
        }
        return row;
    }
}
