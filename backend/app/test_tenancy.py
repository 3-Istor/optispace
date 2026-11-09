from app.models import AppUser
from app.security import organization_of
from app.testkit import make_user


def act_as(claims: dict, sub: str, org: str | None = None, *groups: str) -> None:
    """Switch the `claims` fixture to another account; `org=None` means no organization claim."""
    claims.clear()
    claims.update({"sub": sub, "email": f"{sub}@example.com", "name": sub, "groups": list(groups)})
    if org is not None:
        claims["organization"] = [org]


def test_organization_claim_shapes():
    assert organization_of({"organization": ["demo-a"]}) == "demo-a"
    assert organization_of({"organization": {"demo-a": {"id": "x"}}}) == "demo-a"
    for claim in ({}, {"organization": []}, {"organization": {}}, {"organization": "demo-a"},
                  {"organization": ["demo-a", "demo-b"]}):
        assert organization_of(claim) is None


def test_no_organization_is_refused_everywhere(client, claims):
    act_as(claims, "nobody")

    for path in ("/api/v1/me", "/api/v1/spaces", "/api/v1/reservations/mine"):
        response = client.get(path)
        assert (response.status_code, response.json()) == (403, {"detail": "NO_ORGANIZATION"}), path


def test_staff_profile(client, claims, db):
    for group in ("project-members", "project-admins"):
        act_as(claims, "staff", "demo-a", group)
        me = client.get("/api/v1/me")
        assert me.status_code == 200
        assert me.json()["role"] == "staff"
        assert me.json()["absence_delay_min"] is None
    for path in ("/api/v1/spaces", "/api/v1/notifications"):
        response = client.get(path)
        assert (response.status_code, response.json()) == (403, {"detail": "FORBIDDEN"}), path
    db.expire_all()
    assert db.query(AppUser).filter_by(keycloak_sub="staff").one().organization is None


def test_facility_manager_needs_the_fm_group_and_a_company(client, claims):
    act_as(claims, "fm-a", "demo-a", "facility-managers")
    assert client.get("/api/v1/me").json()["role"] == "facility_manager"
    act_as(claims, "emp-a", "demo-a")
    assert client.get("/api/v1/me").json()["role"] == "employee"


def test_existing_user_gets_the_company_of_the_token(client, claims, db):
    make_user(db, "old", organization=None)
    act_as(claims, "old", "demo-a")

    assert client.get("/api/v1/me").json()["role"] == "employee"
    db.expire_all()
    assert db.query(AppUser).filter_by(keycloak_sub="old").one().organization == "demo-a"
