package com.wordgarden.cet6;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePronunciationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
