# 饭价 · iPhone 本地比价验证原型

**原型已通过 iOS 编译并生成未签名 IPA。0.1.1 已完成金额、送达区间及缺少地址提示的真机读取验证；完整自动比价尚未实现。**

2026-10-23：[首次构建成功](https://github.com/Unphony/mealcompare-ios/actions/runs/39907207638)，对应代码提交 `8330a862`。22 项 Swift 断言和 13 项页面检查通过。下载该运行的 `MealCompare-unsigned` 产物后，按下文在 Windows 自签安装。

后续已在用户手机运行：两平台结算页能够读取合计和送达线索，人工核对个人优惠的链路已走通。本次样例不是同店同餐，淘宝闪购仍需确认收货地址，重开后登录保持尚未解决。见 [真机验证记录](docs/validation-2026-10-23.md)。

平台按“美团 + 淘宝闪购”命名。淘宝闪购优惠以独立 App（原饿了么）为核对标准；[阿里巴巴官网](https://www.alibabagroup.com/en-US/about-alibaba-businesses-1894256634985709568)仍链接 ele.me，因此保留已验证的网页入口和内部 eleme 数据键。

0.1.1 已通过[第二次 iOS 构建](https://github.com/Unphony/mealcompare-ios/actions/runs/39923382578)，对应提交 `a70b56f0`。22 项 Swift 断言和 18 项页面检查通过。此版本增加完整送达区间、缺少地址提示、导出前刷新，以及只统计数量的登录保持诊断。原始截图、地址、电话、Cookie 内容不进入公开源码或报告。

目标设备 iPhone 16 Pro，用户报告 iOS 27.0.1。日常完全由手机执行，所有新增费用为 0。工程最低 iOS 17，无第三方运行库或业务服务器。

## 已有和未完成

已有原生界面、分别存储会话的两平台网页、有限的自动搜索尝试、候选金额与送达线索检测、本地验证报告，以及预算/必含商品/凑单规则/帕累托筛选核心。

真实商品规格匹配、个人红包会员券选择、购物篮组合、完整自动查询尚未实现。筛选核心未接入真实报价，首页预算与凑单设置目前仅保存。勾选验证记录不会把候选金额认证为有效报价。

## 免费生成安装包

1. 准备 GitHub 仓库。公开源码须经你同意；公开的是工程代码，不包含账号数据。公开仓库的标准托管构建机器免费，私有仓库需核对包含额度并设置 **0 付费支出限制**。[官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
2. 当前源码位于 `codex/native-feasibility`，推送该分支自动触发构建；创建和合并 PR 都需用户分别确认。
3. 查看 **Actions → Build unsigned iPhone app**。工作流合入默认分支后，也可使用 **Run workflow** 手动运行。
4. 公开仓库保留 private_macos_budget_confirmed 为 false；私有仓库只有核对额度和支出限制后才勾选。额度耗尽即停止，不购买额外额度。
5. 流程使用标准 macos-26，检查脚本、执行 Swift 筛选测试并编译 App，不需要 Apple 凭证。
6. 全部成功后下载产物 **MealCompare-unsigned**，解压得到 **MealCompare-unsigned.ipa**。产物只保留一天；注意账号总存储用量。

源码 ZIP 不能直接安装。构建失败时需根据日志修复再运行，静态审查不能代替真实编译。

## Windows 自签与安装

当前真机成功路线为免费的 [iLoader 2.4.0](https://github.com/nab138/iloader/releases/tag/v2.4.0)：USB 连接设备并登录后选择 **Import IPA**，导入本项目未签名 IPA。更新保持同一账号和应用标识，覆盖安装，不先卸载。

下面保留最初的 Sideloadly 路线。该工具已在本次测试中遇到 `-80046`，不能将它描述为本设备已验证成功的安装方式。

1. 从 [Sideloadly 官网](https://sideloadly.io/)下载 Windows 版本，按官网安装 Apple 设备组件。
2. USB 连接并解锁 iPhone，完成“信任此电脑”。
3. 在 Sideloadly 选择设备、导入 IPA，使用自己的普通免费 Apple 账号签名。
4. 账号密码、验证码只在本机签名程序中输入，不发送给开发者、不放入 GitHub。
5. 按 iPhone 提示信任开发者；如要求，在“设置 → 隐私与安全性”开启开发者模式并按提示重启。

免费签名有效期 **7 天**，需要通过电脑续签。自动刷新也依赖电脑与连接条件，日常查询不依赖电脑。官网列出 iOS 27+ 支持，但本设备及 iOS 27.0.1 仍需实测。[官方说明](https://sideloadly.io/)

更新与续签保持相同账号和最终应用标识，优先覆盖安装，不要先卸载。工程标识 dev.local.mealcompare 可能由签名工具调整；数据保留情况仍需真机确认。

## 真机与本地检查

安装后按 [真机验证步骤](docs/device-validation.md)核对两平台的登录、结算、优惠一致性与独立运行。无需下单付款。

页面逻辑检查：运行 node Tests/ProbeChecks.cjs。目前 **18 项模拟页面检查通过**，包括本次金额、完整送达区间和缺少地址回归样例；完整自动比价仍需单独验收。

Swift 比较核心的 22 项断言已在 Mac 云构建中运行通过。本机 Windows 没有 Xcode；Mac 上也可执行：

```sh
swiftc MealCompare/ComparisonEngine.swift Tests/ComparisonEngineChecks.swift -o /tmp/mealcompare-checks
/tmp/mealcompare-checks
bash scripts/build-ios.sh
```

## 主要文件

- MealCompare/：界面、网页会话、比较核心。
- MealCompare/Resources/Probe.js：页面检测与有限搜索尝试。
- .github/workflows/build-ios.yml：开发分支推送及手动构建流程。
- docs/decisions-food-compare.md：需求、选型与未验证事项。

报告只包含来源域名、检测时间、候选信息和核对记录，不包含凭证、地址或完整网页。页面变化后需重新检测。
