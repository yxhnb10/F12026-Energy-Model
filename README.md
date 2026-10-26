# PitWall Energy Model

以正赛为主要应用场景、根据公开遥测格式估计可用储能变化的研究模型。
Race-first, scenario-based energy-store estimation from telemetry.

**这是电量估计，不是车队实测 SOC。排位赛模拟目前较弱，属于实验性功能。**
维护者认为正赛使用表现相对较好，但尚无真实 SOC 标签验证，不能据此宣称准确率。

## 快速运行

需要 Node.js 22 或更新版本，无第三方运行依赖，无需安装、账号、API 密钥或联网。

```sh
npm test
npm run example
npm run check:release
```

示例数据完全由代码生成，不对应任何真实车手、赛道或赛事；示例输出不能证明预测准确。

```js
import {createEnergyModel} from './src/index.mjs';
const start = Date.UTC(2026, 0, 1);
const model = createEnergyModel({
  start, sessionName: 'Race', initialSoc: 75, initialSocRange: [60, 90]
});
model.ingest({time: start + 250, speed: 200, throttle: 80, brake: 0, n_gear: 6});
model.ingest({time: start + 500, speed: 202, throttle: 80, brake: 0, n_gear: 6});
console.log(model.snapshot());
const checkpoint = model.exportState();
// 用相同配置创建新实例后可 restore(checkpoint)，再继续输入后续样本。
```

## 适用程度

| 场景 | 首版定位 |
| --- | --- |
| 2026 正赛、冲刺赛 | 主要研究场景；正赛表现较好的判断来自维护者使用观察，尚无实测 SOC 基准 |
| 排位赛、冲刺排位赛 | 实验性，已知表现较弱；不建议依赖单点百分比作结论 |
| 练习赛及试跑拟合 | 实验性；只验证纵向运动表现，不等于验证电量 |
| 其他年份 | 公共入口暂不支持；底层保留的历史/未来年份分支未在本发布中审定 |

## 输入和输出

每个实例只处理一辆车、一个连续场次；不要混合多车样本。按时间升序输入。

- `time`、`start`：毫秒时间戳；`speed`：km/h；`throttle`：0–100%；`n_gear`：0–8。
- `brake`：只有踩下/松开观测，使用 100/0 或布尔值；不是实际刹车压力。未知必需通道显式传 `null`。
- 可选：`lap_number`、`total_laps`、`lap_start`（毫秒）、`progress`（0–1）、`drs`、`energyPhase`（GREEN/SC/VSC）。
- 实验性圈型识别可传 `inPit`、`inLap`、`isPitOut`、`lapPhase`；不声称能识别车队真实能量模式。
- `estimate`：多情景加权估计；`low/high` 和 `scenarioLow/scenarioHigh` 是假设范围，不是统计置信区间。
- `batteryFlow`：估计的储能端功率，正号放电、负号充电；`measured` 始终为 false。
- `coverage`、`missingSeconds`、`state`：数据完整度和当前估计状态；缺失数据不能视为已知电量。

默认正赛起点设为可用能量窗口 100%，这是先验，不是遥测读数。已知起点不同时应显式设置 `initialSoc` 和范围。
电量百分比基于模型的可用能量窗口，不表示电芯化学总容量。

重复、晚到或起点之前的样本返回 false。超过两秒的间断不会被当作正常充放电积分；中心值保留，假设范围扩大。
圈数变化、回站或中断不会自动把电量补满。历史游标需要重新播放数据前缀或恢复较早检查点，不能从未来状态反推。

可选 `policy` 支持 `maxDeployKW`、`maxHarvestKW`、`harvestPerLapMJ`、`fullThrottleHarvestKW`。
默认常量来自应用现有假设，**不是对现行 FIA 全部法规的合规认证**；使用者应按年份、赛事和生效日期核实规则。
可选 `practiceModel` 接收自行合法取得的数据拟合产物；包内不附任何真实拟合参数集。

## 方法、限制与贡献

见 [模型说明](docs/MODEL_CARD.md)、[来源与许可边界](THIRD_PARTY_NOTICES.md) 和 [贡献指南](CONTRIBUTING.md)。
特别欢迎缺测、状态恢复、物理边界和正赛时序上的可复现问题；优先使用合成样本报告。
不接受以无标签 SOC 输出相互吻合作为准确率证明。

## 许可与范围

本目录的源码、文档和合成示例以 [MIT](LICENSE) 发布，署名 ltnssss。
这个许可不覆盖 PitWall 网站其他源码、商标、赛事数据、音频、图片或上游服务。
无官方、车队或数据供应商背书。使用者自行取得并遵守数据访问、使用及再分发权限。
项目包没有联网采集器、原始赛事数据、账号后台、数据库、密钥或原网站 Git 历史。

`PROVENANCE.json` 记录来源版本、提取范围和发布文件摘要；它是可复现性记录，不是法律合规保证。
`private: true` 仅防止误发 npm，不影响 MIT 使用、复制和分发许可，也不妨碍 GitHub 公开发布。
