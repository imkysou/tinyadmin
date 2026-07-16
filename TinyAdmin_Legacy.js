const fs = plugin_require('fs');
const path = plugin_require('path');
const sqlite3 = plugin_require('sqlite3').verbose();

const DATA_DIR = path.join(process.cwd(), 'tinyadmin');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.tinyadmin.json');
const DB_FILE = path.join(DATA_DIR, 'tinyadmin.db');

let config = {
    admins: ['Steve'],
    commandPrefix: '/'
};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
            const userConfig = JSON.parse(raw);
            config.admins = userConfig.admins || config.admins;
            config.commandPrefix = userConfig.commandPrefix || config.commandPrefix;
        } else {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
        }
        plugin_log('INFO', '配置已加载，管理员：' + config.admins.join(', ') + '，指令前缀：' + config.commandPrefix);
    } catch (e) {
        plugin_log('ERROR', '配置文件加载失败：' + e.message);
    }
}

let db;
function initDatabase() {
    db = new sqlite3.Database(DB_FILE);
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS groups (
            name TEXT PRIMARY KEY,
            permissions TEXT DEFAULT '{}'
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS user_permissions (
            user_name TEXT NOT NULL,
            permission_node TEXT NOT NULL,
            value INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (user_name, permission_node)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS user_groups (
            user_name TEXT NOT NULL,
            group_name TEXT NOT NULL,
            PRIMARY KEY (user_name, group_name)
        )`);
        db.run(`ALTER TABLE user_groups ADD COLUMN priority INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                plugin_log('ERROR', '添加 priority 列失败: ' + err.message);
            }
        });
        db.run('INSERT OR IGNORE INTO groups (name, permissions) VALUES (?, ?)', ['default', '{}']);
    });
    plugin_log('INFO', '数据库已初始化（多组支持已启用）');
}

function hasPermission(player, node) {
    const list = plugin_pull('permission:' + node) || [];
    return list.includes(player);
}

function tellraw(player, text, color) {
    const json = JSON.stringify({ text: text, color: color || 'white' });
    plugin_executeCommand(`tellraw ${player} ${json}`);
}

function tellSuccess(player, msg) {
    tellraw(player, '✔ [TinyAdmin] ' + msg, 'green');
}

function tellError(player, msg) {
    tellraw(player, '✘ [TinyAdmin] ' + msg, 'red');
}

function tellInfo(player, msg) {
    tellraw(player, 'ℹ [TinyAdmin] ' + msg, 'yellow');
}

function tellWarn(player, msg) {
    tellraw(player, '⚠ [TinyAdmin] ' + msg, 'gold');
}

function reloadGlobalPermissions() {
    let allNodes = new Set();
    db.all('SELECT DISTINCT permission_node FROM user_permissions', (err, userRows) => {
        if (!err) userRows.forEach(r => allNodes.add(r.permission_node));
        db.all('SELECT permissions FROM groups', (err, groupRows) => {
            if (!err) {
                groupRows.forEach(row => {
                    try {
                        const perms = JSON.parse(row.permissions);
                        Object.keys(perms).forEach(n => allNodes.add(n));
                    } catch (e) {}
                });
            }
            allNodes.add('ta.admin');
            const nodesArray = Array.from(allNodes);
            if (nodesArray.length === 0) {
                ensureAdminNode();
                return;
            }
            let remaining = nodesArray.length;
            nodesArray.forEach(node => {
                computePermissionNode(node, () => {
                    remaining--;
                    if (remaining === 0) plugin_log('INFO', '所有权限节点刷新完毕');
                });
            });
        });
    });
}

function computePermissionNode(node, callback) {
    const playersPermissions = new Map();
    db.all('SELECT user_name, value FROM user_permissions WHERE permission_node = ?', [node], (err, userPerms) => {
        if (!err) {
            userPerms.forEach(row => {
                playersPermissions.set(row.user_name, { value: row.value === 1, source: 'user' });
            });
        }
        db.all('SELECT name, permissions FROM groups', (err, groups) => {
            if (err) { finalize(); return; }
            const groupPerms = {};
            const groupsWithNode = [];
            groups.forEach(g => {
                let perms = {};
                try { perms = JSON.parse(g.permissions); } catch (e) {}
                if (node in perms) {
                    groupPerms[g.name] = perms[node];
                    groupsWithNode.push(g.name);
                }
            });
            if (groupsWithNode.length === 0) { finalize(); return; }
            const placeholders = groupsWithNode.map(() => '?').join(',');
            db.all(`SELECT user_name, group_name, priority FROM user_groups WHERE group_name IN (${placeholders}) ORDER BY user_name, priority DESC`,
                groupsWithNode,
                (err, memberRows) => {
                    if (err) { finalize(); return; }
                    let currentUser = null;
                    let bestPriority = -Infinity;
                    let bestValue = false;
                    memberRows.forEach(row => {
                        if (row.user_name !== currentUser) {
                            if (currentUser && bestPriority > -Infinity) {
                                if (!playersPermissions.has(currentUser)) {
                                    playersPermissions.set(currentUser, { value: bestValue, source: 'group' });
                                }
                            }
                            currentUser = row.user_name;
                            bestPriority = row.priority;
                            bestValue = groupPerms[row.group_name];
                        }
                    });
                    if (currentUser && bestPriority > -Infinity) {
                        if (!playersPermissions.has(currentUser)) {
                            playersPermissions.set(currentUser, { value: bestValue, source: 'group' });
                        }
                    }
                    finalize();
                }
            );
            function finalize() {
                if (node === 'ta.admin') {
                    config.admins.forEach(admin => playersPermissions.set(admin, { value: true, source: 'admin' }));
                }
                const allowedPlayers = [];
                playersPermissions.forEach((perm, player) => {
                    if (perm.value === true) allowedPlayers.push(player);
                });
                plugin_push('permission:' + node, allowedPlayers);
                callback();
            }
        });
    });
}

function ensureAdminNode() {
    plugin_push('permission:ta.admin', config.admins || []);
}

function requireAdmin(player) {
    if (!hasPermission(player, 'ta.admin')) {
        tellError(player, '你没有权限使用该指令');
        return false;
    }
    return true;
}

plugin_onEvent('playerJoin', (time, player) => {
    db.get('SELECT user_name FROM user_groups WHERE user_name = ?', [player], (err, row) => {
        if (!err && !row) {
            db.run('INSERT INTO user_groups (user_name, group_name, priority) VALUES (?, ?, ?)', [player, 'default', 0], (err) => {
                if (!err) {
                    plugin_log('INFO', `${player} 被自动加入 default 组`);
                    reloadGlobalPermissions();
                }
            });
        }
    });
});

function registerCommands() {
    const PREFIX = config.commandPrefix;

    plugin_registerCommand(PREFIX + 'ta', (player) => {
        if (!requireAdmin(player)) return;
        tellraw(player, '======== TinyAdmin 帮助 ========', 'gold');
        tellraw(player, PREFIX + 'ta creategroup <name> - 创建组', 'yellow');
        tellraw(player, PREFIX + 'ta removegroup <group> - 删除组', 'yellow');
        tellraw(player, PREFIX + 'ta group <组名> permission <节点> true|false - 设置组权限', 'yellow');
        tellraw(player, PREFIX + 'ta user <玩家> permission <节点> true|false - 设置用户权限', 'yellow');
        tellraw(player, PREFIX + 'ta user <玩家> setgroup <优先级> <组名> - 将玩家加入组', 'yellow');
        tellraw(player, PREFIX + 'ta removegroupmember <user> <group> - 从组移除玩家', 'yellow');
        tellraw(player, PREFIX + 'ta listgroups - 列出所有组', 'yellow');
        tellraw(player, PREFIX + 'ta listgroupmembers <group> - 列出组成员及优先级', 'yellow');
        tellraw(player, PREFIX + 'ta whichgroup <user> - 查询玩家所在组', 'yellow');
        tellraw(player, '===============================', 'gold');
    });

    plugin_registerCommand(PREFIX + 'ta creategroup <name>', (player, name) => {
        if (!requireAdmin(player)) return;
        db.get('SELECT name FROM groups WHERE name = ?', [name], (err, row) => {
            if (row) {
                tellError(player, `组 ${name} 已存在，无法创建`);
                return;
            }
            db.run('INSERT INTO groups (name) VALUES (?)', [name], (err) => {
                if (err) {
                    tellError(player, `创建组失败: ${err.message}`);
                    return;
                }
                tellSuccess(player, `组 ${name} 创建成功`);
            });
        });
    });

    plugin_registerCommand(PREFIX + 'ta removegroup <group>', (player, group) => {
        if (!requireAdmin(player)) return;
        if (group === 'default') {
            tellError(player, '不能删除默认组 default');
            return;
        }
        db.get('SELECT name FROM groups WHERE name = ?', [group], (err, row) => {
            if (!row) {
                tellError(player, `组 ${group} 不存在`);
                return;
            }
            db.run('DELETE FROM groups WHERE name = ?', [group], (err) => {
                if (err) {
                    tellError(player, `删除组失败: ${err.message}`);
                    return;
                }
                db.run('DELETE FROM user_groups WHERE group_name = ?', [group], (err) => {
                    if (err) plugin_log('ERROR', `清理组成员失败: ${err.message}`);
                    tellSuccess(player, `组 ${group} 已删除，成员若空组将自动归入 default`);
                    reloadGlobalPermissions();
                });
            });
        });
    });

    plugin_registerCommand(PREFIX + 'ta group <groupName> permission <permission> <value>', (player, groupName, permission, value) => {
        if (!requireAdmin(player)) return;
        const boolValue = value.toLowerCase() === 'true';
        db.get('SELECT permissions FROM groups WHERE name = ?', [groupName], (err, row) => {
            if (err || !row) {
                tellError(player, `组 ${groupName} 不存在`);
                return;
            }
            let perms = {};
            try { perms = JSON.parse(row.permissions); } catch (e) {}
            perms[permission] = boolValue;
            db.run('UPDATE groups SET permissions = ? WHERE name = ?', [JSON.stringify(perms), groupName], (err) => {
                if (err) {
                    tellError(player, `更新组权限失败: ${err.message}`);
                    return;
                }
                tellSuccess(player, `已为组 ${groupName} 设置权限 ${permission}: ${boolValue}`);
                reloadGlobalPermissions();
            });
        });
    });

    plugin_registerCommand(PREFIX + 'ta user <userName> permission <permission> <value>', (player, userName, permission, value) => {
        if (!requireAdmin(player)) return;
        const boolValue = value.toLowerCase() === 'true';
        db.run('INSERT OR REPLACE INTO user_permissions (user_name, permission_node, value) VALUES (?, ?, ?)', [userName, permission, boolValue ? 1 : 0], (err) => {
            if (err) {
                tellError(player, `设置用户权限失败: ${err.message}`);
                return;
            }
            tellSuccess(player, `已为用户 ${userName} 设置权限 ${permission}: ${boolValue}`);
            reloadGlobalPermissions();
        });
    });

    plugin_registerCommand(PREFIX + 'ta user <userName> setgroup <priority> <groupName>', (player, userName, priorityStr, groupName) => {
        if (!requireAdmin(player)) return;
        const priority = parseInt(priorityStr, 10);
        if (isNaN(priority)) {
            tellError(player, '优先级必须为整数');
            return;
        }
        db.get('SELECT name FROM groups WHERE name = ?', [groupName], (err, row) => {
            if (!row) {
                tellError(player, `组 ${groupName} 不存在`);
                return;
            }
            db.run('INSERT OR REPLACE INTO user_groups (user_name, group_name, priority) VALUES (?, ?, ?)', [userName, groupName, priority], (err) => {
                if (err) {
                    tellError(player, `加入组失败: ${err.message}`);
                    return;
                }
                tellSuccess(player, `已将用户 ${userName} 加入组 ${groupName}（优先级 ${priority}）`);
                reloadGlobalPermissions();
            });
        });
    });

    plugin_registerCommand(PREFIX + 'ta removegroupmember <user> <group>', (player, user, group) => {
        if (!requireAdmin(player)) return;
        db.run('DELETE FROM user_groups WHERE user_name = ? AND group_name = ?', [user, group], function(err) {
            if (err) {
                tellError(player, `移除失败: ${err.message}`);
                return;
            }
            if (this.changes === 0) {
                tellError(player, `玩家 ${user} 不在组 ${group} 中`);
                return;
            }
            db.get('SELECT COUNT(*) as cnt FROM user_groups WHERE user_name = ?', [user], (err, row) => {
                if (err) {
                    tellInfo(player, `已将 ${user} 从组 ${group} 移除`);
                    reloadGlobalPermissions();
                    return;
                }
                if (row.cnt === 0) {
                    db.run('INSERT INTO user_groups (user_name, group_name, priority) VALUES (?, ?, ?)', [user, 'default', 0], (err) => {
                        if (err) plugin_log('ERROR', `自动加入 default 失败: ${err.message}`);
                        tellSuccess(player, `已将 ${user} 从组 ${group} 移除，并自动加入 default 组`);
                        reloadGlobalPermissions();
                    });
                } else {
                    tellSuccess(player, `已将 ${user} 从组 ${group} 移除`);
                    reloadGlobalPermissions();
                }
            });
        });
    });

    plugin_registerCommand(PREFIX + 'ta listgroups', (player) => {
        if (!requireAdmin(player)) return;
        db.all('SELECT name FROM groups', (err, rows) => {
            if (err) {
                tellError(player, `查询失败: ${err.message}`);
                return;
            }
            if (rows.length === 0) {
                tellInfo(player, '当前没有任何组');
                return;
            }
            const names = rows.map(r => r.name).join(', ');
            tellraw(player, '所有组: ' + names, 'gold');
        });
    });

    plugin_registerCommand(PREFIX + 'ta listgroupmembers <group>', (player, group) => {
        if (!requireAdmin(player)) return;
        db.all('SELECT user_name, priority FROM user_groups WHERE group_name = ? ORDER BY priority DESC', [group], (err, rows) => {
            if (err) {
                tellError(player, `查询失败: ${err.message}`);
                return;
            }
            if (rows.length === 0) {
                tellInfo(player, `组 ${group} 暂无成员`);
                return;
            }
            const members = rows.map(r => `${r.user_name}(${r.priority})`).join(', ');
            tellraw(player, `组 ${group} 成员: ${members}`, 'gold');
        });
    });

    plugin_registerCommand(PREFIX + 'ta whichgroup <user>', (player, user) => {
        if (!requireAdmin(player)) return;
        db.all('SELECT group_name, priority FROM user_groups WHERE user_name = ? ORDER BY priority DESC', [user], (err, rows) => {
            if (err) {
                tellError(player, `查询失败: ${err.message}`);
                return;
            }
            if (rows.length === 0) {
                tellInfo(player, `玩家 ${user} 当前无组记录（视为 default）`);
                return;
            }
            const groups = rows.map(r => `${r.group_name}(${r.priority})`).join(', ');
            tellraw(player, `玩家 ${user} 的组: ${groups}`, 'gold');
        });
    });
}

loadConfig();
initDatabase();
registerCommands();
setTimeout(() => reloadGlobalPermissions(), 1000);

plugin_log('INFO', 'TinyAdmin 插件已加载（多组优先级 + 老版 tellraw 格式）');