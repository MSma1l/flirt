"""Configurare centralizată — totul din mediu, zero valori hardcodate în cod."""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_name: str = "FLIRT"
    environment: Literal["development", "staging", "production"] = "development"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False

    # Database
    postgres_user: str = "flirt"
    postgres_password: str = "change_me"
    postgres_db: str = "flirt"
    postgres_host: str = "db"
    postgres_port: int = 5432
    database_url: str | None = None

    # JWT
    jwt_algorithm: str = "RS256"
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # CORS
    cors_origins: str = "http://localhost:19006,http://localhost:8081"

    # Reguli produs
    min_registration_age: int = 16
    min_photos: int = 3
    max_photos: int = 9
    search_radius_default_km: int = 50
    account_deletion_grace_days: int = 30

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @field_validator("jwt_private_key", "jwt_public_key")
    @classmethod
    def _normalize_pem(cls, v: str) -> str:
        # permite chei PEM cu `\n` literal în .env
        return v.replace("\\n", "\n") if v else v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
