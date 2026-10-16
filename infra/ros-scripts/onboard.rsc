# =============================================================================
# onboard.rsc — ONE-PASTE router onboarding for the MikroTik fleet platform
#
# The tech pastes ONE line in the router terminal (token = platform-issued,
# single-use, expires after first successful callback):
#
#   /tool fetch url="https://PLATFORM/api/v1/onboard/<TOKEN>.rsc" dst-path=onboard.rsc
#   /import file-name=onboard.rsc
#
# (Both lines can be pasted as one block.) The platform generates THIS file
# per router with the variables below baked in, then the script:
#   1. stamps identity (name) + UUID (see DESIGN NOTE)
#   2. creates the least-privilege platform API group + user
#   3. enables the API service locked to the tunnel subnet + firewall rule
#   4. installs the SSTP client (same logic as sstp-client-template.rsc)
#   5. installs the watchdog script + 30s scheduler (same as watchdog.rsc)
#   6. POSTs an HTTPS callback to the platform with the one-time token
#
# Idempotent: re-running removes/recreates the platform-owned items.
# Syntax verified against official MikroTik docs on 2026-10-16. Any parameter
# that could not be verified is marked TODO-verify — none remain in this file.
# =============================================================================

# ============ CHANGE: baked in per router by the PLATFORM (never by hand) ============
# Hub address comes from the SSTP_HUB_HOST env var — never a hardcoded IP.
# Canonical: vpn.onetsbyblarch.online
#   (DNS-based SSTP dialing proven live on 2026-10-16.)
:local UUID         "CHANGEME"   # CHANGE: platform router UUID
:local ROUTER_NAME "CHANGEME"   # CHANGE: site/router display name (<=64 chars)
:local HUB_HOST    "CHANGEME"   # CHANGE: SSTP_HUB_HOST (hub DNS name)
:local SSTP_USER   "CHANGEME"   # CHANGE: per-router PPP username
:local SSTP_PASS   "CHANGEME"   # CHANGE: per-router PPP password
:local TUNNEL_IP   "CHANGEME"   # CHANGE: this router's static tunnel IP (10.200.x.y)
:local API_USER    "platform-api"
:local API_GROUP   "platform-api"
:local API_PASS    "CHANGEME"   # CHANGE: platform-generated API password
:local API_PORT    8728
:local TUNNEL_NET  "10.200.0.0/16"
:local HUB_TUNNEL  "10.200.0.1"
:local PLATFORM_URL "CHANGEME"  # CHANGE: https://platform-host (no trailing slash)
:local TOKEN       "CHANGEME"   # CHANGE: one-time onboarding token
# =====================================================================================

:log info "platform onboard: starting"

# ---------------------------------------------------------------- identity ----
# DESIGN NOTE (verified 2026-10-16 against the official Identity doc):
# /system identity has NO comment property — only `name` (max 64 chars).
# The UUID therefore goes to /system note plus the comments of every item
# this script creates. The platform reads it back via /system/note/print.
# -------------------------------------------------------------------------------
/system identity set name=$ROUTER_NAME
/system note set note=("platform-uuid=" . $UUID . "\nOnboarded by the fleet platform. Do not delete the platform-api user, the sstp-to-hub interface, or the platform-watchdog schedule.")

# ------------------------------------------------- SSTP client (spoke) ----
:local IFNAME "sstp-to-hub"
:if ([:len [/interface sstp-client find name=$IFNAME]] > 0) do={
    /interface sstp-client remove [find name=$IFNAME]
}
/interface sstp-client add name=$IFNAME connect-to=$HUB_HOST port=443 \
    user=$SSTP_USER password=$SSTP_PASS profile=default-encryption \
    authentication=mschap2 verify-server-certificate=no \
    pfs=yes tls-version=only-1.2 keepalive-timeout=60 \
    dial-on-demand=no add-default-route=no disabled=no \
    comment=("platform-uuid=" . $UUID)
:log info "platform onboard: SSTP client installed"

# --------------------------------------- platform API group + user ----
# Least privilege: read+write (hotspot/firewall/queue management), test
# (diagnostics), api+rest-api (the two transports the backend uses).
# Explicitly denied: local/telnet/ssh/ftp/winbox/web (no interactive logins),
# reboot, policy (no privilege escalation), password (cannot change passwords),
# sensitive (cannot read PPP secrets / keys), sniff, romon.
:if ([:len [/user find name=$API_USER]] > 0) do={ /user remove [find name=$API_USER] }
:if ([:len [/user group find name=$API_GROUP]] > 0) do={ /user group remove [find name=$API_GROUP] }
/user group add name=$API_GROUP \
    policy=read,write,test,api,rest-api,!local,!telnet,!ssh,!ftp,!reboot,!policy,!winbox,!password,!web,!sniff,!sensitive,!romon \
    comment="platform least-privilege API access"
:local API_ADDR ($HUB_TUNNEL . "/32")
/user add name=$API_USER group=$API_GROUP password=$API_PASS disabled=no \
    address=$API_ADDR comment=("platform-uuid=" . $UUID)
:log info "platform onboard: API user created"

# --------------------------------------- API service + firewall ----
# API listens for the platform ONLY from the tunnel subnet.
# (Hub CHR in this fleet remapped its public service ports; the tunnel-side
# API port stays a per-router variable so it can differ per device.)
/ip service set api disabled=no port=$API_PORT address=$TUNNEL_NET
:if ([:len [/ip firewall filter find comment="platform: API over SSTP"]] = 0) do={
    /ip firewall filter add chain=input protocol=tcp dst-port=$API_PORT \
        src-address=$TUNNEL_NET action=accept \
        comment="platform: API over SSTP" place-before=0
}
:log info "platform onboard: API service locked to tunnel subnet"

# ------------------------------------------------- watchdog ----
# Canonical copy lives in watchdog.rsc; inlined here so onboarding is one file.
:if ([:len [/system script find name="platform-watchdog"]] > 0) do={
    /system script remove [find name="platform-watchdog"]
}
:if ([:len [/system scheduler find name="platform-watchdog"]] > 0) do={
    /system scheduler remove [find name="platform-watchdog"]
}
/system script add name="platform-watchdog" policy=read,write,test \
    comment="platform tunnel/API watchdog" source={
        :local ifName "sstp-to-hub"
        :local apiUser "platform-api"
        :if ([:len [/interface sstp-client find name=$ifName]] = 0) do={
            :log error "platform-watchdog: SSTP client missing"
        } else={
            :if ([/interface sstp-client get [find name=$ifName] running] != true) do={
                :log warning "platform-watchdog: SSTP tunnel down, redialing"
                /interface sstp-client disable [find name=$ifName]
                :delay 3
                /interface sstp-client enable [find name=$ifName]
            }
        }
        :if ([:len [/user find name=$apiUser]] = 0) do={
            :log error "platform-watchdog: platform API user missing (not recreated: password is platform-held)"
        }
    }
/system scheduler add name="platform-watchdog" interval=30s start-time=startup \
    on-event="platform-watchdog" policy=read,write,test \
    comment="platform watchdog every 30s"
:log info "platform onboard: watchdog installed"

# ------------------------------------------------- HTTPS callback ----
# JSON escaping follows the official /tool fetch docs: http-data="{\"k\":\"v\"}".
:local CB_BODY ("{\"uuid\":\"" . $UUID . "\",\"token\":\"" . $TOKEN . "\",\"tunnel_ip\":\"" . $TUNNEL_IP . "\",\"identity\":\"" . $ROUTER_NAME . "\"}")
:do {
    /tool fetch url=($PLATFORM_URL . "/api/v1/routers/onboard-callback") \
        http-method=post http-header-field="Content-Type: application/json" \
        http-data=$CB_BODY
    :log info "platform onboard: callback sent"
} on-error={
    :log warning "platform onboard: callback failed (tunnel may still be coming up; platform will retry via API health check)"
}

:log info "platform onboard: complete"
