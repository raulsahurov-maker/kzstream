package kz.kzstream.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Отправка уведомлений на сервер KZStream + журнал последних событий. */
public final class Sender {
    public static final String PREFS = "kzstream";
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();

    public interface Callback { void done(boolean ok, String message); }

    public static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static String link(Context c) {
        return prefs(c).getString("link", "").trim();
    }

    public static void send(final Context ctx, final JSONObject body, final Callback cb) {
        final Context app = ctx.getApplicationContext();
        final String link = link(app);
        if (link.isEmpty()) {
            if (cb != null) cb.done(false, "Ссылка подключения не указана");
            return;
        }
        POOL.execute(() -> {
            String result = "";
            boolean ok = false;
            for (int attempt = 0; attempt < 3 && !ok; attempt++) {
                HttpURLConnection con = null;
                try {
                    con = (HttpURLConnection) new URL(link).openConnection();
                    con.setConnectTimeout(8000);
                    con.setReadTimeout(8000);
                    con.setRequestMethod("POST");
                    con.setDoOutput(true);
                    con.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                    byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
                    try (OutputStream os = con.getOutputStream()) { os.write(data); }
                    int code = con.getResponseCode();
                    InputStream is = code < 400 ? con.getInputStream() : con.getErrorStream();
                    String resp = is == null ? "" : new String(readAll(is), StandardCharsets.UTF_8);
                    ok = code < 400;
                    result = ok ? describe(resp) : ("Ошибка сервера " + code + ": " + resp);
                    if (code == 404) break; // неверная ссылка — повторять бессмысленно
                } catch (Exception e) {
                    result = "Нет связи: " + e.getMessage();
                    try { Thread.sleep(1500L * (attempt + 1)); } catch (InterruptedException ignored) { }
                } finally {
                    if (con != null) con.disconnect();
                }
            }
            log(app, (ok ? "✓ " : "✗ ") + result);
            if (cb != null) cb.done(ok, result);
        });
    }

    private static String describe(String resp) {
        try {
            JSONObject j = new JSONObject(resp);
            if (j.has("message")) return j.optString("message") + " (" + j.optString("nick") + ")";
            if (j.optBoolean("duplicate")) return "повтор, пропущено";
            String r = j.optString("result");
            if ("ignored".equals(r)) return "не перевод, пропущено";
            JSONObject d = j.optJSONObject("donation");
            if (d != null) return "донат " + d.optString("name") + " — " + d.optInt("amount") + " ₸";
            return r;
        } catch (Exception e) { return resp; }
    }

    private static byte[] readAll(InputStream is) throws java.io.IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    public static synchronized void log(Context c, String line) {
        SharedPreferences p = prefs(c);
        String time = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());
        String old = p.getString("log", "");
        String all = time + "  " + line + "\n" + old;
        String[] lines = all.split("\n");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(lines.length, 30); i++) sb.append(lines[i]).append('\n');
        p.edit().putString("log", sb.toString()).apply();
    }
}
