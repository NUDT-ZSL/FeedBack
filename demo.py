"""离线端到端示例：构造环境矩阵 -> 登记用例 -> 上报结果 -> 环境不可用
-> 矛盾上报 -> 矩阵新增取值后的增量重算 -> 打印可复核结论。

运行：python -X utf8 demo.py
"""
from envcompat import Matrix, CompatibilityRunner


def main() -> None:
    # 1) 环境维度与矩阵（2 × 2 = 4 个组合）。
    matrix = Matrix([
        ("os", ["linux", "windows"]),
        ("browser", ["chrome", "firefox"]),
    ])

    # 2) 分组与用例（期望结果默认 pass）。
    runner = CompatibilityRunner(
        matrix,
        groups=["login", "payment"],
        cases=[
            ("login_success", "login"),
            ("login_captcha", "login", "pass"),
            ("pay_checkout", "payment"),
        ],
    )

    # 3) 各组合上报结果（source 表示执行来源）。
    runner.record("login_success", ("linux", "chrome"), "pass", source="ci-1")
    runner.record("login_captcha", ("linux", "chrome"), "pass", source="ci-1")
    runner.record("pay_checkout", ("linux", "chrome"), "fail",
                  source="ci-1", reason="断言失败：应收 100.00，实收 99.99")

    runner.record("login_success", ("linux", "firefox"), "pass", source="ci-2")
    runner.record("pay_checkout", ("linux", "firefox"), "timeout",
                  source="ci-2", reason="支付网关 30s 无响应")

    # 同一结论的重复上报：幂等忽略。
    runner.record("login_success", ("linux", "chrome"), "pass", source="ci-1")

    # 4) 两个来源在 windows/chrome 上结论矛盾：双方都保留，绝不静默择一。
    runner.record("login_success", ("windows", "chrome"), "fail", source="ci-1",
                  reason="登录后白屏")
    runner.record("login_success", ("windows", "chrome"), "pass", source="ci-3")

    # 5) windows/firefox 环境临时不可用：未上报的用例标“未执行”，不当通过。
    runner.mark_unavailable(("windows", "firefox"), "Firefox 节点维护，无法 SSH")

    # 6) 输出变更前报告。
    print(runner.summary().render_text())

    # 7) 维度新增取值 mac：只新增受影响组合，旧组合逐格不变，且与全量重算一致。
    change = runner.rebuild_matrix([
        ("os", ["linux", "windows", "mac"]),
        ("browser", ["chrome", "firefox"]),
    ])
    equivalent, _, _ = runner.verify_equivalence()
    print("\n矩阵变更：新增", len(change.added), "个组合，",
          "未受影响", len(change.unchanged), "个；",
          "增量结果与从头重算完全一致：", equivalent)


if __name__ == "__main__":
    main()
