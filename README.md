# dsh-auto

Magpie Auto 的 dsh 客户端插件。Magpie 调用真正的 `jev-1.13-free`，返回结构化决策；这个插件通过 dsh 原生会话、工具和子代理接口落实决策。主代理和子代理使用同一个 DeepSeek 执行模型。插件不包含智能体执行运行时。

需要 dsh `0.1.5-rc.1` 及本 fork 的 Magpie Auto 决策接口。服务器已经具备这些依赖。

## 启用

服务器已安装到本机 `$DSH_HOME/profiles/auto`，直接选择：

```bash
# 启用 Auto，执行当前目录的任务
dsh --profile auto "你的编程任务"

# 同一模型连接，关闭 Auto，使用原生 dsh
dsh --profile auto --patch "$DSH_HOME/profiles/auto/node_modules/dsh-auto/off.patch.yml" "你的编程任务"
```

原有 `web`、`headless` 等 profile 保持原配置。`auto` 使用本机 dsh 的会话、工具和存储，不另设运行时或 `DSH_HOME`。以上开关在启动时选择，长任务中不要切换。

其他机器安装到一个新 profile（首次初始化执行一次）：

```bash
dsh --profile auto --from-default-profile headless --dump-config >/dev/null
dsh plugin --profile auto add github:ZhiweiWei-NAMI/dsh-auto#v0.3.1
```

v0.3.1 声明了原生 `dsh.bundle`，安装后自动挂载插件并停用 `compaction-basic`，无需手写 `insert`。卸载 `dsh plugin --profile auto remove dsh-auto` 会移除该层并恢复原生压缩。旧版手工添加的 `magpie-auto` 和压缩开关应先从用户 patch 中移除，避免重复挂载。

执行模型连接仍需配置。服务器 `auto/cordis.patch.yml` 将 `settings` 指向同目录的 `settings.yaml`，其中选择 `deepseek-official` 适配器、`dsh-workbuddy/deepseek-v4.1-flash` 模型和 `http://127.0.0.1:3435/v1` 网关。该 profile 的 `.credentials.yaml` 仅存本机网关所需的非秘密占位值，不含上游账号或 Console 密钥。

需要覆盖插件限制时，在 **profile 自己的** `$DSH_HOME/profiles/auto/cordis.patch.yml` 增加：

```yaml
- id: magpie-auto
  config:
    endpoint: http://127.0.0.1:3435/v1/auto/decide
    maxChildren: 2
    maxConcurrent: 2
    maxChildRequests: 16
    maxChildTurnRequests: 8
    maxDecisions: 12
    pressureTokens: 64000
    retainTokens: 8000
```

Magpie 的 Auto 配置指定 `decider: jev-1.13-free` 和 Console 密钥文件的绝对路径。密钥只由服务器读取，dsh 不接收 Console 密钥。执行模型连接仍使用已有 Magpie 网关和 dsh-workbuddy 服务。

本机 Auto 的模型连接和默认执行模型位于 `$DSH_HOME/profiles/auto/settings.yaml`；插件限制位于同目录 `cordis.patch.yml`。不要写进 home 级 patch，以免影响其他 profile。`recordFile` 可指定一个已存在、可写目录中的 JSONL 文件，记录模型用量和原生子代理生命周期。

## 行为

执行模型通过原生 `subagent` 或 `subagent_fork` 提出具体子任务；Jev 分别判断未完成价值、依赖、配置匹配和会话延续性。插件据此让主代理继续、创建原生 continuable 子代理，或通过 `sendMessage` 延续已有子代理。默认后台执行，主代理可以同时工作；显式前台请求才等待。Jev 是评分/选择模型，不生成自由文本任务计划。

在 Magpie 控制台的策略输入框，可以输入例如“自动决策，优先正确性和缓存，偏好实现代理，只在独立子任务有明确收益时协作”。Magpie 用一次真实 Jev 调用生成模式和初始偏好；相同指令与路由再次保存不重复调用。新会话读取并固定策略，已有会话不随全局编辑漂移。策略存入 dsh 原生 storage domain：`$DSH_HOME/storages/dsh_auto/`；模型历史仍由原生 session 管理，不向事件日志写入 SDK 不认识的事件类型。

`routes` 是允许使用的角色、模型和 effort。插件用 dsh 的连接准备接口检查候选配置；主代理默认模型仍由 `settings.yaml` 设置。当前服务器只实测 `deepseek-v4.1-flash` + `high`，不能据此声称跨模型路由提高了质量。策略权重是用户偏好，不是模型成功概率。

执行请求保留系统提示、工具定义和历史顺序，新内容追加。仅在压力达到阈值时，对旧区域的完整逻辑块分别问重要性与归属；不确定的证据保留。超大的块完整分片，任一片段保留则保留整块。选择后仍需达到最低预计缩减比例，才通过 dsh 原生压缩事务替换；否则提高下一次触发阈值。原始任务要求、近期工具配对和完整原始日志保留。归属评分参与保留判断和审计，不自动广播原始历史给全部子代理。

压力使用最近 API 实际输入加新增内容估算，避免原生累计估算量过高导致重复决策。没有 usage 时明确使用原生估算；估算不记作消耗。质量偏好提高保守保留和委派的置信门槛，缓存偏好提高替换所需缩减比例与再次决策间隔；时间/用量偏好提高委派收益门槛，角色初始偏好影响合格配置的排名。这些是可检查的启发式规则，尚非经过性能标定的最优策略。

任务共享子代理数量、并发和请求预算；达到子代理预算后主代理仍可继续。每次原生激活单列计数，不把同一子代理两次继续计成两个代理。决策预算不足时明确记录并使用原生压缩；Jev HTTP 错误直接保留并报告，不重试或伪造保留答案，不切换付费模型。Jev 与执行模型分别调用、分别计量。

## 关闭

使用上面的 `off.patch.yml`，同时卸载本次进程中的 Auto 插件并恢复 `compaction-basic`；关闭后不调用 Jev，也不施加插件的子代理预算。普通 `headless` / `web` profile 原本就未启用本插件。

只关闭 Jev、保留任务子代理上限时，可以把 `mode` 改为 `native`，同时把 `compaction-basic.disabled` 改为 `false`。

`mode: single` 禁止原生子代理调用，供单代理对照实验使用。单代理模式同样需要启用原生 `compaction-basic`。

也可以在 Magpie 策略框明确要求固定单代理或原生调度：`mode: auto` 插件读取该快照后采用原生压缩，任务中不调用 Jev；首次编译配置的 Jev 调用仍需单独计入。它与直接设定插件的 `single` / `native` 模式是两种入口。

## 验证

v0.3.0 已通过原生 dsh 从 GitHub 安装，并在真实编程探针中由 Jev 选择复用同一个子代理，完成两次激活与结果回收。第二次激活首请求保持系统提示、工具和历史前缀稳定，实测输入 9,607、命中 6,784、未命中 2,823 token。此次共 5 次 Jev 判断，包含被拒绝后重新提出的候选；不能把这部分开销隐去。另一个刻意降低压力阈值的探针完成两次真实 Jev 上下文替换并通过代码测试。这证明链路可运行，不证明性能提升；失败的开发探针也保留在[修订记录](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-routing-revision)。

固定十二题 SWE-bench Verified 已完成三组官方判分：Auto 解决 6/12，单代理与原生可选子代理各解决 8/12。正式 Auto 运行启动三个调查子代理，一位完成，两位失败；原生可选组自行选择了全部单代理执行。71 次 Jev 请求均成功。实际补丁、主代理/子代理/Jev 用量和缓存统计见 [实验记录](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-cache-20261012)。

上述十二题使用旧 v0.2.2；三组全部解决的五题中，Auto 比单代理少 12.7% 未命中 token，但输出多 27.9%、耗时多 6.7%，未证明整体节省。旧正式任务未发生上下文替换。v0.3.0 的两题诊断另列，不覆盖旧结果，不作为无偏的新 benchmark。当前 WorkBuddy 服务仍轮换账号，缓存条件限制了结论。

本轮两题三组官方解决率均为 1/2；三轮短任务每组 3/3，任务级 Jev 均为零。短任务耗时中位数 A/B/C 为 16.55 / 16.95 / 18.16 秒，样本不足以宣称显著优势。系统和工具稳定仍不能保证命中：同一会话切到新账号常仅命中 0–384 token，回到旧账号时命中量接近它先前接收的输入。共享服务未重启，不能把缓存抖动说成已经全部解决。
