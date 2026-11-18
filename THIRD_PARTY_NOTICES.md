# 第三方数据与许可证说明

## HqHelper 简易制作资料

- 来源：[InfSein/hqhelper 的配方快照](https://github.com/InfSein/hqhelper/blob/d7bf0f40fb589c2e93817f6d1bcb1c92eb102434/src/assets/data/unpacks/recipes.json)，第三方开源项目。
- 许可：[MIT License，Copyright (c) 2024-2027 InfSein](https://github.com/InfSein/hqhelper/blob/d7bf0f40fb589c2e93817f6d1bcb1c92eb102434/LICENSE)（MIT 许可正文见本文下方）。
- 用 `node tools/sync-recipe-synthesis.mjs [本地快照路径]` 按配方 ID 同步简易制作标记与门槛。核对结果保存在 `recipe-synthesis-data.js` 的 `audit`，包含各资料表覆盖、工房节点、待核验清单及 XIVAPI 样例核对。

## HqHelper Dawntrail

- 来源：<https://github.com/InfSein/hqhelper-dawntrail>
- 用途：物品、制作配方、产出数量与兑换关系的版本固定校验 / 缺失回退数据；职业图标名称与职业映射的校验来源。
- 本项目不复用该项目的界面或业务代码；生成的 `hqhelper-fallback.js` 仅保留本项目 770、750 与潜水艇配方树需要的数据。HqHelper 不再作为物品图标来源。
- 许可证：MIT License，Copyright (c) 2024 InfSein。

该来源的数据快照以文件内 `meta.commit` 为准。灰机 Wiki 仍为主配方来源；Universalis 仅提供中国区市场价格。

## Garland Tools

- 来源：<https://www.garlandtools.org/>
- 用途：同步时按物品 ID 读取公开物品资料中的图标编号；页面运行时从 `https://www.garlandtools.org/files/icons/item/{iconId}.png` 加载图标。
- 图标仅用于物品识别，不会打入安装包；无法加载时页面保留纯文字显示。

## 优雷卡元素图标

- 来源：<https://ffxiv.consolegameswiki.com/wiki/Template:Eurekaelement_icon>
- 用途：水晶价格页火、冰、风、土、雷、水六个分组标题的本地 PNG 图标。

```text
MIT License

Copyright (c) 2024 InfSein

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
