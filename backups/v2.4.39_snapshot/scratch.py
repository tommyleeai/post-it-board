import sys

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

old = """                <!-- AI 助手設定 -->
                <div class="account-section">
                    <label>Gemini API 金鑰（AI 提醒解析）</label>
                    <input type="password" id="account-ai-key" class="settings-input" placeholder="AIzaSy... (選填)">
                </div>"""

new = old + """
                <!-- Ollama 本地 AI 備援設定 -->
                <div class="account-section" style="border-top: 1px dashed #ddd; padding-top: 15px; margin-top: 15px;">
                    <label style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
                        <span>啟用本地端 Ollama AI 備援 (遇 503 時)</span>
                        <input type="checkbox" id="account-ollama-enable" style="width: 18px; height: 18px; cursor: pointer;">
                    </label>
                    <div id="ollama-settings-group" style="display: none; flex-direction: column; gap: 10px; margin-top: 12px;">
                        <div>
                            <label style="font-size: 0.85em; color: #555; margin-bottom: 4px; display: block;">Ollama 伺服器網址</label>
                            <input type="text" id="account-ollama-url" class="settings-input" placeholder="預設: http://localhost:11434">
                        </div>
                        <div>
                            <label style="font-size: 0.85em; color: #555; margin-bottom: 4px; display: block;">Ollama 模型名稱 (必須確切命中)</label>
                            <input type="text" id="account-ollama-model" class="settings-input" placeholder="例如: gemma4:31b">
                        </div>
                    </div>
                </div>"""

if old in content:
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(content.replace(old, new))
    print('replaced normal')
else:
    old_crlf = old.replace('\n', '\r\n')
    if old_crlf in content:
        with open('index.html', 'w', encoding='utf-8') as f:
            f.write(content.replace(old_crlf, new.replace('\n', '\r\n')))
        print('replaced crlf')
    else:
        print('not found')
