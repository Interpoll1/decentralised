package com.interpoll.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThemeChromePlugin.class);
        super.onCreate(savedInstanceState);
        boolean dark = getSharedPreferences(ThemeChromePlugin.PREFERENCES, MODE_PRIVATE).getBoolean("dark", false);
        ThemeChromePlugin.applyAppearance(this, dark);
    }
}
