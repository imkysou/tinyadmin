# TinyAdmin.js

为 MinecraftServerListener 设计的一个标准权限节点管理系统。支持多组、多用户、优先级权限、权限继承等功能。

## 安装

*注意：TinyAdmin.js 不能在运行时加载，否则可能导致部分用户无法加入 default 组。*

1. 执行 `npm install sqlite3@6.0.1` 安装 SQLite3 模块；
2. 将此 `TinyAdmin.js`（支持 MC 1.20.5+）复制到 MSL 插件目录下；
3. 启动 MSL 加载插件，在 msl 目录下的 `tinyadmin` 找到 `config.tinyadmin.json` 文件，将其中的 `Steve` 更改为服主的用户名；
4. 服主进入游戏，即可使用 `!ta` 或 `/ta` 命令，若需授权其他玩家 `ta` 命令的使用权限，可以通过 `!ta user <玩家> permission ta.admin true` 指令授权（也可在 `config.tinyadmin.json` 文件的数组中添加用户）。

如果你使用的 Minecraft 版本低于 1.20.5，请使用**TinyAdmin_Legacy.js**的插件文件，以确保兼容性。

## 使用

### 基本概念

TinyAdmin 通过**权限节点**控制玩家行为。每个节点是一个字符串（例如 `ta.admin`、`myplugin.fly`），允许被赋予或撤销。权限来源有三种：

1. **直接用户权限** – 使用 `!ta user <玩家> permission <节点> true|false` 直接设置，**优先级最高**。
2. **组权限** – 玩家所在组被赋予的权限会继承给全体成员。
3. **管理员** – 配置文件 `admins` 列表中列出的玩家**强制拥有 `ta.admin` 节点**，不可撤销。

当同一节点在多个来源有定义时，按以下顺序决定最终权限（优先级从高到低）：

```
用户直接权限  >  最高优先级组  >  低优先级组
```

组的优先级由 `!ta user … setgroup <优先级> <组名>` 中的整数决定，**数字越大越优先**。

---

### 指令列表

所有指令以 `!` 为例（前缀可在配置中修改）。帮助菜单支持点击填入命令（适用于 1.20.5+ 的聊天栏）。

#### `!ta` – 查看帮助

显示全部可用指令的交互式列表。

#### 组管理

| 指令 | 说明 |
|------|------|
| `!ta creategroup <组名>` | 创建一个新组，组名大小写敏感。<br>示例：`!ta creategroup vip` |
| `!ta removegroup <组名>` | 删除一个组（`default` 不可删除）。组内成员若因此失去所有组，会被自动移回 `default`。<br>示例：`!ta removegroup vip` |
| `!ta group <组名> permission <节点> true\|false` | 为指定组设置/取消某个权限节点。<br>示例：`!ta group vip permission fly.use true` |
| `!ta listgroups` | 列出所有已创建的组名。悬停可显示成员数，点击组名可查看成员详情。 |
| `!ta listgroupmembers <组名>` | 显示该组所有玩家及其优先级，例如 `Steve(10), Alex(5)`。 |

#### 用户管理

| 指令 | 说明 |
|------|------|
| `!ta user <玩家> permission <节点> true\|false` | 直接赋予/撤销玩家某个权限，**覆盖任何组权限**。<br>示例：`!ta user Steve permission build.place false` |
| `!ta user <玩家> setgroup <优先级> <组名>` | 将玩家加入一个组，并设定该组的优先级。同一玩家可加入多个组，重复加入相同组会更新优先级。<br>示例：`!ta user Steve setgroup 10 vip` |
| `!ta removegroupmember <玩家> <组名>` | 将玩家从指定组移除。如果玩家因此不再属于任何组，则自动加入 `default` 组（优先级 0）。<br>示例：`!ta removegroupmember Steve vip` |
| `!ta whichgroup <玩家>` | 查看玩家当前所有组及其优先级，按优先级降序排列。<br>示例输出：`玩家 Steve 的组: vip(10), default(0)` |

---

### 默认组机制

- 任何**首次进入服务器**的玩家都会自动加入 `default` 组（优先级 0）。
- `default` 组初始无任何权限，管理员可通过 `!ta group default permission <节点> true` 为其分配全局基础权限。
- 当玩家被手动加入其他组后，`default` 组仍然保留；若高优先级组设置了相同的权限节点，低优先级的 `default` 设置会被**覆盖**。

---

### 实战示例：为 VIP 开启飞行

假设你有一个飞行插件使用权限节点 `essential.fly`。

**步骤 1：创建 VIP 组**

```
!ta creategroup vip
```

**步骤 2：为 VIP 组添加飞行权限**

```
!ta group vip permission essential.fly true
```

**步骤 3：将玩家 Steve 加入 VIP 组，优先级设为 10**

```
!ta user Steve setgroup 10 vip
```

此时 Steve 即可飞行。

**步骤 4（可选）：临时禁用 Steve 的飞行**

如果想临时禁用他的飞行（不改变组），可以直接覆盖：

```
!ta user Steve permission essential.fly false
```

该设置优先级高于任何组。

---

### 添加管理员

除了编辑 `config.tinyadmin.json` 的 `admins` 数组，你也可以用已有管理员的身份执行：

```
!ta user <新管理员> permission ta.admin true
```

保存后权限自动刷新，对方将永久拥有管理指令。配置文件中的人员**始终拥有 `ta.admin` 权限**，且无法被移除。

---

### 注意事项

- 数据库文件 `tinyadmin/tinyadmin.db` 自动生成，**不要手动修改**。
- 修改配置文件后，需重启 MSL 使变更生效。
- 命令前缀 `commandPrefix` 可设为任意字符（如 `/`），此时指令变为 `/ta`。
- 如果你使用的 Minecraft 版本低于 1.20.5，请使用**TinyAdmin_Legacy.js**的插件文件，以确保兼容性。
