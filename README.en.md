# dsh-auto (standalone)

Auto decision plugin for dsh. With your own API key set it calls `jev-1.13-free` directly for structured decisions; the plugin implements those decisions through native dsh sessions, tools and subagents. The main agent and children use the configured execution model. The plugin contains no agent execution runtime and no external gateway. See [README.md](README.md) for the full Chinese documentation.

Requires dsh `0.1.5-rc.1` or `0.2.x` (verified on `0.2.0-rc.2`).

## Install

The plugin talks to Jev directly: with `apiKey` set it uses the direct Jev endpoint, and with no `apiKey` it runs in native mode.

```bash
# Create a profile, then install from GitHub or npm
dsh --profile auto --from-default-profile headless --dump-config >/dev/null
dsh plugin --profile auto add github:ZhiweiWei-NAMI/dsh-auto#v0.5.0
# or the npm package
dsh plugin --profile auto add dsh-auto
```

Give `dsh-auto` a minimal config in the profile's own `cordis.patch.yml`. Get `apiKey` from the workspace API Keys page at <https://opencode.ai>:

```yaml
- id: dsh-auto
  config:
    apiKey: <your opencode workspace key>
    routes:
      - id: general
        label: General implementation
        model: deepseek-v4.1-flash
        description: Implement and modify code
        efforts: [high]
      - id: review
        label: Independent review
        model: deepseek-v4.1-flash
        description: Review implementation and test evidence
        efforts: [high]
```

`routes` lists the allowed roles, models and efforts; the execution model connection still comes from `settings.yaml`. When `routes` is empty the plugin uses the session's current native model as the single default route. Without `strategy` the plugin uses mode `automatic` with default weights `{quality: 0.8, latency: 0.5, usage: 0.5, cache: 0.8}`; `mode: single` / `native` fix single-agent and native compaction respectively. `apiKey` is declared as a secret and is not written to logs or record files.

With no `apiKey` the plugin calls no network service: the session runs in native mode (same path as `strategy.mode: native`) and records one `policy_snapshot` with `reason: 'no-api-key'`. It does not throw.

## Upgrading from 0.4.x

Rename `magpie-auto` to `dsh-auto` in your profile overrides; the `endpoint` field is gone and should be removed.
