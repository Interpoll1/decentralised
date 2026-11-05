package com.interpoll.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int SYSTEM_BAR_COLOR = Color.rgb(231, 233, 236);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        // Older Android versions cannot draw dark system icons on light bars.
        window.setStatusBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? SYSTEM_BAR_COLOR : Color.rgb(35, 42, 49));
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? SYSTEM_BAR_COLOR : Color.rgb(35, 42, 49));
        window.setBackgroundDrawableResource(R.color.interpollSystemBar);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(window, window.getDecorView()).setAppearanceLightNavigationBars(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
    }
}
