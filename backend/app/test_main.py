from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["message"] == "Bienvenue sur l'API Cloud Native Template"


def test_read_hello():
    response = client.get("/api/hello")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello from FastAPI"}


def test_database_status():
    response = client.get("/api/db/status")
    assert response.status_code == 200
    data = response.json()
    assert "enabled" in data
    assert "type" in data
    assert "connected" in data

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_api_docs_are_under_api():
    """The front's nginx only forwards /api/* to the backend."""
    schema = client.get("/api/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert "/api/v1/me" in paths
    assert not {"/", "/api/hello", "/api/db/status", "/health"} & set(paths)
    docs = client.get("/api/docs")
    assert docs.status_code == 200
    assert "/api/openapi.json" in docs.text
