package com.wordgarden.cet6;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "NativePronunciation")
public class NativePronunciationPlugin extends Plugin {
    private TextToSpeech engine;
    private boolean ready;
    private boolean initializationFailed;
    private final List<PluginCall> pendingCalls = new ArrayList<>();

    @Override
    public void load() {
        engine = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            initializationFailed = !ready;
            List<PluginCall> queued = new ArrayList<>(pendingCalls);
            pendingCalls.clear();
            for (PluginCall call : queued) {
                if (ready) {
                    speakNow(call);
                } else {
                    call.reject("手机没有可用的文字转语音引擎", "TTS_UNAVAILABLE");
                }
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("缺少需要朗读的单词", "INVALID_WORD");
            return;
        }
        if (initializationFailed) {
            call.reject("手机没有可用的文字转语音引擎", "TTS_UNAVAILABLE");
            return;
        }
        if (!ready) {
            pendingCalls.add(call);
            return;
        }
        speakNow(call);
    }

    private void speakNow(PluginCall call) {
        Locale selected = selectEnglishLocale(call.getString("locale", "en-GB"));
        if (selected == null) {
            call.reject("手机缺少英文语音数据", "TTS_MISSING_LANGUAGE");
            return;
        }
        engine.setLanguage(selected);
        engine.setSpeechRate(0.82f);
        engine.setPitch(1.0f);
        String text = call.getString("text", "").trim();
        int result = engine.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), UUID.randomUUID().toString());
        if (result == TextToSpeech.ERROR) {
            call.reject("系统未能播放这个单词", "TTS_SPEAK_FAILED");
            return;
        }
        JSObject response = new JSObject();
        response.put("locale", selected.toLanguageTag());
        call.resolve(response);
    }

    private Locale selectEnglishLocale(String requestedTag) {
        Locale requested = Locale.forLanguageTag(requestedTag);
        Locale alternate = "US".equalsIgnoreCase(requested.getCountry()) ? Locale.UK : Locale.US;
        Locale[] candidates = { requested, alternate, Locale.ENGLISH };
        for (Locale locale : candidates) {
            int availability = engine.isLanguageAvailable(locale);
            if (availability >= TextToSpeech.LANG_AVAILABLE) return locale;
        }
        return null;
    }

    @Override
    protected void handleOnDestroy() {
        for (PluginCall call : pendingCalls) {
            call.reject("文字转语音服务已经关闭", "TTS_UNAVAILABLE");
        }
        pendingCalls.clear();
        if (engine != null) {
            engine.stop();
            engine.shutdown();
            engine = null;
        }
    }
}
