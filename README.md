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
        pressureTokens: 24000
        retainTokens: 8000
```

Magpie 的 Auto 配置指定 `decider: jev-1.13-free` 和 Console 密钥文件的绝对路径。密钥只由服务器读取，dsh 不接收 Console 密钥。执行模型连接仍使用已有 Magpie 网关和 dsh-workbuddy 服务。

模型连接、默认执行模型位于 `$DSH_HOME/settings.yaml`；插件启用及限制位于 `$DSH_HOME/cordis.patch.yml`。`recordFile` 可指定一个已存在、可写目录中的 JSONL 文件，记录 Jev 用量和原生子代理生命周期。

## 行为

每个执行会话开始时，Jev 从单代理、独立调查、双调查并行中选择。当前实现先收回调查结果，再由主代理写代码；两位调查者可彼此并行，主代理会等待调查。插件调用 `ctx.subagents.start`，等待原生结果并回收句柄，再把完整调查结果追加给主代理。它不让普通模型代理冒充子代理控制器。

执行请求保留 dsh 的系统提示、工具定义和历史顺序。新内容追加。达到上下文压力阈值时，先用较小的 Jev 请求判断是否需要调整；其决定可以是保留现有缓存前缀。只有选择调整时才分批判断全部候选历史，遵守 Jev 的状态大小限制。较大的单条来源会完整分片判断，任一片段有用就保留整条来源。只有有益的完整片段筛选才通过 dsh 原生事务替换旧历史。系统提示、原始任务和最近的工具配对不被拆开；原始事件日志仍保留。

阈值使用 dsh 的 token meter 估计；实验用量取实际接口返回字段。Jev 与执行模型分别调用，分别计量。API 失败明确报告，不切换 GLM 或付费 Jev。

## 关闭

删除 `magpie-auto` 插件条目并重新启用 `compaction-basic`，恢复原生 dsh 行为。只关闭 Jev、保留任务子代理上限时，可以把 `mode` 改为 `native`，同时把 `compaction-basic.disabled` 改为 `false`。

`mode: single` 禁止原生子代理调用，供单代理对照实验使用。单代理模式同样需要启用原生 `compaction-basic`。

## 验证

原生 dsh 已成功安装 v0.2.2，并完成真实编程任务与测试。另一个小任务实际启动两个原生调查子代理、收回完整结果并产出通过测试的代码。

固定十二题 SWE-bench Verified 已完成三组官方判分：Auto 解决 6/12，单代理与原生可选子代理各解决 8/12。正式 Auto 运行启动三个调查子代理，一位完成，两位失败；原生可选组自行选择了全部单代理执行。71 次 Jev 请求均成功。实际补丁、主代理/子代理/Jev 用量和缓存统计见 [实验记录](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-cache-20261012)。

三组全部解决的五题中，Auto 比单代理少 12.7% 未命中 token，但输出多 27.9%、耗时多 6.7%，未证明整体节省。正式任务的压力决策全部保留历史，没有实际上下文替换；完整来源分批选择已有短回归，原生事务中应用真实 Jev 筛选的效果仍未验证。当前 WorkBuddy 服务仍轮换账号，缓存条件也限制了结论。
