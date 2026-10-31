# magpie-workbuddy-tasks

magpie 插件：包一层社区 WorkBuddy 插件（`@magpie-community/opencode-workbuddy-auth`），原样转发它的钩子，只换掉 `auth.checkin`、追加选项，在签到时跑国内 / 国际版的每日任务。

- 本机 magpie 直接从这个目录加载本插件，两个 provider 都已登录、每天真跑；改代码等于改线上，`magpie accounts checkin` 会真签到、真上报事件，跑之前问用户。状态在 `~/.config/magpie/workbuddy-tasks.json`，magpie 自己的签到记录在 `plugin-checkin.json`。
- 测试：本机没装 bun，用 `npx -y bun@1.3.1 test`。测试全走假 fetch。
- 上游三个，合并时都看：社区插件 `magpie-community/plugins` 的 `packages/workbuddy`（版本号、请求头、签到写法、登录态字段）；`ardeyouxipianyi/workbuddy2api-hub`（任务接口与事件，README 写了对齐到哪个版本）；magpie 本体 `yetone/magpie` 的 `internal/plugin/host.js` 与 `internal/provider/{plugin_checkin,checkin,workbuddy_checkin}.go`（钩子契约）。
- magpie 钩子契约要点：调钩子前已续好 token；一轮签到所有插件所有账号顺序跑、共 2 分钟；outcome 只认 claimed/done/ineligible/inactive/captcha/failed；抛错按离线 1 分钟退避；正午前的 done/inactive/ineligible 每 30 分钟再问；`until` 到点再问；选项 key `[a-z0-9_-]{1,40}`、最多 16 个、label ≤60、description ≤300。
- 代码不写注释，不加解释性 md，给人看的只有 README。
