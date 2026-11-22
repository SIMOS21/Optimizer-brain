"""Bounded decimal inputs; exact rational arithmetic inside the kernel."""

from decimal import Decimal, InvalidOperation
from fractions import Fraction
import re
from typing import Annotated

from pydantic import BeforeValidator, WithJsonSchema

DECIMAL_PATTERN = r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"


def decimal_value(value: object) -> Decimal:
    """Reject booleans, coercible objects, non-finite and excessive numeric inputs."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Nombre décimal fini attendu (booléens interdits)")
    raw = str(value)
    if len(raw) > 128 or re.fullmatch(DECIMAL_PATTERN, raw) is None:
        raise ValueError("Littéral décimal invalide ou trop long (128 caractères maximum)")
    try:
        number = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError("Nombre décimal invalide") from exc
    if not number.is_finite():
        raise ValueError("Nombre fini attendu")
    parts = number.as_tuple()
    if len(parts.digits) > 100 or not -100 <= int(parts.exponent) <= 100:
        raise ValueError("Limites numériques : 100 chiffres et exposant entre -100 et 100")
    return number


Number = Annotated[
    Decimal,
    BeforeValidator(decimal_value),
    WithJsonSchema(
        {
            "anyOf": [
                {"type": "string", "pattern": DECIMAL_PATTERN, "maxLength": 128},
                {"type": "number"},
            ],
            "description": "Décimal fini ; 100 chiffres, exposant [-100,100]. Chaîne recommandée.",
        },
        mode="validation",
    ),
]


def rational(value: object) -> Fraction:
    return Fraction(decimal_value(value))
