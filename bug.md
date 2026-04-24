# 三打一游戏 Bug 报告

整理范围：服务端（`server.js`）与客户端（`public/game.js`）中影响对局正确性或稳定性的问题，不包含甩牌规则。

---

## 一、中等（影响流程健壮性）

### BUG-02：`setDealer` 调用后未提前返回，多余的 `emitBidUpdate` 被执行

**位置：** `server.js` → `place-bid` 事件处理，pass 分支

**问题描述：**

当 pass 后只剩一位有效叫分者时，代码调用 `setDealer` 确定庄家，但随后没有 `return`，仍然继续执行 `emitBidUpdate(room)`：

```js
if (activeBidders.length === 1 && room.hasValidBid) {
  setDealer(room, activeBidders[0], room.currentBid);
  // 没有 return！
}
// ...
emitBidUpdate(room); // 此时 room.state 已是 'exchanging'
```

`setDealer` 内部已经向庄家发出了 `exchange-cards` 和 `bottom-to-dealer` 事件。紧接着执行的 `emitBidUpdate` 会再次向所有客户端广播一次带有 `state: 'exchanging'` 的 bid-update，可能引发客户端状态混乱（如闲家重新展示叫分面板或触发庄家二次逻辑）。

**修复建议：**

```js
if (activeBidders.length === 1 && room.hasValidBid) {
  setDealer(room, activeBidders[0], room.currentBid);
  return; // 加上 return，流程到此结束
}
```

同样地，叫分到 75 直接坐庄的分支也有相同问题：

```js
if (bid === 75) {
  setDealer(room, room.players.findIndex(p => p.id === currentPlayer.id), 75);
  // 同样缺少 return
}
```

两处均需加 `return`。

---

### BUG-03：客户端跟牌验证与服务端逻辑不同步

**位置：** `public/game.js` → `validatePlay()` 与 `server.js` → `validatePlay()`

**问题描述：**

客户端和服务端各自维护了一套出牌合法性验证逻辑。两者在细节上存在差异：

- 客户端 `analyzeClientPlay` 对拖拉机的识别条件与服务端 `analyzePlay` 的写法不同，在边界牌型（如 2 连对 vs 3 连对的判断）上可能产生不同结论
- 客户端的 `clientHasTractor` / `clientFollowSuitHasTractor` 与服务端的 `followSuitHasTractor` 参数接口不同，维护时容易遗漏同步

这会导致以下现象：
- 客户端放行了某次出牌（不弹提示），但服务端拒绝并发出 `invalid-play` 告警，玩家看到 alert 但不理解原因
- 或客户端误拦截了合法出牌，让玩家误以为规则不允许

**修复建议：**

两种方案选其一：

**方案 A（推荐）：** 将服务端验证函数抽成公共模块（如 `game-rules.js`），前后端共用同一份代码。

**方案 B：** 客户端仅做基础提示（张数是否正确、是否同花色），所有严格规则校验完全依赖服务端，服务端返回 `invalid-play` 时附带人类可读的具体原因字符串，客户端直接展示。

---

## 二、轻微（影响稳定性或可维护性）

### BUG-04：`elements.playBtn` 多次 `cloneNode` 可能残留事件监听

**位置：** `public/game.js` → `showExchangePanel()`、`nextGameBtn` 点击回调

**问题描述：**

代码通过 `cloneNode(true)` 替换出牌按钮来重置事件监听，这会在节点引用管理上引入不必要的复杂性。若 `showExchangePanel` 被意外多次调用（网络重传、状态回放等情况），或者下一局初始化时机不对，可能造成旧的 click 处理函数仍然有效，出现"点一次出牌触发两次请求"的问题。

```js
// 当前做法
const newPlayBtn = elements.playBtn.cloneNode(true);
elements.playBtn.parentNode.replaceChild(newPlayBtn, elements.playBtn);
elements.playBtn = newPlayBtn;
elements.playBtn.addEventListener('click', playCards);
```

**修复建议：**

使用具名函数配合 `removeEventListener` 代替 `cloneNode`：

```js
// 定义具名处理函数
function onPlayBtnClick() { playCards(); }
function onExchangeBtnClick() { /* 换底逻辑 */ }

// 切换时先移除旧的，再添加新的
elements.playBtn.removeEventListener('click', onPlayBtnClick);
elements.playBtn.removeEventListener('click', onExchangeBtnClick);
elements.playBtn.addEventListener('click', onPlayBtnClick); // 或 onExchangeBtnClick
```

---

## 优先级汇总

| 编号 | 标题 | 严重程度 | 影响 |
|------|------|----------|------|
| BUG-02 | `setDealer` 后缺少 return | 中等 | 叫分结束时多余事件广播，可能引发客户端状态混乱 |
| BUG-03 | 客户端/服务端验证逻辑不同步 | 中等 | 玩家出牌体验不一致，合法牌被误拦或非法牌被放行 |
| BUG-04 | `cloneNode` 替换按钮引起残留监听 | 轻微 | 特定时序下可能触发重复请求 |