"""Small, closed multiplicative unit algebra. No text is executed."""

from dataclasses import dataclass
from fractions import Fraction
import re


@dataclass(frozen=True)
class Unit:
    dimensions: tuple[tuple[str, int], ...]
    scale: Fraction = Fraction(1)

    def multiply(self, other: "Unit") -> "Unit":
        powers = dict(self.dimensions)
        for dimension, exponent in other.dimensions:
            powers[dimension] = powers.get(dimension, 0) + exponent
        return Unit(tuple(sorted((d, e) for d, e in powers.items() if e)), self.scale * other.scale)


# Currency codes are separate dimensions: no implicit exchange rate.
_ATOMS: dict[str, tuple[str | None, Fraction]] = {
    "1": (None, Fraction(1)),
    "percent": (None, Fraction(1, 100)),
    "unit": ("count", Fraction(1)),
    "hour": ("time", Fraction(1)),
    "minute": ("time", Fraction(1, 60)),
    "second": ("time", Fraction(1, 3600)),
    "kg": ("mass", Fraction(1)),
    "tonne": ("mass", Fraction(1000)),
    "meter": ("length", Fraction(1)),
    "km": ("length", Fraction(1000)),
    **{code: (code, Fraction(1)) for code in ("EUR", "MAD", "USD")},
}
UNIT_PATTERN = r"(?:1|[A-Za-z]+)(?:\^-?[1-8])?(?:[*/](?:1|[A-Za-z]+)(?:\^-?[1-8])?)*"


def parse_unit(text: str) -> Unit:
    if len(text) > 128 or re.fullmatch(UNIT_PATTERN, text) is None or text.count("/") > 1:
        raise ValueError(f"Unité invalide : {text!r} (produits et un quotient, sans parenthèses)")
    numerator, separator, denominator = text.partition("/")
    result = Unit(())
    for side, sign in ((numerator, 1), (denominator, -1)):
        if not side:
            continue
        for token in side.split("*"):
            atom, _, power = token.partition("^")
            if atom not in _ATOMS:
                raise ValueError(f"Unité inconnue : {atom!r}")
            dimension, scale = _ATOMS[atom]
            exponent = sign * (int(power) if power else 1)
            dimensions = ((dimension, exponent),) if dimension else ()
            result = result.multiply(Unit(dimensions, scale**exponent))
    return result
