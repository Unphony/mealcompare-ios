# 饭价：需求与架构决定

更新：2026-10-23（Asia/Shanghai）。

## 已确定

- 个人自用，iPhone 16 Pro，用户报告 iOS 27.0.1；地区暂按中国大陆。
- 所有新增费用为 0，不购买 Mac、开发者会员、云构建额度或服务器。用户现有 Windows，没有 Mac。
- 日常查询完全由 iPhone 独立运行。开发编译与签名续期单独处理，不能要求常开业务电脑。
- 自动搜索美团与淘宝闪购（原饿了么）；截图或人工复制报价不能替代最终工具。
- 淘宝闪购的核对标准为独立 App 的红包、会员券与应付额。淘宝 App 内闪购频道的专属优惠不自动视为已验证。
- 比较同店、同目标商品规格与数量；购物篮可以不同，预算内凑单，额外品种与数量另设条件。
- 必须包含本人适用的红包、会员券，取得含配送费、包装费等的结算页应付金额。
- 以应付金额与预计送达时间保留帕累托候选，仅限实际取得的有效报价范围。
- 可手动处理登录、验证码，其他查询操作目标为自动完成。
- 当前不提交订单或支付。
- 用户决定：先尝试专用 App，可以免费自签；可行性不足再考虑其他形态。

## 方案比较与选择

| 方案 | 技术和维护 | 费用与限制 | 决定 |
| --- | --- | --- | --- |
| A 专用原生 App | SwiftUI、双 WKWebView、本地筛选；维护网页适配及续签 | 免费 Mac 构建、Windows 免费账号自签，需定期续签 | 用户已选择先尝试 |
| B Scriptable 宿主 | JavaScript、宿主网页容器；免维护原生打包 | 免费宿主，网页登录和完整优惠仍需验证 | A 不足时再评估 |
| C Safari 页面脚本 | Safari 与 Userscripts；维护两平台脚本 | 免费扩展，跨站状态传递与自动化限制待验证 | 备选 |

推荐 A，决定性理由是用户希望专用 App，且可以尝试免费自签。此前付费开发者会员或付费构建建议已被“所有费用为 0”排除。

运行时直接访问国内平台，没有自建后端、数据库或业务密钥。开发阶段需访问 GitHub。Apple 账号只在用户本机签名工具中使用，外卖登录在手机官方网页中完成。

## 已写的原型

- 原生首页、两平台网页、验证记录；两个稳定标识的 WKWebView 持久数据存储。
- 尝试识别唯一商品搜索框并点击明确搜索按钮；不支持时明确提示。
- 检测有标签的候选金额、送达文字、登录和结算线索。
- 本地 JSON 导出来源域名、检测时间、候选信息与核对记录，不导出凭证、地址、完整网页或 URL 查询参数。
- Swift 筛选核心检查同店同地址、预算、必含商品、额外品种和数量，并保留价格/时间帕累托候选。
- Xcode 工程与 GitHub Actions 未签名 IPA 构建配置。

当前没有接入真实报价；预算与凑单界面只保存设置。完整自动选规格、选券、组合购物篮仍未实现。检测结果是带时间的快照，页面变化后需重新检测。

## 免费构建与安装

[GitHub 官方计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)说明公开仓库标准托管构建机器免费。采用标准 macos-26；公开源码须经用户同意。私有仓库使用账号包含额度，只有核对剩余额度和设置 0 付费支出限制后才运行。产物保留一天，仍需注意账号总存储使用。额度耗尽时停止，不付费扩容。

[Sideloadly 官方说明](https://sideloadly.io/)提供 Windows 免费账号自签路线。免费签名期限为 7 天，续签需要电脑及设备连接条件；日常查询无需电脑。官网列出 iOS 27+，但这台设备和用户所报 iOS 27.0.1 未实际验证。

用户已提供并授权公开仓库 `Unphony/mealcompare-ios`。源码上传到 `codex/native-feasibility`；本地原始快照保留为 `local-snapshot-444fc29` 标签，上传提交 `8330a862` 的文件树与原快照一致。

2026-10-23，[首次 Mac 构建](https://github.com/Unphony/mealcompare-ios/actions/runs/39907207638)成功，22 项 Swift 断言和 13 项页面检查通过，已生成未签名 IPA。用户要求创建 PR、合并 PR 分别确认，当前没有创建 PR。

原型已完成基本自签安装与结算信息读取验证。免费 iLoader 2.4.0 可作为安装工具。完整比价仍需核对同店、同餐、同地址及目标优惠；公开文档不记录个人账号的登录状态或具体诊断数据。见[能力验证状态](validation-2026-10-23.md)。

0.1.1 已通过[第二次 iOS 构建](https://github.com/Unphony/mealcompare-ios/actions/runs/39923382578)：修正送达时间区间、提示缺少地址、导出时重新检测，增加仅含数量的登录保持诊断。22 项 Swift 断言与 18 项页面检查通过。此次不改变现有的持久网站存储标识，不把登录保持标为已修复。

## 淘宝闪购品牌及会话设计

用户明确要求按独立“淘宝闪购”App（原饿了么）继续。阿里巴巴[官方业务介绍](https://www.alibabagroup.com/en-US/about-alibaba-businesses-1894256634985709568)说明品牌更名，且官网链接仍为 ele.me。继续使用已在手机走通的 h5.ele.me 页面；品牌变更本身不证明不同入口的优惠完全一致。界面名称更新，内部 eleme 键、网站存储 UUID 和应用标识保持原值，以保留本地数据。

采用稳定标识的 WebKit 持久网站存储；不额外备份会话 Cookie。数量统计仅作为本机诊断，不能证明登录状态或原因，具体计数不放入公开文档。按已接受的手动登录与验证码方式继续验证自动查询。

## 首要验证与后续

1. 安装、登录、重启保持登录、关闭电脑后运行。
2. 两家官方网页能否完整搜索、选规格并进入结算页。
3. 同账号、地址、购物篮、时点，网页目标红包会员券和应付额是否与官方 App 一致。
4. 数据来源通过后，开发完整自动化适配并接入筛选核心。
5. 如果网页缺少必要优惠或依赖官方 App，记录失败点，重新评估；换宿主不保证补齐数据能力。

## 0.1.2 自动进入搜索页

根据公开官方前端脚本确认了两条搜索入口，导航后等待可见商品搜索框，填写并提交官方搜索表单。不研究或调用私有搜索接口。

- 美团：https://h5.waimai.meituan.com/waimai/mindex/search。[主脚本](https://s3.meituan.net/static-prod01/ws-assets/com.sankuai.wmcapp.openh5.static/M1ex5S6hJrPw3cGoTvmG5/js/index.0f6b961e.js)声明 basename `/waimai` 和 `/:channel/search` 路由；[搜索脚本](https://s3.meituan.net/static-prod01/ws-assets/com.sankuai.wmcapp.openh5.static/M1ex5S6hJrPw3cGoTvmG5/js/search.97adffad.js)使用 `#sqt-openh5-searchSearchBar` 内的表单，“搜索”本身为普通 div。只在精确域名和该路径提交此容器的唯一表单。
- 淘宝闪购：https://h5.ele.me/search/#/。[首页脚本](https://shadow.elemecdn.com/faas/h5-msite/msite/msite.96f6961.js)的 `goSearch` 打开 `/search/#/`；[搜索脚本](https://shadow.elemecdn.com/faas/h5/search/search.9d45ea8.js)含原生搜索输入框和“搜索”提交按钮。

填写和提交分两步，等待由可取消的本机任务控制，页面中不遗留点击定时器。返回、首页、刷新或新搜索会取消旧任务；待处理搜索只在对应导航完成后执行。登录/验证码由用户处理，再点击“试查”继续。报告仅新增搜索尝试状态与时间，不包含查询词或网页内容。

公开脚本和模拟测试不等同于真机完成自动搜索；同店商品规格匹配、选券和组合购物篮仍未完成。

## 官方依据

用户确认 0.1.2 后已推进[单店配餐验证与历史索引](automation-0.2.md)。阶段样例为汉堡王“双层厚鸡堡四件套”和牛约堡“经典招牌牛肉堡”，预算均为 30 元；将历史订单作为有限候选索引，金额仍每次到结算页重新取得。此阶段的局部操作链不代表完整自动跨平台比价已经验收。

- [Apple 应用隔离](https://support.apple.com/zh-cn/guide/security/sec15bfe098e/web)：普通应用不能读取另一应用的私有登录数据。
- [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)、[WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)。
- [美团网页](https://h5.waimai.meituan.com/waimai/mindex/home)、[淘宝闪购原饿了么网页](https://h5.ele.me/)：存在入口不证明完整结算可用。
- [美团联盟文档](https://page.meituan.net/html/1701831807616_1db0df/index.html)：商品券供给不等于个人全菜单结算报价。
- [Scriptable](https://apps.apple.com/cn/app/scriptable/id1405459188)、[Userscripts](https://github.com/quoid/userscripts)：未采用的备选宿主。
