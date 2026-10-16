# dsh-auto (standalone)

Standalone Jev usage for the `dsh-auto` plugin. See [README.md](README.md) for the full Chinese documentation.

## Standalone

The plugin can call Jev directly and no longer needs a local Magpie server: with `apiKey` set it uses the direct Jev endpoint, and only with `endpoint` set does it fall back to Magpie. Magpie is optional.

```bash
# Create a profile, then install from GitHub or npm
dsh --profile auto --from-default-profile headless --dump-config >/dev/null
dsh plugin --profile auto add github:ZhiweiWei-NAMI/dsh-auto#v0.4.0
# or the npm package
dsh plugin --profile auto add dsh-auto
```

Give `magpie-auto` a minimal config in the profile's own `cordis.patch.yml`. Get `apiKey` from the workspace API Keys page at <https://opencode.ai>:

```yaml
- id: magpie-auto
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

`routes` lists the allowed roles, models and efforts; the execution model connection still comes from `settings.yaml`. Without `strategy` the plugin uses mode `automatic` with default weights `{quality: 0.8, latency: 0.5, usage: 0.5, cache: 0.8}`; `mode: single` / `native` fix single-agent and native compaction respectively. `apiKey` is declared as a secret and is not written to logs or record files.
