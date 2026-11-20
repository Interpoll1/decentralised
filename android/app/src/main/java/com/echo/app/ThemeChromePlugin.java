package com.echo.app;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EchoThemeChrome")
public class ThemeChromePlugin extends Plugin {
    static final String PREFERENCES = "echo-appearance";

    static void applyAppearance(Activity activity, boolean dark) {
        int color = dark ? Color.rgb(35, 42, 49) : Color.rgb(231, 233, 236);
        Window window = activity.getWindow();
        window.setBackgroundDrawable(new ColorDrawable(color));
        window.setStatusBarColor(color);
        window.setNavigationBarColor(color);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(!dark);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightNavigationBars(!dark);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (activity instanceof BridgeActivity) {
            BridgeActivity host = (BridgeActivity) activity;
            if (host.getBridge() != null) host.getBridge().getWebView().setBackgroundColor(color);
        }
    }

    @PluginMethod
    public void setAppearance(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        Activity activity = getActivity();
        if (activity == null) { call.reject("Activity unavailable"); return; }
        activity.runOnUiThread(() -> {
            activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean("dark", dark).apply();
            applyAppearance(activity, dark);
            call.resolve();
        });
    }
}
