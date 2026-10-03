# human-terminal Specification

## Purpose
TBD - created by archiving change skills-agent-page. Update Purpose after archive.

## Requirements

### Requirement: 人类终端是专用 websocket 上的 daemon-owned PTY

daemon MUST 持有全部人类终端进程（node-pty）并在专用 `/ws/terminal`
WebSocket 端点上服务（沿用 web token 鉴权；oRPC `/ws/rpc` 通道 MUST NOT
承载终端流）。端点 MUST 使用单一 typed JSON 消息协议，按 sessionId 多路
复用全部终端会话：create/write/resize/exit/list 控制消息与
output/buffer/exit 通知同协议；每个入站帧 MUST 经 schema 校验后才分发，
非法帧返回 typed error 且不终止终端。终端输出 MUST 经有界 batcher 泵送，
繁忙终端 MUST NOT 饿死 daemon 事件循环。

#### Scenario: token 门禁

- **WHEN** 客户端未携带 web token 连接 `/ws/terminal`
- **THEN** upgrade 以 401 拒绝

#### Scenario: 非法帧不杀终端

- **WHEN** 某入站帧未通过 schema 校验
- **THEN** 该会话收到 typed error 回执，终端继续运行

#### Scenario: 洪泛输出保持公平

- **WHEN** 终端持续高速输出
- **THEN** batcher 有界投递，无关 RPC 流量持续被服务

### Requirement: 终端生命周期有界

daemon MUST 将并发活 PTY 上限设为 4（超限 create typed 拒绝）；scrollback
缓冲 MUST 为 10000 行环形（行数与字节双上限裁剪），重连 replay 有界。每个
PTY MUST 在 daemon stop coordinator 的有界窗口内回收（渐进信号后强制），
并在无 WS 附着且无输入 idle 30 分钟后自动 exit 回收；任何路径 MUST NOT
遗留孤儿终端进程。

#### Scenario: 第五个终端被拒

- **WHEN** 已有 4 个活终端且第 5 个 create 到达
- **THEN** create typed 拒绝，既有 4 个不受影响

#### Scenario: stop 全量回收

- **WHEN** daemon stop coordinator 执行
- **THEN** 全部 PTY 在有界窗口内终止，无存活进程

#### Scenario: idle 超时回收

- **WHEN** 终端无附着 socket 且无输入达 30 分钟
- **THEN** 终端 exit 并从注册表移除

### Requirement: 终端权限如实声明（非 sandbox）

产品 MUST 如实声明：人类终端不是 sandbox——PTY 以 daemon 用户本地权限全权
运行，cwd 限定只是默认启动目录。终端 MUST NOT 接入 agent 工具面（内核工具
收窄保持 agent 会话不可触达终端），技能 mutation 链 MUST NOT 与终端耦合。
终端首开 MUST 展示非 sandbox 权限提示。

#### Scenario: 首开提示

- **WHEN** 用户首次打开终端
- **THEN** 产品展示「以本地用户权限运行、非 sandbox」提示

#### Scenario: agent 触达不了终端

- **WHEN** agent 会话枚举其工具面
- **THEN** 不存在任何终端工具

#### Scenario: write 重试去重不重复注入

- **WHEN** 客户端重发 reqId 已 ≤ server 高水位的 write（网络重试）
- **THEN** server 回执 duplicate 且不向 PTY 注入该输入；PTY stdin 收到的
  键序与首次发送一致

#### Scenario: 输出序号缺口触发有界重放

- **WHEN** 客户端检测到 output 帧 seq 缺口并发起 buffer 请求
- **THEN** 服务端从环形缓冲回放缺口区间；缓冲已裁剪的区间回执 gap 消息，
  客户端清屏重拉，连接不中断
