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

开始任务时，Jev 从单代理、独立调查、双调查并行中选择。插件调用 `ctx.subagents.start`，等待原生结果并回收句柄，再把完整调查结果追加给主代理。它不让普通模型代理冒充子代理控制器。

执行请求保留 dsh 的系统提示、工具定义和历史顺序。新内容追加。达到上下文压力阈值时，才让 Jev选择历史；其决定可以是保留现有缓存前缀。只有有益的完整片段筛选才通过 dsh 原生事务替换旧历史。系统提示、原始任务和最近的工具配对不被拆开；原始事件日志仍保留。

阈值使用 dsh 的 token meter 估计；实验用量取实际接口返回字段。Jev 与执行模型分别调用，分别计量。API 失败明确报告，不切换 GLM 或付费 Jev。

## 关闭

删除 `magpie-auto` 插件条目并重新启用 `compaction-basic`，恢复原生 dsh 行为。只关闭 Jev、保留任务子代理上限时，可以把 `mode` 改为 `native`，同时把 `compaction-basic.disabled` 改为 `false`。

`mode: single` 禁止原生子代理调用，供单代理对照实验使用。单代理模式同样需要启用原生 `compaction-basic`。

## 验证

真实小任务已验证工具执行、文件修改和单元测试。Auto 路径使用过两个原生调查子代理并收回结果。SWE-bench Verified 的三组结果由 [magpie-auto](https://github.com/ZhiweiWei-NAMI/magpie-auto/tree/feature/auto-workspace/experiments/jev-cache-20261012) 保存；结果完成后再据实判断收益。
