# TokPulse

自有、无 npm 依赖的 macOS Node.js + CDP 注入器。在聊天输入框下方增加一行输出速度，输出时显示 `≈ 42.6 tok/s`，结束或停顿后保留最近一次测得的速度。当前对话尚无测速记录时显示 `— tok/s`。不使用 ChatGPT 插件，不改安装包、不重新签名。

## 当前验证边界

- 本机 `/Applications/ChatGPT.app`：26.1007.30912，bundle ID `com.openai.codex`，Chromium 155.0.8059.40。
- CDP 启动及绑定 `127.0.0.1` 已实测。
- 真实 Codex 对话：正常挂载、输入框尺寸不变、18px 状态行正常占位、实时文字输出计速已实测。
- 已有 ChatGPT 对话：切换后自动挂载、历史不计数已实测。
- ChatGPT 页面使用安装包中的标记适配；Work 的真实生成过程仍需验证。测试页通过不能证明真实 Work 兼容。
- `test/fixture.html` 是根据本机标记制作的测试页，测试截图也属于测试页。

## 安装与启动

需要 Node.js 22 或以上；本机已检测到 Node.js 24.15.0。不需要 `npm install`。

```sh
npm test
npm run test:browser
npm run install:auto
```

为兼容已有安装，系统服务和安装目录继续沿用 ChatGPT Token Speed 名称。安装后，代码复制到 `~/Library/Application Support/ChatGPT Token Speed/app`，LaunchAgent 注册到 `~/Library/LaunchAgents/local.chatgpt-token-speed.plist`。安装脚本不会退出正在工作的 ChatGPT。

**首次启用**：完成当前工作后，使用 `⌘Q` 完全退出 ChatGPT，再双击 `scripts/启动.command`。之后打开/切换对话、新窗口和页面重载，状态栏会自动挂载，不需要在聊天中运行指令。

登录 macOS 时，LaunchAgent 会启动注入器。如果此时 App 尚未启动，它会带调试参数启动 App。若 App 已经运行且未启用 CDP，注入器等待，不强制重启。**完全退出后从原始 Dock 图标重新启动，调试参数不会保留**；此时应使用附带的启动脚本。免改安装包的方案无法让原始图标永久携带调试参数。关闭窗口、切换聊天不影响注入。

安装同时创建 `~/Library/Application Support/ChatGPT Token Speed/ChatGPT Token Speed.app`，可把这个专用启动入口拖进 Dock。它启动原版 ChatGPT 并带上本机调试参数，随后自动启用注入器。无需替换或修改原版 App。若原版 App 已经启动且没有 CDP，请先完全退出再使用专用入口；启动入口不会偷偷重启正在工作的 App。

也可手动运行：先双击启动脚本，再在项目目录执行 `npm start`。安装自动启动之后无需保持终端打开。

双击 `.command` 若找不到 Node，终端执行上述 npm 命令即可，或设置 `TOKEN_SPEED_NODE` 为 Node 的绝对路径。自动启动配置记录当前 Node 的绝对路径，升级或移除该 Node 版本后需要重新安装自动启动。

## 关闭与卸载

```sh
npm run stop
npm run uninstall
```

也可双击 `scripts/关闭.command` 或 `scripts/卸载.command`。关闭会停止 LaunchAgent，并移除状态行、监听器和页面重载注册；卸载还会删除本项目的安装目录和 LaunchAgent，不删除 ChatGPT 数据。

CDP 是 App 的启动参数：关闭注入器不会关闭端口。需要关闭调试端口时，完全退出 App，然后从原始图标启动。`关闭` 只停止本次登录的自动启动；下一次登录会再次加载，永久关闭请卸载。

## 计速规则和局限

仅在当前输入框的原生“停止 / Stop”按钮出现时计速；工具运行、音频播放等其他位置的停止按钮不会启用计速。只读取最新助手正文的追加文字，不读取输入框、工具输出或隐藏的角色标题。

现有文字作为基线；新挂载的助手节点也先作为基线，再统计后续增量。这样避免历史加载、虚拟列表重挂载被当作新输出，但会漏掉第一批文字。极短回答可能无法测得新速度，此时保留此前结果；没有此前结果时显示 `— tok/s`。文字替换、缩短、格式重排也不计数。未识别的 DOM 结构会停止计速或不挂载，不能据此判断模型速度为零。

使用 3 秒滑动窗口，至少采样 0.5 秒，250ms 刷新。回复结束或 1.4 秒没有文字增量时，保留最近一次测得的窗口速度，避免等待时间将显示值拉低；下一次回复有可测输出时再替换。保留值不是整段回复平均速度，在提示文字中标为最近一次测速。同一窗口内暂存最多 64 个对话的数值，切换回来可恢复；页面重载、App 重启或注入器更新会清空缓存，不写入磁盘。

这是**可见正文交付速度的启发式估算**，不是服务端 Token 数或模型推理速度；思考、工具调用、隐藏输出不计入。中文等 CJK 字符约按 1.3 Token/字符，ASCII 按 0.25 Token/字符，emoji 按 2 Token/码点估算。不同语言、代码、分词器和批量渲染都会造成误差。

状态行只有输出速度，`≈` 和提示文字用于表明估算。样式使用系统字体及原生主题颜色，占据独立 18px 行。新增一行必然占用空间，输入框可能上移、消息可视区域可能减少 18px；原生消息和按钮不会被覆盖或删除。用户调整的字体、缩放、主题和 App 更新仍需复核。

## 本机安全边界

- 启动参数固定 `--remote-debugging-address=127.0.0.1`；连接前用 `lsof` 核验实际监听地址，拒绝 `*`、局域网 IP、IPv6 或混合监听。
- 核验端口所属进程来自配置的 App；只连接 `app://-/index.html` 和 detached window，排除浏览器、MCP、头像、预热页面。
- HTTP 不允许重定向，WebSocket 必须是相同端口的 `ws://127.0.0.1`。
- 对话文字只在渲染器内存中临时比较，不传回 Node，不写入日志、不发送到网络，不保存 Token 总数。
- CDP 没有认证，同一 Mac 的其他本地进程也可能访问它。监听本机避免局域网访问，但不隔离本机进程。用完可退出 App 关闭端口。

## 项目结构

- `src/core.js`：估算器、追加判定、滑动窗口。
- `src/renderer.js`：页面适配、MutationObserver、正常布局状态行、清理。
- `src/cdp.mjs`：自有 CDP 客户端与本机地址核验。
- `src/daemon.mjs`：多窗口发现、重连、重载注入。
- `src/cli.mjs`：安装、启动、关闭、卸载、诊断。
- `test/`：单元测试和实际 Chromium 自动化测试，无 npm 测试依赖。

`npm run doctor` 查看 App 与 CDP 状态。默认端口 9333。自定义安装可用 `node src/cli.mjs install --config /absolute/config.json`：

```json
{"appPath":"/Applications/ChatGPT.app","executable":"ChatGPT","port":9333,"autoLaunch":true}
```

诊断日志在安装目录的 `injector.log`，只包含连接状态和页面数量，不包含消息文字。若端口被其他应用占用，先选新的本机端口，不要强行连接或结束其他程序。

官方插件文档：[Plugins](https://learn.chatgpt.com/docs/plugins)。Electron 启动参数：[Command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches)。本项目不依赖官方提供输入框注入扩展点，不包含第三方注入项目代码。

完整证据见 `验证结果.md`。本机安装验证不等于已经重登 macOS 测试自动启动，也不等于真实 Work 流式输出验证。

## 0.1.1 修复

修复真实 Electron 窗口可见但 `document.hidden` 为 true 时，计速样本被持续清空、状态栏一直显示 `— tok/s` 的问题。使用输入框和助手正文的实际 DOM 可见性判断，页面可见性标记不再清空计速窗口。已补充对应浏览器回归检查。

## 0.1.2 更新

根据用户需求，回复完成、停止、工具停顿或下一轮等待期间，保留当前对话最近一次测得的输出速度。新一轮可测输出会更新它；未测速的对话显示 `— tok/s`，不会借用其他对话的速度。仅保留数值，既有消息仍不计入。
