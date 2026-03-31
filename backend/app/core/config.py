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

    # Azure Entra ID
    azure_tenant_id: str = ""
    azure_client_id: str = ""
    azure_client_secret: str = ""

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

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


settings = Settings()