package io.github.marcsoder.jaktkartan;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Appens egen position under jakten (ersätter BackgroundGeolocation, som mäter varje sekund).
 * Webbdelen (src/native.js):
 *   start({interval, title, text})  startar tjänsten i förgrunden. Varje position kommer tillbaka till samma anrop.
 *   setInterval({interval})          byter intervall (10 s när man rör sig, 60 s incheckad på passet).
 *   stop()                           stoppar tjänsten och aviseringen.
 *   openSettings()                   öppnar appens inställningar (nekad platsåtkomst).
 * Fel: NOT_AUTHORIZED (platsåtkomst nekad eller platstjänster avstängda), BACKGROUND (Android tillåter inte
 * att tjänsten startar medan appen ligger i bakgrunden; webbdelen försöker igen när appen syns).
 */
@CapacitorPlugin(
    name = "JaktGps",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location")
    }
)
public class JaktGpsPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Anropet som tar emot positionerna. */
    private volatile String watchId;

    @Override
    public void load() {
        JaktGpsService.listener = this::sendLocation;
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void start(PluginCall call) {
        call.setKeepAlive(true);
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void locationPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            fail(call, "Platsåtkomst nekad", "NOT_AUTHORIZED");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        if (!locationEnabled()) {
            fail(call, "Platstjänster är avstängda", "NOT_AUTHORIZED");
            return;
        }
        String old = watchId;
        watchId = call.getCallbackId();
        if (old != null && !old.equals(watchId)) bridge.releaseCall(old);
        long interval = call.getInt("interval", 10000);   // JSON-tal blir Integer, inte Long
        try {
            JaktGpsService.start(getContext(), interval, call.getString("title"), call.getString("text"));
        } catch (Exception e) {
            // Android 12 och senare: en tjänst i förgrunden kan inte startas medan appen ligger i bakgrunden
            fail(call, "Kan inte starta positionen i bakgrunden", "BACKGROUND");
        }
    }

    private void fail(PluginCall call, String msg, String code) {
        if (call.getCallbackId().equals(watchId)) watchId = null;
        call.setKeepAlive(false);
        call.reject(msg, code);
        bridge.releaseCall(call);
    }

    @PluginMethod
    public void setInterval(PluginCall call) {
        final long ms = call.getInt("interval", 10000);
        main.post(() -> {
            JaktGpsService s = JaktGpsService.running;
            if (s != null) s.setInterval(ms);
        });
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        JaktGpsService.stop(getContext());
        String id = watchId;
        watchId = null;
        if (id != null) bridge.releaseCall(id);
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void sendLocation(Location l) {
        PluginCall call = bridge.getSavedCall(watchId);
        if (call == null) return;
        JSObject o = new JSObject();
        o.put("latitude", l.getLatitude());
        o.put("longitude", l.getLongitude());
        o.put("accuracy", l.hasAccuracy() ? l.getAccuracy() : 0);
        o.put("time", l.getTime());
        call.resolve(o);
    }

    private boolean locationEnabled() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return lm.isLocationEnabled();
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    /** Appen stängs: stoppa mätningen och aviseringen. */
    @Override
    protected void handleOnDestroy() {
        JaktGpsService.stop(getContext());
        if (JaktGpsService.listener != null) JaktGpsService.listener = null;
        super.handleOnDestroy();
    }
}
