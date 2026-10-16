# =============================================================================
# watchdog.rsc — platform watchdog (standalone / canonical copy)
#
# Installs:
#   /system script   name=platform-watchdog   (the check logic below)
#   /system scheduler name=platform-watchdog  interval=30s start-time=startup
#     → runs the script at boot, then every 30 seconds.
#
# What the watchdog does (small and safe by design):
#   1. If the sstp-to-hub client exists but is not `running` → disable/enable
#      to force a redial, and log a warning (memory log only).
#   2. If the platform-api user is missing → log an error. It is deliberately
#      NOT recreated here: the password is platform-held, and baking it into a
#      scheduler script would expose it to anyone with read access
#      (/system script source is readable without the `sensitive` policy).
#      Re-provision via the platform (re-run onboard.rsc) instead.
#
# The same logic is inlined in onboard.rsc so onboarding stays one file.
# Syntax verified against official MikroTik docs on 2026-10-16:
#   /system script add name= policy= source={...}
#   /system scheduler add name= interval=30s start-time=startup on-event=<script>
#     policy=read,write,test   (start-time=startup + interval ⇒ at boot + repeat)
#   /interface sstp-client get [find name=...] running
#   :log warning "..." / :log error "..."
# =============================================================================

# Idempotent: remove previous copies first
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

:log info "platform: watchdog installed (every 30s)"
