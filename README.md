# dsh-auto

Magpie Auto 的 dsh 客户端插件。Magpie 调用真正的 `jev-1.13-free`，返回结构化决策；这个插件通过 dsh 原生会话、工具和子代理接口落实决策。主代理和子代理使用同一个 DeepSeek 执行模型。插件不包含智能体执行运行时。

需要 dsh `0.1.5-rc.1` 及本 fork 的 Magpie Auto 决策接口。服务器已经具备这些依赖。

## 启用

安装到要使用的 dsh profile：

```bash
dsh plugin --profile headless add github:ZhiweiWei-NAMI/dsh-auto
```

在 `$DSH_HOME/cordis.patch.yml` 加入以下配置。插件使用原生压缩事务，所以 Auto 模式下关闭原有自动压缩插件，避免同时修改同一段历史。

```yaml
- id: compaction-basic
  disabled: true
- insert:
    - id: magpie-auto
      name: dsh-auto
      config:
        mode: auto
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

模型连接、默认执行模型位于 `$DSH_HOME/settings.yaml`；插件启用及限制位于 `$DSH_HOME/cordis.patch.yml`。`recordFile` 可指定一个已存在、可写目录中的 JSONL 文件，记录 Jev 用量和原生子代理生命周期。

## 行为

执行模型通过原生 `subagent` 或 `subagent_fork` 提出具体子任务；Jev 分别判断未完成价值、依赖、配置匹配和会话延续性。插件据此让主代理继续、创建原生 continuable 子代理，或通过 `sendMessage` 延续已有子代理。默认后台执行，主代理可以同时工作；显式前台请求才等待。Jev 是评分/选择模型，不生成自由文本任务计划。

在 Magpie 控制台的策略输入框，可以输入例如“自动决策，优先正确性和缓存，偏好实现代理，只在独立子任务有明确收益时协作”。Magpie 用一次真实 Jev 调用生成模式和初始偏好；相同指令与路由再次保存不重复调用。新会话读取并固定策略，已有会话不随全局编辑漂移。策略存入 dsh 原生 storage domain：`$DSH_HOME/storages/dsh_auto/`；模型历史仍由原生 session 管理，不向事件日志写入 SDK 不认识的事件类型。

`routes` 是允许使用的角色、模型和 effort。插件用 dsh 的连接准备接口检查候选配置；主代理默认模型仍由 `settings.yaml` 设置。当前服务器只实测 `deepseek-v4.1-flash` + `high`，不能据此声称跨模型路由提高了质量。策略权重是用户偏好，不是模型成功概率。

执行请求保留系统提示、工具定义和历史顺序，新内容追加。仅在压力达到阈值时，对旧区域的完整逻辑块分别问重要性与归属；不确定的证据保留。超大的块完整分片，任一片段保留则保留整块。选择后仍需达到最低预计缩减比例，才通过 dsh 原生压缩事务替换；否则提高下一次触发阈值。原始任务要求、近期工具配对和完整原始日志保留。归属评分参与保留判断和审计，不自动广播原始历史给全部子代理。

压力使用最近 API 实际输入加新增内容估算，避免原生累计估算量过高导致重复决策。没有 usage 时明确使用原生估算；估算不记作消耗。质量偏好提高保守保留和委派的置信门槛，缓存偏好提高替换所需缩减比例与再次决策间隔；时间/用量偏好提高委派收益门槛，角色初始偏好影响合格配置的排名。这些是可检查的启发式规则，尚非经过性能标定的最优策略。

任务共享子代理数量、并发和请求预算；达到子代理预算后主代理仍可继续。每次原生激活单列计数，不把同一子代理两次继续计成两个代理。决策预算不足时明确记录并使用原生压缩；Jev HTTP 错误直接保留并报告，不重试或伪造保留答案，不切换付费模型。Jev 与执行模型分别调用、分别计量。

## 关闭

删除 `magpie-auto` 插件条目并重新启用 `compaction-basic`，恢复原生 dsh 行为。只关闭 Jev、保留任务子代理上限时，可以把 `mode` 改为 `native`，同时把 `compaction-basic.disabled` 改为 `false`。

`mode: single` 禁止原生子代理调用，供单代理对照实验使用。单代理模式同样需要启用原生 `compaction-basic`。

也可以在 Magpie 策略框明确要求固定单代理或原生调度：`mode: auto` 插件读取该快照后采用原生压缩，任务中不调用 Jev；首次编译配置的 Jev 调用仍需单独计入。它与直接设定插件的 `single` / `native` 模式是两种入口。

## 验证

v0.3.0 的真实编程探针完成了同一个原生子代理的两次激活与结果回收。第二次激活首请求保持系统提示、工具和历史前缀稳定，实测输入 11,513、命中 6,912、未命中 4,601 token。另一个刻意降低压力阈值的探针完成两次真实 Jev 上下文替换，代码测试及末尾的制表符约束通过。这证明链路可运行，不证明性能提升；失败的开发探针也保留在[修订记录](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-routing-revision)。

固定十二题 SWE-bench Verified 已完成三组官方判分：Auto 解决 6/12，单代理与原生可选子代理各解决 8/12。正式 Auto 运行启动三个调查子代理，一位完成，两位失败；原生可选组自行选择了全部单代理执行。71 次 Jev 请求均成功。实际补丁、主代理/子代理/Jev 用量和缓存统计见 [实验记录](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-cache-20261012)。

上述十二题使用旧 v0.2.2；三组全部解决的五题中，Auto 比单代理少 12.7% 未命中 token，但输出多 27.9%、耗时多 6.7%，未证明整体节省。旧正式任务未发生上下文替换。v0.3.0 的两题诊断另列，不覆盖旧结果，不作为无偏的新 benchmark。当前 WorkBuddy 服务仍轮换账号，缓存条件限制了结论。
