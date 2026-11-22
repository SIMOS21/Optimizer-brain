"""Local administrator provisioning only. Passwords never appear in command arguments."""

import argparse
import getpass
import os
from sqlalchemy import create_engine, select

from .auth import create_user, disable_user, normalize_username
from .models import User
from .database import sessions


def main() -> int:
    parser = argparse.ArgumentParser(description="Administration locale Phase 4A")
    parser.add_argument("command", choices=["create-user", "disable-user"])
    parser.add_argument("--username", required=True)
    parser.add_argument("--display-name")
    args = parser.parse_args()
    url = os.environ.get("BRAIN_MIGRATION_DATABASE_URL")
    if not url:
        parser.error("BRAIN_MIGRATION_DATABASE_URL requis pour cette commande administrateur")
    engine = create_engine(url, hide_parameters=True)
    with sessions(engine).begin() as session:
        if args.command == "create-user":
            password = getpass.getpass("Mot de passe : ")
            if password != getpass.getpass("Confirmation : "):
                raise ValueError("Confirmation différente")
            user = create_user(session, args.username, password, args.display_name or args.username)
            print("Utilisateur créé :", user.id)
        else:
            target = session.scalar(
                select(User).where(User.username == normalize_username(args.username))
            )
            if target is None:
                raise ValueError("Utilisateur introuvable")
            disable_user(session, target)
            print("Utilisateur désactivé")
    engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
