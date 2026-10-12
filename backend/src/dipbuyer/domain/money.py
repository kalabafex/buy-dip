"""Money helpers. Money is always ``Decimal``; floats are converted at the boundary."""

from __future__ import annotations

from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")
QTY_STEP = Decimal("0.000001")
ZERO = Decimal(0)
HUNDRED = Decimal(100)


def to_decimal(value: object) -> Decimal:
    """Convert an SDK/data value (float, int, str, Decimal) to ``Decimal``.

    Floats go through ``str`` (``repr``) so that ``0.1`` becomes ``Decimal("0.1")``
    rather than its binary expansion.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise TypeError("bool is not a monetary value")
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(repr(value))
    if isinstance(value, str):
        try:
            return Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(f"not a decimal: {value!r}") from exc
    raise TypeError(f"cannot convert {type(value).__name__} to Decimal")


def to_decimal_opt(value: object) -> Decimal | None:
    return None if value is None else to_decimal(value)


def round_to_cent(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def floor_qty(value: Decimal, step: Decimal = QTY_STEP) -> Decimal:
    """Floor a quantity to ``step`` (default 6 decimal places)."""
    return value.quantize(step, rounding=ROUND_DOWN)


def floor_whole(value: Decimal) -> Decimal:
    return value.quantize(Decimal(1), rounding=ROUND_DOWN)


def pct(numerator: Decimal, denominator: Decimal) -> Decimal:
    return numerator / denominator * HUNDRED
