# =============================================================================
# sstp-client-template.rsc — site router as SSTP client (spoke side)
# Standalone template. In production this logic is inlined into onboard.rsc
# with the variables baked in by the platform per router.
#
# Syntax verified against the official MikroTik SSTP docs (manual.mikrotik.com,
# 2026-10-16): /interface sstp-client add name= connect-to= port= user=
# password= profile= authentication= verify-server-certificate=
# verify-server-address-from-certificate= pfs= tls-version= keepalive-timeout=
# dial-on-demand= add-default-route= disabled= comment=
# NOTE: RouterOS models the SSTP server address and TCP port as SEPARATE
# parameters — do NOT embed the port in connect-to (it is rejected with
# "bad address or dns name").
# =============================================================================

# ------------------------- CHANGE: operator variables -------------------------
# Hub address comes from the SSTP_HUB_HOST env var — never a hardcoded IP.
# Canonical: vpn.onetsbyblarch.online
#   (DNS-based SSTP dialing proven live on 2026-10-16.)
:local HUB_HOST "CHANGEME"    # CHANGE: SSTP_HUB_HOST (hub DNS name)
:local SSTP_USER "CHANGEME"   # CHANGE: per-router PPP username (platform-issued)
:local SSTP_PASS "CHANGEME"   # CHANGE: per-router PPP password (platform-issued, never logged)
:local UUID "CHANGEME"        # CHANGE: platform router UUID (stamped in the comment)
:local IFNAME "sstp-to-hub"   # interface name (keep in sync with watchdog.rsc)
# -------------------------------------------------------------------------------

# Idempotent: remove any previous platform client first
:if ([:len [/interface sstp-client find name=$IFNAME]] > 0) do={
    /interface sstp-client remove [find name=$IFNAME]
    :log info "platform: removed previous SSTP client"
}

# Security: the hub uses a publicly-trusted Let's Encrypt certificate for
# vpn.onetsbyblarch.online, so the spoke VERIFIES the server certificate.
# Root YR (https://letsencrypt.org/certs/gen-y/root-yr.pem, valid to 2045)
# is imported and trusted below — one-time, no renewal needed.
/tool fetch url="https://letsencrypt.org/certs/gen-y/root-yr.pem" dst-path="root-yr.pem"
/certificate import file-name="root-yr.pem" passphrase=""
:local ROOTID [/certificate find common-name="Root YR"]
:if ([:len $ROOTID] > 0) do={
    /certificate set $ROOTID trusted=yes
    :log info "platform: Root YR imported and trusted"
}

/interface sstp-client add name=$IFNAME connect-to=$HUB_HOST port=443 \
    user=$SSTP_USER password=$SSTP_PASS profile=default-encryption \
    authentication=mschap2 verify-server-certificate=yes \
    verify-server-address-from-certificate=yes \
    pfs=yes tls-version=only-1.2 keepalive-timeout=60 \
    dial-on-demand=no add-default-route=no disabled=no \
    comment=("platform-uuid=" . $UUID)

:log info "platform: SSTP client installed, dialing hub"
