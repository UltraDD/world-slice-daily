# 世界切片 · 选题日报

Updated: 2026-10-28 · Owner: 动动 · Lifecycle: 持续使用的个人创作工具

从新闻、热榜、原生搜索和科学进展里寻找历史、科普与社会现象视频的具体疑问，优先关注熟悉事物中出人意料的细节。每天最多三个选题，给出画面思路、来源与核实清单，支持在聊天里加入待拍、跳过和撤销。

基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 的独立 Fork，保留 MIT 许可与 NOTICE。上游说明见 [upstream-README](docs/upstream-README.md)，架构与定制指南保留在 `docs/`。

## 日常使用：Codex 自动化

每天北京时间10点，每次运行新建一个独立对话展示日报：最多三题，包含主推、备选、切口、画面、制作成本与查证来源。直接在当次日报对话里追问、加入待拍、跳过或撤销；历史去重、偏好与反馈通过本机记录跨对话延续，筛选与写作使用Codex本身的模型。电脑与Codex App需保持运行。

采集入口不加载`.env`，不需要网页、数据库、Sub2API或独立模型密钥。历史日报与反馈保存在本机`.data/codex/`，旧网页数据保留。详细编辑规则、命令与反馈契约见[Codex选题自动化](docs/2026-10-28-codex-automation.md)。

```text
node modules/creator-daily/scripts/codex.ts context
node modules/creator-daily/scripts/codex.ts collect
node modules/creator-daily/scripts/codex.ts read
```

Node要求24.22.1以上。Windows本机可使用Codex打包运行时；路径选择见自动化说明。旧网页的采集和模型开关已关闭，避免两个入口重复出日报。

## 原网页使用（Windows，保留）

网页：<http://127.0.0.1:13000>。API 使用13001端口，独立数据库使用55433端口；服务只绑定本机。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update-daily.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-local.ps1
```

原网页需显式恢复`.env`中的`COLLECT_ENABLED`与`MODEL_CALLS_ENABLED`后才每日北京时间10点更新。手动更新使用页面“更新选题”。已有当天日报时命令行直接读缓存，加 `-Force` 才重新取数。`-CollectOnly` 仅采集，不调用模型，但仍依赖数据库。

后台在 `/admin`。复制本机管理员密码：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/copy-admin-password.ps1
```

当前安装复用本机已存在的PostgreSQL程序，使用独立数据目录。重启电脑后，先按原网关的 `start.ps1` 启动Sub2API，再启动本项目。Node要求24.22.1以上；可通过 `WORLD_SLICE_NODE`、`WORLD_SLICE_PG_BIN` 指定程序路径。新机器先安装依赖并按上游部署说明初始化数据库；本机脚本针对已经初始化的Windows安装。

## 原网页模型与成本

默认模型 `glm-5.3-flash`。地址通过 `.env` 的 `LLM_BASE_URL` 设置。当前本机使用既有Sub2API网关；加密密钥由本机凭据脚本解密至后端进程环境，不写入代码、Git或网页进程。标准按量API同样可配置。

`WORLD_SLICE_GATEWAY_ENV` 可指定自己的凭据加载脚本，或者直接在后端进程设置 `LLM_API_KEY`。真实调用依赖网关和上游账户可用。

默认每日最多12次模型请求。一期先初筛一次，再为最多三条线索逐题生成卡片；已收到但字段不完整的单卡最多校订一次。采集与模型调用分别由 `.env` 中 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 控制。阅读、筛选、收藏和刷新页面只读已保存结果。调用回执保存已收到的响应，结果不明的请求不自动重发。页面展示实际token用量，不把套餐转发换算为已经发生的人民币账单。

## 数据与来源

首版读取60s每日新闻、抖音热榜、知乎热榜、AI HOT精选、NASA和ScienceDaily。信源失败独立显示。源日期、观察时间与热榜名次分别保存；没有连续采样时不声称热度上涨。

新闻摘要用于发现选题；卡片的开场、画面与切口是创作提案，开拍前按卡片补齐原始证据。运行数据、模型回执、本机密码与日志位于Git忽略的 `.data/`，`.env` 同样不入库。

## 开发与验证

新增功能集中在 `modules/creator-daily/`；复用框架的数据库、队列、模型回执、API与SSR页面。

```powershell
npm.cmd run typecheck
npm.cmd run build -w '@aihot/web'
node --test modules/creator-daily/tests/sources.standalone.test.ts
$env:DATABASE_URL='postgres://worldslice@127.0.0.1:55433/world_slice_daily_test'
npm.cmd test
```

完整测试只使用以 `_test` 或 `_ci` 结尾的数据库；不得指向运行数据库。长任务使用workspace的 `scripts/tools/run-watched.ps1`。

- [首版实现与验收范围](docs/2026-10-27-implementation.md)
- [本机验证记录与未通过项](docs/2026-10-27-verification.md)
- [上游架构](docs/architecture.md)
- [上游部署说明](docs/deploy.md)
