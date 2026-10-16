# =============================================================================
# sstp-hub-setup.rsc — MikroTik CHR as the platform SSTP hub (server side)
# Run ONCE on the hub CHR (paste into terminal or /import). Re-running is safe:
# every step is guarded by a find-check.
#
# What it does:
#   1. Creates a self-signed CA + server certificate  (verified: /certificate
#      add name= common-name= key-size= days-valid= key-usage= ; sign <tpl>
#      ca-crl-host= name=  for the CA,  sign <tpl> ca= name=  for the server;
#      set <name> trusted=yes)
#   2. Enables the SSTP server on TCP 443  (verified: /interface sstp-server
#      server set enabled= port= certificate= default-profile= authentication=
#      pfs= tls-version= verify-client-certificate= keepalive-timeout=)
#   3. Creates the tunnel PPP profile. Per-router STATIC tunnel IPs are assigned
#      on each /ppp secret via remote-address (design: 10.200.0.0/16) — see the
#      commented per-router template at the bottom (the platform creates these).
#   4. Adds a marked input-chain rule allowing TCP 443 (verified: /ip firewall
#      filter add chain=input protocol=tcp dst-port=443 action=accept).
#
# Syntax verified against the official MikroTik docs (manual.mikrotik.com SSTP
# page + help.mikrotik.com) on 2026-10-16.  Items that could not be verified
# are marked TODO-verify — none remain in this file.
# =============================================================================

# ------------------------- CHANGE: operator variables -------------------------
# Hub identity comes from DNS — never a hardcoded IP in client configs.
# Canonical: vpn.onetsbyblarch.online
#   (DNS-based SSTP dialing proven live on 2026-10-16.)
:local HUB_CN "CHANGEME"            # CHANGE: hub DNS name (canonical: vpn.onetsbyblarch.online)
:local TUNNEL_LOCAL "10.200.0.1"    # CHANGE: hub-side tunnel endpoint (inside 10.200.0.0/16)
:local CA_NAME "sstp-ca"            # CHANGE only if you must (referenced by server cert)
:local SRV_CERT_NAME "sstp-server"   # CHANGE only if you must (referenced by sstp-server)
:local PROFILE_NAME "sstp-tunnel"   # CHANGE only if you must (per-router secrets use it)
# -------------------------------------------------------------------------------

:log info "platform: starting SSTP hub setup"

# --- 1. CA certificate (self-signed) ---
:if ([:len [/certificate find name=$CA_NAME]] = 0) do={
    :log info "platform: creating CA certificate"
    /certificate add name="sstp-ca-tpl" common-name=$HUB_CN days-valid=3650 key-size=2048 key-usage=key-cert-sign,crl-sign
    /certificate sign "sstp-ca-tpl" ca-crl-host=$HUB_CN name=$CA_NAME
    :delay 5
    /certificate set $CA_NAME trusted=yes
} else={
    :log info "platform: CA certificate already exists, skipping"
}

# --- 2. Server certificate (signed by the CA) ---
:if ([:len [/certificate find name=$SRV_CERT_NAME]] = 0) do={
    :log info "platform: creating server certificate"
    /certificate add name="sstp-server-tpl" common-name=$HUB_CN days-valid=3650 key-size=2048 key-usage=digital-signature,key-encipherment,tls-server
    /certificate sign "sstp-server-tpl" ca=$CA_NAME name=$SRV_CERT_NAME
    :delay 5
    /certificate set $SRV_CERT_NAME trusted=yes
} else={
    :log info "platform: server certificate already exists, skipping"
}

# --- 3. PPP profile for tunnel clients ---
# NOTE: no remote-address here on purpose — each router gets a STATIC tunnel IP
# via its own /ppp secret (remote-address=), per the hub-and-spoke design.
:if ([:len [/ppp profile find name=$PROFILE_NAME]] = 0) do={
    /ppp profile add name=$PROFILE_NAME local-address=$TUNNEL_LOCAL use-encryption=yes only-one=yes comment="platform SSTP tunnel profile"
    :log info "platform: PPP profile created"
} else={
    :log info "platform: PPP profile already exists, skipping"
}

# --- 4. SSTP server ---
/interface sstp-server server set enabled=yes port=443 certificate=$SRV_CERT_NAME \
    default-profile=$PROFILE_NAME authentication=mschap2 pfs=yes tls-version=only-1.2 \
    verify-client-certificate=no keepalive-timeout=60
:log info "platform: SSTP server enabled on TCP 443"

# --- 5. Firewall: allow SSTP (TCP 443) in, placed at the top ---
:if ([:len [/ip firewall filter find comment="platform: allow SSTP 443"]] = 0) do={
    /ip firewall filter add chain=input protocol=tcp dst-port=443 action=accept \
        comment="platform: allow SSTP 443" place-before=0
    :log info "platform: firewall rule for SSTP 443 added"
} else={
    :log info "platform: SSTP firewall rule already exists, skipping"
}

:log info "platform: SSTP hub setup complete"

# =============================================================================
# PER-ROUTER SECRET (created by the PLATFORM, not by hand — template only):
#
#   /ppp secret add name="<sstp-user>" password="<strong-unique>" service=sstp \
#       profile=sstp-tunnel local-address=10.200.0.1 remote-address=10.200.<x>.<y> \
#       comment="uuid=<router-uuid>"
#
# remote-address = the router's STATIC tunnel IP (unique inside 10.200.0.0/16).
# Verify a router's tunnel:  /ppp active print where name="<sstp-user>"
# =============================================================================
