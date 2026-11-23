package io.github.marcsoder.jaktkartan;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Logger;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Positionen under jakten, även med släckt skärm: en tjänst i förgrunden med en fast avisering.
 * Telefonen mäter med ett bestämt intervall (var 10:e sekund när man rör sig, varje minut när man är incheckad på passet)
 * i stället för varje sekund. Mellan mätningarna får GPS:en vila, vilket sparar batteri.
 * Intervallet bestäms av webbdelen (src/native.js) och ändras med setInterval utan att tjänsten startas om.
 */
public class JaktGpsService extends Service {

    /** Tar emot positionerna (JaktGpsPlugin). Tjänsten och appen körs i samma process. */
    interface Listener {
        void onLocation(Location location);
    }

    static volatile Listener listener;
    /** Den tjänst som körs just nu, eller null. Används bara på huvudtråden. */
    static JaktGpsService running;

    private static final String CHANNEL = "jakt-gps";
    private static final int NOTIFICATION_ID = 28352;
    private static final long MIN_INTERVAL = 1000;

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private long interval = 0;

    static void start(Context ctx, long interval, String title, String text) {
        Intent i = new Intent(ctx, JaktGpsService.class);
        i.putExtra("interval", interval);
        i.putExtra("title", title);
        i.putExtra("text", text);
        ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, JaktGpsService.class));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra("title") : null;
        String text = intent != null ? intent.getStringExtra("text") : null;
        long ms = intent != null ? intent.getLongExtra("interval", 10000) : 10000;
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(title, text), type);
        } catch (Exception e) {
            // Saknas platsåtkomst kan Android vägra. Tjänsten stoppas då i stället för att appen kraschar.
            Logger.error("JaktGps", "Kunde inte starta positionen i förgrunden", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = this;
        interval = 0;   // börja om med det nya intervallet
        setInterval(ms);
        return START_NOT_STICKY;
    }

    /** Byter mätintervall. Körs på huvudtråden. */
    void setInterval(long ms) {
        ms = Math.max(MIN_INTERVAL, ms);
        if (callback != null && ms == interval) return;
        interval = ms;
        if (client == null) client = LocationServices.getFusedLocationProviderClient(this);
        if (callback != null) client.removeLocationUpdates(callback);
        else callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location l = result.getLastLocation();
                Listener li = listener;
                if (l != null && li != null) li.onLocation(l);
            }
        };
        // Hög noggrannhet även på passet: in- och utcheckningen bygger på avståndet till passet.
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, ms)
            .setMinUpdateIntervalMillis(ms)
            .setWaitForAccurateLocation(false)
            .build();
        try {
            client.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Logger.error("JaktGps", "Platsåtkomst saknas", e);
        }
    }

    private Notification notification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Position under jakten", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Visas medan Jaktkartan delar din position");
            ch.enableVibration(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle(title != null ? title : "Jaktkartan delar din position")
            .setContentText(text != null ? text : "Under jakten. Stoppa delningen i appen.")
            .setSmallIcon(R.drawable.ic_stat_jk)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE);
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            b.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return b.build();
    }

    /** Stängs appen (sveps bort) finns ingen sida som kan skicka positionen. Då stoppas mätningen också. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        if (running == this) running = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
