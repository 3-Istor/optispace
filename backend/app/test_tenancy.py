from app.models import AppUser
from app.security import organization_of
from app.models import Space
from app.testkit import at, iso, make_space, make_user


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


def _two_companies(db):
    return make_space(db, "A1"), make_space(db, "B1", organization="demo-b")


def test_employee_sees_only_spaces_of_their_company(client, claims, db):
    _, b1 = _two_companies(db)
    act_as(claims, "emp-a", "demo-a")

    assert [s["name"] for s in client.get("/api/v1/spaces").json()] == ["A1"]
    missing = client.get(f"/api/v1/spaces/{b1.id}")
    assert (missing.status_code, missing.json()) == (404, {"detail": "SPACE_NOT_FOUND"})
    free = client.get("/api/v1/spaces/availability", params={"start_at": iso(at("10:00")), "end_at": iso(at("10:30"))})
    assert [s["name"] for s in free.json()] == ["A1"]


def test_employee_cannot_book_a_space_of_another_company(client, claims, db):
    a1, b1 = _two_companies(db)
    act_as(claims, "emp-a", "demo-a")
    slot = {"start_at": iso(at("10:00")), "end_at": iso(at("10:30"))}

    refused = client.post("/api/v1/reservations", json={"space_id": str(b1.id), **slot})
    assert (refused.status_code, refused.json()) == (404, {"detail": "SPACE_NOT_FOUND"})
    created = client.post("/api/v1/reservations", json={"space_id": str(a1.id), **slot})
    assert created.status_code == 201
    moved = client.patch(f"/api/v1/reservations/{created.json()['id']}", json={"space_id": str(b1.id)})
    assert (moved.status_code, moved.json()) == (404, {"detail": "SPACE_NOT_FOUND"})


def test_fm_manages_only_spaces_of_their_company(client, claims, db):
    _, b1 = _two_companies(db)
    act_as(claims, "fm-a", "demo-a", "facility-managers")
    period = {"from": iso(at("09:00")), "to": iso(at("10:00"))}

    assert client.patch(f"/api/v1/spaces/{b1.id}", json={"floor": 2}).status_code == 404
    assert client.get(f"/api/v1/spaces/{b1.id}/history", params=period).status_code == 404
    assert client.get(f"/api/v1/spaces/{b1.id}/insights", params=period).status_code == 404

    body = {"name": "B1", "type": "individual_booth", "capacity": 1}
    assert client.post("/api/v1/spaces", json=body).status_code == 201
    assert db.query(Space).filter_by(name="B1", organization="demo-a").count() == 1
    again = client.post("/api/v1/spaces", json={**body, "name": "A1"})
    assert (again.status_code, again.json()) == (409, {"detail": "SPACE_NAME_TAKEN"})


def test_settings_are_per_company(client, claims):
    act_as(claims, "fm-a", "demo-a", "facility-managers")
    assert client.patch("/api/v1/settings", json={"absence_delay_min": 5}).status_code == 200

    act_as(claims, "fm-b", "demo-b", "facility-managers")
    assert client.get("/api/v1/settings").json()["absence_delay_min"] == 10
    act_as(claims, "emp-a", "demo-a")
    assert client.get("/api/v1/me").json()["absence_delay_min"] == 5
    act_as(claims, "emp-b", "demo-b")
    assert client.get("/api/v1/me").json()["absence_delay_min"] == 10


def test_booking_durations_follow_the_company_settings(client, claims, db):
    a1, b1 = _two_companies(db)
    act_as(claims, "fm-b", "demo-b", "facility-managers")
    assert client.patch("/api/v1/settings", json={"booth_max_min": 30}).status_code == 200
    slot = {"start_at": iso(at("10:00")), "end_at": iso(at("10:45"))}

    act_as(claims, "emp-b", "demo-b")
    refused = client.post("/api/v1/reservations", json={"space_id": str(b1.id), **slot})
    assert (refused.status_code, refused.json()) == (422, {"detail": "INVALID_SLOT"})
    act_as(claims, "emp-a", "demo-a")
    assert client.post("/api/v1/reservations", json={"space_id": str(a1.id), **slot}).status_code == 201
