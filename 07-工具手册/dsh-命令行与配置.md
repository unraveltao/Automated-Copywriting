# dsh 命令行与配置

> 上一份 `dsh-命令面板.md` 讲的是**界面里**那 8 个条目。
> 这一份讲**界面外面**：怎么换形态启动、怎么装插件、怎么临时改配置、配置到底存在哪。
>
> 版本：`dsh 0.2.1-rc.2`（`dsh --version` 查看）

---

## 一、先理解一件事：dsh 不是"一个程序"

它是个**启动器**。真正干活的是「profile」——一个**按顺序叠起来的插件栈**，每一层是一份 YAML 补丁。

```
dsh --profile web        # 启动 web 这个插件栈
dsh --profile desktop    # 启动 desktop 这个插件栈
```

所以 dsh 的命令几乎都围绕一件事：**这份栈怎么组装、怎么改、怎么看**。

理解了这个，下面所有命令就都通了。

---

## 二、三种启动形态

| 形态 | 命令 | 说明 |
|---|---|---|
| 桌面应用 | 从 Electron 图标启动 | `desktop` 这个 profile **只能由 Electron 管**，命令行启不了 |
| 浏览器 | `dsh --profile web` | 起一个本地 HTTP 服务，用浏览器打开 |
| 自定义 | `dsh --profile <名字>` | `$DSH_HOME/profiles` 下任意一个目录 |

> 注意：`dsh desktop --help` 会直接报错 `profile "desktop" is managed exclusively by the Electron application`。这不是坏了，是设计如此。

### 浏览器形态的实用参数

```bash
dsh --profile web                        # 默认端口，自动开浏览器
dsh --profile web --port 8080 --no-open  # 指定端口，不自动开
dsh --profile web --host 192.168.1.7     # 绑到某个内网地址
```

几个容易踩的点：

- `--host` **只收具体的 IPv4/IPv6 地址**，`0.0.0.0` 这种通配地址会被拒绝。想给局域网用，就写本机那张网卡的真实 IP。
- `--public-url` 只影响"对外宣传的地址"，**不授予任何信任**。要让它接受某个域名，得另外加 `--trusted-host`。
- 想走 HTTPS 又不想自己搞证书链，就配 `--tls-cert` + `--tls-key`（两个必须同时给）。

```bash
# 放在 Nginx/Caddy 后面，路径前缀会被剥掉的情况
dsh --profile web --public-url https://app.example/ui/ --trusted-host app.example
```

---

## 三、装插件（扩展能力）

```bash
dsh plugin --profile web add <包名>      # 装
dsh plugin --profile web remove <包名>   # 卸
dsh plugin --profile web why <包名>      # 看谁依赖它
```

它其实只是把参数**原样转发给 pnpm**，在 profile 目录里执行。所以 pnpm 的用法都成立，`add` / `remove` / `why` / `list` 随便用。

装完不生效？检查两件事：一是装到了哪个 profile（`--profile` 别写错），二是这份栈里那一层有没有被 `disabled` 掉。

---

## 四、临时改配置：--patch

不想动 profile 本体，只想这一次多一层配置：

```bash
dsh --profile web --patch ./extra.yml
dsh --profile web --patch ./a.yml --patch ./b.yml   # 可以叠多层，按给的顺序
```

`--patch` 的层**加在 profile 之后**，所以它的优先级更高——想临时覆盖某个插件的参数，这是最轻的做法，退出就没了。

---

## 五、看配置：三个 dump

配置是"多层叠加"出来的，出问题时最难的是**不知道最终合成结果长什么样**。三个命令分别回答三个问题：

| 命令 | 回答什么问题 |
|---|---|
| `dsh --profile web --dump-config` | 最终合成出来是什么（含你的改动和 `--patch`） |
| `dsh --profile web --dump-default-config` | 官方默认是什么（不含你的改动） |
| `dsh --profile web --dump-config-schema` | 每一层允许写什么（JSON Schema，不启动） |

用法很直接：**把两个 dump 一 diff，就知道你改动了哪几行。**

```bash
dsh --profile web --dump-config > /tmp/now.yml
dsh --profile web --dump-default-config > /tmp/default.yml
diff /tmp/default.yml /tmp/now.yml
```

输出是 YAML，每个条目有 `id`、`name`（插件包名）、`disabled`、`config`。看到 `disabled: !!js '...'` 别慌，那是条件表达式，运行时才求值。

---

## 六、profile 坏了怎么办：从模板重建

```bash
dsh --profile web --from-default-profile web
```

用官方模板**覆盖**一个自定义 profile，再启动。适合两种情况：配置改崩了、插件装冲突了。

⚠️ 这是覆盖操作，profile 目录里的本地改动会没。真要用，先把 `$DSH_HOME/profiles/web` 备份一份。

---

## 七、东西都存在哪

`$DSH_HOME` 默认是 `~/.dsh`（没设置环境变量的话）：

```
~/.dsh/
├── profiles/        插件栈本体（desktop、web 各一个目录）
│   └── web/
│       ├── cordis.yml          栈的主配置
│       ├── cordis.patch.yml    补丁层
│       └── package.json        插件依赖
├── sessions/        会话历史，按工作区分目录
├── skills/          技能
├── storages/        存储
└── channel-pack/    渠道包
```

**sessions 按工作区分目录**，目录名是工作区路径的编码。比如：

```
--D-Documents-~5FAE~4FE1~516C~4F17~53F7~6587~6848--
   ↑ 就是 D:\Documents\微信公众号文案
```

这解释了一个常被忽略的行为：**在哪个目录启动，就继承哪个目录的历史**。同一个项目换台机器、或者换个目录打开，历史是断的——不是丢了，是在另一个文件夹里。

想备份或迁移，拷 `~/.dsh/sessions/` 下对应的那个目录就行。

---

## 八、一页速查

```bash
dsh --version                                  # 版本
dsh --help                                     # 顶层帮助
dsh --profile web --help                       # 某个 profile 自己的参数

dsh --profile web                              # 浏览器形态
dsh --profile web --port 8080 --no-open        # 指定端口
dsh --profile web --host 192.168.1.7           # 绑内网地址

dsh plugin --profile web add <包>              # 装插件（转发给 pnpm）
dsh --profile web --patch ./extra.yml          # 临时叠一层配置

dsh --profile web --dump-config                # 看最终合成
dsh --profile web --dump-default-config        # 看官方默认
dsh --profile web --dump-config-schema         # 看可写字段

dsh --profile web --from-default-profile web   # 用模板重建（覆盖！）
```

---

## 九、三条经验

1. **报错 `profile "xxx" does not exist` 时，先 `ls ~/.dsh/profiles`。** 很多示例命令里的 `tui`、`headless`、`rescue` 是官方模板名，本地没实例化就是不存在，不是安装坏了。
2. **`desktop` 不要试图从命令行启动。** 它是 Electron 独占的，报错是预期行为。
3. **改配置前先 dump 一份。** 多层叠加的东西，改坏了很难凭记忆倒推回原样；一份 dump 比十次排查管用。
