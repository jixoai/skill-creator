# Tasks

- [x] 1.1 移植 zcode 源脚本（.sh.ts/Bun，语义与 shufa 版逐条对齐：templateId
      品牌名/协议映射/规则引擎有序叠加/models 清单求值/logo slug 表）+
      生成 src/daemon/zcode-presets.ts（含 revision/模板数/模型数头注释）
- [x] 1.2 model-catalog.ts 数据源重写（zcodePresets → 目录投影；KNOWN 置顶
      重排为 zcode templateId 口径；icon 先本仓 PROVIDER_ICONS 后回退）+
      测试更新（test/model-catalog*.test.ts 适配新源；断言生成物与投影一致性）
- [x] 1.3 Settings 页面化：App 注册 + /settings 路由 + 四分区平移 +
      左导航底部入口改导航 + SettingsDialog 删除 + settingsUi store 收敛 + route-match/组件测试更新
- [x] 1.4 门禁（含 webui check + 全量）+ dev 走查（探针 + vision：桌面/窄屏）+ codex 复核 + 归档
      （走查 r1：双阻塞（窄屏 nav 未折叠/Save 禁用态 2.02:1）+ 双齿轮 → 三修复
      46c5625；vision 复判 r2：A/B/D PASS、C 残差（chip 行横滚 thumb）→
      no-scrollbar + 渐隐 mask 处置，像素带扫描零命中；codex 复核
      r1 8.5 → pi-ai 清退 + logo 裁决沉淀 baa11ab → r2 8.6 → iconUrl
      slug 第一候选 + 20/20 dataURL 6bf400b → r3 **9.5 ARCHIVE-READY**
      （全量 1389 绿）——证据 /tmp/settings-walkthrough-r2/、
      /tmp/settings-review-r{1,2,3}.md；本项随归档提交勾选）
