# Android 原生单词发音设计

## 问题

华为等部分 Android 手机的 WebView 不提供 Web Speech API，或未向网页暴露可用英文语音，因此当前扬声器按钮会无声失败。单词和音标数据本身正确，问题发生在播放层。

## 方案

- 在 Android 应用中增加一个 Capacitor 本地插件，使用 Android `TextToSpeech` 播放单词。
- 插件初始化后依次尝试 `Locale.UK`、`Locale.US` 和 `Locale.ENGLISH`，选择首个可用英文语音。
- 每次播放使用 `QUEUE_FLUSH`，避免连续点击造成声音堆积。
- 设置适合单词学习的语速，并在插件销毁时停止、释放 TTS 引擎。
- 网页端继续使用浏览器 `speechSynthesis`；Android 原生插件不可用时再回退到网页语音。
- 原生引擎缺失、英文数据缺失或合成失败时，向用户显示明确中文提示，不再静默失败。

## 数据与权限

发音只向设备系统传递当前英文单词，不访问 Supabase，不修改学习记录，也不新增录音权限。Android 系统 TTS 是否需要联网由用户安装的语音引擎决定。

## 测试与发布

- 单元测试覆盖原生优先、网页回退、缺失引擎和播放失败。
- Android 结构测试确认插件注册、英文地区回退和引擎释放。
- 运行全量测试、网页构建和 Capacitor Android 同步。
- 发布网页缓存更新与 Android 1.2.2，并验证 APK 可下载。

