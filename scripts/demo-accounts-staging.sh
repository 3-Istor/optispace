#!/usr/bin/env bash
# Creates the demo companies (demo-a, demo-b) and their FM + employee accounts in a staging realm.
# Idempotent; every run sets new passwords, stored in Vault and never printed.
# Needs `vault login` on the CNP Vault, curl and jq. Usage: scripts/demo-accounts-staging.sh [realm] [app]
set -euo pipefail

REALM="${1:-iot-staging}"
APP="${2:-optispace}"
PROJECT="${REALM%-staging}"
CLIENT="cnp-$PROJECT-$APP-stg"
KC="https://auth.3istor.com"
export VAULT_ADDR="${CNP_VAULT_ADDR:-https://vault.3istor.com}"
VAULT_MOUNT="project-$PROJECT"
VAULT_PATH="$APP-demo-accounts-staging"
FM_GROUP="facility-managers"
ORGS=(demo-a demo-b)
USERS=(fm.demo-a employe.demo-a fm.demo-b employe.demo-b)

[[ "$REALM" == *-staging ]] || { echo "refused: '$REALM' is not a staging realm" >&2; exit 1; }

# The app's staging client: "Client companies" gives its service account manage-organizations
# and manage-users in the staging realm only.
TOKEN=$(vault kv get -format=json -mount="$VAULT_MOUNT" "$APP/staging" | jq -j '.data.data["client-secret"]' \
  | curl -sS -f "$KC/realms/$REALM/protocol/openid-connect/token" \
      -d grant_type=client_credentials -d client_id="$CLIENT" --data-urlencode client_secret@- \
  | jq -r .access_token) || { echo "no token for $CLIENT in $REALM" >&2; exit 1; }

api() { # api METHOD PATH [x = send the JSON on stdin as body]
  curl -sS -f -X "$1" "$KC/admin/realms/$REALM$2" -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' ${3:+--data-binary @-}
}

api GET "/organizations?max=1" >/dev/null || {
  echo "no Organizations access in $REALM: set the project to 'Client companies' in the CMP first" >&2; exit 1; }

group_id() { api GET "/groups?search=$FM_GROUP&exact=true" | jq -r --arg n "$FM_GROUP" '.[] | select(.name==$n) | .id'; }
[[ -n $(group_id) ]] || { jq -n --arg n "$FM_GROUP" '{name:$n}' | api POST /groups x >/dev/null; echo "group $FM_GROUP created"; }
FM_ID=$(group_id)

org_id() { api GET "/organizations?briefRepresentation=true&max=1000" | jq -r --arg a "$1" '.[] | select(.alias==$a) | .id'; }
for org in "${ORGS[@]}"; do
  if [[ -z $(org_id "$org") ]]; then
    suffix="${org#demo-}"
    jq -n --arg a "$org" --arg n "Démo ${suffix^^}" \
      '{alias:$a, name:$n, enabled:true, domains:[{name:"\($a).example.com"}]}' \
      | api POST /organizations x >/dev/null
    echo "organization $org created"
  fi
done

# New passwords go to Vault before Keycloak: a failure afterwards is fixed by running again.
passwords=$(for u in "${USERS[@]}"; do printf '%s\t%s\n' "$u" "$(openssl rand -base64 18 | tr -d '/+=')"; done \
  | jq -Rn '[inputs | split("\t") | {(.[0]): .[1]}] | add')
vault kv put -mount="$VAULT_MOUNT" "$VAULT_PATH" - <<<"$passwords" >/dev/null

for u in "${USERS[@]}"; do
  org="${u#*.}"
  id=$(api GET "/users?username=$u&exact=true" | jq -r '.[0].id // empty')
  if [[ -z $id ]]; then
    role=$([[ $u == fm.* ]] && echo FM || echo Employé); suffix="${org#demo-}"
    jq -n --arg u "$u" --arg o "$org" --arg f "$role" --arg l "Démo ${suffix^^}" \
      '{username:$u, email:"\($u)@\($o).example.com", emailVerified:true, enabled:true,
        firstName:$f, lastName:$l, requiredActions:[]}' | api POST /users x >/dev/null
    id=$(api GET "/users?username=$u&exact=true" | jq -r '.[0].id')
    echo "user $u created"
  fi
  jq --arg u "$u" '{type:"password", temporary:false, value:.[$u]}' <<<"$passwords" \
    | api PUT "/users/$id/reset-password" x >/dev/null
  [[ $u == fm.* ]] && api PUT "/users/$id/groups/$FM_ID" >/dev/null
  code=$(jq -n --arg id "$id" '$id' | curl -sS -o /dev/null -w '%{http_code}' -X POST \
    "$KC/admin/realms/$REALM/organizations/$(org_id "$org")/members" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-)
  [[ $code == 201 || $code == 409 ]] || { echo "adding $u to $org: HTTP $code" >&2; exit 1; } # 409: already a member
  echo "user $u ready (org $org$([[ $u == fm.* ]] && echo ", group $FM_GROUP"))"
done
unset passwords
echo "passwords: vault kv get -mount=$VAULT_MOUNT $VAULT_PATH"
