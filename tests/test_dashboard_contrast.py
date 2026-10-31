"""Contrast regressions for small custom dashboard text."""
import re
from pathlib import Path

import pytest

CSS = (Path(__file__).resolve().parents[1] / "app" / "styles.css").read_text(encoding="utf-8")


def luminance(color):
    values = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in values]
    return sum(a * b for a, b in zip(linear, (0.2126, 0.7152, 0.0722)))


@pytest.mark.parametrize("selector,background", [
    (".side-label,.eyebrow", "#f5f6f3"),
    (".detail-card span", "#ffffff"),
    (".app-footer", "#f5f6f3"),
])
def test_small_text_meets_wcag_normal_contrast(selector, background):
    rule = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    assert rule, f"Missing style rule: {selector}"
    color = re.search(r"(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{6})\b", rule.group(1))
    assert color, f"Expected an explicit text color in {selector}"
    foreground = luminance(color.group(1))
    backdrop = luminance(background)
    contrast = (max(foreground, backdrop) + 0.05) / (min(foreground, backdrop) + 0.05)
    assert contrast >= 4.5, f"{selector} contrast is {contrast:.2f}:1"
