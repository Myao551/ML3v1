# 三打一 - 在线扑克游戏

一个基于 Web 的四人实时扑克游戏。后端使用 Node.js、Express 和 Socket.IO，前端使用原生 HTML/CSS/JavaScript。

## 项目状态

当前版本重点实现了三打一的核心流程：

- 独立的注册、登录、大厅界面，账号和登录会话持久化保存
- 大厅房间列表、房间号/房主搜索、可加入筛选、分页、返回当前牌局
- 创建房间、加入房间、四人准备
- 快速入座：优先恢复自己的牌局，否则优先进入人数较多的未满等待房间
- 退出房间：等待时立即释放座位；对局中由系统托管至结算后释放座位，可立即加入其他房间
- 发牌、叫分、确定庄家
- 庄家拿底牌、埋底
- 选择主花色或无主
- 出牌、跟牌、轮次胜负判断
- 出牌提示：按当前跟牌义务选择合法牌，需玩家确认后出牌；不是胜率最优策略
- 闲家计分、扣底、结算
- Socket.IO 实时同步房间状态

> 账号与房间使用不同存储：线上账号和登录会话保存在 PostgreSQL，应用重启不丢失；房间、手牌、聊天和局内积分仍在服务端内存中，服务重启、Render 休眠或重新部署会结束当前房间。

## 规则概要

- 使用两副扑克牌，共 108 张。
- 四名玩家参与，每人 25 张，底牌 8 张。
- 一名玩家为庄家，其余三名玩家为闲家。
- 叫分范围为 100 到 75，步长为 5，叫分越低表示庄家承诺越高。
- 闲家得分达到或超过庄家叫分时，闲家胜利。
- 王、2、7 为常主。
- 庄家可以选择主花色，也可以选择无主。
- 出牌阶段必须跟首家有效花色；没有该花色时可以垫牌或用主牌杀。
- 对子、拖拉机等牌型需要按规则跟出。
- 最后一轮闲家用主牌获胜时可以扣底，底牌分按牌型倍数加入闲家得分。

完整规则请参考 `三打一.md`，该文件为当前实现的有效规则。

2026-09-17 修订：暂时禁用甩牌；无主的 2、7、小王、大王为连续等级，同级异花色常主等大；服务端统一计时，超时自动操作，断线托管。刷新页面可恢复当前手牌、出牌轮次和提前结束投票。

## 本地运行

需要 Node.js 24。先安装依赖：

```bash
npm ci
```

启动服务：

```bash
npm start
```

开发模式：

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

本地默认数据库为 `data/accounts.sqlite`，首次启动自动建表，正常重启仍可用原账号登录；`data/` 不提交到 Git。可参照 `.env.example` 设置 `.env`，启动命令会自动读取。SQLite 仅供本机开发，不能解决 Render 免费服务的临时磁盘问题。

## 账号存储与安全

- 注册需要账号、昵称和至少 8 位密码。账号不区分大小写；账号和昵称均不可重复。
- 密码仅保存随机盐的 scrypt 哈希。登录凭证为随机 token，数据库只存 token 哈希和有效期。
- 登录有效期 7 天；Cookie 为 HttpOnly、SameSite=Lax，生产环境额外启用 Secure。注销同时撤销数据库会话并断开对应游戏连接。
- 房间身份由服务器登录态确定，客户端昵称或 `sessionId` 不能冒用账号。同一账号不能同时占用两个未退出的房间。
- 暂不提供找回密码、修改昵称或账号删除；不要将此版本用作需要完整账号管理的公开商业服务。
- 旧版游客昵称和旧 JSON 账号文件不会自动迁移；本版本需重新注册。部署时已有内存房间会结束。

## 部署到 Render

本项目适合部署为 Render 的 **Web Service**。不要部署成 Static Site，因为游戏需要 Node.js 服务端和 WebSocket 长连接。

推荐配置：

```text
Runtime: Node
Build Command: npm ci
Start Command: npm start
Plan: Free 或更高
Node Version: 24
```

### 必须配置独立 PostgreSQL

在部署此版本前，在 Render 服务的 Environment 中设置：

| 变量 | 值 |
| --- | --- |
| `NODE_VERSION` | `24`（已有服务也需检查，不仅是新建 Blueprint） |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL 服务提供的完整连接串，作为秘密保存，不要写进代码或聊天 |
| `PUBLIC_ORIGIN` | 游戏实际 HTTPS 域名，例如 `https://your-game.onrender.com`，末尾不带 `/` |

数据库可以托管在 Render 或其他 PostgreSQL 服务（如 Neon、Supabase）；按供应商要求保留连接串中的 TLS 参数，不关闭证书校验。请核实套餐是否长期有效、是否有到期清理机制，并启用备份。**Web Service 免费并不代表数据库永久免费或永久保留数据。**

首次启动自动创建 `auth_users` 和 `auth_sessions` 表及索引；数据库用户需要建表和读写权限。生产模式缺少数据库或域名配置会拒绝启动，不会退回临时文件“假持久化”。`render.yaml` 不会创建收费数据库，配置值需在控制台填写。

部署后验收：注册一个测试账号，退出后重新登录；重新部署 Web Service，再次用同一账号登录；旧房间消失属于当前设计，账号不应丢失。备份和恢复应使用 PostgreSQL 服务商的备份功能或 `pg_dump` / `pg_restore`，不要把备份提交到 Git。

Render 会自动提供 `PORT` 环境变量，`server.js` 已经通过下面的方式读取端口：

```js
const PORT = process.env.PORT || 3000;
```

因此通常不需要在 Render 后台手动设置 `PORT`。

### Render 部署步骤

1. 已有自动部署服务应先配置上述数据库和环境变量，再推送新版本；新建服务则在首次部署前填好这些变量。
2. 登录 [Render](https://render.com)。
3. 点击 **New +**，选择 **Web Service**。
4. 连接 GitHub 仓库。
5. 设置服务：
   - Name: `sanda1-poker-game`
   - Runtime: `Node`
   - Build Command: `npm ci`
   - Start Command: `npm start`
6. 创建服务，等待构建完成。
7. 打开 Render 分配的域名测试游戏。

### Render 注意事项

- 免费实例一段时间无人访问后会休眠，首次访问会有冷启动延迟。
- 房间状态保存在内存中，实例休眠、重启或重新部署会清空当前房间。
- 当前实现适合单实例运行。如果以后要水平扩容，需要把房间状态迁移到 Redis 或数据库，并配置 Socket.IO adapter。
- 部署前必须确认本地修改已经 commit 并 push，否则 Render 从 GitHub 部署时不会包含本地未提交代码。

## 其他平台

### Railway / Fly.io

Railway 和 Fly.io 也支持长连接服务，可以直接部署本项目的 Node.js 服务端。


## 项目结构

```text
.
├── package.json
├── server.js
├── render.yaml
├── README.md
├── 三打一.md
└── public/
    ├── index.html
    ├── style.css
    └── game.js
```

## 技术栈

- 后端：Node.js、Express、Socket.IO
- 前端：HTML、CSS、JavaScript
- 实时通信：WebSocket / Socket.IO
- 部署推荐：Render Web Service

## 常见问题


### 为什么 Render 上游戏房间会消失？

当前房间数据存放在 Node.js 进程内存中。Render 免费实例休眠、服务重启或重新部署都会重置进程内存，因此房间会消失。

### 能否多人同时开多个房间？

可以。当前服务用房间 ID 区分不同对局。只要服务实例没有重启，不同房间可以同时存在。

## License

MIT

## 验证

```bash
npm test
npm run typecheck
```

测试覆盖账号校验、密码哈希、SQLite 重开及真实进程重启持久化、PostgreSQL 查询适配（pg-mem）、Cookie/来源校验/限流、注销与登录轮换撤销 WebSocket、大厅搜索分页、快速入座、出牌提示与过期响应，以及服务端牌面权威性、叫分、拖拉机、跟牌、断线重连、超时托管、结算竞态和客户端状态回归。pg-mem 不等同于真实线上 PostgreSQL，首次部署还需执行上述重启验收。`typecheck` 的范围以 `tsconfig.json` 为准，目前主要覆盖 `src` 模块。
