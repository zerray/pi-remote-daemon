# Title

Defer OS service installation

# Status

Accepted

# Context

The daemon can be started manually through the CLI or from Pi with `/remote-control start`. OS service installation through launchd or systemd would make the daemon persistent across logins and reboots, but it adds platform-specific service files, permissions, logging behavior, uninstall logic, and debugging surface.

# Decision

Do not implement OS service installation for the MVP. Keep manual CLI start and Pi extension start as the supported startup paths.

# Consequences

The MVP has fewer platform-specific moving parts. Users must start the daemon explicitly before using the iOS app. If repeated manual startup becomes a real usability problem, service installation can be added later with a new decision record.
