# Tasks

- [x] 1.1 移植 zcode 源脚本（.sh.ts/Bun，语义与 shufa 版逐条对齐：templateId
      品牌名/协议映射/规则引擎有序叠加/models 清单求值/logo slug 表）+
      生成 src/daemon/zcode-presets.ts（含 revision/模板数/模型数头注释）
- [x] 1.2 model-catalog.ts 数据源重写（zcodePresets → 目录投影；KNOWN 置顶
      重排为 zcode templateId 口径；icon 先本仓 PROVIDER_ICONS 后回退）+
      测试更新（test/model-catalog*.test.ts 适配新源；断言生成物与投影一致性）
- [x] 1.3 Settings 页面化：App 注册 + /settings 路由 + 四分区平移 +
      左导航底部入口改导航 + SettingsDialog 删除 + settingsUi store 收敛 + route-match/组件测试更新
- [ ] 1.4 门禁（含 webui check + 全量）+ dev 走查（探针 + vision：桌面/窄屏）+ codex 复核 + 归档
