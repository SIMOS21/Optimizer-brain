"""Argon2id passwords and revocable 256-bit opaque bearer sessions."""

from dataclasses import dataclass
import hashlib
import secrets
import time

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .models import AuthSession, LoginThrottle, Membership, Organization, User

HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, type=Type.ID)
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))


class AuthenticationError(ValueError):
    pass


def normalize_username(username: str) -> str:
    import re

    value = username.strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9_.@+\-]{2,127}", value) is None:
        raise ValueError("Identifiant ASCII de 3 à 128 caractères requis")
    return value


def create_user(session: Session, username: str, password: str, display_name: str) -> User:
    if not 12 <= len(password) <= 1024:
        raise ValueError("Mot de passe de 12 à 1024 caractères requis")
    if not display_name.strip() or len(display_name) > 500:
        raise ValueError("Nom d'affichage invalide")
    user = User(
        username=normalize_username(username),
        password_hash=HASHER.hash(password),
        display_name=display_name.strip(),
    )
    session.add(user)
    session.flush()
    return user


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    expires_at: int


def login(
    session: Session, username: str, password: str, *, lifetime: int = 28800
) -> IssuedSession | None:
    moment = int(time.time())
    normalized = normalize_username(username)
    key = hashlib.sha256(normalized.encode()).hexdigest()
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    session.execute(
        insert(LoginThrottle)
        .values(key=key, attempts=0, window_until=moment + 900)
        .on_conflict_do_nothing(index_elements=["key"])
    )
    throttle = session.scalar(
        select(LoginThrottle).where(LoginThrottle.key == key).with_for_update()
    )
    assert throttle is not None
    if throttle.window_until <= moment:
        throttle.attempts, throttle.window_until = 0, moment + 900
    user = session.scalar(select(User).where(User.username == normalized))
    verified = False
    try:
        verified = HASHER.verify(user.password_hash if user else DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        pass
    if throttle.attempts >= 5 or not verified or user is None or not user.active:
        throttle.attempts += 1
        return None  # Caller must commit failed attempt counters too.
    throttle.attempts = 0
    if HASHER.check_needs_rehash(user.password_hash):
        user.password_hash = HASHER.hash(password)
    token = secrets.token_urlsafe(32)
    expires = moment + lifetime
    session.add(AuthSession(token_hash=token_digest(token), user_id=user.id, expires_at=expires))
    return IssuedSession(token, expires)


def authenticate(session: Session, token: str) -> User:
    if len(token) != 43 or not token.isascii():
        raise AuthenticationError("Authentification requise")
    user = session.scalar(
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            AuthSession.token_hash == token_digest(token),
            AuthSession.expires_at > int(time.time()),
            User.active.is_(True),
        )
    )
    if user is None:
        raise AuthenticationError("Authentification requise")
    return user


def logout(session: Session, token: str) -> None:
    session.execute(delete(AuthSession).where(AuthSession.token_hash == token_digest(token)))


def disable_user(session: Session, user: User) -> None:
    """Administrative provisioning action, retaining at least one active admin."""
    organizations = session.scalars(
        select(Organization)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(
            Membership.user_id == user.id, Membership.role == "ADMIN", Membership.active.is_(True)
        )
        .order_by(Organization.id)
        .with_for_update(of=Organization)
    ).all()
    for organization in organizations:
        remaining = session.scalar(
            select(func.count())
            .select_from(Membership)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.organization_id == organization.id,
                Membership.role == "ADMIN",
                Membership.active.is_(True),
                User.active.is_(True),
                User.id != user.id,
            )
        )
        if not remaining:
            raise ValueError(
                "Transférer l'administration avant de désactiver le dernier administrateur"
            )
    user.active = False
    session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
