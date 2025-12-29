import { event_types, getContext, extension_settings, saveSettingsDebounced } from "../../../script.js";
import { generateQuietPrompt } from "../../../script.js";  // 用于 LLM 翻译

const EXTENSION_NAME = "translate_extension";

if (!extension_settings[EXTENSION_NAME]) {
    extension_settings[EXTENSION_NAME] = {
        mode: "input",          // none, input, output, both
        provider: "google",     // google, bing, llm
        targetLang: "en",       // 目标语言代码
        sourceLang: "auto",     // 通常 auto
        llmProfile: "",         // LLM Connection Profile ID（留空使用主API）
        systemPrompt: "You are a professional translator. Translate the following text accurately and naturally.",
    };
}

async function translateText(text, provider, targetLang, sourceLang = "auto", systemPrompt = "") {
    if (!text) return text;

    if (provider === "google") {
        try {
            const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
            const data = await res.json();
            return data[0].map(part => part[0]).join("");
        } catch (e) {
            console.error("Google 翻译失败", e);
            return text;
        }
    }

    if (provider === "bing") {
        try {
            const res = await fetch(`https://www.bing.com/ttranslatev3?isVertical=1&IG=uuid&IID=translator.5028.1`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    fromLang: sourceLang,
                    text: text,
                    to: targetLang
                })
            });
            const data = await res.json();
            return data[0]?.translations[0]?.text || text;
        } catch (e) {
            console.error("Bing 翻译失败", e);
            return text;
        }
    }

    if (provider === "llm") {
        const prompt = systemPrompt ? `${systemPrompt}\n\nText: ${text}\nTranslation to ${targetLang}:` : `Translate to ${targetLang}: ${text}`;
        try {
            const reply = await generateQuietPrompt({
                quietPrompt: prompt,
                connectionId: extension_settings[EXTENSION_NAME].llmProfile || undefined  // 使用指定 profile 或主API
            });
            return reply.trim();
        } catch (e) {
            console.error("LLM 翻译失败", e);
            return text;
        }
    }

    return text;
}

// 在发送前拦截用户消息
async function onBeforeSend(message) {
    const settings = extension_settings[EXTENSION_NAME];
    if (settings.mode === "input" || settings.mode === "both") {
        const translated = await translateText(message, settings.provider, settings.targetLang);
        return translated;  // 返回修改后的消息
    }
    return message;
}

// 在收到回复后拦截
async function onMessageReceived(messageData) {
    const settings = extension_settings[EXTENSION_NAME];
    if ((settings.mode === "output" || settings.mode === "both") && messageData.is_user === false) {
        const translated = await translateText(messageData.mes, settings.provider, settings.targetLang, "en");  // 输出通常从 en 译
        messageData.mes = translated;
    }
}

// 添加设置面板
function loadSettings() {
    const html = `
        <div id="translate_settings_panel">
            <h3>翻译设置</h3>
            
            <label>翻译模式：</label>
            <select id="translate_mode">
                <option value="none">无翻译</option>
                <option value="input">仅翻译输入（用户消息）</option>
                <option value="output">仅翻译输出（AI回复）</option>
                <option value="both">翻译两者</option>
            </select>
            
            <label>翻译提供商：</label>
            <select id="translate_provider">
                <option value="google">Google Translate（免费）</option>
                <option value="bing">Bing Translate（免费）</option>
                <option value="llm">LLM API（如 Deepseek）</option>
            </select>
            
            <label>目标语言：</label>
            <select id="translate_target">
                <option value="en">English</option>
                <option value="zh">中文（简体）</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="ru">Русский</option>
                <!-- 可自行添加更多 -->
            </select>
            
            <div id="llm_options" style="display:none;">
                <label>LLM Connection Profile（留空使用主API）：</label>
                <input type="text" id="llm_profile" placeholder="Profile ID" />
                
                <label>System Prompt（调整翻译风格）：</label>
                <textarea id="system_prompt" rows="5" placeholder="You are a professional translator..."></textarea>
            </div>
        </div>
    `;

    $("#extensions_settings").append(html);

    // 填充当前值
    $("#translate_mode").val(extension_settings[EXTENSION_NAME].mode);
    $("#translate_provider").val(extension_settings[EXTENSION_NAME].provider);
    $("#translate_target").val(extension_settings[EXTENSION_NAME].targetLang);
    $("#llm_profile").val(extension_settings[EXTENSION_NAME].llmProfile || "");
    $("#system_prompt").val(extension_settings[EXTENSION_NAME].systemPrompt);

    // 监听变化
    $("#translate_mode, #translate_provider, #translate_target, #llm_profile, #system_prompt").on("change", function() {
        extension_settings[EXTENSION_NAME].mode = $("#translate_mode").val();
        extension_settings[EXTENSION_NAME].provider = $("#translate_provider").val();
        extension_settings[EXTENSION_NAME].targetLang = $("#translate_target").val();
        extension_settings[EXTENSION_NAME].llmProfile = $("#llm_profile").val();
        extension_settings[EXTENSION_NAME].systemPrompt = $("#system_prompt").val();
        saveSettingsDebounced();

        $("#llm_options").toggle(extension_settings[EXTENSION_NAME].provider === "llm");
    });

    $("#llm_options").toggle(extension_settings[EXTENSION_NAME].provider === "llm");
}

$(document).ready(() => {
    eventSource.on(event_types.MESSAGE_SWIPED, (data) => onMessageReceived(data));  // 处理 swipe
    eventSource.on(event_types.MESSAGE_RECEIVED, (data) => onMessageReceived(data));

    // 拦截发送（SillyTavern 使用 jQuery 触发 send 按钮）
    const originalSend = $("#send_but").off("click").click;  // 简单拦截
    $("#send_but").off("click").on("click", async () => {
        let input = $("#send_textarea").val();
        const translated = await onBeforeSend(input);
        if (translated !== input) {
            $("#send_textarea").val(translated);
        }
        originalSend.call($("#send_but")[0]);
    });

    loadSettings();
});