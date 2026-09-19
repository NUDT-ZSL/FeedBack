"""Built-in acceptance scene: completely offline and populated on launch."""

from math import pi

from .model import Scene, Transform, ValidationError


def build_sample_scene() -> Scene:
    scene = Scene()
    # A small assembly: root chassis -> front module -> sensor, plus a cover.
    scene.add_object("chassis", None, Transform(translation=(0, 0, 0)), size=(4.0, 0.8, 2.2))
    scene.add_object(
        "front_module", "chassis",
        Transform(translation=(1.6, 0.55, 0.0), rotation_xyz=(0.0, 0.0, 0.0)),
        size=(1.1, 0.7, 1.2),
    )
    scene.add_object(
        "sensor", "front_module",
        Transform(translation=(0.45, 0.62, 0.25)),
        size=(0.45, 0.35, 0.35),
    )
    scene.add_object(
        "cover", None,
        Transform(translation=(-0.7, 1.05, -0.2), rotation_xyz=(0.0, 0.18, 0.0)),
        size=(2.5, 0.22, 1.6),
    )
    scene.add_object(
        "rear_bracket", "chassis",
        Transform(translation=(-1.55, 0.55, 0.45), rotation_xyz=(0.0, -0.25, 0.0)),
        size=(0.7, 0.35, 0.55),
    )

    scene.add_annotation(
        "A01", "sensor", (0.22, 0.30, 0.10),
        "传感器顶面需要复核安装间隙", source="reviewer_alpha"
    )
    # Deliberately retained conflict: same id, different source/body/anchor.
    scene.add_annotation(
        "A01", "sensor", (0.10, 0.34, 0.00),
        "传感器前盖棱边需要增加防呆标识", source="reviewer_beta"
    )
    scene.add_annotation(
        "A02", "front_module", (0.12, 0.68, 0.55),
        "此处引用传感器安装说明", source="reviewer_alpha"
    )
    scene.add_annotation(
        "A03", "rear_bracket", (0.35, 0.32, 0.10),
        "支架螺栓孔朝向需确认", source="qa_import"
    )
    scene.add_annotation(
        "A04", "cover", (1.25, 0.18, 0.75),
        "盖板与支架之间检查干涉", source="qa_import"
    )

    scene.add_relation("A02", "A01", "reference",
                       from_source="reviewer_alpha", to_source="reviewer_alpha")
    scene.add_relation("A03", "A04", "attachment",
                       from_source="qa_import", to_source="qa_import")
    return scene
