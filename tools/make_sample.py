#!/usr/bin/env python3
"""生成一篇用于演示的中文长文 public/sample.txt。"""
import random
from pathlib import Path

random.seed(20260922)

TOPICS = [
    ("清晨的河岸", "雾气贴着水面慢慢移动，早起的人沿着步道慢跑",
     "一位老人把收音机放在长椅上，音量调得很低"),
    ("老城的书店", "木楼梯踩上去会发出轻微的响声，二楼堆满了绝版画册",
     "店主习惯在雨天给熟客留一壶热茶"),
    ("山间的邮局", "绿色的邮筒立在岔路口，每周开箱两次",
     "邮递员认得村里每一只狗，也记得每家订的报纸"),
    ("夜班的公交", "末班车穿过空旷的高架桥，车厢里只有零星几位乘客",
     "司机在终点站总会多等两分钟，看看有没有跑来的人"),
    ("海边的灯塔", "守塔人的日志写满了四十年的风向与潮汐",
     "灯器每夜准时亮起，光束扫过漆黑的海面"),
]

DETAILS = [
    "对于低视力的读者来说，这样的细节只有足够大、足够清晰的字体才能被舒适地读到",
    "排版系统需要在每一次缩放之后，都把读者正在看的句子稳稳地留在视野里",
    "行距、栏宽和对比度，与字号同样重要",
    "好的工具应当安静、可靠，不打扰阅读本身",
]


def paragraph(i):
    t = TOPICS[i % len(TOPICS)]
    sents = [
        f"{t[0]}总是比别处醒得更早一些。",
        f"{t[1]}，{t[2]}。",
        f"有人停下来看一会儿，有人匆匆走过；{random.choice(DETAILS)}。",
        f"日子久了，{t[0]}成了许多人心里一个安静的坐标，"
        f"无论走得多远，想起来都觉得踏实。",
    ]
    if i % 9 == 4:  # 偶发的超长段落，用于验证大字号下逐行可读
        sents.append(
            "这一段故意写得很长，" * 12 +
            "用来验证当字号放到很大、段落超过一屏时，正文仍然可以逐行读完，"
            "而不会被裁切、重叠或挤出视窗。"
        )
    if i % 7 == 3:  # 偶发的长英文串，用于验证不断行溢出
        sents.append(
            "参考资料见 https://example.com/very/long/path/"
            "to/a/document/that/should/wrap/instead/of/overflowing/the/column 。"
        )
    return "".join(sents)


def main():
    out = Path(__file__).resolve().parent.parent / "public" / "sample.txt"
    paras = [paragraph(i) for i in range(60)]
    out.write_text("\n\n".join(paras) + "\n", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(paras)} paragraphs)")


if __name__ == "__main__":
    main()
