package io.github.marcsoder.jaktkartan;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Uppdatering av appen från GitHub Releases (appen finns inte på Google Play).
 * Webbdelen (src/native.js) ser att en nyare version finns och anropar install med APK-filens adress.
 * Filen laddas ned till appens cache och Androids installerare öppnas. Android frågar alltid användaren,
 * och installerar bara en uppdatering som är signerad med samma nyckel som appen.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    /** Bara APK-filer från repots egna releaser laddas ned. */
    private static final String ALLOWED_PREFIX = "https://github.com/Marc-soder/Jaktkartan/releases/download/";

    private volatile boolean busy = false;

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    /** Installerad version, och om appen får installera uppdateringar ("Tillåt från den här källan"). */
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            JSObject r = new JSObject();
            r.put("versionCode", code);
            r.put("versionName", pi.versionName);
            r.put("canInstall", canInstall());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    /** Öppnar inställningen där användaren tillåter att Jaktkartan installerar uppdateringar. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(Settings.ACTION_SECURITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    /** Laddar ned APK-filen (url) och öppnar Androids installerare. Händelsen "progress" ger {percent}. */
    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url", "");
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || !url.endsWith(".apk")) {
            call.reject("Otillåten adress", "BAD_URL");
            return;
        }
        if (!canInstall()) {
            call.reject("Jaktkartan får inte installera uppdateringar", "NOT_ALLOWED");
            return;
        }
        if (busy) {
            call.reject("Uppdateringen laddas redan ned", "BUSY");
            return;
        }
        busy = true;
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "update");
            File apk = new File(dir, "Jaktkartan.apk");
            HttpURLConnection c = null;
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Kunde inte skapa mappen för uppdateringen");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(30000);
                c.setReadTimeout(60000);
                int status = c.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + status);
                long total = c.getContentLengthLong(), done = 0;
                int last = -2;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int p = total > 0 ? (int) (done * 100 / total) : -1;
                        if (p != last) {
                            last = p;
                            JSObject ev = new JSObject();
                            ev.put("percent", p);
                            notifyListeners("progress", ev);
                        }
                    }
                }
                PackageInfo pi = getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
                if (pi == null || !getContext().getPackageName().equals(pi.packageName)) throw new IOException("Filen är inte Jaktkartan");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), "FAILED");
            } finally {
                busy = false;
                if (c != null) c.disconnect();
            }
        }).start();
    }
}
