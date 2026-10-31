# magpie-workbuddy-tasks

[magpie](https://github.com/yetone/magpie) 插件。在 magpie 社区 WorkBuddy 插件（`@magpie-community/opencode-workbuddy-auth`）的登录与对话能力之上，把 [workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub)（wb-proxy）里账号侧的每日自动化补进 magpie 的每日签到流程：

| 功能 | 版本 | 做什么 |
|---|---|---|
| 每日签到 | 国内版 | 查签到活动状态，开着且今天没签就签 |
| 对话活跃上报 | 国内版 | 每天上报一条 `chat_request_send` 事件，点亮成长中心连登天数和热力墙 |
| 猫猫旅行 | 国内版 | 归来领奖；在家且今天没去过就派出；没有 Buddy 先完成「领取一只 Buddy」 |
| 夜猫子任务 | 国内版 | 签到发生在北京时间 23:00–08:00 时上报一次夜间事件，累计 3 天领奖 |
| 连登管家 | 国内版 | 昨日漏签且有补签卡就补签；7/14/28 天档位解锁即兑换；抽完抽奖次数；领新手礼包、活动补偿 |
| 成长任务与积分任务 | 国内版 | 批量接取、按任务上报行为事件、等进度到账后领奖 |
| 每日活跃会话 | 国际版 | 在 www.workbuddy.ai 网页端开一条云端 agent 会话，说一句 Hi（可选随机日常小问题）并跑完，领官方每日 30/50 积分包；跑完即结束会话释放名额，名额满时自动结束本插件留下的旧会话 |

积分余额、Token 刷新、多账号、对话请求本身仍由社区插件和 magpie 负责，本插件不重复实现。

## 原理

- magpie 给插件的 `auth` 钩子留了 `checkin(getAuth, provider)`：签到开关打开后，magpie 对每个已登录账号每个北京日调一次（启动 2 分钟后第一次，之后每 30 分钟看一眼，北京时间 0 点日切时立刻再看；`failed` 30 分钟后重试；北京时间正午前的 `done` / `inactive` / `ineligible` 算临时结果，30 分钟后再问，直到正午；其余结果当天不再调）。结果显示在用量卡片和「设置 → 用量 → 插件」里。因为会被再问，猫猫旅行和成长任务距上次跑不满 3 小时就跳过，其余步骤每天只做一次。
- 同一个 provider id 只能由一个插件服务。本插件导入 magpie 已安装的社区插件模块（`<magpie 配置目录>/plugins/node_modules/@magpie-community/opencode-workbuddy-auth`，与 magpie 加载的是同一份模块实例），原样转发它的 `config`、`chat.headers`、`provider`、`auth`（登录方式、`loader`、`usage`、`refresh`），只在 `auth` 上加 `checkin` 和插件选项。用 `magpie plugin use` 让本插件服务 `workbuddy` / `workbuddy-ai` 后，登录态仍是 magpie `plugin-auth.json` 里按 provider id 存的那一份，**不用重新登录**；对话、模型、额度行为与社区插件完全相同。
- 找不到社区插件时本插件什么都不注册，社区插件照常单独服务。
- 社区插件 0.2.0 起自带国内版签到钩子，走的是同一组 `/v2/billing/meter` 接口。本插件服务 `workbuddy` 时用自己的签到替代它（同样对 5xx 和 `code 10000` 重试两次），另外把 11140 风控、「处理中，请勿重复操作」和带「失败」字样的回执分别认作风控和失败，不当签到成功。同一账号不会被签两次。
- 每次签到先签到（国内版）再跑其余步骤。每个账号一轮有时间预算（国内版 75 秒、国际版 100 秒），因为 magpie 一轮签到对所有账号总共只等 2 分钟；做不完的成长任务留到下一天。同一账号同时只跑一轮。
- 每天只该做一次的步骤（活跃上报、夜猫子、连登管家、国际版会话）记在 `<magpie 配置目录>/workbuddy-tasks.json`：键是 provider 加 uid 的哈希，内容只有日期、完成标记、各步骤上次运行时间、国际版最近建过的会话 id 和最后一条结果说明，不含 token、uid。可用环境变量 `MAGPIE_WORKBUDDY_TASKS_STATE` 改位置。
- 请求头：签到与积分接口沿用社区插件的写法（`copilot.tencent.com`，`User-Agent: WorkBuddy/<版本>`）；成长、猫猫、上报接口用 wb-proxy 的桌面端身份头。版本号跟随已装社区插件声明的桌面端版本（当前 5.9.3、CLI 2.165.0），和同一账号的对话请求保持一致；`www.codebuddy.cn` 的计费接口带 wb-proxy 同算法派生的 `X-Machine-ID` / `X-Session-ID`（`md5("<salt>:<uid>")` 改成 UUIDv4 形状，salt 为 `machine` / `session`，同账号恒定、跨账号不同）。
- 任何接口回 403 `code 11140`（账号被风控限制）立即停手，当天不再碰这个账号。
- 同一 uid 的个人账号和企业账号（社区插件 0.2.1 起分开登录）各记各的状态，互不串结果。
- 国际版每个账号同时最多 10 条活跃会话（超了建会话回 429 `10105`）。每日会话跑完就 stop（留在网页端历史里），没跑完的 stop 后删掉；开跑前先 stop 本插件留下、超过 30 分钟还在跑的会话；撞上 10105 时按创建时间从旧到新 stop 本插件的会话，把活跃数降到 8 再建一次。只认本插件记下的最近 16 条会话 id，或名字是 `Hi` / 内置提示词的会话（服务端有时会给会话自动改标题），用户自己的对话不碰。建会话或取沙箱失败（5xx、超时、沙箱未就绪）时间够就隔 5 秒再试一轮。

### 定时任务与 magpie 每日钩子

wb-proxy 自己常驻调度（09:00/21:00 签到与猫猫、22:00 保活、01:00 夜猫子）。在 magpie 里：

- **09:00 / 21:00 两次**：wb-proxy 跑两次是为了补漏和「早上派出、晚上领奖」。magpie 一天一次就够：猫猫一天只能旅行一次、几小时就回，下一次签到先领上一趟的奖再派出新的一趟；签到失败 magpie 自己 30 分钟后重试。
- **22:00 Token 保活**：不需要。社区插件给了 `auth.refresh`（到期前 5 分钟由 magpie 续期），magpie 在每次请求、读模型、读额度、签到前都会续期，每天的签到本身就会把 refresh token 滚动一次。
- **01:00 夜猫子**：magpie 的签到循环在北京时间 0 点日切时立刻触发（每分钟看一次钟，机器睡过 0 点则醒来时触发），正好落在 23:00–08:00 窗口内，夜猫子在那一次里完成。如果 Mac 在 0 点睡着、白天才醒，那天会落在窗口外而跳过；任务是累计 3 天，不要求连续，之后的夜里会补上。用 launchd 在 01:00 再跑 `magpie accounts checkin` 没有用：当天已有结果的账号 magpie 不会再调插件。所以不需要额外的定时器，也不起常驻进程。

## 安装

前提：magpie 支持插件的 `auth.checkin` 钩子（0.1.1293 起，0.1.1647 上验证过），且已装社区插件 `@magpie-community/opencode-workbuddy-auth`（0.2.5 上验证过）。

```sh
magpie plugin add github:uoox/magpie-workbuddy-tasks   # 或本地目录的绝对路径
magpie plugin use github:uoox/magpie-workbuddy-tasks workbuddy
magpie plugin use github:uoox/magpie-workbuddy-tasks workbuddy-ai
magpie plugin                                           # 看到本插件服务 workbuddy、workbuddy-ai
```

然后：

1. 登录（已在 magpie 里登录过的账号跳过）：`magpie plugin login workbuddy` / `magpie plugin login workbuddy-ai`，选 **account (browser)**，在浏览器里完成腾讯登录。
2. 打开签到开关：magpie 设置 → 用量 → 插件 → WorkBuddy / WorkBuddy AI 的「Daily check-in」。WorkBuddy（国内版）没单独设过时跟随 magpie 原来的 WorkBuddy 签到开关。
3. 想立刻跑一次：`magpie accounts checkin`（会同时按下 magpie 里所有已登录服务的签到）。
4. 每一项都能单独关：magpie 里打开 WorkBuddy / WorkBuddy AI 这个 provider 的编辑页，在「Plugin options」里切 Off。

卸载：`magpie plugin rm <添加时用的名字>`，`workbuddy` / `workbuddy-ai` 自动回到社区插件，登录态不受影响。

## 风险

- **成长任务、活跃上报、夜猫子都是伪造的行为事件**（客户端埋点 `/v2/report`），不是真的在桌面端做了这些事。WorkBuddy 可以据此判定异常。wb-proxy 社区记录过国际版自 2026-10-15 起风控明显收紧（403 `11140`「账号存在异常行为，已被限制使用」），被限制后只能在 WorkBuddy 里提交反馈申诉。怕风险就在选项里关掉 `growth`、`activity`、`night`，只留签到和猫猫。
- 签到接口可能回 401：WorkBuddy 官方 App 的签到带安全 SDK 生成的 `X-Device-Token`，第三方做不出来。此时积分接口正常的话插件报 `captcha`，magpie 会提示「在它自己的 App 里签到」，当天不再重试；其余步骤照跑。
- 国际版每日活跃会在 WorkBuddy 云端真的开一个 agent 会话（默认用免费的 `deepseek-v4.1-flash`），会出现在网页端会话列表里。0.2.0 之前的版本跑完不收尾，每天漏一条活跃会话，十天后建不出新会话；升级后第一次跑会自动清掉。
- 「关注公众号」「公益捐赠」这类需要真人的任务、以及只认桌面端真实点击的任务（资料库、Buddy 应用、桌面对话事件链）不伪造，只在结果里计数提示。
- 本插件不处理验证码，也不会替你登录。
- 接口与事件格式来自 wb-proxy v1.9.2（2026-10-29）的逆向成果，WorkBuddy 改版后可能失效；失效时结果说明里会写出上游返回。

## 开发

零运行时依赖，Bun 直接跑：

```sh
bun test
```

测试全部用假的 `fetch`，不连 WorkBuddy。`index.mjs` 只导出两个插件函数（magpie 会把模块导出的每个函数都当插件加载），其余代码在 `src/`。

## 致谢

接口、事件构造与派生算法参考 [ardeyouxipianyi/workbuddy2api-hub](https://github.com/ardeyouxipianyi/workbuddy2api-hub)（及其致谢的 Sliverkiss/workbuddy2api 等）；登录、对话与额度来自 [magpie-community/plugins](https://github.com/magpie-community/plugins) 的 WorkBuddy 插件。

## License

MIT
