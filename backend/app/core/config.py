"""Configurare centralizată — totul din mediu, zero valori hardcodate în cod."""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
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
    about_max_length: int = 500  # lungimea maximă a câmpului „despre" (TZ 2.4)

    # Reguli feed / vârstă (fără hardcodare în servicii)
    adult_age: int = 18          # pragul 16-17 / 18+ (TZ 2.3)
    feed_limit: int = 10         # câte cartele întoarce feed-ul implicit (TZ 4)

    # Stories
    story_ttl_hours: int = 24    # durata de viață a unei povești (TZ secț. 11)

    # Moderare (TZ 10)
    report_autoban_threshold: int = 3   # câte rapoarte distincte → auto-ascundere cont

    # === Integrări externe (stub implicit; setează providerul + cheile la deploy) ===
    # Storage foto (TZ 2.4). Provider: 'stub' | 's3'
    storage_provider: str = "stub"
    storage_base_url: str = "https://cdn.flirt.local"   # bază URL pentru stub
    s3_bucket: str = ""
    s3_region: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # Geolocație / geocoding (TZ 7).
    # Provider: 'stub' | 'nominatim' | 'google' | 'mapbox'
    # 'nominatim' (OpenStreetMap) e GRATUIT și NU cere cheie API — providerul
    # recomandat în producție. Cere doar un User-Agent identificabil (policy OSM).
    geo_provider: str = "stub"
    geo_api_key: str = ""                                  # doar google | mapbox
    geo_base_url: str = "https://nominatim.openstreetmap.org"  # self-host posibil
    geo_user_agent: str = "FLIRT/0.1 (contact@example.com)"    # obligatoriu Nominatim
    # Plafon de geocodări NOI (necache-uite) per cerere de feed — anti-DoS/cost.
    geo_max_lookups_per_request: int = 25

    # Auth providers (TZ 2.1). În 'stub', verificarea acceptă tokenuri/coduri de test.
    social_auth_mode: str = "stub"      # 'stub' | 'live'
    apple_client_id: str = ""
    google_client_id: str = ""
    otp_mode: str = "stub"              # 'stub' (cod fix de test) | 'live' (SMS real)
    otp_test_code: str = "000000"       # cod acceptat în modul stub
    otp_ttl_seconds: int = 300
    sms_api_key: str = ""

    # Push notifications (TZ 6.3). Provider: 'stub' | 'expo' | 'fcm'
    push_provider: str = "stub"
    push_api_key: str = ""

    # Billing / abonamente (TZ 9). Provider: 'stub' | 'stripe' | 'app_store' | 'play'
    billing_provider: str = "stub"
    billing_api_key: str = ""

    # Prețuri planuri abonament (EUR) — catalogul din billing citește de aici (TZ 9)
    price_premium: float = 9.99
    price_no_ads: float = 3.99
    price_ai_bot: float = 4.99
    price_all_inclusive: float = 14.99

    # Verificare facială (TZ 2.2). Provider: 'stub' | 'rekognition'
    face_verify_provider: str = "stub"
    face_match_threshold: float = 90.0   # scor minim de similaritate (0-100)

    # Redis (store OTP live, cache) — ex. redis://localhost:6379/0
    redis_url: str = ""
    # SMS (Twilio REST prin HTTP) — pentru OTP live
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from: str = ""
    # Stripe (billing live prin HTTP)
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    # App Store / Google Play (verificare receipt)
    app_store_shared_secret: str = ""
    google_play_package: str = ""
    # FCM (push live)
    fcm_server_key: str = ""

    # === Securitate / hardening ===
    rate_limit_enabled: bool = True
    rate_limit_login_per_min: int = 5       # încercări login / IP / minut
    rate_limit_register_per_hour: int = 10  # înregistrări / IP / oră
    otp_request_per_hour: int = 5           # cereri OTP / telefon / oră
    otp_max_attempts: int = 5               # încercări verify / cod, apoi invalidare
    max_upload_bytes: int = 8_388_608       # 8 MB limită upload
    allowed_image_types: str = "image/jpeg,image/png,image/webp"
    free_daily_swipe_limit: int = 50        # limită swipe/zi pentru non-premium (TZ 4.5)
    feed_scan_limit: int = 500              # câți candidați scanează feed-ul (anti-DoS)

    @property
    def allowed_image_types_set(self) -> set[str]:
        return {t.strip() for t in self.allowed_image_types.split(",") if t.strip()}

    # Ponderi Compatibility Score (sumă = 1.0) — TZ 4.6
    compat_w_interests: float = 0.30
    compat_w_status: float = 0.15
    compat_w_humor: float = 0.20
    compat_w_distance: float = 0.15
    compat_w_languages: float = 0.10
    compat_w_behavior: float = 0.10

    # Factorul distanță din Compatibility Score (pe km REALI, prin geocoding).
    # scor = max(0, 1 - d / COMPAT_DISTANCE_DECAY_KM); la d ≥ decay → 0.
    compat_distance_decay_km: float = 300.0
    # Distanță necunoscută (oraș negeocodabil) → valoare neutră (nici bonus, nici penalizare).
    compat_distance_neutral: float = 0.5

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

    @model_validator(mode="after")
    def _guard_production(self) -> "Settings":
        # RO: în producție NU pornim cu default-uri nesigure. În dev/staging trecem.
        if self.environment != "production":
            return self

        problems: list[str] = []
        # Parolă DB implicită doar dacă ne bazăm pe credențialele Postgres
        # (fără un DATABASE_URL explicit care ar aduce propria parolă).
        if not self.database_url and self.postgres_password == "change_me":
            problems.append("POSTGRES_PASSWORD folosește valoarea implicită 'change_me'")
        if not self.database_url and not self.postgres_password:
            problems.append("DATABASE_URL gol și fără parolă Postgres reală")
        if not self.jwt_private_key:
            problems.append("JWT_PRIVATE_KEY este gol")
        if not self.jwt_public_key:
            problems.append("JWT_PUBLIC_KEY este gol")

        # RO: în producție NU acceptăm integrări în modul 'stub' — ar însemna
        # verificări false (social login, OTP, plăți, KYC facial, storage, push).
        # EN: reject any integration left in 'stub' mode for production.
        stub_integrations = {
            "SOCIAL_AUTH_MODE": self.social_auth_mode,
            "OTP_MODE": self.otp_mode,
            "BILLING_PROVIDER": self.billing_provider,
            "FACE_VERIFY_PROVIDER": self.face_verify_provider,
            "STORAGE_PROVIDER": self.storage_provider,
            "PUSH_PROVIDER": self.push_provider,
        }
        for name, value in stub_integrations.items():
            if value == "stub":
                problems.append(f"{name} este în modul 'stub' (nesigur în producție)")

        # RO: debug expune stack-trace-uri și trebuie oprit în producție.
        if self.debug is True:
            problems.append("DEBUG este activ (True) în producție")

        # RO: CORS wildcard '*' + credențiale = expunere; interzis în producție.
        if "*" in self.cors_origins_list:
            problems.append("CORS_ORIGINS conține wildcard '*' (nesigur în producție)")

        if problems:
            raise ValueError(
                "Configurare nesigură pentru producție: " + "; ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
