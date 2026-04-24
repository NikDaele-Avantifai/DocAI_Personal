from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    app_env: str = "development"
    app_secret_key: str = "dev-secret-change-in-production"

    # Database
    database_url: str = "postgresql+asyncpg://postgres@localhost:5432/doc_ai_db"
    @property
    def async_database_url(self) -> str:
        """Always returns an asyncpg-compatible URL."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    # Auth0
    auth0_domain: str = ""        # e.g. yourorg.auth0.com
    auth0_audience: str = ""      # API identifier, e.g. https://api.docai.io
    auth0_client_id: str = ""     # SPA client ID (used for token validation metadata)

    # Anthropic
    anthropic_api_key: str = ""

    # Voyage AI (embeddings — get a free key at voyageai.com)
    voyage_api_key: str = ""

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Atlassian / Confluence (server-side credentials for workspace sync)
    atlassian_base_url: str = "https://hexius.atlassian.net"
    atlassian_api_token: str = ""
    atlassian_mail: str = ""

    # Admin monitoring (internal use only — not customer-facing)
    admin_secret_token: str = ""

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    def validate_production_secrets(self) -> list[str]:
        """Returns list of missing required secrets for production."""
        issues = []
        if self.is_production:
            if not self.auth0_domain:
                issues.append("AUTH0_DOMAIN not set")
            if not self.auth0_audience:
                issues.append("AUTH0_AUDIENCE not set")
            if not self.anthropic_api_key:
                issues.append("ANTHROPIC_API_KEY not set")
            if self.app_secret_key == "dev-secret-change-in-production":
                issues.append("APP_SECRET_KEY is still the default dev value")
        return issues


settings = Settings()

# Warn loudly if production secrets are missing
import logging as _logging
_issues = settings.validate_production_secrets()
if _issues:
    for _issue in _issues:
        _logging.getLogger(__name__).critical(
            "SECURITY: %s — fix before handling real traffic", _issue
        )