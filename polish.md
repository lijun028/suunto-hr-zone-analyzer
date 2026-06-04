# 项目改动总结

## 项目目标

这个项目从一个空文件夹开始，做成了一个可直接在浏览器中打开使用的 Suunto 运动记录心率区间校验工具。工具用于上传 Suunto 导出的 JSON 文件，读取官方 `HrZones` 区间统计，并用 `Samples` 中逐秒打点的 `HR` 数据重新统计各心率区间时长，帮助分析官方统计与 sample 重算结果之间的差异。

## 已完成的主要改动

1. 新建静态网页工具

   - 新增 `index.html`，提供上传 JSON、加载示例、统计规则选择、摘要、区间对比表、规则试算表和边界命中表。
   - 新增 `styles.css`，实现响应式工具界面，支持桌面和移动宽度下正常使用。
   - 新增 `app.js`，实现 JSON 解析、心率 sample 提取、心率区间重算、差值计算、规则试算和 CSV 导出。

2. 支持 Suunto JSON 结构

   - 兼容 `DeviceLog.Header.Personal.MaxHR` 作为最大心率。
   - 读取 `DeviceLog.Header.HrZones` 中的 `Zone1Duration` 到 `Zone5Duration` 以及 `Zone2LowerLimit` 到 `Zone5LowerLimit`。
   - 从 `DeviceLog.Samples[*].HR` 中筛选心率 sample，忽略 GPS、卫星、事件等不含 HR 的 sample。
   - 心率单位按 Hz 处理，并在界面中同时显示 Hz 和 BPM。

3. 增加统计规则切换

   - 支持多种 sample 时长算法：
     - 上一条 HR 到当前 HR 的时间差
     - 每个 HR sample 计 1 秒
     - 当前 HR 到下一条 HR 的时间差
     - 当前 HR 到下一条，末条计 1 秒
   - 支持阈值处理方式：
     - 使用 JSON 原始阈值
     - 四舍五入到 sample 精度
     - 向上取到 sample 精度
     - 向下取到 sample 精度
   - 支持边界归属切换：
     - 下限归入高区间
     - 边界归入低区间
   - 支持小数位调整，用来观察 sample 精度对边界统计的影响。

4. 增加误差分析视图

   - 区间对比表显示每个 Zone 的官方秒数、重算秒数、差值、差值百分比和 sample 点数。
   - 摘要区显示官方区间合计、重算区间合计、HR sample 数量、MaxHR、sample 心率范围和最大 HR 时间间隔。
   - 规则试算表自动比较不同统计规则组合，并按总绝对误差排序。
   - 边界命中表显示处理后的阈值被多少 sample 命中，以及附近 sample 的数量，方便定位边界误差。

5. 加入品牌和示例数据

   - 下载并加入 Suunto logo：`assets/suunto-logo.svg`。
   - 页头改为 Suunto logo + 工具标题布局。
   - 将用户提供的样例 JSON 放入项目：
     - `examples/sample-running-2026-02-25.json`
     - `assets/sample-running-2026-02-25.json`
   - 新增 `assets/sample-running-2026-02-25.js`，让页面在 `file://` 方式打开时也能通过脚本直接加载示例数据。
   - 新增“加载示例”按钮，一键调用项目内置 sample JSON 并运行完整统计流程。

## 样例验证结果

使用样例文件验证时，得到以下关键结果：

- `MaxHR`: `2.867 Hz`，即 `172.02 bpm`
- 原始 `Samples` 数量：`19076`
- 带 `HR` 的 sample 数量：`4594`
- 官方 `HrZones` 合计：`4588.883 s`
- `Header.Duration`: `4589.545 s`
- 默认原始阈值规则下，Z2/Z3 出现明显差异：
  - Z2 约 `-725 s`
  - Z3 约 `+729 s`
- 自动规则试算显示，“阈值四舍五入到 2 位小数 + 边界归入低区间”更接近官方结果。
- `2.37 Hz` 边界命中大量 sample，是主要误差观察点之一。

## 使用过的 Codex 功能和工具

1. 文件与项目检查

   - 使用 shell 命令检查目录结构、文件列表和文件大小。
   - 使用 `rg --files`、`ls`、`sed` 等命令读取和确认项目文件。

2. JSON 数据分析

   - 使用 `jq` 和 Node.js 脚本检查 Suunto JSON 的真实结构。
   - 确认实际字段路径为：
     - `DeviceLog.Header.Personal.MaxHR`
     - `DeviceLog.Header.HrZones`
     - `DeviceLog.Samples[*].HR`
   - 用 Node.js 快速试算不同边界规则和时长算法对结果的影响。

3. 文件编辑

   - 使用 Codex 的 `apply_patch` 创建和修改：
     - `index.html`
     - `styles.css`
     - `app.js`
     - `polish.md`
   - 使用 shell 命令复制样例 JSON、下载 Suunto logo、生成示例数据脚本。

4. 本地网页验证

   - 使用 `python3 -m http.server 4173` 启动临时本地服务器。
   - 使用 Codex in-app Browser 打开本地页面，检查页面加载、桌面布局和移动布局。
   - 点击“加载示例”按钮，验证示例 JSON 能被正确加载并渲染结果。

5. 代码与数据校验

   - 使用 `node --check app.js` 检查 JavaScript 语法。
   - 使用 `node --check assets/sample-running-2026-02-25.js` 检查示例数据脚本语法。
   - 使用 `python3 -m json.tool` 确认样例 JSON 可解析。
   - 使用 Node.js 调用 `parseSuuntoJson` 和 `analyze` 验证样例统计结果。

## 当前项目文件

- `index.html`: 页面结构和主要交互入口。
- `styles.css`: 页面视觉样式和响应式布局。
- `app.js`: JSON 解析、心率区间统计、规则试算、表格渲染和 CSV 导出逻辑。
- `assets/suunto-logo.svg`: Suunto logo。
- `assets/sample-running-2026-02-25.json`: 页面示例按钮对应的 JSON 数据。
- `assets/sample-running-2026-02-25.js`: `file://` 环境可直接加载的示例数据脚本。
- `examples/sample-running-2026-02-25.json`: 原始样例 JSON 备份。
- `polish.md`: 本项目改动总结。

## 备注

当前工具是纯静态网页，不依赖构建步骤。直接打开 `index.html` 即可使用；如果浏览器对本地文件有额外限制，也可以在项目目录运行本地静态服务器后访问页面。
